import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
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
/** التاريخ المحلي (مش UTC) عشان ملخص اليوم ما يرجعش يوم امبارح بعد نص الليل */
const today = () => { const d = new Date(); return `${thisMonth()}-${pad(d.getDate())}`; };

const KIND_LABEL: Record<string, string> = {
  lead_not_called: 'عميل لم يُتصل به',
  callback_overdue: 'متابعة متأخرة',
  request_pending: 'طلب ميتنج بدون رد',
  meeting_no_outcome: 'ميتنج بدون نتيجة',
  deal_draft_stale: 'ديل مسودة قديم',
  deal_approval_stale: 'ديل ينتظر الموافقة',
  payment_unconfirmed: 'دفعة غير مؤكدة',
  renewal_due: 'تجديد قريب',
  contract_review_attention: 'مراجعة العقد تحتاج انتباه',
};

/** لوحة الشارتات: تقرأ كل شيء من الـ RPCs/Views وRLS بيحدد كل دور يشوف إيه. */
export default function InsightsDashboard({ role }: { role: Role }) {
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

  /** آخر 12 شهر بدون ثقوب */
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
    s.loading ? <div className="text-xs text-[#8a8a8a] py-6 text-center">جارِ التحميل…</div>
      : s.error ? <ErrorNote message={s.error} /> : null;
  const ready = (s: Section<any>) => !s.loading && !s.error;

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#e5e5e5]">لوحة المتابعة</h1>
          <p className="text-xs text-[#8a8a8a]">{role === 'admin' ? 'كل الفريق' : 'فريقك فقط'} · الأرقام حسب صلاحياتك</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month" value={month} max={thisMonth()} onChange={e => e.target.value && setMonth(e.target.value)}
            className="bg-[#0c0c0c] border border-[#262626] rounded px-2 py-1 text-sm text-[#e5e5e5]"
          />
          <button onClick={() => setTableView(v => !v)} className="text-xs border border-[#262626] rounded px-2 py-1.5 text-[#e5e5e5] hover:border-[#dfff03]">
            {tableView ? 'عرض الشارت' : 'عرض جدول'}
          </button>
          <button onClick={load} className="text-xs border border-[#262626] rounded px-2 py-1.5 text-[#e5e5e5] hover:border-[#dfff03]">تحديث</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="إيراد مؤكد (ريال)" value={ready(month1) ? nf(m?.confirmed_sar) : '…'} sub={ready(month1) ? `${nf(m?.confirmed_count)} دفعة` : undefined} color={CHART_COLORS[0]} />
        <Kpi label="إيراد مؤكد (جنيه)" value={ready(month1) ? nf(m?.confirmed_egp) : '…'} color={CHART_COLORS[1]} />
        <Kpi label="دفعات غير مؤكدة (ريال)" value={ready(month1) ? nf(m?.pending_sar) : '…'} sub={ready(month1) ? `${nf(m?.pending_count)} دفعة` : undefined} />
        <Kpi label="ديلز جديدة" value={ready(month1) ? nf(m?.new_deals) : '…'} sub={ready(month1) ? `${nf(m?.new_deals_value_sar)} ريال` : undefined} />
        <Kpi label="تحتاج انتباه" value={ready(attention) ? nf(attention.data.length) : '…'} sub={ready(attention) ? `${highCount} عاجل` : undefined} />
      </div>
      {month1.error && <ErrorNote message={`الإيراد: ${month1.error}`} />}

      {/* Revenue by month: two small multiples, no dual axis */}
      <Panel title="الإيراد المؤكد — آخر 12 شهر" hint={`إجمالي الريال: ${nf(sarTotal12)}`}>
        <Status s={rev} />
        {ready(rev) && (tableView ? (
          <SimpleTable head={['الشهر', 'ريال', 'جنيه', 'عدد الدفعات']} rows={months.map(x => [x.key, nf(x.sar), nf(x.egp), nf(rev.data.find(r => String(r.month).slice(0, 7) === x.key)?.payments_count ?? 0)])} />
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <div><Legend items={[{ label: 'ريال سعودي (SAR)', color: CHART_COLORS[0] }]} />
              <ColumnChart data={months.map(x => ({ label: x.label, value: x.sar }))} color={CHART_COLORS[0]} unit="ريال" /></div>
            <div><Legend items={[{ label: 'جنيه مصري (EGP)', color: CHART_COLORS[1] }]} />
              <ColumnChart data={months.map(x => ({ label: x.label, value: x.egp }))} color={CHART_COLORS[1]} unit="جنيه" /></div>
          </div>
        ))}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="قمع المبيعات" hint="من استلام العميل حتى الديل — الشهر المختار">
          <Status s={funnel} />
          {ready(funnel) && (tableView ? (
            <SimpleTable head={['الموظف', 'عملاء', 'تواصل', 'مهتم', 'طلبات', 'ميتنجز', 'ديلز', 'إيراد']}
              rows={funnel.data.map(r => [r.full_name ?? '—', nf(r.leads_received), nf(r.leads_contacted), nf(r.leads_interested), nf(r.meeting_requests), nf(r.meetings_held), nf(r.deals_count), nf(r.revenue_sar)])} />
          ) : funnel.data.length === 0 ? <Empty /> : (
            <Funnel steps={[
              { label: 'عملاء مستلمون', value: funnelTotals.leads },
              { label: 'تم التواصل', value: funnelTotals.contacted },
              { label: 'مهتم', value: funnelTotals.interested },
              { label: 'طلبات ميتنج', value: funnelTotals.requests },
              { label: 'ميتنجز تمت', value: funnelTotals.meetings },
              { label: 'ديلز', value: funnelTotals.deals },
            ]} />
          ))}
        </Panel>

        <Panel title="أسباب الخسارة" hint="ميتنجز وعملاء انتهوا بدون اشتراك">
          <Status s={loss} />
          {ready(loss) && (loss.data.length === 0 ? <Empty /> : tableView ? (
            <SimpleTable head={['السبب', 'ميتنجز', 'عملاء', 'الإجمالي']} rows={loss.data.map(r => [r.label_ar, nf(r.meetings_lost), nf(r.leads_lost), nf(r.total)])} />
          ) : (
            <HBars color={CHART_COLORS[3]} rows={loss.data.map(r => ({ label: r.label_ar ?? r.code, value: Number(r.total) }))} />
          ))}
        </Panel>

        <Panel title="تقدّم الأهداف" hint="الإنجاز مقابل الهدف الشهري لكل موظف">
          <Status s={targets} />
          {ready(targets) && (targets.data.length === 0 ? <Empty text="لا توجد أهداف مضبوطة لهذا الشهر" /> : tableView ? (
            <SimpleTable head={['الموظف', 'مكالمات', 'ميتنجز', 'ديلز', 'إيراد']}
              rows={targets.data.map(r => [r.full_name, `${nf(r.calls_done)}/${nf(r.calls_target)}`, `${nf(r.meetings_done)}/${nf(r.meetings_target)}`, `${nf(r.deals_done)}/${nf(r.deals_target)}`, `${nf(r.revenue_sar)}/${nf(r.revenue_target_sar)}`])} />
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto pe-1">
              {targets.data.map(r => (
                <div key={r.user_id}>
                  <div className="text-xs font-medium text-[#e5e5e5] mb-1.5">{r.full_name}</div>
                  <div className="space-y-2">
                    {Number(r.revenue_target_sar) > 0 && <ProgressRow label="الإيراد" done={Number(r.revenue_sar)} target={Number(r.revenue_target_sar)} unit="ريال" />}
                    {Number(r.deals_target) > 0 && <ProgressRow label="الديلز" done={Number(r.deals_done)} target={Number(r.deals_target)} />}
                    {Number(r.meetings_target) > 0 && <ProgressRow label="الميتنجز" done={Number(r.meetings_done)} target={Number(r.meetings_target)} />}
                    {Number(r.calls_target) > 0 && <ProgressRow label="المكالمات" done={Number(r.calls_done)} target={Number(r.calls_target)} />}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Panel>

        <Panel title="أداء المصادر" hint="عدد العملاء والديلز من كل مصدر">
          <Status s={sources} />
          {ready(sources) && (sources.data.length === 0 ? <Empty /> : tableView ? (
            <SimpleTable head={['المصدر', 'عملاء', 'تواصل', 'مهتم', 'ديلز', 'تحويل %', 'إيراد']}
              rows={sources.data.map(r => [r.source ?? '—', nf(r.leads_total), nf(r.contacted), nf(r.interested), nf(r.deals), nf(r.conversion_pct, 1), nf(r.revenue_sar)])} />
          ) : (
            <HBars rows={sources.data.map(r => ({ label: r.source ?? 'غير محدد', value: Number(r.leads_total), sub: `${nf(r.deals)} ديل · ${nf(r.conversion_pct, 1)}%` }))} unit="عميل" />
          ))}
        </Panel>

        <Panel title="لوحة الصدارة" hint="الأعلى إيراداً/ديلز داخل كل دور">
          <Status s={board} />
          {ready(board) && (board.data.length === 0 ? <Empty /> : tableView ? (
            <SimpleTable head={['#', 'الموظف', 'الدور', 'مكالمات', 'ميتنجز', 'ديلز', 'إيراد']}
              rows={board.data.map(r => [r.rank_in_role, r.full_name, r.role, nf(r.calls_done), nf(r.meetings_done), nf(r.deals_done), r.revenue_sar == null ? '—' : nf(r.revenue_sar)])} />
          ) : (
            <div className="grid sm:grid-cols-2 gap-6">
              {['sales', 'telesales'].map((role2, idx) => {
                const rows = board.data.filter(r => r.role === role2).slice(0, 8);
                if (!rows.length) return null;
                const byRevenue = rows.some(r => r.revenue_sar != null && Number(r.revenue_sar) > 0);
                return (
                  <div key={role2}>
                    <Legend items={[{ label: role2 === 'sales' ? 'سيلز' : 'تيلي سيلز', color: CHART_COLORS[idx] }]} />
                    <HBars color={CHART_COLORS[idx]}
                      rows={rows.map(r => ({ label: `${r.rank_in_role}. ${r.full_name}`, value: byRevenue ? Number(r.revenue_sar ?? 0) : Number(r.deals_done), sub: byRevenue ? `${nf(r.deals_done)} ديل` : undefined }))}
                      unit={byRevenue ? 'ريال' : 'ديل'} />
                  </div>
                );
              })}
            </div>
          ))}
        </Panel>

        <Panel title="تحتاج انتباه" hint="مشاكل مفتوحة مرتبة بالأكتر">
          <Status s={attention} />
          {ready(attention) && (attention.data.length === 0 ? <Empty text="لا شيء متأخر 👌" /> : tableView ? (
            <SimpleTable head={['النوع', 'العميل', 'المسؤول', 'العمر (ساعة)', 'الأولوية']}
              rows={attention.data.map(r => [KIND_LABEL[r.kind] ?? r.kind, r.lead_name ?? '—', r.owner_name ?? '—', nf(r.age_hours), r.severity])} />
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pe-1">
              <HBars color={CHART_COLORS[1]} rows={attentionGroups.map(([k, v]) => ({ label: KIND_LABEL[k] ?? k, value: v.length, sub: `${v.filter(x => x.severity === 'high').length} عاجل` }))} />
              <ul className="text-xs divide-y divide-[#1d1d1d]">
                {attention.data.slice(0, 12).map((r, i) => (
                  <li key={i} className="py-1.5 flex justify-between gap-2">
                    <span className="text-[#e5e5e5] truncate">{r.severity === 'high' ? '🔴' : '🟡'} {r.lead_name ?? KIND_LABEL[r.kind] ?? r.kind} <span className="text-[#8a8a8a]">— {r.owner_name ?? 'بدون مسؤول'}</span></span>
                    <span className="text-[#8a8a8a] shrink-0 tabular-nums">{nf(r.age_hours)}س</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>
      </div>

      {/* ملخص اليوم */}
      <Panel title="ملخص اليوم">
        <Status s={daily} />
        {ready(daily) && daily.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-center">
            {[
              ['مكالمات', daily.data.calls], ['تواصل', daily.data.leads_contacted], ['مهتم', daily.data.interested],
              ['طلبات ميتنج', daily.data.meeting_requests], ['ميتنجز', daily.data.meetings_held], ['ديلز جديدة', daily.data.deals_created],
              ['ديلز معتمدة', daily.data.deals_approved], ['دفعات معلّقة', daily.data.pending_payments], ['إيراد اليوم (ريال)', daily.data.confirmed_sar],
              ['إيراد اليوم (جنيه)', daily.data.confirmed_egp],
            ].map(([l, v]) => (
              <div key={String(l)} className="bg-[#0f0f0f] rounded p-2">
                <div className="text-lg text-[#e5e5e5] tabular-nums">{nf(Number(v))}</div>
                <div className="text-[11px] text-[#8a8a8a]">{l}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* مرتبات الشهر */}
      <Panel title="المرتبات والعمولات" hint="الأساسي + العمولات — الشهر المختار">
        <Status s={payroll} />
        {ready(payroll) && (payroll.data.length === 0 ? <Empty text="لا توجد بيانات (أو ليس لديك صلاحية)" /> : tableView ? (
          <SimpleTable head={['الموظف', 'الدور', 'ديلز', 'عمولة (ريال)', 'أساسي', 'الإجمالي (ريال)', 'الإجمالي (جنيه)']}
            rows={payroll.data.map(r => [r.full_name, r.role, nf(r.deals_count), nf(r.commission_sar), `${nf(r.base_salary)} ${r.base_currency ?? ''}`, nf(r.total_sar), nf(r.total_egp)])} />
        ) : (
          <HBars color={CHART_COLORS[2]} unit="ريال"
            rows={[...payroll.data].sort((a, b) => Number(b.total_sar) - Number(a.total_sar)).map(r => ({ label: r.full_name, value: Number(r.total_sar), sub: `عمولة ${nf(r.commission_sar)}` }))} />
        ))}
      </Panel>
    </div>
  );
}
