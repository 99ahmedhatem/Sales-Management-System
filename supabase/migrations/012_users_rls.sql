-- =====================================================================
-- 012 — قفل جدول users (RLS كان مقفول: أي حد معاه مفتاح الـ anon كان يقدر
-- يقرأ أو يعدّل أي مستخدم، حتى يخلّي نفسه admin). آمن لو اتشغّل تاني.
-- =====================================================================
alter table public.users enable row level security;

-- نشيل أي policies قديمة على users ونحط المجموعة الصح
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='users' loop
    execute format('drop policy %I on public.users', p.policyname);
  end loop;
end $$;

-- قراءة: أي موظف مسجّل دخول (الشاشات بتعرض أسماء الزملاء). الزوار (anon) لأ.
create policy users_select on public.users for select to authenticated using (true);

-- إضافة: الأدمن يضيف أي حد. وأول أدمن في النظام (شاشة CompleteAdminSetup) يضيف نفسه بس لو مفيش أدمن.
create policy users_insert_admin on public.users for insert to authenticated
  with check (public.my_role() = 'admin');
create policy users_insert_first_admin on public.users for insert to authenticated
  with check (id = auth.uid() and role = 'admin'
              and not exists (select 1 from public.users u where u.role = 'admin'));

-- تعديل وحذف: الأدمن بس
create policy users_update_admin on public.users for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy users_delete_admin on public.users for delete to authenticated
  using (public.my_role() = 'admin');

revoke all on public.users from anon;

notify pgrst, 'reload schema';

-- تحقق: لازم يرجّع true
select relrowsecurity as users_rls_enabled from pg_class where oid = 'public.users'::regclass;
