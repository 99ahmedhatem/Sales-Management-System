# Sales Management System — AI Agent Guide

Read this file, then `docs/PRODUCT_SPEC.md` (business rules) and `docs/NEXT_TASKS.md` (what to build next).

Stack: React 19 + Vite + Tailwind v4 + TypeScript · Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) · GitHub → Vercel. Package manager: **pnpm**.

## RULE #1 — the database is the source of truth

Before writing any query or RPC call, open `supabase/migrations/*.sql` and use the **exact** table, column and function names there. **Never invent a column or RPC name.** If something you need doesn't exist, add a new numbered migration file (`009_...sql`) and tell the user to run it. Past bug: the UI queried `deals.sales_user_id` / `meeting_requests.assigned_sales_id` while the live DB had different names, so every screen failed.

Migration order: `supabase-setup.sql` (base) → `000b` → `001_packages` → `004_meetings` → `005_meeting_requests` → `006_deals` → `007_contract_reviews` → `008_money_commissions_payroll` → `009_management_tools` → `010_performance_security` → `011_repair` → `012_users_rls` → `013_leads_counts` → `014_repair_fixes` → `015_lead_status_counts` → `016_audit_everything` → `017_worked_clients_count` → `018_team_performance` → `020_reports_summary` → `021_edit_user` → `022_client_lookup` → `023_target_progress` → `028_distribute_bulk` → `029_distribute_region_fix` (019 is reserved for `019_dedupe_leads`; 024–027 are not in the repo).

**Every database change = a numbered migration file in the repo.** Never run SQL only from a chat / the SQL editor without saving it as the next numbered file in `supabase/migrations/`. If it isn't in the repo, it doesn't exist.

Not in the repo yet: `000b`. Add it to `supabase/migrations/` as soon as you have it. Migrations not run yet on Supabase are collected in `supabase/RUN_PENDING.sql` (currently `029`; 004–023 and 028 are applied). Add each new migration there and remove it once it has been run.

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

## Key tables (see migrations for full columns)

- `deals`: `lead_id, package_id, sales_user_id, telesales_user_id, closed_by_user_id, price_sar (closing price), list_price_sar, min_price_sar, below_min_price, start_date, end_date, recording_path, contract_path, status (draft|contract_uploaded|pending_approval|approved|active|cancelled), approved_by, approved_at, fx_at_approval`
  - `deals.commission_percent`, `deals.commission_sar` (011): a cache kept up to date automatically by the DB. **Read-only** — never write them from the client.
- `users.commission_percent` (011): kept in sync with `user_commission_rates.closer_percent`.
- `meeting_requests`: `lead_id, requested_by, assigned_sales_id, notes, preferred_date, status (pending|accepted|declined|cancelled)`
- `meetings`: `lead_id, booked_by, assigned_sales_id, proposed_date, telesales_notes, outcome`
- `packages`: `name, description, features text[], duration_months, price_sar, min_price_sar, is_active`
- `contract_reviews`: `deal_id, contract_paths[], status, extracted, mismatches, summary`
- Money (008): `payments`, `exchange_rates`, `user_commission_rates`, `deal_commissions`, `app_settings`; views `deal_balances`, `monthly_revenue`, `monthly_revenue_by_sales`, `upcoming_renewals`.

## Money rules

- Base currency SAR; display SAR (ريال) and EGP (جنيه). Never hardcode a rate or `AED`.
- Each payment keeps its own `sar_to_egp`; `amount_sar/amount_egp` are generated. Revenue = **confirmed** payments only.
- Current rate: `current_sar_to_egp()` (admin adds rows to `exchange_rates`, never edits old ones).

## Commission & salary rules

`user_commission_rates` per user: `closer_percent` (when he closes), `lead_percent` (telesales whose lead a sales closed), `manager_percent` (what this user's manager earns from this user's deals), `base_salary` + `base_currency`.

- Percentages are **snapshotted into `deal_commissions` automatically when a deal becomes `approved`** (DB trigger). Changing rates later doesn't touch old deals.
- Admin override for one deal: `set_deal_commission(p_deal_id, p_user_id, p_role_in_deal, p_percent, p_source_user_id)`.
- Salary = base + commissions → **`get_payroll(p_month)`** and `get_commission_lines(p_user_id, p_month)`. Never compute in the client. Cancelled deals drop out automatically (`cancel_deal`, admin).
- Team performance / my earnings (018): `get_team_performance(p_from date, p_to date)` (nulls = all time; admin all, manager self + team, others self). Admin edits salary and rates with `admin_set_user_pay(p_user_id, p_base_salary, p_base_currency, p_closer_percent, p_lead_percent, p_manager_percent)`; `admin-create-user` also accepts `base_salary, base_currency, commission_percent, lead_percent, manager_percent`.
- Edit user (021, admin): read with `admin_get_user_pay(p_user_id)` → `user_id, full_name, email, role, status, manager_id, base_salary, base_currency, closer_percent, lead_percent, manager_percent, team_members`; save with `admin_update_user(p_user_id, p_full_name, p_role, p_set_manager, p_manager_id, p_status, p_base_salary, p_base_currency, p_closer_percent, p_lead_percent, p_manager_percent)` (null = unchanged; send `p_set_manager: true` to change or clear the manager). Never update `users.role/manager_id/status/commission_percent` directly from the client.
- New Deal client lookup (022): `lookup_client_for_deal(p_code)` accepts `client_code`, `customer_number` or a phone (last 9 digits, `phone_last9()`), applies the same access rules as `create_deal`, and returns `lead_id, name, phone, client_code, customer_number, status, owner_name, open_deal_status, reason`. Display/early check only; `create_deal` still enforces access.
- Targets (023): `get_target_progress_v2(p_month)` → rows `kind (member|team), user_id, full_name, role, manager_id, calls/meetings/deals_done, revenue_sar, calls/meetings/deals_target, revenue_target_sar`; admin sees all, a manager sees their team total (`kind = team`, distinct deals) + their members, others themselves. Admin sets targets with `admin_set_target(p_user_id, p_month, p_calls, p_meetings, p_deals, p_revenue_sar)`; a manager's target is for the whole team.
- Bulk distribution (028/029, admin or manager): `count_unassigned_leads(p_country, p_quality)` → bigint; `distribute_unassigned_leads(p_user_ids, p_limit, p_country, p_quality, p_max_per_user)` → rows `user_id, assigned_count`. Only unassigned leads, only active telesales (manager: their team). Country = `leads.region`.
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

=== END ===
