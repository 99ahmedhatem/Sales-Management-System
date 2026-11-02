import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';

/** The "تواصلت" mark next to a client (070). Click to mark / unmark; never opens the row behind it. */
export function ContactedToggle({ on, onToggle, byName }: { on: boolean; onToggle: () => void; byName?: string }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        aria-pressed={on}
        title={on ? t('Contacted — click to remove the mark') : t('Mark as contacted')}
        onClick={e => { e.stopPropagation(); onToggle(); }}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors ${
          on ? 'border-[#64dc78]/50 bg-[#64dc78]/10 text-[#64dc78]' : 'border-[#2a2a2a] text-[#6b6b6b] hover:border-[#4a4a4a] hover:text-white'
        }`}
      >
        <span aria-hidden="true" className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${on ? 'border-[#64dc78] bg-[#64dc78] text-black' : 'border-[#4a4a4a]'}`}>
          {on ? '✓' : ''}
        </span>
        {on ? t('I contacted') : t('Not contacted yet')}
      </button>
      {byName && <span className="text-[10px] text-[#6b6b6b]" dir="auto">{t('by {name}', { name: byName })}</span>}
    </div>
  );
}

export const CONTACT_FILTER_OPTIONS = [
  { value: '', label: 'All contact states' },
  { value: 'yes', label: 'Marked contacted' },
  { value: 'no', label: 'Not contacted yet' },
];

interface StatRow { user_id: string; full_name: string; role: string; today: number; in_period: number; total: number }

/**
 * How many clients were contacted (070). mode "mine": my own numbers as small cards.
 * mode "team": a table per employee (admin = everyone, manager = himself + his team).
 */
export function ContactStats({ mode, userId, refreshKey = 0 }: { mode: 'mine' | 'team'; userId?: string; refreshKey?: number }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<StatRow[] | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.rpc('contact_stats').then(({ data, error }) => {
      if (!active) return;
      setRows(error ? null : ((data ?? []) as StatRow[]).map(r => ({ ...r, today: Number(r.today), in_period: Number(r.in_period), total: Number(r.total) })));
    });
    return () => { active = false; };
  }, [refreshKey]);

  if (!rows) return null; // 070 not run yet, or still loading
  const roleLabel = (r: string) =>
    r === 'admin' ? t('Admin') : r === 'manager' ? t('Manager') : r === 'sales' ? t('Sales') : r === 'sales_telesales' ? t('Telesales + Sales') : t('Telesales');

  if (mode === 'mine') {
    const me = rows.find(r => r.user_id === userId) ?? { today: 0, in_period: 0, total: 0 };
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#262626] bg-[#161616] px-4 py-2.5 text-sm">
        <span className="text-[#a0a0a0]">{t('Clients I contacted')}:</span>
        <span className="rounded bg-[#64dc78]/10 px-2 py-0.5 text-[#64dc78]">{t('Today')} <b className="tabular-nums">{me.today}</b></span>
        <span className="rounded bg-[#1a1a1a] px-2 py-0.5 text-[#d0d0d0]">{t('This month')} <b className="tabular-nums">{me.in_period}</b></span>
        <span className="rounded bg-[#1a1a1a] px-2 py-0.5 text-[#d0d0d0]">{t('All time')} <b className="tabular-nums">{me.total}</b></span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#262626] bg-[#161616]">
      <div className="border-b border-[#262626] px-4 py-3">
        <h3 className="text-sm font-semibold text-white">{t('Clients contacted')}</h3>
        <p className="text-xs text-[#6b6b6b]">{t('From the "Contacted" mark next to each client')}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#262626] text-xs text-[#6b6b6b]">
              <th className="px-4 py-2 text-start font-medium">{t('Employee')}</th>
              <th className="px-4 py-2 text-start font-medium">{t('Role')}</th>
              <th className="px-4 py-2 text-end font-medium">{t('Today')}</th>
              <th className="px-4 py-2 text-end font-medium">{t('This month')}</th>
              <th className="px-4 py-2 text-end font-medium">{t('All time')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.user_id} className="border-b border-[#1e1e1e] last:border-0">
                <td className="px-4 py-2 text-white" dir="auto">{r.full_name}</td>
                <td className="px-4 py-2 text-xs text-[#a0a0a0]">{roleLabel(r.role)}</td>
                <td className="px-4 py-2 text-end tabular-nums text-[#64dc78]">{r.today}</td>
                <td className="px-4 py-2 text-end tabular-nums text-white">{r.in_period}</td>
                <td className="px-4 py-2 text-end tabular-nums text-[#a0a0a0]">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
