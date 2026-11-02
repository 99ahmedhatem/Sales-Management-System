-- =====================================================================
-- RUN_PENDING — الـ migrations اللي لسه ما اتشغّلتش في Supabase، بالترتيب.
-- حالياً: 032_auto_distribution (لو لسه) · 056_custom_deal_meeting_snapshot · 059_fix_admin_closer_and_booked_by_id · 064_discovery_notes_and_tags · 066_fill_missing_phones_skip_duplicates. من 004 لحد 028 و 030 اتشغّلوا (030 بيغطي 029، فـ 029 ما يتشغّلش).
-- أي migration جديد يتحط هنا فوق استعلام التحقق، وبعد ما يتشغّل يتشال.
-- ⚠ 067_one_client_per_website مش محطوط هنا عن قصد: بيدمج ويمسح عملاء مكررين. شغّله لوحده من ملفه: PART 1 (معاينة) → backup → PART 2.
-- ⚠ 068_websites_open_home_page كمان مش محطوط هنا: بيغيّر روابط العملاء. شغّله لوحده بعد 067 من ملفه: PART 1 (معاينة) → PART 2. وبعده اعمل deploy لـ check-websites.
-- =====================================================================

-- =====================================================================
-- 032_auto_distribution.sql
-- =====================================================================
-- 032: توزيع تلقائي للـ Leads الجديدة + تشغيل يومي للتذكيرات
-- الفكرة: الأدمن يحدد تيليسيلز مشاركين وسقف للـ Leads المفتوحة لكل واحد؛ كل Lead جديد غير موزّع
-- يروح لأقل واحد حمل (عدد الـ Leads المفتوحة). يتشغّل يدوياً (زر) أو تلقائياً كل ساعة/يوم (pg_cron).
-- يعتمد على: my_role() · app_settings (008) · notify_due_followups / notify_upcoming_renewals (009)

-- ---------- 1) إعدادات (يحفظها الأدمن بس) ----------
create or replace function public.set_auto_distribution(
  p_enabled boolean, p_user_ids uuid[], p_max_open int default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can change auto-distribution'; end if;
  if p_enabled and coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'Choose at least one telesales user';
  end if;
  if exists (select 1 from unnest(coalesce(p_user_ids, '{}')) x
             where not exists (select 1 from public.users u where u.id = x and u.role = 'telesales' and u.status = 'active')) then
    raise exception 'The list contains a user who is not an active telesales';
  end if;
  if p_max_open is not null and p_max_open < 1 then raise exception 'Max open leads must be at least 1'; end if;

  insert into public.app_settings (key, value) values
    ('auto_distribute_enabled', case when p_enabled then 'true' else 'false' end),
    ('auto_distribute_users', coalesce(array_to_string(p_user_ids, ','), '')),
    ('auto_distribute_max_open', coalesce(p_max_open::text, ''))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'saved';
end $$;

create or replace function public.get_auto_distribution()
returns table (enabled boolean, user_ids uuid[], max_open int, waiting bigint)
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'auto_distribute_enabled'), 'false') = 'true',
         coalesce((select string_to_array(nullif(value, ''), ',')::uuid[] from public.app_settings where key = 'auto_distribute_users'), '{}'::uuid[]),
         (select nullif(value, '')::int from public.app_settings where key = 'auto_distribute_max_open'),
         (select count(*) from public.leads where assigned_to is null)
  where public.my_role() = 'admin'
$$;

-- ---------- 2) التشغيل ----------
create or replace function public.run_auto_distribution(p_limit int default 5000)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; n int; i int; best int;
  v_loads int[]; v_max int;
  v_lead uuid; v_pick_ids uuid[] := '{}'; v_pick_uids uuid[] := '{}';
  v_done int;
begin
  -- يشتغل من cron (auth.uid() null) أو من الأدمن فقط
  if auth.uid() is not null and public.my_role() <> 'admin' then
    raise exception 'Only admin can run auto-distribution';
  end if;
  if coalesce((select value from public.app_settings where key = 'auto_distribute_enabled'), 'false') <> 'true' then
    return 0;
  end if;

  select coalesce(array_agg(u.id order by u.id), '{}') into v_ids
  from public.users u
  where u.role = 'telesales' and u.status = 'active'
    and u.id = any (coalesce((select string_to_array(nullif(value, ''), ',')::uuid[]
                              from public.app_settings where key = 'auto_distribute_users'), '{}'::uuid[]));
  n := coalesce(array_length(v_ids, 1), 0);
  if n = 0 then return 0; end if;
  v_max := (select nullif(value, '')::int from public.app_settings where key = 'auto_distribute_max_open');

  select array_agg((select count(*)::int from public.leads l
                    where l.assigned_to = t.x
                      and l.status not in ('Subscribed','Converted','Did Not Subscribe','Not Interested')) order by t.ord)
    into v_loads from unnest(v_ids) with ordinality as t(x, ord);

  for v_lead in
    select l.id from public.leads l
    where l.assigned_to is null and l.status = 'New'
    order by l.id limit greatest(p_limit, 0)
  loop
    best := null;
    for i in 1..n loop
      if (v_max is null or v_loads[i] < v_max) and (best is null or v_loads[i] < v_loads[best]) then best := i; end if;
    end loop;
    exit when best is null;                      -- الكل وصل للسقف
    v_pick_ids  := v_pick_ids  || v_lead;
    v_pick_uids := v_pick_uids || v_ids[best];
    v_loads[best] := v_loads[best] + 1;
  end loop;

  if coalesce(array_length(v_pick_ids, 1), 0) = 0 then return 0; end if;

  create temp table _auto_done on commit drop as
  with u as (
    update public.leads l
       set assigned_to = p.uid, status = 'Assigned', updated_at = now()
      from unnest(v_pick_ids, v_pick_uids) as p(id, uid)
     where l.id = p.id and l.assigned_to is null
    returning l.id, p.uid
  ) select id, uid from u;

  insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
  -- actor_id إجباري (FK على auth.users): الأدمن لو شغّلها يدوياً، وإلا الموظف المستلم (تشغيل cron)
  select d.id, coalesce(auth.uid(), d.uid), 'System', 'system', 'assignment', 'Assigned', 'Auto distribution' from _auto_done d;

  insert into public.notifications (user_id, type, title, message)
  select d.uid, 'assignment', 'عملاء جدد', 'تم توزيع ' || count(*) || ' عميل عليك تلقائياً'
  from _auto_done d group by d.uid;

  select count(*) into v_done from _auto_done;
  return v_done;
end $$;

-- ---------- 3) مهمة يومية واحدة تجمع كل حاجة ----------
create or replace function public.run_daily_jobs()
returns table (job text, affected int)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.my_role() <> 'admin' then raise exception 'Only admin'; end if;
  job := 'auto_distribution';      affected := public.run_auto_distribution();  return next;
  job := 'followup_reminders';     affected := public.notify_due_followups();   return next;
  job := 'renewal_reminders';      affected := public.notify_upcoming_renewals(); return next;
end $$;

revoke all on function public.set_auto_distribution(boolean, uuid[], int) from public, anon;
revoke all on function public.get_auto_distribution() from public, anon;
revoke all on function public.run_auto_distribution(int) from public, anon;
revoke all on function public.run_daily_jobs() from public, anon;
grant execute on function public.set_auto_distribution(boolean, uuid[], int) to authenticated;
grant execute on function public.get_auto_distribution() to authenticated;
grant execute on function public.run_auto_distribution(int) to authenticated;
grant execute on function public.run_daily_jobs() to authenticated;

-- ---------- 4) جدولة تلقائية (اختياري): فعّل pg_cron من Database → Extensions ثم شغّل السطرين ----------
-- select cron.schedule('daily-jobs',   '0 5 * * *', $$select * from public.run_daily_jobs()$$);          -- كل يوم 8 ص بتوقيت القاهرة
-- select cron.schedule('auto-distribute', '*/15 * * * *', $$select public.run_auto_distribution()$$);     -- كل 15 دقيقة

-- =====================================================================
-- 056_custom_deal_meeting_snapshot.sql
-- =====================================================================
-- 056: (1) نسخة من بيانات العميل على الاجتماع وطلب الاجتماع · (2) صفقة بخدمة مخصصة (من غير باقة)
--
-- (1) السيلز ممنوع (RLS) يقرأ leads لأن العميل متعيّن للتيلي سيلز، فكارت الاجتماع كان بيكتب "Unknown lead".
--     الحل: meetings و meeting_requests بيشيلوا نسخة: lead_name, lead_phone, client_code, lead_website.
--     · trigger قبل الإضافة بيملاها من leads.
--     · trigger على leads بيحدّثها لما الاسم/الرقم/الكود/الموقع يتغيّر.
--     · تعبئة للصفوف القديمة.
-- (2) deals.package_id بقى nullable، ودالة create_custom_deal(...) لصفقة بخدمة مش ضمن الباقات.
--     package_name = اسم الخدمة · list_price_sar = سعر الإغلاق · min_price_sar = 0 · below_min_price = false.
--
-- آمن لو اتشغّل أكتر من مرة (if not exists / create or replace).

-- ---------- 1) أعمدة النسخة ----------
alter table public.meetings
  add column if not exists lead_name text,
  add column if not exists lead_phone text,
  add column if not exists client_code text,
  add column if not exists lead_website text;

alter table public.meeting_requests
  add column if not exists lead_name text,
  add column if not exists lead_phone text,
  add column if not exists client_code text,
  add column if not exists lead_website text;

-- ---------- 2) تعبئة عند الإضافة ----------
create or replace function public.trg_fill_lead_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id then
    select le.name, le.phone, le.client_code, le.website into l
    from public.leads le where le.id = new.lead_id;
    if found then
      new.lead_name := l.name;
      new.lead_phone := l.phone;
      new.client_code := l.client_code;
      new.lead_website := l.website;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists meetings_lead_snapshot on public.meetings;
create trigger meetings_lead_snapshot before insert or update of lead_id on public.meetings
  for each row execute function public.trg_fill_lead_snapshot();

drop trigger if exists meeting_requests_lead_snapshot on public.meeting_requests;
create trigger meeting_requests_lead_snapshot before insert or update of lead_id on public.meeting_requests
  for each row execute function public.trg_fill_lead_snapshot();

-- ---------- 3) تحديث النسخة لما بيانات العميل تتغيّر ----------
create or replace function public.trg_sync_lead_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.meetings
     set lead_name = new.name, lead_phone = new.phone, client_code = new.client_code, lead_website = new.website
   where lead_id = new.id;
  update public.meeting_requests
     set lead_name = new.name, lead_phone = new.phone, client_code = new.client_code, lead_website = new.website
   where lead_id = new.id;
  return null;
end;
$$;

drop trigger if exists leads_sync_meeting_snapshot on public.leads;
create trigger leads_sync_meeting_snapshot after update of name, phone, client_code, website on public.leads
  for each row
  when (old.name is distinct from new.name
     or old.phone is distinct from new.phone
     or old.client_code is distinct from new.client_code
     or old.website is distinct from new.website)
  execute function public.trg_sync_lead_snapshot();

-- ---------- 4) تعبئة الصفوف القديمة (من غير ما نملا audit_log) ----------
alter table public.meetings disable trigger user;
update public.meetings m
   set lead_name = l.name, lead_phone = l.phone, client_code = l.client_code, lead_website = l.website
  from public.leads l
 where l.id = m.lead_id;
alter table public.meetings enable trigger user;

alter table public.meeting_requests disable trigger user;
update public.meeting_requests r
   set lead_name = l.name, lead_phone = l.phone, client_code = l.client_code, lead_website = l.website
  from public.leads l
 where l.id = r.lead_id;
alter table public.meeting_requests enable trigger user;

-- ---------- 5) صفقة بخدمة مخصصة ----------
alter table public.deals alter column package_id drop not null;

create or replace function public.create_custom_deal(
  target_lead_id uuid,
  custom_service_name text,
  custom_duration_months integer,
  target_price_sar numeric,
  target_start_date date,
  deal_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_status text;
  lead_owner uuid;
  service_name text := nullif(trim(custom_service_name), '');
  created_deal_id uuid;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u where u.id = auth.uid();

  if caller_role is null
    or caller_role not in ('sales', 'telesales', 'manager')
    or caller_status is distinct from 'active'
  then
    raise exception 'Only active sales, telesales or manager users can create deals';
  end if;
  if service_name is null then
    raise exception 'Enter the service name';
  end if;
  if length(service_name) > 200 then
    raise exception 'Service name is too long (max 200 characters)';
  end if;
  if custom_duration_months is null or custom_duration_months < 1 or custom_duration_months > 120 then
    raise exception 'Enter a duration between 1 and 120 months';
  end if;
  if target_price_sar is null or target_price_sar < 0 then
    raise exception 'Enter a valid closing price in SAR';
  end if;
  if target_start_date is null then
    raise exception 'Choose a deal start date';
  end if;

  select l.assigned_to into lead_owner
  from public.leads l where l.id = target_lead_id
  for share;
  if not found or lead_owner is null then
    raise exception 'Lead not found or not assigned to telesales';
  end if;

  -- نفس صلاحيات create_deal: التيلي سيلز = العميل بتاعه · السيلز = له اجتماع على العميل · المدير = عميل فريقه
  if caller_role = 'telesales' then
    if lead_owner is distinct from auth.uid() then
      raise exception 'You can only close deals for leads assigned to you';
    end if;
  elsif caller_role = 'sales' then
    if not exists (
      select 1 from public.meetings m
      where m.lead_id = target_lead_id and m.assigned_sales_id = auth.uid()
    ) then
      raise exception 'You can only close a deal for a lead assigned to you through a meeting';
    end if;
  else
    if lead_owner is distinct from auth.uid() and not exists (
      select 1 from public.users u where u.id = lead_owner and u.manager_id = auth.uid()
    ) then
      raise exception 'You can only close deals for leads of your team';
    end if;
  end if;

  insert into public.deals (
    lead_id, package_id, sales_user_id, telesales_user_id, closed_by_user_id,
    package_name, package_duration_months, list_price_sar, min_price_sar,
    price_sar, below_min_price, start_date, end_date, notes
  )
  values (
    target_lead_id, null,
    case when caller_role = 'sales' then auth.uid() else null end,
    lead_owner, auth.uid(),
    service_name, custom_duration_months, target_price_sar, 0,
    target_price_sar, false,
    target_start_date,
    (target_start_date + make_interval(months => custom_duration_months) - interval '1 day')::date,
    nullif(trim(deal_notes), '')
  )
  returning id into created_deal_id;

  return created_deal_id;
end;
$$;

revoke all on function public.create_custom_deal(uuid, text, integer, numeric, date, text) from public, anon;
grant execute on function public.create_custom_deal(uuid, text, integer, numeric, date, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- 059_fix_admin_closer_and_booked_by_id.sql
-- =====================================================================
-- 059: fixes for 058 (pasted as "061"). Safe to run more than once.
--
-- 1) snapshot_deal_commissions (058) writes role_in_deal = 'closer_admin' when an admin closed the deal,
--    but 055's check only allows closer_sales / closer_telesales / closer_manager / lead_telesales / manager.
--    The insert runs inside the approve trigger, so approve_deal failed for every deal an admin closed.
-- 2) accept_meeting_request (058) inserts meetings.booked_by_id, a column no migration creates.
--    Without it every "Accept & Schedule" fails with "column booked_by_id does not exist".
--    Adding it (same value as booked_by) works whether or not the live table already has it.

-- ---------- 1) allow closer_admin ----------
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.deal_commissions'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role_in_deal%'
  loop
    execute format('alter table public.deal_commissions drop constraint %I', c);
  end loop;
end $$;
alter table public.deal_commissions add constraint deal_commissions_role_in_deal_check
  check (role_in_deal in ('closer_sales','closer_telesales','closer_manager','closer_admin','lead_telesales','manager'));

-- ---------- 2) meetings.booked_by_id ----------
alter table public.meetings add column if not exists booked_by_id uuid references public.users(id);
alter table public.meetings disable trigger user;  -- no audit_log row per meeting for the backfill
update public.meetings set booked_by_id = booked_by where booked_by_id is null;
alter table public.meetings enable trigger user;

notify pgrst, 'reload schema';

-- =====================================================================
-- 064_discovery_notes_and_tags.sql
-- =====================================================================
-- 064: Lead discovery — search notes + tags (علامات)
--
-- 1) Search note (ملاحظة للبحث). The page turns the note into three config keys before saving / starting:
--      extra_searches : text[]  — each normal line = one more search on its own (+ the country word)
--      add_terms      : text[]  — lines starting with "+" = added to the end of EVERY search
--      exclude_words  : text[]  — lines starting with "-" = results whose name / domain / link contain the word are skipped
--    The raw note is also kept as config.search_note and in discovery_configs.instructions.
-- 2) Tags:
--      config.run_tag (optional) = every result found by that run gets this tag automatically.
--      discovery_results.tag      = can be set / changed for selected results from the page.
--      leads.tag                  = copied from the result when it is added as a client, shown and filterable on Clients.
--
-- Safe to run more than once. discovery_collect / discovery_send are NOT changed: the note and tag are applied
-- by _disc_build_queries and by insert triggers.

set lock_timeout = '10s';

-- ---------- columns ----------
alter table public.discovery_results add column if not exists tag text;
alter table public.leads add column if not exists tag text;
create index if not exists discovery_results_tag_idx on public.discovery_results(tag) where tag is not null;
create index if not exists leads_tag_idx on public.leads(tag) where tag is not null;

-- ---------- helpers ----------
create or replace function public._disc_text_list(v jsonb) returns text[] language sql immutable as $f$
  select coalesce(array_agg(btrim(e)) filter (where btrim(e) <> ''), '{}'::text[])
  from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) e
$f$;

/** true when any exclude word appears in the text (case-insensitive). */
create or replace function public._disc_excluded(cfg jsonb, txt text) returns boolean language sql immutable as $f$
  select exists (
    select 1 from unnest(public._disc_text_list(cfg->'exclude_words')) w
    where position(lower(w) in lower(coalesce(txt, ''))) > 0
  )
$f$;

-- ---------- queries: same as 045 + add_terms + extra_searches ----------
create or replace function public._disc_build_queries(cfg jsonb) returns jsonb language plpgsql immutable as $f$
declare out jsonb := '[]'::jsonb; seen text[] := '{}'; c text; d jsonb; s text; city text; q text; word text; qs text[]; cf jsonb; kw text;
        feats jsonb := coalesce(cfg->'features','{}'::jsonb); cust jsonb := coalesce(cfg->'custom_features','[]'::jsonb);
        a boolean := coalesce((feats->>'app')::boolean,false); b boolean := coalesce((feats->>'dashboard')::boolean,false); w boolean := coalesce((feats->>'wordpress')::boolean,false);
        inc boolean := coalesce((cfg->>'include_cities')::boolean,false);
        suffix text := array_to_string(public._disc_text_list(cfg->'add_terms'), ' ');
        extra text[] := public._disc_text_list(cfg->'extra_searches');
begin
  for c in select jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) loop
    d := cfg->'country_defs'->c; if d is null then continue; end if;
    word := d->>'query_word';
    for s in select jsonb_array_elements_text(coalesce(cfg->'sectors','[]'::jsonb)) loop
      qs := array[s || ' ' || word, s || ' ' || word || ' شركة'];
      if a then qs := qs || (s || ' ' || word || ' تطبيق'); end if;
      if b then qs := qs || (s || ' ' || word || ' لوحة تحكم العملاء'); end if;
      if w then qs := qs || (s || ' ' || word || ' wordpress'); end if;
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
        if suffix <> '' then q := q || ' ' || suffix; end if;
        if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
      end loop;
    end loop;
    for q in select e from jsonb_array_elements_text(case when a and b and w then coalesce(d->'extra_queries','[]'::jsonb) else '[]'::jsonb end) e where e !~* '(site:|inurl:|intitle:|filetype:)' loop
      if suffix <> '' then q := q || ' ' || suffix; end if;
      if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
    end loop;
    -- Note lines: one search each, in this country (country word added unless the line already has it)
    foreach q in array extra loop
      q := regexp_replace(q, '(site:|inurl:|intitle:|filetype:)\S*', '', 'gi');
      q := btrim(q); if q = '' then continue; end if;
      if word is not null and position(word in q) = 0 then q := q || ' ' || word; end if;
      if suffix <> '' then q := q || ' ' || suffix; end if;
      if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
    end loop;
  end loop;
  return out;
end $f$;

-- ---------- triggers: exclude words + run tag ----------
create or replace function public._disc_pages_filter() returns trigger language plpgsql security definer set search_path = public as $f$
declare cfg jsonb;
begin
  if new.kind is distinct from 'home' then return new; end if;
  select config into cfg from public.discovery_runs where id = new.run_id;
  if cfg is not null and public._disc_excluded(cfg, concat_ws(' ', new.domain, new.name, new.url)) then
    return null;  -- skipped: never fetched
  end if;
  return new;
end $f$;

drop trigger if exists disc_pages_filter on public.discovery_pages;
create trigger disc_pages_filter before insert on public.discovery_pages
  for each row execute function public._disc_pages_filter();

create or replace function public._disc_results_tag() returns trigger language plpgsql security definer set search_path = public as $f$
declare cfg jsonb;
begin
  select config into cfg from public.discovery_runs where id = new.run_id;
  if cfg is not null and public._disc_excluded(cfg, concat_ws(' ', new.domain, new.name, new.url)) then
    return null;
  end if;
  if new.tag is null and cfg is not null then new.tag := nullif(btrim(cfg->>'run_tag'), ''); end if;
  return new;
end $f$;

drop trigger if exists disc_results_tag on public.discovery_results;
create trigger disc_results_tag before insert on public.discovery_results
  for each row execute function public._disc_results_tag();

-- ---------- tag RPCs ----------
/** Sets (or clears, with null / '') the tag of the given results. Returns how many rows changed. */
create or replace function public.set_discovery_results_tag(p_ids uuid[], p_tag text)
returns int language plpgsql security definer set search_path = public as $f$
declare n int;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  update public.discovery_results set tag = nullif(btrim(p_tag), '') where id = any(p_ids);
  get diagnostics n = row_count;
  -- Results already added as clients: keep the client's tag in step
  update public.leads l set tag = nullif(btrim(p_tag), '')
    from public.discovery_results x where x.id = any(p_ids) and x.status = 'added' and x.lead_id = l.id;
  return n;
end $f$;

/** Every tag in use (results + clients), for suggestions and filters. */
create or replace function public.discovery_tags()
returns table(tag text, results int, leads int) language sql stable security definer set search_path = public as $f$
  with r as (select x.tag, count(*)::int n from public.discovery_results x where x.tag is not null group by x.tag),
       l as (select y.tag, count(*)::int n from public.leads y where y.tag is not null group by y.tag)
  select coalesce(r.tag, l.tag), coalesce(r.n, 0), coalesce(l.n, 0)
  from r full join l on l.tag = r.tag
  where public.my_role() in ('admin', 'manager')
  order by 1
$f$;

revoke all on function public.set_discovery_results_tag(uuid[], text), public.discovery_tags() from public, anon;
grant execute on function public.set_discovery_results_tag(uuid[], text), public.discovery_tags() to authenticated;
revoke execute on function public._disc_pages_filter(), public._disc_results_tag() from public, anon, authenticated;

-- ---------- approve: same as 054 + copies the tag to the client ----------
create or replace function public.approve_discovery_results(p_ids uuid[] default null, p_data_quality text default 'normal', p_is_salla boolean default null)
returns table(received int, added int, duplicates int) language plpgsql security definer set search_path = public as $f$
declare rows jsonb; n_in int; r record; lid uuid; v_salla boolean;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if coalesce(p_data_quality, '') not in ('normal', 'medium', 'high') then raise exception 'invalid data quality: %', p_data_quality; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'phone', x.phone, 'company', x.name, 'region', coalesce(x.country, 'Saudi Arabia'), 'source', 'Google Search',
          'notes', x.notes, 'website', x.url, 'website_key', x.domain)), '[]'::jsonb), count(*)
    into rows, n_in from public.discovery_results x where x.status = 'new' and (p_ids is null or x.id = any(p_ids));
  if n_in = 0 then return query select 0, 0, 0; return; end if;
  perform * from public.import_leads(rows, false, p_data_quality);
  added := 0; duplicates := 0;
  for r in select * from public.discovery_results x where x.status = 'new' and (p_ids is null or x.id = any(p_ids)) loop
    select l.id into lid from public.leads l where l.website_key = r.domain limit 1;
    if lid is not null then
      update public.discovery_results set status = 'added', lead_id = lid where id = r.id; added := added + 1;
      v_salla := coalesce(p_is_salla, exists (select 1 from unnest(coalesce(r.features, '{}'::text[])) f where f ilike '%salla%' or f like '%سلة%'));
      -- created_at = now() only for leads inserted in this transaction
      update public.leads l set is_salla_store = v_salla where l.id = lid and l.created_at >= now();
      if r.tag is not null then
        update public.leads l set tag = r.tag where l.id = lid and (l.tag is null or l.created_at >= now());
      end if;
    else
      update public.discovery_results set status = 'duplicate' where id = r.id; duplicates := duplicates + 1;
    end if;
  end loop;
  return query select n_in, added, duplicates;
end $f$;

revoke all on function public.approve_discovery_results(uuid[], text, boolean) from public, anon;
grant execute on function public.approve_discovery_results(uuid[], text, boolean) to authenticated;

-- ---------- check ----------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'tag') as leads_tag_column,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'discovery_results' and column_name = 'tag') as results_tag_column,
  (select count(*) from pg_trigger where tgname in ('disc_pages_filter', 'disc_results_tag')) as triggers,   -- expect 1, 1, 2
  jsonb_array_length(public._disc_build_queries(jsonb_build_object(
    'countries', '["sa"]'::jsonb, 'sectors', '["عيادات"]'::jsonb,
    'country_defs', jsonb_build_object('sa', jsonb_build_object('query_word', 'السعودية')),
    'features', '{}'::jsonb, 'extra_searches', '["متاجر عطور"]'::jsonb, 'add_terms', '["اونلاين"]'::jsonb))) as test_queries;  -- expect 3

-- =====================================================================
-- 066_fill_missing_phones_skip_duplicates.sql
-- =====================================================================
-- 066: Excel import — filling the phone of stores that already exist must never hit the unique phone rule.
-- Before: if the phone in the file already belonged to another client, fill_missing_phones failed with
--         "duplicate key value violates unique constraint leads_phone_key_unique" and the import showed an error.
-- Now:    a phone that is already used by any client (or repeated in the same file) is skipped, the rest are filled.
-- Same signature and permissions as before. Safe to run more than once.

create or replace function public.fill_missing_phones(rows jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  if coalesce(public.my_role(), '') not in ('admin','manager') then
    raise exception 'Only admin or manager can import phones';
  end if;
  with raw as (
    select r ->> 'website_key' as website_key,
           nullif(regexp_replace(coalesce(r ->> 'phone', ''), '[^0-9+]', '', 'g'), '') as phone
    from jsonb_array_elements(rows) r
  ), src as (
    -- one row per phone: the same number on two stores in the file is filled only once
    select distinct on (public.phone_key(phone)) website_key, phone
    from raw
    where website_key is not null and phone is not null and public.phone_key(phone) is not null
    order by public.phone_key(phone), website_key
  ), upd as (
    update public.leads l
       set phone = s.phone, phone_source = 'manual', updated_at = now()
      from src s
     where l.website_key = s.website_key
       and (l.phone is null or l.phone = '')
       and not exists (select 1 from public.leads x where x.phone_key = public.phone_key(s.phone))
    returning 1
  ) select count(*) into n from upd;
  return n;
end $function$;

-- check: the function exists and still returns integer
select pg_get_function_result('public.fill_missing_phones(jsonb)'::regprocedure) as returns;  -- integer

-- =====================================================================
-- تحقّق (قراءة بس): كل RPC/view الكود بيستخدمها. لازم يرجّع 0 صفوف.
-- =====================================================================
select 'missing function' as problem, f as name
from unnest(array[
  'get_leads_counts','get_lead_status_counts','get_worked_clients_count',
  'set_lead_customer_number','fill_missing_phones','list_email_confirmations','set_user_email_confirmed','delete_user_account',
  'request_meeting','cancel_meeting_request','create_deal','attach_recording','attach_contract','approve_deal',
  'get_month_revenue','get_daily_summary','get_funnel_stats','get_target_progress','get_loss_report',
  'get_source_performance','get_leaderboard','get_attention_items','get_payroll',
  'get_audit_feed','get_audit_tables','get_team_performance','admin_set_user_pay','get_reports_summary','get_team_lead_stats','admin_get_user_pay','admin_update_user','lookup_client_for_deal','get_target_progress_v2','admin_set_target','distribute_unassigned_leads','count_unassigned_leads','get_auto_distribution','set_auto_distribution','run_auto_distribution','run_daily_jobs','create_custom_deal','discovery_tags','set_discovery_results_tag'
]) f
where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)
union all
select 'missing view/table', t
from unnest(array['monthly_revenue','audit_log','user_commission_rates','user_targets','activity_logs','client_comments','notifications','packages',
                  'meeting_requests','meetings','deals','contract_reviews','users','leads']) t
where to_regclass('public.' || t) is null;
