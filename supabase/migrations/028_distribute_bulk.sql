-- 028: توزيع جماعي سريع للـ Leads غير الموزعة على التيليسيلز بالتساوي
-- (set-based: يتحمل عشرات الآلاف في ثواني. الأدمن: أي تيليسيلز نشط · المدير: تيليسيلز فريقه بس)
create or replace function public.distribute_unassigned_leads(
  p_user_ids uuid[],
  p_limit int default null,           -- أقصى عدد يتوزع (null = الكل)
  p_country text default null,        -- فلتر اختياري
  p_quality text default null,        -- فلتر اختياري: high / medium / normal
  p_max_per_user int default null     -- سقف لكل موظف في هذه العملية
) returns table (user_id uuid, assigned_count int)
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role();
  v_actor public.users;
  n int := coalesce(array_length(p_user_ids, 1), 0);
  v_total int;
begin
  if v_role not in ('admin','manager') then raise exception 'Only admin or manager can distribute leads'; end if;
  if n = 0 then raise exception 'Choose at least one telesales user'; end if;
  if exists (select 1 from unnest(p_user_ids) x
             where not exists (select 1 from public.users u
                               where u.id = x and u.role = 'telesales' and u.status = 'active'
                                 and (v_role = 'admin' or u.manager_id = auth.uid()))) then
    raise exception 'The list contains a user who is not an active telesales you can manage';
  end if;
  select * into v_actor from public.users where id = auth.uid();

  create temp table _dist on commit drop as
  with picked as (
    select l.id, row_number() over (order by l.id) as rn
    from public.leads l
    where l.assigned_to is null
      and (p_country is null or to_jsonb(l)->>'country' = p_country)
      and (p_quality is null or l.data_quality = p_quality)
    order by l.id
    limit coalesce(p_limit, 2147483647)
  )
  select id, p_user_ids[1 + ((rn - 1) % n)] as uid, rn from picked;

  if p_max_per_user is not null then
    delete from _dist where ((rn - 1) / n) >= p_max_per_user;
  end if;

  update public.leads l
     set assigned_to = d.uid,
         status = case when l.status = 'New' then 'Assigned' else l.status end,
         updated_at = now()
    from _dist d
   where l.id = d.id and l.assigned_to is null;

  insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
  select d.id, auth.uid(), coalesce(v_actor.full_name, '-'), v_actor.role, 'assignment', 'Assigned', 'Bulk even distribution'
  from _dist d;

  insert into public.notifications (user_id, type, title, message)
  select d.uid, 'assignment', 'عملاء جدد', 'تم توزيع ' || count(*) || ' عميل عليك'
  from _dist d group by d.uid;

  return query
    select x.uid, x.c::int from (select uid, count(*) c from _dist group by uid) x;
end $$;
revoke all on function public.distribute_unassigned_leads(uuid[], int, text, text, int) from public, anon;
grant execute on function public.distribute_unassigned_leads(uuid[], int, text, text, int) to authenticated;

-- معاينة: كام Lead هيتوزع بالفلاتر دي (من غير تنفيذ)
create or replace function public.count_unassigned_leads(p_country text default null, p_quality text default null)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.leads l
  where public.my_role() in ('admin','manager') and l.assigned_to is null
    and (p_country is null or to_jsonb(l)->>'country' = p_country)
    and (p_quality is null or l.data_quality = p_quality)
$$;
revoke all on function public.count_unassigned_leads(text, text) from public, anon;
grant execute on function public.count_unassigned_leads(text, text) to authenticated;
