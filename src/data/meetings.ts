import { supabase } from "../supabaseClient"
import { participantFilter } from "../lib/participantFilter"

import { MeetingOutcome } from "./crmTypes"

export interface Meeting {
  id: string

  leadId: string

  leadName: string

  leadPhone: string

  clientCode: string

  leadWebsite: string

  telesalesNotes: string

  assignedSalesId: string

  assignedSalesName: string

  proposedDate: string

  outcome: MeetingOutcome

  bookedById: string

  bookedByName: string

  createdAt: string

  /** Host marked the meeting as attended (mark_meeting_attended). */
  attendedAt: string | null

  attendedBy: string | null

  /** Google Meet / Zoom link (set_meeting_link) and when it was sent on WhatsApp. */
  meetingLink: string

  linkSentAt: string | null
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

  /** Snapshot of the lead (056) — readable even when RLS hides the lead from sales. */
  lead_name: string | null

  lead_phone: string | null

  client_code: string | null

  lead_website: string | null

  attended_at: string | null

  attended_by: string | null

  meeting_link: string | null

  link_sent_at: string | null
}

export interface MeetingRequest {
  id: string

  leadId: string

  leadName: string

  leadPhone: string

  clientCode: string

  leadWebsite: string

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

  lead_name: string | null

  lead_phone: string | null

  client_code: string | null

  lead_website: string | null
}

interface UserSummaryRow {
  id: string

  full_name: string
}

type SummaryResult = {
  users: Map<string, string>
  error: null
} | { error: string }

export type LoadResult<T> = { data: T; count: number; error: null } | {
  data: null
  count: 0
  error: string
}

type LeadSnapshot = Pick<
  MeetingRow,
  "lead_name" | "lead_phone" | "client_code" | "lead_website"
> & { notes?: string | null }

const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|sa|store|shop|co|io|me|online|site|app|ae|eg)(?:\/[^\s]*)?(?=[\s,.]|$)/i

/** Name, phone, code and website read from the snapshot on the meeting row, never from a leads join. */
function snapshotFields(row: LeadSnapshot) {
  const phone = row.lead_phone?.trim() ?? ""
  const code = row.client_code?.trim() ?? ""
  return {
    leadName: row.lead_name?.trim() || phone || code || "Unknown lead",
    leadPhone: phone,
    clientCode: code,
    leadWebsite:
      row.lead_website?.trim() || row.notes?.match(URL_IN_TEXT)?.[0] || "",
  }
}

export function mapMeeting(
  row: MeetingRow,

  users: Map<string, string>,
): Meeting {
  return {
    id: row.id,

    leadId: row.lead_id,

    ...snapshotFields({ ...row, notes: row.telesales_notes }),

    telesalesNotes: row.telesales_notes ?? "",

    assignedSalesId: row.assigned_sales_id,

    assignedSalesName: users.get(row.assigned_sales_id) ?? "",

    proposedDate: row.proposed_date,

    outcome: row.outcome,

    bookedById: row.booked_by,

    bookedByName: users.get(row.booked_by) ?? "",

    createdAt: row.created_at,

    attendedAt: row.attended_at,

    attendedBy: row.attended_by,

    meetingLink: row.meeting_link ?? "",

    linkSentAt: row.link_sent_at,
  }
}

export function mapMeetingRequest(
  row: MeetingRequestRow,

  users: Map<string, string>,
): MeetingRequest {
  return {
    id: row.id,

    leadId: row.lead_id,

    ...snapshotFields(row),

    requestedBy: row.requested_by,

    requestedByName: users.get(row.requested_by) ?? "",

    assignedSalesId: row.assigned_sales_id,

    assignedSalesName: users.get(row.assigned_sales_id) ?? "",

    notes: row.notes ?? "",

    preferredDate: row.preferred_date,

    createdAt: row.created_at,
  }
}

const SNAPSHOT_COLUMNS = "lead_name, lead_phone, client_code, lead_website"

export const MEETING_COLUMNS = `id, lead_id, booked_by, assigned_sales_id, proposed_date, telesales_notes, outcome, created_at, attended_at, attended_by, meeting_link, link_sent_at, ${SNAPSHOT_COLUMNS}`

const REQUEST_COLUMNS = `id, lead_id, requested_by, assigned_sales_id, notes, preferred_date, created_at, ${SNAPSHOT_COLUMNS}`

async function loadSummaries(userIds: string[]): Promise<SummaryResult> {
  const userResult = userIds.length
    ? await supabase.from("users").select("id, full_name").in("id", userIds)
    : { data: [], error: null }

  if (userResult.error) return { error: userResult.error.message }

  const users = new Map(
    (userResult.data ?? []).map((row) => [
      row.id,
      (row as UserSummaryRow).full_name,
    ]),
  )

  return { users, error: null }
}

export async function loadMeetingsPage(options: {
  page: number

  pageSize: number

  assignedSalesId?: string

  /** Meetings of any of these sales users (e.g. a manager's team). */
  assignedSalesIds?: string[]

  outcome?: MeetingOutcome

  proposedAfter?: string

  /** Meetings this user hosts or booked (admin / manager scope filter). */
  participantIds?: string[] | null
}): Promise<LoadResult<Meeting[]>> {
  let query = supabase

    .from("meetings")

    .select(
      MEETING_COLUMNS,
      { count: "exact" },
    )

    .order("proposed_date", { ascending: options.outcome === "Scheduled" })

  if (options.assignedSalesId)
    query = query.eq("assigned_sales_id", options.assignedSalesId)

  if (options.assignedSalesIds)
    query = query.in("assigned_sales_id", options.assignedSalesIds)

  if (options.outcome) query = query.eq("outcome", options.outcome)

  if (options.participantIds?.length)
    query = query.or(participantFilter(["assigned_sales_id", "booked_by"], options.participantIds))

  if (options.proposedAfter)
    query = query.gte("proposed_date", options.proposedAfter)

  const from = options.page * options.pageSize

  const { data, error, count } = await query.range(
    from,
    from + options.pageSize - 1,
  )

  if (error) return { data: null, count: 0, error: error.message }

  const rows = (data ?? []) as MeetingRow[]

  const summaries = await loadSummaries([
    ...new Set(rows.flatMap((row) => [row.booked_by, row.assigned_sales_id])),
  ])

  if (!("users" in summaries))
    return { data: null, count: 0, error: summaries.error }

  return {
    data: rows.map((row) => mapMeeting(row, summaries.users)),
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
      REQUEST_COLUMNS,
      { count: "exact" },
    )

    .eq("assigned_sales_id", options.assignedSalesId)

    .eq("status", "pending")

    .order("created_at", { ascending: false })

    .range(from, from + options.pageSize - 1)

  if (error) return { data: null, count: 0, error: error.message }

  const rows = (data ?? []) as MeetingRequestRow[]

  const summaries = await loadSummaries([
    ...new Set(rows.flatMap((row) => [row.requested_by, row.assigned_sales_id])),
  ])

  if (!("users" in summaries))
    return { data: null, count: 0, error: summaries.error }

  return {
    data: rows.map((row) =>
      mapMeetingRequest(row, summaries.users),
    ),
    count: count ?? 0,
    error: null,
  }
}

export async function loadManageableMeetingRequestsPage(options: {
  page: number;
  pageSize: number;
  /** Requests this user sent or must answer (admin / manager scope filter). */
  participantIds?: string[] | null;
}): Promise<LoadResult<MeetingRequest[]>> {
  const from = options.page * options.pageSize;
  let query = supabase
    .from("meeting_requests")
    .select(
      REQUEST_COLUMNS,
      { count: "exact" },
    )
    .eq("status", "pending");
  if (options.participantIds?.length)
    query = query.or(participantFilter(["requested_by", "assigned_sales_id"], options.participantIds));
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + options.pageSize - 1);

  if (error) return { data: null, count: 0, error: error.message };

  const rows = (data ?? []) as MeetingRequestRow[];
  const summaries = await loadSummaries([
    ...new Set(rows.flatMap((row) => [row.requested_by, row.assigned_sales_id])),
  ]);
  if (!("users" in summaries))
    return { data: null, count: 0, error: summaries.error };

  return {
    data: rows.map((row) =>
      mapMeetingRequest(row, summaries.users),
    ),
    count: count ?? 0,
    error: null,
  };
}
