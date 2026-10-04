-- =====================================================================
-- 013 — عدّ دقيق وسريع للعملاء (بدل count:'estimated' اللي كان بيرجّع ثلث الرقم الحقيقي).
-- آمن لو اتشغّل تاني. مفيش فيه حذف ولا تعديل لبيانات.
-- =====================================================================
create or replace function public.get_leads_counts()
returns table (total bigint, unassigned bigint, without_phone bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read global lead counts';
  end if;
  return query
    select count(*),
           count(*) filter (where assigned_to is null),
           count(*) filter (where phone is null or phone = '')
    from public.leads;
end $$;

revoke execute on function public.get_leads_counts() from public, anon;
grant execute on function public.get_leads_counts() to authenticated;

-- فهرس يخلّي عدّ "غير الموزّعين" سريع
create index if not exists leads_unassigned_idx on public.leads (id) where assigned_to is null;
analyze public.leads;

notify pgrst, 'reload schema';
