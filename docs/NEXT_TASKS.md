# Next Tasks

One task per branch. Read `AGENTS.md` and the SQL in `supabase/migrations` first; use exact names. Test as admin, manager, sales, telesales. Run `pnpm build` and `pnpm exec tsc --noEmit`.

## Money layer (migration 008) — not built yet

- **A. Users screen**: per employee upsert into `user_commission_rates` (closer_percent, lead_percent, manager_percent, base_salary, base_currency); show "Manager % on this employee" when a manager is selected; admin editor for `app_settings.commission_basis`.
- **B. Payments** on the deal page: `record_payment`, receipts upload to bucket `receipts/<deal_id>/…`, `deal_balances`; admin "Pending payments" → `confirm_payment`.
- **C. Revenue page** (admin): `get_month_revenue`, `monthly_revenue`, `monthly_revenue_by_sales`, add row to `exchange_rates`, Excel export.
- **D. Payroll page**: `get_payroll(month)` + `get_commission_lines`; "My earnings" card per role; admin `set_deal_commission` and `cancel_deal`.

## Monitoring layer (migration 009)

- **E. Needs-attention screen** (admin/manager home widget + full page): list from `get_attention_items()` grouped by kind, high severity first, link each row to the lead/meeting/deal. Telesales and sales see the same widget (RLS limits it to their own items).
- **F. Performance page**: `get_funnel_stats` with date range, per-employee funnel table and conversion %, show the 4 timing columns; managers see their team only.
- **G. Targets + leaderboard**: admin screen to set `user_targets` per employee per month; progress bars from `get_target_progress`; leaderboard from `get_leaderboard`.
- **H. Loss reasons**: when a sales marks a meeting as lost use a modal with reasons from `loss_reasons` and call `mark_meeting_lost`; telesales sets `leads.loss_reason` when choosing Not Interested / Did Not Subscribe; admin report page from `get_loss_report`.
- **I. Distribution tools** (Leads page, admin/manager): "Distribute evenly" dialog (choose telesales users + optional max open leads per user) → `distribute_leads_evenly`, show leftovers; "Move all leads from user X to Y / unassign" → `reassign_user_leads`.
- **J. Source quality**: table from `get_source_performance` (leads, contacted, interested, deals, revenue, conversion %).
- **K. Audit log viewer** (admin): read `audit_log` newest first with filters by table and user.
- **L. Daily summary** card on admin home from `get_daily_summary`.
- **M. Leads page performance**: remove the three parallel exact counts; use `count: 'estimated'` when no filter is active; keep `.range()` paging.

## Cleanup

- **N.** Remove remaining `mockData` imports (move types to `src/data/crmTypes.ts`), delete `src/data/mockData.*`, remove any leftover forward-to-sales logic that reassigns leads to sales.

### Prompt template

> Read AGENTS.md and docs/NEXT_TASKS.md. Do **Task X** only. Read the SQL in supabase/migrations first and use exact names. No mock data, no hardcoded rates or percentages. Run pnpm build and pnpm exec tsc --noEmit, then list the changed files and how to test each role.

=== END ===
