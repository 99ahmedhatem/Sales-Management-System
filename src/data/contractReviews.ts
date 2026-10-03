export type ContractReviewStatus =
  | "queued"
  | "processing"
  | "passed"
  | "needs_attention"
  | "failed"

export interface ContractMismatch {
  field: string
  expected: unknown
  found: unknown
  severity: "high" | "medium"
  note: string
}

export interface ContractReview {
  id: string
  dealId: string
  status: ContractReviewStatus
  extracted: Record<string, unknown>
  mismatches: ContractMismatch[]
  summary: string
  error: string
  model: string
  createdAt: string
  completedAt: string | null
}

export interface ContractReviewRow {
  id: string
  deal_id: string
  status: ContractReviewStatus
  extracted: unknown
  mismatches: unknown
  summary: string | null
  error: string | null
  model: string | null
  created_at: string
  completed_at: string | null
}

export function mapContractReview(row: ContractReviewRow): ContractReview {
  const extracted =
    typeof row.extracted === "object" && row.extracted !== null
      ? (row.extracted as Record<string, unknown>)
      : {}
  const mismatches = Array.isArray(row.mismatches)
    ? row.mismatches.filter(
        (item): item is ContractMismatch =>
          typeof item === "object" &&
          item !== null &&
          "field" in item &&
          typeof item.field === "string" &&
          "expected" in item &&
          "found" in item &&
          "severity" in item &&
          (item.severity === "high" || item.severity === "medium") &&
          "note" in item &&
          typeof item.note === "string",
      )
    : []
  return {
    id: row.id,
    dealId: row.deal_id,
    status: row.status,
    extracted,
    mismatches,
    summary: row.summary ?? "",
    error: row.error ?? "",
    model: row.model ?? "",
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}
