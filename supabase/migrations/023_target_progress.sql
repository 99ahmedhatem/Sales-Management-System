-- =====================================================================
-- 023 — التارجيت والإنجاز في صفحة "أداء الفريق":
--   get_target_progress_v2(p_month) → صف لكل موظف (kind = 'member') + صف إجمالي لكل مانجر (kind = 'team')
--   admin_set_target(...)            → الأدمن يحدد تارجيت موظف أو مانجر لشهر (تارجيت المانجر = على إجمالي فريقه)
-- الفلترة في الداتابيز: الأدمن الكل، المانجر نفسه (إجمالي فريقه) + أعضاء فريقه، غيرهم نفسه بس.
-- إجمالي الفريق بيعدّ الصفقات المميّزة (صفقة فيها سيلز وتيلي من نفس الفريق = مرة واحدة).
-- بيعتمد على 009 (user_targets, _month_stats). آمن لو اتشغّل تاني.
-- =====================================================================

create or replace function public.get_target_progress_v2(p_month date default current_date)
returns table (
  kind text, user_id uuid, full_name text, role text, manager_id uuid,
  calls_done bigint, meetings_done bigint, deals_done bigint, revenue_sar numeric,
  calls_target int, meetings_target int, deals_target int, revenue_target_sar numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.my_role();
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_s timestamptz := date_trunc('month', coalesce(p_month, current_date));
  v_e timestamptz := date_trunc('month', coalesce(p_month, current_date)) + interval '1 month';
begin
  if v_role is null then
    raise exception 'Not allowed';
  end if;

  return query
  with members as (
    -- أرقام كل موظف سيلز/تيلي نشط (من 009)، مفلترة حسب اللي بينادي
    select s.user_id, s.full_name, s.role, u.manager_id,
           s.calls_done, s.meetings_done, s.deals_done, s.revenue_sar
    from public._month_stats(v_month, true) s
    join public.users u on u.id = s.user_id
    where v_role = 'admin'
       or s.user_id = auth.uid()
       or (v_role = 'manager' and u.manager_id = auth.uid())
  ),
  managers as (
    select u.id, u.full_name
    from public.users u
    where u.role = 'manager'
      and (v_role = 'admin' or u.id = auth.uid())
  ),
  team_deals as (
    -- صفقات معتمدة في الشهر لأي حد من الفريق، كل صفقة مرة واحدة
    select mg.id as manager_id, count(distinct d.id) as n, coalesce(sum(d.price_sar), 0) as rev
    from managers mg
    join public.deals d on d.status in ('approved','active') and d.approved_at >= v_s and d.approved_at < v_e
     and exists (select 1 from public.users t
                 where t.manager_id = mg.id and t.id in (d.sales_user_id, d.telesales_user_id))
    group by mg.id
  ),
  team_activity as (
    select t.manager_id, sum(s.calls_done) as calls, sum(s.meetings_done) as meetings
    from public._month_stats(v_month, true) s
    join public.users t on t.id = s.user_id
    where t.manager_id in (select id from managers)
    group by t.manager_id
  )
  select 'member'::text, m.user_id, m.full_name, m.role, m.manager_id,
         m.calls_done, m.meetings_done, m.deals_done, m.revenue_sar,
         coalesce(ut.calls_target, 0), coalesce(ut.meetings_target, 0), coalesce(ut.deals_target, 0), coalesce(ut.revenue_target_sar, 0)
  from members m
  left join public.user_targets ut on ut.user_id = m.user_id and ut.month = v_month
  union all
  select 'team'::text, mg.id, mg.full_name, 'manager'::text, null::uuid,
         coalesce(ta.calls, 0)::bigint, coalesce(ta.meetings, 0)::bigint, coalesce(td.n, 0)::bigint, coalesce(td.rev, 0),
         coalesce(ut.calls_target, 0), coalesce(ut.meetings_target, 0), coalesce(ut.deals_target, 0), coalesce(ut.revenue_target_sar, 0)
  from managers mg
  left join team_deals td on td.manager_id = mg.id
  left join team_activity ta on ta.manager_id = mg.id
  left join public.user_targets ut on ut.user_id = mg.id and ut.month = v_month
  order by 1 desc, 4, 3;
end $$;
revoke execute on function public.get_target_progress_v2(date) from public, anon;
grant execute on function public.get_target_progress_v2(date) to authenticated;

-- الأدمن يحدد تارجيت شهر لموظف أو مانجر (upsert على user_targets)
create or replace function public.admin_set_target(
  p_user_id uuid, p_month date,
  p_calls int default 0, p_meetings int default 0, p_deals int default 0, p_revenue_sar numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can set targets';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and role in ('manager','sales','telesales')) then
    raise exception 'Targets can be set for managers, sales and telesales only';
  end if;
  if p_month is null then raise exception 'Choose a month'; end if;
  if coalesce(p_calls, 0) < 0 or coalesce(p_meetings, 0) < 0 or coalesce(p_deals, 0) < 0 or coalesce(p_revenue_sar, 0) < 0 then
    raise exception 'Targets cannot be negative';
  end if;

  insert into public.user_targets (user_id, month, calls_target, meetings_target, deals_target, revenue_target_sar, updated_by, updated_at)
  values (p_user_id, date_trunc('month', p_month)::date, coalesce(p_calls, 0), coalesce(p_meetings, 0),
          coalesce(p_deals, 0), coalesce(p_revenue_sar, 0), auth.uid(), now())
  on conflict (user_id, month) do update set
    calls_target = excluded.calls_target, meetings_target = excluded.meetings_target,
    deals_target = excluded.deals_target, revenue_target_sar = excluded.revenue_target_sar,
    updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke execute on function public.admin_set_target(uuid, date, int, int, int, numeric) from public, anon;
grant execute on function public.admin_set_target(uuid, date, int, int, int, numeric) to authenticated;

notify pgrst, 'reload schema';
