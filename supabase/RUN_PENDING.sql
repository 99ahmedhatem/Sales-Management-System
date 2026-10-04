-- =====================================================================
-- RUN_PENDING — كل الـ migrations اللي ما اتشغّلتش في Supabase بعد 013، بالترتيب:
--   014_repair_fixes → 015_lead_status_counts → 016_audit_everything → 017_worked_clients_count → 018_team_performance → 020_reports_summary
-- انسخ الملف كله في Supabase SQL Editor وشغّله مرة واحدة. آمن لو اتشغّل تاني
-- (create or replace / if not exists)، ومفيش فيه drop table ولا delete ولا truncate.
-- الملفات 004 و008 و009 و010 و011 و012 و013 اتشغّلت قبل كده، فمش هنا.
-- =====================================================================

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- >>> 014_repair_fixes.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- 014 — إصلاحات على 011 (شغّله بعد 013، آمن لو اتشغّل تاني؛ كان اسمه 012_repair_fixes)
--
-- 1) تأكيد الإيميل: 009_email_confirm_toggle كان بيخزّن علامة في public.users.email_confirmed
--    مالهاش أي تأثير على الدخول، و011 ما بيستبدلش الفانكشنز لو موجودة. هنا بنخلّيهم
--    دايماً يقروا/يكتبوا auth.users.email_confirmed_at (الحالة الحقيقية).
-- 2) fill_missing_phones: لو my_role() رجّعت null، شرط `not in` كان بيعدّي.
-- 3) refresh_deal_commission_cache: لو صف عمولة القافل اتمسح، الكاش كان بيفضل بالقيمة القديمة.
-- =====================================================================

-- 1) تأكيد الإيميل
create or replace function public.list_email_confirmations()
returns table (id uuid, confirmed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'Only admin can read email confirmations';
  end if;
  return query select u.id, (au.email_confirmed_at is not null)
               from public.users u left join auth.users au on au.id = u.id;
end $$;
revoke execute on function public.list_email_confirmations() from public, anon;
grant execute on function public.list_email_confirmations() to authenticated;

create or replace function public.set_user_email_confirmed(target_user_id uuid, should_confirm boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'Only admin can change email confirmation';
  end if;
  update auth.users
     set email_confirmed_at = case when should_confirm then coalesce(email_confirmed_at, now()) else null end
   where id = target_user_id;
  if not found then raise exception 'User not found'; end if;
end $$;
revoke execute on function public.set_user_email_confirmed(uuid, boolean) from public, anon;
grant execute on function public.set_user_email_confirmed(uuid, boolean) to authenticated;

-- 2) fill_missing_phones (نفس تعريف 011 مع شرط صلاحية مقفول على null)
do $$
begin
  if to_regprocedure('public.fill_missing_phones(jsonb)') is null
     or pg_get_function_result('public.fill_missing_phones(jsonb)'::regprocedure) = 'integer' then
    execute $f$
      create or replace function public.fill_missing_phones(rows jsonb)
      returns integer
      language plpgsql security definer set search_path = public as $b$
      declare n integer;
      begin
        if coalesce(public.my_role(), '') not in ('admin','manager') then
          raise exception 'Only admin or manager can import phones';
        end if;
        with src as (
          select r ->> 'website_key' as website_key,
                 nullif(regexp_replace(coalesce(r ->> 'phone', ''), '[^0-9+]', '', 'g'), '') as phone
          from jsonb_array_elements(rows) r
        ), upd as (
          update public.leads l
             set phone = s.phone, phone_source = 'manual', updated_at = now()
            from src s
           where s.website_key is not null and s.phone is not null
             and l.website_key = s.website_key
             and (l.phone is null or l.phone = '')
          returning 1
        ) select count(*) into n from upd;
        return n;
      end $b$
    $f$;
    revoke execute on function public.fill_missing_phones(jsonb) from public, anon;
    grant execute on function public.fill_missing_phones(jsonb) to authenticated;
  else
    raise notice 'fill_missing_phones has a different return type; left unchanged';
  end if;
end $$;

-- 3) كاش عمولة الديل: يرجع null لو مفيش صف للقافل
do $$
begin
  if to_regclass('public.deal_commissions') is not null then
    create or replace function public.refresh_deal_commission_cache(p_deal_id uuid)
    returns void language plpgsql security definer set search_path = public as $f$
    declare p numeric;
    begin
      select percent into p from public.deal_commissions
       where deal_id = p_deal_id and role_in_deal in ('closer_sales','closer_telesales')
       order by created_at limit 1;
      update public.deals d
         set commission_percent = p,
             commission_sar = case when p is null then null else round(d.price_sar * p / 100, 2) end
       where d.id = p_deal_id;
    end $f$;
    revoke execute on function public.refresh_deal_commission_cache(uuid) from public, anon, authenticated;

    perform public.refresh_deal_commission_cache(d.id) from public.deals d;
  end if;
end $$;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- >>> 015_lead_status_counts.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 015 — عدّ دقيق للعملاء حسب الحالة (لوحة تحكم الأدمن) في استعلام واحد
-- بدل 8 استعلامات count منفصلة على leads. آمن لو اتشغّل تاني، مفيش تعديل لبيانات. يعتمد على my_role().
create or replace function public.get_lead_status_counts()
returns table (status text, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read global lead counts';
  end if;
  return query
    select l.status::text, count(*)
    from public.leads l
    group by l.status;
end $$;

revoke execute on function public.get_lead_status_counts() from public, anon;
grant execute on function public.get_lead_status_counts() to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- >>> 016_audit_everything.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- 016 — تسجيل كل حاجة مهمة بتحصل في السستم (audit_log) + دالة لعرضها بأسماء الموظفين.
-- بيكمّل اللي موجود من 009 (الإعدادات، الصفقات، المدفوعات، أدوار المستخدمين).
-- مفيش تعديل في أي بيانات موجودة. آمن لو اتشغّل تاني.
-- =====================================================================

-- نسخة خفيفة من التسجيل: بتخزّن الحقول المهمة بس (مش الصف كله) عشان التوزيع/الاستيراد الكبير ما يتقلش.
create or replace function public.trg_audit_lean()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_keys text[] := tg_argv;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into public.audit_log (table_name, row_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name, v_row ->> 'id', tg_op, auth.uid(),
    (select jsonb_object_agg(k, v_old -> k) from unnest(v_keys) k where v_old is not null),
    (select jsonb_object_agg(k, v_new -> k) from unnest(v_keys) k where v_new is not null)
  );
  return null;
end $$;

do $$
begin
  -- العملاء: تغيّر الحالة / التوزيع / التليفون / الحذف / الإضافة اليدوية
  drop trigger if exists audit_leads_upd on public.leads;
  create trigger audit_leads_upd after update on public.leads for each row
    when (old.status is distinct from new.status or old.assigned_to is distinct from new.assigned_to
          or old.phone is distinct from new.phone or old.loss_reason is distinct from new.loss_reason)
    execute function public.trg_audit_lean('name','status','assigned_to','phone','loss_reason');
  drop trigger if exists audit_leads_del on public.leads;
  create trigger audit_leads_del after delete on public.leads for each row
    execute function public.trg_audit_lean('name','customer_number','status','assigned_to','phone');

  -- الميتنجز وطلبات الميتنج
  drop trigger if exists audit_meetings on public.meetings;
  create trigger audit_meetings after insert or update or delete on public.meetings for each row
    execute function public.trg_audit_lean('lead_id','booked_by','assigned_sales_id','proposed_date','outcome','loss_reason');
  drop trigger if exists audit_meeting_requests on public.meeting_requests;
  create trigger audit_meeting_requests after insert or update or delete on public.meeting_requests for each row
    execute function public.trg_audit_lean('lead_id','requested_by','assigned_sales_id','status','preferred_date');

  -- الصفقات: الإنشاء والحذف كمان (التعديل على الحالة/السعر متسجّل من 009)
  drop trigger if exists audit_deals_ins on public.deals;
  create trigger audit_deals_ins after insert or delete on public.deals for each row
    execute function public.trg_audit_lean('lead_id','package_id','closed_by_user_id','price_sar','status');

  -- مراجعات العقود
  if to_regclass('public.contract_reviews') is not null then
    drop trigger if exists audit_contract_reviews on public.contract_reviews;
    create trigger audit_contract_reviews after insert or update of status on public.contract_reviews for each row
      execute function public.trg_audit_lean('deal_id','status');
  end if;

  -- المستخدمين: إضافة / حذف / تغيير نسبة العمولة (تغيير الدور والحالة متسجّل من 009)
  drop trigger if exists audit_users_ins on public.users;
  create trigger audit_users_ins after insert or delete on public.users for each row
    execute function public.trg_audit_lean('full_name','email','role','manager_id','status');
  drop trigger if exists audit_users_commission on public.users;
  create trigger audit_users_commission after update of commission_percent on public.users for each row
    when (old.commission_percent is distinct from new.commission_percent)
    execute function public.trg_audit_lean('full_name','commission_percent');
end $$;

create index if not exists audit_log_user_idx on public.audit_log (changed_by, created_at desc);

-- عرض السجل للأدمن بأسماء الموظفين، مع فلاتر وصفحات
create or replace function public.get_audit_feed(
  p_limit int default 100, p_offset int default 0,
  p_table text default null, p_user uuid default null,
  p_from timestamptz default null, p_to timestamptz default null)
returns table (id bigint, created_at timestamptz, table_name text, action text, row_id text,
               changed_by uuid, changed_by_name text, old_data jsonb, new_data jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read the audit log';
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.action, a.row_id, a.changed_by,
           coalesce(u.full_name, case when a.changed_by is null then 'System / SQL' end), a.old_data, a.new_data
    from public.audit_log a left join public.users u on u.id = a.changed_by
    where (p_table is null or a.table_name = p_table)
      and (p_user is null or a.changed_by = p_user)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
    order by a.created_at desc, a.id desc
    limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
end $$;
revoke execute on function public.get_audit_feed(int,int,text,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_audit_feed(int,int,text,uuid,timestamptz,timestamptz) to authenticated;

-- ملخص لكل جدول (للفلتر)
create or replace function public.get_audit_tables()
returns table (table_name text, events bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'Only admin'; end if;
  return query select a.table_name, count(*) from public.audit_log a group by 1 order by 2 desc;
end $$;
revoke execute on function public.get_audit_tables() from public, anon;
grant execute on function public.get_audit_tables() to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- >>> 017_worked_clients_count.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- 017 — عدد العملاء المختلفين اللي اتشغل عليهم (مكالمات/تحويل) بدل تحميل كل activity_logs في المتصفح.
-- آمن لو اتشغّل تاني، مفيش تعديل لبيانات. لازم يتشغّل بعد 016.
-- الصلاحية: الأدمن لأي حد، وغير كده المستخدم لنفسه أو لأعضاء فريقه (manager_id = هو).
-- =====================================================================
create or replace function public.get_worked_clients_count(
  p_user_ids uuid[],
  p_activity_types text[] default array['call', 'forward']
)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare n bigint;
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return 0;
  end if;
  if public.my_role() is distinct from 'admin' and exists (
    select 1 from unnest(p_user_ids) as requested(id)
    where requested.id <> auth.uid()
      and not exists (select 1 from public.users u where u.id = requested.id and u.manager_id = auth.uid())
  ) then
    raise exception 'You can only count clients for yourself or your team';
  end if;
  select count(distinct a.lead_id) into n
  from public.activity_logs a
  where a.actor_id = any(p_user_ids)
    and a.activity_type = any(coalesce(p_activity_types, array['call', 'forward']));
  return n;
end $$;

revoke execute on function public.get_worked_clients_count(uuid[], text[]) from public, anon;
grant execute on function public.get_worked_clients_count(uuid[], text[]) to authenticated;

-- lead_id جوه الـ index عشان count(distinct lead_id) يتحسب من الـ index من غير ما يقرا الجدول.
create index if not exists activity_logs_actor_type_lead_idx on public.activity_logs (actor_id, activity_type, lead_id);

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- >>> 018_team_performance.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 018: أداء الفريق + المرتبات + تعديل مرتب/نسب أي موظف
-- آمن للتشغيل أكتر من مرة. بيعتمد على 008 (user_commission_rates, deal_commissions, payments).

-- ---------- 1) أداء كل موظف / مدير / فريق في فترة ----------
-- select * from get_team_performance('2026-10-01','2026-10-31');   -- فترة
-- select * from get_team_performance();                              -- من الأول لحد دلوقتي
-- أدمن: الكل | مانجر: هو وفريقه | غيره: نفسه بس
create or replace function public.get_team_performance(p_from date default null, p_to date default null)
returns table (
  user_id uuid, full_name text, role text, manager_id uuid, manager_name text,
  base_salary numeric, base_currency text,
  closer_percent numeric, lead_percent numeric, manager_percent numeric,
  deals_count bigint, deals_value_sar numeric,
  collected_sar numeric, collected_egp numeric,
  collected_total_sar numeric, collected_total_egp numeric,
  commission_sar numeric, commission_egp numeric)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(p_from, date '2000-01-01')::timestamptz as s,
           (coalesce(p_to, current_date) + 1)::timestamptz as e,
           coalesce((select value from public.app_settings where key = 'commission_basis'), 'deal_value') as basis,
           coalesce(public.current_sar_to_egp(), 0) as fx
  ),
  vis as (
    select u.id, u.full_name, u.role, u.manager_id
    from public.users u
    where u.role in ('manager','sales','telesales')
      and (public.my_role() = 'admin' or u.id = auth.uid() or u.manager_id = auth.uid())
  ),
  dl as (
    select d.closed_by_user_id as uid, count(*) as n, sum(d.price_sar) as v
    from public.deals d cross join cfg c
    where d.status in ('approved','active') and d.approved_at >= c.s and d.approved_at < c.e
    group by 1
  ),
  pay as (
    select d.closed_by_user_id as uid,
      sum(p.amount_sar) filter (where p.paid_at >= c.s and p.paid_at < c.e) as ps,
      sum(p.amount_egp) filter (where p.paid_at >= c.s and p.paid_at < c.e) as pe,
      sum(p.amount_sar) as ts, sum(p.amount_egp) as te
    from public.payments p
    join public.deals d on d.id = p.deal_id and d.status in ('approved','active')
    cross join cfg c
    where p.confirmed
    group by 1
  ),
  lines as (
    select dc.user_id,
      case when c.basis = 'deal_value' then d.price_sar * dc.percent / 100
           else coalesce((select sum(p.amount_sar) from public.payments p
                          where p.deal_id = d.id and p.confirmed and p.paid_at >= c.s and p.paid_at < c.e), 0) * dc.percent / 100 end as c_sar,
      case when c.basis = 'deal_value' then d.price_sar * coalesce(d.fx_at_approval, c.fx) * dc.percent / 100
           else coalesce((select sum(p.amount_egp) from public.payments p
                          where p.deal_id = d.id and p.confirmed and p.paid_at >= c.s and p.paid_at < c.e), 0) * dc.percent / 100 end as c_egp
    from public.deal_commissions dc
    join public.deals d on d.id = dc.deal_id
    cross join cfg c
    where d.status in ('approved','active')
      and (c.basis <> 'deal_value' or (d.approved_at >= c.s and d.approved_at < c.e))
  ),
  cm as (select user_id as uid, sum(c_sar) as s, sum(c_egp) as e from lines group by 1)
  select v.id, v.full_name, v.role, v.manager_id, m.full_name,
         coalesce(r.base_salary, 0), coalesce(r.base_currency, 'EGP'),
         coalesce(r.closer_percent, 0), coalesce(r.lead_percent, 0), coalesce(r.manager_percent, 0),
         coalesce(dl.n, 0), round(coalesce(dl.v, 0), 2),
         round(coalesce(pay.ps, 0), 2), round(coalesce(pay.pe, 0), 2),
         round(coalesce(pay.ts, 0), 2), round(coalesce(pay.te, 0), 2),
         round(coalesce(cm.s, 0), 2), round(coalesce(cm.e, 0), 2)
  from vis v
  left join public.users m on m.id = v.manager_id
  left join public.user_commission_rates r on r.user_id = v.id
  left join dl on dl.uid = v.id
  left join pay on pay.uid = v.id
  left join cm on cm.uid = v.id
  order by case v.role when 'manager' then 0 when 'sales' then 1 else 2 end, v.full_name
$$;
revoke execute on function public.get_team_performance(date, date) from public, anon;
grant execute on function public.get_team_performance(date, date) to authenticated;

-- ---------- 2) الأدمن يعدّل مرتب ونسب أي موظف (من شاشة المستخدمين) ----------
create or replace function public.admin_set_user_pay(
  p_user_id uuid,
  p_base_salary numeric default null,
  p_base_currency text default null,
  p_closer_percent numeric default null,
  p_lead_percent numeric default null,
  p_manager_percent numeric default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can change pay settings'; end if;
  if not exists (select 1 from public.users where id = p_user_id) then raise exception 'User not found'; end if;
  if p_base_currency is not null and p_base_currency not in ('SAR','EGP') then raise exception 'Currency must be SAR or EGP'; end if;
  if p_base_salary is not null and p_base_salary < 0 then raise exception 'Salary cannot be negative'; end if;
  if coalesce(p_closer_percent, 0) not between 0 and 100
     or coalesce(p_lead_percent, 0) not between 0 and 100
     or coalesce(p_manager_percent, 0) not between 0 and 100 then
    raise exception 'Percent must be between 0 and 100';
  end if;

  insert into public.user_commission_rates as r (user_id, base_salary, base_currency, closer_percent, lead_percent, manager_percent, updated_by)
  values (p_user_id, coalesce(p_base_salary, 0), coalesce(p_base_currency, 'EGP'),
          coalesce(p_closer_percent, 0), coalesce(p_lead_percent, 0), coalesce(p_manager_percent, 0), auth.uid())
  on conflict (user_id) do update set
    base_salary     = coalesce(p_base_salary,     r.base_salary),
    base_currency   = coalesce(p_base_currency,   r.base_currency),
    closer_percent  = coalesce(p_closer_percent,  r.closer_percent),
    lead_percent    = coalesce(p_lead_percent,    r.lead_percent),
    manager_percent = coalesce(p_manager_percent, r.manager_percent),
    updated_by = auth.uid(), updated_at = now();

  -- نسبة القفل بتتزامن مع users.commission_percent (الموجودة في 011)
  if p_closer_percent is not null then
    update public.users set commission_percent = p_closer_percent where id = p_user_id and commission_percent is distinct from p_closer_percent;
  end if;
end $$;
revoke execute on function public.admin_set_user_pay(uuid, numeric, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.admin_set_user_pay(uuid, numeric, text, numeric, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- >>> 020_reports_summary.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
-- 020 — صفحة Reports بتتحسب في الداتابيز بدل ما المتصفح يحمّل كل leads و activity_logs.
-- استعلام واحد بيرجّع JSON صغير. آمن لو اتشغّل تاني، مفيش تعديل لبيانات.
-- =====================================================================
create or replace function public.get_reports_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read reports';
  end if;

  select jsonb_build_object(
    'leads', (
      select jsonb_build_object(
        'total',      count(*),
        'assigned',   count(*) filter (where assigned_to is not null),
        'contacted',  count(*) filter (where status in ('Contacted','Interested','Not Interested','Converted','Call Back Later','No Answer')),
        'interested', count(*) filter (where status = 'Interested'),
        'converted',  count(*) filter (where status = 'Converted'))
      from public.leads),
    'meetings', (
      select jsonb_build_object(
        'won',  count(*) filter (where outcome = 'Deal Closed – Won'),
        'lost', count(*) filter (where outcome = 'Deal Lost'))
      from public.meetings),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', s.source, 'count', s.n, 'converted', s.c) order by s.n desc)
      from (select coalesce(nullif(l.source, ''), 'Unknown') as source, count(*) as n,
                   count(*) filter (where l.status = 'Converted') as c
            from public.leads l group by 1) s), '[]'::jsonb),
    'telesales', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'full_name', u.full_name,
               'total', coalesce(l.n, 0), 'converted', coalesce(l.c, 0), 'calls', coalesce(a.n, 0)) order by u.full_name)
      from public.users u
      left join (select assigned_to, count(*) as n, count(*) filter (where status = 'Converted') as c
                 from public.leads where assigned_to is not null group by 1) l on l.assigned_to = u.id
      left join (select actor_id, count(*) as n
                 from public.activity_logs where activity_type = 'call' group by 1) a on a.actor_id = u.id
      where u.role = 'telesales'), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'full_name', u.full_name,
               'total', coalesce(m.n, 0), 'won', coalesce(m.won, 0), 'lost', coalesce(m.lost, 0)) order by u.full_name)
      from public.users u
      left join (select assigned_sales_id, count(*) as n,
                        count(*) filter (where outcome = 'Deal Closed – Won') as won,
                        count(*) filter (where outcome = 'Deal Lost') as lost
                 from public.meetings group by 1) m on m.assigned_sales_id = u.id
      where u.role = 'sales'), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.get_reports_summary() from public, anon;
grant execute on function public.get_reports_summary() to authenticated;

-- عدّ عملاء كل موظف (لوحة المانجر) بدل العدّ من الـ 100 صف اللي في الصفحة الحالية.
-- الصلاحية: الأدمن لأي حد، وغير كده نفسك أو فريقك (manager_id = أنت).
create or replace function public.get_team_lead_stats(p_user_ids uuid[])
returns table (user_id uuid, total bigint, contacted bigint, converted bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;
  if public.my_role() is distinct from 'admin' and exists (
    select 1 from unnest(p_user_ids) as requested(id)
    where requested.id <> auth.uid()
      and not exists (select 1 from public.users u where u.id = requested.id and u.manager_id = auth.uid())
  ) then
    raise exception 'You can only count clients for yourself or your team';
  end if;
  return query
    select l.assigned_to, count(*),
           count(*) filter (where l.status not in ('New', 'Assigned')),
           count(*) filter (where l.status in ('Subscribed', 'Converted'))
    from public.leads l
    where l.assigned_to = any(p_user_ids)
    group by l.assigned_to;
end $$;

revoke execute on function public.get_team_lead_stats(uuid[]) from public, anon;
grant execute on function public.get_team_lead_stats(uuid[]) to authenticated;

-- قايمة التيلي سيلز: فلتر بالموظف + ترتيب بالتاريخ في index واحد (بدل index للفلتر وindex للترتيب).
create index if not exists leads_assigned_created_idx on public.leads (assigned_to, created_at desc, id desc);

notify pgrst, 'reload schema';

-- =====================================================================
-- تحقّق (قراءة بس): كل RPC/view الكود بيستخدمها. لازم يرجّع 0 صفوف.
-- =====================================================================
select 'missing function' as problem, f as name
from unnest(array[
  'get_leads_counts','get_lead_status_counts','get_worked_clients_count',
  'set_lead_customer_number','fill_missing_phones','list_email_confirmations','set_user_email_confirmed','delete_user_account',
  'request_meeting','cancel_meeting_request','create_deal','attach_recording','attach_contract','approve_deal',
  'get_month_revenue','get_daily_summary','get_funnel_stats','get_target_progress','get_loss_report',
  'get_source_performance','get_leaderboard','get_attention_items','get_payroll',
  'get_audit_feed','get_audit_tables','get_team_performance','admin_set_user_pay','get_reports_summary','get_team_lead_stats'
]) f
where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)
union all
select 'missing view/table', t
from unnest(array['monthly_revenue','audit_log','user_commission_rates','activity_logs','client_comments','notifications','packages',
                  'meeting_requests','meetings','deals','contract_reviews','users','leads']) t
where to_regclass('public.' || t) is null;
