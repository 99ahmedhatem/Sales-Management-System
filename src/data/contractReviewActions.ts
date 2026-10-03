import { supabase } from "../supabaseClient"
import { ContractReviewStatus } from "./contractReviews"

const REVIEW_STATUSES = new Set<ContractReviewStatus>([
  "queued",
  "processing",
  "passed",
  "needs_attention",
  "failed",
])

function isContractReviewStatus(value: unknown): value is ContractReviewStatus {
  return typeof value === "string" && REVIEW_STATUSES.has(value as ContractReviewStatus)
}

export async function invokeContractReview(reviewId: string) {
  const { data, error } = await supabase.functions.invoke("review-contract", {
    body: { review_id: reviewId },
  })
  if (error) return { error: error.message, status: null }
  const status =
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    isContractReviewStatus(data.status)
      ? data.status
      : null
  return { error: null, status }
}

export async function requestContractReview(dealId: string) {
  const { data: reviewId, error } = await supabase.rpc(
    "request_contract_review",
    { target_deal_id: dealId },
  )
  if (error || typeof reviewId !== "string") {
    return {
      error: error?.message ?? "Could not create a contract review request.",
      status: null,
    }
  }
  return invokeContractReview(reviewId)
}
