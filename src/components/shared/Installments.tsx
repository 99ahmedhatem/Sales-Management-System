import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { formatSar } from '../../lib/format';
import { openDealInContracts } from '../../lib/navigation';
import { Button, Card, Table, Td, Tr, useConfirm } from '../ui';
import WhatsAppButton from './WhatsAppButton';

type InstallmentStatus = 'paid' | 'partial' | 'pending' | 'overdue';

interface Installment {
  id: string;
  seq: number;
  due_date: string;
  amount_sar: number;
  paid_sar: number;
  remaining_sar: number;
  status: InstallmentStatus;
  days_to_due: number;
  note: string | null;
}

interface DraftRow { due_date: string; amount_sar: string; note: string }

/** Status with icon + text (not color only). */
export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }) {
  const { t } = useI18n();
  const map: Record<InstallmentStatus, [string, string, string]> = {
    paid: ['✓', 'Paid', 'bg-[#64dc78]/10 text-[#64dc78]'],
    partial: ['◐', 'Partially paid', 'bg-[#ffc832]/10 text-[#ffc832]'],
    pending: ['○', 'Upcoming', 'bg-[#1e1e1e] text-[#a0a0a0]'],
    overdue: ['!', 'Overdue', 'bg-[#ff6464]/10 text-[#ff8888]'],
  };
  const [icon, label, cls] = map[status] ?? map.pending;
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cls}`}><span aria-hidden="true">{icon}</span>{t(label)}</span>;
}

function dueText(t: (s: string, v?: Record<string, string | number>) => string, days: number, status: InstallmentStatus) {
  if (status === 'paid') return '';
  if (days === 0) return t('Due today');
  return days > 0 ? t('In {n} days', { n: days }) : t('{n} days late', { n: -days });
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Installments" section in the deal details. Plans are created/cancelled by admin or manager. */
export function DealInstallments({ dealId, priceSar, dealStatus, canManage }: { dealId: string; priceSar: number; dealStatus: string; canManage: boolean }) {
  const { t } = useI18n();
  const { confirm, confirmUi } = useConfirm();
  const [rows, setRows] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [count, setCount] = useState('3');
  const [firstDue, setFirstDue] = useState(todayIso());
  const [interval, setIntervalDays] = useState('30');
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState<'' | 'preview' | 'save' | 'cancel'>('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_deal_installments', { p_deal_id: dealId });
    if (rpcError) setError(rpcError.message);
    else { setError(''); setRows(((data ?? []) as Installment[]).map(r => ({ ...r, amount_sar: Number(r.amount_sar), paid_sar: Number(r.paid_sar), remaining_sar: Number(r.remaining_sar) }))); }
    setLoading(false);
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);
  // Status is computed from confirmed payments, so refresh when a payment changes
  useRealtimeRefresh(['payments', 'deal_installments'], () => void load());

  async function preview() {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 36) { setError(t('Installments count must be between 1 and 36')); return; }
    setBusy('preview');
    setError('');
    const { data, error: rpcError } = await supabase.rpc('preview_installments', {
      p_total: priceSar, p_count: n, p_first_due: firstDue, p_interval_days: Number(interval) || 30,
    });
    setBusy('');
    if (rpcError) { setError(rpcError.message); return; }
    setDraft(((data ?? []) as { due_date: string; amount_sar: number }[]).map(r => ({ due_date: r.due_date, amount_sar: String(r.amount_sar), note: '' })));
  }

  const draftTotal = round2(draft.reduce((s, r) => s + (Number(r.amount_sar) || 0), 0));
  const totalMatches = Math.abs(draftTotal - priceSar) <= 0.01;

  async function savePlan() {
    if (!draft.length || !totalMatches || busy) return;
    setBusy('save');
    setError('');
    const { error: rpcError } = await supabase.rpc('create_installment_plan', {
      p_deal_id: dealId,
      p_schedule: draft.map(r => ({ due_date: r.due_date, amount_sar: Number(r.amount_sar), ...(r.note.trim() ? { note: r.note.trim() } : {}) })),
    });
    setBusy('');
    if (rpcError) { setError(rpcError.message); return; }
    setPlanOpen(false);
    setDraft([]);
    await load();
  }

  async function cancelPlan() {
    if (busy || !(await confirm({ message: t('Cancel the installment plan for this deal? Payments are not affected.'), confirmLabel: 'Cancel plan', danger: true }))) return;
    setBusy('cancel');
    const { error: rpcError } = await supabase.rpc('cancel_installment_plan', { p_deal_id: dealId });
    setBusy('');
    if (rpcError) { setError(rpcError.message); return; }
    await load();
  }

  const input = 'bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#dfff03]/60';

  return (
    <div className="space-y-3 rounded border border-[#2a2a2a] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Installments')}</div>
        {canManage && !loading && dealStatus !== 'cancelled' && (
          rows.length === 0
            ? !planOpen && <Button size="sm" variant="secondary" onClick={() => { setPlanOpen(true); setDraft([]); }}>{t('Create installment plan')}</Button>
            : <Button size="sm" variant="danger" disabled={busy === 'cancel'} onClick={() => void cancelPlan()}>{busy === 'cancel' ? t('Cancelling…') : t('Cancel plan')}</Button>
        )}
      </div>

      {error && <div role="alert" className="rounded bg-[#ff6464]/10 p-2 text-sm text-[#ff8888]">{t(error)}</div>}

      {loading ? (
        <div className="h-10 animate-pulse rounded bg-[#1a1a1a]" />
      ) : rows.length > 0 ? (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#1a1a1a] px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-[#6b6b6b]">#{r.seq}</span>
                <span className="font-mono text-xs text-[#d0d0d0]">{r.due_date}</span>
                <InstallmentStatusBadge status={r.status} />
                <span className="text-xs text-[#6b6b6b]">{dueText(t, r.days_to_due, r.status)}</span>
              </div>
              <div className="text-end">
                <div className="font-mono text-white">{formatSar(r.amount_sar)}</div>
                {r.status !== 'paid' && r.paid_sar > 0 && <div className="text-xs text-[#a0a0a0]">{t('Paid {a} · left {b}', { a: formatSar(r.paid_sar), b: formatSar(r.remaining_sar) })}</div>}
                {r.note && <div className="text-xs text-[#6b6b6b]">{r.note}</div>}
              </div>
            </li>
          ))}
        </ul>
      ) : !planOpen && (
        <p className="text-sm text-[#4a4a4a]">{t('No installment plan — the deal is paid in one go.')}</p>
      )}

      {planOpen && rows.length === 0 && (
        <div className="space-y-3 rounded bg-[#0f0f0f] p-3">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-[#a0a0a0]">{t('Number of installments')}
              <input type="number" min={1} max={36} value={count} onChange={e => setCount(e.target.value)} className={`mt-1 w-full ${input}`} />
            </label>
            <label className="text-xs text-[#a0a0a0]">{t('First due date')}
              <input type="date" value={firstDue} onChange={e => setFirstDue(e.target.value)} className={`mt-1 w-full ${input}`} />
            </label>
            <label className="text-xs text-[#a0a0a0]">{t('Days between installments')}
              <input type="number" min={1} value={interval} onChange={e => setIntervalDays(e.target.value)} className={`mt-1 w-full ${input}`} />
            </label>
          </div>
          <Button size="sm" variant="secondary" disabled={busy === 'preview' || !firstDue} onClick={() => void preview()}>
            {busy === 'preview' ? t('Loading…') : t('Preview schedule')}
          </Button>
          {draft.length > 0 && (
            <>
              <div className="space-y-1.5">
                {draft.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="w-8 font-mono text-xs text-[#6b6b6b]">#{i + 1}</span>
                    <input type="date" aria-label={t('Due date')} value={r.due_date} onChange={e => setDraft(d => d.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))} className={input} />
                    <input type="number" min={0} step="0.01" aria-label={t('Amount (SAR)')} value={r.amount_sar} onChange={e => setDraft(d => d.map((x, j) => (j === i ? { ...x, amount_sar: e.target.value } : x)))} className={`w-32 ${input}`} />
                    <input aria-label={t('Note')} placeholder={t('Note (optional)')} value={r.note} onChange={e => setDraft(d => d.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} className={`flex-1 min-w-24 ${input}`} />
                  </div>
                ))}
              </div>
              <div className={`text-sm ${totalMatches ? 'text-[#64dc78]' : 'text-[#ff8888]'}`}>
                {totalMatches ? '✓ ' : '✕ '}
                {t('Total {a} of deal price {b}', { a: formatSar(draftTotal), b: formatSar(priceSar) })}
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setPlanOpen(false); setDraft([]); setError(''); }}>{t('Cancel')}</Button>
            <Button size="sm" disabled={!draft.length || !totalMatches || busy === 'save'} onClick={() => void savePlan()}>
              {busy === 'save' ? t('Saving…') : t('Save plan')}
            </Button>
          </div>
        </div>
      )}
      {confirmUi}
    </div>
  );
}

interface OverviewRow {
  deal_id: string; client_name: string; client_code: string | null; seq: number; due_date: string;
  remaining_sar: number; status: InstallmentStatus; days_to_due: number; owner_name: string | null;
}

/** Overdue and upcoming installments (admin / manager). */
export function InstallmentsOverview() {
  const { t } = useI18n();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [leadIds, setLeadIds] = useState<Record<string, string>>({}); // deal id → lead id
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_installments_overview', { p_days_ahead: 14 });
    if (rpcError) { setError(rpcError.message); setLoading(false); return; }
    const list = (data ?? []) as OverviewRow[];
    setRows(list);
    setError('');
    // WhatsApp needs the lead id; deals are visible to the same people who see this panel
    const dealIds = [...new Set(list.map(r => r.deal_id))];
    if (dealIds.length) {
      const { data: deals, error: dealsError } = await supabase.from('deals').select('id, lead_id').in('id', dealIds);
      if (dealsError) setError(dealsError.message);
      const leadMap: Record<string, string> = {};
      for (const d of (deals ?? []) as { id: string; lead_id: string }[]) leadMap[d.id] = d.lead_id;
      setLeadIds(leadMap);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(['payments', 'deal_installments'], () => void load());

  const overdue = rows.filter(r => r.status === 'overdue');
  const overdueTotal = overdue.reduce((s, r) => s + Number(r.remaining_sar), 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262626] p-4">
        <div>
          <h3 className="text-white font-semibold">{t('Installments due')}</h3>
          <p className="text-xs text-[#6b6b6b]">{t('Overdue and due in the next 14 days')}</p>
        </div>
        {overdue.length > 0 && (
          <div className="text-end text-sm">
            <div className="text-[#ff8888]">! {t('{n} overdue', { n: overdue.length })}</div>
            <div className="font-mono text-xs text-[#a0a0a0]">{formatSar(overdueTotal)}</div>
          </div>
        )}
      </div>
      {error && <div role="alert" className="m-4 rounded bg-[#ff6464]/10 p-2 text-sm text-[#ff8888]">{t(error)}</div>}
      {loading ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded bg-[#1a1a1a]" />)}</div>
      ) : rows.length === 0 ? (
        !error && <p className="p-6 text-center text-sm text-[#4a4a4a]">{t('No installments due in the next 14 days.')}</p>
      ) : (
        <Table headers={['Client', 'Installment', 'Due date', 'Left', 'Status', 'Owner', '']}>
          {rows.slice(0, 50).map(r => (
            <Tr key={`${r.deal_id}-${r.seq}`}>
              <Td>
                <div className="text-white">{r.client_name}</div>
                <div className="font-mono text-xs text-[#6b6b6b]">{r.client_code ?? '—'}</div>
              </Td>
              <Td><span className="font-mono text-xs">#{r.seq}</span></Td>
              <Td>
                <div className="font-mono text-xs">{r.due_date}</div>
                <div className="text-xs text-[#6b6b6b]">{dueText(t, r.days_to_due, r.status)}</div>
              </Td>
              <Td><span className="font-mono text-white">{formatSar(r.remaining_sar)}</span></Td>
              <Td><InstallmentStatusBadge status={r.status} /></Td>
              <Td><span className="text-xs">{r.owner_name ?? '—'}</span></Td>
              <Td>
                <div className="flex items-center gap-3">
                  <button className="text-xs text-[#dfff03] hover:underline" onClick={() => openDealInContracts(r.deal_id)}>{t('Open deal')}</button>
                  {leadIds[r.deal_id] && <WhatsAppButton variant="icon" leadId={leadIds[r.deal_id]} stage="payment_due" label="Payment reminder" />}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
