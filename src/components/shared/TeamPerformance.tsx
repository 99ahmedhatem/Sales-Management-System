import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Empty, ErrorNote, Kpi, Panel, SimpleTable, nf } from './charts';
import TargetProgress from './TargetProgress';

/** One row of get_team_performance (018). Numeric columns arrive as numbers or numeric strings. */
interface PerformanceRow {
  user_id: string;
  full_name: string;
  role: 'manager' | 'sales' | 'telesales';
  manager_id: string | null;
  manager_name: string | null;
  base_salary: number;
  base_currency: 'SAR' | 'EGP';
  closer_percent: number;
  lead_percent: number;
  manager_percent: number;
  deals_count: number;
  deals_value_sar: number;
  collected_sar: number;
  collected_egp: number;
  collected_total_sar: number;
  collected_total_egp: number;
  commission_sar: number;
  commission_egp: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
};

/**
 * Team performance (admin/manager) or "My earnings" (sales/telesales).
 * get_team_performance filters by role itself: admin sees everyone, a manager sees himself and his team, others see themselves.
 */
export default function TeamPerformance({ mode, userId, role }: { mode: 'team' | 'mine'; userId: string; role: string }) {
  const { t, dir } = useI18n();
  const [month, setMonth] = useState(thisMonth());
  const [allTime, setAllTime] = useState(false);
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const money = (value: number | null | undefined, currency: 'SAR' | 'EGP') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value ?? 0));
  const roleLabel = (role: string) => (role === 'manager' ? t('Manager') : role === 'sales' ? t('Sales') : t('Telesales'));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('get_team_performance', allTime
      ? { p_from: null, p_to: null }
      : { p_from: `${month}-01`, p_to: monthEnd(month) });
    if (rpcError) {
      setError(rpcError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as PerformanceRow[]);
    }
    setLoading(false);
  }, [month, allTime]);

  useEffect(() => { load(); }, [load]);

  const visible = mode === 'mine' ? rows.filter(r => r.user_id === userId) : rows;
  const sum = (key: keyof PerformanceRow) => visible.reduce((total, r) => total + Number(r[key] ?? 0), 0);
  const me = visible[0];

  return (
    <div className="p-4 md:p-6 space-y-4" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#e5e5e5]">{mode === 'mine' ? t('My earnings') : t('Team performance')}</h1>
          <p className="text-xs text-[#8a8a8a]">
            {allTime ? t('All time') : month} · {t('Collected = confirmed payments only')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month" value={month} max={thisMonth()} disabled={allTime}
            onChange={e => e.target.value && setMonth(e.target.value)}
            className="bg-[#0c0c0c] border border-[#262626] rounded px-2 py-1 text-sm text-[#e5e5e5] disabled:opacity-40"
          />
          <label className="flex items-center gap-1.5 text-xs text-[#e5e5e5]">
            <input type="checkbox" checked={allTime} onChange={e => setAllTime(e.target.checked)} />
            {t('All time')}
          </label>
          <button onClick={load} disabled={loading} className="text-xs border border-[#262626] rounded px-2 py-1.5 text-[#e5e5e5] hover:border-[#dfff03] disabled:opacity-40">
            {t('Refresh')}
          </button>
        </div>
      </div>

      {error && <ErrorNote message={t(error)} />}
      {loading && <div className="text-xs text-[#8a8a8a] py-6 text-center">{t('Loading…')}</div>}

      {!loading && !error && visible.length === 0 && <Empty text={t('No data (or you don’t have access)')} />}

      {!loading && !error && visible.length > 0 && mode === 'mine' && me && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={t('Base salary')} value={money(me.base_salary, me.base_currency)} />
            <Kpi label={t('Commission (SAR)')} value={money(me.commission_sar, 'SAR')} sub={money(me.commission_egp, 'EGP')} />
            <Kpi label={t('Deals closed')} value={nf(me.deals_count)} sub={money(me.deals_value_sar, 'SAR')} />
            <Kpi label={t('Collected (SAR)')} value={money(me.collected_sar, 'SAR')} sub={money(me.collected_egp, 'EGP')} />
          </div>
          {/* Targets are monthly: with "All time" the current month is shown. */}
          <TargetProgress month={allTime ? thisMonth() : month} canEdit={role === 'admin'} />
          <Panel title={t('My rates')} hint={t('Set by the admin')}>
            <SimpleTable
              head={[t('Commission %'), ...(me.role === 'telesales' ? [t('Lead %')] : []), t('Manager %')]}
              rows={[[`${nf(me.closer_percent, 2)}%`, ...(me.role === 'telesales' ? [`${nf(me.lead_percent, 2)}%`] : []), `${nf(me.manager_percent, 2)}%`]]}
            />
          </Panel>
        </>
      )}

      {!loading && !error && visible.length > 0 && mode === 'team' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={t('Deals closed')} value={nf(sum('deals_count'))} sub={money(sum('deals_value_sar'), 'SAR')} />
            <Kpi label={t('Collected (SAR)')} value={money(sum('collected_sar'), 'SAR')} sub={money(sum('collected_egp'), 'EGP')} />
            <Kpi label={t('Commission (SAR)')} value={money(sum('commission_sar'), 'SAR')} sub={money(sum('commission_egp'), 'EGP')} />
            <Kpi label={t('Team members')} value={nf(visible.length)} />
          </div>
          <TargetProgress month={allTime ? thisMonth() : month} canEdit={role === 'admin'} />
          <Panel title={t('Per employee')} hint={t('Commission follows the deal snapshot taken at approval; cancelled deals are excluded')}>
            <SimpleTable
              head={[
                t('Employee'), t('Role'), t('Manager'), t('Base salary'), t('Commission %'), t('Lead %'), t('Manager %'),
                t('Deals'), t('Deals value (SAR)'), t('Collected (SAR)'), t('Collected all time (SAR)'), t('Commission (SAR)'), t('Commission (EGP)'),
              ]}
              rows={visible.map(r => [
                r.full_name ?? '—', roleLabel(r.role), r.manager_name ?? '—', money(r.base_salary, r.base_currency),
                `${nf(r.closer_percent, 2)}%`, r.role === 'telesales' ? `${nf(r.lead_percent, 2)}%` : '—', `${nf(r.manager_percent, 2)}%`,
                nf(r.deals_count), money(r.deals_value_sar, 'SAR'), money(r.collected_sar, 'SAR'), money(r.collected_total_sar, 'SAR'),
                money(r.commission_sar, 'SAR'), money(r.commission_egp, 'EGP'),
              ])}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
