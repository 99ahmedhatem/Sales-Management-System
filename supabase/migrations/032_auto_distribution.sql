-- 032: توزيع تلقائي للـ Leads الجديدة + تشغيل يومي للتذكيرات
-- الفكرة: الأدمن يحدد تيليسيلز مشاركين وسقف للـ Leads المفتوحة لكل واحد؛ كل Lead جديد غير موزّع
-- يروح لأقل واحد حمل (عدد الـ Leads المفتوحة). يتشغّل يدوياً (زر) أو تلقائياً كل ساعة/يوم (pg_cron).
-- يعتمد على: my_role() · app_settings (008) · notify_due_followups / notify_upcoming_renewals (009)

-- ---------- 1) إعدادات (يحفظها الأدمن بس) ----------
create or replace function public.set_auto_distribution(
  p_enabled boolean, p_user_ids uuid[], p_max_open int default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can change auto-distribution'; end if;
  if p_enabled and coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'Choose at least one telesales user';
  end if;
  if exists (select 1 from unnest(coalesce(p_user_ids, '{}')) x
             where not exists (select 1 from public.users u where u.id = x and u.role = 'telesales' and u.status = 'active')) then
    raise exception 'The list contains a user who is not an active telesales';
  end if;
  if p_max_open is not null and p_max_open < 1 then raise exception 'Max open leads must be at least 1'; end if;

  insert into public.app_settings (key, value) values
    ('auto_distribute_enabled', case when p_enabled then 'true' else 'false' end),
    ('auto_distribute_users', coalesce(array_to_string(p_user_ids, ','), '')),
    ('auto_distribute_max_open', coalesce(p_max_open::text, ''))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'saved';
end $$;

create or replace function public.get_auto_distribution()
returns table (enabled boolean, user_ids uuid[], max_open int, waiting bigint)
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'auto_distribute_enabled'), 'false') = 'true',
         coalesce((select string_to_array(nullif(value, ''), ',')::uuid[] from public.app_settings where key = 'auto_distribute_users'), '{}'::uuid[]),
         (select nullif(value, '')::int from public.app_settings where key = 'auto_distribute_max_open'),
         (select count(*) from public.leads where assigned_to is null)
  where public.my_role() = 'admin'
$$;

-- ---------- 2) التشغيل ----------
create or replace function public.run_auto_distribution(p_limit int default 5000)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; n int; i int; best int;
  v_loads int[]; v_max int;
  v_lead uuid; v_pick_ids uuid[] := '{}'; v_pick_uids uuid[] := '{}';
  v_done int;
begin
  -- يشتغل من cron (auth.uid() null) أو من الأدمن فقط
  if auth.uid() is not null and public.my_role() <> 'admin' then
    raise exception 'Only admin can run auto-distribution';
  end if;
  if coalesce((select value from public.app_settings where key = 'auto_distribute_enabled'), 'false') <> 'true' then
    return 0;
  end if;

  select coalesce(array_agg(u.id order by u.id), '{}') into v_ids
  from public.users u
  where u.role = 'telesales' and u.status = 'active'
    and u.id = any (coalesce((select string_to_array(nullif(value, ''), ',')::uuid[]
                              from public.app_settings where key = 'auto_distribute_users'), '{}'::uuid[]));
  n := coalesce(array_length(v_ids, 1), 0);
  if n = 0 then return 0; end if;
  v_max := (select nullif(value, '')::int from public.app_settings where key = 'auto_distribute_max_open');

  select array_agg((select count(*)::int from public.leads l
                    where l.assigned_to = t.x
                      and l.status not in ('Subscribed','Converted','Did Not Subscribe','Not Interested')) order by t.ord)
    into v_loads from unnest(v_ids) with ordinality as t(x, ord);

  for v_lead in
    select l.id from public.leads l
    where l.assigned_to is null and l.status = 'New'
    order by l.id limit greatest(p_limit, 0)
  loop
    best := null;
    for i in 1..n loop
      if (v_max is null or v_loads[i] < v_max) and (best is null or v_loads[i] < v_loads[best]) then best := i; end if;
    end loop;
    exit when best is null;                      -- الكل وصل للسقف
    v_pick_ids  := v_pick_ids  || v_lead;
    v_pick_uids := v_pick_uids || v_ids[best];
    v_loads[best] := v_loads[best] + 1;
  end loop;

  if coalesce(array_length(v_pick_ids, 1), 0) = 0 then return 0; end if;

  create temp table _auto_done on commit drop as
  with u as (
    update public.leads l
       set assigned_to = p.uid, status = 'Assigned', updated_at = now()
      from unnest(v_pick_ids, v_pick_uids) as p(id, uid)
     where l.id = p.id and l.assigned_to is null
    returning l.id, p.uid
  ) select id, uid from u;

  insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
  -- actor_id إجباري (FK على auth.users): الأدمن لو شغّلها يدوياً، وإلا الموظف المستلم (تشغيل cron)
  select d.id, coalesce(auth.uid(), d.uid), 'System', 'system', 'assignment', 'Assigned', 'Auto distribution' from _auto_done d;

  insert into public.notifications (user_id, type, title, message)
  select d.uid, 'assignment', 'عملاء جدد', 'تم توزيع ' || count(*) || ' عميل عليك تلقائياً'
  from _auto_done d group by d.uid;

  select count(*) into v_done from _auto_done;
  return v_done;
end $$;

-- ---------- 3) مهمة يومية واحدة تجمع كل حاجة ----------
create or replace function public.run_daily_jobs()
returns table (job text, affected int)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.my_role() <> 'admin' then raise exception 'Only admin'; end if;
  job := 'auto_distribution';      affected := public.run_auto_distribution();  return next;
  job := 'followup_reminders';     affected := public.notify_due_followups();   return next;
  job := 'renewal_reminders';      affected := public.notify_upcoming_renewals(); return next;
end $$;

revoke all on function public.set_auto_distribution(boolean, uuid[], int) from public, anon;
revoke all on function public.get_auto_distribution() from public, anon;
revoke all on function public.run_auto_distribution(int) from public, anon;
revoke all on function public.run_daily_jobs() from public, anon;
grant execute on function public.set_auto_distribution(boolean, uuid[], int) to authenticated;
grant execute on function public.get_auto_distribution() to authenticated;
grant execute on function public.run_auto_distribution(int) to authenticated;
grant execute on function public.run_daily_jobs() to authenticated;

-- ---------- 4) جدولة تلقائية (اختياري): فعّل pg_cron من Database → Extensions ثم شغّل السطرين ----------
-- select cron.schedule('daily-jobs',   '0 5 * * *', $$select * from public.run_daily_jobs()$$);          -- كل يوم 8 ص بتوقيت القاهرة
-- select cron.schedule('auto-distribute', '*/15 * * * *', $$select public.run_auto_distribution()$$);     -- كل 15 دقيقة
