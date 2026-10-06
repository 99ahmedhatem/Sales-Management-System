-- 024: تقفيل الدخول بدون تسجيل (anon) + RLS على أي جدول ناقص
-- السيستم كله بيشتغل بمستخدمين مسجّلين (authenticated)، فمفيش داعي إن anon يلمس أي جدول أو دالة.
-- آمن: مبيمسحش بيانات، ومبيقلّلش صلاحيات المستخدمين المسجّلين. آمن للتشغيل أكتر من مرة.

-- 1) أي جدول في public من غير RLS: فعّله (الأدمن بياخد policy كاملة من 023؛ باقي الأدوار مقفول لحد ما تتحدد policy)
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'RLS enabled on public.%', t.relname;
  end loop;
end $$;

-- 2) شيل كل صلاحيات anon من الجداول والـ sequences، ومنع إعطائها تلقائيًا للجداول الجديدة
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- 3) دوال SECURITY DEFINER: authenticated يفضل ينفّذها (صريح)، وanon/public لأ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.oid as oid
           from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f'
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')) loop
    if has_function_privilege('authenticated', f.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- 4) الأدمن ياخد policy كاملة على أي جدول اتفعّل عليه RLS دلوقتي
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists "admin full access" on public.%I', t.relname);
    execute format('create policy "admin full access" on public.%I for all to authenticated
                      using (public.my_role() = ''admin'') with check (public.my_role() = ''admin'')', t.relname);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- النتيجة: لازم الاتنين = 0
select
  (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select,insert,update,delete')) as tables_anon_can_touch,
  (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_without_rls;
