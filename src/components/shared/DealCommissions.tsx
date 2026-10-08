import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { formatSar } from '../../lib/format';

/** deal_commissions.role_in_deal (008, 055, 059) → label. */
const ROLE_LABELS: Record<string, string> = {
  closer_sales: 'Closer (sales)',
  closer_telesales: 'Closer (telesales)',
  closer_manager: 'Closer (manager)',
  closer_admin: 'Closer (admin)',
  lead_telesales: 'Client entry',
  manager: 'Manager share',
};

interface Line {
  key: string;
  userName: string;
  roleInDeal: string;
  sourceName: string | null;
  percent: number;
  commissionSar: number | null;
  isManual: boolean;
}

/**
 * Commission lines of one deal (admin). Rows come from deal_commissions (snapshot at approval);
 * amounts come from get_commission_lines — never computed here.
 */
export function DealCommissions({ dealId, dealStatus }: { dealId: string; dealStatus: string }) {
  const { t } = useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [dealRes, rowsRes] = await Promise.all([
      supabase.from('deals').select('approved_at').eq('id', dealId).maybeSingle(),
      supabase.from('deal_commissions').select('id, user_id, role_in_deal, source_user_id, percent, is_manual').eq('deal_id', dealId).order('created_at'),
    ]);
    const firstError = dealRes.error?.message || rowsRes.error?.message;
    if (firstError) { setError(firstError); setLoading(false); return; }
    const rows = (rowsRes.data ?? []) as { id: string; user_id: string; role_in_deal: string; source_user_id: string; percent: number | string; is_manual: boolean }[];
    if (!rows.length) { setLines([]); setLoading(false); return; }

    const userIds = [...new Set(rows.flatMap(r => [r.user_id, r.source_user_id]))];
    const approvedAt = (dealRes.data as { approved_at: string | null } | null)?.approved_at ?? null;
    const [usersRes, ...amountRes] = await Promise.all([
      supabase.from('users').select('id, full_name').in('id', userIds),
      // Amount per line from the server, for the month the deal was approved
      ...(approvedAt
        ? [...new Set(rows.map(r => r.user_id))].map(uid =>
            supabase.rpc('get_commission_lines', { p_user_id: uid, p_month: approvedAt.slice(0, 10) }).then(res => ({ uid, res })))
        : []),
    ]);
    const amountError = amountRes.find(a => a.res.error)?.res.error?.message;
    if (usersRes.error || amountError) { setError(usersRes.error?.message || amountError || ''); setLoading(false); return; }

    const names = new Map(((usersRes.data ?? []) as { id: string; full_name: string }[]).map(u => [u.id, u.full_name]));
    const amounts = new Map<string, number>();
    for (const { uid, res } of amountRes) {
      for (const l of (res.data ?? []) as { deal_id: string; role_in_deal: string; commission_sar: number | string }[]) {
        if (l.deal_id === dealId) amounts.set(`${uid}|${l.role_in_deal}`, Number(l.commission_sar));
      }
    }
    setLines(rows.map(r => ({
      key: r.id,
      userName: names.get(r.user_id) ?? '—',
      roleInDeal: r.role_in_deal,
      sourceName: r.source_user_id !== r.user_id ? names.get(r.source_user_id) ?? null : null,
      percent: Number(r.percent),
      commissionSar: amounts.get(`${r.user_id}|${r.role_in_deal}`) ?? null,
      isManual: r.is_manual,
    })));
    setLoading(false);
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(['deal_commissions'], load);

  const approved = dealStatus === 'approved' || dealStatus === 'active';

  return (
    <div className="space-y-2 rounded bg-[#1a1a1a] p-3">
      <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Commissions')}</div>
      {error ? <div role="alert" className="text-sm text-[#ff8888]">{t(error)}</div>
        : loading ? <div className="text-sm text-[#6b6b6b]">{t('Loading…')}</div>
        : lines.length === 0 ? (
          <div className="text-sm text-[#6b6b6b]">
            {approved ? t('No commission lines for this deal.') : t('Commissions are recorded when the deal is approved.')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#262626] text-xs text-[#6b6b6b]">
                  <th className="py-1.5 pe-3 text-start font-medium">{t('Employee')}</th>
                  <th className="py-1.5 pe-3 text-start font-medium">{t('Role in deal')}</th>
                  <th className="py-1.5 pe-3 text-end font-medium">%</th>
                  <th className="py-1.5 text-end font-medium">{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.key} className="border-b border-[#222] last:border-0">
                    <td className="py-1.5 pe-3 text-white">{l.userName}</td>
                    <td className="py-1.5 pe-3 text-xs text-[#a0a0a0]">
                      {t(ROLE_LABELS[l.roleInDeal] ?? l.roleInDeal)}
                      {l.sourceName && <span className="text-[#6b6b6b]"> · {t('from {name}', { name: l.sourceName })}</span>}
                      {l.isManual && <span className="ms-1 text-[#ffc832]">({t('manual')})</span>}
                    </td>
                    <td className="py-1.5 pe-3 text-end font-mono tabular-nums text-[#d0d0d0]">{l.percent}%</td>
                    <td className="py-1.5 text-end font-mono tabular-nums text-[#dfff03]">{l.commissionSar == null ? '—' : formatSar(l.commissionSar)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
