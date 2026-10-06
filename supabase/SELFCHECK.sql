-- SELFCHECK: فحص شامل للنظام (قراءة فقط، لا يغيّر أي بيانات). شغّله في Supabase SQL Editor.
-- النتيجة: جدول واحد؛ أي صف status=FAIL معناه مشكلة. ابعتلي الصور/النتيجة.
select set_config('request.jwt.claim.sub',(select id::text from public.users where role='admin' order by id limit 1),true) as _as_admin;

create temp table _chk(area text, item text, status text, detail text);

-- 1) الدوال المطلوبة
insert into _chk
select 'function', f, case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f) then 'OK' else 'FAIL' end, 'RPC مفقودة: شغّل الـ migration الخاص بها'
from unnest(array['add_lead_comment','admin_get_user_pay','admin_set_target','admin_set_user_pay','admin_update_user','can_access_deal','can_edit_lead','can_view_deal','can_view_lead','cancel_deal','cancel_installment_plan','claim_notifications_to_send','claim_websites_to_check','confirm_payment','count_unassigned_leads','create_installment_plan','current_sar_to_egp','distribute_leads_evenly','distribute_unassigned_leads','drop_push_subscription','enforce_unique_phone','fill_missing_phones','get_all_users_permissions','get_attention_items','get_audit_feed','get_audit_tables','get_auto_distribution','get_commission_lines','get_daily_summary','get_deal_installments','get_deal_installments_internal','get_duplicate_stats','get_funnel_stats','get_installments_overview','get_lead_card','get_lead_status_counts','get_leaderboard','get_leads_counts','get_loss_report','get_month_revenue','get_my_permissions','get_my_profile','get_notification_prefs','get_payroll','get_permission_catalog','get_source_performance','get_target_progress','get_target_progress_v2','get_team_performance','get_website_check_stats','get_whatsapp_link','has_permission','import_leads','list_email_confirmations','log_client_event','lookup_client_for_deal','mark_meeting_lost','merge_duplicate_leads','merge_duplicate_websites','notify_admins','notify_due_followups','notify_due_installments','notify_upcoming_renewals','phone_key','preview_installments','reassign_user_leads','recheck_website','record_payment','refresh_deal_commission_cache','remove_push_subscription','reset_user_permissions','run_auto_distribution','run_daily_jobs','save_push_subscription','save_website_checks','set_auto_distribution','set_deal_commission','set_notification_prefs','set_user_email_confirmed','set_user_permissions','setting_num','snapshot_deal_commissions','trg_audit','trg_audit_leads_bulk','trg_audit_lean','trg_audit_login','trg_audit_storage','trg_deal_commissions_cache','trg_deals_after_approve','trg_deals_before_approve','trg_leads_assigned_at','trg_leads_phone_key','trg_users_sync_commission','update_lead_details','upsert_whatsapp_template','url_encode','visible_user_ids','wa_phone']) f;

-- 2) الأعمدة المطلوبة
insert into _chk
select 'column', c, case when exists(select 1 from information_schema.columns where table_schema='public' and table_name=split_part(c,'.',1) and column_name=split_part(c,'.',2)) then 'OK' else 'FAIL' end, 'عمود مفقود أو اسمه مختلف'
from unnest(array['activity_logs.activity_type','activity_logs.actor_id','activity_logs.actor_name','activity_logs.actor_role','activity_logs.created_at','activity_logs.id','activity_logs.lead_id','activity_logs.notes','activity_logs.outcome','app_settings.key','app_settings.updated_at','app_settings.value','audit_log.action','audit_log.changed_by','audit_log.created_at','audit_log.id','audit_log.new_data','audit_log.old_data','audit_log.row_id','audit_log.table_name','client_comments.author_id','client_comments.author_name','client_comments.created_at','client_comments.id','client_comments.lead_id','client_comments.text','deals.approval_override_reason','deals.approved_at','deals.approved_by','deals.below_min_price','deals.closed_by_user_id','deals.commission_percent','deals.commission_sar','deals.contract_path','deals.created_at','deals.end_date','deals.fx_at_approval','deals.id','deals.lead_id','deals.list_price_sar','deals.min_price_sar','deals.notes','deals.package_duration_months','deals.package_id','deals.package_name','deals.price_sar','deals.recording_path','deals.sales_user_id','deals.start_date','deals.status','deals.telesales_user_id','deals.updated_at','leads.assigned_at','leads.assigned_to','leads.callback_date','leads.client_code','leads.company','leads.created_at','leads.customer_number','leads.data_quality','leads.free_trial_end_date','leads.id','leads.is_salla_store','leads.loss_note','leads.loss_reason','leads.name','leads.needs_meeting','leads.notes','leads.phone','leads.phone_key','leads.phone_source','leads.quantity','leads.region','leads.source','leads.status','leads.updated_at','leads.website','leads.website_check_category','leads.website_check_note','leads.website_checked_at','leads.website_claimed_at','leads.website_http_status','leads.website_key','leads.website_status','leads.website_status_source','meetings.assigned_sales_id','meetings.booked_by','meetings.created_at','meetings.id','meetings.lead_id','meetings.loss_note','meetings.loss_reason','meetings.outcome','meetings.proposed_date','meetings.telesales_notes','notifications.created_at','notifications.id','notifications.message','notifications.read','notifications.title','notifications.type','notifications.user_id','packages.created_at','packages.description','packages.duration_months','packages.features','packages.id','packages.is_active','packages.min_price_sar','packages.name','packages.price_sar','packages.updated_at','permission_catalog.grp','permission_catalog.key','permission_catalog.label_ar','permission_catalog.sort','user_commission_rates.base_currency','user_commission_rates.base_salary','user_commission_rates.closer_percent','user_commission_rates.lead_percent','user_commission_rates.manager_percent','user_commission_rates.updated_at','user_commission_rates.updated_by','user_commission_rates.user_id','user_permissions.granted','user_permissions.permission_key','user_permissions.updated_at','user_permissions.updated_by','user_permissions.user_id','users.commission_percent','users.email','users.full_name','users.id','users.last_login','users.manager_id','users.role','users.status','users.username']) c;

-- 3) تجارب فعلية للدوال (قراءة فقط) كأدمن
do $$
declare l uuid; u uuid; r jsonb;
  procedure_list text[] := array[
   'select public.get_auto_distribution()::text',
   'select count(*)::text from public.get_website_check_stats()',
   'select public.get_all_users_permissions()::text',
   'select count(*)::text from public.get_my_permissions()',
   'select public.get_permission_catalog()::text',
   'select count(*)::text from public.count_unassigned_leads(null::text,null::text)',
   'select count(*)::text from public.get_installments_overview()'];
  s text; o text;
begin
  select id into l from public.leads order by created_at desc limit 1;
  begin perform public.get_lead_card(l); insert into _chk values('smoke','get_lead_card','OK','');
  exception when others then insert into _chk values('smoke','get_lead_card','FAIL',sqlerrm); end;
  foreach s in array procedure_list loop
    begin execute s into o; insert into _chk values('smoke',left(s,60),'OK','');
    exception when others then insert into _chk values('smoke',left(s,60),'FAIL',sqlerrm); end;
  end loop;
end $$;

-- 4) بيانات
insert into _chk select 'data','عملاء بدون client_code',case when n=0 then 'OK' else 'FAIL' end,n::text from (select count(*) n from public.leads where client_code is null) x;
insert into _chk select 'data','مستخدمون نشطون بدون دور',case when n=0 then 'OK' else 'FAIL' end,n::text from (select count(*) n from public.users where status='active' and role is null) x;
insert into _chk select 'data','عدد الباقات الفعّالة',case when n>0 then 'OK' else 'FAIL' end,n::text from (select count(*) n from public.packages where is_active) x;
insert into _chk select 'data','FK يشير إلى profiles (قديم)',case when n=0 then 'OK' else 'FAIL' end,n::text from (select count(*) n from pg_constraint where contype='f' and to_regclass('public.profiles') is not null and confrelid=to_regclass('public.profiles')) x;
insert into _chk select 'data','RLS غير مفعّل على جداول',case when n=0 then 'OK' else 'FAIL' end,coalesce(s,'') from (select count(*) n, string_agg(relname,', ') s from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) x;

select * from _chk order by (status='OK'), area, item;
