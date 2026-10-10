# Sales Management System — AI Agent Guide

Read this file, then `docs/PRODUCT_SPEC.md` (business rules) and `docs/NEXT_TASKS.md` (what to build next).

Stack: React 19 + Vite + Tailwind v4 + TypeScript · Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) · GitHub → Vercel. Package manager: **pnpm**.

## RULE #1 — the database is the source of truth

Before writing any query or RPC call, open `supabase/migrations/*.sql` and use the **exact** table, column and function names there. **Never invent a column or RPC name.** If something you need doesn't exist, add a new numbered migration file (`009_...sql`) and tell the user to run it. Past bug: the UI queried `deals.sales_user_id` / `meeting_requests.assigned_sales_id` while the live DB had different names, so every screen failed.

Migration order: `supabase-setup.sql` (base) → `000b` → `001_packages` → `004_meetings` → `005_meeting_requests` → `006_deals` → `007_contract_reviews` → `008_money_commissions_payroll` → `009_management_tools` → `010_performance_security` → `011_repair` → `012_users_rls` → `013_leads_counts` → `014_repair_fixes` → `015_lead_status_counts` → `016_audit_everything` → `017_worked_clients_count` → `018_team_performance` → `020_reports_summary` → `021_edit_user` → `022_client_lookup` → `023_target_progress` → `024_lock_anon` → `025_target_progress` → `026_fix_website_unique` → `027_fix_profiles_fk` → `028_distribute_bulk` → `029_distribute_region_fix` → `030_manager_distribute_own` → `031_distribute_exact_log` → `032_auto_distribution` → `033_website_check` → `034_lead_card` → `035_whatsapp_installments_profile` → `036_push_email` → `037_permissions` → `038_lead_card_fixes` → `039_admin_full_access` → `040_seed_packages` → `041_client_comments_columns` → `042_lead_discovery` → `043_discovery_simple` → `044_discovery_fix` → `045_discovery_no_operators` → `046_discovery_any_site` → `047_packages_view` → (048, 049 not in the repo yet) → `050_notification_type_system` → `051_comment_notification_type` → `052_leads_rls_initplan` (already applied) → `053_discovery_nolock_strict` (pasted as "056"; needs pg_cron ≥ 1.5) → `054_approve_discovery_type` → `055_manager_closer_commission` (pasted as "059") → `056_custom_deal_meeting_snapshot` → `057_meeting_requests_snapshot` (pasted as "060") → `058_admin_manager_own_work` (pasted as "061") → `059_fix_admin_closer_and_booked_by_id` → `060_deal_closes_meetings` (pasted as "supabase-062") → `061_package_manager_access` (pasted as "065") (019 is reserved for `019_dedupe_leads`). **The live `get_target_progress_v2` is 025's version (no `kind` column; 023's version is not live).**

**Every database change = a numbered migration file in the repo.** Never run SQL only from a chat / the SQL editor without saving it as the next numbered file in `supabase/migrations/`. If it isn't in the repo, it doesn't exist.

Not in the repo yet: `000b`. Add it to `supabase/migrations/` as soon as you have it. Migrations not run yet on Supabase are collected in `supabase/RUN_PENDING.sql` (currently `032`; 004–028 and 030 are applied; 031 is not in the repo; `029_distribute_region_fix` is kept for reference only — 030 replaces it, never run 029). Add each new migration there and remove it once it has been run.

**SQL in a PR:** any PR that adds SQL must end its description with this exact text, followed by the list: "الملفات الجديدة اللي لازم تتشغّل في Supabase بالترتيب" (the new files to run in Supabase, in order).

## Flow

```
Lead (owned by TELESALES only; never reassigned to sales)
 → telesales: request_meeting(target_lead_id, target_sales_id, request_notes, preferred_meeting_date)
 → sales: accept_meeting_request(target_request_id, target_proposed_date) / decline_meeting_request
 → sales: create_deal(target_lead_id, target_package_id, target_price_sar, target_start_date, deal_notes)
          attach_recording(deal, path) · upload contract → attach_contract(deal, path)  (creates a queued review, returns review id)
 → Edge Function review-contract (Claude) → passed | needs_attention | failed
 → admin/manager: approve_deal(target_deal_id, override_reason_text)  (needs review = passed; admin override needs ≥5 words)
 → payments: record_payment → admin confirm_payment
 → revenue: get_month_revenue · payroll: get_payroll
```

Telesales may also close a deal himself (`create_deal` as telesales): `closed_by_user_id` = telesales, `sales_user_id` = null.

Admin and manager work too (058, pasted as "061"; 059 fixes `closer_admin` + `meetings.booked_by_id`): `request_meeting` host can be sales, manager or admin (even himself); `accept_/decline_meeting_request` by whoever the request is assigned to (admin: any); `create_deal` / `create_custom_deal` for a manager on his + his team's clients, admin on any. Pages: "My Queue" (`myqueue` → `TelesalesDashboard role=…`) and "My Meetings" (`mymeetings` → `SalesDashboard role=…`). Never assume a deal/meeting participant is sales or telesales: show the user's name (`closed_by_user_id` = closer, `telesales_user_id` = client owner). Lists for admin/manager use `useScopeFilter()` (`src/components/shared/ScopeFilter.tsx`).

Distribution / attendance / meeting link (SQL **not in the repo yet** — save it as the next numbered file): recipients of `assign_leads(p_lead_ids, p_assignee)`, `distribute_leads_evenly`, `distribute_unassigned_leads`, `reassign_user_leads`, `set_auto_distribution` can be telesales, manager or admin (manager: himself + his team). `meetings.attended_at, attended_by` via `mark_meeting_attended(target_meeting_id, p_attended)`; `meetings.meeting_link, link_sent_at` via `set_meeting_link(target_meeting_id, p_link, p_mark_sent)`. Meeting lifecycle: **Upcoming** = `attended_at is null` and outcome `Scheduled|Rescheduled` (`UPCOMING_OUTCOMES`); **All meetings** = everything (archive). "Meeting done" = `mark_meeting_attended(…, true)` → leaves Upcoming; then "+ New Deal" in All meetings; creating a deal marks the lead's open meetings `Deal Closed – Won` + attended (060 trigger). My Meetings scope: sales = host, telesales = host or booker, manager = self + team, admin = all. UI in `src/components/shared/MeetingActions.tsx` (attendance, link field, WhatsApp link button, outcome buttons, `formatMeetingDate`).

## Key tables (see migrations for full columns)

- `deals`: `lead_id, package_id, sales_user_id, telesales_user_id, closed_by_user_id, price_sar (closing price), list_price_sar, min_price_sar, below_min_price, start_date, end_date, recording_path, contract_path, status (draft|contract_uploaded|pending_approval|approved|active|cancelled), approved_by, approved_at, fx_at_approval`
  - `deals.commission_percent`, `deals.commission_sar` (011): a cache kept up to date automatically by the DB. **Read-only** — never write them from the client.
- `users.commission_percent` (011): kept in sync with `user_commission_rates.closer_percent`.
- `meeting_requests`: `lead_id, requested_by, assigned_sales_id, notes, preferred_date, status (pending|accepted|declined|cancelled)`
- `meetings`: `lead_id, booked_by, assigned_sales_id, proposed_date, telesales_notes, outcome` + snapshot (056) `lead_name, lead_phone, client_code, lead_website` (also on `meeting_requests`; filled/synced by triggers). Sales can't read the telesales lead (RLS), so meeting/request screens read the snapshot, never a `leads` join.
- Custom service deal (056): `create_custom_deal(target_lead_id, custom_service_name, custom_duration_months, target_price_sar, target_start_date, deal_notes)`; `deals.package_id` is null, `package_name` = service name, `list_price_sar` = price, `min_price_sar` = 0. Always show `deals.package_name`; never assume `package_id` or join `packages`.
- `packages`: `name, description, features text[], duration_months, price_sar, min_price_sar, is_active`
- `contract_reviews`: `deal_id, contract_paths[], status, extracted, mismatches, summary`
- Money (008): `payments`, `exchange_rates`, `user_commission_rates`, `deal_commissions`, `app_settings`; views `deal_balances`, `monthly_revenue`, `monthly_revenue_by_sales`, `upcoming_renewals`.

## Money rules

- Base currency SAR; display SAR (ريال) and EGP (جنيه). Never hardcode a rate or `AED`.
- Each payment keeps its own `sar_to_egp`; `amount_sar/amount_egp` are generated. Revenue = **confirmed** payments only.
- Current rate: `current_sar_to_egp()` (admin adds rows to `exchange_rates`, never edits old ones).

## Commission & salary rules

`user_commission_rates` per user: `closer_percent` (when he closes — sales, telesales or a manager; `deal_commissions.role_in_deal` = `closer_sales|closer_telesales|closer_manager`, 055), `lead_percent` (telesales whose lead a sales closed), `manager_percent` (what this user's manager earns from this user's deals), `base_salary` + `base_currency`.

- Percentages are **snapshotted into `deal_commissions` automatically when a deal becomes `approved`** (DB trigger). Changing rates later doesn't touch old deals.
- Admin override for one deal: `set_deal_commission(p_deal_id, p_user_id, p_role_in_deal, p_percent, p_source_user_id)`.
- Salary = base + commissions → **`get_payroll(p_month)`** and `get_commission_lines(p_user_id, p_month)`. Never compute in the client. Cancelled deals drop out automatically (`cancel_deal`, admin).
- Team performance / my earnings (018): `get_team_performance(p_from date, p_to date)` (nulls = all time; admin all, manager self + team, others self). Admin edits salary and rates with `admin_set_user_pay(p_user_id, p_base_salary, p_base_currency, p_closer_percent, p_lead_percent, p_manager_percent)`; `admin-create-user` also accepts `base_salary, base_currency, commission_percent, lead_percent, manager_percent`.
- Edit user (021, admin): read with `admin_get_user_pay(p_user_id)` → `user_id, full_name, email, role, status, manager_id, base_salary, base_currency, closer_percent, lead_percent, manager_percent, team_members`; save with `admin_update_user(p_user_id, p_full_name, p_role, p_set_manager, p_manager_id, p_status, p_base_salary, p_base_currency, p_closer_percent, p_lead_percent, p_manager_percent)` (null = unchanged; send `p_set_manager: true` to change or clear the manager). Never update `users.role/manager_id/status/commission_percent` directly from the client.
- New Deal client lookup (022): `lookup_client_for_deal(p_code)` accepts `client_code`, `customer_number` or a phone (last 9 digits, `phone_last9()`), applies the same access rules as `create_deal`, and returns `lead_id, name, phone, client_code, customer_number, status, owner_name, open_deal_status, reason`. Display/early check only; `create_deal` still enforces access.
- Targets (025, live): `get_target_progress_v2(p_month)` → rows `user_id, full_name, role, manager_id, team_size, calls/meetings/deals_done, revenue_sar, collected_sar, calls/meetings/deals/revenue_target(_sar), calls/meetings/deals/revenue_pct`. No `kind` column: a row with `role = 'manager'` is that manager's whole-team total (distinct deals). Admin sees all, a manager sees their team total + their members, others themselves. Admin sets targets with `admin_set_target(p_user_id, p_month, p_calls, p_meetings, p_deals, p_revenue_sar)`; a manager's target is for the whole team.
- Bulk distribution (030, admin or manager): `count_unassigned_leads(p_country, p_quality)` → bigint; `distribute_unassigned_leads(p_user_ids, p_limit, p_country, p_quality, p_max_per_user)` → rows `user_id, assigned_count`. Admin: unassigned leads → any active telesales. Manager: leads assigned to the manager → active telesales of their team. Country = `leads.region`.
- Auto distribution (032, admin): `get_auto_distribution()` → one row `enabled, user_ids uuid[], max_open int|null, waiting bigint` (waiting = all unassigned leads); `set_auto_distribution(p_enabled, p_user_ids, p_max_open)` → `'saved'`; `run_auto_distribution(p_limit default 5000)` → int distributed (admin or cron; only unassigned leads with status `New`, to the least-loaded participant under `max_open`); `run_daily_jobs()` → rows `job, affected` (`auto_distribution`, `followup_reminders`, `renewal_reminders`). Settings live in `app_settings` keys `auto_distribute_enabled/_users/_max_open`.
- `app_settings.commission_basis`: `deal_value` (default; month of `approved_at`) or `collected`.

## Writes go through RPCs only

No direct insert/update on `deals, payments, meetings, meeting_requests, deal_commissions, contract_reviews`. RPCs: `request_meeting, accept_meeting_request, decline_meeting_request, cancel_meeting_request, reassign_meeting_request, update_meeting_outcome, create_deal, attach_recording, attach_contract, request_contract_review, approve_deal, cancel_deal, record_payment, confirm_payment, set_deal_commission`. (Admin may write directly to `user_commission_rates`, `exchange_rates`, `app_settings`, `packages`.)

Admin user tools: `list_email_confirmations()`, `set_user_email_confirmed(target_user_id, should_confirm)`, `fill_missing_phones(rows jsonb)`. New users are created only through the Edge Function `admin-create-user` (checks `my_role() = 'admin'`, uses `auth.admin.createUser` with the service role inside the function). Never call `supabase.auth.signUp` from the admin screen — it replaces the admin's session.

## Storage

Private buckets `contracts`, `recordings`, `receipts`. Path = `<deal_id>/<filename>`. Show with `createSignedUrl`.

## Security

- Anthropic key only in Supabase secrets (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`) for the Edge Function. Never in the frontend, never `VITE_`, never committed. Never `service_role` in client code.
- RLS is the security layer; client role checks are UX only. A user must never see another user's deals, payments, commissions or salary (managers: their team).

## UI conventions

Dark theme, accent `#dfff03`. Reuse `src/components/ui.tsx`. Page routing = `page` string in `AppShell.tsx` + `App.tsx`. Show RPC error messages to the user. Paginate lists. Format money with `Intl.NumberFormat(..., {style:'currency', currency:'SAR'|'EGP'})`.

## Definition of done

`pnpm build` and `pnpm exec tsc --noEmit` pass · tested as admin, manager, sales, telesales · no invented columns · no mock data / `AED` / hardcoded rates or percentages · new SQL saved as a numbered migration.

## Do not

Reassign leads to sales · mark money received before `confirm_payment` · compute commissions in the client · skip or auto-pass the AI review · put files in public buckets.

## Management & monitoring tools (migration 009)

Use these exact names (read `supabase/migrations/009_management_tools.sql` for details). Never invent columns.

- `leads.assigned_at` (set by trigger when `assigned_to` changes), `loss_reasons(code, label_ar, is_active, sort_order)`, `leads.loss_reason/loss_note`, `meetings.loss_reason/loss_note`.
- `app_settings` SLA keys: `sla_first_call_hours`, `sla_request_response_hours`, `meeting_no_outcome_hours`, `deal_draft_days`, `deal_approval_days`, `payment_confirm_days` (admin edits; read with `setting_num`).
- RPCs (all return tables; RLS/role filtering is done inside):

- `get_attention_items()` → kind, severity, entity_id, lead_id, lead_name, owner_id, owner_name, since, age_hours, detail
- `get_funnel_stats(p_from date, p_to date)` → per telesales/sales: leads_received, leads_contacted, leads_interested, meeting_requests, requests_received, meetings_held, deals_count, revenue_sar, avg_hours_to_first_call, avg_hours_to_respond, avg_days_meeting_to_deal, avg_days_deal_to_payment
- `get_target_progress(p_month date)` + table `user_targets(user_id, month /*first day of month*/, calls_target, meetings_target, deals_target, revenue_target_sar)` (admin upserts)
- `get_leaderboard(p_month date)` (revenue is null for non admin/manager)
- `mark_meeting_lost(target_meeting_id, p_reason_code, p_note)` and `get_loss_report(p_from, p_to)`
- `distribute_leads_evenly(p_lead_ids uuid[], p_user_ids uuid[], p_max_open_per_user int)` → rows (user_id, assigned_count); a row with `user_id = null` = leads that could not be assigned
- `reassign_user_leads(p_from_user, p_to_user /*null = unassign*/, p_only_open)` → number moved
- `get_source_performance(p_from, p_to)`, `get_daily_summary(p_date)`
- `audit_log` is admin read-only. `notify_due_followups()` / `notify_upcoming_renewals()` are for scheduled jobs only (service_role), never call from the browser.
- Performance rule: lists of leads must use `.range()` and order by `created_at desc, id desc`.
- Counting rule: **never use `count: 'estimated'` on `leads` / `meetings` / `deals`.** The RLS policies use `OR` over functions, so Postgres estimates about a third of the real rows (it showed 10,856 instead of 32,567). Use `count: 'exact'` for small, filtered counts; for large counts call a dedicated count RPC and show its error instead of a guess:
  - `get_leads_counts()` (013, admin only) → `total, unassigned, without_phone`
  - `get_lead_status_counts()` (015, admin only) → one row per `status, total`
  - `get_worked_clients_count(p_user_ids uuid[], p_activity_types text[] default {call,forward})` (017) → distinct leads worked; admin for anyone, otherwise yourself or your team
  - `get_reports_summary()` (020, admin only) → one jsonb with `leads`, `meetings`, `sources`, `telesales`, `sales` for the Reports page. Never page through a whole table in the browser to compute a report.
  - `get_team_lead_stats(p_user_ids uuid[])` (020) → per user `user_id, total, contacted, converted`; admin for anyone, otherwise yourself or your team. Use it for per-agent numbers instead of counting the leads on the current page.

## Audit log & stability (016)

- Activity log page (admin): `get_audit_feed(p_limit, p_offset, p_table, p_user, p_from, p_to)` and `get_audit_tables()`. Never read `audit_log` directly.
- Pages are wrapped in `ErrorBoundary` (`src/components/shared/ErrorBoundary.tsx`); `supabaseClient.ts` cuts requests after 25s (Storage uploads and Edge Functions are exempt).
- Every `await supabase…` handles `error` and shows its message (no empty `catch {}`); every screen has loading, error and empty states.
- Save/submit buttons are disabled while their request runs.
- Reload the shown data after every successful write.
- Never load a whole table: always `.range()`, a count (`head: true`), or an RPC.

## Client card, website checks, WhatsApp, installments, profile, push (033–038)

- **Client card** (`src/components/shared/LeadCard.tsx`, opened anywhere with `useLeadCard()` / `<ClientLink>` from `AppOverlays.tsx`):
  - `get_lead_card(p_lead_id)` → jsonb `{ lead, can_edit, comments, deals, meetings, history }`. Visibility: `can_view_lead(uuid)`; editing: `can_edit_lead(uuid)` (admin · manager for his team · telesales for own leads; sales = view + comment).
  - `update_lead_details(p_lead_id, p_changes jsonb)`: only `name, phone, company, region, website (+ website_key), source, callback_date, quantity, data_quality, website_status`. Send only changed fields. When `website` changes, send `website_key` computed with `normalizeWebsite()` from `src/lib/websiteKey.ts` (same as import / Add Lead). Errors starting with `DUPLICATE_PHONE:` / `DUPLICATE_WEBSITE:` end with `client <code>`. Never change `status` / `assigned_to` here. The live version is 038 (034's used a non-existent `phone_key`).
  - `add_lead_comment(p_lead_id, p_text)` (max 2000 chars, notifies the owner).
- **Website checks** (033): `leads.website_checked_at, website_claimed_at, website_check_category, website_check_note, website_http_status`. Categories: `ok, ok_protected, dns, timeout, ssl, refused, http_404, http_4xx, http_5xx, parked, suspended, invalid_url, network`. UI: `get_website_check_stats()` → `(bucket, total)` with `working, not_working, unchecked, no_website, cat:<category>`; `recheck_website(p_lead_id)` (admin/manager). The checking itself is the Edge Function `check-websites` (`{batch}` admin or cron, `{lead_id}` admin/manager) → returns `{checked, saved, by_category, remaining}`. `claim_websites_to_check` / `save_website_checks` are service_role only.
- **WhatsApp** (035): table `whatsapp_templates(id, stage, title, body, is_active, sort_order)` (select directly; admin writes via `upsert_whatsapp_template(p_id, p_stage, p_title, p_body, p_active, p_sort)`). Stages: `new, assigned, contacted, interested, callback, no_answer, meeting, renewal, payment_due, general`. Variables: `{name} {company} {agent} {website} {client_code}`. Link: `get_whatsapp_link(p_lead_id, p_template_id?, p_custom_text?)` → `(url, message, phone)`.
- **Installments** (035, live overview = 038): table `deal_installments`. `preview_installments(p_total, p_count 1–36, p_first_due, p_interval_days)`, `create_installment_plan(p_deal_id, p_schedule jsonb [{due_date, amount_sar, note?}])` (admin/manager; total must equal `deals.price_sar`), `cancel_installment_plan(p_deal_id)`, `get_deal_installments(p_deal_id)` (status `paid|partial|pending|overdue` is computed from **confirmed** payments — never compute it in the client), `get_installments_overview(p_days_ahead)`. Daily reminders run inside `run_daily_jobs()`.
- **Profile** (035): `get_my_profile(p_month date, p_user_id uuid default null)` → `{ user, month, rates, stats, pay, target, deals, open_leads, overdue_followups }`. Admin can open anyone, a manager his team.
- **Push / email** (036): `notifications.delivered_at`, tables `push_subscriptions`, `notification_prefs` (written only via RPCs). Client: `save_push_subscription`, `remove_push_subscription`, `get_notification_prefs()` → `(push, email, devices)`, `set_notification_prefs(p_push, p_email)`; helpers in `src/lib/push.ts` (`VITE_VAPID_PUBLIC_KEY`, public key only). Sending = Edge Function `send-notifications` (cron, uses `claim_notifications_to_send` / `drop_push_subscription`, service_role only). Secrets: `CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT`, optional `RESEND_API_KEY, MAIL_FROM`.
- **Permissions** (037): `permission_catalog(key, label_ar, grp, sort)`, `role_default_permissions(role, permission_key)`, `user_permissions(user_id, permission_key, granted)`. `has_permission(p_key, p_user)` (admin always true). Admin screen (`AdminPermissions.tsx`): `get_all_users_permissions()`, `get_permission_catalog()`, `set_user_permissions(p_user, p_perms jsonb)` (send only changed keys; `null` = back to default), `reset_user_permissions(p_user)`. In the UI use `usePermissions().can(key)` from `src/hooks/usePermissions.tsx` (loads `get_my_permissions()` once). This is a UI layer; RLS was not changed. `supabase/PERMISSIONS_CHECK.sql` is a read-only diagnostic to run in the SQL editor.
- **Lead discovery** (042, admin only, `AdminDiscovery.tsx`): the engine runs in the database (`discovery_send` / `discovery_collect` via pg_cron + pg_net); the UI only calls RPCs: `has_discovery_serper_key`, `set_discovery_serper_key` (never show or keep the key), `get_discovery_config` / `save_discovery_config(p_config, p_name, p_instructions)` / `discovery_default_config`, `start_discovery_run`, `set_discovery_run_state(p_run, running|paused|stopped)`, `discovery_progress`, `approve_discovery_results(p_ids, p_data_quality normal|medium|high, p_is_salla null=auto|true|false)` → `(received, added, duplicates)` (054; uses `import_leads`, skips duplicates, sets `leads.is_salla_store` on new leads only), `reject_discovery_results`, `discovery_estimate(p_config)`, `discovery_diagnose(p_run)` → rows (item, value) (044; `start_discovery_run` fills missing config keys from the defaults) (043: config is by country — `countries`, `country_defs`, `features`, `custom_features`, `sectors`, `include_cities`). Results: select `discovery_results` where `status = new`. No requests to outside websites from the browser.
- `check-websites` and `send-notifications` are deployed with `--no-verify-jwt` (they check the JWT role or `x-cron-secret` themselves) — see `scripts/deploy-functions.ps1`.

## Visibility convention (who sees what) — apply by default to any new feature
- **admin**: everything, including create/edit/delete and settings.
- **manager**: team-wide read (leads, deals, reports), distribution, approvals; no system settings or user management.
- **sales / telesales**: only their own leads/meetings/deals; read-only for shared reference data (e.g. packages, WhatsApp templates); never see min prices, salaries, other users' commissions or audit log unless a per-user permission grants it.
- Reference data shown to all roles must be exposed through a read-only SECURITY DEFINER RPC that hides sensitive columns (e.g. `list_packages()` hides `min_price_sar`), gated by a permission key in `permission_catalog` with role defaults in `role_default_permissions`.
- Writes stay admin-only (or via the existing RPCs) unless the user says otherwise.
- `notifications.type` has a check constraint in the live DB that does **not** allow `comment`: use `system` (or `assignment` / `meeting` / `reminder`) and wrap notification inserts in `begin … exception when others then null; end;` so they never block the main action (050, 051).
- Packages (047): `list_packages()` for every role with `packages.view`; `min_price_sar` is null without `packages.view_min_price` (manager by default). The admin page (`AdminPackages.tsx`) keeps managing the table directly.
- Package visibility per manager (061, pasted as "065"): table `package_manager_access(package_id, manager_id)`, `can_use_package(p_package, p_user default auth.uid())`; a package with no rows is for everyone; with rows only those managers + their team (+ admin) see it. Filtering is in the DB (RLS, `list_packages`, `create_deal`) — the UI never filters. Admin reads `get_package_access()` → rows `package_id, manager_id`; saves `set_package_access(p_package_id, p_manager_ids uuid[])` (empty = everyone). UI: Visibility column, modal and bulk "Assign to manager" in `AdminPackages.tsx`.

=== END ===
