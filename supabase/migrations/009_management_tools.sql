-- =====================================================================
-- 009 — أدوات المتابعة والإدارة (بعد 008)
--  1) assigned_at على العملاء (وقت التوزيع) -> عشان نقيس السرعة
--  2) شاشة "محتاج تدخّل"            get_attention_items()
--  3) Funnel لكل موظف بالزمن         get_funnel_stats(from, to)
--  4) الأهداف الشهرية + Leaderboard  user_targets / get_target_progress / get_leaderboard
--  5) أسباب الخسارة                  loss_reasons / mark_meeting_lost / get_loss_report
--  6) أدوات التوزيع                  distribute_leads_evenly / reassign_user_leads
--  7) جودة مصادر الداتا              get_source_performance
--  8) سجل التغييرات                  audit_log + triggers
--  9) تذكيرات (متابعات + تجديدات)    notify_due_followups / notify_upcoming_renewals
-- 10) ملخص اليوم                     get_daily_summary
-- آمن لو اتشغّل مرتين.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) helpers + إعدادات الـ SLA (تتعدّل من app_settings)
-- ---------------------------------------------------------------------
create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value, '')::numeric from public.app_settings where key = p_key), p_default)
$$;
grant execute on function public.setting_num(text, numeric) to authenticated;

insert into public.app_settings (key, value) values
  ('sla_first_call_hours', '24'),       -- عميل متوزّع ومحدش كلمه
  ('sla_request_response_hours', '12'), -- طلب ميتنج السيلز ما ردّش عليه
  ('meeting_no_outcome_hours', '2'),    -- ميتنج عدّى ومفيش نتيجة
  ('deal_draft_days', '2'),             -- ديل من غير عقد
  ('deal_approval_days', '1'),          -- ديل مستني موافقة
  ('payment_confirm_days', '2')         -- دفعة مستنية تأكيد
on conflict do nothing;

-- مين المستخدمين اللي المتصل يقدر يشوف أرقامهم (أدمن: الكل | مانجر: هو وفريقه | غيره: نفسه)
create or replace function public.visible_user_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select u.id from public.users u
  where public.my_role() = 'admin' or u.id = auth.uid()
     or (public.my_role() = 'manager' and u.manager_id = auth.uid())
$$;
revoke execute on function public.visible_user_ids() from public, anon;
grant execute on function public.visible_user_ids() to authenticated;

-- ---------------------------------------------------------------------
-- 1) وقت التوزيع على العميل
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists assigned_at timestamptz;
update public.leads set assigned_at = coalesce(updated_at, created_at)
 where assigned_to is not null and assigned_at is null;

create or replace function public.trg_leads_assigned_at()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is not null and new.assigned_at is null then new.assigned_at := now(); end if;
  elsif new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists leads_assigned_at on public.leads;
create trigger leads_assigned_at before insert or update of assigned_to on public.leads
  for each row execute function public.trg_leads_assigned_at();

-- ---------------------------------------------------------------------
-- 2) أسباب الخسارة
-- ---------------------------------------------------------------------
create table if not exists public.loss_reasons (
  code text primary key,
  label_ar text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);
alter table public.loss_reasons enable row level security;
drop policy if exists "loss reasons read" on public.loss_reasons;
create policy "loss reasons read" on public.loss_reasons for select to authenticated using (true);
drop policy if exists "loss reasons admin write" on public.loss_reasons;
create policy "loss reasons admin write" on public.loss_reasons for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
insert into public.loss_reasons (code, label_ar, sort_order) values
  ('price',          'السعر مرتفع', 1),
  ('not_interested', 'غير مهتم', 2),
  ('competitor',     'اشترى من منافس', 3),
  ('no_answer',      'لا يرد', 4),
  ('no_budget',      'مفيش ميزانية', 5),
  ('timing',         'مش دلوقتي', 6),
  ('has_solution',   'عنده نظام بالفعل', 7),
  ('other',          'سبب آخر', 99)
on conflict do nothing;

alter table public.leads
  add column if not exists loss_reason text references public.loss_reasons(code),
  add column if not exists loss_note text;
alter table public.meetings
  add column if not exists loss_reason text references public.loss_reasons(code),
  add column if not exists loss_note text;

create or replace function public.mark_meeting_lost(
  target_meeting_id uuid, p_reason_code text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare m public.meetings; v_role text := public.my_role(); v_label text;
begin
  select * into m from public.meetings where id = target_meeting_id for update;
  if not found then raise exception 'Meeting not found'; end if;
  if not (
    (v_role = 'sales' and m.assigned_sales_id = auth.uid())
    or v_role = 'admin'
    or (v_role = 'manager' and exists (select 1 from public.users u where u.id = m.assigned_sales_id and u.manager_id = auth.uid()))
  ) then raise exception 'Not allowed'; end if;
  if m.outcome = 'Deal Closed – Won' then raise exception 'This meeting already ended with a deal'; end if;
  select label_ar into v_label from public.loss_reasons where code = p_reason_code and is_active;
  if v_label is null then raise exception 'Choose a valid loss reason'; end if;

  update public.meetings set outcome = 'Deal Lost', loss_reason = p_reason_code, loss_note = nullif(trim(p_note), '')
   where id = target_meeting_id;
  update public.leads set status = 'Did Not Subscribe', loss_reason = p_reason_code,
         loss_note = nullif(trim(p_note), ''), needs_meeting = false, updated_at = now()
   where id = m.lead_id;
  insert into public.notifications (user_id, type, title, message)
  values (m.booked_by, 'meeting', 'الميتنج انتهى بدون صفقة', 'السبب: ' || v_label);
end $$;
grant execute on function public.mark_meeting_lost(uuid, text, text) to authenticated;

-- تقرير الخسارة (invoker: كل واحد يشوف حسب صلاحياته)
create or replace function public.get_loss_report(p_from date default date_trunc('month', current_date)::date, p_to date default current_date)
returns table (code text, label_ar text, meetings_lost bigint, leads_lost bigint, total bigint)
language sql stable security invoker set search_path = public as $$
  with m as (select loss_reason c, count(*) n from public.meetings
              where outcome = 'Deal Lost' and loss_reason is not null
                and proposed_date >= p_from and proposed_date < p_to + 1 group by 1),
       l as (select loss_reason c, count(*) n from public.leads
              where loss_reason is not null and updated_at >= p_from and updated_at < p_to + 1 group by 1)
  select r.code, r.label_ar, coalesce(m.n, 0), coalesce(l.n, 0), coalesce(m.n, 0) + coalesce(l.n, 0)
  from public.loss_reasons r left join m on m.c = r.code left join l on l.c = r.code
  where coalesce(m.n, 0) + coalesce(l.n, 0) > 0
  order by 5 desc
$$;
grant execute on function public.get_loss_report(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3) شاشة "محتاج تدخّل" (invoker: RLS بتفلتر لكل دور)
-- ---------------------------------------------------------------------
create or replace function public.get_attention_items()
returns table (kind text, severity text, entity_id uuid, lead_id uuid, lead_name text,
               owner_id uuid, owner_name text, since timestamptz, age_hours numeric, detail text)
language sql stable security invoker set search_path = public as $$
  select * from (
    -- عميل متوزّع ومحدش كلمه
    select 'lead_not_contacted'::text as kind, 'high'::text as severity, l.id as entity_id, l.id as lead_id,
           l.name::text as lead_name, l.assigned_to as owner_id, u.full_name::text as owner_name,
           l.assigned_at as since,
           round(extract(epoch from now() - l.assigned_at) / 3600, 1) as age_hours,
           'متوزّع ولم يتم الاتصال به'::text as detail
    from public.leads l join public.users u on u.id = l.assigned_to
    where l.assigned_at is not null and l.status in ('New','Assigned')
      and l.assigned_at < now() - public.setting_num('sla_first_call_hours', 24) * interval '1 hour'
      and not exists (select 1 from public.activity_logs a
                      where a.lead_id = l.id and a.activity_type = 'call' and a.created_at >= l.assigned_at)
    union all
    -- متابعة متأخرة
    select 'callback_overdue', 'medium', l.id, l.id, l.name::text, l.assigned_to, u.full_name::text,
           l.callback_date::date::timestamptz,
           round(extract(epoch from now() - l.callback_date::date::timestamptz) / 3600, 1), 'ميعاد المتابعة عدّى'
    from public.leads l join public.users u on u.id = l.assigned_to
    where l.status = 'Call Back Later' and l.callback_date is not null and l.callback_date::date < current_date
    union all
    -- طلب ميتنج السيلز ما ردّش
    select 'request_unanswered', 'high', r.id, r.lead_id, l.name::text, r.assigned_sales_id, u.full_name::text, r.created_at,
           round(extract(epoch from now() - r.created_at) / 3600, 1), 'طلب ميتنج مستني رد السيلز'
    from public.meeting_requests r
    join public.leads l on l.id = r.lead_id
    join public.users u on u.id = r.assigned_sales_id
    where r.status = 'pending' and r.created_at < now() - public.setting_num('sla_request_response_hours', 12) * interval '1 hour'
    union all
    -- ميتنج عدّى من غير نتيجة
    select 'meeting_no_outcome', 'high', m.id, m.lead_id, l.name::text, m.assigned_sales_id, u.full_name::text, m.proposed_date,
           round(extract(epoch from now() - m.proposed_date) / 3600, 1), 'الميتنج عدّى ولم تُسجّل نتيجته'
    from public.meetings m
    join public.leads l on l.id = m.lead_id
    join public.users u on u.id = m.assigned_sales_id
    where m.outcome = 'Scheduled' and m.proposed_date < now() - public.setting_num('meeting_no_outcome_hours', 2) * interval '1 hour'
    union all
    -- ديل من غير عقد
    select 'deal_without_contract', 'medium', d.id, d.lead_id, l.name::text, d.closed_by_user_id, u.full_name::text, d.created_at,
           round(extract(epoch from now() - d.created_at) / 3600, 1), 'ديل لم يُرفع له عقد'
    from public.deals d
    join public.leads l on l.id = d.lead_id
    join public.users u on u.id = d.closed_by_user_id
    where d.status = 'draft' and d.created_at < now() - public.setting_num('deal_draft_days', 2) * interval '1 day'
    union all
    -- مراجعة العقد محتاجة قرار
    select 'review_needs_attention', 'high', d.id, d.lead_id, l.name::text, d.closed_by_user_id, u.full_name::text, cr.created_at,
           round(extract(epoch from now() - cr.created_at) / 3600, 1),
           case when cr.status = 'failed' then 'مراجعة العقد فشلت تقنياً' else 'مراجعة العقد فيها اختلافات' end
    from public.deals d
    join lateral (select r.status, r.created_at from public.contract_reviews r
                  where r.deal_id = d.id order by r.created_at desc, r.id desc limit 1) cr on true
    join public.leads l on l.id = d.lead_id
    join public.users u on u.id = d.closed_by_user_id
    where d.status in ('contract_uploaded','pending_approval','draft') and cr.status in ('needs_attention','failed')
    union all
    -- ديل مستني موافقة
    select 'deal_awaiting_approval', 'medium', d.id, d.lead_id, l.name::text, d.closed_by_user_id, u.full_name::text, d.updated_at,
           round(extract(epoch from now() - d.updated_at) / 3600, 1), 'ديل مستني موافقة'
    from public.deals d
    join public.leads l on l.id = d.lead_id
    join public.users u on u.id = d.closed_by_user_id
    where d.status = 'pending_approval' and d.updated_at < now() - public.setting_num('deal_approval_days', 1) * interval '1 day'
    union all
    -- دفعة مستنية تأكيد
    select 'payment_unconfirmed', 'medium', p.id, d.lead_id, l.name::text, p.received_by, u.full_name::text, p.created_at,
           round(extract(epoch from now() - p.created_at) / 3600, 1), 'دفعة مستنية تأكيد'
    from public.payments p
    join public.deals d on d.id = p.deal_id
    join public.leads l on l.id = d.lead_id
    left join public.users u on u.id = p.received_by
    where not p.confirmed and p.created_at < now() - public.setting_num('payment_confirm_days', 2) * interval '1 day'
  ) x
  order by case x.severity when 'high' then 0 else 1 end, x.age_hours desc
$$;
grant execute on function public.get_attention_items() to authenticated;

-- ---------------------------------------------------------------------
-- 4) Funnel لكل موظف بالزمن
--    تيلي سيلز: leads_received > contacted > interested > meeting_requests > deals
--    سيلز: requests_received > meetings_held > deals  + أزمنة الرد والقفل والتحصيل
-- ---------------------------------------------------------------------
create or replace function public.get_funnel_stats(
  p_from date default date_trunc('month', current_date)::date, p_to date default current_date
) returns table (
  user_id uuid, full_name text, role text,
  leads_received bigint, leads_contacted bigint, leads_interested bigint,
  meeting_requests bigint, requests_received bigint, meetings_held bigint,
  deals_count bigint, revenue_sar numeric,
  avg_hours_to_first_call numeric, avg_hours_to_respond numeric,
  avg_days_meeting_to_deal numeric, avg_days_deal_to_payment numeric
)
language sql stable security definer set search_path = public as $$
  with r as (select p_from::timestamptz as s, (p_to + 1)::timestamptz as e),
  people as (
    select u.id, u.full_name, u.role from public.users u
    where u.role in ('telesales','sales') and u.id in (select public.visible_user_ids())
  ),
  cohort as (
    select l.id as lead_id, l.assigned_to as uid, l.assigned_at
    from public.leads l, r
    where l.assigned_to is not null and l.assigned_at >= r.s and l.assigned_at < r.e
  ),
  firstcall as (
    select c.lead_id, min(a.created_at) as fc
    from cohort c join public.activity_logs a
      on a.lead_id = c.lead_id and a.activity_type = 'call' and a.created_at >= c.assigned_at
    group by c.lead_id
  ),
  hot as (
    select distinct c.lead_id
    from cohort c join public.activity_logs a
      on a.lead_id = c.lead_id and a.activity_type = 'call' and a.created_at >= c.assigned_at
     and a.outcome in ('Interested','Free Trial','Subscribed','Converted')
  ),
  tele as (
    select c.uid, count(*) as received, count(f.fc) as contacted, count(h.lead_id) as interested,
           avg(extract(epoch from f.fc - c.assigned_at) / 3600) as avg_h
    from cohort c
    left join firstcall f on f.lead_id = c.lead_id
    left join hot h on h.lead_id = c.lead_id
    group by c.uid
  ),
  reqs_made as (
    select mr.requested_by as uid, count(*) as n from public.meeting_requests mr, r
    where mr.created_at >= r.s and mr.created_at < r.e and mr.status <> 'cancelled' group by 1
  ),
  reqs_recv as (
    select mr.assigned_sales_id as uid, count(*) as n,
           avg(extract(epoch from mr.updated_at - mr.created_at) / 3600)
             filter (where mr.status in ('accepted','declined')) as avg_h
    from public.meeting_requests mr, r
    where mr.created_at >= r.s and mr.created_at < r.e and mr.status <> 'cancelled' group by 1
  ),
  held as (
    select m.assigned_sales_id as uid, count(*) as n from public.meetings m, r
    where m.proposed_date >= r.s and m.proposed_date < r.e and m.outcome not in ('Scheduled','Rescheduled') group by 1
  ),
  deals_in as (
    select d.id, d.lead_id, d.price_sar, d.created_at, d.approved_at, d.sales_user_id, d.telesales_user_id
    from public.deals d, r
    where d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
  ),
  deal_people as (
    select sales_user_id as uid, id as deal_id from deals_in where sales_user_id is not null
    union all
    select telesales_user_id, id from deals_in where telesales_user_id is not null
  ),
  deal_agg as (
    select dp.uid, count(*) as n, sum(di.price_sar) as rev
    from deal_people dp join deals_in di on di.id = dp.deal_id group by dp.uid
  ),
  m2d as (
    select di.sales_user_id as uid,
           avg(greatest(extract(epoch from di.created_at - mt.proposed_date) / 86400, 0)) as avg_d
    from deals_in di
    join lateral (select m.proposed_date from public.meetings m
                  where m.lead_id = di.lead_id and m.assigned_sales_id = di.sales_user_id
                  order by m.proposed_date desc limit 1) mt on true
    where di.sales_user_id is not null group by di.sales_user_id
  ),
  d2p as (
    select dp.uid, avg(greatest(extract(epoch from fp.first_paid - di.approved_at) / 86400, 0)) as avg_d
    from deal_people dp
    join deals_in di on di.id = dp.deal_id
    join lateral (select min(p.paid_at) as first_paid from public.payments p
                  where p.deal_id = di.id and p.confirmed) fp on fp.first_paid is not null
    group by dp.uid
  )
  select pe.id, pe.full_name, pe.role,
         coalesce(t.received, 0), coalesce(t.contacted, 0), coalesce(t.interested, 0),
         coalesce(rm.n, 0), coalesce(rr.n, 0), coalesce(h.n, 0),
         coalesce(da.n, 0), coalesce(da.rev, 0),
         round(t.avg_h::numeric, 1), round(rr.avg_h::numeric, 1),
         round(m2d.avg_d::numeric, 1), round(d2p.avg_d::numeric, 1)
  from people pe
  left join tele t on t.uid = pe.id
  left join reqs_made rm on rm.uid = pe.id
  left join reqs_recv rr on rr.uid = pe.id
  left join held h on h.uid = pe.id
  left join deal_agg da on da.uid = pe.id
  left join m2d on m2d.uid = pe.id
  left join d2p on d2p.uid = pe.id
  order by pe.role, pe.full_name
$$;
grant execute on function public.get_funnel_stats(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 5) الأهداف الشهرية + Leaderboard
-- ---------------------------------------------------------------------
create table if not exists public.user_targets (
  user_id uuid not null references public.users(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),   -- أول يوم في الشهر
  calls_target int not null default 0 check (calls_target >= 0),
  meetings_target int not null default 0 check (meetings_target >= 0),
  deals_target int not null default 0 check (deals_target >= 0),
  revenue_target_sar numeric(12,2) not null default 0 check (revenue_target_sar >= 0),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.user_targets enable row level security;
drop policy if exists "targets read" on public.user_targets;
create policy "targets read" on public.user_targets for select to authenticated
  using (public.my_role() = 'admin' or user_id = auth.uid()
         or exists (select 1 from public.users u where u.id = user_targets.user_id and u.manager_id = auth.uid()));
drop policy if exists "targets admin write" on public.user_targets;
create policy "targets admin write" on public.user_targets for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- داخلي: أرقام الشهر لكل موظف
create or replace function public._month_stats(p_month date, p_all boolean)
returns table (user_id uuid, full_name text, role text, calls_done bigint, meetings_done bigint, deals_done bigint, revenue_sar numeric)
language sql stable security definer set search_path = public as $$
  with r as (select date_trunc('month', p_month)::timestamptz as s,
                    (date_trunc('month', p_month) + interval '1 month')::timestamptz as e),
  people as (
    select u.id, u.full_name, u.role from public.users u
    where u.role in ('telesales','sales') and u.status = 'active'
      and (p_all or u.id in (select public.visible_user_ids()))
  ),
  calls as (select a.actor_id as uid, count(*) as n from public.activity_logs a, r
            where a.activity_type = 'call' and a.created_at >= r.s and a.created_at < r.e group by 1),
  tele_m as (select mr.requested_by as uid, count(*) as n from public.meeting_requests mr, r
             where mr.created_at >= r.s and mr.created_at < r.e and mr.status <> 'cancelled' group by 1),
  sales_m as (select m.assigned_sales_id as uid, count(*) as n from public.meetings m, r
              where m.proposed_date >= r.s and m.proposed_date < r.e and m.outcome <> 'Rescheduled' group by 1),
  dl as (
    select d.sales_user_id as uid, d.id, d.price_sar from public.deals d, r
     where d.sales_user_id is not null and d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
    union all
    select d.telesales_user_id, d.id, d.price_sar from public.deals d, r
     where d.telesales_user_id is not null and d.status in ('approved','active') and d.approved_at >= r.s and d.approved_at < r.e
  ),
  dl_agg as (select uid, count(*) as n, sum(price_sar) as rev from dl group by uid)
  select p.id, p.full_name, p.role, coalesce(c.n, 0),
         case when p.role = 'telesales' then coalesce(tm.n, 0) else coalesce(sm.n, 0) end,
         coalesce(da.n, 0), coalesce(da.rev, 0)
  from people p
  left join calls c on c.uid = p.id
  left join tele_m tm on tm.uid = p.id
  left join sales_m sm on sm.uid = p.id
  left join dl_agg da on da.uid = p.id
$$;
revoke execute on function public._month_stats(date, boolean) from public, anon, authenticated;

create or replace function public.get_target_progress(p_month date default current_date)
returns table (user_id uuid, full_name text, role text,
               calls_done bigint, meetings_done bigint, deals_done bigint, revenue_sar numeric,
               calls_target int, meetings_target int, deals_target int, revenue_target_sar numeric,
               calls_pct numeric, meetings_pct numeric, deals_pct numeric, revenue_pct numeric)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.full_name, s.role, s.calls_done, s.meetings_done, s.deals_done, s.revenue_sar,
         coalesce(t.calls_target, 0), coalesce(t.meetings_target, 0), coalesce(t.deals_target, 0), coalesce(t.revenue_target_sar, 0),
         round(s.calls_done * 100.0 / nullif(t.calls_target, 0), 1),
         round(s.meetings_done * 100.0 / nullif(t.meetings_target, 0), 1),
         round(s.deals_done * 100.0 / nullif(t.deals_target, 0), 1),
         round(s.revenue_sar * 100.0 / nullif(t.revenue_target_sar, 0), 1)
  from public._month_stats(p_month, false) s
  left join public.user_targets t on t.user_id = s.user_id and t.month = date_trunc('month', p_month)::date
  order by s.role, s.full_name
$$;
grant execute on function public.get_target_progress(date) to authenticated;

-- ترتيب الكل (الإيراد بيظهر للأدمن والمانجر بس)
create or replace function public.get_leaderboard(p_month date default current_date)
returns table (rank_in_role bigint, user_id uuid, full_name text, role text,
               calls_done bigint, meetings_done bigint, deals_done bigint, revenue_sar numeric)
language sql stable security definer set search_path = public as $$
  select rank() over (partition by s.role order by s.deals_done desc, s.revenue_sar desc, s.calls_done desc),
         s.user_id, s.full_name, s.role, s.calls_done, s.meetings_done, s.deals_done,
         case when public.my_role() in ('admin','manager') then s.revenue_sar end
  from public._month_stats(p_month, true) s
  where public.my_role() is not null
  order by s.role, 1
$$;
grant execute on function public.get_leaderboard(date) to authenticated;

-- ---------------------------------------------------------------------
-- 6) أدوات التوزيع
-- ---------------------------------------------------------------------
create or replace function public.distribute_leads_evenly(
  p_lead_ids uuid[], p_user_ids uuid[], p_max_open_per_user int default null
) returns table (user_id uuid, assigned_count int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_role text := public.my_role();
  v_actor public.users;
  v_lead uuid; i int; best int; n int;
  v_loads int[]; v_added int[]; v_left int := 0;
begin
  if v_role not in ('admin','manager') then raise exception 'Only admin or manager can distribute leads'; end if;
  n := coalesce(array_length(p_user_ids, 1), 0);
  if n = 0 then raise exception 'Choose at least one telesales user'; end if;
  if exists (select 1 from unnest(p_user_ids) x
             where not exists (select 1 from public.users u
                               where u.id = x and u.role = 'telesales' and u.status = 'active'
                                 and (v_role = 'admin' or u.manager_id = auth.uid()))) then
    raise exception 'The list contains a user who is not an active telesales you can manage';
  end if;
  select * into v_actor from public.users where id = auth.uid();

  select array_agg((select count(*)::int from public.leads l
                    where l.assigned_to = t.x
                      and l.status not in ('Subscribed','Converted','Did Not Subscribe','Not Interested')) order by t.ord)
    into v_loads from unnest(p_user_ids) with ordinality as t(x, ord);
  v_added := array_fill(0, array[n]);

  foreach v_lead in array coalesce(p_lead_ids, '{}'::uuid[]) loop
    best := null;
    for i in 1..n loop
      if (p_max_open_per_user is null or v_loads[i] < p_max_open_per_user)
         and (best is null or v_loads[i] < v_loads[best]) then best := i; end if;
    end loop;
    if best is null then v_left := v_left + 1; continue; end if;

    update public.leads
       set assigned_to = p_user_ids[best],
           status = case when status = 'New' then 'Assigned' else status end,
           updated_at = now()
     where id = v_lead
       and (v_role = 'admin' or assigned_to is null
            or assigned_to in (select id from public.users where manager_id = auth.uid()));
    if not found then continue; end if;

    v_loads[best] := v_loads[best] + 1;
    v_added[best] := v_added[best] + 1;
    insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
    values (v_lead, auth.uid(), coalesce(v_actor.full_name, '-'), v_actor.role, 'assignment', 'Assigned', 'Even distribution');
  end loop;

  for i in 1..n loop
    if v_added[i] > 0 then
      insert into public.notifications (user_id, type, title, message)
      values (p_user_ids[i], 'assignment', 'عملاء جدد', 'تم توزيع ' || v_added[i] || ' عميل عليك');
    end if;
    user_id := p_user_ids[i]; assigned_count := v_added[i]; return next;
  end loop;
  if v_left > 0 then user_id := null; assigned_count := v_left; return next; end if;   -- اللي ما اتوزعوش
end $$;
grant execute on function public.distribute_leads_evenly(uuid[], uuid[], int) to authenticated;

-- نقل عملاء موظف لموظف تاني (أو إلغاء التوزيع لو p_to_user = null)
create or replace function public.reassign_user_leads(
  p_from_user uuid, p_to_user uuid default null, p_only_open boolean default true
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role(); v_actor public.users; v_ids uuid[]; v_n int;
begin
  if v_role not in ('admin','manager') then raise exception 'Only admin or manager'; end if;
  if v_role = 'manager' and not exists (select 1 from public.users where id = p_from_user and manager_id = auth.uid()) then
    raise exception 'You can only move leads of your own team';
  end if;
  if p_to_user is not null and not exists (
       select 1 from public.users u where u.id = p_to_user and u.role = 'telesales' and u.status = 'active'
         and (v_role = 'admin' or u.manager_id = auth.uid())) then
    raise exception 'Target must be an active telesales user you can manage';
  end if;
  select * into v_actor from public.users where id = auth.uid();

  select array_agg(id) into v_ids from public.leads
   where assigned_to = p_from_user
     and (not p_only_open or status not in ('Subscribed','Converted','Did Not Subscribe','Not Interested'));
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return 0; end if;

  update public.leads
     set assigned_to = p_to_user,
         status = case when p_to_user is null and status = 'Assigned' then 'New'
                       when p_to_user is not null and status = 'New' then 'Assigned' else status end,
         updated_at = now()
   where id = any(v_ids);

  insert into public.activity_logs (lead_id, actor_id, actor_name, actor_role, activity_type, outcome, notes)
  select x, auth.uid(), coalesce(v_actor.full_name, '-'), v_actor.role, 'assignment',
         case when p_to_user is null then 'Unassigned' else 'Reassigned' end, 'Moved from another user'
  from unnest(v_ids) x;

  if p_to_user is not null then
    insert into public.notifications (user_id, type, title, message)
    values (p_to_user, 'assignment', 'عملاء جدد', 'تم تحويل ' || v_n || ' عميل ليك');
  end if;
  return v_n;
end $$;
grant execute on function public.reassign_user_leads(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 7) جودة مصادر الداتا
-- ---------------------------------------------------------------------
create or replace function public.get_source_performance(
  p_from date default (current_date - 90), p_to date default current_date
) returns table (source text, leads_total bigint, contacted bigint, interested bigint,
                 deals bigint, revenue_sar numeric, conversion_pct numeric)
language sql stable security invoker set search_path = public as $$
  select coalesce(nullif(trim(l.source), ''), 'غير محدد'),
         count(distinct l.id),
         count(distinct l.id) filter (where exists (select 1 from public.activity_logs a
                                       where a.lead_id = l.id and a.activity_type = 'call')),
         count(distinct l.id) filter (where exists (select 1 from public.activity_logs a
                                       where a.lead_id = l.id and a.activity_type = 'call'
                                         and a.outcome in ('Interested','Free Trial','Subscribed','Converted'))),
         count(distinct d.id),
         coalesce(sum(d.price_sar), 0),
         round(count(distinct d.id) * 100.0 / nullif(count(distinct l.id), 0), 1)
  from public.leads l
  left join public.deals d on d.lead_id = l.id and d.status in ('approved','active')
  where l.created_at >= p_from and l.created_at < p_to + 1
  group by 1
  order by 6 desc, 2 desc
$$;
grant execute on function public.get_source_performance(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 8) سجل التغييرات (للأدمن بس)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null,
  changed_by uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, created_at desc);
alter table public.audit_log enable row level security;
drop policy if exists "audit admin read" on public.audit_log;
create policy "audit admin read" on public.audit_log for select to authenticated using (public.my_role() = 'admin');
revoke insert, update, delete on public.audit_log from anon, authenticated;

create or replace function public.trg_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (table_name, row_id, action, changed_by, old_data, new_data)
  values (tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'key'), tg_op, auth.uid(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['user_commission_rates','exchange_rates','app_settings','packages','user_targets','deal_commissions','loss_reasons']
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.trg_audit()', t);
  end loop;
end $$;

drop trigger if exists audit_deals on public.deals;
create trigger audit_deals after update on public.deals for each row
  when (old.status is distinct from new.status or old.price_sar is distinct from new.price_sar)
  execute function public.trg_audit();

drop trigger if exists audit_users on public.users;
create trigger audit_users after update on public.users for each row
  when (old.role is distinct from new.role or old.manager_id is distinct from new.manager_id or old.status is distinct from new.status)
  execute function public.trg_audit();

drop trigger if exists audit_payments_ins on public.payments;
create trigger audit_payments_ins after insert on public.payments for each row execute function public.trg_audit();
drop trigger if exists audit_payments_upd on public.payments;
create trigger audit_payments_upd after update on public.payments for each row
  when (old.confirmed is distinct from new.confirmed) execute function public.trg_audit();

-- ---------------------------------------------------------------------
-- 9) تذكيرات: متابعات متأخرة + تجديدات (تتنادى من cron / Edge Function مجدولة)
-- ---------------------------------------------------------------------
create or replace function public.notify_due_followups()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    select l.assigned_to as uid, 'متابعة مطلوبة: ' || l.name as msg
    from public.leads l
    where l.status = 'Call Back Later' and l.assigned_to is not null
      and l.callback_date is not null and l.callback_date::date <= current_date
  ), ins as (
    insert into public.notifications (user_id, type, title, message)
    select d.uid, 'reminder', 'ميعاد متابعة', d.msg from due d
    where not exists (select 1 from public.notifications x
                      where x.user_id = d.uid and x.type = 'reminder' and x.message = d.msg
                        and x.created_at::date = current_date)
    returning 1
  ) select count(*) into n from ins;
  return n;
end $$;

create or replace function public.notify_upcoming_renewals()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    select d.closed_by_user_id as uid, l.name as lname, (d.end_date - current_date) as days_left
    from public.deals d join public.leads l on l.id = d.lead_id
    where d.status in ('approved','active') and (d.end_date - current_date) in (30, 14, 7, 1)
  ), targets as (
    select uid, 'تجديد العميل ' || lname || ' بعد ' || days_left || ' يوم' as msg from due
    union
    select a.id, 'تجديد العميل ' || lname || ' بعد ' || days_left || ' يوم'
    from due, public.users a where a.role = 'admin' and a.status = 'active'
  ), ins as (
    insert into public.notifications (user_id, type, title, message)
    select t.uid, 'reminder', 'تجديد قريب', t.msg from targets t
    where not exists (select 1 from public.notifications x
                      where x.user_id = t.uid and x.type = 'reminder' and x.message = t.msg
                        and x.created_at::date = current_date)
    returning 1
  ) select count(*) into n from ins;
  return n;
end $$;

revoke execute on function public.notify_due_followups() from public, anon, authenticated;
revoke execute on function public.notify_upcoming_renewals() from public, anon, authenticated;
grant execute on function public.notify_due_followups() to service_role;
grant execute on function public.notify_upcoming_renewals() to service_role;
-- جدولة يومية (اختياري): فعّل extension اسمها pg_cron من Dashboard ثم:
-- select cron.schedule('daily-reminders', '0 6 * * *', $$select public.notify_due_followups(); select public.notify_upcoming_renewals();$$);

-- ---------------------------------------------------------------------
-- 10) ملخص اليوم (invoker: الأدمن الكل، المانجر فريقه)
-- ---------------------------------------------------------------------
create or replace function public.get_daily_summary(p_date date default current_date)
returns table (calls bigint, leads_contacted bigint, interested bigint, meeting_requests bigint,
               meetings_held bigint, deals_created bigint, deals_approved bigint,
               confirmed_sar numeric, confirmed_egp numeric, pending_payments bigint, attention_items bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from public.activity_logs a where a.activity_type = 'call' and a.created_at >= p_date and a.created_at < p_date + 1),
    (select count(distinct a.lead_id) from public.activity_logs a where a.activity_type = 'call' and a.created_at >= p_date and a.created_at < p_date + 1),
    (select count(distinct a.lead_id) from public.activity_logs a where a.activity_type = 'call' and a.created_at >= p_date and a.created_at < p_date + 1
        and a.outcome in ('Interested','Free Trial','Subscribed','Converted')),
    (select count(*) from public.meeting_requests r where r.created_at >= p_date and r.created_at < p_date + 1 and r.status <> 'cancelled'),
    (select count(*) from public.meetings m where m.proposed_date >= p_date and m.proposed_date < p_date + 1 and m.outcome not in ('Scheduled','Rescheduled')),
    (select count(*) from public.deals d where d.created_at >= p_date and d.created_at < p_date + 1),
    (select count(*) from public.deals d where d.approved_at >= p_date and d.approved_at < p_date + 1 and d.status in ('approved','active')),
    (select coalesce(sum(p.amount_sar), 0) from public.payments p where p.confirmed and p.confirmed_at >= p_date and p.confirmed_at < p_date + 1),
    (select coalesce(sum(p.amount_egp), 0) from public.payments p where p.confirmed and p.confirmed_at >= p_date and p.confirmed_at < p_date + 1),
    (select count(*) from public.payments p where not p.confirmed),
    (select count(*) from public.get_attention_items())
$$;
grant execute on function public.get_daily_summary(date) to authenticated;

notify pgrst, 'reload schema';

-- تحقق: لازم يرجّع 14 صف
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name in (
  'get_attention_items','get_funnel_stats','get_target_progress','get_leaderboard','mark_meeting_lost',
  'get_loss_report','distribute_leads_evenly','reassign_user_leads','get_source_performance',
  'notify_due_followups','notify_upcoming_renewals','get_daily_summary','setting_num','visible_user_ids');
