import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Card } from '../ui';

/** Reason codes written by the check-websites Edge Function. */
export const WEBSITE_CATEGORIES = ['ok', 'ok_protected', 'dns', 'dns_typo', 'timeout', 'ssl', 'refused', 'http_404', 'http_4xx', 'http_5xx', 'parked', 'suspended', 'invalid_url', 'redirect_loop', 'network'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  ok: 'Opens normally',
  ok_protected: 'Works (protected page)',
  dns: 'Domain not found / expired',
  dns_typo: 'Domain typo (a similar domain works)',
  redirect_loop: 'Redirect loop',
  timeout: 'No response (timeout)',
  ssl: 'Invalid SSL certificate',
  refused: 'Server refused the connection',
  http_404: 'Page not found (404)',
  http_4xx: 'Request error (4xx)',
  http_5xx: 'Server error (5xx)',
  parked: 'Domain for sale / parked',
  suspended: 'Site or store suspended',
  invalid_url: 'Invalid website address',
  network: 'Connection error',
};

export const websiteCategoryLabel = (code: string) => CATEGORY_LABELS[code] ?? code;

export const WEBSITE_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All website statuses' },
  { value: 'working', label: 'Working' },
  { value: 'not_working', label: 'Not working' },
  { value: 'unchecked', label: 'Not checked' },
];

export const WEBSITE_REASON_FILTER_OPTIONS = [
  { value: '', label: 'All reasons' },
  ...WEBSITE_CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABELS[c] })),
];

interface RunResult { checked: number; saved: number; by_category: Record<string, number>; remaining: number | null }

/** Website check overview (admin / manager). Only admin can start a check run. */
export default function WebsiteChecks({ canRun }: { canRun: boolean }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ checked: number; remaining: number | null; last: Record<string, number> } | null>(null);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_website_check_stats');
    if (rpcError) setError(rpcError.message);
    else {
      setError('');
      const next: Record<string, number> = {};
      for (const row of (data ?? []) as { bucket: string; total: number }[]) next[row.bucket] = Number(row.total);
      setStats(next);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run() {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    setError('');
    let checked = 0;
    try {
      // One batch per call until nothing is left (or the user presses Stop)
      while (!stopRef.current) {
        const { data, error: fnError } = await supabase.functions.invoke('check-websites', { body: { batch: 40 } });
        if (fnError) {
          let detail = fnError.message;
          try { detail = (await (fnError as { context?: Response }).context?.json())?.error ?? detail; } catch { /* keep message */ }
          setError(detail);
          break;
        }
        const res = data as RunResult;
        checked += res.checked;
        setProgress({ checked, remaining: res.remaining, last: res.by_category ?? {} });
        if (res.checked === 0 || res.remaining === 0) break;
      }
    } finally {
      setRunning(false);
      await load();
    }
  }

  const reasons = Object.entries(stats)
    .filter(([k]) => k.startsWith('cat:'))
    .map(([k, n]) => [k.slice(4), n] as const)
    .sort((a, b) => b[1] - a[1]);
  const maxReason = Math.max(1, ...reasons.map(([, n]) => n));

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-white font-semibold">{t('Website checks')}</h3>
          <p className="text-xs text-[#6b6b6b]">{t('Automatic check of client websites: working or not, and why.')}</p>
        </div>
        {canRun && (
          <div className="flex gap-2">
            {running && <Button variant="danger" size="sm" onClick={() => { stopRef.current = true; }}>{t('Stop')}</Button>}
            <Button size="sm" onClick={() => void run()} disabled={running}>{running ? t('Checking…') : t('Check now')}</Button>
          </div>
        )}
      </div>

      {error && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]">{t(error)}</div>}

      {progress && (
        <div className="rounded bg-[#1a1a1a] p-3 text-sm" aria-live="polite">
          <div className="text-white">
            {t('Checked {n} websites', { n: progress.checked.toLocaleString('en-US') })}
            {progress.remaining != null && <> · {t('{n} left', { n: progress.remaining.toLocaleString('en-US') })}</>}
          </div>
          {progress.remaining != null && progress.checked + progress.remaining > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-[#262626]">
              <div className="h-full bg-[#dfff03] transition-all" style={{ width: `${Math.round((progress.checked / (progress.checked + progress.remaining)) * 100)}%` }} />
            </div>
          )}
          {Object.keys(progress.last).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#a0a0a0]">
              <span className="text-[#6b6b6b]">{t('Last batch')}:</span>
              {Object.entries(progress.last).map(([k, n]) => <span key={k}>{t(websiteCategoryLabel(k))}: {n}</span>)}
            </div>
          )}
        </div>
      )}

      {loading && !Object.keys(stats).length ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded bg-[#1a1a1a]" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([
              ['working', 'Working', 'text-[#64dc78]', '●'],
              ['not_working', 'Not working', 'text-[#ff8888]', '✕'],
              ['unchecked', 'Not checked', 'text-[#a0a0a0]', '○'],
              ['no_website', 'No website', 'text-[#6b6b6b]', '—'],
            ] as const).map(([key, label, color, icon]) => (
              <div key={key} className="rounded bg-[#1a1a1a] p-3">
                <div className="text-xs text-[#6b6b6b]">{icon} {t(label)}</div>
                <div className={`mt-1 text-xl font-bold ${color}`}>{(stats[key] ?? 0).toLocaleString('en-US')}</div>
              </div>
            ))}
          </div>
          {reasons.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Results by reason')}</div>
              {reasons.map(([code, n]) => (
                <div key={code} className="flex items-center gap-3 text-sm">
                  <span className="w-48 shrink-0 truncate text-[#d0d0d0]">{t(websiteCategoryLabel(code))}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-[#1e1e1e]">
                    <div className={`h-full ${code === 'ok' || code === 'ok_protected' ? 'bg-[#64dc78]/70' : 'bg-[#ff6464]/70'}`} style={{ width: `${(n / maxReason) * 100}%` }} />
                  </div>
                  <span className="w-16 text-end font-mono text-xs text-[#a0a0a0]">{n.toLocaleString('en-US')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#4a4a4a]">{t('No websites checked yet.')}</p>
          )}
        </>
      )}
    </Card>
  );
}
