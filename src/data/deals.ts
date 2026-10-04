import { supabase } from "../supabaseClient"

export type DealStatus =
  | "draft"
  | "contract_uploaded"
  | "pending_approval"
  | "approved"
  | "active"
  | "cancelled"

export interface Deal {
  id: string
  leadId: string
  commissionPercent: number | null
  commissionSar: number | null
  leadName: string
  leadPhone: string
  salesUserId: string | null
  salesName: string
  telesalesUserId: string
  telesalesName: string
  closedByUserId: string
  packageId: string
  packageName: string
  packageDurationMonths: number
  listPriceSar: number
  minPriceSar: number
  priceSar: number
  belowMinPrice: boolean
  startDate: string
  endDate: string
  notes: string
  recordingPath: string | null
  contractPath: string | null
  approvalOverrideReason: string | null
  status: DealStatus
  createdAt: string
}

export interface DealRow {
  id: string
  lead_id: string
  commission_percent: number | string | null
  commission_sar: number | string | null
  sales_user_id: string | null
  telesales_user_id: string
  closed_by_user_id: string
  package_id: string
  package_name: string
  package_duration_months: number
  list_price_sar: number | string
  min_price_sar: number | string
  price_sar: number | string
  below_min_price: boolean
  start_date: string
  end_date: string
  notes: string | null
  recording_path: string | null
  contract_path: string | null
  approval_override_reason: string | null
  status: DealStatus
  created_at: string
}

export interface DealSummaryMaps {
  leads: Map<string, { name: string; phone: string | null }>
  users: Map<string, string>
}

export function mapDeal(row: DealRow, summaries: DealSummaryMaps): Deal {
  const lead = summaries.leads.get(row.lead_id)
  return {
    id: row.id,
    leadId: row.lead_id,
    leadName: lead?.name ?? "Unknown lead",
    leadPhone: lead?.phone ?? "",
    salesUserId: row.sales_user_id,
    salesName: row.sales_user_id
      ? (summaries.users.get(row.sales_user_id) ?? "")
      : "",
    telesalesUserId: row.telesales_user_id,
    telesalesName: summaries.users.get(row.telesales_user_id) ?? "",
    closedByUserId: row.closed_by_user_id,
    packageId: row.package_id,
    packageName: row.package_name,
    packageDurationMonths: row.package_duration_months,
    listPriceSar: Number(row.list_price_sar),
    minPriceSar: Number(row.min_price_sar),
    priceSar: Number(row.price_sar),
    belowMinPrice: row.below_min_price,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes ?? "",
    recordingPath: row.recording_path,
    contractPath: row.contract_path,
    approvalOverrideReason: row.approval_override_reason,
    status: row.status,
    createdAt: row.created_at,
    commissionPercent: row.commission_percent === null ? null : Number(row.commission_percent),
    commissionSar: row.commission_sar === null ? null : Number(row.commission_sar),
  }
}

export async function loadDealsPage(page: number, pageSize: number) {
  const from = page * pageSize
  const { data, error, count } = await supabase
    .from("deals")
    .select(
      "id, lead_id, sales_user_id, telesales_user_id, closed_by_user_id, package_id, package_name, package_duration_months, list_price_sar, min_price_sar, price_sar, below_min_price, start_date, end_date, notes, recording_path, contract_path, approval_override_reason, status, created_at, commission_percent, commission_sar",
      { count: "estimated" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) return { data: null, count: 0, error: error.message }
  const rows = (data ?? []) as DealRow[]
  const leadIds = [...new Set(rows.map((row) => row.lead_id))]
  const userIds = [
    ...new Set(
      rows.flatMap((row) =>
        [row.sales_user_id, row.telesales_user_id].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ),
  ]
  const [leadResult, userResult] = await Promise.all([
    leadIds.length
      ? supabase.from("leads").select("id, name, phone").in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("users").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (leadResult.error) return { data: null, count: 0, error: leadResult.error.message }
  if (userResult.error) return { data: null, count: 0, error: userResult.error.message }

  const summaries: DealSummaryMaps = {
    leads: new Map(
      (leadResult.data ?? []).map((lead) => [
        lead.id,
        { name: lead.name, phone: lead.phone },
      ]),
    ),
    users: new Map(
      (userResult.data ?? []).map((user) => [user.id, user.full_name]),
    ),
  }
  return {
    data: rows.map((row) => mapDeal(row, summaries)),
    count: count ?? 0,
    error: null,
  }
}
