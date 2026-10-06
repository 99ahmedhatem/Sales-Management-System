-- 046 (+ حماية: أي خطأ في صفحة واحدة يُسجَّل ولا يوقف باقي المعالجة): خيار "موقع عادي على أي منصة": أي موقع في البلد المختارة يُقبل حتى لو مفيش ميزة مطابقة
set lock_timeout = 0; set statement_timeout = 0;
create or replace function public.start_discovery_run(p_name text default 'default', p_config jsonb default null) returns uuid language plpgsql security definer set search_path = public as $f$
declare cfg jsonb; rid uuid; qs jsonb; pg int; n int;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if not public.has_discovery_serper_key() then raise exception 'Serper API key is not set'; end if;
  cfg := public._disc_merge_cfg(coalesce(p_config, (select config from public.discovery_configs where name = p_name)));
  if jsonb_array_length(coalesce(cfg->'countries','[]'::jsonb)) = 0 then raise exception 'Choose at least one country'; end if;
  if not (coalesce((cfg->'features'->>'app')::boolean,false) or coalesce((cfg->'features'->>'dashboard')::boolean,false)
          or coalesce((cfg->'features'->>'wordpress')::boolean,false) or coalesce((cfg->'features'->>'any_site')::boolean,false) or jsonb_array_length(coalesce(cfg->'custom_features','[]'::jsonb)) > 0) then
    raise exception 'Choose at least one thing to look for';
  end if;
  qs := public._disc_build_queries(cfg); n := jsonb_array_length(qs); pg := greatest(coalesce((cfg->>'pages_per_query')::int, 1), 1);
  if n = 0 then raise exception 'No search queries — check sectors and countries'; end if;
  insert into public.discovery_runs(config_name, config, status, total_queries, created_by) values (p_name, cfg, 'running', n * pg, auth.uid()) returning id into rid;
  insert into public.discovery_queries(run_id, idx, q, page, country_code)
    select rid, (u.o - 1) * pg + g, u.q, g, u.cc
    from (select (e->>'q') as q, (e->>'cc') as cc, o from jsonb_array_elements(qs) with ordinality t(e, o)) u, generate_series(1, pg) g;
  return rid;
end $f$;



create or replace function public.discovery_collect() returns int language plpgsql security definer set search_path = public, extensions, net as $f$
declare run record; cfg jsonb; r record; it jsonb; link text; title text; dom text; nm text; cnt int := 0; ph text[]; feats text[]; html text; path text; base text;
        skip jsonb; req jsonb; cc text; ccnum text; ccs text[]; cf jsonb; allowed boolean; t text; cname text;
begin
  -- 1) نتائج Serper
  for r in select q.run_id, q.idx, q.country_code, p.status_code, p.content, p.error_msg from public.discovery_queries q join net._http_response p on p.id = q.request_id where q.state = 'sent' order by q.idx limit 40 loop
    select * into run from public.discovery_runs where id = r.run_id; cfg := run.config; skip := coalesce(cfg->'skip_domains','[]'::jsonb);
    if r.status_code = 200 and r.content is not null then
      begin
        for it in select jsonb_array_elements(coalesce(r.content::jsonb->'organic','[]'::jsonb)) loop
          link := it->>'link'; title := coalesce(it->>'title','');
          update public.discovery_runs set st_links = st_links + 1 where id = run.id;
          if link is null or link ilike '%google.com%' then continue; end if;
          dom := public._disc_domain(link);
          if dom is null or skip ? dom then continue; end if;
          allowed := dom like '%.com';
          if not allowed then
            for t in select (cfg->'country_defs'->c->>'tld') from jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) c loop
              if t is not null and dom like '%' || t then allowed := true; end if;
            end loop;
          end if;
          if not allowed then update public.discovery_runs set st_bad_tld = st_bad_tld + 1 where id = run.id; continue; end if;
          if exists (select 1 from public.discovery_results x where x.domain = dom) then continue; end if;
          if public._disc_lead_exists(dom, null) then update public.discovery_runs set duplicates = duplicates + 1 where id = run.id; continue; end if;
          nm := btrim(split_part(regexp_replace(title, '[|\-–—»«]', '|', 'g'), '|', 1));
          insert into public.discovery_pages(run_id, domain, name, url, kind, country_code) values (run.id, dom, nullif(nm,''), link, 'home', r.country_code) on conflict do nothing;
        end loop;
      exception when others then update public.discovery_runs set errors = errors + 1, last_error = 'bad serper response' where id = run.id; end;
    elsif r.status_code in (401, 403) then
      update public.discovery_runs set status = 'paused', errors = errors + 1, last_error = 'Serper key rejected (' || r.status_code || ') — تحقق من المفتاح/الرصيد' where id = run.id;
    else
      update public.discovery_runs set errors = errors + 1, last_error = left('HTTP ' || coalesce(r.status_code::text,'?') || ' ' || coalesce(r.error_msg, r.content, ''), 200) where id = run.id;
    end if;
    update public.discovery_queries set state = 'done' where run_id = r.run_id and idx = r.idx; cnt := cnt + 1;
  end loop;

  -- 2) صفحات المواقع
  for r in select g.id, g.run_id, g.domain, g.name, g.url, g.kind, g.country_code, p.status_code, p.content from public.discovery_pages g join net._http_response p on p.id = g.request_id where g.state = 'sent' limit 60 loop
    select config into cfg from public.discovery_runs where id = r.run_id; html := case when r.status_code between 200 and 399 then left(coalesce(r.content,''), 200000) end;
    ccs := array(select cfg->'country_defs'->c->>'cc' from jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) c);
    begin
    if html is null and r.kind = 'home' then update public.discovery_runs set st_fetch_failed = st_fetch_failed + 1 where id = r.run_id; end if;
    if html is not null then
      if r.kind = 'home' then
        update public.discovery_runs set st_fetched = st_fetched + 1 where id = r.run_id;
        cc := public._disc_country(r.domain, html, cfg);
        if cc is null then update public.discovery_runs set st_no_country = st_no_country + 1 where id = r.run_id; end if;
        if cc is not null then
          feats := '{}';
          if coalesce((cfg->'features'->>'app')::boolean,false) and public._disc_has_any(html, cfg->'app_signals') then feats := feats || 'تطبيق موبايل'::text; end if;
          if coalesce((cfg->'features'->>'dashboard')::boolean,false) and public._disc_has_any(html, cfg->'dashboard_signals') then feats := feats || 'داشبورد/بوابة عملاء'::text; end if;
          if coalesce((cfg->'features'->>'wordpress')::boolean,false) and public._disc_has_any(html, cfg->'wordpress_signals') then feats := feats || 'ووردبريس خدمي'::text; end if;
          for cf in select jsonb_array_elements(coalesce(cfg->'custom_features','[]'::jsonb)) loop
            if public._disc_has_any(html, cf->'keywords') then feats := feats || coalesce(cf->>'label', 'ميزة مخصّصة')::text; end if;
          end loop;
          if coalesce(array_length(feats,1),0) = 0 and coalesce((cfg->'features'->>'any_site')::boolean,false) then feats := feats || 'موقع عادي (أي منصة)'::text; end if;
          if coalesce(array_length(feats,1),0) = 0 then update public.discovery_runs set st_no_feature = st_no_feature + 1 where id = r.run_id; end if;
          if coalesce(array_length(feats,1),0) > 0 then
            ccnum := cfg->'country_defs'->cc->>'cc'; cname := cfg->'country_defs'->cc->>'name_en';
            ph := array(select public._disc_fmt_phone(x, ccnum) from unnest(public._disc_phones(html, ccs)) x);
            if public._disc_lead_exists(r.domain, ph[1]) then
              update public.discovery_runs set duplicates = duplicates + 1 where id = r.run_id;
            else
              insert into public.discovery_results(run_id, domain, name, url, phone, phones, features, notes, country_code, country)
              values (r.run_id, r.domain, coalesce(r.name, r.domain), r.url, ph[1], coalesce(ph, '{}'), feats,
                      'مطابق: ' || array_to_string(feats, ', ') || case when coalesce(array_length(ph,1),0) > 1 then ' | أرقام إضافية: ' || array_to_string(ph[2:], ' / ') else '' end,
                      cc, cname)
              on conflict (domain) do nothing;
              if ph[1] is null then
                for path in select jsonb_array_elements_text(coalesce(cfg->'contact_paths','[]'::jsonb)) loop
                  base := regexp_replace(r.url, '^(https?://[^/]+).*$', '\1');
                  insert into public.discovery_pages(run_id, domain, name, url, kind, country_code) values (r.run_id, r.domain, r.name, base || path, 'contact', cc) on conflict do nothing;
                end loop;
              end if;
            end if;
          end if;
        end if;
      else
        ccnum := coalesce(cfg->'country_defs'->r.country_code->>'cc', '966');
        ph := array(select public._disc_fmt_phone(x, ccnum) from unnest(public._disc_phones(html, ccs)) x);
        if coalesce(array_length(ph,1),0) > 0 and not public._disc_lead_exists(null, ph[1]) then
          update public.discovery_results set phone = ph[1], phones = ph where domain = r.domain and phone is null and status = 'new';
        end if;
      end if;
    end if;
    exception when others then update public.discovery_runs set errors = errors + 1, last_error = left('page ' || coalesce(r.domain,'?') || ': ' || sqlerrm, 200) where id = r.run_id;
    end;
    delete from public.discovery_pages where id = r.id; cnt := cnt + 1;
  end loop;
  begin delete from net._http_response where id in (select request_id from public.discovery_queries where state = 'done' and request_id is not null and sent_at > now() - interval '1 day'); exception when others then null; end;

  for run in select * from public.discovery_runs where status = 'running' loop
    if not exists (select 1 from public.discovery_queries where run_id = run.id and state <> 'done') and not exists (select 1 from public.discovery_pages where run_id = run.id) then
      update public.discovery_runs set status = 'done', finished_at = now() where id = run.id;
      insert into public.notifications(user_id, type, title, message)
        select u.id, 'comment', 'انتهى البحث عن عملاء جدد',
               format('تم العثور على %s موقع جديد بانتظار مراجعتك (تم استبعاد %s مكرر).', (select count(*) from public.discovery_results where run_id = run.id), run.duplicates)
        from public.users u where u.role = 'admin' and u.status = 'active';
    end if;
  end loop;
  return cnt;
end $f$;
revoke all on function public.discovery_collect() from public, anon, authenticated;
