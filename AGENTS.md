# Sales Management System — AI Agent Guide

Read this file, then `docs/PRODUCT_SPEC.md` (business rules) and `docs/NEXT_TASKS.md` (what to build next).

Stack: React 19 + Vite + Tailwind v4 + TypeScript · Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) · GitHub → Vercel. Package manager: **pnpm**.

## RULE #1 — the database is the source of truth

Before writing any query or RPC call, open `supabase/migrations/*.sql` and use the **exact** table, column and function names there. **Never invent a column or RPC name.** If something you need doesn't exist, add a new numbered migration file (`009_...sql`) and tell the user to run it. Past bug: the UI queried `deals.sales_user_id` / `meeting_requests.assigned_sales_id` while the live DB had different names, so every screen failed.

Migration order: `supabase-setup.sql` (base) → `001_packages` → `004_meetings` → `005_meeting_requests` → `006_deals` → `007_contract_reviews` → `008_money_commissions_payroll`.

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
- `app_settings.commission_basis`: `deal_value` (default; month of `approved_at`) or `collected`.

## Writes go through RPCs only

No direct insert/update on `deals, payments, meetings, meeting_requests, deal_commissions, contract_reviews`. RPCs: `request_meeting, accept_meeting_request, decline_meeting_request, cancel_meeting_request, reassign_meeting_request, update_meeting_outcome, create_deal, attach_recording, attach_contract, request_contract_review, approve_deal, cancel_deal, record_payment, confirm_payment, set_deal_commission`. (Admin may write directly to `user_commission_rates`, `exchange_rates`, `app_settings`, `packages`.)

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
