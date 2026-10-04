-- 018: أداء الفريق + المرتبات + تعديل مرتب/نسب أي موظف
-- آمن للتشغيل أكتر من مرة. بيعتمد على 008 (user_commission_rates, deal_commissions, payments).

-- ---------- 1) أداء كل موظف / مدير / فريق في فترة ----------
-- select * from get_team_performance('2026-10-01','2026-10-31');   -- فترة
-- select * from get_team_performance();                              -- من الأول لحد دلوقتي
-- أدمن: الكل | مانجر: هو وفريقه | غيره: نفسه بس
create or replace function public.get_team_performance(p_from date default null, p_to date default null)
returns table (
  user_id uuid, full_name text, role text, manager_id uuid, manager_name text,
  base_salary numeric, base_currency text,
  closer_percent numeric, lead_percent numeric, manager_percent numeric,
  deals_count bigint, deals_value_sar numeric,
  collected_sar numeric, collected_egp numeric,
  collected_total_sar numeric, collected_total_egp numeric,
  commission_sar numeric, commission_egp numeric)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(p_from, date '2000-01-01')::timestamptz as s,
           (coalesce(p_to, current_date) + 1)::timestamptz as e,
           coalesce((select value from public.app_settings where key = 'commission_basis'), 'deal_value') as basis,
           coalesce(public.current_sar_to_egp(), 0) as fx
  ),
  vis as (
    select u.id, u.full_name, u.role, u.manager_id
    from public.users u
    where u.role in ('manager','sales','telesales')
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
$$;
revoke execute on function public.get_team_performance(date, date) from public, anon;
grant execute on function public.get_team_performance(date, date) to authenticated;

-- ---------- 2) الأدمن يعدّل مرتب ونسب أي موظف (من شاشة المستخدمين) ----------
create or replace function public.admin_set_user_pay(
  p_user_id uuid,
  p_base_salary numeric default null,
  p_base_currency text default null,
  p_closer_percent numeric default null,
  p_lead_percent numeric default null,
  p_manager_percent numeric default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can change pay settings'; end if;
  if not exists (select 1 from public.users where id = p_user_id) then raise exception 'User not found'; end if;
  if p_base_currency is not null and p_base_currency not in ('SAR','EGP') then raise exception 'Currency must be SAR or EGP'; end if;
  if p_base_salary is not null and p_base_salary < 0 then raise exception 'Salary cannot be negative'; end if;
  if coalesce(p_closer_percent, 0) not between 0 and 100
     or coalesce(p_lead_percent, 0) not between 0 and 100
     or coalesce(p_manager_percent, 0) not between 0 and 100 then
    raise exception 'Percent must be between 0 and 100';
  end if;

  insert into public.user_commission_rates as r (user_id, base_salary, base_currency, closer_percent, lead_percent, manager_percent, updated_by)
  values (p_user_id, coalesce(p_base_salary, 0), coalesce(p_base_currency, 'EGP'),
          coalesce(p_closer_percent, 0), coalesce(p_lead_percent, 0), coalesce(p_manager_percent, 0), auth.uid())
  on conflict (user_id) do update set
    base_salary     = coalesce(p_base_salary,     r.base_salary),
    base_currency   = coalesce(p_base_currency,   r.base_currency),
    closer_percent  = coalesce(p_closer_percent,  r.closer_percent),
    lead_percent    = coalesce(p_lead_percent,    r.lead_percent),
    manager_percent = coalesce(p_manager_percent, r.manager_percent),
    updated_by = auth.uid(), updated_at = now();

  -- نسبة القفل بتتزامن مع users.commission_percent (الموجودة في 011)
  if p_closer_percent is not null then
    update public.users set commission_percent = p_closer_percent where id = p_user_id and commission_percent is distinct from p_closer_percent;
  end if;
end $$;
revoke execute on function public.admin_set_user_pay(uuid, numeric, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.admin_set_user_pay(uuid, numeric, text, numeric, numeric, numeric) to authenticated;
