-- 043: تبسيط إعدادات الاكتشاف — بحث بالدول (بدون مدن)، ميزات قابلة للاختيار + ميزة مخصّصة، ودعم الإمارات والخليج.
-- يعدّل 042. شغّله بعد 042.
alter table public.discovery_queries add column if not exists country_code text default 'sa';
alter table public.discovery_pages   add column if not exists country_code text default 'sa';
alter table public.discovery_results add column if not exists country_code text;
alter table public.discovery_results add column if not exists country text;

create or replace function public.discovery_default_config() returns jsonb language sql immutable as $f$
  select $j${"countries": ["sa"], "country_defs": {"sa": {"name_ar": "السعودية", "name_en": "Saudi Arabia", "gl": "sa", "tld": ".sa", "query_word": "السعودية", "cc": "966", "signals": ["\\+966", "966\\d{9}", "05\\d{8}", "المملكة العربية السعودية", "السعودية", "الرياض", "جدة", "مكة", "الدمام", "الخبر", "ريال سعودي", "SAR", "ر.س", "salla", "zid.sa", ".com.sa", "ksa", "saudi"], "extra_queries": ["site:sa تطبيقنا على app store", "site:sa تطبيقنا على google play", "شركات سعودية لها تطبيق جوال", "site:sa \"powered by wordpress\"", "site:sa بوابة العملاء", "site:sa لوحة تحكم العملاء", "startups Saudi Arabia mobile app", "SME Saudi Arabia dashboard"], "cities": ["الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "الظهران", "الطائف", "أبها", "خميس مشيط", "تبوك", "حائل", "بريدة", "عنيزة", "الرس", "جازان", "نجران", "ينبع", "الجبيل", "الأحساء", "الهفوف", "القطيف", "الباحة", "عرعر", "سكاكا", "القريات", "حفر الباطن", "رابغ", "القنفذة", "الليث", "بيشة", "محايل عسير", "النماص", "بلجرشي", "وادي الدواسر", "الخرج", "الزلفي", "المجمعة", "شقراء", "عفيف"]}, "ae": {"name_ar": "الإمارات", "name_en": "United Arab Emirates", "gl": "ae", "tld": ".ae", "query_word": "الإمارات", "cc": "971", "signals": ["\\+971", "971\\d{8,9}", "الإمارات", "دبي", "أبوظبي", "الشارقة", "درهم", "AED", "\\mUAE\\M", "dubai", "emirates"], "extra_queries": [], "cities": ["دبي", "أبوظبي", "الشارقة", "عجمان", "رأس الخيمة", "العين", "الفجيرة", "أم القيوين"]}, "kw": {"name_ar": "الكويت", "name_en": "Kuwait", "gl": "kw", "tld": ".kw", "query_word": "الكويت", "cc": "965", "signals": ["\\+965", "الكويت", "KWD", "دينار كويتي", "kuwait"], "extra_queries": [], "cities": []}, "qa": {"name_ar": "قطر", "name_en": "Qatar", "gl": "qa", "tld": ".qa", "query_word": "قطر", "cc": "974", "signals": ["\\+974", "قطر", "الدوحة", "QAR", "ريال قطري", "qatar", "doha"], "extra_queries": [], "cities": []}, "bh": {"name_ar": "البحرين", "name_en": "Bahrain", "gl": "bh", "tld": ".bh", "query_word": "البحرين", "cc": "973", "signals": ["\\+973", "البحرين", "المنامة", "BHD", "دينار بحريني", "bahrain"], "extra_queries": [], "cities": []}, "om": {"name_ar": "عُمان", "name_en": "Oman", "gl": "om", "tld": ".om", "query_word": "عمان", "cc": "968", "signals": ["\\+968", "سلطنة عمان", "مسقط", "OMR", "ريال عماني", "oman", "muscat"], "extra_queries": [], "cities": []}}, "features": {"app": true, "dashboard": true, "wordpress": true}, "custom_features": [], "sectors": ["شركة تجارية", "مؤسسة تجارية", "متجر إلكتروني", "سوبرماركت", "مطعم", "كافيه", "مقهى", "فندق", "شقق فندقية", "منتجع", "عيادة", "مستشفى", "مركز طبي", "صيدلية", "مركز تجميل", "صالون", "سبا", "مدرسة", "معهد تدريب", "مركز تعليمي", "أكاديمية", "روضة أطفال", "شركة عقارية", "مكتب عقاري", "شركة مقاولات", "شركة تشييد", "مكتب هندسي", "شركة شحن", "شركة توصيل", "شركة نقل", "تطبيق توصيل", "شركة لوجستيك", "مصنع", "شركة تصنيع", "شركة صناعية", "مكتب محاسبة", "مكتب محاماة", "مكتب استشاري", "شركة تسويق", "وكالة إعلانية", "شركة علاقات عامة", "معرض سيارات", "ورشة سيارات", "شركة إيجار سيارات", "نادي رياضي", "جيم", "مركز ترفيهي", "شركة زراعية", "مزرعة", "شركة أغذية", "شركة تقنية", "شركة اتصالات", "شركة برمجة", "شركة تطوير مواقع", "شركة تطوير تطبيقات", "منصة حجز أونلاين", "خدمات أونلاين", "وكالة سياحة", "وكالة سفر", "شركة رحلات", "موقع خدمي", "موقع تعريفي شركة", "الموقع الرسمي لشركة"], "include_cities": false, "pages_per_query": 2, "serper_per_min": 60, "fetch_per_min": 300, "skip_domains": ["airbnb.com", "amazon.com", "amazon.sa", "apple.com", "bing.com", "booking.com", "extra.com", "facebook.com", "google.com", "google.com.sa", "instagram.com", "jarir.com", "linkedin.com", "microsoft.com", "noon.com", "pinterest.com", "play.google.com", "quora.com", "reddit.com", "snapchat.com", "telegram.me", "telegram.org", "tiktok.com", "tripadvisor.com", "twitter.com", "whatsapp.com", "wikipedia.com", "wikipedia.org", "x.com", "yahoo.com", "youtube.com"], "contact_paths": ["/pages/contact-us", "/contact-us", "/contactus", "/ar/contact-us"], "app_signals": ["apps.apple.com", "play.google.com", "appgallery.huawei.com", "itunes.apple.com", "app store", "google play", "huawei appgallery", "حمل التطبيق", "حمّل التطبيق", "نزل التطبيق", "تطبيقنا على", "download our app", "get it on google play", "available on the app store"], "dashboard_signals": ["لوحة التحكم", "لوحة تحكم العملاء", "بوابة العملاء", "منصة العملاء", "حسابي", "تسجيل الدخول لحسابك", "دخول العملاء", "client portal", "customer portal", "client dashboard", "customer dashboard", "member login", "sign in to your account", "my account"], "wordpress_signals": ["wp-content", "wp-includes", "wp-json", "/wp-admin/", "name=\"generator\" content=\"wordpress"]}$j$::jsonb $f$;
update public.discovery_configs set config = public.discovery_default_config() where name = 'default';

drop function if exists public._disc_phones(text);
drop function if exists public._disc_fmt_phone(text);
create or replace function public._disc_phones(html text, ccs text[] default array['966']) returns text[] language plpgsql immutable as $f$
declare out text[] := '{}'; m text[]; n text; d text; cc text; alt text;
begin
  if html is null then return out; end if;
  html := left(html, 400000);
  alt := array_to_string(coalesce(ccs, array['966']), '|');
  for m in select regexp_matches(html, 'tel:([+\d][\d\s\-()]{6,})', 'gi') loop
    n := regexp_replace(m[1], '[^\d+]', '', 'g'); d := regexp_replace(n, '\D', '', 'g');
    if length(d) >= 8 and not n = any(out) then out := out || n; end if;
  end loop;
  for m in select regexp_matches(html, 'wa\.me/(\d{8,15})', 'gi') loop
    n := regexp_replace(m[1], '[^\d+]', '', 'g'); if not n = any(out) then out := out || n; end if;
  end loop;
  for m in select regexp_matches(html, '((?:\+|00)(?:' || alt || ')[\s\-]?\d{1,2}(?:[\s\-]?\d){6,8})', 'g') loop
    n := regexp_replace(m[1], '[^\d+]', '', 'g'); d := regexp_replace(n, '\D', '', 'g');
    if length(d) between 8 and 13 and not n = any(out) then out := out || n; end if;
  end loop;
  for m in select regexp_matches(html, '((?<!\d)0[1-9](?:[\s\-]?\d){7,8}(?!\d))', 'g') loop
    n := regexp_replace(m[1], '[^\d+]', '', 'g'); d := regexp_replace(n, '\D', '', 'g');
    if length(d) between 9 and 10 and not n = any(out) then out := out || n; end if;
  end loop;
  return out[1:5];
end $f$;

create or replace function public._disc_fmt_phone(p text, cc text default '966') returns text language sql immutable as $f$
  select case when p like '00' || cc || '%' then '+' || cc || substr(p, length(cc) + 3)
              when p like '+%' then p
              when p like cc || '%' and length(p) >= 11 then '+' || p
              when p like '0%' then '+' || cc || substr(p, 2) else p end $f$;

-- أي دولة من المختارة ينتمي لها الموقع؟ (امتداد الدومين، أو علامات داخل الصفحة لدومين .com)
create or replace function public._disc_country(domain text, html text, cfg jsonb) returns text language plpgsql immutable as $f$
declare c text; d jsonb; s text;
begin
  for c in select jsonb_array_elements_text(cfg->'countries') loop
    d := cfg->'country_defs'->c; if d is null then continue; end if;
    if domain like '%' || (d->>'tld') then return c; end if;
  end loop;
  if html is null or html = '' then return null; end if;
  for c in select jsonb_array_elements_text(cfg->'countries') loop
    d := cfg->'country_defs'->c; if d is null then continue; end if;
    for s in select jsonb_array_elements_text(coalesce(d->'signals','[]'::jsonb)) loop
      begin if html ~* s then return c; end if; exception when others then if position(lower(s) in lower(html)) > 0 then return c; end if; end;
    end loop;
  end loop;
  return null;
end $f$;

drop function if exists public._disc_build_queries(jsonb);
create or replace function public._disc_build_queries(cfg jsonb) returns jsonb language plpgsql immutable as $f$
declare out jsonb := '[]'::jsonb; seen text[] := '{}'; c text; d jsonb; s text; city text; q text; word text; tl text; qs text[]; cf jsonb; kw text;
        feats jsonb := coalesce(cfg->'features','{}'::jsonb); cust jsonb := coalesce(cfg->'custom_features','[]'::jsonb);
        a boolean := coalesce((feats->>'app')::boolean,false); b boolean := coalesce((feats->>'dashboard')::boolean,false); w boolean := coalesce((feats->>'wordpress')::boolean,false);
        inc boolean := coalesce((cfg->>'include_cities')::boolean,false);
begin
  for c in select jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) loop
    d := cfg->'country_defs'->c; if d is null then continue; end if;
    word := d->>'query_word'; tl := ltrim(d->>'tld','.');
    for s in select jsonb_array_elements_text(coalesce(cfg->'sectors','[]'::jsonb)) loop
      qs := array['site:' || tl || ' "' || s || '"', s || ' ' || word];
      if a then qs := qs || (s || ' ' || word || ' تطبيق'); end if;
      if b then qs := qs || (s || ' ' || word || ' لوحة تحكم العملاء'); end if;
      if w then qs := qs || ('site:' || tl || ' inurl:wp-content ' || s); end if;
      for cf in select jsonb_array_elements(cust) loop
        kw := cf->'keywords'->>0; if kw is not null and kw <> '' then qs := qs || (s || ' ' || word || ' ' || kw); end if;
      end loop;
      if inc then
        for city in select jsonb_array_elements_text(coalesce(d->'cities','[]'::jsonb)) loop
          qs := qs || (s || ' ' || city || ' ' || word);
          if a then qs := qs || (s || ' ' || city || ' تطبيق جوال'); end if;
        end loop;
      end if;
      foreach q in array qs loop
        if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
      end loop;
    end loop;
    for q in select jsonb_array_elements_text(case when a and b and w then coalesce(d->'extra_queries','[]'::jsonb) else '[]'::jsonb end) loop
      if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
    end loop;
  end loop;
  return out;
end $f$;

create or replace function public.discovery_estimate(p_config jsonb) returns int language plpgsql stable security definer set search_path = public as $f$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  return jsonb_array_length(public._disc_build_queries(p_config)) * greatest(coalesce((p_config->>'pages_per_query')::int, 1), 1);
end $f$;
grant execute on function public.discovery_estimate(jsonb) to authenticated;

create or replace function public.start_discovery_run(p_name text default 'default', p_config jsonb default null) returns uuid language plpgsql security definer set search_path = public as $f$
declare cfg jsonb; rid uuid; qs jsonb; pg int; n int;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if not public.has_discovery_serper_key() then raise exception 'Serper API key is not set'; end if;
  cfg := coalesce(p_config, (select config from public.discovery_configs where name = p_name), public.discovery_default_config());
  if jsonb_array_length(coalesce(cfg->'countries','[]'::jsonb)) = 0 then raise exception 'Choose at least one country'; end if;
  if not (coalesce((cfg->'features'->>'app')::boolean,false) or coalesce((cfg->'features'->>'dashboard')::boolean,false)
          or coalesce((cfg->'features'->>'wordpress')::boolean,false) or jsonb_array_length(coalesce(cfg->'custom_features','[]'::jsonb)) > 0) then
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

create or replace function public.discovery_send() returns int language plpgsql security definer set search_path = public, extensions, net as $f$
declare run record; q record; g record; skey text; cfg jsonb; v bigint; n int := 0; sp int; fp int; gl text;
begin
  select ds.value into skey from public.discovery_settings ds where ds.key = 'serper_key';
  for run in select * from public.discovery_runs where status = 'running' loop
    cfg := run.config; sp := coalesce((cfg->>'serper_per_min')::int, 60); fp := coalesce((cfg->>'fetch_per_min')::int, 300);
    update public.discovery_queries set state = 'pending' where run_id = run.id and state = 'sent' and sent_at < now() - interval '10 minutes';
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
end $f$;
revoke all on function public.discovery_send() from public, anon, authenticated;

create or replace function public.discovery_collect() returns int language plpgsql security definer set search_path = public, extensions, net as $f$
declare run record; cfg jsonb; r record; it jsonb; link text; title text; dom text; nm text; cnt int := 0; ph text[]; feats text[]; html text; path text; base text;
        skip jsonb; req jsonb; cc text; ccnum text; ccs text[]; cf jsonb; allowed boolean; t text; cname text;
begin
  -- 1) نتائج Serper
  for r in select q.run_id, q.idx, q.country_code, p.status_code, p.content, p.error_msg from public.discovery_queries q join net._http_response p on p.id = q.request_id where q.state = 'sent' limit 300 loop
    select * into run from public.discovery_runs where id = r.run_id; cfg := run.config; skip := coalesce(cfg->'skip_domains','[]'::jsonb);
    if r.status_code = 200 and r.content is not null then
      begin
        for it in select jsonb_array_elements(coalesce(r.content::jsonb->'organic','[]'::jsonb)) loop
          link := it->>'link'; title := coalesce(it->>'title','');
          if link is null or link ilike '%google.com%' then continue; end if;
          dom := public._disc_domain(link);
          if dom is null or skip ? dom then continue; end if;
          allowed := dom like '%.com';
          if not allowed then
            for t in select (cfg->'country_defs'->c->>'tld') from jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) c loop
              if t is not null and dom like '%' || t then allowed := true; end if;
            end loop;
          end if;
          if not allowed then continue; end if;
          if exists (select 1 from public.discovery_results x where x.domain = dom) then continue; end if;
          if public._disc_lead_exists(dom, null) then update public.discovery_runs set duplicates = duplicates + 1 where id = run.id; continue; end if;
          nm := btrim(split_part(regexp_replace(title, '[|\-–—»«]', '|', 'g'), '|', 1));
          insert into public.discovery_pages(run_id, domain, name, url, kind, country_code) values (run.id, dom, nullif(nm,''), link, 'home', r.country_code) on conflict do nothing;
        end loop;
      exception when others then update public.discovery_runs set errors = errors + 1, last_error = 'bad serper response' where id = run.id; end;
    elsif r.status_code in (401, 403) then
      update public.discovery_runs set status = 'paused', errors = errors + 1, last_error = 'Serper key rejected (' || r.status_code || ') — تحقق من المفتاح/الرصيد' where id = run.id;
    else
      update public.discovery_runs set errors = errors + 1, last_error = left(coalesce(r.error_msg, 'HTTP ' || coalesce(r.status_code::text,'?')), 200) where id = run.id;
    end if;
    update public.discovery_queries set state = 'done' where run_id = r.run_id and idx = r.idx; cnt := cnt + 1;
  end loop;

  -- 2) صفحات المواقع
  for r in select g.id, g.run_id, g.domain, g.name, g.url, g.kind, g.country_code, p.status_code, p.content from public.discovery_pages g join net._http_response p on p.id = g.request_id where g.state = 'sent' limit 600 loop
    select config into cfg from public.discovery_runs where id = r.run_id; html := case when r.status_code between 200 and 399 then left(coalesce(r.content,''), 400000) end;
    ccs := array(select cfg->'country_defs'->c->>'cc' from jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) c);
    if html is not null then
      if r.kind = 'home' then
        cc := public._disc_country(r.domain, html, cfg);
        if cc is not null then
          feats := '{}';
          if coalesce((cfg->'features'->>'app')::boolean,false) and public._disc_has_any(html, cfg->'app_signals') then feats := feats || 'تطبيق موبايل'::text; end if;
          if coalesce((cfg->'features'->>'dashboard')::boolean,false) and public._disc_has_any(html, cfg->'dashboard_signals') then feats := feats || 'داشبورد/بوابة عملاء'::text; end if;
          if coalesce((cfg->'features'->>'wordpress')::boolean,false) and public._disc_has_any(html, cfg->'wordpress_signals') then feats := feats || 'ووردبريس خدمي'::text; end if;
          for cf in select jsonb_array_elements(coalesce(cfg->'custom_features','[]'::jsonb)) loop
            if public._disc_has_any(html, cf->'keywords') then feats := feats || coalesce(cf->>'label', 'ميزة مخصّصة')::text; end if;
          end loop;
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

-- الإضافة كعملاء: البلد من نتيجة الاكتشاف
create or replace function public.approve_discovery_results(p_ids uuid[] default null, p_data_quality text default 'normal')
returns table(received int, added int, duplicates int) language plpgsql security definer set search_path = public as $f$
declare rows jsonb; n_in int; r record; lid uuid;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'phone', x.phone, 'company', x.name, 'region', coalesce(x.country, 'Saudi Arabia'), 'source', 'Google Search',
          'notes', x.notes, 'website', x.url, 'website_key', x.domain)), '[]'::jsonb), count(*)
    into rows, n_in from public.discovery_results x where x.status = 'new' and (p_ids is null or x.id = any(p_ids));
  if n_in = 0 then return query select 0, 0, 0; return; end if;
  perform * from public.import_leads(rows, false, p_data_quality);
  added := 0; duplicates := 0;
  for r in select * from public.discovery_results x where x.status = 'new' and (p_ids is null or x.id = any(p_ids)) loop
    select l.id into lid from public.leads l where l.website_key = r.domain limit 1;
    if lid is not null then update public.discovery_results set status = 'added', lead_id = lid where id = r.id; added := added + 1;
    else update public.discovery_results set status = 'duplicate' where id = r.id; duplicates := duplicates + 1; end if;
  end loop;
  return query select n_in, added, duplicates;
end $f$;
