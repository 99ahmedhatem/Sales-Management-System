import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import { LeadStatus, User } from "../../data/crmTypes"

import { Card, KpiCard } from "../ui"

import { useI18n } from "../../i18n/I18nProvider"

interface LeadReportRow {
  id: string

  assigned_to: string | null

  status: LeadStatus

  source: string | null
}

interface MeetingReportRow {
  id: string

  assigned_sales_id: string

  outcome: string
}

interface CallReportRow {
  id: string

  actor_id: string
}

interface CallReport {
  id: string

  actorId: string
}

interface ReportData {
  leads: LeadReport[]

  meetings: MeetingReport[]

  calls: CallReport[]

  users: Pick<User, "id" | "fullName" | "role">[]
}

interface LeadReport {
  id: string

  assignedTo: string | null

  status: LeadStatus

  source: string | null
}

interface MeetingReport {
  id: string

  assignedSalesId: string

  outcome: string
}

const EMPTY_REPORT: ReportData = {
  leads: [],
  meetings: [],
  calls: [],
  users: [],
}

const PAGE_SIZE = 1000

function mapLeadReport(row: LeadReportRow): LeadReport {
  return {
    id: row.id,
    assignedTo: row.assigned_to,
    status: row.status,
    source: row.source,
  }
}

function mapMeetingReport(row: MeetingReportRow): MeetingReport {
  return {
    id: row.id,
    assignedSalesId: row.assigned_sales_id,
    outcome: row.outcome,
  }
}

function mapCallReport(row: CallReportRow): CallReport {
  return { id: row.id, actorId: row.actor_id }
}

function mapReportUser(row: {
  id: string
  full_name: string
  role: User["role"]
}): Pick<User, "id" | "fullName" | "role"> {
  return { id: row.id, fullName: row.full_name, role: row.role }
}

async function loadAllPages<T>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(error.message)

    rows.push(...(data ?? []))

    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

export default function AdminReports() {
  const { t } = useI18n()

  const [report, setReport] = useState(EMPTY_REPORT)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function loadReport() {
      setLoading(true)

      setError("")

      try {
        const [leads, meetings, calls, users] = await Promise.all([
          loadAllPages<LeadReportRow>((from, to) =>
            supabase

              .from("leads")

              .select("id, assigned_to, status, source")

              .order("id")

              .range(from, to),
          ),

          loadAllPages<MeetingReportRow>((from, to) =>
            supabase

              .from("meetings")

              .select("id, assigned_sales_id, outcome")

              .order("id")

              .range(from, to),
          ),

          loadAllPages<CallReportRow>((from, to) =>
            supabase

              .from("activity_logs")

              .select("id, actor_id")

              .eq("activity_type", "call")

              .order("id")

              .range(from, to),
          ),

          loadAllPages<{ id: string; full_name: string; role: User["role"] }>(
            (from, to) =>
              supabase

                .from("users")

                .select("id, full_name, role")

                .order("full_name")

                .range(from, to),
          ),
        ])

        if (!active) return

        setReport({
          leads: leads.map(mapLeadReport),

          meetings: meetings.map(mapMeetingReport),

          calls: calls.map(mapCallReport),

          users: users.map(mapReportUser),
        })
      } catch (loadError) {
        if (!active) return

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load reports.",
        )

        setReport(EMPTY_REPORT)
      }

      setLoading(false)
    }

    loadReport()

    return () => {
      active = false
    }
  }, [])

  const totalLeads = report.leads.length

  const convertedLeads = report.leads.filter(
    (lead) => lead.status === "Converted",
  ).length

  const conversionRate =
    totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : "0.0"

  const wonDeals = report.meetings.filter(
    (meeting) => meeting.outcome === "Deal Closed – Won",
  ).length

  const lostDeals = report.meetings.filter(
    (meeting) => meeting.outcome === "Deal Lost",
  ).length

  const telesalesUsers = report.users.filter(
    (user) => user.role === "telesales",
  )

  const salesUsers = report.users.filter((user) => user.role === "sales")

  const agentStats = telesalesUsers.map((agent) => {
    const myLeads = report.leads.filter((lead) => lead.assignedTo === agent.id)

    const converted = myLeads.filter(
      (lead) => lead.status === "Converted",
    ).length

    const callsMade = report.calls.filter(
      (call) => call.actorId === agent.id,
    ).length

    const convRate =
      myLeads.length > 0 ? ((converted / myLeads.length) * 100).toFixed(1) : "0"

    return { agent, total: myLeads.length, converted, callsMade, convRate }
  })

  const salesStats = salesUsers.map((agent) => {
    const myMeetings = report.meetings.filter(
      (meeting) => meeting.assignedSalesId === agent.id,
    )

    const won = myMeetings.filter(
      (meeting) => meeting.outcome === "Deal Closed – Won",
    ).length

    const lost = myMeetings.filter(
      (meeting) => meeting.outcome === "Deal Lost",
    ).length

    const winRate =
      myMeetings.length > 0 ? ((won / myMeetings.length) * 100).toFixed(1) : "0"

    return { agent, total: myMeetings.length, won, lost, winRate }
  })

  const sources = [
    ...new Set(report.leads.map((lead) => lead.source || "Unknown")),
  ]

  const sourceData = sources
    .map((source) => ({
      source,

      count: report.leads.filter(
        (lead) => (lead.source || "Unknown") === source,
      ).length,

      converted: report.leads.filter(
        (lead) =>
          (lead.source || "Unknown") === source && lead.status === "Converted",
      ).length,
    }))
    .sort((a, b) => b.count - a.count)

  const assignedLeads = report.leads.filter((lead) => lead.assignedTo).length

  const contactedLeads = report.leads.filter((lead) =>
    [
      "Contacted",
      "Interested",
      "Not Interested",
      "Converted",
      "Call Back Later",
      "No Answer",
    ].includes(lead.status),
  ).length

  const interestedLeads = report.leads.filter(
    (lead) => lead.status === "Interested",
  ).length

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("Reports & Analytics")}</h1>
          <p className="mt-0.5 text-sm text-[#6b6b6b]">{t("Performance overview")}</p>
        </div>
        <button className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#1e1e1e] px-4 py-2 text-sm text-[#a0a0a0] transition-colors hover:text-white">
          {t("Export CSV")}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]"
        >
          {t(error)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Leads"
          value={loading ? "—" : totalLeads}
          sub="All assigned leads"
        />
        <KpiCard
          label="Conversion Rate"
          value={loading ? "—" : `${conversionRate}%`}
          sub={t("{n} converted", { n: convertedLeads })}
          accent
        />
        <KpiCard
          label="Deals Won"
          value={loading ? "—" : wonDeals}
          sub={t("{n} lost", { n: lostDeals })}
        />
        <KpiCard
          label="Win Rate"
          value={
            loading
              ? "—"
              : `${
                  wonDeals + lostDeals > 0
                    ? ((wonDeals / (wonDeals + lostDeals)) * 100).toFixed(1)
                    : 0
                }%`
          }
          sub="Meetings to close"
        />
      </div>

      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-white">{t("Lead Sources")}</h3>
        {loading ? (
          <div className="text-sm text-[#6b6b6b]">{t("Loading report data...")}</div>
        ) : sourceData.length === 0 ? (
          <div className="text-sm text-[#6b6b6b]">{t("No lead source data.")}</div>
        ) : (
          <div className="space-y-3">
            {sourceData.map((source) => (
              <div key={source.source} className="flex items-center gap-4">
                <div className="w-32 truncate text-sm text-[#a0a0a0]">
                  {t(source.source)}
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#1e1e1e]">
                  <div
                    className="h-full rounded-full bg-[#dfff03]"
                    style={{
                      width: `${
                        totalLeads > 0 ? (source.count / totalLeads) * 100 : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="w-20 text-end">
                  <span className="text-sm font-medium text-white">
                    {source.count}
                  </span>
                  <span className="text-xs text-[#6b6b6b]"> {t("leads")}</span>
                </div>
                <div className="w-16 text-end">
                  <span className="text-sm font-medium text-[#64dc78]">
                    {source.converted}
                  </span>
                  <span className="text-xs text-[#6b6b6b]"> {t("cvt")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-white">
            {t("Telesales Performance")}
          </h3>
          {loading ? (
            <div className="text-sm text-[#6b6b6b]">{t("Loading...")}</div>
          ) : agentStats.length === 0 ? (
            <div className="text-sm text-[#6b6b6b]">
              {t("No telesales users found.")}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 border-b border-[#1e1e1e] pb-2 text-xs font-medium uppercase tracking-wide text-[#6b6b6b]">
                <span className="col-span-2">{t("Agent")}</span>
                <span className="text-end">{t("Calls")}</span>
                <span className="text-end">{t("Conv. Rate")}</span>
              </div>
              {agentStats.map(
                ({ agent, total, converted, callsMade, convRate }) => (
                  <div key={agent.id} className="grid grid-cols-4 items-center">
                    <div className="col-span-2">
                      <div className="text-sm font-medium text-white">
                        {agent.fullName}
                      </div>
                      <div className="text-xs text-[#6b6b6b]">
                        {t("{a} leads · {b} converted", { a: total, b: converted })}
                      </div>
                    </div>
                    <div className="text-end font-mono text-sm text-[#a0a0a0]">
                      {callsMade}
                    </div>
                    <div className="text-end font-mono text-sm font-bold text-[#dfff03]">
                      {convRate}%
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-white">{t("Sales Performance")}</h3>
          {loading ? (
            <div className="text-sm text-[#6b6b6b]">{t("Loading...")}</div>
          ) : salesStats.length === 0 ? (
            <div className="text-sm text-[#6b6b6b]">{t("No sales users found.")}</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 border-b border-[#1e1e1e] pb-2 text-xs font-medium uppercase tracking-wide text-[#6b6b6b]">
                <span className="col-span-2">{t("Agent")}</span>
                <span className="text-end">{t("Meetings")}</span>
                <span className="text-end">{t("Win Rate")}</span>
              </div>
              {salesStats.map(({ agent, total, won, lost, winRate }) => (
                <div key={agent.id} className="grid grid-cols-4 items-center">
                  <div className="col-span-2">
                    <div className="text-sm font-medium text-white">
                      {agent.fullName}
                    </div>
                    <div className="text-xs text-[#6b6b6b]">
                      {t("{a} won · {b} lost", { a: won, b: lost })}
                    </div>
                  </div>
                  <div className="text-end font-mono text-sm text-[#a0a0a0]">
                    {total}
                  </div>
                  <div className="text-end font-mono text-sm font-bold text-[#64dc78]">
                    {winRate}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-5 font-semibold text-white">{t("Pipeline Funnel")}</h3>
        <div className="flex h-32 items-end gap-2">
          {[
            { label: "Total", value: totalLeads, color: "#6495ed" },

            { label: "Assigned", value: assignedLeads, color: "#dfff03" },

            { label: "Contacted", value: contactedLeads, color: "#64c8ff" },

            { label: "Interested", value: interestedLeads, color: "#ffc832" },

            { label: "Converted", value: convertedLeads, color: "#64dc78" },

            { label: "Won Deals", value: wonDeals, color: "#dfff03" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex flex-1 flex-col items-center gap-2"
            >
              <span className="font-mono text-sm font-bold text-white">
                {loading ? "—" : stat.value}
              </span>
              <div
                className="w-full rounded-t opacity-85 transition-all"
                style={{
                  height: `${
                    loading || totalLeads === 0
                      ? 8
                      : Math.max(8, (stat.value / totalLeads) * 100)
                  }px`,
                  background: stat.color,
                }}
              />
              <span className="text-center text-xs leading-tight text-[#6b6b6b]">
                {t(stat.label)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
