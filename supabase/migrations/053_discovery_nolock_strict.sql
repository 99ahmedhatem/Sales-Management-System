-- 053 (originally pasted as "056" / supabase-056-discovery-nolock-strict.sql; saved under the next free number).
-- Discovery — (1) stop/finish no longer hangs, (2) strict platform matching, (3) no 429 bursts,
--      (4) allow turning ALL options off (= any site).
-- Replaces discovery_collect / discovery_send / set_discovery_run_state / start_discovery_run from 046.
-- Needs pg_cron >= 1.5 (second-based schedules); cron.schedule with an existing job name updates it.

-- ---------- helpers ----------
create or replace function public._disc_acc(acc jsonb, rid uuid, k text, val jsonb)
returns jsonb language sql immutable as $$
  select acc || jsonb_build_object(rid::text, coalesce(acc->(rid::text), '{}'::jsonb) || jsonb_build_object(k, val))
$$;
create or replace function public._disc_bump(acc jsonb, rid uuid, k text, n int default 1)
returns jsonb language sql immutable as $$
  select public._disc_acc(acc, rid, k, to_jsonb(coalesce((acc->(rid::text)->>k)::int, 0) + n))
$$;
-- strict keyword match: bare single words (e.g. "salla") are ignored when a more specific signature exists
create or replace function public._disc_has_strict(html text, sigs jsonb)
returns boolean language sql immutable as $$
  select exists (
    select 1 from jsonb_array_elements_text(coalesce(sigs,'[]'::jsonb)) s
    where (s ~ '[^a-zA-Z0-9]' or not exists (select 1 from jsonb_array_elements_text(coalesce(sigs,'[]'::jsonb)) s2 where s2 ~ '[^a-zA-Z0-9]'))
      and position(lower(s) in lower(html)) > 0)
$$;

-- ---------- collect: counters are applied ONCE at the end (short row locks) ----------
create or replace function public.discovery_collect()
returns integer language plpgsql security definer set search_path to 'public','extensions','net' as $function$
declare run record; cfg jsonb; r record; it jsonb; link text; title text; dom text; nm text; cnt int := 0; ph text[]; feats text[]; html text; path text; base text;
        skip jsonb; cc text; ccnum text; ccs text[]; cf jsonb; allowed boolean; t text; cname text;
        acc jsonb := '{}'::jsonb; rid uuid; requeue boolean; a jsonb;
begin
  -- 1) Serper results
  for r in select q.run_id, q.idx, q.country_code, p.status_code, p.content, p.error_msg from public.discovery_queries q join net._http_response p on p.id = q.request_id where q.state = 'sent' order by q.idx limit 40 loop
    rid := r.run_id; requeue := false;
    select * into run from public.discovery_runs where id = rid; cfg := run.config; skip := coalesce(cfg->'skip_domains','[]'::jsonb);
    if r.status_code = 200 and r.content is not null then
      begin
        for it in select jsonb_array_elements(coalesce(r.content::jsonb->'organic','[]'::jsonb)) loop
          link := it->>'link'; title := coalesce(it->>'title','');
          acc := public._disc_bump(acc, rid, 'st_links');
          if link is null or link ilike '%google.com%' then continue; end if;
          dom := public._disc_domain(link);
          if dom is null or skip ? dom then continue; end if;
          allowed := dom like '%.com';
          if not allowed then
            for t in select (cfg->'country_defs'->c->>'tld') from jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) c loop
              if t is not null and dom like '%' || t then allowed := true; end if;
            end loop;
          end if;
          if not allowed then acc := public._disc_bump(acc, rid, 'st_bad_tld'); continue; end if;
          if exists (select 1 from public.discovery_results x where x.domain = dom) then continue; end if;
          if public._disc_lead_exists(dom, null) then acc := public._disc_bump(acc, rid, 'duplicates'); continue; end if;
          nm := btrim(split_part(regexp_replace(title, '[|\-–—»«]', '|', 'g'), '|', 1));
          insert into public.discovery_pages(run_id, domain, name, url, kind, country_code) values (rid, dom, nullif(nm,''), link, 'home', r.country_code) on conflict do nothing;
        end loop;
      exception when others then acc := public._disc_bump(acc, rid, 'errors'); acc := public._disc_acc(acc, rid, 'last_error', to_jsonb('bad serper response'::text)); end;
    elsif r.status_code in (401, 403) then
      acc := public._disc_bump(acc, rid, 'errors'); acc := public._disc_acc(acc, rid, 'pause', 'true'::jsonb);
      acc := public._disc_acc(acc, rid, 'last_error', to_jsonb('Serper key rejected (' || r.status_code || ') — تحقق من المفتاح/الرصيد'));
    elsif r.status_code = 429 or r.status_code >= 500 or r.status_code is null then
      requeue := true;  -- rate limit / transient: try again later instead of losing the query
      acc := public._disc_acc(acc, rid, 'last_error', to_jsonb(left('HTTP ' || coalesce(r.status_code::text,'?') || ' (retrying) ' || coalesce(r.error_msg, ''), 200)));
    else
      acc := public._disc_bump(acc, rid, 'errors');
      acc := public._disc_acc(acc, rid, 'last_error', to_jsonb(left('HTTP ' || coalesce(r.status_code::text,'?') || ' ' || coalesce(r.error_msg, r.content, ''), 200)));
    end if;
    if requeue then
      update public.discovery_queries set state = 'pending', request_id = null where run_id = rid and idx = r.idx;
    else
      update public.discovery_queries set state = 'done' where run_id = rid and idx = r.idx;
    end if;
    cnt := cnt + 1;
  end loop;

  -- 2) site pages
  for r in select g.id, g.run_id, g.domain, g.name, g.url, g.kind, g.country_code, p.status_code, p.content from public.discovery_pages g join net._http_response p on p.id = g.request_id where g.state = 'sent' limit 60 loop
    rid := r.run_id;
    select config into cfg from public.discovery_runs where id = rid; html := case when r.status_code between 200 and 399 then left(coalesce(r.content,''), 200000) end;
    ccs := array(select cfg->'country_defs'->c->>'cc' from jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) c);
    begin
    if html is null and r.kind = 'home' then acc := public._disc_bump(acc, rid, 'st_fetch_failed'); end if;
    if html is not null then
      if r.kind = 'home' then
        acc := public._disc_bump(acc, rid, 'st_fetched');
        cc := public._disc_country(r.domain, html, cfg);
        if cc is null then acc := public._disc_bump(acc, rid, 'st_no_country'); end if;
        if cc is not null then
          feats := '{}';
          if coalesce((cfg->'features'->>'app')::boolean,false) and public._disc_has_any(html, cfg->'app_signals') then feats := feats || 'تطبيق موبايل'::text; end if;
          if coalesce((cfg->'features'->>'dashboard')::boolean,false) and public._disc_has_any(html, cfg->'dashboard_signals') then feats := feats || 'داشبورد/بوابة عملاء'::text; end if;
          if coalesce((cfg->'features'->>'wordpress')::boolean,false) and public._disc_has_any(html, cfg->'wordpress_signals') then feats := feats || 'ووردبريس خدمي'::text; end if;
          for cf in select jsonb_array_elements(coalesce(cfg->'custom_features','[]'::jsonb)) loop
            if public._disc_has_strict(html, cf->'keywords') then feats := feats || coalesce(cf->>'label', 'ميزة مخصّصة')::text; end if;
          end loop;
          if coalesce(array_length(feats,1),0) = 0 and coalesce((cfg->'features'->>'any_site')::boolean,false) then feats := feats || 'موقع عادي (أي منصة)'::text; end if;
          if coalesce(array_length(feats,1),0) = 0 then acc := public._disc_bump(acc, rid, 'st_no_feature'); end if;
          if coalesce(array_length(feats,1),0) > 0 then
            ccnum := cfg->'country_defs'->cc->>'cc'; cname := cfg->'country_defs'->cc->>'name_en';
            ph := array(select public._disc_fmt_phone(x, ccnum) from unnest(public._disc_phones(html, ccs)) x);
            if public._disc_lead_exists(r.domain, ph[1]) then
              acc := public._disc_bump(acc, rid, 'duplicates');
            else
              insert into public.discovery_results(run_id, domain, name, url, phone, phones, features, notes, country_code, country)
              values (rid, r.domain, coalesce(r.name, r.domain), r.url, ph[1], coalesce(ph, '{}'), feats,
                      'مطابق: ' || array_to_string(feats, ', ') || case when coalesce(array_length(ph,1),0) > 1 then ' | أرقام إضافية: ' || array_to_string(ph[2:], ' / ') else '' end,
                      cc, cname)
              on conflict (domain) do nothing;
              if ph[1] is null then
                for path in select jsonb_array_elements_text(coalesce(cfg->'contact_paths','[]'::jsonb)) loop
                  base := regexp_replace(r.url, '^(https?://[^/]+).*$', '\1');
                  insert into public.discovery_pages(run_id, domain, name, url, kind, country_code) values (rid, r.domain, r.name, base || path, 'contact', cc) on conflict do nothing;
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
    exception when others then
      acc := public._disc_bump(acc, rid, 'errors');
      acc := public._disc_acc(acc, rid, 'last_error', to_jsonb(left('page ' || coalesce(r.domain,'?') || ': ' || sqlerrm, 200)));
    end;
    delete from public.discovery_pages where id = r.id; cnt := cnt + 1;
  end loop;
  begin delete from net._http_response where id in (select request_id from public.discovery_queries where state = 'done' and request_id is not null and sent_at > now() - interval '1 day'); exception when others then null; end;

  -- 3) apply counters once (row locks are held only for an instant)
  for rid, a in select key::uuid, value from jsonb_each(acc) loop
    update public.discovery_runs set
      st_links = st_links + coalesce((a->>'st_links')::int,0),
      st_bad_tld = st_bad_tld + coalesce((a->>'st_bad_tld')::int,0),
      st_fetched = st_fetched + coalesce((a->>'st_fetched')::int,0),
      st_fetch_failed = st_fetch_failed + coalesce((a->>'st_fetch_failed')::int,0),
      st_no_country = st_no_country + coalesce((a->>'st_no_country')::int,0),
      st_no_feature = st_no_feature + coalesce((a->>'st_no_feature')::int,0),
      duplicates = duplicates + coalesce((a->>'duplicates')::int,0),
      errors = errors + coalesce((a->>'errors')::int,0),
      last_error = coalesce(a->>'last_error', last_error),
      status = case when (a->>'pause')::boolean is true and status = 'running' then 'paused' else status end
    where id = rid;
  end loop;

  for run in select * from public.discovery_runs where status = 'running' loop
    if not exists (select 1 from public.discovery_queries where run_id = run.id and state <> 'done') and not exists (select 1 from public.discovery_pages where run_id = run.id) then
      update public.discovery_runs set status = 'done', finished_at = now() where id = run.id;
      begin
        insert into public.notifications(user_id, type, title, message)
          select u.id, 'system', 'انتهى البحث عن عملاء جدد',
                 format('تم العثور على %s موقع جديد بانتظار مراجعتك (تم استبعاد %s مكرر).', (select count(*) from public.discovery_results where run_id = run.id), run.duplicates)
          from public.users u where u.role = 'admin' and u.status = 'active';
      exception when others then null; end;
    end if;
  end loop;
  return cnt;
end $function$;

-- ---------- stop / pause: never waits on rows locked by the workers ----------
create or replace function public.set_discovery_run_state(p_run uuid, p_state text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_state not in ('running','paused','stopped') then raise exception 'invalid state'; end if;
  perform set_config('lock_timeout', '4000', true);
  update public.discovery_runs set status = p_state, finished_at = case when p_state = 'stopped' then now() end
   where id = p_run and status in ('running','paused');
  if p_state = 'stopped' then
    delete from public.discovery_pages where id in (select id from public.discovery_pages where run_id = p_run for update skip locked);
    update public.discovery_queries set state = 'done'
     where (run_id, idx) in (select run_id, idx from public.discovery_queries where run_id = p_run and state <> 'done' for update skip locked);
  end if;
end $function$;

-- ---------- allow "no option selected" (= any site) ----------
create or replace function public.start_discovery_run(p_name text default 'default', p_config jsonb default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare cfg jsonb; rid uuid; qs jsonb; pg int; n int;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if not public.has_discovery_serper_key() then raise exception 'Serper API key is not set'; end if;
  cfg := public._disc_merge_cfg(coalesce(p_config, (select config from public.discovery_configs where name = p_name)));
  if jsonb_array_length(coalesce(cfg->'countries','[]'::jsonb)) = 0 then raise exception 'Choose at least one country'; end if;
  if not (coalesce((cfg->'features'->>'app')::boolean,false) or coalesce((cfg->'features'->>'dashboard')::boolean,false)
          or coalesce((cfg->'features'->>'wordpress')::boolean,false) or coalesce((cfg->'features'->>'any_site')::boolean,false)
          or jsonb_array_length(coalesce(cfg->'custom_features','[]'::jsonb)) > 0) then
    cfg := jsonb_set(cfg, '{features}', coalesce(cfg->'features','{}'::jsonb) || '{"any_site":true}'::jsonb);   -- nothing selected = no filter
  end if;
  qs := public._disc_build_queries(cfg); n := jsonb_array_length(qs); pg := greatest(coalesce((cfg->>'pages_per_query')::int, 1), 1);
  if n = 0 then raise exception 'No search queries — check sectors and countries'; end if;
  insert into public.discovery_runs(config_name, config, status, total_queries, created_by) values (p_name, cfg, 'running', n * pg, auth.uid()) returning id into rid;
  insert into public.discovery_queries(run_id, idx, q, page, country_code)
    select rid, (u.o - 1) * pg + g, u.q, g, u.cc
    from (select (e->>'q') as q, (e->>'cc') as cc, o from jsonb_array_elements(qs) with ordinality t(e, o)) u, generate_series(1, pg) g;
  return rid;
end $function$;

-- ---------- send: small steady batches (Serper allows 5 req/s) ----------
create or replace function public.discovery_send()
returns integer language plpgsql security definer set search_path to 'public','extensions','net' as $function$
declare run record; q record; g record; skey text; cfg jsonb; v bigint; n int := 0; sp int; fp int; gl text;
begin
  select ds.value into skey from public.discovery_settings ds where ds.key = 'serper_key';
  for run in select * from public.discovery_runs where status = 'running' loop
    cfg := run.config;
    sp := least(coalesce(ceil(coalesce((cfg->>'serper_per_min')::int, 60) / 12.0)::int, 4), 4);   -- <= 4 per 5s call
    fp := greatest(ceil(coalesce((cfg->>'fetch_per_min')::int, 300) / 12.0)::int, 5);
    update public.discovery_queries set state = 'pending', request_id = null where run_id = run.id and state = 'sent' and sent_at < now() - interval '10 minutes';
    delete from public.discovery_pages where run_id = run.id and state = 'sent' and sent_at < now() - interval '10 minutes';
    if skey is not null then
      for q in select * from public.discovery_queries where run_id = run.id and state = 'pending' order by idx limit sp for update skip locked loop
        begin
          gl := coalesce(cfg->'country_defs'->q.country_code->>'gl', q.country_code, 'sa');
          select net.http_post(url := 'https://google.serper.dev/search',
                 body := jsonb_build_object('q', q.q, 'gl', gl, 'hl', 'ar', 'num', 100, 'page', q.page),
                 headers := jsonb_build_object('X-API-KEY', skey, 'Content-Type', 'application/json'), timeout_milliseconds := 20000) into v;
          update public.discovery_queries set state = 'sent', request_id = v, sent_at = now() where run_id = q.run_id and idx = q.idx; n := n + 1;
        exception when others then update public.discovery_runs set errors = errors + 1, last_error = left(sqlerrm, 200) where id = run.id; end;
      end loop;
    end if;
    for g in select * from public.discovery_pages where run_id = run.id and state = 'pending' order by id limit fp for update skip locked loop
      begin
        select net.http_get(url := g.url, timeout_milliseconds := 12000,
               headers := '{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36","Accept-Language":"ar,en;q=0.8"}'::jsonb) into v;
        update public.discovery_pages set state = 'sent', request_id = v, sent_at = now() where id = g.id; n := n + 1;
      exception when others then delete from public.discovery_pages where id = g.id; end;
    end loop;
  end loop;
  return n;
end $function$;

revoke execute on function public._disc_acc(jsonb,uuid,text,jsonb), public._disc_bump(jsonb,uuid,text,int), public._disc_has_strict(text,jsonb) from public, anon, authenticated;
revoke execute on function public.discovery_collect(), public.discovery_send() from public, anon, authenticated;
revoke execute on function public.set_discovery_run_state(uuid,text), public.start_discovery_run(text,jsonb) from public, anon;
grant execute on function public.set_discovery_run_state(uuid,text), public.start_discovery_run(text,jsonb) to authenticated;

-- send every 5s, collect every 10s (pg_cron >= 1.5)
select cron.schedule('discovery-send', '5 seconds', 'select public.discovery_send()');
select cron.schedule('discovery-collect', '10 seconds', 'select public.discovery_collect()');
