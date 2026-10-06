import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Input, Modal, Select, Table, Td, Tr } from '../ui';

// Stored in the database as the English name in "value"
export const REGION_OPTIONS = [
  { value: '', label: 'All Countries' },
  { value: 'Saudi Arabia', label: 'Saudi Arabia (السعودية)' },
  { value: 'Oman', label: 'Oman (عمان)' },
  { value: 'Iraq', label: 'Iraq (العراق)' },
  { value: 'UAE', label: 'UAE (الإمارات)' },
  { value: 'Egypt', label: 'Egypt (مصر)' },
  { value: 'Kuwait', label: 'Kuwait (الكويت)' },
  { value: 'Qatar', label: 'Qatar (قطر)' },
  { value: 'Bahrain', label: 'Bahrain (البحرين)' },
];

export const QUALITY_FILTER_OPTIONS = [
  { value: '', label: 'All Quality' },
  { value: 'normal', label: 'Normal (عادية)' },
  { value: 'medium', label: 'Medium (متوسطة)' },
  { value: 'high', label: 'Strong (قوية)' },
];

interface Agent { id: string; fullName: string }
interface ResultRow { user_id: string | null; assigned_count: number }

/** A scalar RPC result can arrive as a number, a numeric string, or a one-row table. */
function toCount(data: unknown): number {
  const value = Array.isArray(data) ? Object.values((data[0] ?? {}) as Record<string, unknown>)[0] : data;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const positiveInt = (value: string) => {
  const n = Math.floor(Number(value));
  return value.trim() && n > 0 ? n : null;
};

/**
 * Spreads leads evenly over active telesales. The database picks the leads (030):
 * admin = unassigned leads to any active telesales, manager = leads assigned to the manager, to their team.
 * count_unassigned_leads previews, distribute_unassigned_leads moves them; the country filter is leads.region.
 */
export default function DistributeLeadsModal({ open, onClose, agents, onDone, managerPool = false }: {
  open: boolean;
  /** Manager: the source is the leads assigned to them, not the unassigned ones. */
  managerPool?: boolean;
  onClose: () => void;
  agents: Agent[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>([]);
  const [maxPer, setMaxPer] = useState('');
  const [limit, setLimit] = useState('');
  const [country, setCountry] = useState('');
  const [quality, setQuality] = useState('');
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResultRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(agents.map(a => a.id));
    setMaxPer('');
    setLimit('');
    setCountry('');
    setQuality('');
    setError('');
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCounting(true);
    supabase.rpc('count_unassigned_leads', { p_country: country || null, p_quality: quality || null }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) {
        setError(rpcError.message);
        setMatchCount(null);
      } else {
        setMatchCount(toCount(data));
      }
      setCounting(false);
    });
    return () => { active = false; };
  }, [open, country, quality]);

  const toggle = (id: string) => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const maxPerN = positiveInt(maxPer);
  const limitN = positiveInt(limit);
  // What will move at most: the requested amount, capped by what matches and by the per-agent limit.
  const planned = Math.min(
    limitN ?? Infinity,
    matchCount ?? Infinity,
    maxPerN ? maxPerN * picked.length : Infinity,
  );
  const plannedCount = Number.isFinite(planned) ? planned : 0;

  const distribute = async () => {
    if (!picked.length || running) return;
    if (!window.confirm(t('Distribute {n} leads to {k} agents?', { n: plannedCount.toLocaleString('en-US'), k: picked.length }))) return;
    setRunning(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('distribute_unassigned_leads', {
      p_user_ids: picked,
      p_limit: limitN,
      p_country: country || null,
      p_quality: quality || null,
      p_max_per_user: maxPerN,
    });
    setRunning(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setResult(((data ?? []) as ResultRow[]).map(row => ({ user_id: row.user_id, assigned_count: Number(row.assigned_count) })));
    onDone();
  };

  const nameOf = (id: string | null) => (id ? agents.find(a => a.id === id)?.fullName ?? id : t('Not assigned'));

  return (
    <Modal open={open} onClose={onClose} title="Distribute evenly">
      <div className="space-y-4">
        {error && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] break-words anim-shake">{t(error)}</div>}

        {result ? (
          <>
            <p className="text-sm text-[#a0a0a0]">
              {t('{n} leads distributed', { n: result.filter(r => r.user_id).reduce((s, r) => s + r.assigned_count, 0).toLocaleString('en-US') })}
            </p>
            <Table headers={['Employee', 'Leads']}>
              {result.map(row => (
                <Tr key={row.user_id ?? 'none'}>
                  <Td className={row.user_id ? '' : 'text-[#ff8888]'}>{nameOf(row.user_id)}</Td>
                  <Td className="font-mono">{row.assigned_count.toLocaleString('en-US')}</Td>
                </Tr>
              ))}
            </Table>
            <div className="flex gap-2">
              <Button variant="primary" onClick={onClose}>{t('Done')}</Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-[#a0a0a0]">{t('Active telesales')}</span>
                {agents.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicked(picked.length === agents.length ? [] : agents.map(a => a.id))}
                    className="text-xs text-[#dfff03] hover:underline"
                  >
                    {picked.length === agents.length ? t('Clear all') : t('Select all')}
                  </button>
                )}
              </div>
              {agents.length === 0 ? (
                <p className="text-sm text-[#6b6b6b]">{t('No active telesales agents.')}</p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {agents.map(a => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-2.5 hover:border-[#3a3a3a]">
                      <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} className="accent-[#dfff03]" />
                      <span className="text-sm text-white">{a.fullName}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-[#a0a0a0]">{t('Max per agent')}</span>
                <Input type="number" value={maxPer} onChange={setMaxPer} placeholder={t('No limit')} className="w-full" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[#a0a0a0]">{t('How many leads')}</span>
                <Input type="number" value={limit} onChange={setLimit} placeholder={managerPool ? t('All in your pool') : t('All unassigned')} className="w-full" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[#a0a0a0]">{t('Country')}</span>
                <Select value={country} onChange={setCountry} options={REGION_OPTIONS} className="w-full" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[#a0a0a0]">{t('Data Quality')}</span>
                <Select value={quality} onChange={setQuality} options={QUALITY_FILTER_OPTIONS} className="w-full" />
              </label>
            </div>

            <p className="text-sm text-[#a0a0a0]" aria-live="polite">
              {counting
                ? t('Counting...')
                : matchCount === null
                  ? '—'
                  : t(managerPool ? '{n} leads in your pool match' : '{n} unassigned leads match', { n: matchCount.toLocaleString('en-US') })}
            </p>

            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={running || counting || !picked.length || plannedCount === 0}
                onClick={() => void distribute()}
              >
                {running ? t('Distributing...') : t('Confirm')}
              </Button>
              <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
