import { supabase } from "../supabaseClient"

import { MeetingOutcome } from "./crmTypes"

export interface Meeting {
  id: string

  leadId: string

  leadName: string

  leadPhone: string

  telesalesNotes: string

  assignedSalesId: string

  assignedSalesName: string

  proposedDate: string

  outcome: MeetingOutcome

  bookedById: string

  bookedByName: string

  createdAt: string
}

export interface MeetingRow {
  id: string

  lead_id: string

  booked_by: string

  assigned_sales_id: string

  proposed_date: string

  telesales_notes: string | null

  outcome: MeetingOutcome

  created_at: string
}

export interface MeetingRequest {
  id: string

  leadId: string

  leadName: string

  leadPhone: string

  requestedBy: string

  requestedByName: string

  assignedSalesId: string

  assignedSalesName: string

  notes: string

  preferredDate: string | null

  createdAt: string
}

export interface MeetingRequestRow {
  id: string

  lead_id: string

  requested_by: string

  assigned_sales_id: string

  notes: string | null

  preferred_date: string | null

  created_at: string
}

interface LeadSummaryRow {
  id: string

  name: string

  phone: string | null
}

interface UserSummaryRow {
  id: string

  full_name: string
}

type SummaryResult = {
  leads: Map<string, LeadSummaryRow>
  users: Map<string, string>
  error: null
} | { error: string }

export type LoadResult<T> = { data: T; count: number; error: null } | {
  data: null
  count: 0
  error: string
}

export function mapMeeting(
  row: MeetingRow,

  leads: Map<string, LeadSummaryRow>,

  users: Map<string, string>,
): Meeting {
  const lead = leads.get(row.lead_id)

  return {
    id: row.id,

    leadId: row.lead_id,

    leadName: lead?.name ?? "Unknown lead",

    leadPhone: lead?.phone ?? "",

    telesalesNotes: row.telesales_notes ?? "",

    assignedSalesId: row.assigned_sales_id,

    assignedSalesName: users.get(row.assigned_sales_id) ?? "",

    proposedDate: row.proposed_date,

    outcome: row.outcome,

    bookedById: row.booked_by,

    bookedByName: users.get(row.booked_by) ?? "",

    createdAt: row.created_at,
  }
}

export function mapMeetingRequest(
  row: MeetingRequestRow,

  leads: Map<string, LeadSummaryRow>,

  users: Map<string, string>,
): MeetingRequest {
  const lead = leads.get(row.lead_id)

  return {
    id: row.id,

    leadId: row.lead_id,

    leadName: lead?.name ?? "Unknown lead",

    leadPhone: lead?.phone ?? "",

    requestedBy: row.requested_by,

    requestedByName: users.get(row.requested_by) ?? "",

    assignedSalesId: row.assigned_sales_id,

    assignedSalesName: users.get(row.assigned_sales_id) ?? "",

    notes: row.notes ?? "",

    preferredDate: row.preferred_date,

    createdAt: row.created_at,
  }
}

async function loadSummaries(
  leadIds: string[],
  userIds: string[],
): Promise<SummaryResult> {
  const [leadResult, userResult] = await Promise.all([
    leadIds.length
      ? supabase.from("leads").select("id, name, phone").in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),

    userIds.length
      ? supabase.from("users").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (leadResult.error) return { error: leadResult.error.message }

  if (userResult.error) return { error: userResult.error.message }

  const leads = new Map(
    (leadResult.data ?? []).map((row) => [row.id, row as LeadSummaryRow]),
  )

  const users = new Map(
    (userResult.data ?? []).map((row) => [
      row.id,
      (row as UserSummaryRow).full_name,
    ]),
  )

  return { leads, users, error: null }
}

export async function loadMeetingsPage(options: {
  page: number

  pageSize: number

  assignedSalesId?: string

  /** Meetings of any of these sales users (e.g. a manager's team). */
  assignedSalesIds?: string[]

  outcome?: MeetingOutcome

  proposedAfter?: string
}): Promise<LoadResult<Meeting[]>> {
  let query = supabase

    .from("meetings")

    .select(
      "id, lead_id, booked_by, assigned_sales_id, proposed_date, telesales_notes, outcome, created_at",
      { count: "exact" },
    )

    .order("proposed_date", { ascending: options.outcome === "Scheduled" })

  if (options.assignedSalesId)
    query = query.eq("assigned_sales_id", options.assignedSalesId)

  if (options.assignedSalesIds)
    query = query.in("assigned_sales_id", options.assignedSalesIds)

  if (options.outcome) query = query.eq("outcome", options.outcome)

  if (options.proposedAfter)
    query = query.gte("proposed_date", options.proposedAfter)

  const from = options.page * options.pageSize

  const { data, error, count } = await query.range(
    from,
    from + options.pageSize - 1,
  )

  if (error) return { data: null, count: 0, error: error.message }

  const rows = (data ?? []) as MeetingRow[]

  const summaries = await loadSummaries(
    [...new Set(rows.map((row) => row.lead_id))],

    [...new Set(rows.flatMap((row) => [row.booked_by, row.assigned_sales_id]))],
  )

  if (!("leads" in summaries))
    return { data: null, count: 0, error: summaries.error }

  return {
    data: rows.map((row) => mapMeeting(row, summaries.leads, summaries.users)),
    count: count ?? 0,
    error: null,
  }
}

export async function loadMeetingRequestsPage(options: {
  page: number

  pageSize: number

  assignedSalesId: string
}): Promise<LoadResult<MeetingRequest[]>> {
  const from = options.page * options.pageSize

  const { data, error, count } = await supabase

    .from("meeting_requests")

    .select(
      "id, lead_id, requested_by, assigned_sales_id, notes, preferred_date, created_at",
      { count: "exact" },
    )

    .eq("assigned_sales_id", options.assignedSalesId)

    .eq("status", "pending")

    .order("created_at", { ascending: false })

    .range(from, from + options.pageSize - 1)

  if (error) return { data: null, count: 0, error: error.message }

  const rows = (data ?? []) as MeetingRequestRow[]

  const summaries = await loadSummaries(
    [...new Set(rows.map((row) => row.lead_id))],

    [
      ...new Set(
        rows.flatMap((row) => [row.requested_by, row.assigned_sales_id]),
      ),
    ],
  )

  if (!("leads" in summaries))
    return { data: null, count: 0, error: summaries.error }

  return {
    data: rows.map((row) =>
      mapMeetingRequest(row, summaries.leads, summaries.users),
    ),
    count: count ?? 0,
    error: null,
  }
}

export async function loadManageableMeetingRequestsPage(options: {
  page: number;
  pageSize: number;
}): Promise<LoadResult<MeetingRequest[]>> {
  const from = options.page * options.pageSize;
  const { data, error, count } = await supabase
    .from("meeting_requests")
    .select(
      "id, lead_id, requested_by, assigned_sales_id, notes, preferred_date, created_at",
      { count: "exact" },
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .range(from, from + options.pageSize - 1);

  if (error) return { data: null, count: 0, error: error.message };

  const rows = (data ?? []) as MeetingRequestRow[];
  const summaries = await loadSummaries(
    [...new Set(rows.map((row) => row.lead_id))],
    [
      ...new Set(
        rows.flatMap((row) => [row.requested_by, row.assigned_sales_id]),
      ),
    ],
  );
  if (!("leads" in summaries))
    return { data: null, count: 0, error: summaries.error };

  return {
    data: rows.map((row) =>
      mapMeetingRequest(row, summaries.leads, summaries.users),
    ),
    count: count ?? 0,
    error: null,
  };
}
