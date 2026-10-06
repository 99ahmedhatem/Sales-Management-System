-- 037: صلاحيات لكل يوزر (فوق صلاحيات الدور). الأدمن فقط يديرها.
create table if not exists public.permission_catalog(
  key text primary key, label_ar text not null, grp text not null, sort int default 0);

insert into public.permission_catalog(key,label_ar,grp,sort) values
 ('leads.view_all','عرض كل العملاء','العملاء',1),
 ('leads.edit','تعديل بيانات العملاء','العملاء',2),
 ('leads.export','تصدير العملاء','العملاء',3),
 ('leads.distribute','توزيع العملاء','العملاء',4),
 ('leads.delete','حذف العملاء','العملاء',5),
 ('deals.create','إنشاء صفقات','الصفقات',10),
 ('deals.approve','اعتماد الصفقات','الصفقات',11),
 ('payments.confirm','تأكيد المدفوعات','الصفقات',12),
 ('packages.manage','إدارة الباقات','الإدارة',20),
 ('users.manage','إدارة المستخدمين','الإدارة',21),
 ('salaries.view','عرض الرواتب والعمولات','الإدارة',22),
 ('reports.view','عرض التقارير','الإدارة',23),
 ('audit.view','عرض سجل النشاط','الإدارة',24)
on conflict(key) do update set label_ar=excluded.label_ar, grp=excluded.grp, sort=excluded.sort;

create table if not exists public.role_default_permissions(
  role text not null, permission_key text not null references public.permission_catalog(key) on delete cascade,
  primary key(role,permission_key));
insert into public.role_default_permissions(role,permission_key) values
 ('manager','leads.view_all'),('manager','leads.edit'),('manager','leads.export'),('manager','leads.distribute'),
 ('manager','deals.create'),('manager','deals.approve'),('manager','payments.confirm'),('manager','reports.view'),
 ('sales','leads.edit'),('sales','deals.create'),
 ('telesales','leads.edit'),('telesales','deals.create')
on conflict do nothing;

create table if not exists public.user_permissions(
  user_id uuid not null references public.users(id) on delete cascade,
  permission_key text not null references public.permission_catalog(key) on delete cascade,
  granted boolean not null,
  updated_by uuid, updated_at timestamptz default now(),
  primary key(user_id,permission_key));

alter table public.permission_catalog enable row level security;
alter table public.role_default_permissions enable row level security;
alter table public.user_permissions enable row level security;
drop policy if exists pc_read on public.permission_catalog;
create policy pc_read on public.permission_catalog for select to authenticated using (true);
drop policy if exists rdp_read on public.role_default_permissions;
create policy rdp_read on public.role_default_permissions for select to authenticated using (true);
drop policy if exists up_own_read on public.user_permissions;
create policy up_own_read on public.user_permissions for select to authenticated using (user_id=auth.uid() or public.my_role()='admin');
-- الكتابة عبر RPC فقط

create or replace function public.has_permission(p_key text, p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_role text; v_ov boolean;
begin
  select role into v_role from public.users where id=p_user;
  if v_role is null then return false; end if;
  if v_role='admin' then return true; end if;
  select granted into v_ov from public.user_permissions where user_id=p_user and permission_key=p_key;
  if v_ov is not null then return v_ov; end if;
  return exists(select 1 from public.role_default_permissions where role=v_role and permission_key=p_key);
end $$;

create or replace function public.get_my_permissions()
returns table(permission_key text) language sql stable security definer set search_path=public as $$
  select c.key from public.permission_catalog c where public.has_permission(c.key, auth.uid());
$$;

create or replace function public.get_all_users_permissions()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if public.my_role()<>'admin' then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'user_id',u.id,'username',u.username,'full_name',u.full_name,'role',u.role,'status',u.status,
    'permissions',(select coalesce(jsonb_object_agg(c.key, public.has_permission(c.key,u.id)),'{}'::jsonb) from public.permission_catalog c),
    'overrides',(select coalesce(jsonb_object_agg(up.permission_key,up.granted),'{}'::jsonb) from public.user_permissions up where up.user_id=u.id)
  ) order by u.role,u.full_name) from public.users u where u.role<>'admin'),'[]'::jsonb);
end $$;

create or replace function public.get_permission_catalog()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label_ar,'group',grp) order by sort),'[]'::jsonb) from public.permission_catalog;
$$;

-- p_perms مثال: {"leads.export":true,"deals.approve":false}  ؛ null = ارجع للافتراضي
create or replace function public.set_user_permissions(p_user uuid, p_perms jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare k text; v jsonb;
begin
  if public.my_role()<>'admin' then raise exception 'admin only'; end if;
  if not exists(select 1 from public.users where id=p_user) then raise exception 'user not found'; end if;
  for k,v in select * from jsonb_each(p_perms) loop
    if not exists(select 1 from public.permission_catalog where key=k) then raise exception 'unknown permission %',k; end if;
    if jsonb_typeof(v)='null' then
      delete from public.user_permissions where user_id=p_user and permission_key=k;
    else
      insert into public.user_permissions(user_id,permission_key,granted,updated_by,updated_at)
      values(p_user,k,(v#>>'{}')::boolean,auth.uid(),now())
      on conflict(user_id,permission_key) do update set granted=excluded.granted,updated_by=excluded.updated_by,updated_at=now();
    end if;
  end loop;
  insert into public.audit_log(table_name,row_id,action,changed_by,new_data)
  values('user_permissions',p_user::text,'UPDATE',auth.uid(),p_perms);
end $$;

create or replace function public.reset_user_permissions(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.my_role()<>'admin' then raise exception 'admin only'; end if;
  delete from public.user_permissions where user_id=p_user;
end $$;

revoke all on function public.set_user_permissions(uuid,jsonb), public.reset_user_permissions(uuid), public.get_all_users_permissions() from public, anon;
grant execute on function public.set_user_permissions(uuid,jsonb), public.reset_user_permissions(uuid), public.get_all_users_permissions(),
  public.get_my_permissions(), public.get_permission_catalog(), public.has_permission(text,uuid) to authenticated;

-- تطبيق فعلي على الباك: التوزيع يتطلب leads.distribute (للمدير/سيلز)
-- (الأدمن دايماً مسموح). نغلف بدالة فحص يستدعيها الفرونت قبل التوزيع.
