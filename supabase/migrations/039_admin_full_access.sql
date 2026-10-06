-- 039 (اتبعت باسم "023_admin_full_access" بس 023 متاخد في الريبو لـ 023_target_progress):
-- الأدمن يملك كل الصلاحيات على كل الجداول (قراءة/كتابة/حذف) + تقفيل دوال الـ triggers
-- آمن: الـ policies بتتجمع بـ OR، فده بيضيف صلاحيات للأدمن بس ومبيقلّلش صلاحيات أي حد.
-- الجداول اللي الكتابة المباشرة عليها مقفولة بقصد (payments, deals, audit_log, ...) تفضل تتعدّل عن طريق الدوال (RPC).
-- آمن للتشغيل أكتر من مرة.
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists "admin full access" on public.%I', t.relname);
    execute format('create policy "admin full access" on public.%I for all to authenticated
                      using (public.my_role() = ''admin'') with check (public.my_role() = ''admin'')', t.relname);
  end loop;
end $$;

-- القراءة بس: لو جدول ناقصه صلاحية SELECT للمستخدمين المسجّلين نضيفها (الـ RLS هو اللي بيحدد مين يشوف إيه)
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not has_table_privilege('authenticated', c.oid, 'select')
  loop
    execute format('grant select on public.%I to authenticated', t.relname);
  end loop;
end $$;

-- دوال الـ triggers مش لازم حد ينفّذها يدويًا (الـ trigger بيشتغل بدون صلاحية execute)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
