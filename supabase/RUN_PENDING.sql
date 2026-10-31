-- =====================================================================
-- RUN_PENDING — الـ migrations اللي لسه ما اتشغّلتش في Supabase، بالترتيب.
-- حالياً: 032_auto_distribution (لو لسه) · 056_custom_deal_meeting_snapshot · 059_fix_admin_closer_and_booked_by_id · 064_discovery_notes_and_tags · 065_sales_telesales_role. من 004 لحد 028 و 030 اتشغّلوا (030 بيغطي 029، فـ 029 ما يتشغّلش).
-- أي migration جديد يتحط هنا فوق استعلام التحقق، وبعد ما يتشغّل يتشال.
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
-- 065_sales_telesales_role.sql
-- =====================================================================
-- 065: new role "sales_telesales" (سيلز + تيلي سيلز): one person who does both jobs.
--
-- Telesales side: gets leads distributed to them, calls them, requests meetings (with another sales or with themselves).
-- Sales side:     receives meeting requests, runs meetings, closes deals and uploads contracts.
-- Deals:          their own lead -> recorded like a telesales deal; a lead that reached them through a meeting -> like a sales deal.
-- Commission:     closer_sales / closer_telesales by the same rule; lead_telesales when someone else closes their lead.
--
-- Every function below is the LIVE version exported from Supabase on 2026-10-31, changed only to accept the new role.
-- Policies that work by user id (most of them) need no change.
-- Safe to run more than once.

set lock_timeout = '10s';

-- ---------- allowed roles ----------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('admin', 'manager', 'sales', 'telesales', 'sales_telesales'));

do $$ begin
  if to_regclass('public.profiles') is not null then
    alter table public.profiles drop constraint if exists profiles_role_check;
    alter table public.profiles add constraint profiles_role_check
      check (role in ('admin', 'manager', 'sales', 'telesales', 'sales_telesales'));
  end if;
end $$;

-- ---------- contracts: sales can insert -> the hybrid role too ----------
drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts for insert to public
  with check (get_my_role() = any (array['admin', 'manager', 'sales', 'sales_telesales']));

-- ---------- default permissions = sales + telesales ----------
insert into public.role_default_permissions(role, permission_key)
select distinct 'sales_telesales', permission_key
from public.role_default_permissions where role in ('sales', 'telesales')
on conflict do nothing;

-- ---------- functions ----------
-- _deal_check_access
CREATE OR REPLACE FUNCTION public._deal_check_access(p_lead uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r text; s text; owner uuid; ok uuid;
begin
  select u.role, u.status into r, s from public.users u where u.id = auth.uid();
  if r is null or r not in ('sales','telesales','manager','admin', 'sales_telesales') or s is distinct from 'active' then
    raise exception 'Only an active sales, telesales, manager or admin user can create deals';
  end if;
  select l.assigned_to into owner from public.leads l where l.id = p_lead for share;
  if not found then raise exception 'Lead not found'; end if;
  if r = 'telesales' then
    if owner is distinct from auth.uid() then raise exception 'You can only close deals for leads assigned to you'; end if;
  elsif r = 'sales' then
    select m.assigned_sales_id into ok from public.meetings m where m.lead_id = p_lead and m.assigned_sales_id = auth.uid() order by m.proposed_date desc limit 1;
    if ok is null then raise exception 'You can only close a deal for a lead assigned to you through a meeting'; end if;
  elsif r = 'sales_telesales' then
    -- own lead (telesales side) or a meeting assigned to them (sales side)
    if owner is distinct from auth.uid() then
      select m.assigned_sales_id into ok from public.meetings m where m.lead_id = p_lead and m.assigned_sales_id = auth.uid() order by m.proposed_date desc limit 1;
      if ok is null then raise exception 'You can only close deals for leads assigned to you or with a meeting assigned to you'; end if;
    end if;
  elsif r = 'manager' then
    if owner is not null and owner <> auth.uid() and not exists (select 1 from public.users u where u.id = owner and u.manager_id = auth.uid())
       and not exists (select 1 from public.meetings m where m.lead_id = p_lead and m.assigned_sales_id = auth.uid()) then
      raise exception 'You can only close deals for your own or your team leads';
    end if;
  end if;
  return coalesce(owner, auth.uid());
end $function$;

-- _month_stats
CREATE OR REPLACE FUNCTION public._month_stats(p_month date, p_all boolean)
 RETURNS TABLE(user_id uuid, full_name text, role text, calls_done bigint, meetings_done bigint, deals_done bigint, revenue_sar numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as (select date_trunc('month', p_month)::timestamptz as s,
                    (date_trunc('month', p_month) + interval '1 month')::timestamptz as e),
  people as (
    select u.id, u.full_name, u.role from public.users u
    where u.role in ('telesales','sales', 'sales_telesales') and u.status = 'active'
      and (p_all or u.id in (select public.visible_user_ids()))
  ),
  calls as (select a.actor_id as uid, count(*) as n from public.activity_logs a, r
            where a.activity_type = 'call' and a.created_at >= r.s and a.created_at < r.e group by 1),
  tele_m as (select mr.requested_by as uid, count(*) as n from public.meeting_requests mr, r
             where mr.created_at >= r.s and mr.created_at < r.e and mr.status <> 'cancelled' group by 1),
  sales_m as (select m.assigned_sales_id as uid, count(*) as n from public.meetings m, r
              where m.proposed_date >= r.s and m.proposed_date < r.e and m.outcome <> 'Rescheduled' group by 1),
  dl as (
    select d.sales_user_id as uid, d.id, d.price_sar from public.deals d, r
     where d.sales_user_id is not null and d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
    union all
    select d.telesales_user_id, d.id, d.price_sar from public.deals d, r
     where d.telesales_user_id is not null and d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
  ),
  dl_agg as (select uid, count(*) as n, sum(price_sar) as rev from dl group by uid)
  select p.id, p.full_name, p.role, coalesce(c.n, 0),
         case p.role when 'telesales' then coalesce(tm.n, 0) when 'sales_telesales' then coalesce(tm.n, 0) + coalesce(sm.n, 0) else coalesce(sm.n, 0) end,
         coalesce(da.n, 0), coalesce(da.rev, 0)
  from people p
  left join calls c on c.uid = p.id
  left join tele_m tm on tm.uid = p.id
  left join sales_m sm on sm.uid = p.id
  left join dl_agg da on da.uid = p.id
$function$;

-- accept_meeting_request
CREATE OR REPLACE FUNCTION public.accept_meeting_request(target_request_id uuid, target_proposed_date timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare request_row public.meeting_requests%rowtype; caller_role text; caller_status text; created_meeting_id uuid; v_lead public.leads%rowtype;
begin
  select u.role, u.status into caller_role, caller_status from public.users u where u.id = auth.uid();
  if caller_role is null or caller_role not in ('sales','manager','admin', 'sales_telesales') or caller_status is distinct from 'active' then
    raise exception 'Only sales, manager or admin users can accept meeting requests';
  end if;
  if target_proposed_date is null or target_proposed_date <= now() then raise exception 'Choose a meeting time in the future'; end if;
  select * into request_row from public.meeting_requests r where r.id = target_request_id for update;
  if not found or (request_row.assigned_sales_id is distinct from auth.uid() and caller_role <> 'admin') then
    raise exception 'This meeting request is not assigned to you';
  end if;
  if request_row.status <> 'pending' then raise exception 'This meeting request is no longer pending'; end if;
  select * into v_lead from public.leads where id = request_row.lead_id;
  insert into public.meetings (lead_id, lead_name, lead_phone, client_code, lead_website, booked_by, booked_by_id, assigned_sales_id, proposed_date, telesales_notes)
  values (request_row.lead_id, coalesce(v_lead.name,''), coalesce(v_lead.phone,''), v_lead.client_code, v_lead.website,
          request_row.requested_by, request_row.requested_by, request_row.assigned_sales_id, target_proposed_date, request_row.notes)
  returning id into created_meeting_id;
  update public.meeting_requests set status='accepted', meeting_id=created_meeting_id, updated_at=now() where id = target_request_id;
  update public.leads set needs_meeting=false where id = request_row.lead_id;
  insert into public.notifications (user_id, type, title, message)
  select request_row.requested_by, 'meeting', 'Meeting scheduled', 'Your meeting request was accepted.'
  where request_row.requested_by <> auth.uid();
  return created_meeting_id;
end $function$;

-- admin_set_target
CREATE OR REPLACE FUNCTION public.admin_set_target(p_user_id uuid, p_month date, p_calls integer DEFAULT 0, p_meetings integer DEFAULT 0, p_deals integer DEFAULT 0, p_revenue_sar numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can set targets'; end if;
  if not exists (select 1 from public.users where id = p_user_id and role in ('manager','sales','telesales', 'sales_telesales')) then
    raise exception 'Targets can be set for managers, sales and telesales only';
  end if;
  if least(coalesce(p_calls,0), coalesce(p_meetings,0), coalesce(p_deals,0)) < 0 or coalesce(p_revenue_sar,0) < 0 then
    raise exception 'Targets cannot be negative';
  end if;
  insert into public.user_targets as t (user_id, month, calls_target, meetings_target, deals_target, revenue_target_sar, updated_by)
  values (p_user_id, date_trunc('month', p_month)::date, coalesce(p_calls,0), coalesce(p_meetings,0), coalesce(p_deals,0), coalesce(p_revenue_sar,0), auth.uid())
  on conflict (user_id, month) do update set calls_target = excluded.calls_target, meetings_target = excluded.meetings_target,
    deals_target = excluded.deals_target, revenue_target_sar = excluded.revenue_target_sar, updated_by = auth.uid(), updated_at = now();
end $function$;

-- admin_update_user
CREATE OR REPLACE FUNCTION public.admin_update_user(p_user_id uuid, p_full_name text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_set_manager boolean DEFAULT false, p_manager_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_base_salary numeric DEFAULT NULL::numeric, p_base_currency text DEFAULT NULL::text, p_closer_percent numeric DEFAULT NULL::numeric, p_lead_percent numeric DEFAULT NULL::numeric, p_manager_percent numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  u public.users; new_role text; new_manager uuid; team_n integer;
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can edit users'; end if;
  select * into u from public.users where id = p_user_id;
  if not found then raise exception 'User not found'; end if;

  new_role := coalesce(p_role, u.role);
  if new_role <> u.role then
    if u.role = 'admin' then raise exception 'An admin''s role cannot be changed here'; end if;
    if p_user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
    if new_role not in ('manager','sales','telesales', 'sales_telesales') then raise exception 'Role must be manager, sales, telesales or sales_telesales'; end if;
    if u.role = 'manager' then
      select count(*) into team_n from public.users where manager_id = p_user_id;
      if team_n > 0 then raise exception 'This manager still has % team member(s). Move them to another manager first.', team_n; end if;
    end if;
  end if;

  if p_status is not null then
    if p_status not in ('active','inactive') then raise exception 'Status must be active or inactive'; end if;
    if p_status = 'inactive' and p_user_id = auth.uid() then raise exception 'You cannot deactivate yourself'; end if;
  end if;
  if p_full_name is not null and btrim(p_full_name) = '' then raise exception 'Full name cannot be empty'; end if;

  -- المدير: للسيلز/التيلي بس، ولازم يكون مانجر
  new_manager := case when p_set_manager then p_manager_id else u.manager_id end;
  if new_role not in ('sales','telesales', 'sales_telesales') then new_manager := null; end if;
  if new_manager is not null then
    if new_manager = p_user_id then raise exception 'A user cannot be their own manager'; end if;
    if not exists (select 1 from public.users where id = new_manager and role = 'manager') then
      raise exception 'Selected manager does not exist';
    end if;
  end if;

  update public.users set
    full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
    role = new_role,
    manager_id = new_manager,
    status = coalesce(p_status, status)
  where id = p_user_id;

  if num_nonnulls(p_base_salary, p_base_currency, p_closer_percent, p_lead_percent, p_manager_percent) > 0 then
    perform public.admin_set_user_pay(p_user_id, p_base_salary, p_base_currency, p_closer_percent, p_lead_percent, p_manager_percent);
  end if;
end $function$;

-- assign_leads
CREATE OR REPLACE FUNCTION public.assign_leads(p_lead_ids uuid[], p_assignee uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid(); v_is_admin boolean := public.is_admin();
  v_role text; v_status text; v_manager uuid; v_batch uuid := gen_random_uuid(); v_count integer := 0;
begin
  if v_me is null then raise exception 'You are not signed in'; end if;
  if p_lead_ids is null or coalesce(array_length(p_lead_ids, 1), 0) = 0 then return 0; end if;
  select role, status, manager_id into v_role, v_status, v_manager from public.users where id = p_assignee;
  if not found then raise exception 'The selected user does not exist'; end if;
  if v_status <> 'active' then raise exception 'The selected user is not active'; end if;
  if v_role not in ('admin', 'manager', 'telesales', 'sales', 'sales_telesales') then
    raise exception 'Leads can only be sent to an admin, manager, telesales or sales user';
  end if;
  if not v_is_admin and p_assignee <> v_me and v_manager is distinct from v_me then
    raise exception 'You can only send leads to yourself or people in your own team';
  end if;
  with target as (
    select l.id, l.assigned_to from public.leads l
    where l.id = any (p_lead_ids)
      and (v_is_admin or l.assigned_to = v_me or l.assigned_to in (select public.my_team_ids()))
  ),
  moved as (
    update public.leads l set assigned_to = p_assignee, assigned_by = v_me, assigned_at = now(), status = 'Assigned', updated_at = now()
    from target t where l.id = t.id returning l.id as lead_id, t.assigned_to as old_owner
  ),
  logged as (
    insert into public.lead_assignments (batch_id, lead_id, from_user, to_user, assigned_by)
    select v_batch, m.lead_id, m.old_owner, p_assignee, v_me from moved m returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end $function$;

-- attach_contract
CREATE OR REPLACE FUNCTION public.attach_contract(target_deal_id uuid, target_contract_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  deal_row public.deals%rowtype;
  review_id uuid;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';
  if caller_role is null or caller_role not in ('sales', 'telesales', 'manager', 'sales_telesales') then
    raise exception 'Only sales, telesales, or manager users can attach a contract';
  end if;
  if target_contract_path is null
    or target_contract_path not like target_deal_id::text || '/%'
    or cardinality(string_to_array(target_contract_path, '/')) <> 2
    or target_contract_path like '%..%'
    or position(chr(92) in target_contract_path) > 0
  then
    raise exception 'Contract must be stored under the deal folder';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'contracts' and o.name = target_contract_path
  ) then
    raise exception 'Contract file was not uploaded';
  end if;

  select * into deal_row
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found or deal_row.closed_by_user_id is distinct from auth.uid() then
    raise exception 'You can only attach contracts to deals you created';
  end if;
  if deal_row.status in ('approved', 'active', 'cancelled') then
    raise exception 'Cannot change the contract after the deal has been approved';
  end if;

  update public.deals
  set contract_path = target_contract_path,
      status = 'contract_uploaded',
      updated_at = now()
  where id = target_deal_id;

  review_id := public.create_contract_review(
    target_deal_id,
    array[target_contract_path]
  );
  return review_id;
end;
$function$;

-- attach_recording
CREATE OR REPLACE FUNCTION public.attach_recording(target_deal_id uuid, target_recording_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  deal_row public.deals%rowtype;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';
  if caller_role is null or caller_role not in ('sales', 'telesales', 'manager', 'sales_telesales') then
    raise exception 'Only sales, telesales, or manager users can attach a recording';
  end if;
  if target_recording_path is null
    or target_recording_path not like target_deal_id::text || '/%'
    or cardinality(string_to_array(target_recording_path, '/')) <> 2
    or target_recording_path like '%..%'
    or position(chr(92) in target_recording_path) > 0
  then
    raise exception 'Recording must be stored under the deal folder';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'recordings' and o.name = target_recording_path
  ) then
    raise exception 'Recording file was not uploaded';
  end if;

  select * into deal_row from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
    or deal_row.closed_by_user_id is distinct from auth.uid()
  then
    raise exception 'You can only attach recordings to deals you created';
  end if;
  if deal_row.status = 'cancelled' then
    raise exception 'Cannot attach files to a cancelled deal';
  end if;

  update public.deals
  set recording_path = target_recording_path, updated_at = now()
  where id = target_deal_id;
end;
$function$;

-- can_edit_lead
CREATE OR REPLACE FUNCTION public.can_edit_lead(p_lead_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r text := public.my_role(); l public.leads;
begin
  if me is null or r is null then return false; end if;
  select * into l from public.leads where id = p_lead_id;
  if not found then return false; end if;
  if r = 'admin' then return true; end if;
  if r in ('telesales', 'sales_telesales') then return coalesce(l.assigned_to = me, false); end if;
  if r = 'manager' then
    return coalesce(l.assigned_to = me, false)
        or coalesce(l.assigned_to in (select u.id from public.users u where u.manager_id = me), false);
  end if;
  return false;
end $function$;

-- can_view_lead
CREATE OR REPLACE FUNCTION public.can_view_lead(p_lead_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r text := public.my_role(); l public.leads;
begin
  if me is null or r is null then return false; end if;
  select * into l from public.leads where id = p_lead_id;
  if not found then return false; end if;
  if r = 'admin' then return true; end if;
  if r = 'telesales' then return coalesce(l.assigned_to = me, false); end if;
  if r = 'sales_telesales' then
    return coalesce(l.assigned_to = me, false)
        or exists (select 1 from public.meetings m where m.lead_id = l.id and m.assigned_sales_id = me)
        or exists (select 1 from public.deals d where d.lead_id = l.id and d.sales_user_id = me);
  end if;
  if r = 'sales' then
    return exists (select 1 from public.meetings m where m.lead_id = l.id and m.assigned_sales_id = me)
        or exists (select 1 from public.deals d where d.lead_id = l.id and d.sales_user_id = me);
  end if;
  if r = 'manager' then
    return coalesce(l.assigned_to = me, false)
        or coalesce(l.assigned_to in (select u.id from public.users u where u.manager_id = me), false)
        or exists (select 1 from public.meetings m where m.lead_id = l.id
                   and m.assigned_sales_id in (select u.id from public.users u where u.manager_id = me));
  end if;
  return false;
end $function$;

-- cancel_meeting_request
CREATE OR REPLACE FUNCTION public.cancel_meeting_request(target_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  caller_status text;
  request_row public.meeting_requests%rowtype;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is null or caller_status is distinct from 'active' or caller_role not in ('telesales', 'admin', 'manager', 'sales_telesales') then
    raise exception 'You are not allowed to cancel meeting requests';
  end if;

  select * into request_row
  from public.meeting_requests r
  where r.id = target_request_id
  for update;

  if not found then
    raise exception 'Meeting request not found';
  end if;
  if caller_role in ('telesales', 'sales_telesales') and request_row.requested_by is distinct from auth.uid() then
    raise exception 'You can only cancel your own meeting requests';
  end if;
  if caller_role = 'manager' and not exists (
    select 1 from public.users u
    where u.manager_id = auth.uid()
      and u.id in (request_row.requested_by, request_row.assigned_sales_id)
  ) then
    raise exception 'You can only cancel requests involving your team';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Only pending meeting requests can be cancelled';
  end if;

  update public.meeting_requests
  set status = 'cancelled', updated_at = now()
  where id = target_request_id;

  update public.leads
  set needs_meeting = false
  where id = request_row.lead_id;
end;
$function$;

-- create_contract_review
CREATE OR REPLACE FUNCTION public.create_contract_review(target_deal_id uuid, target_contract_paths text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  created_review_id uuid;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';

  if caller_role is null or caller_role not in ('sales', 'telesales', 'manager', 'sales_telesales') then
    raise exception 'Only active sales, telesales, or manager users can attach a contract';
  end if;

  if target_deal_id is null
    or target_contract_paths is null
    or cardinality(target_contract_paths) not between 1 and 10
    or exists (
      select 1
      from unnest(target_contract_paths) as paths(file_path)
      where file_path is null
        or file_path not like target_deal_id::text || '/%'
        or cardinality(string_to_array(file_path, '/')) <> 2
        or file_path like '%..%'
        or position(chr(92) in file_path) > 0
    )
  then
    raise exception 'Contract files must be stored under the deal folder';
  end if;

  if not exists (select 1 from public.deals d where d.id = target_deal_id) then
    raise exception 'Deal not found';
  end if;

  update public.contract_reviews
  set status = 'failed',
      error = 'Contract review timed out before completion',
      completed_at = now(),
      updated_at = now()
  where deal_id = target_deal_id
    and status in ('queued', 'processing')
    and (
      processing_started_at is null
      or processing_started_at <= now() - interval '3 minutes'
    );

  if exists (
    select 1 from public.contract_reviews r
    where r.deal_id = target_deal_id
      and r.status in ('queued', 'processing')
  ) then
    raise exception 'A contract review is already processing';
  end if;

  insert into public.contract_reviews (
    deal_id, contract_paths, submitted_by, requested_by,
    status, processing_started_at
  )
  values (
    target_deal_id, target_contract_paths, auth.uid(), auth.uid(),
    'queued', now()
  )
  returning id into created_review_id;

  return created_review_id;
end;
$function$;

-- create_custom_deal
CREATE OR REPLACE FUNCTION public.create_custom_deal(target_lead_id uuid, custom_service_name text, custom_duration_months integer, target_price_sar numeric, target_start_date date, deal_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare caller_role text; lead_owner uuid; v_commission_percent numeric; created_deal_id uuid;
begin
  if nullif(trim(custom_service_name),'') is null then raise exception 'Enter the service name'; end if;
  if custom_duration_months is null or custom_duration_months < 1 then raise exception 'Enter a valid duration in months'; end if;
  if target_price_sar is null or target_price_sar < 0 then raise exception 'Enter a valid closing price in SAR'; end if;
  if target_start_date is null then raise exception 'Choose a deal start date'; end if;
  lead_owner := public._deal_check_access(target_lead_id);
  select role into caller_role from public.users where id = auth.uid();
  select commission_percent into v_commission_percent from public.users where id = auth.uid();
  insert into public.deals (lead_id, package_id, sales_user_id, telesales_user_id, closed_by_user_id, package_name, package_duration_months,
    list_price_sar, min_price_sar, price_sar, below_min_price, start_date, end_date, notes, commission_percent, commission_sar)
  values (target_lead_id, null, case when caller_role = 'sales' or (caller_role = 'sales_telesales' and lead_owner is distinct from auth.uid()) then auth.uid() else null end, lead_owner, auth.uid(),
    trim(custom_service_name), custom_duration_months, target_price_sar, target_price_sar, target_price_sar, false,
    target_start_date, (target_start_date + make_interval(months => custom_duration_months) - interval '1 day')::date, nullif(trim(deal_notes),''),
    coalesce(v_commission_percent,0), round(target_price_sar * coalesce(v_commission_percent,0) / 100, 2))
  returning id into created_deal_id;
  return created_deal_id;
end $function$;

-- create_deal
CREATE OR REPLACE FUNCTION public.create_deal(target_lead_id uuid, target_package_id uuid, target_price_sar numeric, target_start_date date, deal_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare caller_role text; lead_owner uuid; pkg public.packages%rowtype; v_commission_percent numeric; created_deal_id uuid;
begin
  if target_price_sar is null or target_price_sar < 0 then raise exception 'Enter a valid closing price in SAR'; end if;
  if target_start_date is null then raise exception 'Choose a deal start date'; end if;
  lead_owner := public._deal_check_access(target_lead_id);
  select role into caller_role from public.users where id = auth.uid();
  select * into pkg from public.packages p where p.id = target_package_id and p.is_active = true and public.can_use_package(p.id);
  if not found then raise exception 'Choose an active package'; end if;
  select commission_percent into v_commission_percent from public.users where id = auth.uid();
  insert into public.deals (lead_id, package_id, sales_user_id, telesales_user_id, closed_by_user_id, package_name, package_duration_months,
    list_price_sar, min_price_sar, price_sar, below_min_price, start_date, end_date, notes, commission_percent, commission_sar)
  values (target_lead_id, target_package_id, case when caller_role = 'sales' or (caller_role = 'sales_telesales' and lead_owner is distinct from auth.uid()) then auth.uid() else null end, lead_owner, auth.uid(),
    pkg.name, pkg.duration_months, pkg.price_sar, pkg.min_price_sar, target_price_sar, target_price_sar < pkg.min_price_sar,
    target_start_date, (target_start_date + make_interval(months => pkg.duration_months) - interval '1 day')::date, nullif(trim(deal_notes),''),
    coalesce(v_commission_percent,0), round(target_price_sar * coalesce(v_commission_percent,0) / 100, 2))
  returning id into created_deal_id;
  return created_deal_id;
end $function$;

-- decline_meeting_request
CREATE OR REPLACE FUNCTION public.decline_meeting_request(target_request_id uuid, decline_reason_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare caller_role text; caller_status text; request_row public.meeting_requests%rowtype;
begin
  select u.role, u.status into caller_role, caller_status from public.users u where u.id = auth.uid();
  if caller_role is null or caller_role not in ('sales','manager','admin', 'sales_telesales') or caller_status is distinct from 'active' then
    raise exception 'Only sales, manager or admin users can decline meeting requests';
  end if;
  select * into request_row from public.meeting_requests r where r.id = target_request_id for update;
  if not found or (request_row.assigned_sales_id is distinct from auth.uid() and caller_role <> 'admin') then
    raise exception 'This meeting request is not assigned to you';
  end if;
  if request_row.status <> 'pending' then raise exception 'This meeting request is no longer pending'; end if;
  if nullif(trim(decline_reason_text), '') is null then raise exception 'Provide a reason for declining this meeting request'; end if;
  update public.meeting_requests set status='declined', decline_reason=nullif(trim(decline_reason_text),''), updated_at=now() where id = target_request_id;
  update public.leads set needs_meeting=false where id = request_row.lead_id;
  insert into public.notifications (user_id, type, title, message)
  select request_row.requested_by, 'meeting', 'Meeting request declined', coalesce(nullif(trim(decline_reason_text),''), 'The request was declined.')
  where request_row.requested_by <> auth.uid();
end $function$;

-- distribute_leads_evenly
CREATE OR REPLACE FUNCTION public.distribute_leads_evenly(p_lead_ids uuid[], p_user_ids uuid[], p_max_open_per_user integer DEFAULT NULL::integer)
 RETURNS TABLE(user_id uuid, assigned_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_role text := public.my_role();
  v_actor public.users;
  v_lead uuid; i int; best int; n int;
  v_loads int[]; v_added int[]; v_left int := 0;
begin
  if v_role not in ('admin','manager') then raise exception 'Only admin or manager can distribute leads'; end if;
  n := coalesce(array_length(p_user_ids, 1), 0);
  if n = 0 then raise exception 'Choose at least one telesales user'; end if;
  if exists (select 1 from unnest(p_user_ids) x
             where not exists (select 1 from public.users u
                               where u.id = x and u.role in ('telesales','manager','admin', 'sales_telesales') and u.status = 'active'
                                 and (v_role = 'admin' or u.manager_id = auth.uid() or u.id = auth.uid()))) then
    raise exception 'The list contains a user who is not an active telesales you can manage';
  end if;
  select * into v_actor from public.users where id = auth.uid();

  select array_agg((select count(*)::int from public.leads l
                    where l.assigned_to = t.x
                      and l.status not in ('Subscribed','Converted','Did Not Subscribe','Not Interested')) order by t.ord)
    into v_loads from unnest(p_user_ids) with ordinality as t(x, ord);
  v_added := array_fill(0, array[n]);

  foreach v_lead in array coalesce(p_lead_ids, '{}'::uuid[]) loop
    best := null;
    for i in 1..n loop
      if (p_max_open_per_user is null or v_loads[i] < p_max_open_per_user)
         and (best is null or v_loads[i] < v_loads[best]) then best := i; end if;
    end loop;
    if best is null then v_left := v_left + 1; continue; end if;

    update public.leads
       set assigned_to = p_user_ids[best],
           status = case when status = 'New' then 'Assigned' else status end,
           updated_at = now()
     where id = v_lead
       and (v_role = 'admin' or assigned_to is null
            or assigned_to in (select id from public.users where manager_id = auth.uid()));
    if not found then continue; end if;

    v_loads[best] := v_loads[best] + 1;
    v_added[best] := v_added[best] + 1;
    insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
    values (v_lead, auth.uid(), coalesce(v_actor.full_name, '-'), v_actor.role, 'assignment', 'Assigned', 'Even distribution');
  end loop;

  for i in 1..n loop
    if v_added[i] > 0 then
      insert into public.notifications (user_id, type, title, message)
      values (p_user_ids[i], 'assignment', 'عملاء جدد', 'تم توزيع ' || v_added[i] || ' عميل عليك');
    end if;
    user_id := p_user_ids[i]; assigned_count := v_added[i]; return next;
  end loop;
  if v_left > 0 then user_id := null; assigned_count := v_left; return next; end if;   -- اللي ما اتوزعوش
end $function$;

-- distribute_unassigned_leads
CREATE OR REPLACE FUNCTION public.distribute_unassigned_leads(p_user_ids uuid[], p_limit integer DEFAULT NULL::integer, p_country text DEFAULT NULL::text, p_quality text DEFAULT NULL::text, p_max_per_user integer DEFAULT NULL::integer)
 RETURNS TABLE(user_id uuid, assigned_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.my_role();
  v_actor public.users;
  v_source uuid;                       -- null = غير موزّع (أدمن) | uid المدير = عملاؤه
  n int := coalesce(array_length(p_user_ids, 1), 0);
begin
  if v_role not in ('admin','manager') then raise exception 'Only admin or manager can distribute leads'; end if;
  if n = 0 then raise exception 'Choose at least one telesales user'; end if;
  if exists (select 1 from unnest(p_user_ids) x
             where not exists (select 1 from public.users u
                               where u.id = x and u.role in ('telesales','manager','admin', 'sales_telesales') and u.status = 'active'
                                 and (v_role = 'admin' or u.manager_id = auth.uid() or u.id = auth.uid()))) then
    raise exception 'The list contains a user who is not an active telesales you can manage';
  end if;
  select * into v_actor from public.users where id = auth.uid();
  v_source := case when v_role = 'manager' then auth.uid() else null end;

  create temp table _dist on commit drop as
  with picked as (
    select l.id, row_number() over (order by l.id) as rn
    from public.leads l
    where l.assigned_to is not distinct from v_source
      and (p_country is null or l.region = p_country)
      and (p_quality is null or l.data_quality = p_quality)
    order by l.id
    limit coalesce(p_limit, 2147483647)
  )
  select id, p_user_ids[1 + ((rn - 1) % n)] as uid, rn from picked;

  if p_max_per_user is not null then
    delete from _dist where ((rn - 1) / n) >= p_max_per_user;
  end if;

  -- نسجّل فقط الصفوف اللي اتحدّثت فعلاً (لو حد غيّر عميل في نفس اللحظة يتخطّاه)
  create temp table _done on commit drop as
  with u as (
    update public.leads l
       set assigned_to = d.uid,
           status = case when l.status = 'New' then 'Assigned' else l.status end,
           updated_at = now()
      from _dist d
     where l.id = d.id and l.assigned_to is not distinct from v_source
    returning l.id, d.uid
  ) select id, uid from u;

  insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
  select d.id, auth.uid(), coalesce(v_actor.full_name, '-'), v_actor.role, 'assignment', 'Assigned', 'Bulk even distribution'
  from _done d;

  insert into public.notifications (user_id, type, title, message)
  select d.uid, 'assignment', 'عملاء جدد', 'تم توزيع ' || count(*) || ' عميل عليك'
  from _done d group by d.uid;

  return query select x.uid, x.c::int from (select uid, count(*) c from _done group by uid) x;
end $function$;

-- get_funnel_stats
CREATE OR REPLACE FUNCTION public.get_funnel_stats(p_from date DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date, p_to date DEFAULT CURRENT_DATE)
 RETURNS TABLE(user_id uuid, full_name text, role text, leads_received bigint, leads_contacted bigint, leads_interested bigint, meeting_requests bigint, requests_received bigint, meetings_held bigint, deals_count bigint, revenue_sar numeric, avg_hours_to_first_call numeric, avg_hours_to_respond numeric, avg_days_meeting_to_deal numeric, avg_days_deal_to_payment numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as (select p_from::timestamptz as s, (p_to + 1)::timestamptz as e),
  people as (
    select u.id, u.full_name, u.role from public.users u
    where u.role in ('telesales','sales', 'sales_telesales') and u.id in (select public.visible_user_ids())
  ),
  cohort as (
    select l.id as lead_id, l.assigned_to as uid, l.assigned_at
    from public.leads l, r
    where l.assigned_to is not null and l.assigned_at >= r.s and l.assigned_at < r.e
  ),
  firstcall as (
    select c.lead_id, min(a.created_at) as fc
    from cohort c join public.activity_logs a
      on a.lead_id = c.lead_id and a.activity_type = 'call' and a.created_at >= c.assigned_at
    group by c.lead_id
  ),
  hot as (
    select distinct c.lead_id
    from cohort c join public.activity_logs a
      on a.lead_id = c.lead_id and a.activity_type = 'call' and a.created_at >= c.assigned_at
     and a.outcome in ('Interested','Free Trial','Subscribed','Converted')
  ),
  tele as (
    select c.uid, count(*) as received, count(f.fc) as contacted, count(h.lead_id) as interested,
           avg(extract(epoch from f.fc - c.assigned_at) / 3600) as avg_h
    from cohort c
    left join firstcall f on f.lead_id = c.lead_id
    left join hot h on h.lead_id = c.lead_id
    group by c.uid
  ),
  reqs_made as (
    select mr.requested_by as uid, count(*) as n from public.meeting_requests mr, r
    where mr.created_at >= r.s and mr.created_at < r.e and mr.status <> 'cancelled' group by 1
  ),
  reqs_recv as (
    select mr.assigned_sales_id as uid, count(*) as n,
           avg(extract(epoch from mr.updated_at - mr.created_at) / 3600)
             filter (where mr.status in ('accepted','declined')) as avg_h
    from public.meeting_requests mr, r
    where mr.created_at >= r.s and mr.created_at < r.e and mr.status <> 'cancelled' group by 1
  ),
  held as (
    select m.assigned_sales_id as uid, count(*) as n from public.meetings m, r
    where m.proposed_date >= r.s and m.proposed_date < r.e and m.outcome not in ('Scheduled','Rescheduled') group by 1
  ),
  deals_in as (
    select d.id, d.lead_id, d.price_sar, d.created_at, d.approved_at, d.sales_user_id, d.telesales_user_id
    from public.deals d, r
    where d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
  ),
  deal_people as (
    select sales_user_id as uid, id as deal_id from deals_in where sales_user_id is not null
    union all
    select telesales_user_id, id from deals_in where telesales_user_id is not null
  ),
  deal_agg as (
    select dp.uid, count(*) as n, sum(di.price_sar) as rev
    from deal_people dp join deals_in di on di.id = dp.deal_id group by dp.uid
  ),
  m2d as (
    select di.sales_user_id as uid,
           avg(greatest(extract(epoch from di.created_at - mt.proposed_date) / 86400, 0)) as avg_d
    from deals_in di
    join lateral (select m.proposed_date from public.meetings m
                  where m.lead_id = di.lead_id and m.assigned_sales_id = di.sales_user_id
                  order by m.proposed_date desc limit 1) mt on true
    where di.sales_user_id is not null group by di.sales_user_id
  ),
  d2p as (
    select dp.uid, avg(greatest(extract(epoch from fp.first_paid - di.approved_at) / 86400, 0)) as avg_d
    from deal_people dp
    join deals_in di on di.id = dp.deal_id
    join lateral (select min(p.paid_at) as first_paid from public.payments p
                  where p.deal_id = di.id and p.confirmed) fp on fp.first_paid is not null
    group by dp.uid
  )
  select pe.id, pe.full_name, pe.role,
         coalesce(t.received, 0), coalesce(t.contacted, 0), coalesce(t.interested, 0),
         coalesce(rm.n, 0), coalesce(rr.n, 0), coalesce(h.n, 0),
         coalesce(da.n, 0), coalesce(da.rev, 0),
         round(t.avg_h::numeric, 1), round(rr.avg_h::numeric, 1),
         round(m2d.avg_d::numeric, 1), round(d2p.avg_d::numeric, 1)
  from people pe
  left join tele t on t.uid = pe.id
  left join reqs_made rm on rm.uid = pe.id
  left join reqs_recv rr on rr.uid = pe.id
  left join held h on h.uid = pe.id
  left join deal_agg da on da.uid = pe.id
  left join m2d on m2d.uid = pe.id
  left join d2p on d2p.uid = pe.id
  order by pe.role, pe.full_name
$function$;

-- get_payroll
CREATE OR REPLACE FUNCTION public.get_payroll(p_month date DEFAULT CURRENT_DATE)
 RETURNS TABLE(user_id uuid, full_name text, role text, deals_count bigint, commission_sar numeric, commission_egp numeric, base_salary numeric, base_currency text, total_sar numeric, total_egp numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cfg as (
    select date_trunc('month', p_month)::timestamptz as s,
           (date_trunc('month', p_month) + interval '1 month')::timestamptz as e,
           coalesce((select value from public.app_settings where key = 'commission_basis'), 'deal_value') as basis,
           coalesce(public.current_sar_to_egp(), 0) as fx
  ),
  lines as (
    select dc.user_id, dc.deal_id,
      case when c.basis = 'deal_value' then d.price_sar * dc.percent / 100
           else coalesce((select sum(p.amount_sar) from public.payments p
                          where p.deal_id = d.id and p.confirmed and p.paid_at >= c.s and p.paid_at < c.e), 0) * dc.percent / 100 end as c_sar,
      case when c.basis = 'deal_value' then d.price_sar * coalesce(d.fx_at_approval, c.fx) * dc.percent / 100
           else coalesce((select sum(p.amount_egp) from public.payments p
                          where p.deal_id = d.id and p.confirmed and p.paid_at >= c.s and p.paid_at < c.e), 0) * dc.percent / 100 end as c_egp
    from public.deal_commissions dc
    join public.deals d on d.id = dc.deal_id
    cross join cfg c
    where d.status in ('approved','active')
      and (c.basis <> 'deal_value' or (d.approved_at >= c.s and d.approved_at < c.e))
  ),
  agg as (select user_id, count(distinct deal_id) filter (where c_sar > 0) as n, sum(c_sar) as s, sum(c_egp) as e
          from lines group by user_id)
  select u.id, u.full_name, u.role, coalesce(a.n, 0),
         round(coalesce(a.s, 0), 2), round(coalesce(a.e, 0), 2),
         coalesce(r.base_salary, 0), coalesce(r.base_currency, 'EGP'),
         round(coalesce(a.s, 0) + case when coalesce(r.base_currency, 'EGP') = 'SAR' then coalesce(r.base_salary, 0)
                                       when c.fx > 0 then coalesce(r.base_salary, 0) / c.fx else 0 end, 2),
         round(coalesce(a.e, 0) + case when coalesce(r.base_currency, 'EGP') = 'EGP' then coalesce(r.base_salary, 0)
                                       else coalesce(r.base_salary, 0) * c.fx end, 2)
  from public.users u cross join cfg c
  left join agg a on a.user_id = u.id
  left join public.user_commission_rates r on r.user_id = u.id
  where u.role in ('sales','telesales','manager', 'sales_telesales')
    and (public.my_role() = 'admin' or u.id = auth.uid() or u.manager_id = auth.uid())
  order by u.role, u.full_name
$function$;

-- get_reports_summary
CREATE OR REPLACE FUNCTION public.get_reports_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read reports';
  end if;

  select jsonb_build_object(
    'leads', (
      select jsonb_build_object(
        'total',      count(*),
        'assigned',   count(*) filter (where assigned_to is not null),
        'contacted',  count(*) filter (where status in ('Contacted','Interested','Not Interested','Converted','Call Back Later','No Answer')),
        'interested', count(*) filter (where status = 'Interested'),
        'converted',  count(*) filter (where status = 'Converted'))
      from public.leads),
    'meetings', (
      select jsonb_build_object(
        'won',  count(*) filter (where outcome = 'Deal Closed – Won'),
        'lost', count(*) filter (where outcome = 'Deal Lost'))
      from public.meetings),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', s.source, 'count', s.n, 'converted', s.c) order by s.n desc)
      from (select coalesce(nullif(l.source, ''), 'Unknown') as source, count(*) as n,
                   count(*) filter (where l.status = 'Converted') as c
            from public.leads l group by 1) s), '[]'::jsonb),
    'telesales', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'full_name', u.full_name,
               'total', coalesce(l.n, 0), 'converted', coalesce(l.c, 0), 'calls', coalesce(a.n, 0)) order by u.full_name)
      from public.users u
      left join (select assigned_to, count(*) as n, count(*) filter (where status = 'Converted') as c
                 from public.leads where assigned_to is not null group by 1) l on l.assigned_to = u.id
      left join (select actor_id, count(*) as n
                 from public.activity_logs where activity_type = 'call' group by 1) a on a.actor_id = u.id
      where u.role in ('telesales', 'sales_telesales')), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'full_name', u.full_name,
               'total', coalesce(m.n, 0), 'won', coalesce(m.won, 0), 'lost', coalesce(m.lost, 0)) order by u.full_name)
      from public.users u
      left join (select assigned_sales_id, count(*) as n,
                        count(*) filter (where outcome = 'Deal Closed – Won') as won,
                        count(*) filter (where outcome = 'Deal Lost') as lost
                 from public.meetings group by 1) m on m.assigned_sales_id = u.id
      where u.role in ('sales', 'sales_telesales')), '[]'::jsonb)
  ) into result;

  return result;
end $function$;

-- get_target_progress_v2
CREATE OR REPLACE FUNCTION public.get_target_progress_v2(p_month date DEFAULT CURRENT_DATE)
 RETURNS TABLE(user_id uuid, full_name text, role text, manager_id uuid, team_size integer, calls_done bigint, meetings_done bigint, deals_done bigint, revenue_sar numeric, collected_sar numeric, calls_target integer, meetings_target integer, deals_target integer, revenue_target_sar numeric, calls_pct numeric, meetings_pct numeric, deals_pct numeric, revenue_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with r as (select date_trunc('month', p_month)::timestamptz as s,
                    (date_trunc('month', p_month) + interval '1 month')::timestamptz as e,
                    date_trunc('month', p_month)::date as m),
  me as (select auth.uid() as id, public.my_role() as role),
  base as (select * from public._month_stats(p_month, true)),
  -- الأشخاص اللي المستخدم الحالي مسموح يشوفهم
  vis as (
    select u.id, u.full_name, u.role, u.manager_id
    from public.users u, me
    where u.role in ('manager','sales','telesales', 'sales_telesales') and u.status = 'active'
      and (me.role = 'admin' or u.id = me.id or (me.role = 'manager' and u.manager_id = me.id))
  ),
  -- فريق كل مدير ظاهر (هو + اللي تحته)
  team as (
    select v.id as mgr, v.id as member from vis v where v.role = 'manager'
    union
    select v.id, u.id from vis v join public.users u on u.manager_id = v.id where v.role = 'manager'
  ),
  team_deals as (
    select t.mgr, d.id as deal_id, d.price_sar
    from team t join public.deals d on (d.sales_user_id = t.member or d.telesales_user_id = t.member or d.closed_by_user_id = t.member), r
    where d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
    group by t.mgr, d.id, d.price_sar
  ),
  team_agg as (
    select t.mgr,
           (select count(*) from team_deals x where x.mgr = t.mgr) as deals,
           (select coalesce(sum(price_sar), 0) from team_deals x where x.mgr = t.mgr) as rev,
           (select coalesce(sum(p.amount_sar), 0) from public.payments p, r
             where p.confirmed and p.paid_at >= r.s and p.paid_at < r.e
               and p.deal_id in (select deal_id from team_deals x where x.mgr = t.mgr)) as paid,
           coalesce(sum(b.calls_done), 0) as calls, coalesce(sum(b.meetings_done), 0) as meetings,
           count(*) filter (where t.member <> t.mgr) as size
    from team t left join base b on b.user_id = t.member and t.member <> t.mgr
    group by t.mgr
  ),
  user_deals as (
    select v.id as uid, d.id as deal_id, d.price_sar
    from vis v join public.deals d on v.id in (d.sales_user_id, d.telesales_user_id, d.closed_by_user_id), r
    where v.role in ('sales','telesales', 'sales_telesales') and d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
    group by v.id, d.id, d.price_sar
  ),
  user_deals_agg as (select uid, count(*) as n, sum(price_sar) as rev from user_deals group by uid),
  own_paid as (
    select d.closed_by_user_id as uid, sum(p.amount_sar) as paid
    from public.payments p join public.deals d on d.id = p.deal_id, r
    where p.confirmed and p.paid_at >= r.s and p.paid_at < r.e group by 1
  ),
  rows_ as (
    select v.id, v.full_name, v.role, v.manager_id, ta.size::int as team_size,
           ta.calls::bigint as calls, ta.meetings::bigint as meetings, ta.deals::bigint as deals, ta.rev as rev, ta.paid as paid
    from vis v join team_agg ta on ta.mgr = v.id where v.role = 'manager'
    union all
    select v.id, v.full_name, v.role, v.manager_id, 0, coalesce(b.calls_done, 0), coalesce(b.meetings_done, 0),
           coalesce(ud.n, 0), coalesce(ud.rev, 0), coalesce(op.paid, 0)
    from vis v left join base b on b.user_id = v.id left join own_paid op on op.uid = v.id left join user_deals_agg ud on ud.uid = v.id
    where v.role in ('sales','telesales', 'sales_telesales')
  )
  select x.id, x.full_name, x.role, x.manager_id, x.team_size, x.calls, x.meetings, x.deals, x.rev, x.paid,
         coalesce(t.calls_target, 0), coalesce(t.meetings_target, 0), coalesce(t.deals_target, 0), coalesce(t.revenue_target_sar, 0),
         round(x.calls * 100.0 / nullif(t.calls_target, 0), 1), round(x.meetings * 100.0 / nullif(t.meetings_target, 0), 1),
         round(x.deals * 100.0 / nullif(t.deals_target, 0), 1), round(x.rev * 100.0 / nullif(t.revenue_target_sar, 0), 1)
  from rows_ x cross join r left join public.user_targets t on t.user_id = x.id and t.month = r.m
  order by case x.role when 'manager' then 0 when 'sales' then 1 else 2 end, x.full_name
$function$;

-- get_team_performance
CREATE OR REPLACE FUNCTION public.get_team_performance(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(user_id uuid, full_name text, role text, manager_id uuid, manager_name text, base_salary numeric, base_currency text, closer_percent numeric, lead_percent numeric, manager_percent numeric, deals_count bigint, deals_value_sar numeric, collected_sar numeric, collected_egp numeric, collected_total_sar numeric, collected_total_egp numeric, commission_sar numeric, commission_egp numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cfg as (
    select coalesce(p_from, date '2000-01-01')::timestamptz as s,
           (coalesce(p_to, current_date) + 1)::timestamptz as e,
           coalesce((select value from public.app_settings where key = 'commission_basis'), 'deal_value') as basis,
           coalesce(public.current_sar_to_egp(), 0) as fx
  ),
  vis as (
    select u.id, u.full_name, u.role, u.manager_id
    from public.users u
    where u.role in ('manager','sales','telesales', 'sales_telesales')
      and (public.my_role() = 'admin' or u.id = auth.uid() or u.manager_id = auth.uid())
  ),
  dl as (
    select d.closed_by_user_id as uid, count(*) as n, sum(d.price_sar) as v
    from public.deals d cross join cfg c
    where d.status in ('approved','active') and d.approved_at >= c.s and d.approved_at < c.e
    group by 1
  ),
  pay as (
    select d.closed_by_user_id as uid,
      sum(p.amount_sar) filter (where p.paid_at >= c.s and p.paid_at < c.e) as ps,
      sum(p.amount_egp) filter (where p.paid_at >= c.s and p.paid_at < c.e) as pe,
      sum(p.amount_sar) as ts, sum(p.amount_egp) as te
    from public.payments p
    join public.deals d on d.id = p.deal_id and d.status in ('approved','active')
    cross join cfg c
    where p.confirmed
    group by 1
  ),
  lines as (
    select dc.user_id,
      case when c.basis = 'deal_value' then d.price_sar * dc.percent / 100
           else coalesce((select sum(p.amount_sar) from public.payments p
                          where p.deal_id = d.id and p.confirmed and p.paid_at >= c.s and p.paid_at < c.e), 0) * dc.percent / 100 end as c_sar,
      case when c.basis = 'deal_value' then d.price_sar * coalesce(d.fx_at_approval, c.fx) * dc.percent / 100
           else coalesce((select sum(p.amount_egp) from public.payments p
                          where p.deal_id = d.id and p.confirmed and p.paid_at >= c.s and p.paid_at < c.e), 0) * dc.percent / 100 end as c_egp
    from public.deal_commissions dc
    join public.deals d on d.id = dc.deal_id
    cross join cfg c
    where d.status in ('approved','active')
      and (c.basis <> 'deal_value' or (d.approved_at >= c.s and d.approved_at < c.e))
  ),
  cm as (select user_id as uid, sum(c_sar) as s, sum(c_egp) as e from lines group by 1)
  select v.id, v.full_name, v.role, v.manager_id, m.full_name,
         coalesce(r.base_salary, 0), coalesce(r.base_currency, 'EGP'),
         coalesce(r.closer_percent, 0), coalesce(r.lead_percent, 0), coalesce(r.manager_percent, 0),
         coalesce(dl.n, 0), round(coalesce(dl.v, 0), 2),
         round(coalesce(pay.ps, 0), 2), round(coalesce(pay.pe, 0), 2),
         round(coalesce(pay.ts, 0), 2), round(coalesce(pay.te, 0), 2),
         round(coalesce(cm.s, 0), 2), round(coalesce(cm.e, 0), 2)
  from vis v
  left join public.users m on m.id = v.manager_id
  left join public.user_commission_rates r on r.user_id = v.id
  left join dl on dl.uid = v.id
  left join pay on pay.uid = v.id
  left join cm on cm.uid = v.id
  order by case v.role when 'manager' then 0 when 'sales' then 1 else 2 end, v.full_name
$function$;

-- lookup_client_for_deal
CREATE OR REPLACE FUNCTION public.lookup_client_for_deal(p_code text)
 RETURNS TABLE(found boolean, eligible boolean, reason text, lead_id uuid, client_code text, customer_number bigint, name text, phone text, company text, region text, status text, owner_name text, meeting_date timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid(); my_r text := public.my_role();
  code text := btrim(coalesce(p_code, ''));
  l public.leads; ok boolean := false; why text := null; owner text; mdate timestamptz;
  team uuid[];
begin
  if me is null or my_r not in ('admin','manager','sales','telesales', 'sales_telesales') then
    return query select false, false, 'Not allowed', null::uuid, null::text, null::bigint, null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if code = '' then
    return query select false, false, 'Enter a client code', null::uuid, null::text, null::bigint, null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select x.* into l from public.leads x
  where lower(x.client_code) = lower(code)
     or (code ~ '^\d{1,15}$' and x.customer_number = code::bigint)
     or (public.phone_key(code) is not null and x.phone_key = public.phone_key(code))
  order by (lower(x.client_code) = lower(code)) desc, x.created_at
  limit 1;

  if not found then
    return query select false, false, 'No client found with this code', null::uuid, null::text, null::bigint, null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select m.proposed_date into mdate from public.meetings m
   where m.lead_id = l.id and (my_r in ('admin') or m.assigned_sales_id = me
          or (my_r = 'manager' and m.assigned_sales_id in (select u.id from public.users u where u.manager_id = me)))
   order by m.proposed_date desc limit 1;

  if my_r = 'admin' then ok := true;
  elsif my_r = 'telesales' then
    ok := coalesce(l.assigned_to = me, false);
    if not ok then why := 'This client is not assigned to you'; end if;
  elsif my_r = 'sales_telesales' then
    ok := coalesce(l.assigned_to = me, false) or mdate is not null;
    if not ok then why := 'This client is not assigned to you and has no meeting with you'; end if;
  elsif my_r = 'sales' then
    ok := mdate is not null;
    if not ok then why := 'You can only close clients who have a meeting assigned to you'; end if;
  else -- manager: عميل تيلي من فريقه أو اجتماع لسيلز من فريقه
    select array_agg(u.id) into team from public.users u where u.manager_id = me;
    ok := coalesce(l.assigned_to = any(coalesce(team, '{}')), false) or mdate is not null;
    if not ok then why := 'This client does not belong to your team'; end if;
  end if;

  if ok and exists (select 1 from public.deals d where d.lead_id = l.id and d.status in ('draft','contract_uploaded','pending_approval','approved','active')) then
    why := 'Note: this client already has an open or active deal';
  end if;

  if not ok then
    return query select true, false, why, null::uuid, null::text, null::bigint, null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select u.full_name into owner from public.users u where u.id = l.assigned_to;
  return query select true, true, why, l.id, l.client_code, l.customer_number, l.name, l.phone, l.company, l.region, l.status, owner, mdate;
end $function$;

-- mark_meeting_lost
CREATE OR REPLACE FUNCTION public.mark_meeting_lost(target_meeting_id uuid, p_reason_code text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.meetings; v_role text := public.my_role(); v_label text;
begin
  select * into m from public.meetings where id = target_meeting_id for update;
  if not found then raise exception 'Meeting not found'; end if;
  if not (
    (v_role in ('sales', 'sales_telesales') and m.assigned_sales_id = auth.uid())
    or v_role = 'admin'
    or (v_role = 'manager' and exists (select 1 from public.users u where u.id = m.assigned_sales_id and u.manager_id = auth.uid()))
  ) then raise exception 'Not allowed'; end if;
  if m.outcome = 'Deal Closed – Won' then raise exception 'This meeting already ended with a deal'; end if;
  select label_ar into v_label from public.loss_reasons where code = p_reason_code and is_active;
  if v_label is null then raise exception 'Choose a valid loss reason'; end if;

  update public.meetings set outcome = 'Deal Lost', loss_reason = p_reason_code, loss_note = nullif(trim(p_note), '')
   where id = target_meeting_id;
  update public.leads set status = 'Did Not Subscribe', loss_reason = p_reason_code,
         loss_note = nullif(trim(p_note), ''), needs_meeting = false, updated_at = now()
   where id = m.lead_id;
  insert into public.notifications (user_id, type, title, message)
  values (m.booked_by, 'meeting', 'الميتنج انتهى بدون صفقة', 'السبب: ' || v_label);
end $function$;

-- reassign_meeting_request
CREATE OR REPLACE FUNCTION public.reassign_meeting_request(target_request_id uuid, target_sales_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  caller_status text;
  request_row public.meeting_requests%rowtype;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is null or caller_status is distinct from 'active' or caller_role not in ('admin', 'manager') then
    raise exception 'You are not allowed to reassign meeting requests';
  end if;

  select * into request_row
  from public.meeting_requests r
  where r.id = target_request_id
  for update;

  if not found then
    raise exception 'Meeting request not found';
  end if;
  if caller_role in ('telesales', 'sales_telesales') and request_row.requested_by is distinct from auth.uid() then
    raise exception 'You can only reassign your own meeting requests';
  end if;
  if caller_role = 'manager' and (
    not exists (
      select 1 from public.users u
      where u.manager_id = auth.uid()
        and u.id in (request_row.requested_by, request_row.assigned_sales_id)
    )
    or not exists (
      select 1 from public.users u
      where u.id = target_sales_id
        and u.manager_id = auth.uid()
    )
  ) then
    raise exception 'You can only reassign requests within your team';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Only pending meeting requests can be reassigned';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = target_sales_id
      and u.role in ('sales', 'sales_telesales')
      and u.status = 'active'
  ) then
    raise exception 'Choose an active sales user';
  end if;

  update public.meeting_requests
  set assigned_sales_id = target_sales_id, updated_at = now()
  where id = target_request_id;

  insert into public.notifications (user_id, type, title, message)
  values (target_sales_id, 'meeting', 'Meeting request reassigned', 'A meeting request was assigned to you.');
end;
$function$;

-- reassign_user_leads
CREATE OR REPLACE FUNCTION public.reassign_user_leads(p_from_user uuid, p_to_user uuid DEFAULT NULL::uuid, p_only_open boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.my_role(); v_actor public.users; v_ids uuid[]; v_n int;
begin
  if v_role not in ('admin','manager') then raise exception 'Only admin or manager'; end if;
  if v_role = 'manager' and not exists (select 1 from public.users where id = p_from_user and manager_id = auth.uid()) then
    raise exception 'You can only move leads of your own team';
  end if;
  if p_to_user is not null and not exists (
       select 1 from public.users u where u.id = p_to_user and u.role in ('telesales','manager','admin', 'sales_telesales') and u.status = 'active'
         and (v_role = 'admin' or u.manager_id = auth.uid() or u.id = auth.uid())) then
    raise exception 'Target must be an active telesales user you can manage';
  end if;
  select * into v_actor from public.users where id = auth.uid();

  select array_agg(id) into v_ids from public.leads
   where assigned_to = p_from_user
     and (not p_only_open or status not in ('Subscribed','Converted','Did Not Subscribe','Not Interested'));
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return 0; end if;

  update public.leads
     set assigned_to = p_to_user,
         status = case when p_to_user is null and status = 'Assigned' then 'New'
                       when p_to_user is not null and status = 'New' then 'Assigned' else status end,
         updated_at = now()
   where id = any(v_ids);

  insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
  select x, auth.uid(), coalesce(v_actor.full_name, '-'), v_actor.role, 'assignment',
         case when p_to_user is null then 'Unassigned' else 'Reassigned' end, 'Moved from another user'
  from unnest(v_ids) x;

  if p_to_user is not null then
    insert into public.notifications (user_id, type, title, message)
    values (p_to_user, 'assignment', 'عملاء جدد', 'تم تحويل ' || v_n || ' عميل ليك');
  end if;
  return v_n;
end $function$;

-- request_contract_review
CREATE OR REPLACE FUNCTION public.request_contract_review(target_deal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  deal_row public.deals%rowtype;
  latest_review public.contract_reviews%rowtype;
  new_review_id uuid;
begin
  select u.role into caller_role
  from public.users u
  where u.id = auth.uid()
    and u.status = 'active';

  if caller_role is null
    or caller_role not in ('sales', 'telesales', 'admin', 'manager', 'sales_telesales')
  then
    raise exception 'You are not allowed to request a contract review';
  end if;

  select * into deal_row
  from public.deals d
  where d.id = target_deal_id;
  if not found or deal_row.contract_path is null then
    raise exception 'Upload a contract before requesting a review';
  end if;
  if deal_row.status in ('approved', 'active', 'cancelled') then
    raise exception 'Cannot review a deal after it has been approved';
  end if;

  select * into latest_review
  from public.contract_reviews r
  where r.deal_id = target_deal_id
  order by r.created_at desc, r.id desc
  limit 1;

  if not found then
    raise exception 'Upload a contract before requesting a review';
  end if;
  if caller_role <> 'admin'
    and latest_review.submitted_by <> auth.uid()
    and not exists (
      select 1
      from public.users team_member
      where team_member.id = latest_review.submitted_by
        and team_member.manager_id = auth.uid()
    )
  then
    raise exception 'You can only request reviews for your own deals or your team';
  end if;
  if latest_review.status in ('queued', 'processing') then
    if latest_review.processing_started_at is not null
      and latest_review.processing_started_at > now() - interval '3 minutes'
    then
      raise exception 'A contract review is already processing';
    end if;

    update public.contract_reviews
    set status = 'failed',
        error = 'Contract review timed out before completion',
        completed_at = now(),
        updated_at = now()
    where id = latest_review.id;
  end if;
  insert into public.contract_reviews (
    deal_id, contract_paths, submitted_by, requested_by,
    status, processing_started_at
  )
  values (
    latest_review.deal_id, latest_review.contract_paths,
    latest_review.submitted_by, auth.uid(), 'queued', now()
  )
  returning id into new_review_id;

  return new_review_id;
end;
$function$;

-- request_meeting
CREATE OR REPLACE FUNCTION public.request_meeting(target_lead_id uuid, target_sales_id uuid, request_notes text DEFAULT NULL::text, preferred_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare caller_role text; caller_status text; lead_owner uuid; request_id uuid;
begin
  select u.role, u.status into caller_role, caller_status from public.users u where u.id = auth.uid();
  if caller_role is null or caller_role not in ('telesales','manager','admin', 'sales_telesales') or caller_status is distinct from 'active' then
    raise exception 'Only telesales, manager or admin users can request a meeting';
  end if;
  select l.assigned_to into lead_owner from public.leads l where l.id = target_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if caller_role in ('telesales', 'sales_telesales') and lead_owner is distinct from auth.uid() then
    raise exception 'You can only request meetings for leads assigned to you';
  end if;
  if caller_role = 'manager' and lead_owner is not null and lead_owner <> auth.uid()
     and not exists (select 1 from public.users u where u.id = lead_owner and u.manager_id = auth.uid()) then
    raise exception 'You can only request meetings for your own or your team leads';
  end if;
  if not exists (select 1 from public.users u where u.id = target_sales_id and u.role in ('sales','manager','admin', 'sales_telesales') and u.status = 'active') then
    raise exception 'Choose an active sales, manager or admin user';
  end if;
  if preferred_meeting_date is not null and preferred_meeting_date <= now() then
    raise exception 'Preferred meeting time must be in the future';
  end if;
  insert into public.meeting_requests (lead_id, requested_by, assigned_sales_id, notes, preferred_date)
  values (target_lead_id, auth.uid(), target_sales_id, nullif(trim(request_notes), ''), preferred_meeting_date)
  returning id into request_id;
  update public.leads set needs_meeting = true where id = target_lead_id;
  if target_sales_id <> auth.uid() then
    insert into public.notifications (user_id, type, title, message)
    select target_sales_id, 'meeting', 'Meeting request', 'A meeting was requested for ' || l.name || '.'
    from public.leads l where l.id = target_lead_id;
  end if;
  return request_id;
end $function$;

-- run_auto_distribution
CREATE OR REPLACE FUNCTION public.run_auto_distribution(p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where u.role in ('telesales','manager','admin', 'sales_telesales') and u.status = 'active'
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
end $function$;

-- set_auto_distribution
CREATE OR REPLACE FUNCTION public.set_auto_distribution(p_enabled boolean, p_user_ids uuid[], p_max_open integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can change auto-distribution'; end if;
  if p_enabled and coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'Choose at least one telesales user';
  end if;
  if exists (select 1 from unnest(coalesce(p_user_ids, '{}')) x
             where not exists (select 1 from public.users u where u.id = x and u.role in ('telesales','manager','admin', 'sales_telesales') and u.status = 'active')) then
    raise exception 'The list contains a user who is not an active telesales';
  end if;
  if p_max_open is not null and p_max_open < 1 then raise exception 'Max open leads must be at least 1'; end if;

  insert into public.app_settings (key, value) values
    ('auto_distribute_enabled', case when p_enabled then 'true' else 'false' end),
    ('auto_distribute_users', coalesce(array_to_string(p_user_ids, ','), '')),
    ('auto_distribute_max_open', coalesce(p_max_open::text, ''))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'saved';
end $function$;

-- snapshot_deal_commissions
CREATE OR REPLACE FUNCTION public.snapshot_deal_commissions(p_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.deals; v_closer public.users; v_member public.users; v_pct numeric;
begin
  select * into d from public.deals where id = p_deal_id;
  select * into v_closer from public.users where id = d.closed_by_user_id;
  if v_closer.role in ('sales','telesales','manager','admin', 'sales_telesales') then
    v_pct := coalesce((select closer_percent from public.user_commission_rates where user_id = v_closer.id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, v_closer.id,
            case v_closer.role when 'sales' then 'closer_sales' when 'sales_telesales' then (case when d.sales_user_id = v_closer.id then 'closer_sales' else 'closer_telesales' end) when 'telesales' then 'closer_telesales' when 'manager' then 'closer_manager' else 'closer_admin' end,
            v_closer.id, v_pct)
    on conflict do nothing;
  end if;
  if d.telesales_user_id is not null and d.telesales_user_id <> d.closed_by_user_id and exists (select 1 from public.users t where t.id = d.telesales_user_id and t.role in ('telesales', 'sales_telesales')) then
    v_pct := coalesce((select lead_percent from public.user_commission_rates where user_id = d.telesales_user_id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, d.telesales_user_id, 'lead_telesales', d.telesales_user_id, v_pct)
    on conflict do nothing;
  end if;
  for v_member in
    select u.* from public.users u
    where u.id in (d.closed_by_user_id, case when exists (select 1 from public.users t where t.id = d.telesales_user_id and t.role in ('telesales', 'sales_telesales')) then d.telesales_user_id end) and u.manager_id is not null and u.role in ('sales','telesales', 'sales_telesales')
  loop
    v_pct := coalesce((select manager_percent from public.user_commission_rates where user_id = v_member.id), 0);
    if v_pct > 0 then
      insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
      values (p_deal_id, v_member.manager_id, 'manager', v_member.id, v_pct)
      on conflict do nothing;
    end if;
  end loop;
end $function$;

-- update_meeting_outcome
CREATE OR REPLACE FUNCTION public.update_meeting_outcome(target_meeting_id uuid, new_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_role text;
  caller_status text;
  meeting_row public.meetings%rowtype;
begin
  select u.role, u.status into caller_role, caller_status
  from public.users u
  where u.id = auth.uid();

  if caller_role is null or caller_status is distinct from 'active' or caller_role not in ('sales', 'admin', 'manager', 'sales_telesales') then
    raise exception 'You are not allowed to update meeting outcomes';
  end if;
  if new_outcome is null or new_outcome not in ('Scheduled', 'Deal Closed – Won', 'Deal Lost', 'Rescheduled', 'No-Show') then
    raise exception 'Invalid meeting outcome';
  end if;
  if caller_role in ('sales', 'sales_telesales') and new_outcome not in ('Rescheduled', 'No-Show', 'Deal Lost') then
    raise exception 'Sales can set an outcome to Rescheduled, No-Show, or Deal Lost';
  end if;

  select * into meeting_row
  from public.meetings m
  where m.id = target_meeting_id
  for update;

  if not found then
    raise exception 'Meeting not found';
  end if;
  if caller_role in ('sales', 'sales_telesales') and meeting_row.assigned_sales_id is distinct from auth.uid() then
    raise exception 'You can only update outcomes for your meetings';
  end if;
  if caller_role = 'manager' and not exists (
    select 1 from public.users u
    where u.manager_id = auth.uid()
      and u.id in (meeting_row.booked_by, meeting_row.assigned_sales_id)
  ) then
    raise exception 'You can only update outcomes for your team';
  end if;

  update public.meetings
  set outcome = new_outcome
  where id = target_meeting_id;
end;
$function$;

-- ---------- check ----------
select
  (select pg_get_constraintdef(oid) like '%sales_telesales%' from pg_constraint where conname = 'users_role_check') as role_allowed,          -- true
  (select count(*) from public.role_default_permissions where role = 'sales_telesales') as permissions,                                       -- 3 or more
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%sales_telesales%') as functions_updated;                                  -- 32

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
