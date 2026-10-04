import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import { ClientComment, MeetingOutcome } from "../../data/crmTypes"

import {
  loadMeetingRequestsPage,
  loadMeetingsPage,
  Meeting,
  MeetingRequest,
} from "../../data/meetings"

import { addClientComment, loadClientComments } from "../../data/clientComments"

import {
  Avatar,
  Button,
  Card,
  KpiCard,
  Modal,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  Td,
  Tr,
} from "../ui"

import { WebsiteLink } from "../ui"

import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"

import { useI18n } from "../../i18n/I18nProvider"

import { dateLocale } from "../../i18n/locale"

const PAGE_SIZE = 20

interface Props {
  userId: string
}

const OUTCOME_OPTIONS: { value: MeetingOutcome; label: string }[] = [
  { value: "Deal Lost", label: "Deal Lost" },

  { value: "Rescheduled", label: "Rescheduled" },

  { value: "No-Show", label: "No-Show" },
]

export default function SalesDashboard({ userId }: Props) {
  const { t, lang } = useI18n()

  const locale = dateLocale(lang)

  const [myName, setMyName] = useState("")

  const [meetings, setMeetings] = useState<Meeting[]>([])

  const [requests, setRequests] = useState<MeetingRequest[]>([])

  const [totalMeetings, setTotalMeetings] = useState(0)

  const [totalMeetingRows, setTotalMeetingRows] = useState(0)

  const [totalRequests, setTotalRequests] = useState(0)

  const [scheduledCount, setScheduledCount] = useState(0)

  const [wonCount, setWonCount] = useState(0)

  const [lostCount, setLostCount] = useState(0)

  const [page, setPage] = useState(0)

  const [requestPage, setRequestPage] = useState(0)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")

  const [refreshVersion, setRefreshVersion] = useState(0)

  const [detail, setDetail] = useState<Meeting | null>(null)

  const [tab, setTab] = useState<"requests" | "upcoming" | "all">("requests")

  const [search, setSearch] = useState("")

  const [outcomeFilter, setOutcomeFilter] = useState<MeetingOutcome | "">("")

  const [acceptingRequest, setAcceptingRequest] =
    useState<MeetingRequest | null>(null)

  const [decliningRequest, setDecliningRequest] =
    useState<MeetingRequest | null>(null)

  const [declineReason, setDeclineReason] = useState("")

  const [proposedDate, setProposedDate] = useState("")

  const [savingRequest, setSavingRequest] = useState(false)

  const [commentModal, setCommentModal] = useState<{
    meetingId: string
    leadId: string
    leadName: string
  } | null>(null)

  const [newComment, setNewComment] = useState("")

  const [customerNumber, setCustomerNumber] = useState<number | undefined>()

  const [customerWebsite, setCustomerWebsite] = useState<string | undefined>()

  const [customerQuantity, setCustomerQuantity] = useState(0)

  const [customerPhone, setCustomerPhone] = useState("")

  const [customerPhoneInput, setCustomerPhoneInput] = useState("")

  const [editingCustomerNumber, setEditingCustomerNumber] = useState(false)

  const [customerNumberInput, setCustomerNumberInput] = useState("")

  const [leadComments, setLeadComments] =
    useState<Record<string, ClientComment[]>>({})

  async function loadDashboard() {
    setLoading(true)

    setError("")

    const [
      meetingsResult,
      requestsResult,
      profileResult,
      scheduledResult,
      wonResult,
      lostResult,
      allMeetingsResult,
    ] = await Promise.all([
      loadMeetingsPage({
        page,

        pageSize: PAGE_SIZE,

        assignedSalesId: userId,

        outcome:
          tab === "upcoming"
            ? "Scheduled"
            : tab === "all"
              ? outcomeFilter || undefined
              : undefined,
      }),

      loadMeetingRequestsPage({
        page: requestPage,
        pageSize: PAGE_SIZE,
        assignedSalesId: userId,
      }),

      supabase.from("users").select("full_name").eq("id", userId).maybeSingle(),

      supabase
        .from("meetings")
        .select("id", { count: "estimated", head: true })
        .eq("assigned_sales_id", userId)
        .eq("outcome", "Scheduled"),

      supabase
        .from("meetings")
        .select("id", { count: "estimated", head: true })
        .eq("assigned_sales_id", userId)
        .eq("outcome", "Deal Closed – Won"),

      supabase
        .from("meetings")
        .select("id", { count: "estimated", head: true })
        .eq("assigned_sales_id", userId)
        .eq("outcome", "Deal Lost"),

      supabase
        .from("meetings")
        .select("id", { count: "estimated", head: true })
        .eq("assigned_sales_id", userId),
    ])

    const firstError =
      meetingsResult.error ??
      requestsResult.error ??
      profileResult.error?.message ??
      scheduledResult.error?.message ??
      wonResult.error?.message ??
      lostResult.error?.message ??
      allMeetingsResult.error?.message

    if (
      meetingsResult.error ||
      requestsResult.error ||
      profileResult.error ||
      scheduledResult.error ||
      wonResult.error ||
      lostResult.error ||
      allMeetingsResult.error ||
      meetingsResult.data === null ||
      requestsResult.data === null
    ) {
      setError(firstError ?? "Could not load meetings.")

      setMeetings([])

      setRequests([])

      setLoading(false)

      return
    }

    setMeetings(meetingsResult.data)

    setTotalMeetingRows(meetingsResult.count)

    setTotalMeetings(allMeetingsResult.count ?? 0)

    setRequests(requestsResult.data)

    setTotalRequests(requestsResult.count)

    setMyName(profileResult.data?.full_name ?? "")

    setScheduledCount(scheduledResult.count ?? 0)

    setWonCount(wonResult.count ?? 0)

    setLostCount(lostResult.count ?? 0)

    setLoading(false)
  }

  useEffect(() => {
    loadDashboard()
  }, [page, requestPage, userId, refreshVersion, tab, outcomeFilter])

  useRealtimeRefresh(["meetings", "meeting_requests"], () =>
    setRefreshVersion((version) => version + 1),
  )

  useEffect(() => {
    if (!commentModal) return

    loadClientComments(commentModal.leadId).then(({ data }) => {
      setLeadComments((prev) => ({ ...prev, [commentModal.leadId]: data }))
    })
  }, [commentModal?.leadId])

  useEffect(() => {
    if (!detail) return

    supabase
      .from("leads")
      .select("customer_number, website, quantity, phone")
      .eq("id", detail.leadId)
      .maybeSingle()
      .then(({ data }) => {
        setCustomerNumber(data?.customer_number ?? undefined)

        setCustomerNumberInput(
          data?.customer_number ? String(data.customer_number) : "",
        )

        setCustomerWebsite(data?.website ?? undefined)

        setCustomerQuantity(data?.quantity ?? 0)

        setCustomerPhone(data?.phone ?? "")

        setCustomerPhoneInput(data?.phone ?? "")
      })
  }, [detail?.leadId])

  const saveCustomerNumber = async () => {
    const value = customerNumberInput.trim()

    const number = value ? Number(value) : null

    if (number !== null && (!Number.isSafeInteger(number) || number <= 0))
      return

    const { error } = await supabase.rpc("set_lead_customer_number", {
      target_lead_id: detail?.leadId,
      new_customer_number: number,
    })

    if (!error) {
      setCustomerNumber(number ?? undefined)

      setEditingCustomerNumber(false)
    }
  }

  const saveCustomerPhone = async () => {
    const phone = customerPhoneInput.trim()

    const { error } = await supabase
      .from("leads")
      .update({
        phone: phone || null,
        phone_source: phone ? "manual" : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", detail?.leadId)

    if (!error) setCustomerPhone(phone)
  }

  const updateOutcome = async (id: string, outcome: MeetingOutcome) => {
    setError("")

    const { error: updateError } = await supabase.rpc(
      "update_meeting_outcome",
      {
        target_meeting_id: id,

        new_outcome: outcome,
      },
    )

    if (updateError) {
      setError(updateError.message)

      return
    }

    setMeetings((prev) =>
      prev.map((meeting) =>
        meeting.id === id ? { ...meeting, outcome } : meeting,
      ),
    )

    if (detail?.id === id)
      setDetail((prev) => (prev ? { ...prev, outcome } : null))

    setRefreshVersion((version) => version + 1)
  }

  const acceptRequest = async () => {
    if (!acceptingRequest || !proposedDate || savingRequest) return

    const scheduledAt = new Date(proposedDate)

    if (
      Number.isNaN(scheduledAt.getTime()) ||
      scheduledAt.getTime() <= Date.now()
    ) {
      setError("Choose a meeting time in the future.")

      return
    }

    setSavingRequest(true)

    setError("")

    const { error: requestError } = await supabase.rpc(
      "accept_meeting_request",
      {
        target_request_id: acceptingRequest.id,

        target_proposed_date: scheduledAt.toISOString(),
      },
    )

    if (requestError) {
      setError(requestError.message)

      setSavingRequest(false)

      return
    }

    setAcceptingRequest(null)

    setProposedDate("")

    setSavingRequest(false)

    setRefreshVersion((version) => version + 1)
  }

  const declineRequest = async () => {
    if (!decliningRequest || !declineReason.trim()) return
    setError("")

    const { error: requestError } = await supabase.rpc(
      "decline_meeting_request",
      {
        target_request_id: decliningRequest.id,

        decline_reason_text: declineReason.trim(),
      },
    )

    if (requestError) {
      setError(requestError.message)
    } else {
      setDecliningRequest(null)
      setDeclineReason("")
      setRefreshVersion((version) => version + 1)
    }
  }

  const addComment = async () => {
    if (!commentModal || !newComment.trim()) return

    const { data: comment, error } = await addClientComment({
      leadId: commentModal.leadId,

      authorId: userId,

      authorName: myName || "Sales",

      actorRole: "sales",

      text: newComment.trim(),
    })

    if (error || !comment) {
      window.alert(
        error || t("Could not save the comment. Run supabase-setup.sql first."),
      )

      return
    }

    setLeadComments((prev) => ({
      ...prev,
      [commentModal.leadId]: [...(prev[commentModal.leadId] || []), comment],
    }))

    setNewComment("")
  }

  const displayed = meetings.filter((meeting) => {
    const query = search.toLowerCase()

    return (
      !query ||
      meeting.leadName.toLowerCase().includes(query) ||
      meeting.leadPhone.includes(query)
    )
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-white text-2xl font-bold">{t("My Meetings")}</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">
          {t("Welcome back, {name}", { name: myName || t("Sales") })}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]"
        >
          {t(error)}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Meeting Requests"
          value={totalRequests}
          sub="Waiting for your response"
        />
        <KpiCard
          label="Upcoming"
          value={scheduledCount}
          sub="Scheduled meetings"
        />
        <KpiCard
          label="Deals Won"
          value={wonCount}
          accent
          sub="Closed successfully"
        />
        <KpiCard label="Deals Lost" value={lostCount} sub="Not converted" />
        <KpiCard label="Total" value={totalMeetings} sub="All meetings" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {([
          { key: "requests", label: t("Requests ({n})", { n: totalRequests }) },

          { key: "upcoming", label: t("Upcoming ({n})", { n: scheduledCount }) },

          { key: "all", label: t("All Meetings ({n})", { n: totalMeetings }) },
        ] as const).map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => {
              setTab(tabItem.key)
              setPage(0)
              setRequestPage(0)
            }}
            className={`px-4 py-1.5 text-sm rounded-md transition-all ${
              tab === tabItem.key
                ? "bg-[#dfff03] text-black font-medium"
                : "text-[#6b6b6b] hover:text-white"
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab !== "requests" && (
        <div className="flex gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search client or phone on this page..."
          />
          {tab === "all" && (
            <Select
              value={outcomeFilter}
              onChange={(value) => {
                setOutcomeFilter(value as MeetingOutcome | "")
                setPage(0)
              }}
              options={[
                { value: "", label: "All Outcomes" },
                ...[
                  "Scheduled",
                  ...OUTCOME_OPTIONS.map((option) => option.value),
                ].map((value) => ({ value, label: value })),
              ]}
              className="w-48"
            />
          )}
        </div>
      )}

      {tab === "requests" && (
        <Card>
          {loading ? (
            <div className="p-8 text-center text-sm text-[#6b6b6b]">
              {t("Loading meeting requests...")}
            </div>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#6b6b6b]">
              {t("No pending meeting requests.")}
            </div>
          ) : (
            <div className="divide-y divide-[#1e1e1e]">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium text-white">
                      {request.leadName}
                    </div>
                    <div className="mt-1 font-mono text-xs text-[#a0a0a0]" dir="ltr">
                      {request.leadPhone}
                    </div>
                    <div className="mt-2 text-sm text-[#a0a0a0]">
                      {request.notes || t("No additional notes.")}
                    </div>
                    {request.preferredDate && (
                      <div className="mt-1 text-xs text-[#ffc832]">
                        {t("Preferred:")}{" "}
                        {new Date(request.preferredDate).toLocaleString(locale)}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-[#6b6b6b]">
                      {t("Requested by {name}", { name: request.requestedByName || t("Telesales") })}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setAcceptingRequest(request)
                        setProposedDate("")
                        setError("")
                      }}
                    >
                      {t("Accept & Schedule")}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDecliningRequest(request)
                        setDeclineReason("")
                        setError("")
                      }}
                    >
                      {t("Decline")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Pagination
            page={requestPage}
            pageSize={PAGE_SIZE}
            total={totalRequests}
            onChange={setRequestPage}
          />
        </Card>
      )}

      {/* Meeting cards for upcoming */}
      {tab === "upcoming" && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {displayed.length === 0 && (
            <div className="col-span-2 flex flex-col items-center justify-center py-16 text-[#4a4a4a]">
              <svg
                className="w-12 h-12 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm">{t("No upcoming meetings")}</p>
            </div>
          )}
          {displayed.map((m) => {
            return (
              <div
                key={m.id}
                className="bg-[#161616] border border-[#262626] rounded-lg p-5 cursor-pointer hover:border-[#dfff03]/30 transition-colors"
                onClick={() => setDetail(m)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-semibold text-base">
                      {m.leadName}
                    </h3>
                    <p className="text-[#dfff03] font-mono text-sm mt-0.5" dir="ltr">
                      {m.leadPhone}
                    </p>
                  </div>
                  <StatusBadge status={m.outcome} />
                </div>
                <div className="flex items-center gap-2 text-[#6b6b6b] text-sm mb-3">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="font-mono">{m.proposedDate}</span>
                </div>
                <div className="bg-[#1a1a1a] rounded p-3 mb-4">
                  <div className="text-[#6b6b6b] text-xs mb-1">
                    {t("Telesales Notes")}
                  </div>
                  <div className="text-[#d0d0d0] text-sm leading-relaxed">
                    {m.telesalesNotes}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.bookedByName} size="sm" />
                    <span className="text-[#6b6b6b] text-xs">
                      {t("Booked by {name}", { name: m.bookedByName || t("Telesales") })}
                    </span>
                  </div>
                  <select
                    value={m.outcome}
                    onChange={(e) => {
                      updateOutcome(m.id, e.target.value as MeetingOutcome)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#dfff03]/60"
                  >
                    <option value={m.outcome} disabled>
                      {t(m.outcome)}
                    </option>
                    {OUTCOME_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.label)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === "all" && !loading && (
        <Card>
          <Table
            headers={[
              "Client",
              "Phone",
              "Date & Time",
              "Booked By",
              "Outcome",
              "Update",
            ]}
          >
            {displayed.map((m) => {
              return (
                <Tr key={m.id} onClick={() => setDetail(m)}>
                  <Td>
                    <span className="font-medium text-white">{m.leadName}</span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs" dir="ltr">{m.leadPhone}</span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-[#dfff03]">
                      {m.proposedDate}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={m.bookedByName} size="sm" />
                      <span className="text-[#a0a0a0] text-xs">
                        {m.bookedByName}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={m.outcome} />
                  </Td>
                  <Td>
                    <select
                      value={m.outcome}
                      onChange={(e) => {
                        updateOutcome(m.id, e.target.value as MeetingOutcome)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#dfff03]/60"
                    >
                      <option value={m.outcome} disabled>
                        {t(m.outcome)}
                      </option>
                      {OUTCOME_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {t(o.label)}
                        </option>
                      ))}
                    </select>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        </Card>
      )}

      {(tab === "upcoming" || tab === "all") && !loading && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={totalMeetingRows}
          onChange={setPage}
        />
      )}

      {(tab === "upcoming" || tab === "all") && loading && (
        <div className="py-8 text-center text-sm text-[#6b6b6b]">
          {t("Loading meetings...")}
        </div>
      )}

      <Modal
        open={!!acceptingRequest}
        onClose={() => {
          if (!savingRequest) setAcceptingRequest(null)
        }}
        title={acceptingRequest ? t("Schedule {name}", { name: acceptingRequest.leadName }) : t("Schedule meeting")}
      >
        {acceptingRequest && (
          <div className="space-y-4">
            <div className="text-sm text-[#a0a0a0]">
              {t("Choose a future date and time to accept this request.")}
            </div>
            <label className="block text-xs text-[#a0a0a0]">
              {t("Meeting date and time")}
              <input
                type="datetime-local"
                value={proposedDate}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                onChange={(event) => setProposedDate(event.target.value)}
                className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
              />
            </label>
            <div className="flex gap-2">
              <Button
                disabled={!proposedDate || savingRequest}
                onClick={acceptRequest}
              >
                {savingRequest ? t("Saving...") : t("Accept & Schedule")}
              </Button>
              <Button
                variant="ghost"
                disabled={savingRequest}
                onClick={() => setAcceptingRequest(null)}
              >
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!decliningRequest}
        onClose={() => setDecliningRequest(null)}
        title={decliningRequest ? t("Decline {name}", { name: decliningRequest.leadName }) : t("Decline meeting request")}
      >
        {decliningRequest && (
          <div className="space-y-4">
            <label className="block text-xs text-[#a0a0a0]">
              {t("Reason for declining *")}
              <textarea
                value={declineReason}
                onChange={(event) => setDeclineReason(event.target.value)}
                rows={3}
                maxLength={1000}
                className="mt-1 w-full resize-y rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
              />
            </label>
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={!declineReason.trim()}
                onClick={() => void declineRequest()}
              >
                {t("Decline Request")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDecliningRequest(null)}
              >
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Meeting Details"
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Client", detail.leadName],

                ["Phone", detail.leadPhone],

                ["Scheduled", detail.proposedDate],

                ["Created", detail.createdAt],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{t(k)}</div>
                  <div className="text-white text-sm font-medium">{v}</div>
                </div>
              ))}
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">{t("Customer Number")}</div>
              {editingCustomerNumber ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="number"
                    min="1"
                    value={customerNumberInput}
                    onChange={(e) => setCustomerNumberInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveCustomerNumber()
                      if (e.key === "Escape") setEditingCustomerNumber(false)
                    }}
                    className="flex-1 bg-[#0e0e0e] border border-[#dfff03] rounded px-2 py-1 text-sm text-white"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={saveCustomerNumber}
                  >
                    {t("Save Number")}
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setCustomerNumberInput(
                      customerNumber ? String(customerNumber) : "",
                    )
                    setEditingCustomerNumber(true)
                  }}
                  className="text-[#dfff03] text-sm font-medium cursor-text"
                >
                  {customerNumber ?? t("Add customer number")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">{t("Website")}</div>
                <WebsiteLink
                  url={customerWebsite}
                  className="text-white text-sm font-medium break-all"
                />
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">{t("Phone Number")}</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customerPhoneInput}
                    onChange={(e) => setCustomerPhoneInput(e.target.value)}
                    placeholder={t("Add phone number")}
                    dir="ltr"
                    className="flex-1 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-2 py-1 text-sm text-white"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={saveCustomerPhone}
                  >
                    {t("Save Phone")}
                  </Button>
                </div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">{t("Quantity")}</div>
                <div className="text-white text-sm font-medium">
                  {customerQuantity}
                </div>
              </div>
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">
                {t("Telesales Qualifying Notes")}
              </div>
              <div className="text-[#d0d0d0] text-sm leading-relaxed">
                {detail.telesalesNotes}
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">
                {t("Update Outcome")}
              </label>
              <select
                value={detail.outcome}
                onChange={(e) =>
                  updateOutcome(detail.id, e.target.value as MeetingOutcome)
                }
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
              >
                <option value={detail.outcome} disabled>
                  {t(detail.outcome)}
                </option>
                {OUTCOME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (detail)
                    setCommentModal({
                      meetingId: detail.id,
                      leadId: detail.leadId,
                      leadName: detail.leadName,
                    })
                }}
              >
                💬 {t("Add Comment")}
              </Button>
              <Button variant="ghost" onClick={() => setDetail(null)}>
                {t("Close")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Comment Modal */}
      <Modal
        open={!!commentModal}
        onClose={() => setCommentModal(null)}
        title={t("Comments — {name}", { name: commentModal?.leadName ?? "" })}
      >
        {commentModal && (
          <div className="space-y-4">
            <div className="max-h-40 overflow-y-auto space-y-2">
              {(leadComments[commentModal.leadId] || []).map((c) => (
                <div key={c.id} className="bg-[#1a1a1a] rounded p-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-[#dfff03] text-xs font-medium">
                      {c.authorName}
                    </span>
                    <span className="text-[#4a4a4a] text-xs font-mono">
                      {c.createdAt}
                    </span>
                  </div>
                  <p className="text-[#d0d0d0] text-sm">{c.text}</p>
                </div>
              ))}
              {(leadComments[commentModal.leadId] || []).length === 0 && (
                <p className="text-[#4a4a4a] text-xs">{t("No comments yet.")}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">
                {t("Add Comment")}
              </label>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={3}
                placeholder={t("Update on client status, meeting notes...")}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!newComment.trim()}
                onClick={addComment}
              >
                {t("Post")}
              </Button>
              <Button variant="ghost" onClick={() => setCommentModal(null)}>
                {t("Close")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
