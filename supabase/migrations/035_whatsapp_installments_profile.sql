-- 035: (1) واتساب بقوالب حسب مرحلة العميل  (2) تقسيط الدفع  (3) ملف الموظف الشخصي
-- يعتمد على: 034 (can_view_lead) · 032 (run_daily_jobs) · 008 (payments/deals) · 025 (get_target_progress_v2)

-- =====================================================================
-- (1) واتساب
-- =====================================================================
create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('new','assigned','contacted','interested','callback','no_answer','meeting','renewal','payment_due','general')),
  title text not null check (length(btrim(title)) between 1 and 80),
  body text not null check (length(btrim(body)) between 1 and 1500),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_templates enable row level security;
drop policy if exists "wa templates read" on public.whatsapp_templates;
create policy "wa templates read" on public.whatsapp_templates for select to authenticated using (is_active or public.my_role() = 'admin');
drop policy if exists "admin full access" on public.whatsapp_templates;
create policy "admin full access" on public.whatsapp_templates for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
revoke all on public.whatsapp_templates from anon;

insert into public.whatsapp_templates (stage, title, body, sort_order)
select * from (values
  ('new','تعارف أول','السلام عليكم {name}، معك {agent} من إنتلاق. لاحظنا اهتمامكم بموقع {website} ونود نعرض عليكم خدماتنا. هل يناسبكم نتواصل اليوم؟',1),
  ('assigned','تعارف أول','السلام عليكم {name}، معك {agent} من إنتلاق. حابب أعرّفكم على باقاتنا وأشوف وش يناسب نشاطكم.',1),
  ('contacted','متابعة بعد المكالمة','أهلاً {name}، شكراً لوقتكم في المكالمة. أرسل لكم تفاصيل الباقات هنا، وأي استفسار أنا حاضر. — {agent}',1),
  ('interested','عرض سعر','أهلاً {name}، كما اتفقنا أرسل لكم تفاصيل العرض. يسعدني أحجز لكم موعد مع المختص لشرح الباقة. — {agent}',1),
  ('callback','تذكير بموعد','السلام عليكم {name}، تواصلت معكم سابقاً واتفقنا أرجع لكم اليوم. هل الوقت مناسب؟ — {agent}',1),
  ('no_answer','ما رد على الاتصال','السلام عليكم {name}، حاولت أتصل بكم ولم أوفّق. متى يناسبكم الوقت للتواصل؟ — {agent}',1),
  ('meeting','تأكيد اجتماع','أهلاً {name}، أؤكد لكم موعد الاجتماع المتفق عليه. هل ما زال مناسباً؟ — {agent}',1),
  ('renewal','تجديد الاشتراك','أهلاً {name}، اشتراككم يقارب على الانتهاء. نحب نجدده لكم بنفس المزايا. متى يناسبكم؟ — {agent}',1),
  ('payment_due','تذكير بالدفعة','السلام عليكم {name}، تذكير ودّي بموعد الدفعة المستحقة. إذا تم السداد نرجو إرسال الإيصال. شاكرين لكم. — {agent}',1),
  ('general','رسالة عامة','السلام عليكم {name}، معك {agent} من إنتلاق.',1)
) as v(stage,title,body,sort_order)
where not exists (select 1 from public.whatsapp_templates);

create or replace function public.upsert_whatsapp_template(p_id uuid, p_stage text, p_title text, p_body text, p_active boolean default true, p_sort int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if public.my_role() <> 'admin' then raise exception 'Only admin can edit templates'; end if;
  if p_id is null then
    insert into public.whatsapp_templates (stage, title, body, is_active, sort_order) values (p_stage, p_title, p_body, p_active, p_sort) returning id into rid;
  else
    update public.whatsapp_templates set stage = p_stage, title = p_title, body = p_body, is_active = p_active, sort_order = p_sort, updated_at = now()
     where id = p_id returning id into rid;
    if rid is null then raise exception 'Template not found'; end if;
  end if;
  return rid;
end $$;

-- رقم الواتساب بصيغة دولية (أرقام فقط)
create or replace function public.wa_phone(p_phone text, p_region text default null)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'); r text := lower(coalesce(p_region,''));
begin
  if d = '' then return null; end if;
  if left(d,1) = '+' then return regexp_replace(d, '\D', '', 'g'); end if;
  d := regexp_replace(d, '\D', '', 'g');
  if left(d,2) = '00' then return substr(d,3); end if;
  if r ~ '(egypt|مصر)' or d ~ '^01[0125]\d{8}$' then
    if d ~ '^0\d{10}$' then return '20' || substr(d,2); end if;
  end if;
  if r ~ '(oman|عمان)' and d ~ '^\d{8}$' then return '968' || d; end if;
  if r ~ '(uae|emirates|الإمارات)' and d ~ '^0?5\d{8}$' then return '971' || regexp_replace(d,'^0',''); end if;
  if r ~ '(iraq|العراق)' and d ~ '^0?7\d{9}$' then return '964' || regexp_replace(d,'^0',''); end if;
  -- السعودية (الافتراضي): 05xxxxxxxx أو 5xxxxxxxx
  if d ~ '^05\d{8}$' then return '966' || substr(d,2); end if;
  if d ~ '^5\d{8}$' then return '966' || d; end if;
  if d ~ '^9665\d{8}$' or length(d) >= 11 then return d; end if;
  return d;
end $$;

create or replace function public.url_encode(p text)
returns text language sql immutable as $$
  select coalesce(string_agg(
    case when b between 48 and 57 or b between 65 and 90 or b between 97 and 122 or b in (45,46,95,126)
         then chr(b) else '%' || upper(lpad(to_hex(b), 2, '0')) end, '' order by ord), '')
  from (select get_byte(x, i) as b, i as ord from (select convert_to(coalesce(p,''), 'UTF8') as x) s, generate_series(0, length(convert_to(coalesce(p,''), 'UTF8')) - 1) i) t
$$;

-- يرجّع رابط واتساب جاهز (مع القالب مُعبّأ) — للمستخدم المسموح له يشوف العميل فقط
create or replace function public.get_whatsapp_link(p_lead_id uuid, p_template_id uuid default null, p_custom_text text default null)
returns table (url text, message text, phone text)
language plpgsql security definer set search_path = public as $$
declare l public.leads; me text; t text; w text; v_stage text;
begin
  if not public.can_view_lead(p_lead_id) then raise exception 'You are not allowed to message this client'; end if;
  select * into l from public.leads where id = p_lead_id;
  select u.full_name into me from public.users u where u.id = auth.uid();
  w := public.wa_phone(l.phone, l.region);
  if w is null then raise exception 'This client has no phone number'; end if;
  if p_custom_text is not null then t := p_custom_text;
  elsif p_template_id is not null then select body into t from public.whatsapp_templates where id = p_template_id and is_active;
  else
    v_stage := case l.status when 'New' then 'new' when 'Assigned' then 'assigned' when 'Contacted' then 'contacted'
                 when 'Interested' then 'interested' when 'Call Back Later' then 'callback' when 'No Answer' then 'no_answer' else 'general' end;
    select body into t from public.whatsapp_templates where is_active and whatsapp_templates.stage = v_stage order by sort_order, created_at limit 1;
  end if;
  t := coalesce(t, '');
  t := replace(replace(replace(replace(replace(t, '{name}', coalesce(l.name,'')), '{company}', coalesce(l.company, l.name, '')),
        '{agent}', coalesce(me,'')), '{website}', coalesce(l.website,'')), '{client_code}', coalesce(l.client_code,''));
  insert into public.audit_log (table_name, action, changed_by, new_data)
  values ('app_event', 'WHATSAPP_OPEN', auth.uid(), jsonb_build_object('lead_id', p_lead_id));
  return query select 'https://wa.me/' || w || case when t = '' then '' else '?text=' || public.url_encode(t) end, t, w;
end $$;

-- =====================================================================
-- (2) التقسيط
-- =====================================================================
create table if not exists public.deal_installments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  seq int not null check (seq >= 1),
  due_date date not null,
  amount_sar numeric(14,2) not null check (amount_sar > 0),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (deal_id, seq)
);
create index if not exists deal_installments_due_idx on public.deal_installments (due_date);
alter table public.deal_installments enable row level security;
drop policy if exists "admin full access" on public.deal_installments;
create policy "admin full access" on public.deal_installments for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
revoke all on public.deal_installments from anon;

create or replace function public.can_view_deal(p_deal_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); r text := public.my_role(); d public.deals; team uuid[];
begin
  if me is null or r is null then return false; end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then return false; end if;
  if r = 'admin' then return true; end if;
  if r = 'manager' then
    select array_agg(u.id) into team from public.users u where u.manager_id = me;
    return coalesce(d.sales_user_id = any(coalesce(team,'{}')) or d.telesales_user_id = any(coalesce(team,'{}')) or d.closed_by_user_id = any(coalesce(team,'{}')), false)
           or me in (d.sales_user_id, d.telesales_user_id, d.closed_by_user_id);
  end if;
  return me in (d.sales_user_id, d.telesales_user_id, d.closed_by_user_id);
end $$;

-- معاينة التقسيط المتساوي (للواجهة قبل الحفظ)
create or replace function public.preview_installments(p_total numeric, p_count int, p_first_due date, p_interval_days int default 30)
returns table (seq int, due_date date, amount_sar numeric)
language plpgsql immutable as $$
declare base numeric; i int; acc numeric := 0;
begin
  if p_count < 1 or p_count > 36 then raise exception 'Installments count must be between 1 and 36'; end if;
  if p_total <= 0 then raise exception 'Total must be positive'; end if;
  base := round(p_total / p_count, 2);
  for i in 1..p_count loop
    seq := i; due_date := p_first_due + ((i - 1) * p_interval_days);
    amount_sar := case when i = p_count then round(p_total - acc, 2) else base end;
    acc := acc + base;
    return next;
  end loop;
end $$;

-- إنشاء خطة: p_schedule = [{"due_date":"2026-11-01","amount_sar":500}, ...] ومجموعها = سعر الصفقة
create or replace function public.create_installment_plan(p_deal_id uuid, p_schedule jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare d public.deals; r record; total numeric := 0; n int := 0;
begin
  if not public.can_view_deal(p_deal_id) then raise exception 'You are not allowed to manage this deal'; end if;
  if public.my_role() not in ('admin','manager') then raise exception 'Only admin or manager can create installment plans'; end if;
  select * into d from public.deals where id = p_deal_id;
  if d.status = 'cancelled' then raise exception 'Deal is cancelled'; end if;
  if exists (select 1 from public.deal_installments where deal_id = p_deal_id) then raise exception 'This deal already has an installment plan (cancel it first)'; end if;
  if jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) not between 1 and 36 then raise exception 'Schedule must have 1 to 36 installments'; end if;
  for r in select (e->>'due_date')::date as due_date, (e->>'amount_sar')::numeric as amount_sar, e->>'note' as note
           from jsonb_array_elements(p_schedule) e order by (e->>'due_date')::date loop
    if r.amount_sar is null or r.amount_sar <= 0 then raise exception 'Each installment needs a positive amount'; end if;
    n := n + 1; total := total + r.amount_sar;
    insert into public.deal_installments (deal_id, seq, due_date, amount_sar, note, created_by)
    values (p_deal_id, n, r.due_date, r.amount_sar, r.note, auth.uid());
  end loop;
  if abs(total - d.price_sar) > 0.01 then
    raise exception 'Installments total (%) must equal the deal price (%)', total, d.price_sar;
  end if;
  insert into public.audit_log (table_name, row_id, action, changed_by, new_data)
  values ('deal_installments', p_deal_id::text, 'INSERT', auth.uid(), jsonb_build_object('count', n, 'total', total));
  return n;
end $$;

create or replace function public.cancel_installment_plan(p_deal_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.my_role() not in ('admin','manager') or not public.can_view_deal(p_deal_id) then raise exception 'Not allowed'; end if;
  delete from public.deal_installments where deal_id = p_deal_id;
  get diagnostics n = row_count;
  insert into public.audit_log (table_name, row_id, action, changed_by, old_data)
  values ('deal_installments', p_deal_id::text, 'DELETE', auth.uid(), jsonb_build_object('count', n));
  return n;
end $$;

-- الحالة تتحسب من المدفوع المؤكد (تتصحح لوحدها لو دفعة اتلغت)
create or replace function public.get_deal_installments(p_deal_id uuid)
returns table (id uuid, seq int, due_date date, amount_sar numeric, paid_sar numeric, remaining_sar numeric, status text, days_to_due int, note text)
language plpgsql stable security definer set search_path = public as $$
declare paid numeric;
begin
  if not public.can_view_deal(p_deal_id) then raise exception 'You are not allowed to view this deal'; end if;
  select coalesce(sum(p.amount_sar), 0) into paid from public.payments p where p.deal_id = p_deal_id and p.confirmed;
  return query
  with cum as (
    select i.*, coalesce(sum(i.amount_sar) over (order by i.seq rows between unbounded preceding and 1 preceding), 0) as before_amt
    from public.deal_installments i where i.deal_id = p_deal_id
  )
  select c.id, c.seq, c.due_date, c.amount_sar,
         greatest(0, least(c.amount_sar, paid - c.before_amt))::numeric as paid_sar,
         (c.amount_sar - greatest(0, least(c.amount_sar, paid - c.before_amt)))::numeric as remaining_sar,
         case when paid - c.before_amt >= c.amount_sar then 'paid'
              when c.due_date < current_date then 'overdue'
              when paid - c.before_amt > 0 then 'partial'
              else 'pending' end as status,
         (c.due_date - current_date)::int, c.note
  from cum c order by c.seq;
end $$;

-- لوحة الأدمن/المدير: كل المتأخر والقريب
create or replace function public.get_installments_overview(p_days_ahead int default 14)
returns table (deal_id uuid, client_name text, client_code text, seq int, due_date date, remaining_sar numeric, status text, days_to_due int, owner_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Only admin or manager'; end if;
  return query
  with ds as (select distinct i.deal_id from public.deal_installments i)
  select ds.deal_id, l.name, l.client_code, x.seq, x.due_date, x.remaining_sar, x.status, x.days_to_due, u.full_name
  from ds
  join public.deals d on d.id = ds.deal_id
  join public.leads l on l.id = d.lead_id
  left join public.users u on u.id = coalesce(d.sales_user_id, d.closed_by_user_id)
  cross join lateral (select * from public.get_deal_installments(ds.deal_id)) x
  where d.status <> 'cancelled' and x.status in ('overdue','partial','pending') and x.remaining_sar > 0
    and x.days_to_due <= p_days_ahead
    and (public.my_role() = 'admin' or public.can_view_deal(ds.deal_id))
  order by x.due_date, l.name;
end $$;

-- تذكيرات (تُنادى من run_daily_jobs): قبلها بـ 3 أيام، يوم الاستحقاق، وأسبوعياً بعد التأخر
create or replace function public.notify_due_installments()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; msg text;
begin
  for r in
    select ds.deal_id, x.seq, x.due_date, x.remaining_sar, x.status, x.days_to_due, l.name,
           coalesce(d.sales_user_id, d.closed_by_user_id, d.telesales_user_id) as owner
    from (select distinct deal_id from public.deal_installments) ds
    join public.deals d on d.id = ds.deal_id and d.status <> 'cancelled'
    join public.leads l on l.id = d.lead_id
    cross join lateral public.get_deal_installments_internal(ds.deal_id) x
    where x.remaining_sar > 0 and (x.days_to_due = 3 or x.days_to_due = 0 or (x.days_to_due < 0 and (-x.days_to_due) % 7 = 0))
  loop
    msg := case when r.days_to_due > 0 then 'دفعة ' || r.name || ' (' || r.remaining_sar || ' ر.س) تستحق بعد ' || r.days_to_due || ' أيام'
                when r.days_to_due = 0 then 'دفعة ' || r.name || ' (' || r.remaining_sar || ' ر.س) تستحق اليوم'
                else 'دفعة ' || r.name || ' متأخرة ' || (-r.days_to_due) || ' يوم (' || r.remaining_sar || ' ر.س)' end;
    insert into public.notifications (user_id, type, title, message)
    select t.uid, 'reminder', 'دفعة مستحقة', msg
    from (select r.owner as uid union select a.id from public.users a where a.role = 'admin' and a.status = 'active') t
    where t.uid is not null and not exists (select 1 from public.notifications x2
      where x2.user_id = t.uid and x2.type = 'reminder' and x2.message = msg and x2.created_at::date = current_date);
    n := n + 1;
  end loop;
  return n;
end $$;

-- نسخة داخلية بدون فحص صلاحية (تُستخدم من المهام المجدولة فقط)
create or replace function public.get_deal_installments_internal(p_deal_id uuid)
returns table (seq int, due_date date, amount_sar numeric, remaining_sar numeric, status text, days_to_due int)
language sql stable security definer set search_path = public as $$
  with paid as (select coalesce(sum(p.amount_sar), 0) as v from public.payments p where p.deal_id = p_deal_id and p.confirmed),
  cum as (select i.*, coalesce(sum(i.amount_sar) over (order by i.seq rows between unbounded preceding and 1 preceding), 0) as b
          from public.deal_installments i where i.deal_id = p_deal_id)
  select c.seq, c.due_date, c.amount_sar,
         (c.amount_sar - greatest(0, least(c.amount_sar, paid.v - c.b)))::numeric,
         case when paid.v - c.b >= c.amount_sar then 'paid' when c.due_date < current_date then 'overdue' when paid.v - c.b > 0 then 'partial' else 'pending' end,
         (c.due_date - current_date)::int
  from cum c, paid order by c.seq
$$;

-- ضم تذكير الأقساط للمهمة اليومية
create or replace function public.run_daily_jobs()
returns table (job text, affected int)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.my_role() <> 'admin' then raise exception 'Only admin'; end if;
  job := 'auto_distribution';    affected := public.run_auto_distribution();    return next;
  job := 'followup_reminders';   affected := public.notify_due_followups();     return next;
  job := 'renewal_reminders';    affected := public.notify_upcoming_renewals(); return next;
  job := 'installment_reminders'; affected := public.notify_due_installments(); return next;
end $$;

-- =====================================================================
-- (3) ملف الموظف الشخصي (كل مستخدم يشوف نفسه؛ الأدمن/المدير يقدر يشوف موظف بـ p_user_id)
-- =====================================================================
create or replace function public.get_my_profile(p_month date default current_date, p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid(); r text := public.my_role(); uid uuid; u public.users; mgr text;
  pay jsonb; stats jsonb; tgt jsonb; rates jsonb; deals jsonb; open_n bigint; overdue_n bigint;
  m0 timestamptz := date_trunc('month', p_month)::timestamptz; m1 timestamptz := (date_trunc('month', p_month) + interval '1 month')::timestamptz;
begin
  if me is null then raise exception 'Not signed in'; end if;
  uid := coalesce(p_user_id, me);
  if uid <> me then
    if r = 'admin' then null;
    elsif r = 'manager' and exists (select 1 from public.users x where x.id = uid and x.manager_id = me) then null;
    else raise exception 'You are not allowed to view this profile'; end if;
  end if;
  select * into u from public.users where id = uid;
  if not found then raise exception 'User not found'; end if;
  select full_name into mgr from public.users where id = u.manager_id;

  select to_jsonb(x) into rates from (select base_salary, base_currency, closer_percent, lead_percent, manager_percent
                                       from public.user_commission_rates where user_id = uid) x;
  select to_jsonb(s) into stats from (select calls_done, meetings_done, deals_done, revenue_sar from public._month_stats(p_month, true) where user_id = uid) s;
  select to_jsonb(p) into pay from (select deals_count, commission_sar, commission_egp, base_salary, base_currency, total_sar, total_egp
                                     from public.get_payroll(p_month) where user_id = uid) p;
  begin
    select to_jsonb(t) into tgt from (select calls_target, meetings_target, deals_target, revenue_target_sar, collected_sar
                                       from public.get_target_progress_v2(p_month) where user_id = uid) t;
  exception when undefined_function then tgt := null; end;

  select coalesce(jsonb_agg(d), '[]'::jsonb) into deals from (
    select dd.id, l.name as client, dd.status, dd.price_sar, dd.created_at
    from public.deals dd join public.leads l on l.id = dd.lead_id
    where uid in (dd.sales_user_id, dd.closed_by_user_id, dd.telesales_user_id) and dd.created_at >= m0 and dd.created_at < m1
    order by dd.created_at desc limit 10) d;

  select count(*) into open_n from public.leads where assigned_to = uid and status not in ('Subscribed','Converted','Did Not Subscribe','Not Interested');
  select count(*) into overdue_n from public.leads where assigned_to = uid and status = 'Call Back Later' and callback_date <= current_date;

  return jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role, 'email', u.email, 'manager_name', mgr, 'status', u.status),
    'month', to_char(date_trunc('month', p_month), 'YYYY-MM'),
    'rates', coalesce(rates, '{}'::jsonb), 'stats', coalesce(stats, '{}'::jsonb), 'pay', coalesce(pay, '{}'::jsonb),
    'target', tgt, 'deals', deals, 'open_leads', open_n, 'overdue_followups', overdue_n);
end $$;

-- =====================================================================
-- صلاحيات
-- =====================================================================
revoke all on function public.upsert_whatsapp_template(uuid,text,text,text,boolean,int), public.wa_phone(text,text), public.url_encode(text),
  public.get_whatsapp_link(uuid,uuid,text), public.can_view_deal(uuid), public.preview_installments(numeric,int,date,int),
  public.create_installment_plan(uuid,jsonb), public.cancel_installment_plan(uuid), public.get_deal_installments(uuid),
  public.get_installments_overview(int), public.notify_due_installments(), public.get_deal_installments_internal(uuid),
  public.get_my_profile(date,uuid) from public, anon;
grant execute on function public.upsert_whatsapp_template(uuid,text,text,text,boolean,int), public.wa_phone(text,text), public.url_encode(text),
  public.get_whatsapp_link(uuid,uuid,text), public.can_view_deal(uuid), public.preview_installments(numeric,int,date,int),
  public.create_installment_plan(uuid,jsonb), public.cancel_installment_plan(uuid), public.get_deal_installments(uuid),
  public.get_installments_overview(int), public.get_my_profile(date,uuid) to authenticated;
-- notify_due_installments و get_deal_installments_internal: للمهام المجدولة فقط (مش مفتوحين للمستخدمين)
revoke execute on function public.notify_due_installments(), public.get_deal_installments_internal(uuid) from authenticated;
