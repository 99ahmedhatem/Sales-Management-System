import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Card, Input, Table, Td, Toggle, Tr } from '../ui';

interface Agent { id: string; fullName: string }
interface AutoSettings { enabled: boolean; user_ids: string[]; max_open: number | null; waiting: number }
interface JobRow { job: string; affected: number }

/** A one-row RPC result can arrive as an object or as a one-element array. */
const firstRow = <T,>(data: unknown): T | null => (Array.isArray(data) ? (data[0] as T) ?? null : (data as T) ?? null);

/** A scalar RPC result can arrive as a number, a numeric string, or a one-row table. */
function toCount(data: unknown): number {
  const value = Array.isArray(data) ? Object.values((data[0] ?? {}) as Record<string, unknown>)[0] : data;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Admin settings for automatic lead distribution (032):
 * get_auto_distribution / set_auto_distribution / run_auto_distribution / run_daily_jobs.
 */
export default function AutoDistributionCard({ agents, onDistributed }: { agents: Agent[]; onDistributed: () => void }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [maxOpen, setMaxOpen] = useState('');
  const [waiting, setWaiting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'save' | 'run' | 'jobs'>('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [jobs, setJobs] = useState<JobRow[] | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('get_auto_distribution');
    if (rpcError) {
      setError(rpcError.message);
    } else {
      const row = firstRow<AutoSettings>(data);
      setEnabled(Boolean(row?.enabled));
      setPicked(row?.user_ids ?? []);
      setMaxOpen(row?.max_open == null ? '' : String(row.max_open));
      setWaiting(row ? Number(row.waiting ?? 0) : 0);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const toggle = (id: string) => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const save = async () => {
    setBusy('save');
    setError('');
    setMessage('');
    const max = Math.floor(Number(maxOpen));
    const { error: rpcError } = await supabase.rpc('set_auto_distribution', {
      p_enabled: enabled,
      p_user_ids: picked,
      p_max_open: maxOpen.trim() && max > 0 ? max : null,
    });
    setBusy('');
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage(t('Settings saved'));
    await load();
  };

  const runNow = async () => {
    setBusy('run');
    setError('');
    setMessage('');
    const { data, error: rpcError } = await supabase.rpc('run_auto_distribution');
    setBusy('');
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage(t('{n} leads distributed', { n: toCount(data).toLocaleString('en-US') }));
    onDistributed();
    await load();
  };

  const runJobs = async () => {
    setBusy('jobs');
    setError('');
    setMessage('');
    const { data, error: rpcError } = await supabase.rpc('run_daily_jobs');
    setBusy('');
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setJobs(((data ?? []) as JobRow[]).map(r => ({ job: r.job, affected: Number(r.affected) })));
    onDistributed();
    await load();
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-white font-semibold">{t('Auto distribution')}</h3>
          <p className="text-xs text-[#6b6b6b] mt-0.5">
            {loading || waiting === null ? '—' : t('{n} leads waiting', { n: waiting.toLocaleString('en-US') })}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#a0a0a0]">
          <Toggle checked={enabled} onChange={setEnabled} disabled={loading || busy !== ''} />
          {enabled ? t('Enabled') : t('Stopped')}
        </label>
      </div>

      {error && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] break-words anim-shake">{t(error)}</div>}
      {message && <div className="rounded border border-[#dfff03]/30 bg-[#dfff03]/5 p-3 text-sm text-[#dfff03] anim-banner">{message}</div>}

      <div>
        <div className="mb-2 text-xs text-[#a0a0a0]">{t('Participating telesales')}</div>
        {agents.length === 0 ? (
          <p className="text-sm text-[#6b6b6b]">{t('No active telesales agents.')}</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map(a => (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-2.5 hover:border-[#3a3a3a]">
                <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} disabled={loading} className="accent-[#dfff03]" />
                <span className="text-sm text-white truncate">{a.fullName}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <label className="block max-w-xs">
        <span className="mb-1 block text-xs text-[#a0a0a0]">{t('Max open leads per agent')}</span>
        <Input type="number" value={maxOpen} onChange={setMaxOpen} placeholder={t('No limit')} className="w-full" />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={loading || busy !== ''} onClick={() => void save()}>
          {busy === 'save' ? t('Saving...') : t('Save')}
        </Button>
        <Button variant="secondary" size="sm" disabled={loading || busy !== ''} onClick={() => void runNow()}>
          {busy === 'run' ? t('Distributing...') : t('Run now')}
        </Button>
        <Button variant="ghost" size="sm" disabled={loading || busy !== ''} onClick={() => void runJobs()}>
          {busy === 'jobs' ? t('Running...') : t('Run daily jobs now')}
        </Button>
      </div>

      {jobs && (
        jobs.length === 0 ? (
          <p className="text-sm text-[#6b6b6b]">{t('No jobs ran.')}</p>
        ) : (
          <Table headers={['Job', 'Affected']}>
            {jobs.map(j => (
              <Tr key={j.job}>
                <Td>{t(j.job)}</Td>
                <Td className="font-mono">{j.affected.toLocaleString('en-US')}</Td>
              </Tr>
            ))}
          </Table>
        )
      )}
    </Card>
  );
}
