-- =====================================================================
-- 010 — سرعة صفحة Leads + قفل النسخ الاحتياطية
-- شغّله مرة واحدة (آمن لو اتشغّل تاني). مش بيمسح ولا يغيّر أي بيانات.
-- لو طلع timeout في الفهارس: شغّل كل create index لوحده.
-- =====================================================================

-- 1) فهارس تسرّع صفحة Leads (ترتيب created_at + فلاتر) وأدوات المتابعة
create index if not exists leads_created_at_id_idx on public.leads (created_at desc, id desc);
create index if not exists leads_assigned_to_idx   on public.leads (assigned_to);
create index if not exists leads_status_idx        on public.leads (status);
create index if not exists meetings_lead_idx       on public.meetings (lead_id);
create index if not exists meeting_requests_lead_idx on public.meeting_requests (lead_id);
create index if not exists activity_logs_type_created_idx on public.activity_logs (activity_type, created_at desc);
create index if not exists activity_logs_actor_created_idx on public.activity_logs (actor_id, created_at desc);
analyze public.leads;

-- 2) قفل أي جدول اسمه فيه "backup" في public:
--    بيفعّل RLS ويشيل صلاحيات الـ API (anon / authenticated).
--    البيانات كما هي، وتقدر تقراها من SQL Editor. لسه service_role يقدر يقرا للتصدير.
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like '%backup%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 3) تقرير: الجداول اللي RLS مقفول عليها (راجعها بنفسك، ما بنغيّرهاش أوتوماتيك)
--    أي جدول هنا بيحتوي بيانات حقيقية ومش مقصود يكون مفتوح للـ API لازم تفعّل عليه RLS.
select c.relname as table_without_rls
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
order by 1;
