-- 058 (originally pasted as "061"; saved under the next free number). Already run on Supabase.
-- ⚠️ Run 059 after it: this file uses meetings.booked_by_id (not in the repo) and role_in_deal 'closer_admin'
--    (not allowed by 055's check) — 059 fixes both.
-- 061: الأدمن والمدير يشتغلوا بنفسهم (يحجزوا اجتماعات، يقبلوها، يقفلوا صفقات، ياخدوا عمولة) بدون ما يتأثر باقي الفريق

-- ===== 1) طلب اجتماع: تيلي سيلز / مدير / أدمن، والمضيف سيلز أو مدير أو أدمن =====
create or replace function public.request_meeting(target_lead_id uuid, target_sales_id uuid, request_notes text default null, preferred_meeting_date timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare caller_role text; caller_status text; lead_owner uuid; request_id uuid;
begin
  select u.role, u.status into caller_role, caller_status from public.users u where u.id = auth.uid();
  if caller_role is null or caller_role not in ('telesales','manager','admin') or caller_status is distinct from 'active' then
    raise exception 'Only telesales, manager or admin users can request a meeting';
  end if;
  select l.assigned_to into lead_owner from public.leads l where l.id = target_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if caller_role = 'telesales' and lead_owner is distinct from auth.uid() then
    raise exception 'You can only request meetings for leads assigned to you';
  end if;
  if caller_role = 'manager' and lead_owner is not null and lead_owner <> auth.uid()
     and not exists (select 1 from public.users u where u.id = lead_owner and u.manager_id = auth.uid()) then
    raise exception 'You can only request meetings for your own or your team leads';
  end if;
  if not exists (select 1 from public.users u where u.id = target_sales_id and u.role in ('sales','manager','admin') and u.status = 'active') then
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

-- ===== 2) قبول / رفض الطلب: سيلز أو مدير أو أدمن (المعيّن عليه الطلب، والأدمن أي طلب) =====
create or replace function public.accept_meeting_request(target_request_id uuid, target_proposed_date timestamptz)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare request_row public.meeting_requests%rowtype; caller_role text; caller_status text; created_meeting_id uuid; v_lead public.leads%rowtype;
begin
  select u.role, u.status into caller_role, caller_status from public.users u where u.id = auth.uid();
  if caller_role is null or caller_role not in ('sales','manager','admin') or caller_status is distinct from 'active' then
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

create or replace function public.decline_meeting_request(target_request_id uuid, decline_reason_text text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare caller_role text; caller_status text; request_row public.meeting_requests%rowtype;
begin
  select u.role, u.status into caller_role, caller_status from public.users u where u.id = auth.uid();
  if caller_role is null or caller_role not in ('sales','manager','admin') or caller_status is distinct from 'active' then
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

-- ===== 3) فحص صلاحية قفل الصفقة (مشترك بين الباقة والخدمة المخصصة) =====
create or replace function public._deal_check_access(p_lead uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare r text; s text; owner uuid; ok uuid;
begin
  select u.role, u.status into r, s from public.users u where u.id = auth.uid();
  if r is null or r not in ('sales','telesales','manager','admin') or s is distinct from 'active' then
    raise exception 'Only an active sales, telesales, manager or admin user can create deals';
  end if;
  select l.assigned_to into owner from public.leads l where l.id = p_lead for share;
  if not found then raise exception 'Lead not found'; end if;
  if r = 'telesales' then
    if owner is distinct from auth.uid() then raise exception 'You can only close deals for leads assigned to you'; end if;
  elsif r = 'sales' then
    select m.assigned_sales_id into ok from public.meetings m where m.lead_id = p_lead and m.assigned_sales_id = auth.uid() order by m.proposed_date desc limit 1;
    if ok is null then raise exception 'You can only close a deal for a lead assigned to you through a meeting'; end if;
  elsif r = 'manager' then
    if owner is not null and owner <> auth.uid() and not exists (select 1 from public.users u where u.id = owner and u.manager_id = auth.uid())
       and not exists (select 1 from public.meetings m where m.lead_id = p_lead and m.assigned_sales_id = auth.uid()) then
      raise exception 'You can only close deals for your own or your team leads';
    end if;
  end if;
  return coalesce(owner, auth.uid());
end $function$;

create or replace function public.create_deal(target_lead_id uuid, target_package_id uuid, target_price_sar numeric, target_start_date date, deal_notes text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare caller_role text; lead_owner uuid; pkg public.packages%rowtype; v_commission_percent numeric; created_deal_id uuid;
begin
  if target_price_sar is null or target_price_sar < 0 then raise exception 'Enter a valid closing price in SAR'; end if;
  if target_start_date is null then raise exception 'Choose a deal start date'; end if;
  lead_owner := public._deal_check_access(target_lead_id);
  select role into caller_role from public.users where id = auth.uid();
  select * into pkg from public.packages p where p.id = target_package_id and p.is_active = true;
  if not found then raise exception 'Choose an active package'; end if;
  select commission_percent into v_commission_percent from public.users where id = auth.uid();
  insert into public.deals (lead_id, package_id, sales_user_id, telesales_user_id, closed_by_user_id, package_name, package_duration_months,
    list_price_sar, min_price_sar, price_sar, below_min_price, start_date, end_date, notes, commission_percent, commission_sar)
  values (target_lead_id, target_package_id, case when caller_role = 'sales' then auth.uid() else null end, lead_owner, auth.uid(),
    pkg.name, pkg.duration_months, pkg.price_sar, pkg.min_price_sar, target_price_sar, target_price_sar < pkg.min_price_sar,
    target_start_date, (target_start_date + make_interval(months => pkg.duration_months) - interval '1 day')::date, nullif(trim(deal_notes),''),
    coalesce(v_commission_percent,0), round(target_price_sar * coalesce(v_commission_percent,0) / 100, 2))
  returning id into created_deal_id;
  return created_deal_id;
end $function$;

create or replace function public.create_custom_deal(target_lead_id uuid, custom_service_name text, custom_duration_months integer, target_price_sar numeric, target_start_date date, deal_notes text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
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
  values (target_lead_id, null, case when caller_role = 'sales' then auth.uid() else null end, lead_owner, auth.uid(),
    trim(custom_service_name), custom_duration_months, target_price_sar, target_price_sar, target_price_sar, false,
    target_start_date, (target_start_date + make_interval(months => custom_duration_months) - interval '1 day')::date, nullif(trim(deal_notes),''),
    coalesce(v_commission_percent,0), round(target_price_sar * coalesce(v_commission_percent,0) / 100, 2))
  returning id into created_deal_id;
  return created_deal_id;
end $function$;

revoke execute on function public._deal_check_access(uuid) from public, anon, authenticated;

-- ===== 4) العمولة: الأدمن لو قفل صفقة ياخد نسبة الإقفال بتاعته =====
create or replace function public.snapshot_deal_commissions(p_deal_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare d public.deals; v_closer public.users; v_member public.users; v_pct numeric;
begin
  select * into d from public.deals where id = p_deal_id;
  select * into v_closer from public.users where id = d.closed_by_user_id;
  if v_closer.role in ('sales','telesales','manager','admin') then
    v_pct := coalesce((select closer_percent from public.user_commission_rates where user_id = v_closer.id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, v_closer.id,
            case v_closer.role when 'sales' then 'closer_sales' when 'telesales' then 'closer_telesales' when 'manager' then 'closer_manager' else 'closer_admin' end,
            v_closer.id, v_pct)
    on conflict do nothing;
  end if;
  if d.telesales_user_id is not null and d.telesales_user_id <> d.closed_by_user_id then
    v_pct := coalesce((select lead_percent from public.user_commission_rates where user_id = d.telesales_user_id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, d.telesales_user_id, 'lead_telesales', d.telesales_user_id, v_pct)
    on conflict do nothing;
  end if;
  for v_member in
    select u.* from public.users u
    where u.id in (d.closed_by_user_id, d.telesales_user_id) and u.manager_id is not null and u.role in ('sales','telesales')
  loop
    v_pct := coalesce((select manager_percent from public.user_commission_rates where user_id = v_member.id), 0);
    if v_pct > 0 then
      insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
      values (p_deal_id, v_member.manager_id, 'manager', v_member.id, v_pct)
      on conflict do nothing;
    end if;
  end loop;
end $function$;

create or replace function public.refresh_deal_commission_cache(p_deal_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare p numeric;
begin
  select percent into p from public.deal_commissions
   where deal_id = p_deal_id and role_in_deal in ('closer_sales','closer_telesales','closer_manager','closer_admin')
   order by created_at limit 1;
  update public.deals d set commission_percent = p, commission_sar = case when p is null then null else round(d.price_sar * p / 100, 2) end where d.id = p_deal_id;
end $function$;
