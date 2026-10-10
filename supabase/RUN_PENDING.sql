-- =====================================================================
-- RUN_PENDING — الـ migrations اللي لسه ما اتشغّلتش في Supabase، بالترتيب.
-- حالياً: 032_auto_distribution (لو لسه) · 056_custom_deal_meeting_snapshot · 059_fix_admin_closer_and_booked_by_id · 061_package_manager_access. من 004 لحد 028 و 030 اتشغّلوا (030 بيغطي 029، فـ 029 ما يتشغّلش).
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
-- 061_package_manager_access.sql
-- 061 (pasted as "065"; saved under the next free number). Safe to run more than once.
-- 065: التحكم في ظهور الباقات حسب المدير (وفريقه)
-- القاعدة: الباقة بدون أي مدير محدد = تظهر للجميع (زي ما هو الحال الآن، مفيش حاجة هتختفي).
--          الباقة المحددة لمديرين = تظهر لهؤلاء المديرين + فرقهم (users.manager_id) + الأدمن فقط.

create table if not exists public.package_manager_access (
  package_id uuid not null references public.packages(id) on delete cascade,
  manager_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, manager_id)
);
alter table public.package_manager_access enable row level security;
drop policy if exists pma_admin_all on public.package_manager_access;
create policy pma_admin_all on public.package_manager_access for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- هل المستخدم ده يقدر يشوف/يستخدم الباقة؟
create or replace function public.can_use_package(p_package uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.users u where u.id = p_user and u.role = 'admin')
    or not exists (select 1 from public.package_manager_access a where a.package_id = p_package)
    or exists (
      select 1 from public.package_manager_access a
      join public.users u on u.id = p_user
      where a.package_id = p_package and (a.manager_id = u.id or a.manager_id = u.manager_id)
    );
$$;
grant execute on function public.can_use_package(uuid, uuid) to authenticated;

-- قراءة الباقات المباشرة من الجدول تحترم نفس القاعدة
drop policy if exists "Authenticated users can read active packages" on public.packages;
create policy "Authenticated users can read active packages" on public.packages for select to authenticated
  using ((is_active and public.can_use_package(id)) or public.my_role() = 'admin');

-- list_packages تحترم القاعدة
create or replace function public.list_packages()
returns table(id uuid, name text, description text, features text[], duration_months int, price_sar numeric, min_price_sar numeric, is_active boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_min boolean;
begin
  if not public.has_permission('packages.view', auth.uid()) then raise exception 'not allowed'; end if;
  v_min := public.has_permission('packages.view_min_price', auth.uid());
  return query
    select p.id, p.name, p.description, p.features, p.duration_months, p.price_sar,
           case when v_min then p.min_price_sar else null end, p.is_active
    from public.packages p
    where (p.is_active and public.can_use_package(p.id)) or public.my_role() = 'admin'
    order by p.name, p.duration_months;
end $$;

-- create_deal ترفض باقة مش متاحة للمستخدم
do $$ declare def text; begin
  select pg_get_functiondef(p.oid) into def from pg_proc p where p.proname='create_deal' and p.pronamespace='public'::regnamespace;
  if position('can_use_package' in def) = 0 then
    def := replace(def, 'p.id = target_package_id and p.is_active = true', 'p.id = target_package_id and p.is_active = true and public.can_use_package(p.id)');
    execute def;
  end if;
end $$;

-- للأدمن: قراءة وتعديل الإتاحة
create or replace function public.get_package_access()
returns table(package_id uuid, manager_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select a.package_id, a.manager_id from public.package_manager_access a;
end $$;
grant execute on function public.get_package_access() to authenticated;

-- p_manager_ids فاضية/null = الباقة تظهر للجميع
create or replace function public.set_package_access(p_package_id uuid, p_manager_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  delete from public.package_manager_access where package_id = p_package_id;
  insert into public.package_manager_access(package_id, manager_id)
    select p_package_id, u.id from public.users u
    where u.id = any(coalesce(p_manager_ids, '{}')) and u.role = 'manager';
end $$;
grant execute on function public.set_package_access(uuid, uuid[]) to authenticated;

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
  'get_audit_feed','get_audit_tables','get_team_performance','admin_set_user_pay','get_reports_summary','get_team_lead_stats','admin_get_user_pay','admin_update_user','lookup_client_for_deal','get_target_progress_v2','admin_set_target','distribute_unassigned_leads','count_unassigned_leads','get_auto_distribution','set_auto_distribution','run_auto_distribution','run_daily_jobs','create_custom_deal','can_use_package','get_package_access','set_package_access'
]) f
where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)
union all
select 'missing view/table', t
from unnest(array['monthly_revenue','audit_log','user_commission_rates','user_targets','activity_logs','client_comments','notifications','packages',
                  'meeting_requests','meetings','deals','contract_reviews','users','leads']) t
where to_regclass('public.' || t) is null;
