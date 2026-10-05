import { TableSkeleton } from "../shared/motion"
import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import { loadMeetingsPage, Meeting } from "../../data/meetings"

import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"

import { Avatar, Card, KpiCard, StatusBadge } from "../ui"

import { useI18n } from "../../i18n/I18nProvider"

import { dateLocale } from "../../i18n/locale"

interface DashboardCounts {
  totalLeads: number

  assignedLeads: number

  convertedLeads: number

  newLeads: number

  assignedStatusLeads: number

  noAnswerLeads: number

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

  assignedStatusLeads: 0,

  noAnswerLeads: 0,

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
  const { t, lang } = useI18n()

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

      // Lead totals come from exact count RPCs (013, 015); estimates are wrong under RLS.
      const [
        leadCounts,
        statusCounts,
        meetings,
        scheduled,
        won,
        lost,
      ] = await Promise.all([
        supabase.rpc("get_leads_counts"),

        supabase.rpc("get_lead_status_counts"),

        loadMeetingsPage({
          page: 0,
          pageSize: 5,
          outcome: "Scheduled",
          proposedAfter: now,
        }),

        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .eq("outcome", "Scheduled")
          .gte("proposed_date", now),

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
        leadCounts.error?.message ||
        statusCounts.error?.message ||
        meetings.error ||
        scheduled.error?.message ||
        won.error?.message ||
        lost.error?.message

      if (!active) return

      if (
        leadCounts.error ||
        statusCounts.error ||
        meetings.error ||
        scheduled.error ||
        won.error ||
        lost.error ||
        meetings.data === null
      ) {
        setError(firstError ?? "Could not load dashboard data.")

        setCounts(EMPTY_COUNTS)
      } else {
        const totals = (leadCounts.data as { total: number; unassigned: number }[] | null)?.[0]

        const byStatus = new Map(
          ((statusCounts.data ?? []) as { status: string | null; total: number }[]).map(
            (row) => [row.status ?? "", Number(row.total)],
          ),
        )

        const statusCount = (...statuses: string[]) =>
          statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0)

        const totalLeads = Number(totals?.total ?? 0)

        setCounts({
          totalLeads,

          assignedLeads: totalLeads - Number(totals?.unassigned ?? 0),

          convertedLeads: statusCount("Converted"),

          newLeads: statusCount("New"),

          assignedStatusLeads: statusCount("Assigned"),

          noAnswerLeads: statusCount("No Answer"),

          contactedLeads: statusCount("Contacted"),

          interestedLeads: statusCount("Interested"),

          callbackLeads: statusCount("Call Back Later"),

          notInterestedLeads: statusCount("Not Interested"),

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
    { label: "New", count: counts.newLeads, color: "#6495ed" },

    { label: "Assigned", count: counts.assignedStatusLeads, color: "#a78bfa" },

    { label: "Contacted", count: counts.contactedLeads, color: "#64c8ff" },

    { label: "Interested", count: counts.interestedLeads, color: "#64dc78" },

    {
      label: "Callback Pending",
      count: counts.callbackLeads,
      color: "#ffc832",
    },

    { label: "No Answer", count: counts.noAnswerLeads, color: "#969696" },

    {
      label: "Not Interested",
      count: counts.notInterestedLeads,
      color: "#ff6464",
    },

    { label: "Converted", count: counts.convertedLeads, color: "#dfff03" },
  ]

  // Every status not listed above (e.g. Subscribed), so the rows add up to Total Leads.
  const otherLeads =
    counts.totalLeads - statuses.reduce((sum, row) => sum + row.count, 0)

  if (otherLeads > 0) {
    statuses.push({ label: "Other", count: otherLeads, color: "#4a4a4a" })
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t("Overview")}</h1>
        <p className="mt-0.5 text-sm text-[#6b6b6b]">
          {t("Real-time summary of pipeline activity")}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-banner"
        >
          {t(error)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 anim-stagger">
        <KpiCard
          label="Total Leads"
          value={loading ? "—" : counts.totalLeads}
          sub={t("{n} assigned", { n: counts.assignedLeads })}
        />
        <KpiCard
          label="Converted"
          value={loading ? "—" : counts.convertedLeads}
          sub={t("{n}% conversion rate", { n: conversionRate })}
          accent
        />
        <KpiCard
          label="Upcoming Meetings"
          value={loading ? "—" : counts.scheduledMeetings}
          sub={t("{a} won · {b} lost", { a: counts.wonDeals, b: counts.lostDeals })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="col-span-1 p-5">
          <h3 className="mb-4 font-semibold text-white">{t("Lead Status")}</h3>
          {loading ? (
            <div className="text-sm text-[#6b6b6b]"><TableSkeleton /></div>
          ) : (
            statuses.map((row) => (
              <div key={row.label} className="mb-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-[#a0a0a0]">{t(row.label)}</span>
                  <span className="font-medium text-white">{row.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#1e1e1e]">
                  <div
                    className="h-full rounded-full transition-all anim-bar"
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
          <h3 className="mb-4 font-semibold text-white">{t("Upcoming Meetings")}</h3>
          {loading ? (
            <div className="text-sm text-[#6b6b6b]"><TableSkeleton /></div>
          ) : counts.meetings.length === 0 ? (
            <div className="py-6 text-center text-sm text-[#6b6b6b]">
              {t("No upcoming meetings.")}
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
                    <div className="text-xs text-[#6b6b6b]" dir="ltr">
                      {meeting.leadPhone}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="text-xs text-[#dfff03]">
                      {new Date(meeting.proposedDate).toLocaleString(dateLocale(lang))}
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
