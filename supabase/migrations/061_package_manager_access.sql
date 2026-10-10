-- 061 (pasted as "065"; saved under the next free number). Safe to run more than once.
-- 065: التحكم في ظهور الباقات حسب المدير (وفريقه)
-- القاعدة: الباقة بدون أي مدير محدد = تظهر للجميع (زي ما هو الحال الآن، مفيش حاجة هتختفي).
--          الباقة المحددة لمديرين = تظهر لهؤلاء المديرين + فرقهم (users.manager_id) + الأدمن فقط.

create table if not exists public.package_manager_access (
  package_id uuid not null references public.packages(id) on delete cascade,
  manager_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, manager_id)
);
alter table public.package_manager_access enable row level security;
drop policy if exists pma_admin_all on public.package_manager_access;
create policy pma_admin_all on public.package_manager_access for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- هل المستخدم ده يقدر يشوف/يستخدم الباقة؟
create or replace function public.can_use_package(p_package uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.users u where u.id = p_user and u.role = 'admin')
    or not exists (select 1 from public.package_manager_access a where a.package_id = p_package)
    or exists (
      select 1 from public.package_manager_access a
      join public.users u on u.id = p_user
      where a.package_id = p_package and (a.manager_id = u.id or a.manager_id = u.manager_id)
    );
$$;
grant execute on function public.can_use_package(uuid, uuid) to authenticated;

-- قراءة الباقات المباشرة من الجدول تحترم نفس القاعدة
drop policy if exists "Authenticated users can read active packages" on public.packages;
create policy "Authenticated users can read active packages" on public.packages for select to authenticated
  using ((is_active and public.can_use_package(id)) or public.my_role() = 'admin');

-- list_packages تحترم القاعدة
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
    where (p.is_active and public.can_use_package(p.id)) or public.my_role() = 'admin'
    order by p.name, p.duration_months;
end $$;

-- create_deal ترفض باقة مش متاحة للمستخدم
do $$ declare def text; begin
  select pg_get_functiondef(p.oid) into def from pg_proc p where p.proname='create_deal' and p.pronamespace='public'::regnamespace;
  if position('can_use_package' in def) = 0 then
    def := replace(def, 'p.id = target_package_id and p.is_active = true', 'p.id = target_package_id and p.is_active = true and public.can_use_package(p.id)');
    execute def;
  end if;
end $$;

-- للأدمن: قراءة وتعديل الإتاحة
create or replace function public.get_package_access()
returns table(package_id uuid, manager_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  return query select a.package_id, a.manager_id from public.package_manager_access a;
end $$;
grant execute on function public.get_package_access() to authenticated;

-- p_manager_ids فاضية/null = الباقة تظهر للجميع
create or replace function public.set_package_access(p_package_id uuid, p_manager_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  delete from public.package_manager_access where package_id = p_package_id;
  insert into public.package_manager_access(package_id, manager_id)
    select p_package_id, u.id from public.users u
    where u.id = any(coalesce(p_manager_ids, '{}')) and u.role = 'manager';
end $$;
grant execute on function public.set_package_access(uuid, uuid[]) to authenticated;
