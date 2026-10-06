-- 042: اكتشاف عملاء جدد (Lead Discovery) بالـ SQL فقط — يحوّل سكريبت saudi_tech_leads.py إلى جزء داخل النظام.
-- يعتمد على: pg_net + pg_cron + my_role() + import_leads (019) + notifications. شغّل الملف كله مرة واحدة.
create extension if not exists pg_net with schema extensions;

-- ---------- جداول ----------
create table if not exists public.discovery_settings(key text primary key, value text);        -- سرّي (مفتاح Serper) — لا policies
alter table public.discovery_settings enable row level security;

create table if not exists public.discovery_configs(
  id uuid primary key default gen_random_uuid(), name text not null unique, config jsonb not null,
  instructions text, updated_by uuid, updated_at timestamptz default now());
create table if not exists public.discovery_runs(
  id uuid primary key default gen_random_uuid(), config_name text, config jsonb not null,
  status text not null default 'running' check (status in ('running','paused','done','stopped')),
  total_queries int default 0, duplicates int default 0, errors int default 0, last_error text,
  created_by uuid, created_at timestamptz default now(), finished_at timestamptz);
create table if not exists public.discovery_queries(
  run_id uuid references public.discovery_runs(id) on delete cascade, idx int, q text not null, page int not null default 1,
  state text not null default 'pending' check (state in ('pending','sent','done')), request_id bigint, sent_at timestamptz,
  primary key(run_id, idx));
create index if not exists discovery_queries_state on public.discovery_queries(run_id, state);
create table if not exists public.discovery_pages(
  id bigserial primary key, run_id uuid references public.discovery_runs(id) on delete cascade,
  domain text not null, name text, url text not null, kind text not null default 'home',
  state text not null default 'pending' check (state in ('pending','sent')), request_id bigint, sent_at timestamptz,
  unique(run_id, url));
create index if not exists discovery_pages_state on public.discovery_pages(run_id, state);
create table if not exists public.discovery_results(
  id uuid primary key default gen_random_uuid(), run_id uuid, domain text not null unique, name text, url text not null,
  phone text, phones text[] default '{}', features text[] default '{}', notes text,
  status text not null default 'new' check (status in ('new','added','rejected','duplicate')),
  lead_id uuid, found_at timestamptz default now());
create index if not exists discovery_results_status on public.discovery_results(status, found_at desc);

alter table public.discovery_configs enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.discovery_queries enable row level security;
alter table public.discovery_pages enable row level security;
alter table public.discovery_results enable row level security;
do $$ declare t text; begin
  foreach t in array array['discovery_configs','discovery_runs','discovery_queries','discovery_pages','discovery_results'] loop
    execute format('drop policy if exists %I on public.%I', t||'_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.my_role() = ''admin'')', t||'_admin_read', t);
  end loop; end $$;

-- ---------- الإعدادات الافتراضية (مأخوذة من السكريبت) ----------
create or replace function public.discovery_default_config() returns jsonb language sql immutable as $f$
  select $j${"sectors": ["شركة تجارية", "مؤسسة تجارية", "متجر إلكتروني", "سوبرماركت", "مطعم", "كافيه", "مقهى", "فندق", "شقق فندقية", "منتجع", "عيادة", "مستشفى", "مركز طبي", "صيدلية", "مركز تجميل", "صالون", "سبا", "مدرسة", "معهد تدريب", "مركز تعليمي", "أكاديمية", "روضة أطفال", "شركة عقارية", "مكتب عقاري", "شركة مقاولات", "شركة تشييد", "مكتب هندسي", "شركة شحن", "شركة توصيل", "شركة نقل", "تطبيق توصيل", "شركة لوجستيك", "مصنع", "شركة تصنيع", "شركة صناعية", "مكتب محاسبة", "مكتب محاماة", "مكتب استشاري", "شركة تسويق", "وكالة إعلانية", "شركة علاقات عامة", "معرض سيارات", "ورشة سيارات", "شركة إيجار سيارات", "نادي رياضي", "جيم", "مركز ترفيهي", "شركة زراعية", "مزرعة", "شركة أغذية", "شركة تقنية", "شركة اتصالات", "شركة برمجة", "شركة تطوير مواقع", "شركة تطوير تطبيقات", "منصة حجز أونلاين", "خدمات أونلاين", "وكالة سياحة", "وكالة سفر", "شركة رحلات", "موقع خدمي", "موقع تعريفي شركة", "الموقع الرسمي لشركة"], "cities": ["الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "الظهران", "الطائف", "أبها", "خميس مشيط", "تبوك", "حائل", "بريدة", "عنيزة", "الرس", "جازان", "نجران", "ينبع", "الجبيل", "الأحساء", "الهفوف", "القطيف", "الباحة", "عرعر", "سكاكا", "القريات", "حفر الباطن", "رابغ", "القنفذة", "الليث", "بيشة", "محايل عسير", "النماص", "بلجرشي", "وادي الدواسر", "الخرج", "الزلفي", "المجمعة", "شقراء", "عفيف"], "sector_templates": ["site:sa \"{sector}\"", "{sector} السعودية", "{sector} السعودية تطبيق", "{sector} السعودية لوحة تحكم العملاء", "site:sa inurl:wp-content {sector}"], "city_templates": ["{sector} {city} السعودية", "{sector} {city} تطبيق جوال"], "extra_queries": ["site:sa تطبيقنا على app store", "site:sa تطبيقنا على google play", "شركات سعودية لها تطبيق جوال", "site:sa \"powered by wordpress\"", "site:sa بوابة العملاء", "site:sa لوحة تحكم العملاء", "startups Saudi Arabia mobile app", "SME Saudi Arabia dashboard"], "pages_per_query": 2, "serper_per_min": 60, "fetch_per_min": 300, "allowed_tlds": [".sa", ".com"], "skip_domains": ["airbnb.com", "amazon.com", "amazon.sa", "apple.com", "bing.com", "booking.com", "extra.com", "facebook.com", "google.com", "google.com.sa", "instagram.com", "jarir.com", "linkedin.com", "microsoft.com", "noon.com", "pinterest.com", "play.google.com", "quora.com", "reddit.com", "snapchat.com", "telegram.me", "telegram.org", "tiktok.com", "tripadvisor.com", "twitter.com", "whatsapp.com", "wikipedia.com", "wikipedia.org", "x.com", "yahoo.com", "youtube.com"], "contact_paths": ["/pages/contact-us", "/contact-us", "/contactus", "/ar/contact-us"], "require_any": ["app", "dashboard", "wordpress"], "saudi_signals": ["\\+966", "966\\d{9}", "05\\d{8}", "المملكة العربية السعودية", "السعودية", "الرياض", "جدة", "مكة", "الدمام", "الخبر", "ريال سعودي", "SAR", "ر.س", "salla", "zid.sa", ".com.sa", "ksa", "saudi"], "app_signals": ["apps.apple.com", "play.google.com", "appgallery.huawei.com", "itunes.apple.com", "app store", "google play", "huawei appgallery", "حمل التطبيق", "حمّل التطبيق", "نزل التطبيق", "تطبيقنا على", "download our app", "get it on google play", "available on the app store"], "dashboard_signals": ["لوحة التحكم", "لوحة تحكم العملاء", "بوابة العملاء", "منصة العملاء", "حسابي", "تسجيل الدخول لحسابك", "دخول العملاء", "client portal", "customer portal", "client dashboard", "customer dashboard", "member login", "sign in to your account", "my account"], "wordpress_signals": ["wp-content", "wp-includes", "wp-json", "/wp-admin/", "name=\"generator\" content=\"wordpress"]}$j$::jsonb $f$;

insert into public.discovery_configs(name, config) values ('default', public.discovery_default_config())
on conflict (name) do nothing;

-- ---------- أدوات مساعدة ----------
create or replace function public._disc_domain(u text) returns text language sql immutable as $f$
  select nullif(lower(regexp_replace(regexp_replace(coalesce(u,''), '^[a-z]+://', '', 'i'), '^www\.|[/:?#].*$', '', 'gi')), '') $f$;

create or replace function public._disc_has_any(html text, sigs jsonb) returns boolean language sql immutable as $f$
  select exists (select 1 from jsonb_array_elements_text(coalesce(sigs,'[]'::jsonb)) s where position(lower(s) in lower(html)) > 0) $f$;

create or replace function public._disc_is_saudi(domain text, html text, sigs jsonb) returns boolean language plpgsql immutable as $f$
declare s text;
begin
  if domain like '%.sa' then return true; end if;
  if domain like '%.com' then
    if html is null or html = '' then return false; end if;
    for s in select jsonb_array_elements_text(coalesce(sigs,'[]'::jsonb)) loop
      begin if html ~* s then return true; end if; exception when others then if position(lower(s) in lower(html)) > 0 then return true; end if; end;
    end loop;
  end if;
  return false;
end $f$;

create or replace function public._disc_phones(html text) returns text[] language plpgsql immutable as $f$
declare out text[] := '{}'; m text[]; n text; d text; pats text[] := array[
  '(?:\+?966|00966)[\s\-]?5\d(?:[\s\-]?\d){7}',
  '(?:\+?966|00966)[\s\-]?\d{1,2}(?:[\s\-]?\d){6,7}',
  '(?<!\d)05\d(?:[\s\-]?\d){7}(?!\d)',
  '(?<!\d)01[1-9](?:[\s\-]?\d){6}(?!\d)']; p text;
begin
  if html is null then return out; end if;
  html := left(html, 400000);
  for m in select regexp_matches(html, 'tel:([+\d][\d\s\-()]{6,})', 'gi') loop
    n := regexp_replace(m[1], '[^\d+]', '', 'g'); d := regexp_replace(n, '\D', '', 'g');
    if length(d) >= 8 and not n = any(out) then out := out || n; end if;
  end loop;
  for m in select regexp_matches(html, 'wa\.me/(\d{8,15})', 'gi') loop
    n := regexp_replace(m[1], '[^\d+]', '', 'g'); if not n = any(out) then out := out || n; end if;
  end loop;
  foreach p in array pats loop
    for m in select regexp_matches(html, '(' || p || ')', 'g') loop
      n := regexp_replace(m[1], '[^\d+]', '', 'g'); d := regexp_replace(n, '\D', '', 'g');
      if length(d) between 8 and 13 and not n = any(out) then out := out || n; end if;
    end loop;
  end loop;
  return out[1:5];
end $f$;

create or replace function public._disc_fmt_phone(p text) returns text language sql immutable as $f$
  select case when p like '00966%' then '+966' || substr(p, 6)
              when p like '966%' then '+966' || substr(p, 4)
              when p like '05%' then '+966' || substr(p, 2) else p end $f$;

create or replace function public._disc_lead_exists(p_domain text, p_phone text) returns boolean language plpgsql stable security definer set search_path = public as $f$
begin
  if p_domain is not null and exists (select 1 from public.leads l where l.website_key = p_domain) then return true; end if;
  if p_domain is not null and exists (select 1 from public.leads l where l.website is not null and lower(l.website) ~ ('(^|[/.])' || regexp_replace(p_domain, '([.])', '\\\1', 'g') || '([/:?#]|$)')) then return true; end if;
  if p_phone is not null and public.phone_key(p_phone) is not null
     and exists (select 1 from public.leads l where l.phone_key = public.phone_key(p_phone)) then return true; end if;
  return false;
end $f$;

create or replace function public._disc_build_queries(cfg jsonb) returns text[] language plpgsql immutable as $f$
declare out text[] := '{}'; s text; c text; t text;
begin
  for s in select jsonb_array_elements_text(cfg->'sectors') loop
    for t in select jsonb_array_elements_text(cfg->'sector_templates') loop out := out || replace(t, '{sector}', s); end loop;
  end loop;
  for s in select jsonb_array_elements_text(cfg->'sectors') loop
    for c in select jsonb_array_elements_text(cfg->'cities') loop
      for t in select jsonb_array_elements_text(cfg->'city_templates') loop out := out || replace(replace(t, '{sector}', s), '{city}', c); end loop;
    end loop;
  end loop;
  for t in select jsonb_array_elements_text(coalesce(cfg->'extra_queries','[]'::jsonb)) loop out := out || t; end loop;
  return (select coalesce(array_agg(x order by o), '{}') from (select x, min(o) o from unnest(out) with ordinality u(x,o) group by x) z);
end $f$;

-- ---------- واجهة الأدمن ----------
create or replace function public.set_discovery_serper_key(p_key text) returns void language plpgsql security definer set search_path = public as $f$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  insert into public.discovery_settings(key, value) values ('serper_key', btrim(p_key)) on conflict (key) do update set value = excluded.value;
end $f$;
create or replace function public.has_discovery_serper_key() returns boolean language sql stable security definer set search_path = public as $f$
  select public.my_role() = 'admin' and exists (select 1 from public.discovery_settings where key = 'serper_key' and coalesce(value,'') <> '') $f$;

create or replace function public.get_discovery_config(p_name text default 'default') returns jsonb language plpgsql stable security definer set search_path = public as $f$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  return coalesce((select config from public.discovery_configs where name = p_name), public.discovery_default_config());
end $f$;

create or replace function public.save_discovery_config(p_config jsonb, p_name text default 'default', p_instructions text default null) returns void language plpgsql security definer set search_path = public as $f$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if jsonb_typeof(p_config->'sectors') <> 'array' then raise exception 'config.sectors must be an array'; end if;
  insert into public.discovery_configs(name, config, instructions, updated_by, updated_at) values (p_name, p_config, p_instructions, auth.uid(), now())
  on conflict (name) do update set config = excluded.config, instructions = coalesce(excluded.instructions, public.discovery_configs.instructions), updated_by = auth.uid(), updated_at = now();
end $f$;

create or replace function public.start_discovery_run(p_name text default 'default', p_config jsonb default null) returns uuid language plpgsql security definer set search_path = public as $f$
declare cfg jsonb; rid uuid; qs text[]; pg int;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if not public.has_discovery_serper_key() then raise exception 'Serper API key is not set'; end if;
  cfg := coalesce(p_config, (select config from public.discovery_configs where name = p_name), public.discovery_default_config());
  qs := public._disc_build_queries(cfg); pg := greatest(coalesce((cfg->>'pages_per_query')::int, 1), 1);
  insert into public.discovery_runs(config_name, config, status, total_queries, created_by) values (p_name, cfg, 'running', coalesce(array_length(qs,1),0) * pg, auth.uid()) returning id into rid;
  insert into public.discovery_queries(run_id, idx, q, page)
    select rid, (u.o - 1) * pg + g, u.x, g from unnest(qs) with ordinality u(x, o), generate_series(1, pg) g;
  return rid;
end $f$;

create or replace function public.set_discovery_run_state(p_run uuid, p_state text) returns void language plpgsql security definer set search_path = public as $f$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if p_state not in ('running','paused','stopped') then raise exception 'invalid state'; end if;
  update public.discovery_runs set status = p_state, finished_at = case when p_state = 'stopped' then now() end where id = p_run and status in ('running','paused');
  if p_state = 'stopped' then delete from public.discovery_pages where run_id = p_run; update public.discovery_queries set state = 'done' where run_id = p_run and state <> 'done'; end if;
end $f$;

create or replace function public.discovery_progress(p_run uuid default null) returns table(
  run_id uuid, status text, total_queries int, done_queries bigint, pending_pages bigint, found bigint, new_results bigint, duplicates int, errors int, last_error text, created_at timestamptz, finished_at timestamptz)
language sql stable security definer set search_path = public as $f$
  select r.id, r.status, r.total_queries, (select count(*) from public.discovery_queries q where q.run_id = r.id and q.state = 'done'),
         (select count(*) from public.discovery_pages g where g.run_id = r.id),
         (select count(*) from public.discovery_results x where x.run_id = r.id),
         (select count(*) from public.discovery_results x where x.run_id = r.id and x.status = 'new'),
         r.duplicates, r.errors, r.last_error, r.created_at, r.finished_at
  from public.discovery_runs r
  where public.my_role() = 'admin' and r.id = coalesce(p_run, (select id from public.discovery_runs order by created_at desc limit 1)) $f$;

-- قبول / رفض النتائج. القبول يمر على import_leads فيتخطى أي مكرر (موقع أو موبايل)
create or replace function public.approve_discovery_results(p_ids uuid[] default null, p_data_quality text default 'normal')
returns table(received int, added int, duplicates int) language plpgsql security definer set search_path = public as $f$
declare rows jsonb; n_in int; r record; lid uuid;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'phone', x.phone, 'company', x.name, 'region', 'Saudi Arabia', 'source', 'Google Search',
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

create or replace function public.reject_discovery_results(p_ids uuid[]) returns int language plpgsql security definer set search_path = public as $f$
declare n int;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  update public.discovery_results set status = 'rejected' where id = any(p_ids) and status = 'new';
  get diagnostics n = row_count; return n;
end $f$;

-- ---------- المحرّك (يُستدعى من cron كل دقيقة) ----------
create or replace function public.discovery_send() returns int language plpgsql security definer set search_path = public, extensions, net as $f$
declare run record; q record; g record; skey text; cfg jsonb; v bigint; n int := 0; sp int; fp int;
begin
  select ds.value into skey from public.discovery_settings ds where ds.key = 'serper_key';
  for run in select * from public.discovery_runs where status = 'running' loop
    cfg := run.config; sp := coalesce((cfg->>'serper_per_min')::int, 60); fp := coalesce((cfg->>'fetch_per_min')::int, 300);
    update public.discovery_queries set state = 'pending' where run_id = run.id and state = 'sent' and sent_at < now() - interval '10 minutes';
    delete from public.discovery_pages where run_id = run.id and state = 'sent' and sent_at < now() - interval '10 minutes';
    if skey is not null then
      for q in select * from public.discovery_queries where run_id = run.id and state = 'pending' order by idx limit sp for update skip locked loop
        begin
          select net.http_post(url := 'https://google.serper.dev/search',
                 body := jsonb_build_object('q', q.q, 'gl', 'sa', 'hl', 'ar', 'num', 100, 'page', q.page),
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

create or replace function public.discovery_collect() returns int language plpgsql security definer set search_path = public, extensions, net as $f$
declare run record; cfg jsonb; r record; it jsonb; link text; title text; dom text; nm text; cnt int := 0; ph text[]; ok boolean; feats text[]; html text; fph text[]; p text; path text; base text; skip jsonb; tlds jsonb; req jsonb;
begin
  -- 1) نتائج Serper
  for r in select q.run_id, q.idx, p.status_code, p.content, p.error_msg from public.discovery_queries q join net._http_response p on p.id = q.request_id where q.state = 'sent' limit 300 loop
    select * into run from public.discovery_runs where id = r.run_id; cfg := run.config; skip := coalesce(cfg->'skip_domains','[]'::jsonb); tlds := coalesce(cfg->'allowed_tlds','[".sa",".com"]'::jsonb);
    if r.status_code = 200 and r.content is not null then
      begin
        for it in select jsonb_array_elements(coalesce(r.content::jsonb->'organic','[]'::jsonb)) loop
          link := it->>'link'; title := coalesce(it->>'title','');
          if link is null or link ilike '%google.com%' then continue; end if;
          dom := public._disc_domain(link);
          if dom is null or skip ? dom then continue; end if;
          if not exists (select 1 from jsonb_array_elements_text(tlds) t where dom like '%' || t) then continue; end if;
          if exists (select 1 from public.discovery_results x where x.domain = dom) then continue; end if;
          if public._disc_lead_exists(dom, null) then update public.discovery_runs set duplicates = duplicates + 1 where id = run.id; continue; end if;
          nm := btrim(split_part(regexp_replace(title, '[|\-–—»«]', '|', 'g'), '|', 1));
          insert into public.discovery_pages(run_id, domain, name, url, kind) values (run.id, dom, nullif(nm,''), link, 'home') on conflict do nothing;
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
  for r in select g.id, g.run_id, g.domain, g.name, g.url, g.kind, g.request_id, p.status_code, p.content from public.discovery_pages g join net._http_response p on p.id = g.request_id where g.state = 'sent' limit 600 loop
    select config into cfg from public.discovery_runs where id = r.run_id; html := case when r.status_code between 200 and 399 then left(coalesce(r.content,''), 400000) end;
    if html is not null then
      if r.kind = 'home' then
        if public._disc_is_saudi(r.domain, html, cfg->'saudi_signals') then
          feats := '{}'; req := coalesce(cfg->'require_any','["app","dashboard","wordpress"]'::jsonb);
          if req ? 'app' and public._disc_has_any(html, cfg->'app_signals') then feats := feats || 'تطبيق موبايل'::text; end if;
          if req ? 'dashboard' and public._disc_has_any(html, cfg->'dashboard_signals') then feats := feats || 'داشبورد/بوابة عملاء'::text; end if;
          if req ? 'wordpress' and public._disc_has_any(html, cfg->'wordpress_signals') then feats := feats || 'ووردبريس خدمي'::text; end if;
          if coalesce(array_length(feats,1),0) > 0 then
            ph := array(select public._disc_fmt_phone(x) from unnest(public._disc_phones(html)) x);
            if public._disc_lead_exists(r.domain, ph[1]) then
              update public.discovery_runs set duplicates = duplicates + 1 where id = r.run_id;
            else
              insert into public.discovery_results(run_id, domain, name, url, phone, phones, features, notes)
              values (r.run_id, r.domain, coalesce(r.name, r.domain), r.url, ph[1], coalesce(ph, '{}'), feats,
                      'مطابق: ' || array_to_string(feats, ', ') || case when coalesce(array_length(ph,1),0) > 1 then ' | أرقام إضافية: ' || array_to_string(ph[2:], ' / ') else '' end)
              on conflict (domain) do nothing;
              if ph[1] is null then
                for path in select jsonb_array_elements_text(coalesce(cfg->'contact_paths','[]'::jsonb)) loop
                  base := regexp_replace(r.url, '^(https?://[^/]+).*$', '\1');
                  insert into public.discovery_pages(run_id, domain, name, url, kind) values (r.run_id, r.domain, r.name, base || path, 'contact') on conflict do nothing;
                end loop;
              end if;
            end if;
          end if;
        end if;
      else   -- contact
        ph := array(select public._disc_fmt_phone(x) from unnest(public._disc_phones(html)) x);
        if coalesce(array_length(ph,1),0) > 0 and not public._disc_lead_exists(null, ph[1]) then
          update public.discovery_results set phone = ph[1], phones = ph where domain = r.domain and phone is null and status = 'new';
        end if;
      end if;
    end if;
    delete from public.discovery_pages where id = r.id; cnt := cnt + 1;
  end loop;
  begin delete from net._http_response where id in (select request_id from public.discovery_queries where state = 'done' and request_id is not null and sent_at > now() - interval '1 day'); exception when others then null; end;

  -- 3) انتهاء الرنّات
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

revoke all on function public.discovery_send(), public.discovery_collect(), public._disc_lead_exists(text,text) from public, anon, authenticated;
grant execute on function public.set_discovery_serper_key(text), public.has_discovery_serper_key(), public.get_discovery_config(text),
  public.save_discovery_config(jsonb,text,text), public.start_discovery_run(text,jsonb), public.set_discovery_run_state(uuid,text),
  public.discovery_progress(uuid), public.approve_discovery_results(uuid[],text), public.reject_discovery_results(uuid[]) to authenticated;

-- ===== التفعيل (مرة واحدة) =====
-- select cron.schedule('discovery-send',    '* * * * *', $$select public.discovery_send()$$);
-- select cron.schedule('discovery-collect', '* * * * *', $$select public.discovery_collect()$$);
