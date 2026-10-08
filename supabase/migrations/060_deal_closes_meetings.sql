-- 060 (pasted as "supabase-062"; saved under the next free number). Already run on Supabase.
-- عند إنشاء صفقة: اجتماعات العميل المفتوحة تتحول لـ "تمت الصفقة" + "حضر" فتختفي من "القادمة" وتبقى في "كل الاجتماعات"
create or replace function public.trg_deal_closes_meetings() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  update public.meetings
     set outcome='Deal Closed – Won',
         attended_at=coalesce(attended_at, now()),
         attended_by=coalesce(attended_by, auth.uid())
   where lead_id=new.lead_id and outcome in ('Scheduled','Rescheduled');
  return new;
end $$;
drop trigger if exists deals_close_meetings on public.deals;
create trigger deals_close_meetings after insert on public.deals
for each row execute function public.trg_deal_closes_meetings();
