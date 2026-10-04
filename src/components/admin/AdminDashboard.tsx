import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import { loadMeetingsPage, Meeting } from "../../data/meetings"

import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"

import { Avatar, Card, KpiCard, StatusBadge } from "../ui"

interface DashboardCounts {
  totalLeads: number

  assignedLeads: number

  convertedLeads: number

  newLeads: number

  contactedLeads: number

  interestedLeads: number

  callbackLeads: number

  notInterestedLeads: number

  meetings: Meeting[]

  scheduledMeetings: number

  wonDeals: number

  lostDeals: number
}

const EMPTY_COUNTS: DashboardCounts = {
  totalLeads: 0,

  assignedLeads: 0,

  convertedLeads: 0,

  newLeads: 0,

  contactedLeads: 0,

  interestedLeads: 0,

  callbackLeads: 0,

  notInterestedLeads: 0,

  meetings: [],

  scheduledMeetings: 0,

  wonDeals: 0,

  lostDeals: 0,
}

export default function AdminDashboard() {
  const [counts, setCounts] = useState(EMPTY_COUNTS)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")

  const [refreshVersion, setRefreshVersion] = useState(0)

  const conversionRate =
    counts.totalLeads > 0
      ? Math.round((counts.convertedLeads / counts.totalLeads) * 100)
      : 0

  useEffect(() => {
    let active = true

    async function loadDashboard() {
      setLoading(true)

      setError("")

      const now = new Date().toISOString()

      const [
        total,
        assigned,
        converted,
        newLeads,
        contacted,
        interested,
        callbacks,
        notInterested,
        meetings,
        scheduled,
        won,
        lost,
      ] = await Promise.all([
        supabase.from("leads").select("id", { count: "estimated", head: true }),

        supabase
          .from("leads")
          .select("id", { count: "estimated", head: true })
          .not("assigned_to", "is", null),

        supabase
          .from("leads")
          .select("id", { count: "estimated", head: true })
          .eq("status", "Converted"),

        supabase
          .from("leads")
          .select("id", { count: "estimated", head: true })
          .in("status", ["New", "Assigned"]),

        supabase
          .from("leads")
          .select("id", { count: "estimated", head: true })
          .eq("status", "Contacted"),

        supabase
          .from("leads")
          .select("id", { count: "estimated", head: true })
          .eq("status", "Interested"),

        supabase
          .from("leads")
          .select("id", { count: "estimated", head: true })
          .eq("status", "Call Back Later"),

        supabase
          .from("leads")
          .select("id", { count: "estimated", head: true })
          .eq("status", "Not Interested"),

        loadMeetingsPage({
          page: 0,
          pageSize: 5,
          outcome: "Scheduled",
          proposedAfter: now,
        }),

        supabase
          .from("meetings")
          .select("id", { count: "estimated", head: true })
          .eq("outcome", "Scheduled")
          .gte("proposed_date", now),

        supabase
          .from("meetings")
          .select("id", { count: "estimated", head: true })
          .eq("outcome", "Deal Closed – Won"),

        supabase
          .from("meetings")
          .select("id", { count: "estimated", head: true })
          .eq("outcome", "Deal Lost"),
      ])

      const firstError =
        total.error?.message ||
        assigned.error?.message ||
        converted.error?.message ||
        newLeads.error?.message ||
        contacted.error?.message ||
        interested.error?.message ||
        callbacks.error?.message ||
        notInterested.error?.message ||
        meetings.error ||
        scheduled.error?.message ||
        won.error?.message ||
        lost.error?.message

      if (!active) return

      if (
        total.error ||
        assigned.error ||
        converted.error ||
        newLeads.error ||
        contacted.error ||
        interested.error ||
        callbacks.error ||
        notInterested.error ||
        meetings.error ||
        scheduled.error ||
        won.error ||
        lost.error ||
        meetings.data === null
      ) {
        setError(firstError ?? "Could not load dashboard data.")

        setCounts(EMPTY_COUNTS)
      } else {
        setCounts({
          totalLeads: total.count ?? 0,

          assignedLeads: assigned.count ?? 0,

          convertedLeads: converted.count ?? 0,

          newLeads: newLeads.count ?? 0,

          contactedLeads: contacted.count ?? 0,

          interestedLeads: interested.count ?? 0,

          callbackLeads: callbacks.count ?? 0,

          notInterestedLeads: notInterested.count ?? 0,

          meetings: meetings.data,

          scheduledMeetings: scheduled.count ?? 0,

          wonDeals: won.count ?? 0,

          lostDeals: lost.count ?? 0,
        })
      }

      setLoading(false)
    }

    loadDashboard()

    return () => {
      active = false
    }
  }, [refreshVersion])

  useRealtimeRefresh(["leads", "meetings"], () =>
    setRefreshVersion((version) => version + 1),
  )

  const statuses = [
    { label: "New / Uncontacted", count: counts.newLeads, color: "#6495ed" },

    { label: "Contacted", count: counts.contactedLeads, color: "#64c8ff" },

    { label: "Interested", count: counts.interestedLeads, color: "#64dc78" },

    {
      label: "Callback Pending",
      count: counts.callbackLeads,
      color: "#ffc832",
    },

    {
      label: "Not Interested",
      count: counts.notInterestedLeads,
      color: "#ff6464",
    },

    { label: "Converted", count: counts.convertedLeads, color: "#dfff03" },
  ]

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="mt-0.5 text-sm text-[#6b6b6b]">
          Real-time summary of pipeline activity
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard
          label="Total Leads"
          value={loading ? "—" : counts.totalLeads}
          sub={`${counts.assignedLeads} assigned`}
        />
        <KpiCard
          label="Converted"
          value={loading ? "—" : counts.convertedLeads}
          sub={`${conversionRate}% conversion rate`}
          accent
        />
        <KpiCard
          label="Upcoming Meetings"
          value={loading ? "—" : counts.scheduledMeetings}
          sub={`${counts.wonDeals} won · ${counts.lostDeals} lost`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="col-span-1 p-5">
          <h3 className="mb-4 font-semibold text-white">Lead Status</h3>
          {loading ? (
            <div className="text-sm text-[#6b6b6b]">Loading...</div>
          ) : (
            statuses.map((row) => (
              <div key={row.label} className="mb-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-[#a0a0a0]">{row.label}</span>
                  <span className="font-medium text-white">{row.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#1e1e1e]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${
                        counts.totalLeads > 0
                          ? Math.max(4, (row.count / counts.totalLeads) * 100)
                          : 0
                      }%`,
                      background: row.color,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </Card>

        <Card className="col-span-1 p-5 lg:col-span-2">
          <h3 className="mb-4 font-semibold text-white">Upcoming Meetings</h3>
          {loading ? (
            <div className="text-sm text-[#6b6b6b]">Loading meetings...</div>
          ) : counts.meetings.length === 0 ? (
            <div className="py-6 text-center text-sm text-[#6b6b6b]">
              No upcoming meetings.
            </div>
          ) : (
            <div className="space-y-2">
              {counts.meetings.map((meeting) => (
                <div
                  key={meeting.id}
                  className="flex items-center gap-3 rounded-lg bg-[#1a1a1a] p-3"
                >
                  <Avatar name={meeting.leadName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">
                      {meeting.leadName}
                    </div>
                    <div className="text-xs text-[#6b6b6b]">
                      {meeting.leadPhone}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[#dfff03]">
                      {new Date(meeting.proposedDate).toLocaleString()}
                    </div>
                    <div className="text-xs text-[#6b6b6b]">
                      {meeting.assignedSalesName}
                    </div>
                  </div>
                  <StatusBadge status={meeting.outcome} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
