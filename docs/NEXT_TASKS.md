# Next Tasks (frontend for the money layer + cleanup)

Prerequisite (done by the user in Supabase): `supabase-FIX-ALL.sql` ran successfully, an exchange rate row exists, secrets + `review-contract` Edge Function deployed.
Do **one task per branch**. Use only names from `supabase/migrations/008_money_commissions_payroll.sql`. Test as every role.

## Task A — Commission settings in Users

`AdminUsers.tsx`: per employee form → upsert `user_commission_rates` (`closer_percent`, `lead_percent`, `manager_percent`, `base_salary`, `base_currency`). When a manager is picked for a sales/telesales, show "Manager % on this employee". Admin-only. Add a settings field for `app_settings.commission_basis`.

## Task B — Payments on the deal page (`ContractsModule.tsx`)

Only when `status` is `approved`/`active`: list payments, "Add payment" (amount, SAR/EGP, method, reference, receipt upload to `receipts/<deal_id>/…`) → `record_payment`. Show `deal_balances` (paid / pending / remaining). Admin: "Pending payments" screen → `confirm_payment`.

## Task C — Revenue page (admin)

`get_month_revenue(month)`: confirmed SAR, confirmed EGP, pending, new deals; last 12 months from `monthly_revenue`; per employee from `monthly_revenue_by_sales`; add-exchange-rate form (insert into `exchange_rates`); Excel export.

## Task D — Payroll page

`get_payroll(month)` table (admin: all, manager: self+team, others: self) in SAR and EGP + drill-down with `get_commission_lines`. "My earnings" card on sales/telesales/manager dashboards. Admin: per-deal override via `set_deal_commission`, and `cancel_deal`.

## Task E — Cleanup

Remove remaining `mockData` imports (types can move to `src/data/crmTypes.ts`), delete `src/data/mockData.*`, remove the "Converted" forward-to-sales logic left in `TelesalesDashboard.tsx` if it still reassigns leads, add `upcoming_renewals` card.

### Prompt

> Read `AGENTS.md`, `docs/PRODUCT_SPEC.md`, `docs/NEXT_TASKS.md`. Do **Task X** only. Read the SQL in `supabase/migrations` first and use exact names. RPCs only for protected tables. No mock/AED/hardcoded rates. Run `pnpm build` and `pnpm exec tsc --noEmit`, then list changed files and how to test each role.
