-- ملحوظة (اتضافت وقت حفظ الملف، الـ SQL تحت زي ما هو): ده النسخة الشغالة فعلاً على Supabase
-- (اتأكدنا: مفيهاش عمود kind). بيحل محل get_target_progress_v2 بتاع 023، والواجهة (TargetProgress.tsx)
-- معمولة على أعمدته: صف المانجر (role = 'manager') هو إجمالي فريقه.

-- 025: التارجيت + الإنجاز بحسب الدور
--   أدمن: كل المديرين (إجمالي فريق كل مدير) وكل الموظفين
--   مدير: نفسه (إجمالي فريقه) + أعضاء فريقه بس
--   سيلز/تيلي: نفسه بس
-- إجمالي المدير بيتحسب على صفقات مميّزة (مفيش عدّ مزدوج لما صفقة تتشارك بين سيلز وتيلي).
-- آمن للتشغيل أكتر من مرة.
create or replace function public.get_target_progress_v2(p_month date default current_date)
returns table (
  user_id uuid, full_name text, role text, manager_id uuid, team_size integer,
  calls_done bigint, meetings_done bigint, deals_done bigint, revenue_sar numeric, collected_sar numeric,
  calls_target integer, meetings_target integer, deals_target integer, revenue_target_sar numeric,
  calls_pct numeric, meetings_pct numeric, deals_pct numeric, revenue_pct numeric)
language sql stable security definer set search_path = public as $$
  with r as (select date_trunc('month', p_month)::timestamptz as s,
                    (date_trunc('month', p_month) + interval '1 month')::timestamptz as e,
                    date_trunc('month', p_month)::date as m),
  me as (select auth.uid() as id, public.my_role() as role),
  base as (select * from public._month_stats(p_month, true)),
  -- الأشخاص اللي المستخدم الحالي مسموح يشوفهم
  vis as (
    select u.id, u.full_name, u.role, u.manager_id
    from public.users u, me
    where u.role in ('manager','sales','telesales') and u.status = 'active'
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
    where v.role in ('sales','telesales') and d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
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
    where v.role in ('sales','telesales')
  )
  select x.id, x.full_name, x.role, x.manager_id, x.team_size, x.calls, x.meetings, x.deals, x.rev, x.paid,
         coalesce(t.calls_target, 0), coalesce(t.meetings_target, 0), coalesce(t.deals_target, 0), coalesce(t.revenue_target_sar, 0),
         round(x.calls * 100.0 / nullif(t.calls_target, 0), 1), round(x.meetings * 100.0 / nullif(t.meetings_target, 0), 1),
         round(x.deals * 100.0 / nullif(t.deals_target, 0), 1), round(x.rev * 100.0 / nullif(t.revenue_target_sar, 0), 1)
  from rows_ x cross join r left join public.user_targets t on t.user_id = x.id and t.month = r.m
  order by case x.role when 'manager' then 0 when 'sales' then 1 else 2 end, x.full_name
$$;
revoke execute on function public.get_target_progress_v2(date) from public, anon;
grant execute on function public.get_target_progress_v2(date) to authenticated;

-- الأدمن يحدد تارجيت أي موظف أو مدير لشهر معيّن
create or replace function public.admin_set_target(
  p_user_id uuid, p_month date, p_calls integer default 0, p_meetings integer default 0,
  p_deals integer default 0, p_revenue_sar numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can set targets'; end if;
  if not exists (select 1 from public.users where id = p_user_id and role in ('manager','sales','telesales')) then
    raise exception 'Targets can be set for managers, sales and telesales only';
  end if;
  if least(coalesce(p_calls,0), coalesce(p_meetings,0), coalesce(p_deals,0)) < 0 or coalesce(p_revenue_sar,0) < 0 then
    raise exception 'Targets cannot be negative';
  end if;
  insert into public.user_targets as t (user_id, month, calls_target, meetings_target, deals_target, revenue_target_sar, updated_by)
  values (p_user_id, date_trunc('month', p_month)::date, coalesce(p_calls,0), coalesce(p_meetings,0), coalesce(p_deals,0), coalesce(p_revenue_sar,0), auth.uid())
  on conflict (user_id, month) do update set calls_target = excluded.calls_target, meetings_target = excluded.meetings_target,
    deals_target = excluded.deals_target, revenue_target_sar = excluded.revenue_target_sar, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function public.admin_set_target(uuid, date, integer, integer, integer, numeric) from public, anon;
grant execute on function public.admin_set_target(uuid, date, integer, integer, integer, numeric) to authenticated;
