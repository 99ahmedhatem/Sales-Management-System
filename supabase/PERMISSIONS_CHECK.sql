-- فحص الصلاحيات (قراءة فقط: لا يغيّر أي بيانات — كل اختبار كتابة بيتعمل جوه عملية وبيتلغي).
-- بيجرّب فعليًا بشخصية كل مستخدم موجود، ويطلّع جدول واحد فيه: القسم / البند / الحالة (OK/WARN/FAIL) / التفاصيل.
-- شغّله كله في Supabase → SQL Editor واضغط Run، وابعتلي الجدول اللي بيظهر.
drop table if exists _perm_report;
create temp table _perm_report (n serial, section text, item text, status text, detail text);

do $$
declare
  t record; u record; c bigint; tot bigint; pk text; ok boolean; n int; admin_uid uuid; has_rows boolean;
  tbls text[]; q text; leak bigint; msg text;
begin
  -- ============ 1) أمان الجداول والدوال ============
  for t in select c.relname, c.relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' order by 1 loop
    if not t.relrowsecurity then
      insert into _perm_report(section,item,status,detail) values ('Tables', t.relname, 'FAIL', 'RLS is OFF: any signed-in user (or anon) may read/write it');
    end if;
    if has_table_privilege('anon', format('public.%I', t.relname), 'select,insert,update,delete') then
      insert into _perm_report(section,item,status,detail) values ('Tables', t.relname, 'FAIL', 'anon has direct privileges on this table');
    end if;
  end loop;
  insert into _perm_report(section,item,status,detail)
    select 'Tables', 'RLS check', 'OK', 'All public tables have RLS enabled' where not exists (select 1 from _perm_report where section='Tables' and status='FAIL');

  insert into _perm_report(section,item,status,detail)
    select 'Functions', 'anon can execute', 'WARN',
           count(*) || ' SECURITY DEFINER functions are executable by anon (they check auth.uid()/my_role() inside, so low risk): ' || left(string_agg(p.proname, ', ' order by p.proname), 400)
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prosecdef and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')
    having count(*) > 0;
  insert into _perm_report(section,item,status,detail)
    select 'Functions', 'trigger functions', 'WARN', count(*) || ' trigger functions are callable by anon/authenticated (run 023 to lock them)'
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')
    having count(*) > 0;

  -- ============ 2) سلامة بيانات المستخدمين ============
  insert into _perm_report(section,item,status,detail)
    select 'Users', 'Admins', case when count(*) >= 1 then 'OK' else 'FAIL' end,
           count(*) || ' admin(s): ' || coalesce(string_agg(email, ', '), 'NONE') from public.users where role = 'admin';
  for u in select id, full_name, email, role, manager_id, status from public.users loop
    if u.role not in ('admin','manager','sales','telesales') then
      insert into _perm_report(section,item,status,detail) values ('Users', coalesce(u.full_name,u.email), 'FAIL', 'Unknown role: ' || coalesce(u.role,'NULL'));
    end if;
    if u.role in ('sales','telesales') and u.manager_id is null then
      insert into _perm_report(section,item,status,detail) values ('Users', coalesce(u.full_name,u.email), 'WARN', u.role || ' without a manager (manager cannot see them, no manager commission)');
    end if;
    if u.role in ('manager','admin') and u.manager_id is not null then
      insert into _perm_report(section,item,status,detail) values ('Users', coalesce(u.full_name,u.email), 'WARN', u.role || ' has a manager_id set');
    end if;
    if u.manager_id is not null and not exists (select 1 from public.users m where m.id = u.manager_id and m.role = 'manager') then
      insert into _perm_report(section,item,status,detail) values ('Users', coalesce(u.full_name,u.email), 'FAIL', 'manager_id does not point to a manager');
    end if;
    if u.status is distinct from 'active' and exists (select 1 from public.leads l where l.assigned_to = u.id limit 1) then
      insert into _perm_report(section,item,status,detail) values ('Users', coalesce(u.full_name,u.email), 'WARN', 'Inactive user still has assigned leads');
    end if;
  end loop;
  insert into _perm_report(section,item,status,detail)
    select 'Users', coalesce(a.email, a.id::text), 'FAIL', 'Auth account has NO profile row in public.users' from auth.users a where not exists (select 1 from public.users p where p.id = a.id);
  insert into _perm_report(section,item,status,detail)
    select 'Users', coalesce(p.email, p.id::text), 'FAIL', 'Profile has no auth account' from public.users p where not exists (select 1 from auth.users a where a.id = p.id);
  insert into _perm_report(section,item,status,detail)
    select 'Users', coalesce(p.full_name, p.email), 'INFO', 'No salary/commission row (salary 0, 0%)' from public.users p
    where p.role in ('manager','sales','telesales') and not exists (select 1 from public.user_commission_rates r where r.user_id = p.id);

  -- ============ 3) تجربة فعلية بشخصية كل مستخدم ============
  tbls := array['leads','meetings','meeting_requests','deals','payments','contract_reviews','users','audit_log',
                'deal_commissions','user_commission_rates','packages','client_comments','activity_logs','exchange_rates','app_settings'];
  for u in select id, coalesce(full_name, email) as nm, role from public.users order by case role when 'admin' then 0 when 'manager' then 1 else 2 end, nm loop
    perform set_config('request.jwt.claim.sub', u.id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    foreach q in array tbls loop
      continue when to_regclass('public.' || q) is null;
      begin
        execute 'set local role authenticated';
        if q = 'leads' then
          execute 'select count(*) from (select 1 from public.leads limit 2000) s' into c;   -- عيّنة سريعة
        else
          execute format('select count(*) from public.%I', q) into c;
        end if;
        execute 'reset role';
        execute format('select count(*) from public.%I', q) into tot;
        if q = 'leads' then tot := least(tot, 2000); end if;
        if u.role = 'admin' and c < tot then
          insert into _perm_report(section,item,status,detail) values ('Admin access', u.nm || ' → ' || q, 'FAIL', 'Admin sees only ' || c || ' of ' || tot);
        elsif u.role <> 'admin' and q in ('audit_log') and c > 0 then
          insert into _perm_report(section,item,status,detail) values ('Leaks', u.nm || ' (' || u.role || ') → ' || q, 'FAIL', 'Non-admin can read the audit log');
        elsif u.role <> 'admin' and q = 'user_commission_rates' and c > (select count(*) from public.users x where x.id = u.id or x.manager_id = u.id) then
          insert into _perm_report(section,item,status,detail) values ('Leaks', u.nm || ' (' || u.role || ') → ' || q, 'FAIL', 'Sees salary/commission rows of people outside own team (' || c || ')');
        else
          insert into _perm_report(section,item,status,detail) values ('Visible rows', u.nm || ' (' || u.role || ')', 'INFO', q || ' = ' || c || case when q = 'leads' then ' (sample max 2000)' else '' end);
        end if;
      exception when others then
        execute 'reset role';
        insert into _perm_report(section,item,status,detail) values ('Visible rows', u.nm || ' (' || u.role || ') → ' || q, case when u.role = 'admin' then 'FAIL' else 'INFO' end, 'Query error: ' || sqlerrm);
      end;
    end loop;

    -- تسريب بيانات العملاء حسب الدور
    begin
      execute 'set local role authenticated';
      if u.role = 'telesales' then
        execute format('select count(*) from (select 1 from public.leads l where l.assigned_to is distinct from %L::uuid limit 1) s', u.id) into leak;
        msg := 'Telesales can see leads NOT assigned to them';
      elsif u.role = 'sales' then
        execute format('select count(*) from (select 1 from public.leads l where not exists (select 1 from public.meetings m where m.lead_id = l.id and m.assigned_sales_id = %L::uuid) limit 1) s', u.id) into leak;
        msg := 'Sales can see leads with no meeting assigned to them';
      elsif u.role = 'manager' then
        execute format('select count(*) from (select 1 from public.leads l where l.assigned_to is distinct from %1$L::uuid and not exists (select 1 from public.users x where x.id = l.assigned_to and x.manager_id = %1$L::uuid) and not exists (select 1 from public.meetings m join public.users x on x.id = m.assigned_sales_id where m.lead_id = l.id and x.manager_id = %1$L::uuid) limit 1) s', u.id) into leak;
        msg := 'Manager can see leads outside their team';
      else leak := 0; end if;
      if u.role = 'telesales' or u.role = 'sales' or u.role = 'manager' then
        execute format('select count(*) from (select 1 from public.deals d where d.closed_by_user_id is distinct from %1$L::uuid and d.sales_user_id is distinct from %1$L::uuid and d.telesales_user_id is distinct from %1$L::uuid and not exists (select 1 from public.users x where x.manager_id = %1$L::uuid and x.id in (d.sales_user_id, d.telesales_user_id, d.closed_by_user_id)) limit 1) s', u.id) into c;
        execute 'reset role';
        if c > 0 then insert into _perm_report(section,item,status,detail) values ('Leaks', u.nm || ' (' || u.role || ') → deals', 'FAIL', 'Can see deals that are not theirs/their team''s'); end if;
        execute 'set local role authenticated';
      end if;
      execute 'reset role';
      if leak > 0 then insert into _perm_report(section,item,status,detail) values ('Leaks', u.nm || ' (' || u.role || ') → leads', 'FAIL', msg); end if;
    exception when others then
      execute 'reset role';
      insert into _perm_report(section,item,status,detail) values ('Leaks', u.nm || ' (' || u.role || ')', 'WARN', 'Leak check error: ' || sqlerrm);
    end;
  end loop;

  -- ============ 4) الأدمن: كتابة فعلية (بتتلغي) ============
  select id into admin_uid from public.users where role = 'admin' order by id limit 1;
  if admin_uid is not null then
    perform set_config('request.jwt.claim.sub', admin_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated')::text, true);
    for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
             where s.nspname = 'public' and c.relkind = 'r' and c.relname <> '_perm_report' order by 1 loop
      select a.attname into pk from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = format('public.%I', t.relname)::regclass and i.indisprimary limit 1;
      continue when pk is null;
      execute format('select exists (select 1 from public.%I)', t.relname) into has_rows;
      -- UPDATE
      if has_table_privilege('authenticated', format('public.%I', t.relname), 'update') then
        n := -1;
        begin
          execute 'set local role authenticated';
          execute format('update public.%1$I set %2$I = %2$I where %2$I = (select %2$I from public.%1$I limit 1)', t.relname, pk);
          get diagnostics n = row_count;
          raise exception 'rollback';
        exception when others then
          if sqlerrm <> 'rollback' then n := -2; msg := sqlerrm; end if;
        end;
        execute 'reset role';
        if n = 0 and has_rows then
          insert into _perm_report(section,item,status,detail) values ('Admin write', t.relname || ' (update)', 'FAIL', 'Admin update affected 0 rows (blocked by policy)');
        elsif n = -2 then
          insert into _perm_report(section,item,status,detail) values ('Admin write', t.relname || ' (update)', 'WARN', 'Error: ' || msg);
        end if;
      end if;
      -- DELETE (FK قد يمنع الحذف = مش مشكلة صلاحيات)
      if has_table_privilege('authenticated', format('public.%I', t.relname), 'delete') then
        n := -1;
        begin
          execute 'set local role authenticated';
          execute format('delete from public.%1$I where %2$I = (select %2$I from public.%1$I limit 1)', t.relname, pk);
          get diagnostics n = row_count;
          raise exception 'rollback';
        exception when others then
          if sqlerrm <> 'rollback' then n := -2; msg := sqlerrm; end if;
        end;
        execute 'reset role';
        if n = 0 and has_rows then
          insert into _perm_report(section,item,status,detail) values ('Admin write', t.relname || ' (delete)', 'FAIL', 'Admin delete affected 0 rows (blocked by policy)');
        end if;
      end if;
    end loop;
    insert into _perm_report(section,item,status,detail)
      select 'Admin write', 'Summary', 'OK', 'Admin can update/delete on every table where direct writes are allowed (others go through RPCs by design)'
      where not exists (select 1 from _perm_report where section = 'Admin write' and status in ('FAIL','WARN'));
  end if;

  -- ============ 5) الأدمن عنده كل الدوال الإدارية؟ ============
  for t in select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('get_audit_feed','get_team_performance','admin_update_user','admin_set_user_pay','get_payroll',
             'get_leads_counts','get_lead_status_counts','merge_duplicate_leads','import_leads','lookup_client_for_deal','set_user_email_confirmed','get_duplicate_stats') loop
    if not has_function_privilege('authenticated', (select oid from pg_proc where proname = t.proname and pronamespace = 'public'::regnamespace limit 1), 'execute') then
      insert into _perm_report(section,item,status,detail) values ('Admin functions', t.proname, 'FAIL', 'authenticated cannot execute it');
    end if;
  end loop;
  insert into _perm_report(section,item,status,detail)
    select 'Admin functions', 'Presence', 'INFO', 'Missing (migration not run yet): ' || string_agg(m, ', ')
    from unnest(array['get_audit_feed','get_team_performance','admin_update_user','admin_set_user_pay','get_payroll','get_leads_counts','get_lead_status_counts','merge_duplicate_leads','import_leads','lookup_client_for_deal','set_user_email_confirmed','get_duplicate_stats']) m
    where not exists (select 1 from pg_proc where proname = m and pronamespace = 'public'::regnamespace) having count(*) > 0;
end $$;

select section, item, status, detail from _perm_report
order by case status when 'FAIL' then 0 when 'WARN' then 1 when 'OK' then 2 else 3 end, section, n;
