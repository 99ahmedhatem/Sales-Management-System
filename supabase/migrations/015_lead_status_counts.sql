-- 015 — عدّ دقيق للعملاء حسب الحالة (لوحة تحكم الأدمن) في استعلام واحد
-- بدل 8 استعلامات count منفصلة على leads. آمن لو اتشغّل تاني، مفيش تعديل لبيانات. يعتمد على my_role().
create or replace function public.get_lead_status_counts()
returns table (status text, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read global lead counts';
  end if;
  return query
    select l.status::text, count(*)
    from public.leads l
    group by l.status;
end $$;

revoke execute on function public.get_lead_status_counts() from public, anon;
grant execute on function public.get_lead_status_counts() to authenticated;

notify pgrst, 'reload schema';
