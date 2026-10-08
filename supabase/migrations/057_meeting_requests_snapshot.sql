-- 057 (originally pasted as "060"; saved under the next free number).
-- يملأ اسم/رقم/كود/موقع العميل تلقائياً في طلبات الاجتماع الجديدة.
-- ملاحظة: 056 فيه trigger بنفس الشغل (meeting_requests_lead_snapshot)؛ الاتنين بيكتبوا نفس القيم، فوجودهم مع بعض مش بيضر.
create or replace function public.trg_meeting_requests_snapshot() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  select l.name, l.phone, l.client_code, l.website into new.lead_name, new.lead_phone, new.client_code, new.lead_website
  from public.leads l where l.id = new.lead_id;
  return new;
end $$;

drop trigger if exists meeting_requests_snapshot on public.meeting_requests;
create trigger meeting_requests_snapshot before insert on public.meeting_requests
for each row execute function public.trg_meeting_requests_snapshot();
