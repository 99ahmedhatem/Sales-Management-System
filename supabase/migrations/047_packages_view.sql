-- 047: الباقات تظهر للمدير والسيلز والتيلي سيلز (قراءة فقط). الأدمن فقط يعدّل. الحد الأدنى للسعر للمدير فقط افتراضياً.
insert into public.permission_catalog(key,label_ar,grp,sort) values
 ('packages.view','عرض الباقات','الإدارة',19),
 ('packages.view_min_price','عرض الحد الأدنى لسعر الباقة','الإدارة',20)
on conflict(key) do update set label_ar=excluded.label_ar, grp=excluded.grp, sort=excluded.sort;

insert into public.role_default_permissions(role,permission_key) values
 ('manager','packages.view'),('sales','packages.view'),('telesales','packages.view'),
 ('manager','packages.view_min_price')
on conflict do nothing;

-- قراءة الباقات للجميع عبر دالة (الحد الأدنى يُخفى بدون الصلاحية)
create or replace function public.list_packages()
returns table(id uuid, name text, description text, features text[], duration_months int, price_sar numeric, min_price_sar numeric, is_active boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_min boolean;
begin
  if not public.has_permission('packages.view', auth.uid()) then raise exception 'not allowed'; end if;
  v_min := public.has_permission('packages.view_min_price', auth.uid());
  return query
    select p.id, p.name, p.description, p.features, p.duration_months, p.price_sar,
           case when v_min then p.min_price_sar else null end, p.is_active
    from public.packages p
    where p.is_active or public.my_role() = 'admin'
    order by p.name, p.duration_months;
end $$;
revoke all on function public.list_packages() from public, anon;
grant execute on function public.list_packages() to authenticated;
