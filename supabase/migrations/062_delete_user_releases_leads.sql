-- 062 (pasted as "066"): حذف مستخدم = عملاؤه يرجعوا لقائمة العملاء العادية (غير موزعة) ويتعلّم عليهم "سبق توزيعه"
-- وتتمسح بيانات نشاطه (اجتماعات/طلبات/مكالمات/صفقات مسودة) لأنها بيانات تجربة.
-- حماية: ما يتمسحش مستخدم عنده صفقات معتمدة/نشطة (فلوس حقيقية) أو عنده موظفين تحته.
-- ملاحظة: call_logs / lead_comments / leads.worked_at, worked_by, assigned_by مش موجودين في أي migration في الريبو
-- (ممكن يكونوا من 000b أو 048/049). لو مش موجودين في الداتابيز الحذف هيفشل وقت التشغيل.

alter table public.leads add column if not exists was_distributed boolean not null default false;
alter table public.leads add column if not exists released_at timestamptz;

create or replace function public.delete_user_account(target_user_id uuid)
returns void language plpgsql security definer set search_path to 'public','auth' as $$
declare v_deals uuid[];
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'Only admins can delete users';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'The current admin cannot delete their own account';
  end if;
  if exists (select 1 from public.users where manager_id = target_user_id) then
    raise exception 'لا يمكن حذف هذا المدير لأن عنده موظفين تحته. انقل الموظفين لمدير آخر أولاً.';
  end if;
  if exists (select 1 from public.deals d where target_user_id in (d.closed_by_user_id, d.sales_user_id, d.telesales_user_id, d.approved_by)
             and d.status not in ('draft','cancelled')) then
    raise exception 'لا يمكن حذف هذا المستخدم لأن عنده صفقات معتمدة/جارية. عطّل الحساب بدل الحذف عشان العمولات تفضل محفوظة.';
  end if;

  -- 1) رجّع عملاءه للقائمة العادية وعلّم عليهم
  update public.leads
     set was_distributed = true, released_at = now(),
         assigned_to = null, assigned_by = null, assigned_at = null,
         worked_at = null, worked_by = null
   where assigned_to = target_user_id;

  -- 2) امسح بيانات نشاطه
  select array_agg(d.id) into v_deals from public.deals d
   where target_user_id in (d.closed_by_user_id, d.sales_user_id, d.telesales_user_id, d.approved_by);
  if v_deals is not null then
    delete from public.deal_commissions where deal_id = any(v_deals);
    delete from public.contract_reviews where deal_id = any(v_deals);
    delete from public.deals where id = any(v_deals);
  end if;
  delete from public.deal_commissions where target_user_id in (user_id, source_user_id, set_by);
  delete from public.meeting_requests where target_user_id in (assigned_sales_id, requested_by);
  delete from public.meetings where target_user_id in (assigned_sales_id, booked_by, attended_by);
  delete from public.call_logs where agent_id = target_user_id;
  delete from public.client_comments where author_id = target_user_id;
  delete from public.lead_comments where author_id = target_user_id;
  update public.payments set received_by = null where received_by = target_user_id;
  update public.payments set confirmed_by = null where confirmed_by = target_user_id;
  update public.exchange_rates set set_by = null where set_by = target_user_id;
  update public.user_commission_rates set updated_by = null where updated_by = target_user_id;
  update public.user_targets set updated_by = null where updated_by = target_user_id;

  delete from auth.users where id = target_user_id;
end $$;
