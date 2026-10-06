-- 026: إصلاح خطأ "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- السبب: الموقع بيضيف/يستورد العملاء بـ upsert على website_key، والداتا بيز عندك مفيهاش unique index عليه (أو index ناقص).
-- الحل: دمج أي عملاء مكررين بنفس الموقع (بينقل التاريخ للسجل الأفضل)، وبعدين إنشاء الـ unique index.
-- مستقل: مش محتاج أي ملف تاني قبله. آمن للتشغيل أكتر من مرة.

create or replace function public.merge_duplicate_websites(p_groups integer default 500)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g record; keeper uuid; dups uuid[]; merged integer := 0; r public.leads;
begin
  if auth.uid() is not null and public.my_role() <> 'admin' then raise exception 'Only admin can merge leads'; end if;
  for g in
    select website_key from public.leads where website_key is not null and website_key <> ''
    group by website_key having count(*) > 1 limit greatest(p_groups, 1)
  loop
    select l.id into keeper from public.leads l where l.website_key = g.website_key
    order by (exists (select 1 from public.deals d where d.lead_id = l.id)) desc,
             (exists (select 1 from public.meetings m where m.lead_id = l.id)) desc,
             (l.assigned_to is not null) desc,
             (coalesce(l.status, 'New') <> 'New') desc,
             (l.phone is not null) desc,
             l.created_at asc nulls last, l.id
    limit 1;
    select array_agg(id) into dups from public.leads where website_key = g.website_key and id <> keeper;

    update public.activity_logs    set lead_id = keeper where lead_id = any(dups);
    update public.client_comments  set lead_id = keeper where lead_id = any(dups);
    update public.meetings         set lead_id = keeper where lead_id = any(dups);
    update public.meeting_requests set lead_id = keeper where lead_id = any(dups);
    update public.deals            set lead_id = keeper where lead_id = any(dups);

    for r in select * from public.leads where id = any(dups) order by created_at nulls last loop
      delete from public.leads where id = r.id;
      -- الموبايل ننقله بس لو السجل المحتفظ به ملوش موبايل ومفيش عميل تاني بنفس الرقم
      update public.leads k set
        name = coalesce(nullif(k.name, ''), r.name),
        company = coalesce(nullif(k.company, ''), r.company),
        region = coalesce(nullif(k.region, ''), r.region),
        notes = coalesce(nullif(k.notes, ''), r.notes),
        website = coalesce(k.website, r.website),
        quantity = greatest(k.quantity, r.quantity),
        phone = case when k.phone is null and r.phone is not null
                      and not exists (select 1 from public.leads z where z.id <> k.id and z.phone is not null
                                      and right(regexp_replace(z.phone, '\D', '', 'g'), 9) = right(regexp_replace(r.phone, '\D', '', 'g'), 9))
                     then r.phone else k.phone end
      where k.id = keeper;
    end loop;
    merged := merged + coalesce(array_length(dups, 1), 0);
  end loop;
  return merged;
end $$;
revoke execute on function public.merge_duplicate_websites(integer) from public, anon;
grant execute on function public.merge_duplicate_websites(integer) to authenticated;

-- نفّذ كل حاجة مرة واحدة: دمج المكرر ثم إنشاء الـ index
do $$
declare n integer; total integer := 0; guard integer := 0;
begin
  loop
    n := public.merge_duplicate_websites(500);
    total := total + n; guard := guard + 1;
    exit when n = 0 or guard > 200;
  end loop;
  raise notice 'Merged % duplicate website rows', total;

  drop index if exists public.leads_website_key_unique;   -- نشيل أي نسخة ناقصة (partial) بنفس الاسم
  create unique index leads_website_key_unique on public.leads (website_key);
  raise notice 'Unique index on website_key is ready';
end $$;

notify pgrst, 'reload schema';

-- تأكيد: لازم يرجّع صف واحد فيه indexdef للـ unique index
select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'leads' and indexname = 'leads_website_key_unique';
