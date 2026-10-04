-- =====================================================================
-- AUDIT_PERMISSIONS — فحص الصلاحيات (قراءة بس، مش بيغيّر أي حاجة).
-- شغّله في Supabase SQL Editor، وبعدين Export → CSV وابعت الملف.
-- النتيجة جدول واحد: section | name | detail
--   user      : كل مستخدم (الدور، الحالة، المانجر، صف المرتبات، تأكيد الإيميل) + أي مشكلة
--   policy    : كل RLS policy على جداول public (مين يقرا/يكتب إيه)
--   rls_off   : جداول public من غير RLS
--   function  : الدوال اللي بتتنادى من الموقع + سطور فحص الدور جواها
--   my_role   : تعريف my_role() نفسها
-- =====================================================================
with
app_functions(fn) as (
  values ('request_meeting'),('accept_meeting_request'),('decline_meeting_request'),('cancel_meeting_request'),
         ('reassign_meeting_request'),('update_meeting_outcome'),('mark_meeting_lost'),
         ('create_deal'),('attach_recording'),('attach_contract'),('request_contract_review'),('approve_deal'),
         ('cancel_deal'),('record_payment'),('confirm_payment'),('set_deal_commission'),
         ('distribute_leads_evenly'),('reassign_user_leads'),('fill_missing_phones'),('set_lead_customer_number'),
         ('delete_user_account'),('set_user_email_confirmed'),('admin_update_user'),('admin_set_user_pay'),
         ('lookup_client_for_deal'),('can_access_deal'),('visible_user_ids')
),
users_audit as (
  select 'user'::text as section,
         coalesce(u.full_name, '?') || ' <' || coalesce(u.email, '?') || '>' as name,
         concat_ws(' | ',
           'role=' || coalesce(u.role, 'NULL'),
           'status=' || coalesce(u.status, 'NULL'),
           'manager=' || coalesce(m.full_name, case when u.manager_id is null then '-' else 'MISSING(' || u.manager_id || ')' end),
           'team=' || (select count(*) from public.users t where t.manager_id = u.id),
           'rates_row=' || case when r.user_id is null then 'no' else 'yes' end,
           'auth_user=' || case when au.id is null then 'MISSING' else 'yes' end,
           'email_confirmed=' || case when au.email_confirmed_at is null then 'no' else 'yes' end,
           case when u.role is null or u.role not in ('admin','manager','sales','telesales') then 'PROBLEM: invalid role' end,
           case when u.role in ('admin','manager') and u.manager_id is not null then 'PROBLEM: admin/manager has a manager' end,
           case when u.manager_id is not null and (m.id is null or m.role <> 'manager') then 'PROBLEM: manager_id is not a manager' end,
           case when au.id is null then 'PROBLEM: no login account' end,
           case when u.role = 'admin' and u.status <> 'active' then 'PROBLEM: inactive admin' end
         ) as detail
  from public.users u
  left join public.users m on m.id = u.manager_id
  left join public.user_commission_rates r on r.user_id = u.id
  left join auth.users au on au.id = u.id
),
orphan_auth as (
  select 'user', coalesce(au.email, au.id::text), 'PROBLEM: login account without public.users profile (my_role() is NULL for them)'
  from auth.users au
  where not exists (select 1 from public.users u where u.id = au.id)
),
role_counts as (
  select 'user', '== totals ==', string_agg(coalesce(role, 'NULL') || '=' || n, ', ' order by role)
  from (select role, count(*) n from public.users group by role) x
),
policies as (
  select 'policy', p.tablename || ' · ' || p.policyname,
         concat_ws(' | ', p.cmd, 'roles=' || array_to_string(p.roles, ','),
                   'using=' || left(coalesce(p.qual, '-'), 300),
                   'check=' || left(coalesce(p.with_check, '-'), 300))
  from pg_policies p where p.schemaname = 'public'
),
rls_off as (
  select 'rls_off', c.relname, 'RLS disabled'
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
),
functions as (
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         coalesce((select string_agg(btrim(line), ' ⏎ ')
                   from regexp_split_to_table(p.prosrc, '\n') as line
                   where line ~* '(role|my_role|auth\.uid|raise exception)'), '(no role checks)')
  from pg_proc p
  join app_functions a on a.fn = p.proname
  where p.pronamespace = 'public'::regnamespace
),
missing_functions as (
  select 'function', a.fn, 'MISSING on this database'
  from app_functions a
  where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = a.fn)
),
my_role_def as (
  select 'my_role', p.proname, left(p.prosrc, 500)
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'my_role'
)
select * from role_counts
union all select * from users_audit
union all select * from orphan_auth
union all select * from my_role_def
union all select * from rls_off
union all select * from policies
union all select * from functions
union all select * from missing_functions
order by 1, 2;
