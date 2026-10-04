-- =====================================================================
-- 017 — عدد العملاء المختلفين اللي اتشغل عليهم (مكالمات/تحويل) بدل تحميل كل activity_logs في المتصفح.
-- آمن لو اتشغّل تاني، مفيش تعديل لبيانات. لازم يتشغّل بعد 016.
-- الصلاحية: الأدمن لأي حد، وغير كده المستخدم لنفسه أو لأعضاء فريقه (manager_id = هو).
-- =====================================================================
create or replace function public.get_worked_clients_count(
  p_user_ids uuid[],
  p_activity_types text[] default array['call', 'forward']
)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare n bigint;
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return 0;
  end if;
  if public.my_role() is distinct from 'admin' and exists (
    select 1 from unnest(p_user_ids) as requested(id)
    where requested.id <> auth.uid()
      and not exists (select 1 from public.users u where u.id = requested.id and u.manager_id = auth.uid())
  ) then
    raise exception 'You can only count clients for yourself or your team';
  end if;
  select count(distinct a.lead_id) into n
  from public.activity_logs a
  where a.actor_id = any(p_user_ids)
    and a.activity_type = any(coalesce(p_activity_types, array['call', 'forward']));
  return n;
end $$;

revoke execute on function public.get_worked_clients_count(uuid[], text[]) from public, anon;
grant execute on function public.get_worked_clients_count(uuid[], text[]) to authenticated;

-- lead_id جوه الـ index عشان count(distinct lead_id) يتحسب من الـ index من غير ما يقرا الجدول.
create index if not exists activity_logs_actor_type_lead_idx on public.activity_logs (actor_id, activity_type, lead_id);

notify pgrst, 'reload schema';
