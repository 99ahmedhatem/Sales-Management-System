-- =====================================================================
-- RUN_PENDING — الـ migrations اللي لسه ما اتشغّلتش في Supabase، بالترتيب.
-- حالياً: مفيش. من 004 لحد 022 اتشغّلوا (اتأكدنا منهم).
-- أي migration جديد يتحط هنا فوق استعلام التحقق، وبعد ما يتشغّل يتشال.
-- =====================================================================

-- =====================================================================
-- تحقّق (قراءة بس): كل RPC/view الكود بيستخدمها. لازم يرجّع 0 صفوف.
-- =====================================================================
select 'missing function' as problem, f as name
from unnest(array[
  'get_leads_counts','get_lead_status_counts','get_worked_clients_count',
  'set_lead_customer_number','fill_missing_phones','list_email_confirmations','set_user_email_confirmed','delete_user_account',
  'request_meeting','cancel_meeting_request','create_deal','attach_recording','attach_contract','approve_deal',
  'get_month_revenue','get_daily_summary','get_funnel_stats','get_target_progress','get_loss_report',
  'get_source_performance','get_leaderboard','get_attention_items','get_payroll',
  'get_audit_feed','get_audit_tables','get_team_performance','admin_set_user_pay','get_reports_summary','get_team_lead_stats','admin_get_user_pay','admin_update_user','lookup_client_for_deal'
]) f
where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)
union all
select 'missing view/table', t
from unnest(array['monthly_revenue','audit_log','user_commission_rates','activity_logs','client_comments','notifications','packages',
                  'meeting_requests','meetings','deals','contract_reviews','users','leads']) t
where to_regclass('public.' || t) is null;
