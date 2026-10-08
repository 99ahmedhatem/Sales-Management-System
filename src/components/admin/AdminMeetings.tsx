import { AnimatedNumber, TableSkeleton } from "../shared/motion"
import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import { loadMeetingsPage, Meeting } from "../../data/meetings"

import { MeetingOutcome } from "../../data/crmTypes"

import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"
import MeetingRequestsManagement from "../shared/MeetingRequestsManagement"
import { useI18n } from "../../i18n/I18nProvider"
import { dateLocale } from "../../i18n/locale"
import { ClientLink } from "../shared/AppOverlays"
import { ClientCodeBadge, PhoneActions } from "../shared/ClientContact"
import { useScopeFilter } from "../shared/ScopeFilter"
import DealCreateModal from "../shared/DealCreateModal"
import {
  AttendanceControl,
  formatMeetingDate,
  MeetingLinkField,
  MeetingOutcomeButtons,
  MeetingWhatsAppButton,
} from "../shared/MeetingActions"

import {
  Avatar,
  Button,
  Card,
  Modal,
  Pagination,
  Select,
  StatusBadge,
  Table,
  Td,
  Tr,
} from "../ui"

const PAGE_SIZE = 25

const OUTCOME_OPTIONS: { value: MeetingOutcome; label: string }[] = [
  { value: "Scheduled", label: "Scheduled" },

  { value: "Deal Closed – Won", label: "Deal Closed – Won" },

  { value: "Deal Lost", label: "Deal Lost" },

  { value: "Rescheduled", label: "Rescheduled" },

  { value: "No-Show", label: "No-Show" },
]

interface Props {
  userId: string
}

export default function AdminMeetings({ userId }: Props) {
  const { t, lang } = useI18n()
  const locale = dateLocale(lang)

  const [meetings, setMeetings] = useState<Meeting[]>([])

  const [detail, setDetail] = useState<Meeting | null>(null)

  const [filter, setFilter] = useState<MeetingOutcome | "">("")

  const [page, setPage] = useState(0)

  const [total, setTotal] = useState(0)

  const [scheduledCount, setScheduledCount] = useState(0)

  const [wonCount, setWonCount] = useState(0)

  const [lostCount, setLostCount] = useState(0)

  const [attendedCount, setAttendedCount] = useState(0)

  const [missedCount, setMissedCount] = useState(0)

  const [dealLeadId, setDealLeadId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")

  const [refreshVersion, setRefreshVersion] = useState(0)

  const scope = useScopeFilter("admin", userId)

  useEffect(() => setPage(0), [scope.scopeKey])

  /** Optimistic change of one meeting (attendance, link, outcome) in the table and the open details. */
  const patchMeeting = (id: string, patch: Partial<Meeting>) => {
    setMeetings((prev) => prev.map((meeting) => (meeting.id === id ? { ...meeting, ...patch } : meeting)))
    setDetail((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev))
  }

  async function loadMeetings() {
    setLoading(true)

    setError("")

    const now = new Date().toISOString()

    const [pageResult, scheduledResult, wonResult, lostResult, attendedResult, missedResult] =
      await Promise.all([
        loadMeetingsPage({
          page,
          pageSize: PAGE_SIZE,
          outcome: filter || undefined,
          participantIds: scope.userIds,
        }),

        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .eq("outcome", "Scheduled"),

        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .eq("outcome", "Deal Closed – Won"),

        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .eq("outcome", "Deal Lost"),

        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .not("attended_at", "is", null),

        // Time passed and nobody marked attendance
        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .is("attended_at", null)
          .lt("proposed_date", now),
      ])

    const firstError =
      pageResult.error ??
      scheduledResult.error?.message ??
      wonResult.error?.message ??
      attendedResult.error?.message ??
      missedResult.error?.message ??
      lostResult.error?.message

    if (
      pageResult.error ||
      scheduledResult.error ||
      wonResult.error ||
      attendedResult.error ||
      missedResult.error ||
      lostResult.error ||
      pageResult.data === null
    ) {
      setError(firstError ?? "Could not load meetings.")

      setMeetings([])

      setTotal(0)

      setLoading(false)

      return
    }

    setMeetings(pageResult.data)

    setTotal(pageResult.count)

    setScheduledCount(scheduledResult.count ?? 0)

    setWonCount(wonResult.count ?? 0)

    setLostCount(lostResult.count ?? 0)

    setAttendedCount(attendedResult.count ?? 0)

    setMissedCount(missedResult.count ?? 0)

    setLoading(false)
  }

  useEffect(() => {
    loadMeetings()
  }, [page, filter, refreshVersion, scope.scopeKey])

  useRealtimeRefresh(["meetings"], () =>
    setRefreshVersion((version) => version + 1),
  )

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

    setMeetings((previous) =>
      previous.map((meeting) =>
        meeting.id === id ? { ...meeting, outcome } : meeting,
      ),
    )

    setDetail((previous) =>
      previous?.id === id ? { ...previous, outcome } : previous,
    )

    setRefreshVersion((version) => version + 1)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{t("Meetings")}</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">
            {t("{a} upcoming · {b} won · {c} lost", { a: scheduledCount, b: wonCount, c: lostCount })}
          </p>
        </div>
        {scope.element}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-banner"
        >
          {t(error)}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 anim-stagger">
        {[
          { label: "Scheduled", value: scheduledCount, color: "#dfff03" },

          { label: "Won", value: wonCount, color: "#64dc78" },

          { label: "Lost", value: lostCount, color: "#ff6464" },

          { label: "Total", value: total, color: "#6495ed" },

          { label: "Attended meetings", value: attendedCount, color: "#64dc78" },

          { label: "Missed without attendance", value: missedCount, color: "#ffc832" },
        ].map((stat) => (
          <Card key={stat.label} className="p-4 text-center anim-card">
            <div
              className="text-2xl font-bold font-mono"
              style={{ color: stat.color }}
            >
              <AnimatedNumber value={stat.value} />
            </div>
            <div className="mt-1 text-xs text-[#6b6b6b]">{t(stat.label)}</div>
          </Card>
        ))}
      </div>

      <MeetingRequestsManagement role="admin" userId={userId} participantIds={scope.userIds} />

      <div className="flex gap-3">
        <Select
          value={filter}
          onChange={(value) => {
            setFilter(value as MeetingOutcome | '')
            setPage(0)
          }}
          options={[{ value: "", label: "All Outcomes" }, ...OUTCOME_OPTIONS]}
          className="w-48"
        />
      </div>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]">
            <TableSkeleton />
          </div>
        ) : meetings.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]">
            {t(filter ? "No meetings with this outcome. Try another filter." : "No meetings yet — they appear here once a sales rep accepts a meeting request from telesales.")}
          </div>
        ) : (
          <Table
            headers={[
              "Client",
              "Phone",
              "Sales Agent",
              "Date & Time",
              "Telesales Notes",
              "Outcome",
              "",
            ]}
          >
            {meetings.map((meeting) => (
              <Tr key={meeting.id} onClick={() => setDetail(meeting)}>
                <Td>
                  <ClientLink leadId={meeting.leadId} className="font-medium text-white">
                    {meeting.leadName}
                  </ClientLink>
                  <div className="mt-1"><ClientCodeBadge code={meeting.clientCode} /></div>
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <PhoneActions phone={meeting.leadPhone} leadId={meeting.leadId} className="text-xs" />
                    <MeetingWhatsAppButton meeting={meeting} onChange={(patch) => patchMeeting(meeting.id, patch)} />
                  </div>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Avatar name={meeting.assignedSalesName} size="sm" />
                    <span className="text-xs text-[#a0a0a0]">
                      {meeting.assignedSalesName || t("Sales")}
                    </span>
                  </div>
                </Td>
                <Td>
                  <div className="text-xs text-[#dfff03]">
                    {formatMeetingDate(meeting.proposedDate, lang)}
                  </div>
                  <div className="mt-1">
                    <AttendanceControl meeting={meeting} onChange={(patch) => patchMeeting(meeting.id, patch)} />
                  </div>
                </Td>
                <Td>
                  <span className="line-clamp-1 max-w-48 text-xs text-[#6b6b6b]">
                    {meeting.telesalesNotes || "—"}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={meeting.outcome} />
                </Td>
                <Td>
                  <select
                    value={meeting.outcome}
                    onChange={(event) => {
                      void updateOutcome(
                        meeting.id,
                        event.target.value as MeetingOutcome,
                      )
                    }}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1 text-xs text-white focus:border-[#dfff03]/60 focus:outline-none"
                  >
                    {OUTCOME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.label)}
                      </option>
                    ))}
                  </select>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
        />
      </Card>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Meeting Details"
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Client", detail.clientCode ? `${detail.leadName} · ${detail.clientCode}` : detail.leadName],

                ["Phone", detail.leadPhone],

                ["Sales Agent", detail.assignedSalesName || t("Sales")],

                ["Date & Time", formatMeetingDate(detail.proposedDate, lang)],

                ["Booked By", detail.bookedByName || t("Telesales")],

                ["Booked", new Date(detail.createdAt).toLocaleDateString(locale)],
              ].map(([label, value]) => (
                <div key={label} className="rounded bg-[#1a1a1a] p-3">
                  <div className="mb-1 text-xs text-[#6b6b6b]">{t(label)}</div>
                  <div className="text-sm font-medium text-white">{value}</div>
                </div>
              ))}
            </div>
            <div className="rounded bg-[#1a1a1a] p-3">
              <div className="mb-1 text-xs text-[#6b6b6b]">{t("Telesales Notes")}</div>
              <div className="text-sm text-[#d0d0d0]">
                {detail.telesalesNotes || "—"}
              </div>
            </div>
            <div className="space-y-3 rounded bg-[#1a1a1a] p-3">
              <div className="text-xs text-[#6b6b6b]">{t("Meeting link")}</div>
              <div className="flex items-center gap-2">
                <MeetingLinkField meeting={detail} onChange={(patch) => patchMeeting(detail.id, patch)} />
                <MeetingWhatsAppButton meeting={detail} onChange={(patch) => patchMeeting(detail.id, patch)} />
              </div>
              <AttendanceControl meeting={detail} onChange={(patch) => patchMeeting(detail.id, patch)} />
              {detail.attendedAt && (
                <MeetingOutcomeButtons
                  meeting={detail}
                  onChange={(patch) => patchMeeting(detail.id, patch)}
                  onCloseDeal={(meeting) => {
                    setDealLeadId(meeting.leadId)
                    setDetail(null)
                  }}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#6b6b6b]">{t("Current Outcome:")}</span>
              <StatusBadge status={detail.outcome} />
            </div>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              {t("Close")}
            </Button>
          </div>
        )}
      </Modal>
      <DealCreateModal
        open={Boolean(dealLeadId)}
        onClose={() => setDealLeadId(null)}
        onCreated={() => setRefreshVersion((version) => version + 1)}
        initialLeadId={dealLeadId ?? undefined}
        role="admin"
      />
    </div>
  )
}
