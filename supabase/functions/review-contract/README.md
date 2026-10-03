# Contract review Edge Function

`review-contract` accepts an authenticated `{ "review_id": "<uuid>" }`, checks the review through the caller's RLS policies, then uses the service-role client only inside the Edge Function for storage reads, deal reads, notifications, and review writes. Deal status transitions go through the service-only `complete_contract_review` / `fail_contract_review` RPCs.

## Prerequisites

Apply `007_contract_reviews.sql` after `006_deals.sql` and the migrations that create `leads`, `packages`, `users`, and `my_role()`. It replaces `attach_contract` so the RPC creates a queued review through the private `create_contract_review(deal_id, contract_paths)` helper and returns its UUID. This helper is not executable by browser roles; PostgreSQL function owners can call it from the trusted `attach_contract` RPC. Contract files must be in the private `contracts` bucket, with each path under `<deal_id>/<filename>`.

The implementation reads the deal closing price and dates, package snapshot, lead name/phone/website, and the deal participants to identify relevant sales and manager notification recipients.

## Configure and deploy

Set the required secrets without placing API credentials in client code or repository files:

```sh
supabase secrets set ANTHROPIC_API_KEY=... CLAUDE_MODEL=...
supabase functions deploy review-contract
```

The function also needs Supabase's `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`), and `SUPABASE_SERVICE_ROLE_KEY` function secrets. Anthropic's model identifier is read only from `CLAUDE_MODEL`; consult the [current Claude models overview](https://platform.claude.com/docs/en/models/overview) when configuring it.

The function accepts PDF and image files (JPEG, PNG, GIF, WebP), up to 20 MiB each and 22 MiB combined to stay within Claude's full request-size limit after base64 encoding. Audio/video is not sent to Claude; recordings are outside this review.

## Review lifecycle

An `attach_contract` RPC creates the first queued review and returns its ID. The client then invokes this function with that ID; the function claims it as `processing`. To review the same uploaded files again, call `request_contract_review(deal_id)`, then invoke this function with the returned ID. Re-uploading a changed contract creates a new review record using its new storage path.
Only one queued or processing review per deal is allowed. A review left in progress for more than three minutes is marked failed when a new upload or retry is requested, so an interrupted invocation does not block future reviews indefinitely.

The model extracts contract facts; the Edge Function compares them with database values and persists `passed` or `needs_attention`. Technical failures are persisted as `failed`. Only `passed` advances a deal to `pending_approval`.

`approve_deal` requires the latest review to be `passed`. Only an admin may override that requirement, with a written reason of at least five words recorded on the deal for audit. The Edge Function does not approve deals or provide an override.

Run the pure comparison tests locally with Node.js 24:

```sh
node --test supabase/functions/review-contract/reviewLogic.test.ts
```
