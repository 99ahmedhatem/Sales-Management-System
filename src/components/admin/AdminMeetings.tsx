import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import { loadMeetingsPage, Meeting } from "../../data/meetings"

import { MeetingOutcome } from "../../data/crmTypes"

import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"
import MeetingRequestsManagement from "../shared/MeetingRequestsManagement"

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
  const [meetings, setMeetings] = useState<Meeting[]>([])

  const [detail, setDetail] = useState<Meeting | null>(null)

  const [filter, setFilter] = useState<MeetingOutcome | "">("")

  const [page, setPage] = useState(0)

  const [total, setTotal] = useState(0)

  const [scheduledCount, setScheduledCount] = useState(0)

  const [wonCount, setWonCount] = useState(0)

  const [lostCount, setLostCount] = useState(0)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")

  const [refreshVersion, setRefreshVersion] = useState(0)

  async function loadMeetings() {
    setLoading(true)

    setError("")

    const [pageResult, scheduledResult, wonResult, lostResult] =
      await Promise.all([
        loadMeetingsPage({
          page,
          pageSize: PAGE_SIZE,
          outcome: filter || undefined,
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
      ])

    const firstError =
      pageResult.error ??
      scheduledResult.error?.message ??
      wonResult.error?.message ??
      lostResult.error?.message

    if (
      pageResult.error ||
      scheduledResult.error ||
      wonResult.error ||
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

    setLoading(false)
  }

  useEffect(() => {
    loadMeetings()
  }, [page, filter, refreshVersion])

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
      <div>
        <h1 className="text-white text-2xl font-bold">Meetings</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">
          {scheduledCount} upcoming · {wonCount} won · {lostCount} lost
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Scheduled", value: scheduledCount, color: "#dfff03" },

          { label: "Won", value: wonCount, color: "#64dc78" },

          { label: "Lost", value: lostCount, color: "#ff6464" },

          { label: "Total", value: total, color: "#6495ed" },
        ].map((stat) => (
          <Card key={stat.label} className="p-4 text-center">
            <div
              className="text-2xl font-bold font-mono"
              style={{ color: stat.color }}
            >
              {stat.value}
            </div>
            <div className="mt-1 text-xs text-[#6b6b6b]">{stat.label}</div>
          </Card>
        ))}
      </div>

      <MeetingRequestsManagement role="admin" userId={userId} />

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
            Loading meetings...
          </div>
        ) : meetings.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]">
            No meetings found.
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
                  <span className="font-medium text-white">
                    {meeting.leadName}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-xs">{meeting.leadPhone}</span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Avatar name={meeting.assignedSalesName} size="sm" />
                    <span className="text-xs text-[#a0a0a0]">
                      {meeting.assignedSalesName || "Sales"}
                    </span>
                  </div>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-[#dfff03]">
                    {new Date(meeting.proposedDate).toLocaleString()}
                  </span>
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
                        {option.label}
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
                ["Client", detail.leadName],

                ["Phone", detail.leadPhone],

                ["Sales Agent", detail.assignedSalesName || "Sales"],

                ["Date & Time", new Date(detail.proposedDate).toLocaleString()],

                ["Booked By", detail.bookedByName || "Telesales"],

                ["Booked", new Date(detail.createdAt).toLocaleDateString()],
              ].map(([label, value]) => (
                <div key={label} className="rounded bg-[#1a1a1a] p-3">
                  <div className="mb-1 text-xs text-[#6b6b6b]">{label}</div>
                  <div className="text-sm font-medium text-white">{value}</div>
                </div>
              ))}
            </div>
            <div className="rounded bg-[#1a1a1a] p-3">
              <div className="mb-1 text-xs text-[#6b6b6b]">Telesales Notes</div>
              <div className="text-sm text-[#d0d0d0]">
                {detail.telesalesNotes || "—"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#6b6b6b]">Current Outcome:</span>
              <StatusBadge status={detail.outcome} />
            </div>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
