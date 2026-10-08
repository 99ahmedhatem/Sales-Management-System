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
