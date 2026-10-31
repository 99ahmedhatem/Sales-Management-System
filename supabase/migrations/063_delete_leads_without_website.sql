-- 063: حذف كل العملاء اللي مفيش قدامهم موقع
-- "مفيش موقع" = الخانة فاضية، أو فيها شرطة (- أو —)، أو فيها صفحة سلة الرئيسية بس
-- (https://salla.sa/ أو salla.sa أو www.salla.sa أو salla.com).
-- ⚠️ الحذف نهائي. خد نسخة احتياطية الأول (Database ← Backups).
-- العملاء اللي عليهم Deal مش هيتمسحوا، عشان العقود والإيراد والعمولات ما تبوظش.
-- شغّل كل خطوة لوحدها في SQL Editor بالترتيب.
-- ملاحظة: ده تنظيف بيانات لمرة واحدة، مش بيتحط في RUN_PENDING.sql.

-- 1) معاينة: العدد قبل أي حذف
select
  (select count(*) from public.leads)                                                        as all_leads,
  count(*)                                                                                    as no_website,
  count(*) filter (where exists (select 1 from public.deals d where d.lead_id = l.id))       as with_deal_kept,
  count(*) filter (where not exists (select 1 from public.deals d where d.lead_id = l.id))  as will_be_deleted
from public.leads l
where l.website is null
   or trim(l.website) in ('', '-', '—', '–')
   or lower(trim(l.website)) ~ '^(https?://)?(www\.)?salla\.(sa|com)/?$';

-- (اختياري) عينة من 50 عميل هيتمسحوا
select client_code, name, phone, website, status, created_at
from public.leads l
where (l.website is null
   or trim(l.website) in ('', '-', '—', '–')
   or lower(trim(l.website)) ~ '^(https?://)?(www\.)?salla\.(sa|com)/?$')
  and not exists (select 1 from public.deals d where d.lead_id = l.id)
limit 50;

-- 2) الحذف (الاجتماعات والكومنتات والطلبات المرتبطة بيهم بتتمسح معاهم تلقائياً)
delete from public.leads l
where (l.website is null
   or trim(l.website) in ('', '-', '—', '–')
   or lower(trim(l.website)) ~ '^(https?://)?(www\.)?salla\.(sa|com)/?$')
  and not exists (select 1 from public.deals d where d.lead_id = l.id);

-- 3) تأكيد: المفروض يساوي with_deal_kept من الخطوة 1 (غالباً 0)
select count(*) as remaining_without_website
from public.leads l
where l.website is null
   or trim(l.website) in ('', '-', '—', '–')
   or lower(trim(l.website)) ~ '^(https?://)?(www\.)?salla\.(sa|com)/?$';
