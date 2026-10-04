import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import { Card, KpiCard } from "../ui"

import { useI18n } from "../../i18n/I18nProvider"

/** Shape returned by get_reports_summary() (020). All counts are computed in the database. */
interface ReportsSummary {
  leads: {
    total: number
    assigned: number
    contacted: number
    interested: number
    converted: number
  }

  meetings: { won: number; lost: number }

  sources: { source: string; count: number; converted: number }[]

  telesales: {
    user_id: string
    full_name: string
    total: number
    converted: number
    calls: number
  }[]

  sales: {
    user_id: string
    full_name: string
    total: number
    won: number
    lost: number
  }[]
}

const EMPTY_SUMMARY: ReportsSummary = {
  leads: { total: 0, assigned: 0, contacted: 0, interested: 0, converted: 0 },
  meetings: { won: 0, lost: 0 },
  sources: [],
  telesales: [],
  sales: [],
}

const rate = (part: number, whole: number, empty: string) =>
  whole > 0 ? ((part / whole) * 100).toFixed(1) : empty

export default function AdminReports() {
  const { t } = useI18n()

  const [summary, setSummary] = useState(EMPTY_SUMMARY)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function loadReport() {
      setLoading(true)

      setError("")

      const { data, error: rpcError } = await supabase.rpc("get_reports_summary")

      if (!active) return

      if (rpcError) {
        setError(rpcError.message)

        setSummary(EMPTY_SUMMARY)
      } else {
        setSummary({ ...EMPTY_SUMMARY, ...(data as ReportsSummary | null) })
      }

      setLoading(false)
    }

    loadReport()

    return () => {
      active = false
    }
  }, [])

  const {
    total: totalLeads,
    assigned: assignedLeads,
    contacted: contactedLeads,
    interested: interestedLeads,
    converted: convertedLeads,
  } = summary.leads

  const conversionRate = rate(convertedLeads, totalLeads, "0.0")

  const { won: wonDeals, lost: lostDeals } = summary.meetings

  const agentStats = summary.telesales.map((row) => ({
    agent: { id: row.user_id, fullName: row.full_name },
    total: row.total,
    converted: row.converted,
    callsMade: row.calls,
    convRate: rate(row.converted, row.total, "0"),
  }))

  const salesStats = summary.sales.map((row) => ({
    agent: { id: row.user_id, fullName: row.full_name },
    total: row.total,
    won: row.won,
    lost: row.lost,
    winRate: rate(row.won, row.total, "0"),
  }))

  const sourceData = summary.sources

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
