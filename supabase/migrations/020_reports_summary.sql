-- =====================================================================
-- 020 — صفحة Reports بتتحسب في الداتابيز بدل ما المتصفح يحمّل كل leads و activity_logs.
-- استعلام واحد بيرجّع JSON صغير. آمن لو اتشغّل تاني، مفيش تعديل لبيانات.
-- =====================================================================
create or replace function public.get_reports_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
      where u.role = 'telesales'), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'full_name', u.full_name,
               'total', coalesce(m.n, 0), 'won', coalesce(m.won, 0), 'lost', coalesce(m.lost, 0)) order by u.full_name)
      from public.users u
      left join (select assigned_sales_id, count(*) as n,
                        count(*) filter (where outcome = 'Deal Closed – Won') as won,
                        count(*) filter (where outcome = 'Deal Lost') as lost
                 from public.meetings group by 1) m on m.assigned_sales_id = u.id
      where u.role = 'sales'), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.get_reports_summary() from public, anon;
grant execute on function public.get_reports_summary() to authenticated;

-- عدّ عملاء كل موظف (لوحة المانجر) بدل العدّ من الـ 100 صف اللي في الصفحة الحالية.
-- الصلاحية: الأدمن لأي حد، وغير كده نفسك أو فريقك (manager_id = أنت).
create or replace function public.get_team_lead_stats(p_user_ids uuid[])
returns table (user_id uuid, total bigint, contacted bigint, converted bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;
  if public.my_role() is distinct from 'admin' and exists (
    select 1 from unnest(p_user_ids) as requested(id)
    where requested.id <> auth.uid()
      and not exists (select 1 from public.users u where u.id = requested.id and u.manager_id = auth.uid())
  ) then
    raise exception 'You can only count clients for yourself or your team';
  end if;
  return query
    select l.assigned_to, count(*),
           count(*) filter (where l.status not in ('New', 'Assigned')),
           count(*) filter (where l.status in ('Subscribed', 'Converted'))
    from public.leads l
    where l.assigned_to = any(p_user_ids)
    group by l.assigned_to;
end $$;

revoke execute on function public.get_team_lead_stats(uuid[]) from public, anon;
grant execute on function public.get_team_lead_stats(uuid[]) to authenticated;

-- قايمة التيلي سيلز: فلتر بالموظف + ترتيب بالتاريخ في index واحد (بدل index للفلتر وindex للترتيب).
create index if not exists leads_assigned_created_idx on public.leads (assigned_to, created_at desc, id desc);

notify pgrst, 'reload schema';
