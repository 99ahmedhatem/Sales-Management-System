-- =====================================================================
-- 021 — تعديل أي مستخدم بالكامل من صفحة Users (الأدمن بس):
--   admin_get_user_pay(p_user_id)  → بيانات المستخدم + مرتبه ونسبه + عدد أعضاء فريقه
--   admin_update_user(...)         → يعدّل الاسم/الدور/المدير/الحالة/المرتب/النسب في خطوة واحدة
-- بيعتمد على 018 (admin_set_user_pay). آمن لو اتشغّل تاني.
-- تغيير الدور أو النسب ما بيغيّرش الصفقات القديمة (العمولة بتتسجل وقت الموافقة)،
-- والعملاء الموزّعين على الموظف بيفضلوا معاه.
-- =====================================================================

create or replace function public.admin_get_user_pay(p_user_id uuid)
returns table (
  user_id uuid, full_name text, email text, role text, status text, manager_id uuid,
  base_salary numeric, base_currency text,
  closer_percent numeric, lead_percent numeric, manager_percent numeric,
  team_members bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read pay settings';
  end if;
  return query
    select u.id, u.full_name, u.email, u.role, u.status, u.manager_id,
           coalesce(r.base_salary, 0), coalesce(r.base_currency, 'EGP'),
           coalesce(r.closer_percent, u.commission_percent, 0), coalesce(r.lead_percent, 0), coalesce(r.manager_percent, 0),
           (select count(*) from public.users t where t.manager_id = u.id)
    from public.users u
    left join public.user_commission_rates r on r.user_id = u.id
    where u.id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end $$;
revoke execute on function public.admin_get_user_pay(uuid) from public, anon;
grant execute on function public.admin_get_user_pay(uuid) to authenticated;

-- كل الباراميترز اختيارية: null = سيبه زي ما هو. لتغيير المدير ابعت p_set_manager = true مع p_manager_id (أو null للإزالة).
create or replace function public.admin_update_user(
  p_user_id uuid,
  p_full_name text default null,
  p_role text default null,
  p_set_manager boolean default false,
  p_manager_id uuid default null,
  p_status text default null,
  p_base_salary numeric default null,
  p_base_currency text default null,
  p_closer_percent numeric default null,
  p_lead_percent numeric default null,
  p_manager_percent numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_role text;
  v_team bigint;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can edit users';
  end if;
  select * into v_user from public.users where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;

  if p_full_name is not null and btrim(p_full_name) = '' then
    raise exception 'Full name is required';
  end if;

  v_role := coalesce(p_role, v_user.role);
  if p_role is not null and p_role is distinct from v_user.role then
    if v_user.role = 'admin' then raise exception 'The admin role cannot be changed here'; end if;
    if p_user_id = auth.uid() then raise exception 'You cannot change your own role'; end if;
    if p_role not in ('manager','sales','telesales') then raise exception 'Role must be manager, sales or telesales'; end if;
    if v_user.role = 'manager' then
      select count(*) into v_team from public.users where manager_id = p_user_id;
      if v_team > 0 then
        raise exception 'This manager still has % team member(s). Move them to another manager first.', v_team;
      end if;
    end if;
  end if;

  if p_set_manager and p_manager_id is not null then
    if v_role not in ('sales','telesales') then raise exception 'Only sales and telesales can have a manager'; end if;
    if p_manager_id = p_user_id then raise exception 'A user cannot be their own manager'; end if;
    if not exists (select 1 from public.users where id = p_manager_id and role = 'manager') then
      raise exception 'Selected manager does not exist';
    end if;
  end if;

  if p_status is not null and p_status not in ('active','inactive') then
    raise exception 'Status must be active or inactive';
  end if;
  if p_status = 'inactive' and p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account';
  end if;

  update public.users
     set full_name  = coalesce(btrim(p_full_name), full_name),
         role       = v_role,
         status     = coalesce(p_status, status),
         -- مانجر/أدمن ما لهمش مدير؛ وإلا المدير يتغيّر بس لو p_set_manager
         manager_id = case when v_role not in ('sales','telesales') then null
                           when p_set_manager then p_manager_id
                           else manager_id end,
         updated_at = now()
   where id = p_user_id;

  if p_base_salary is not null or p_base_currency is not null or p_closer_percent is not null
     or p_lead_percent is not null or p_manager_percent is not null then
    -- نفس التحقق والتزامن مع users.commission_percent اللي في 018
    perform public.admin_set_user_pay(p_user_id, p_base_salary, p_base_currency,
                                      p_closer_percent, p_lead_percent, p_manager_percent);
  end if;
end $$;
revoke execute on function public.admin_update_user(uuid, text, text, boolean, uuid, text, numeric, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.admin_update_user(uuid, text, text, boolean, uuid, text, numeric, text, numeric, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
