import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import {
  CHART_COLORS, ColumnChart, Empty, ErrorNote, Funnel, HBars, Kpi, Legend, Panel, ProgressRow, SimpleTable, nf,
} from './charts';

type Role = 'admin' | 'manager';
type Row = Record<string, any>;
interface Section<T = Row[]> { data: T; error: string | null; loading: boolean }
const blank = <T,>(d: T): Section<T> => ({ data: d, error: null, loading: true });

const pad = (n: number) => String(n).padStart(2, '0');
const monthStart = (ym: string) => `${ym}-01`;
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
};
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
/** Local date (not UTC) so today's summary doesn't show yesterday after midnight in KSA/Egypt */
const today = () => { const d = new Date(); return `${thisMonth()}-${pad(d.getDate())}`; };

const KIND_LABEL: Record<string, string> = {
  lead_not_called: "Lead not called",
  callback_overdue: "Callback overdue",
  request_pending: "Meeting request unanswered",
  meeting_no_outcome: "Meeting without outcome",
  deal_draft_stale: "Stale draft deal",
  deal_approval_stale: "Deal awaiting approval",
  payment_unconfirmed: "Unconfirmed payment",
  renewal_due: "Renewal due soon",
  contract_review_attention: "Contract review needs attention",
};

/** Charts dashboard: reads everything from RPCs/views; RLS decides what each role sees. */
export default function InsightsDashboard({ role }: { role: Role }) {
  const { t, lang, dir } = useI18n();
  const kind = (k: string) => (KIND_LABEL[k] ? t(KIND_LABEL[k]) : k);
  // loss_reasons only stores an Arabic label (label_ar); in English show the code, prettified
  const lossLabel = (r: Row) =>
    (lang === 'ar' ? r.label_ar : null) ?? String(r.code ?? '').replace(/_/g, ' ').replace(/^./, (c: string) => c.toUpperCase());
  const [month, setMonth] = useState(thisMonth());
  const [tableView, setTableView] = useState(false);
  const [rev, setRev] = useState<Section>(blank([]));
  const [month1, setMonth1] = useState<Section<Row | null>>(blank(null));
  const [daily, setDaily] = useState<Section<Row | null>>(blank(null));
  const [funnel, setFunnel] = useState<Section>(blank([]));
  const [targets, setTargets] = useState<Section>(blank([]));
  const [loss, setLoss] = useState<Section>(blank([]));
  const [sources, setSources] = useState<Section>(blank([]));
  const [board, setBoard] = useState<Section>(blank([]));
  const [attention, setAttention] = useState<Section>(blank([]));
  const [payroll, setPayroll] = useState<Section>(blank([]));

  const from = monthStart(month);
  const to = monthEnd(month);

  const load = useCallback(async () => {
    const run = async <T,>(set: (s: Section<T>) => void, fn: () => PromiseLike<{ data: any; error: any }>, map: (d: any) => T) => {
      set({ data: map(null), error: null, loading: true });
      try {
        const { data, error } = await fn();
        if (error) set({ data: map(null), error: error.message, loading: false });
        else set({ data: map(data), error: null, loading: false });
      } catch (e: any) {
        set({ data: map(null), error: e?.message ?? String(e), loading: false });
      }
    };
    const arr = (d: any) => (Array.isArray(d) ? d : []);
    const first = (d: any) => (Array.isArray(d) ? d[0] ?? null : d ?? null);
    const d12 = new Date(); d12.setMonth(d12.getMonth() - 11, 1);
    const since = `${d12.getFullYear()}-${pad(d12.getMonth() + 1)}-01`;

    await Promise.all([
      run(setRev, () => supabase.from('monthly_revenue').select('month, revenue_sar, revenue_egp, payments_count').gte('month', since).order('month'), arr),
      run(setMonth1, () => supabase.rpc('get_month_revenue', { p_month: from }), first),
      run(setDaily, () => supabase.rpc('get_daily_summary', { p_date: today() }), first),
      run(setFunnel, () => supabase.rpc('get_funnel_stats', { p_from: from, p_to: to }), arr),
      run(setTargets, () => supabase.rpc('get_target_progress', { p_month: from }), arr),
      run(setLoss, () => supabase.rpc('get_loss_report', { p_from: from, p_to: to }), arr),
      run(setSources, () => supabase.rpc('get_source_performance', { p_from: from, p_to: to }), arr),
      run(setBoard, () => supabase.rpc('get_leaderboard', { p_month: from }), arr),
      run(setAttention, () => supabase.rpc('get_attention_items'), arr),
      run(setPayroll, () => supabase.rpc('get_payroll', { p_month: from }), arr),
    ]);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  /** Last 12 months, no gaps */
  const months = useMemo(() => {
    const byMonth = new Map<string, Row>();
    rev.data.forEach(r => byMonth.set(String(r.month).slice(0, 7), r));
    const out: { key: string; label: string; sar: number; egp: number }[] = [];
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const r = byMonth.get(key);
      out.push({ key, label: key.slice(2), sar: Number(r?.revenue_sar ?? 0), egp: Number(r?.revenue_egp ?? 0) });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [rev.data]);

  const funnelTotals = useMemo(() => {
    const t = { leads: 0, contacted: 0, interested: 0, requests: 0, meetings: 0, deals: 0 };
    funnel.data.forEach(r => {
      t.leads += Number(r.leads_received ?? 0);
      t.contacted += Number(r.leads_contacted ?? 0);
      t.interested += Number(r.leads_interested ?? 0);
      t.requests += Number(r.meeting_requests ?? 0);
      t.meetings += Number(r.meetings_held ?? 0);
      t.deals += Number(r.deals_count ?? 0);
    });
    return t;
  }, [funnel.data]);

  const attentionGroups = useMemo(() => {
    const g = new Map<string, Row[]>();
    attention.data.forEach(r => { const k = String(r.kind); g.set(k, [...(g.get(k) ?? []), r]); });
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [attention.data]);

  const m = month1.data;
  const highCount = attention.data.filter(r => r.severity === 'high').length;
  const sarTotal12 = months.reduce((s, x) => s + x.sar, 0);

  const Status = ({ s }: { s: Section<any> }) =>
    s.loading ? <div className="text-xs text-[#8a8a8a] py-6 text-center">{t("Loading…")}</div>
      : s.error ? <ErrorNote message={s.error} /> : null;
  const ready = (s: Section<any>) => !s.loading && !s.error;

  return (
    <div className="p-4 md:p-6 space-y-4" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#e5e5e5]">{t("Insights")}</h1>
          <p className="text-xs text-[#8a8a8a]">{role === 'admin' ? t("Whole team") : t("Your team only")} · {t("Numbers follow your permissions")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month" value={month} max={thisMonth()} onChange={e => e.target.value && setMonth(e.target.value)}
            className="bg-[#0c0c0c] border border-[#262626] rounded px-2 py-1 text-sm text-[#e5e5e5]"
          />
          <button onClick={() => setTableView(v => !v)} className="text-xs border border-[#262626] rounded px-2 py-1.5 text-[#e5e5e5] hover:border-[#dfff03]">
            {tableView ? t("Chart view") : t("Table view")}
          </button>
          <button onClick={load} className="text-xs border border-[#262626] rounded px-2 py-1.5 text-[#e5e5e5] hover:border-[#dfff03]">{t("Refresh")}</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label={t("Confirmed revenue (SAR)")} value={ready(month1) ? nf(m?.confirmed_sar) : '…'} sub={ready(month1) ? t("{n} payments", { n: nf(m?.confirmed_count) }) : undefined} color={CHART_COLORS[0]} />
        <Kpi label={t("Confirmed revenue (EGP)")} value={ready(month1) ? nf(m?.confirmed_egp) : '…'} color={CHART_COLORS[1]} />
        <Kpi label={t("Unconfirmed payments (SAR)")} value={ready(month1) ? nf(m?.pending_sar) : '…'} sub={ready(month1) ? t("{n} payments", { n: nf(m?.pending_count) }) : undefined} />
        <Kpi label={t("New deals")} value={ready(month1) ? nf(m?.new_deals) : '…'} sub={ready(month1) ? `${nf(m?.new_deals_value_sar)} ${t("SAR")}` : undefined} />
        <Kpi label={t("Needs attention")} value={ready(attention) ? nf(attention.data.length) : '…'} sub={ready(attention) ? t("{n} urgent", { n: highCount }) : undefined} />
      </div>
      {month1.error && <ErrorNote message={`${t("Revenue")}: ${month1.error}`} />}

      {/* Revenue by month: two small multiples, no dual axis */}
      <Panel title={t("Confirmed revenue — last 12 months")} hint={t("Total SAR: {n}", { n: nf(sarTotal12) })}>
        <Status s={rev} />
        {ready(rev) && (tableView ? (
          <SimpleTable head={[t("Month"), t("SAR"), t("EGP"), t("Payments")]} rows={months.map(x => [x.key, nf(x.sar), nf(x.egp), nf(rev.data.find(r => String(r.month).slice(0, 7) === x.key)?.payments_count ?? 0)])} />
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <div><Legend items={[{ label: t("Saudi riyal (SAR)"), color: CHART_COLORS[0] }]} />
              <ColumnChart data={months.map(x => ({ label: x.label, value: x.sar }))} color={CHART_COLORS[0]} unit={t("SAR")} /></div>
            <div><Legend items={[{ label: t("Egyptian pound (EGP)"), color: CHART_COLORS[1] }]} />
              <ColumnChart data={months.map(x => ({ label: x.label, value: x.egp }))} color={CHART_COLORS[1]} unit={t("EGP")} /></div>
          </div>
        ))}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title={t("Sales funnel")} hint={t("From lead received to deal — selected month")}>
          <Status s={funnel} />
          {ready(funnel) && (tableView ? (
            <SimpleTable head={[t("Employee"), t("Leads"), t("Contacted"), t("Interested"), t("Requests"), t("Meetings"), t("Deals"), t("Revenue")]}
              rows={funnel.data.map(r => [r.full_name ?? '—', nf(r.leads_received), nf(r.leads_contacted), nf(r.leads_interested), nf(r.meeting_requests), nf(r.meetings_held), nf(r.deals_count), nf(r.revenue_sar)])} />
          ) : funnel.data.length === 0 ? <Empty /> : (
            <Funnel steps={[
              { label: t("Leads received"), value: funnelTotals.leads },
              { label: t("Contacted"), value: funnelTotals.contacted },
              { label: t("Interested"), value: funnelTotals.interested },
              { label: t("Meeting requests"), value: funnelTotals.requests },
              { label: t("Meetings held"), value: funnelTotals.meetings },
              { label: t("Deals"), value: funnelTotals.deals },
            ]} />
          ))}
        </Panel>

        <Panel title={t("Loss reasons")} hint={t("Meetings and leads that ended without a subscription")}>
          <Status s={loss} />
          {ready(loss) && (loss.data.length === 0 ? <Empty /> : tableView ? (
            <SimpleTable head={[t("Reason"), t("Meetings"), t("Leads"), t("Total")]} rows={loss.data.map(r => [lossLabel(r), nf(r.meetings_lost), nf(r.leads_lost), nf(r.total)])} />
          ) : (
            <HBars color={CHART_COLORS[3]} rows={loss.data.map(r => ({ label: lossLabel(r), value: Number(r.total) }))} />
          ))}
        </Panel>

        <Panel title={t("Target progress")} hint={t("Progress against each employee’s monthly target")}>
          <Status s={targets} />
          {ready(targets) && (targets.data.length === 0 ? <Empty text={t("No targets set for this month")} /> : tableView ? (
            <SimpleTable head={[t("Employee"), t("Calls"), t("Meetings"), t("Deals"), t("Revenue")]}
              rows={targets.data.map(r => [r.full_name, `${nf(r.calls_done)}/${nf(r.calls_target)}`, `${nf(r.meetings_done)}/${nf(r.meetings_target)}`, `${nf(r.deals_done)}/${nf(r.deals_target)}`, `${nf(r.revenue_sar)}/${nf(r.revenue_target_sar)}`])} />
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto pe-1">
              {targets.data.map(r => (
                <div key={r.user_id}>
                  <div className="text-xs font-medium text-[#e5e5e5] mb-1.5">{r.full_name}</div>
                  <div className="space-y-2">
                    {Number(r.revenue_target_sar) > 0 && <ProgressRow label={t("Revenue")} done={Number(r.revenue_sar)} target={Number(r.revenue_target_sar)} unit={t("SAR")} />}
                    {Number(r.deals_target) > 0 && <ProgressRow label={t("Deals")} done={Number(r.deals_done)} target={Number(r.deals_target)} />}
                    {Number(r.meetings_target) > 0 && <ProgressRow label={t("Meetings")} done={Number(r.meetings_done)} target={Number(r.meetings_target)} />}
                    {Number(r.calls_target) > 0 && <ProgressRow label={t("Calls")} done={Number(r.calls_done)} target={Number(r.calls_target)} />}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Panel>

        <Panel title={t("Source performance")} hint={t("Leads and deals per source")}>
          <Status s={sources} />
          {ready(sources) && (sources.data.length === 0 ? <Empty /> : tableView ? (
            <SimpleTable head={[t("Source"), t("Leads"), t("Contacted"), t("Interested"), t("Deals"), t("Conversion %"), t("Revenue")]}
              rows={sources.data.map(r => [r.source ?? '—', nf(r.leads_total), nf(r.contacted), nf(r.interested), nf(r.deals), nf(r.conversion_pct, 1), nf(r.revenue_sar)])} />
          ) : (
            <HBars rows={sources.data.map(r => ({ label: r.source ?? t("Unspecified"), value: Number(r.leads_total), sub: `${nf(r.deals)} ${t("deals")} · ${nf(r.conversion_pct, 1)}%` }))} unit={t("leads")} />
          ))}
        </Panel>

        <Panel title={t("Leaderboard")} hint={t("Top revenue/deals within each role")}>
          <Status s={board} />
          {ready(board) && (board.data.length === 0 ? <Empty /> : tableView ? (
            <SimpleTable head={['#', t("Employee"), t("Role"), t("Calls"), t("Meetings"), t("Deals"), t("Revenue")]}
              rows={board.data.map(r => [r.rank_in_role, r.full_name, r.role, nf(r.calls_done), nf(r.meetings_done), nf(r.deals_done), r.revenue_sar == null ? '—' : nf(r.revenue_sar)])} />
          ) : (
            <div className="grid sm:grid-cols-2 gap-6">
              {['sales', 'telesales'].map((role2, idx) => {
                const rows = board.data.filter(r => r.role === role2).slice(0, 8);
                if (!rows.length) return null;
                const byRevenue = rows.some(r => r.revenue_sar != null && Number(r.revenue_sar) > 0);
                return (
                  <div key={role2}>
                    <Legend items={[{ label: role2 === 'sales' ? t("Sales") : t("Telesales"), color: CHART_COLORS[idx] }]} />
                    <HBars color={CHART_COLORS[idx]}
                      rows={rows.map(r => ({ label: `${r.rank_in_role}. ${r.full_name}`, value: byRevenue ? Number(r.revenue_sar ?? 0) : Number(r.deals_done), sub: byRevenue ? `${nf(r.deals_done)} ${t("deals")}` : undefined }))}
                      unit={byRevenue ? t("SAR") : t("deals")} />
                  </div>
                );
              })}
            </div>
          ))}
        </Panel>

        <Panel title={t("Needs attention")} hint={t("Open problems, most frequent first")}>
          <Status s={attention} />
          {ready(attention) && (attention.data.length === 0 ? <Empty text={t("Nothing overdue 👌")} /> : tableView ? (
            <SimpleTable head={[t("Type"), t("Lead"), t("Owner"), t("Age (hours)"), t("Priority")]}
              rows={attention.data.map(r => [kind(r.kind), r.lead_name ?? '—', r.owner_name ?? '—', nf(r.age_hours), r.severity])} />
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pe-1">
              <HBars color={CHART_COLORS[1]} rows={attentionGroups.map(([k, v]) => ({ label: kind(k), value: v.length, sub: t("{n} urgent", { n: v.filter(x => x.severity === 'high').length }) }))} />
              <ul className="text-xs divide-y divide-[#1d1d1d]">
                {attention.data.slice(0, 12).map((r, i) => (
                  <li key={i} className="py-1.5 flex justify-between gap-2">
                    <span className="text-[#e5e5e5] truncate">{r.severity === 'high' ? '🔴' : '🟡'} {r.lead_name ?? kind(r.kind)} <span className="text-[#8a8a8a]">— {r.owner_name ?? t("No owner")}</span></span>
                    <span className="text-[#8a8a8a] shrink-0 tabular-nums">{nf(r.age_hours)}{t("h")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>
      </div>

      {/* Today's summary */}
      <Panel title={t("Today’s summary")}>
        <Status s={daily} />
        {ready(daily) && daily.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-center">
            {[
              [t("Calls"), daily.data.calls], [t("Contacted"), daily.data.leads_contacted], [t("Interested"), daily.data.interested],
              [t("Meeting requests"), daily.data.meeting_requests], [t("Meetings"), daily.data.meetings_held], [t("New deals"), daily.data.deals_created],
              [t("Deals approved"), daily.data.deals_approved], [t("Pending payments"), daily.data.pending_payments], [t("Today’s revenue (SAR)"), daily.data.confirmed_sar],
              [t("Today’s revenue (EGP)"), daily.data.confirmed_egp],
            ].map(([l, v]) => (
              <div key={String(l)} className="bg-[#0f0f0f] rounded p-2">
                <div className="text-lg text-[#e5e5e5] tabular-nums">{nf(Number(v))}</div>
                <div className="text-[11px] text-[#8a8a8a]">{l}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Payroll */}
      <Panel title={t("Payroll & commissions")} hint={t("Base salary + commissions — selected month")}>
        <Status s={payroll} />
        {ready(payroll) && (payroll.data.length === 0 ? <Empty text={t("No data (or you don’t have access)")} /> : tableView ? (
          <SimpleTable head={[t("Employee"), t("Role"), t("Deals"), t("Commission (SAR)"), t("Base"), t("Total (SAR)"), t("Total (EGP)")]}
            rows={payroll.data.map(r => [r.full_name, r.role, nf(r.deals_count), nf(r.commission_sar), `${nf(r.base_salary)} ${r.base_currency ?? ''}`, nf(r.total_sar), nf(r.total_egp)])} />
        ) : (
          <HBars color={CHART_COLORS[2]} unit={t("SAR")}
            rows={[...payroll.data].sort((a, b) => Number(b.total_sar) - Number(a.total_sar)).map(r => ({ label: r.full_name, value: Number(r.total_sar), sub: `${t("Commission")} ${nf(r.commission_sar)}` }))} />
        ))}
      </Panel>
    </div>
  );
}
