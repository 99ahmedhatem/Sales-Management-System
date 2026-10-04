-- =====================================================================
-- 008 — الفلوس: دفعات + سعر صرف + عمولات + مرتبات + إيراد الشهر
-- بيتشغّل بعد 007_contract_reviews.sql. مبني على جدول deals بتاع الـ AI:
--   closed_by_user_id (اللي قفل) / sales_user_id / telesales_user_id (صاحب العميل)
-- ما بيعدّلش على دوال الـ AI (approve_deal...)، بيشتغل بـ triggers عليها.
-- آمن لو اتشغّل مرتين.
-- =====================================================================

-- ---------- helpers ----------
create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  sar_to_egp numeric(10,4) not null check (sar_to_egp > 0),
  effective_date date not null default current_date,
  set_by uuid references public.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists exchange_rates_date_idx on public.exchange_rates (effective_date desc, created_at desc);
alter table public.exchange_rates enable row level security;
drop policy if exists "fx read" on public.exchange_rates;
create policy "fx read" on public.exchange_rates for select to authenticated using (true);
drop policy if exists "fx admin write" on public.exchange_rates;
create policy "fx admin write" on public.exchange_rates for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create or replace function public.current_sar_to_egp()
returns numeric language sql stable security definer set search_path = public as $$
  select sar_to_egp from public.exchange_rates order by effective_date desc, created_at desc limit 1
$$;
grant execute on function public.current_sar_to_egp() to authenticated;

create or replace function public.notify_admins(p_title text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, message)
  select id, 'system', p_title, p_message from public.users where role = 'admin' and status = 'active'
$$;
revoke execute on function public.notify_admins(text, text) from public, anon, authenticated;

-- مين يقدر يشوف الصفقة (أدمن / اللي قفل / السيلز / التيلي / مانجر أي واحد منهم)
create or replace function public.can_access_deal(p_deal_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.deals d
    where d.id = p_deal_id and (
      public.my_role() = 'admin'
      or auth.uid() in (d.closed_by_user_id, d.sales_user_id, d.telesales_user_id)
      or exists (select 1 from public.users u
                 where u.manager_id = auth.uid()
                   and u.id in (d.closed_by_user_id, d.sales_user_id, d.telesales_user_id))
    )
  )
$$;
grant execute on function public.can_access_deal(uuid) to authenticated;

-- ---------- إعدادات ----------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings read" on public.app_settings;
create policy "settings read" on public.app_settings for select to authenticated using (true);
drop policy if exists "settings admin write" on public.app_settings;
create policy "settings admin write" on public.app_settings for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
-- deal_value = العمولة على قيمة الديل وقت الموافقة | collected = على الفلوس المؤكدة في الشهر
insert into public.app_settings (key, value) values ('commission_basis', 'deal_value') on conflict do nothing;

-- ---------- نسب كل موظف + المرتب الأساسي ----------
create table if not exists public.user_commission_rates (
  user_id uuid primary key references public.users(id) on delete cascade,
  closer_percent  numeric(5,2) not null default 0 check (closer_percent  between 0 and 100),
  lead_percent    numeric(5,2) not null default 0 check (lead_percent    between 0 and 100),
  manager_percent numeric(5,2) not null default 0 check (manager_percent between 0 and 100),
  base_salary     numeric(12,2) not null default 0 check (base_salary >= 0),
  base_currency   text not null default 'EGP' check (base_currency in ('SAR','EGP')),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.user_commission_rates enable row level security;
drop policy if exists "rates read" on public.user_commission_rates;
create policy "rates read" on public.user_commission_rates for select to authenticated
  using (public.my_role() = 'admin' or user_id = auth.uid()
         or exists (select 1 from public.users u where u.id = user_commission_rates.user_id and u.manager_id = auth.uid()));
drop policy if exists "rates admin write" on public.user_commission_rates;
create policy "rates admin write" on public.user_commission_rates for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------- سعر الصرف وقت الموافقة ----------
alter table public.deals add column if not exists fx_at_approval numeric(10,4);

create or replace function public.trg_deals_before_approve()
returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.fx_at_approval := public.current_sar_to_egp();
  end if;
  return new;
end $$;
drop trigger if exists deals_before_approve on public.deals;
create trigger deals_before_approve before update of status on public.deals
  for each row execute function public.trg_deals_before_approve();

-- ---------- عمولات كل ديل (snapshot وقت الموافقة) ----------
create table if not exists public.deal_commissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  user_id uuid not null references public.users(id),
  role_in_deal text not null
    check (role_in_deal in ('closer_sales','closer_telesales','lead_telesales','manager')),
  source_user_id uuid not null references public.users(id),
  percent numeric(5,2) not null check (percent between 0 and 100),
  is_manual boolean not null default false,
  set_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists deal_commissions_unique on public.deal_commissions (deal_id, role_in_deal, source_user_id);
create index if not exists deal_commissions_user_idx on public.deal_commissions (user_id);
alter table public.deal_commissions enable row level security;
drop policy if exists "deal commissions read" on public.deal_commissions;
create policy "deal commissions read" on public.deal_commissions for select to authenticated
  using (public.my_role() = 'admin' or user_id = auth.uid()
         or exists (select 1 from public.users u where u.id = deal_commissions.user_id and u.manager_id = auth.uid()));
revoke insert, update, delete on public.deal_commissions from anon, authenticated;

create or replace function public.snapshot_deal_commissions(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.deals; v_closer public.users; v_member public.users; v_pct numeric;
begin
  select * into d from public.deals where id = p_deal_id;
  select * into v_closer from public.users where id = d.closed_by_user_id;

  -- 1) اللي قفل الديل (سيلز أو تيلي سيلز)
  if v_closer.role in ('sales','telesales') then
    v_pct := coalesce((select closer_percent from public.user_commission_rates where user_id = v_closer.id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, v_closer.id,
            case when v_closer.role = 'sales' then 'closer_sales' else 'closer_telesales' end, v_closer.id, v_pct)
    on conflict do nothing;
  end if;

  -- 2) التيلي سيلز صاحب العميل لو غير اللي قفل
  if d.telesales_user_id is not null and d.telesales_user_id <> d.closed_by_user_id then
    v_pct := coalesce((select lead_percent from public.user_commission_rates where user_id = d.telesales_user_id), 0);
    insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
    values (p_deal_id, d.telesales_user_id, 'lead_telesales', d.telesales_user_id, v_pct)
    on conflict do nothing;
  end if;

  -- 3) المانجر: نسبته على كل موظف تحته له علاقة بالديل
  for v_member in
    select u.* from public.users u
    where u.id in (d.closed_by_user_id, d.telesales_user_id)
      and u.manager_id is not null and u.role in ('sales','telesales')
  loop
    v_pct := coalesce((select manager_percent from public.user_commission_rates where user_id = v_member.id), 0);
    if v_pct > 0 then
      insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent)
      values (p_deal_id, v_member.manager_id, 'manager', v_member.id, v_pct)
      on conflict do nothing;
    end if;
  end loop;
end $$;
revoke execute on function public.snapshot_deal_commissions(uuid) from public, anon, authenticated;

create or replace function public.trg_deals_after_approve()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.snapshot_deal_commissions(new.id);
  return new;
end $$;
drop trigger if exists deals_after_approve on public.deals;
create trigger deals_after_approve after update of status on public.deals
  for each row when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function public.trg_deals_after_approve();

-- الأدمن يغيّر نسبة على ديل واحد بس
create or replace function public.set_deal_commission(
  p_deal_id uuid, p_user_id uuid, p_role_in_deal text, p_percent numeric, p_source_user_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_source uuid := coalesce(p_source_user_id, p_user_id);
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can change deal commissions'; end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then raise exception 'Percent must be between 0 and 100'; end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then raise exception 'Deal not found'; end if;
  insert into public.deal_commissions (deal_id, user_id, role_in_deal, source_user_id, percent, is_manual, set_by)
  values (p_deal_id, p_user_id, p_role_in_deal, v_source, p_percent, true, auth.uid())
  on conflict (deal_id, role_in_deal, source_user_id)
  do update set user_id = excluded.user_id, percent = excluded.percent, is_manual = true, set_by = auth.uid();
end $$;
grant execute on function public.set_deal_commission(uuid, uuid, text, numeric, uuid) to authenticated;

-- الأدمن يلغي صفقة (بتتشال من المرتبات تلقائي)
create or replace function public.cancel_deal(p_deal_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can cancel deals'; end if;
  update public.deals
     set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Cancelled: ' || coalesce(p_reason, '-'),
         updated_at = now()
   where id = p_deal_id and status <> 'cancelled';
  if not found then raise exception 'Deal not found or already cancelled'; end if;
end $$;
grant execute on function public.cancel_deal(uuid, text) to authenticated;

-- ---------- الدفعات ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency in ('SAR','EGP')),
  sar_to_egp numeric(10,4) not null check (sar_to_egp > 0),
  amount_sar numeric(12,2) generated always as (
    case when currency = 'SAR' then amount else round(amount / sar_to_egp, 2) end) stored,
  amount_egp numeric(12,2) generated always as (
    case when currency = 'EGP' then amount else round(amount * sar_to_egp, 2) end) stored,
  method text not null default 'bank_transfer'
    check (method in ('bank_transfer','cash','tabby','emkan','card','instapay','other')),
  reference text,
  receipt_path text,
  paid_at timestamptz not null default now(),
  received_by uuid references public.users(id),
  confirmed boolean not null default false,
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists payments_paid_at_idx on public.payments (paid_at);
create index if not exists payments_deal_idx on public.payments (deal_id);
alter table public.payments enable row level security;
drop policy if exists "payments read" on public.payments;
create policy "payments read" on public.payments for select to authenticated
  using (public.can_access_deal(deal_id));
revoke insert, update, delete on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

create or replace function public.record_payment(
  p_deal_id uuid, p_amount numeric, p_currency text,
  p_method text default 'bank_transfer', p_reference text default null,
  p_receipt_path text default null, p_paid_at timestamptz default now(), p_rate numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_deal public.deals; v_rate numeric := coalesce(p_rate, public.current_sar_to_egp());
  v_new_sar numeric; v_already numeric; v_id uuid;
begin
  if not public.can_access_deal(p_deal_id) then raise exception 'No access to this deal'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_currency not in ('SAR','EGP') then raise exception 'Currency must be SAR or EGP'; end if;
  if v_rate is null then raise exception 'No exchange rate set. Admin must add one first.'; end if;
  if p_rate is not null and public.my_role() <> 'admin' then raise exception 'Only admin can override the exchange rate'; end if;

  select * into v_deal from public.deals where id = p_deal_id;
  if v_deal.status not in ('approved','active') then raise exception 'Deal must be approved to receive payments'; end if;

  v_new_sar := case when p_currency = 'SAR' then p_amount else round(p_amount / v_rate, 2) end;
  select coalesce(sum(amount_sar), 0) into v_already from public.payments where deal_id = p_deal_id;
  if v_already + v_new_sar > v_deal.price_sar + 1 then
    raise exception 'Payment exceeds the remaining balance (% SAR left)', v_deal.price_sar - v_already;
  end if;

  insert into public.payments (deal_id, amount, currency, sar_to_egp, method, reference, receipt_path, paid_at, received_by)
  values (p_deal_id, p_amount, p_currency, v_rate, p_method, p_reference, p_receipt_path, p_paid_at, auth.uid())
  returning id into v_id;

  perform public.notify_admins('دفعة تحتاج تأكيد', p_amount || ' ' || p_currency || ' على صفقة للعميل');
  return v_id;
end $$;
grant execute on function public.record_payment(uuid, numeric, text, text, text, text, timestamptz, numeric) to authenticated;

create or replace function public.confirm_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can confirm payments'; end if;
  update public.payments set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_payment_id and not confirmed;
  if not found then raise exception 'Payment not found or already confirmed'; end if;
end $$;
grant execute on function public.confirm_payment(uuid) to authenticated;

-- ---------- Views ----------
create or replace view public.deal_balances with (security_invoker = true) as
select d.id as deal_id, d.price_sar,
       coalesce(sum(p.amount_sar) filter (where p.confirmed), 0) as paid_sar,
       coalesce(sum(p.amount_sar) filter (where not p.confirmed), 0) as pending_sar,
       d.price_sar - coalesce(sum(p.amount_sar) filter (where p.confirmed), 0) as remaining_sar
from public.deals d left join public.payments p on p.deal_id = d.id
group by d.id;

create or replace view public.monthly_revenue with (security_invoker = true) as
select date_trunc('month', p.paid_at)::date as month, count(*) as payments_count,
       sum(p.amount_sar) as revenue_sar, sum(p.amount_egp) as revenue_egp
from public.payments p where p.confirmed group by 1 order by 1 desc;

create or replace view public.monthly_revenue_by_sales with (security_invoker = true) as
select date_trunc('month', p.paid_at)::date as month, d.closed_by_user_id as user_id,
       sum(p.amount_sar) as revenue_sar, sum(p.amount_egp) as revenue_egp, count(distinct d.id) as deals_count
from public.payments p join public.deals d on d.id = p.deal_id
where p.confirmed group by 1, 2;

create or replace view public.upcoming_renewals with (security_invoker = true) as
select d.id as deal_id, d.lead_id, d.closed_by_user_id, d.end_date, (d.end_date - current_date) as days_left
from public.deals d
where d.status in ('approved','active') and d.end_date between current_date and current_date + 30;

-- إيراد شهر معيّن:  select * from get_month_revenue('2026-10-01');
create or replace function public.get_month_revenue(p_month date default current_date)
returns table (month date, confirmed_sar numeric, confirmed_egp numeric, confirmed_count bigint,
               pending_sar numeric, pending_egp numeric, pending_count bigint,
               new_deals bigint, new_deals_value_sar numeric)
language sql stable security invoker set search_path = public as $$
  with m as (select date_trunc('month', p_month)::timestamptz as s,
                    (date_trunc('month', p_month) + interval '1 month')::timestamptz as e)
  select (select s::date from m),
    coalesce(sum(p.amount_sar) filter (where p.confirmed), 0),
    coalesce(sum(p.amount_egp) filter (where p.confirmed), 0),
    count(*) filter (where p.confirmed),
    coalesce(sum(p.amount_sar) filter (where not p.confirmed), 0),
    coalesce(sum(p.amount_egp) filter (where not p.confirmed), 0),
    count(*) filter (where not p.confirmed),
    (select count(*) from public.deals d, m where d.status in ('approved','active') and d.approved_at >= m.s and d.approved_at < m.e),
    (select coalesce(sum(d.price_sar), 0) from public.deals d, m where d.status in ('approved','active') and d.approved_at >= m.s and d.approved_at < m.e)
  from public.payments p, m where p.paid_at >= m.s and p.paid_at < m.e
$$;
grant execute on function public.get_month_revenue(date) to authenticated;

-- ---------- المرتبات: مرتب أساسي + عمولات ----------
-- select * from get_payroll('2026-10-01');  (أدمن: الكل | مانجر: هو وفريقه | غيره: نفسه)
create or replace function public.get_payroll(p_month date default current_date)
returns table (user_id uuid, full_name text, role text, deals_count bigint,
               commission_sar numeric, commission_egp numeric,
               base_salary numeric, base_currency text, total_sar numeric, total_egp numeric)
language sql stable security definer set search_path = public as $$
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
  where u.role in ('sales','telesales','manager')
    and (public.my_role() = 'admin' or u.id = auth.uid() or u.manager_id = auth.uid())
  order by u.role, u.full_name
$$;
grant execute on function public.get_payroll(date) to authenticated;

create or replace function public.get_commission_lines(p_user_id uuid, p_month date default current_date)
returns table (deal_id uuid, client_name text, role_in_deal text, percent numeric,
               deal_price_sar numeric, commission_sar numeric, approved_at timestamptz, is_manual boolean)
language sql stable security definer set search_path = public as $$
  select d.id, l.name, dc.role_in_deal, dc.percent, d.price_sar,
         round(d.price_sar * dc.percent / 100, 2), d.approved_at, dc.is_manual
  from public.deal_commissions dc
  join public.deals d on d.id = dc.deal_id
  left join public.leads l on l.id = d.lead_id
  where dc.user_id = p_user_id and d.status in ('approved','active')
    and d.approved_at >= date_trunc('month', p_month)
    and d.approved_at <  date_trunc('month', p_month) + interval '1 month'
    and (public.my_role() = 'admin' or p_user_id = auth.uid()
         or exists (select 1 from public.users u where u.id = p_user_id and u.manager_id = auth.uid()))
  order by d.approved_at desc
$$;
grant execute on function public.get_commission_lines(uuid, date) to authenticated;

-- ---------- Storage: إيصالات الدفع (المسار: <deal_id>/<file>) ----------
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;

drop policy if exists "receipts read" on storage.objects;
create policy "receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
                  then public.can_access_deal(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "receipts upload" on storage.objects;
create policy "receipts upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
         and case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
                  then public.can_access_deal(((storage.foldername(name))[1])::uuid) else false end);

do $$ begin
  begin alter publication supabase_realtime add table public.payments; exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';

-- تحقق: لازم يرجّع 8 صفوف
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name in
 ('record_payment','confirm_payment','cancel_deal','set_deal_commission',
  'get_payroll','get_commission_lines','get_month_revenue','can_access_deal');
