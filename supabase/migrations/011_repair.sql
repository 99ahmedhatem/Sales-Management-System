-- =====================================================================
-- 011 — إصلاح الفروقات بين الكود والداتابيز (شغّله مرة واحدة، آمن لو اتشغّل تاني)
--
-- بيصلّح الأخطاء اللي بتظهر في الموقع:
--   column meetings.booked_by does not exist
--   column deals.commission_percent / commission_sar does not exist
--   column users.commission_percent does not exist
--   column leads.notes does not exist
--   rpc list_email_confirmations / set_user_email_confirmed / fill_missing_phones غير موجودة
--
-- القاعدة: كل حاجة هنا "أضفها لو ناقصة". مفيش drop لجدول ولا مسح بيانات،
-- وأي function موجودة عندك بالفعل مش بيتغيّر عليها حاجة.
-- لازم تكون شغّلت قبله ملفات 004..010 (أو supabase-FIX-ALL.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) جدول meetings: كل الأعمدة اللي الـ migrations والكود محتاجينها
-- ---------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  booked_by uuid references public.users(id),
  assigned_sales_id uuid references public.users(id),
  proposed_date timestamptz,
  telesales_notes text,
  outcome text not null default 'Scheduled',
  created_at timestamptz not null default now()
);

alter table public.meetings
  add column if not exists lead_id uuid references public.leads(id) on delete cascade,
  add column if not exists booked_by uuid references public.users(id),
  add column if not exists assigned_sales_id uuid references public.users(id),
  add column if not exists proposed_date timestamptz,
  add column if not exists telesales_notes text,
  add column if not exists outcome text not null default 'Scheduled',
  add column if not exists created_at timestamptz not null default now();

-- قيود القيم المسموحة لـ outcome: نشيل أي قيد قديم على العمود ده ونحط القيد الصح
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.meetings'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%outcome%'
  loop
    execute format('alter table public.meetings drop constraint %I', c.conname);
  end loop;
  -- أي قيمة غريبة موجودة بالفعل نرجّعها Scheduled عشان القيد الجديد ما يفشلش
  update public.meetings set outcome = 'Scheduled'
   where outcome not in ('Scheduled','Deal Closed – Won','Deal Lost','Rescheduled','No-Show');
  alter table public.meetings add constraint meetings_outcome_check
    check (outcome in ('Scheduled','Deal Closed – Won','Deal Lost','Rescheduled','No-Show'));

  -- NOT NULL بس لو مفيش بيانات تتعارض (الجدول فاضي أو الأعمدة كلها معبّأة)
  if not exists (select 1 from public.meetings where booked_by is null) then
    alter table public.meetings alter column booked_by set not null;
  end if;
  if not exists (select 1 from public.meetings where assigned_sales_id is null) then
    alter table public.meetings alter column assigned_sales_id set not null;
  end if;
  if not exists (select 1 from public.meetings where lead_id is null) then
    alter table public.meetings alter column lead_id set not null;
  end if;
  if not exists (select 1 from public.meetings where proposed_date is null) then
    alter table public.meetings alter column proposed_date set not null;
  end if;
end $$;

alter table public.meetings enable row level security;
create index if not exists meetings_sales_idx on public.meetings (assigned_sales_id, proposed_date);
create index if not exists meetings_lead_idx on public.meetings (lead_id);

-- ---------------------------------------------------------------------
-- 2) أعمدة العملاء اللي شاشة التيلي سيلز بتكتبها
-- ---------------------------------------------------------------------
alter table public.leads
  add column if not exists notes text,
  add column if not exists callback_date date,
  add column if not exists free_trial_end_date date;

-- ---------------------------------------------------------------------
-- 3) نسبة العمولة على المستخدم (الواجهة بتعدّلها من صفحة Users)
--    هي نسبة "القفل" بتاعة الموظف، وبتتزامن مع user_commission_rates.closer_percent
--    اللي بيتحسب منها المرتب (008)
-- ---------------------------------------------------------------------
alter table public.users
  add column if not exists commission_percent numeric(5,2) not null default 0;
alter table public.users drop constraint if exists users_commission_percent_check;
alter table public.users add constraint users_commission_percent_check
  check (commission_percent between 0 and 100);

do $$
begin
  if to_regclass('public.user_commission_rates') is not null then
    -- أول مرة: انسخ النسب الموجودة
    insert into public.user_commission_rates (user_id, closer_percent)
    select u.id, u.commission_percent from public.users u
    where u.commission_percent > 0
    on conflict (user_id) do nothing;

    create or replace function public.trg_users_sync_commission()
    returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      insert into public.user_commission_rates (user_id, closer_percent, updated_by)
      values (new.id, new.commission_percent, auth.uid())
      on conflict (user_id) do update
        set closer_percent = excluded.closer_percent, updated_by = auth.uid(), updated_at = now();
      return null;
    end $f$;

    drop trigger if exists users_sync_commission on public.users;
    create trigger users_sync_commission
      after insert or update of commission_percent on public.users
      for each row execute function public.trg_users_sync_commission();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) عمولة الديل (بتتعرض في قايمة الصفقات): بتتحدّث أوتوماتيك من deal_commissions
--    = نسبة ومبلغ اللي قفل الديل
-- ---------------------------------------------------------------------
alter table public.deals
  add column if not exists commission_percent numeric(5,2),
  add column if not exists commission_sar numeric(12,2);

do $$
begin
  if to_regclass('public.deal_commissions') is not null then
    create or replace function public.refresh_deal_commission_cache(p_deal_id uuid)
    returns void language plpgsql security definer set search_path = public as $f$
    begin
      update public.deals d
         set commission_percent = c.percent,
             commission_sar = round(d.price_sar * c.percent / 100, 2)
        from (select percent from public.deal_commissions
               where deal_id = p_deal_id and role_in_deal in ('closer_sales','closer_telesales')
               order by created_at limit 1) c
       where d.id = p_deal_id;
    end $f$;
    revoke execute on function public.refresh_deal_commission_cache(uuid) from public, anon, authenticated;

    create or replace function public.trg_deal_commissions_cache()
    returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      perform public.refresh_deal_commission_cache(coalesce(new.deal_id, old.deal_id));
      return null;
    end $f$;

    drop trigger if exists deal_commissions_cache on public.deal_commissions;
    create trigger deal_commissions_cache
      after insert or update or delete on public.deal_commissions
      for each row execute function public.trg_deal_commissions_cache();

    -- الصفقات المعتمدة قبل كده
    perform public.refresh_deal_commission_cache(d.id) from public.deals d;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) الفانكشنز اللي الواجهة بتناديها (بتتعمل بس لو مش موجودة عندك)
-- ---------------------------------------------------------------------
do $$
begin
  -- حالة تأكيد الإيميل لكل المستخدمين (أدمن بس)
  if to_regprocedure('public.list_email_confirmations()') is null then
    execute $f$
      create function public.list_email_confirmations()
      returns table (id uuid, confirmed boolean)
      language plpgsql stable security definer set search_path = public as $b$
      begin
        if public.my_role() is distinct from 'admin' then
          raise exception 'Only admin can read email confirmations';
        end if;
        return query select u.id, (au.email_confirmed_at is not null)
                     from public.users u left join auth.users au on au.id = u.id;
      end $b$
    $f$;
    revoke execute on function public.list_email_confirmations() from public, anon;
    grant execute on function public.list_email_confirmations() to authenticated;
  end if;

  -- تأكيد/إلغاء تأكيد إيميل مستخدم (أدمن بس)
  if to_regprocedure('public.set_user_email_confirmed(uuid,boolean)') is null then
    execute $f$
      create function public.set_user_email_confirmed(target_user_id uuid, should_confirm boolean)
      returns void
      language plpgsql security definer set search_path = public as $b$
      begin
        if public.my_role() is distinct from 'admin' then
          raise exception 'Only admin can change email confirmation';
        end if;
        update auth.users
           set email_confirmed_at = case when should_confirm then coalesce(email_confirmed_at, now()) else null end
         where id = target_user_id;
        if not found then raise exception 'User not found'; end if;
      end $b$
    $f$;
    revoke execute on function public.set_user_email_confirmed(uuid, boolean) from public, anon;
    grant execute on function public.set_user_email_confirmed(uuid, boolean) to authenticated;
  end if;

  -- استيراد Excel: تعبئة تليفونات متاجر موجودة بالفعل (المفتاح website_key)
  -- rows = [{"website_key":"example.com","phone":"0501234567"}, ...]
  if to_regprocedure('public.fill_missing_phones(jsonb)') is null then
    execute $f$
      create function public.fill_missing_phones(rows jsonb)
      returns integer
      language plpgsql security definer set search_path = public as $b$
      declare n integer;
      begin
        if public.my_role() not in ('admin','manager') then
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
  end if;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- تحقق: لازم يرجّع 0 صفوف (أي صف = حاجة لسه ناقصة)
-- ---------------------------------------------------------------------
select 'missing column' as problem, x.t || '.' || x.c as name
from (values ('meetings','booked_by'),('meetings','assigned_sales_id'),('meetings','lead_id'),
             ('deals','commission_percent'),('deals','commission_sar'),
             ('users','commission_percent'),('leads','notes')) x(t, c)
where not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = x.t and column_name = x.c)
union all
select 'missing function', f from unnest(array['list_email_confirmations','set_user_email_confirmed','fill_missing_phones',
  'create_deal','request_meeting','accept_meeting_request','approve_deal','record_payment','get_payroll']) f
where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f);
