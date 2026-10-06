import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { dateLocale } from '../../i18n/locale';
import { Button, Card, Modal, Pagination, Select, WebsiteLink } from '../ui';
import { TableSkeleton } from '../shared/motion';

/** Text areas: one item per line. */
const LIST_FIELDS = [
  'sectors', 'cities', 'extra_queries', 'sector_templates', 'city_templates',
  'allowed_tlds', 'skip_domains', 'contact_paths',
  'saudi_signals', 'app_signals', 'dashboard_signals', 'wordpress_signals',
] as const;
const NUMBER_FIELDS = ['pages_per_query', 'serper_per_min', 'fetch_per_min'] as const;
const REQUIRE_OPTIONS = [
  { key: 'app', label: 'Mobile app' },
  { key: 'dashboard', label: 'Dashboard / client portal' },
  { key: 'wordpress', label: 'WordPress' },
] as const;

const FIELD_LABELS: Record<string, string> = {
  sectors: 'Sectors', cities: 'Cities', extra_queries: 'Extra queries',
  sector_templates: 'Sector query templates', city_templates: 'City query templates',
  allowed_tlds: 'Allowed domain endings', skip_domains: 'Skipped domains', contact_paths: 'Contact page paths',
  saudi_signals: 'Saudi signals', app_signals: 'App signals', dashboard_signals: 'Dashboard signals', wordpress_signals: 'WordPress signals',
  pages_per_query: 'Pages per query (1–5)', serper_per_min: 'Searches per minute', fetch_per_min: 'Site fetches per minute',
};

type Config = Record<string, unknown>;
type Form = Record<(typeof LIST_FIELDS)[number] | (typeof NUMBER_FIELDS)[number], string> & { require_any: string[] };

interface Progress {
  run_id: string; status: 'running' | 'paused' | 'done' | 'stopped'; total_queries: number; done_queries: number;
  pending_pages: number; found: number; new_results: number; duplicates: number; errors: number;
  last_error: string | null; created_at: string; finished_at: string | null;
}
interface Result {
  id: string; name: string | null; url: string; domain: string; phone: string | null; phones: string[] | null;
  features: string[] | null; notes: string | null; status: string; found_at: string;
}

const PAGE_SIZE = 100;
const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

function toForm(cfg: Config): Form {
  const f = { require_any: asList(cfg.require_any) } as Form;
  for (const k of LIST_FIELDS) f[k] = asList(cfg[k]).join('\n');
  for (const k of NUMBER_FIELDS) f[k] = cfg[k] == null ? '' : String(cfg[k]);
  return f;
}

/** Keeps any keys the form does not know about. */
function toConfig(base: Config, f: Form): Config {
  const out: Config = { ...base, require_any: f.require_any };
  for (const k of LIST_FIELDS) out[k] = lines(f[k]);
  for (const k of NUMBER_FIELDS) out[k] = Number(f[k]) || 0;
  out.pages_per_query = Math.min(5, Math.max(1, Number(f.pages_per_query) || 1));
  return out;
}

/** Admin only: find new client websites (Serper search + site checks run by the database cron). */
export default function AdminDiscovery() {
  const { t, lang } = useI18n();
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    window.setTimeout(() => setToast(cur => (cur?.text === text ? null : cur)), 4500);
  };

  // ---------- Serper key ----------
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState('');

  const loadKey = useCallback(async () => {
    const { data, error } = await supabase.rpc('has_discovery_serper_key');
    if (error) setKeyError(error.message);
    else setHasKey(Boolean(data));
  }, []);

  async function saveKey() {
    if (!keyDraft.trim() || keyBusy) return;
    setKeyBusy(true);
    setKeyError('');
    const { error } = await supabase.rpc('set_discovery_serper_key', { p_key: keyDraft.trim() });
    setKeyBusy(false);
    setKeyDraft(''); // never keep the key in the page
    if (error) { setKeyError(error.message); return; }
    setKeyEditing(false);
    showToast(true, t('Key saved'));
    await loadKey();
  }

  // ---------- Settings ----------
  const [baseConfig, setBaseConfig] = useState<Config>({});
  const [form, setForm] = useState<Form | null>(null);
  const [instructions, setInstructions] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [configBusy, setConfigBusy] = useState<'' | 'save' | 'reset'>('');
  const [resetOpen, setResetOpen] = useState(false);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const [cfgRes, rowRes] = await Promise.all([
      supabase.rpc('get_discovery_config', { p_name: 'default' }),
      supabase.from('discovery_configs').select('instructions').eq('name', 'default').maybeSingle(),
    ]);
    if (cfgRes.error) setConfigError(cfgRes.error.message);
    else {
      setConfigError(rowRes.error?.message ?? '');
      const cfg = (cfgRes.data ?? {}) as Config;
      setBaseConfig(cfg);
      setForm(toForm(cfg));
      setInstructions((rowRes.data as { instructions?: string | null } | null)?.instructions ?? '');
    }
    setConfigLoading(false);
  }, []);

  const expectedQueries = useMemo(() => {
    if (!form) return 0;
    const n = (k: (typeof LIST_FIELDS)[number]) => lines(form[k]).length;
    const pages = Math.min(5, Math.max(1, Number(form.pages_per_query) || 1));
    return (n('sectors') * n('sector_templates') + n('sectors') * n('cities') * n('city_templates') + n('extra_queries')) * pages;
  }, [form]);

  async function saveConfig(silent = false): Promise<boolean> {
    if (!form) return false;
    setConfigBusy('save');
    const { error } = await supabase.rpc('save_discovery_config', {
      p_config: toConfig(baseConfig, form), p_name: 'default', p_instructions: instructions.trim() || null,
    });
    setConfigBusy('');
    if (error) { showToast(false, error.message); return false; }
    if (!silent) showToast(true, t('Settings saved'));
    await loadConfig();
    return true;
  }

  async function resetConfig() {
    setConfigBusy('reset');
    const { data, error } = await supabase.rpc('discovery_default_config');
    setConfigBusy('');
    setResetOpen(false);
    if (error) { showToast(false, error.message); return; }
    setForm(toForm((data ?? {}) as Config));
    showToast(true, t('Default settings loaded — press Save to keep them'));
  }

  // ---------- Run ----------
  const [progress, setProgress] = useState<Progress | null>(null);
  const [runError, setRunError] = useState('');
  const [runBusy, setRunBusy] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);

  const loadProgress = useCallback(async () => {
    const { data, error } = await supabase.rpc('discovery_progress');
    if (error) { setRunError(error.message); return; }
    setRunError('');
    const row = (Array.isArray(data) ? data[0] : data) as Progress | undefined;
    setProgress(row ? { ...row, done_queries: Number(row.done_queries), pending_pages: Number(row.pending_pages), found: Number(row.found), new_results: Number(row.new_results) } : null);
  }, []);

  const active = progress?.status === 'running' || progress?.status === 'paused';

  async function startRun() {
    if (runBusy) return;
    setRunBusy(true);
    const saved = await saveConfig(true);
    if (!saved) { setRunBusy(false); return; }
    const { error } = await supabase.rpc('start_discovery_run', { p_name: 'default' });
    setRunBusy(false);
    if (error) { showToast(false, error.message); return; }
    showToast(true, t('Search started'));
    await loadProgress();
  }

  async function setRunState(state: 'running' | 'paused' | 'stopped') {
    if (!progress || runBusy) return;
    setRunBusy(true);
    const { error } = await supabase.rpc('set_discovery_run_state', { p_run: progress.run_id, p_state: state });
    setRunBusy(false);
    setStopOpen(false);
    if (error) { showToast(false, error.message); return; }
    await loadProgress();
  }

  // ---------- Results ----------
  const [results, setResults] = useState<Result[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [resultsError, setResultsError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [quality, setQuality] = useState('normal');
  const [resultBusy, setResultBusy] = useState<'' | 'selected' | 'all' | 'reject'>('');

  const loadResults = useCallback(async (nextPage: number) => {
    setResultsLoading(true);
    const { data, error, count } = await supabase
      .from('discovery_results')
      .select('id,name,url,domain,phone,phones,features,notes,status,found_at', { count: 'exact' })
      .eq('status', 'new')
      .order('found_at', { ascending: false })
      .order('id', { ascending: false })
      .range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1);
    if (error) setResultsError(error.message);
    else {
      setResultsError('');
      setResults((data ?? []) as Result[]);
      setResultsTotal(count ?? 0);
      setPage(nextPage);
    }
    setResultsLoading(false);
  }, []);

  async function approve(ids: string[] | null, kind: 'selected' | 'all') {
    if (resultBusy) return;
    setResultBusy(kind);
    const { data, error } = await supabase.rpc('approve_discovery_results', { p_ids: ids, p_data_quality: quality });
    setResultBusy('');
    if (error) { showToast(false, error.message); return; }
    const row = (Array.isArray(data) ? data[0] : data) as { added: number; duplicates: number } | undefined;
    showToast(true, t('Added {a}, skipped {b} duplicates', { a: row?.added ?? 0, b: row?.duplicates ?? 0 }));
    setSelected([]);
    await Promise.all([loadResults(0), loadProgress()]);
  }

  async function reject() {
    if (!selected.length || resultBusy) return;
    setResultBusy('reject');
    const { data, error } = await supabase.rpc('reject_discovery_results', { p_ids: selected });
    setResultBusy('');
    if (error) { showToast(false, error.message); return; }
    showToast(true, t('Rejected {n}', { n: Number(data ?? 0) }));
    setSelected([]);
    await loadResults(page);
  }

  // ---------- Load + poll ----------
  useEffect(() => {
    void loadKey();
    void loadConfig();
    void loadProgress();
    void loadResults(0);
  }, [loadKey, loadConfig, loadProgress, loadResults]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void loadProgress();
      if (page === 0 && !selected.length) void loadResults(0);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, loadProgress, loadResults, page, selected.length]);

  const pct = progress && progress.total_queries > 0 ? Math.min(100, Math.round((progress.done_queries / progress.total_queries) * 100)) : 0;
  const statusLabel: Record<string, string> = { running: 'Running', paused: 'Paused', done: 'Finished', stopped: 'Stopped' };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(lang), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const input = 'w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60';
  const allOnPage = results.length > 0 && results.every(r => selected.includes(r.id));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-white text-2xl font-bold">{t('Lead discovery')}</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">{t('Find Saudi websites with a mobile app, a client dashboard or WordPress, review them, then add them as clients.')}</p>
      </div>

      {/* 1) Serper key */}
      <Card className="p-4 space-y-3 anim-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-white font-semibold">{t('Serper API key')}</h3>
            <p className="text-xs text-[#6b6b6b]">{t('Used by the server only. It is never shown or kept in the browser.')}</p>
          </div>
          {hasKey && !keyEditing && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#64dc78]">✓ {t('Key saved')}</span>
              <Button size="sm" variant="secondary" onClick={() => setKeyEditing(true)}>{t('Change')}</Button>
            </div>
          )}
        </div>
        {hasKey === null && !keyError && <div className="h-9 animate-pulse rounded bg-[#1a1a1a]" />}
        {(hasKey === false || keyEditing) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              placeholder={t('Paste the key from serper.dev')}
              className={input}
              dir="ltr"
            />
            <div className="flex gap-2">
              <Button onClick={() => void saveKey()} disabled={keyBusy || !keyDraft.trim()}>{keyBusy ? t('Saving…') : t('Save')}</Button>
              {keyEditing && <Button variant="ghost" onClick={() => { setKeyEditing(false); setKeyDraft(''); }}>{t('Cancel')}</Button>}
            </div>
          </div>
        )}
        {keyError && <div role="alert" className="text-sm text-[#ff8888]">{t(keyError)}</div>}
      </Card>

      {/* 2) Settings */}
      <Card className="anim-card">
        <button onClick={() => setConfigOpen(o => !o)} className="flex w-full items-center justify-between gap-2 p-4 text-start" aria-expanded={configOpen}>
          <div>
            <h3 className="text-white font-semibold">{t('Search settings')}</h3>
            <p className="text-xs text-[#6b6b6b]">{t('Expected searches: {n}', { n: expectedQueries.toLocaleString('en-US') })}</p>
          </div>
          <span className={`text-[#6b6b6b] transition-transform ${configOpen ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
        </button>
        {configOpen && (
          <div className="space-y-4 border-t border-[#262626] p-4">
            {configError && <div role="alert" className="text-sm text-[#ff8888]">{t(configError)}</div>}
            {configLoading && !form ? <TableSkeleton rows={4} cols={1} /> : form && (
              <>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {(['sectors', 'cities', 'extra_queries'] as const).map(k => (
                    <label key={k} className="text-xs text-[#a0a0a0]">{t(FIELD_LABELS[k])} <span className="text-[#4a4a4a]">({lines(form[k]).length})</span>
                      <textarea rows={7} dir="auto" className={`mt-1 ${input}`} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {(['sector_templates', 'city_templates'] as const).map(k => (
                    <label key={k} className="text-xs text-[#a0a0a0]">{t(FIELD_LABELS[k])}
                      <textarea rows={5} dir="auto" className={`mt-1 ${input}`} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[#6b6b6b]">{t('In the templates, {sector} and {city} are replaced by each sector and city.')}</p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {NUMBER_FIELDS.map(k => (
                    <label key={k} className="text-xs text-[#a0a0a0]">{t(FIELD_LABELS[k])}
                      <input type="number" min={1} max={k === 'pages_per_query' ? 5 : undefined} className={`mt-1 ${input}`} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-xs text-[#a0a0a0]">{t('Keep sites that have at least one of')}</legend>
                  <div className="flex flex-wrap gap-4">
                    {REQUIRE_OPTIONS.map(o => (
                      <label key={o.key} className="flex items-center gap-2 text-sm text-[#d0d0d0]">
                        <input
                          type="checkbox"
                          className="accent-[#dfff03]"
                          checked={form.require_any.includes(o.key)}
                          onChange={e => setForm({ ...form, require_any: e.target.checked ? [...form.require_any, o.key] : form.require_any.filter(x => x !== o.key) })}
                        />
                        {t(o.label)}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {(['allowed_tlds', 'skip_domains', 'contact_paths'] as const).map(k => (
                    <label key={k} className="text-xs text-[#a0a0a0]">{t(FIELD_LABELS[k])}
                      <textarea rows={5} dir="ltr" className={`mt-1 ${input} font-mono text-xs`} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {(['saudi_signals', 'app_signals', 'dashboard_signals', 'wordpress_signals'] as const).map(k => (
                    <label key={k} className="text-xs text-[#a0a0a0]">{t(FIELD_LABELS[k])}
                      <textarea rows={5} dir="auto" className={`mt-1 ${input} text-xs`} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>

                <label className="block text-xs text-[#a0a0a0]">{t('Notes / instructions for these settings')}
                  <textarea rows={3} dir="auto" className={`mt-1 ${input}`} value={instructions} onChange={e => setInstructions(e.target.value)} />
                </label>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" disabled={!!configBusy} onClick={() => setResetOpen(true)}>{t('Back to defaults')}</Button>
                  <Button disabled={!!configBusy} onClick={() => void saveConfig()}>{configBusy === 'save' ? t('Saving…') : t('Save')}</Button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      {/* 3) Run */}
      <Card className="p-4 space-y-3 anim-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-white font-semibold">{t('Search run')}</h3>
            <p className="text-xs text-[#6b6b6b]">
              {progress ? `${t(statusLabel[progress.status] ?? progress.status)} · ${fmt(progress.created_at)}` : t('No search has run yet.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {progress?.status === 'running' && <Button size="sm" variant="secondary" disabled={runBusy} onClick={() => void setRunState('paused')}>{t('Pause')}</Button>}
            {progress?.status === 'paused' && <Button size="sm" variant="secondary" disabled={runBusy} onClick={() => void setRunState('running')}>{t('Resume')}</Button>}
            {active && <Button size="sm" variant="danger" disabled={runBusy} onClick={() => setStopOpen(true)}>{t('Finish')}</Button>}
            {!active && (
              <Button size="sm" disabled={runBusy || !hasKey || !form} onClick={() => void startRun()}>
                {runBusy ? t('Starting…') : t('Start search')}
              </Button>
            )}
          </div>
        </div>
        {!hasKey && hasKey !== null && <p className="text-xs text-[#ffc832]">{t('Save the Serper key first.')}</p>}
        {runError && <div role="alert" className="text-sm text-[#ff8888]">{t(runError)}</div>}
        {progress && (
          <>
            <div aria-live="polite">
              <div className="mb-1 flex justify-between text-xs text-[#a0a0a0]">
                <span>{t('Searches {a} of {b}', { a: progress.done_queries.toLocaleString('en-US'), b: progress.total_queries.toLocaleString('en-US') })}</span>
                <span className="font-mono">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-[#262626]">
                <div className={`h-full transition-all ${progress.status === 'paused' ? 'bg-[#ffc832]' : 'bg-[#dfff03]'}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {([
                ['Found', progress.found, 'text-white'],
                ['New to review', progress.new_results, 'text-[#dfff03]'],
                ['Duplicates skipped', progress.duplicates, 'text-[#a0a0a0]'],
                ['Sites waiting', progress.pending_pages, 'text-[#a0a0a0]'],
                ['Errors', progress.errors, progress.errors > 0 ? 'text-[#ff8888]' : 'text-[#a0a0a0]'],
              ] as const).map(([label, value, color]) => (
                <div key={label} className="rounded bg-[#1a1a1a] p-2.5">
                  <div className="text-[11px] text-[#6b6b6b]">{t(label)}</div>
                  <div className={`text-lg font-bold tabular-nums ${color}`}>{Number(value).toLocaleString('en-US')}</div>
                </div>
              ))}
            </div>
            {progress.last_error && (
              <div className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-2 text-xs text-[#ffc832]">! {progress.last_error}</div>
            )}
          </>
        )}
      </Card>

      {/* 4) Results */}
      <Card className="anim-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262626] p-4">
          <div>
            <h3 className="text-white font-semibold">{t('Results to review')}</h3>
            <p className="text-xs text-[#6b6b6b]">
              {t('{n} new', { n: resultsTotal.toLocaleString('en-US') })}{selected.length > 0 && ` · ${t('{n} selected', { n: selected.length })}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={quality} onChange={setQuality} className="w-32" options={[{ value: 'high', label: 'high' }, { value: 'medium', label: 'medium' }, { value: 'normal', label: 'normal' }]} />
            <Button size="sm" disabled={!selected.length || !!resultBusy} onClick={() => void approve(selected, 'selected')}>
              {resultBusy === 'selected' ? t('Adding…') : t('Add selected as clients')}
            </Button>
            <Button size="sm" variant="secondary" disabled={!resultsTotal || !!resultBusy} onClick={() => void approve(null, 'all')}>
              {resultBusy === 'all' ? t('Adding…') : t('Add all new')}
            </Button>
            <Button size="sm" variant="danger" disabled={!selected.length || !!resultBusy} onClick={() => void reject()}>
              {resultBusy === 'reject' ? t('Rejecting…') : t('Reject selected')}
            </Button>
          </div>
        </div>
        {resultsError && <div role="alert" className="m-4 text-sm text-[#ff8888]">{t(resultsError)}</div>}
        {resultsLoading && !results.length ? <div className="p-4"><TableSkeleton /></div> : results.length === 0 ? (
          !resultsError && <p className="p-8 text-center text-sm text-[#4a4a4a]">{t('No new results. Start a search to find websites.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm anim-rows">
              <thead>
                <tr className="border-b border-[#262626] text-xs uppercase tracking-wider text-[#6b6b6b]">
                  <th className="px-4 py-3 text-start">
                    <input type="checkbox" className="accent-[#dfff03]" aria-label={t('Select all')} checked={allOnPage}
                      onChange={() => setSelected(allOnPage ? selected.filter(id => !results.some(r => r.id === id)) : [...new Set([...selected, ...results.map(r => r.id)])])} />
                  </th>
                  <th className="px-4 py-3 text-start font-medium">{t('Name')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('Website')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('Phone')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('Features')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('Notes')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id} className={`border-b border-[#1e1e1e] ${selected.includes(r.id) ? 'bg-[#dfff03]/5' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" className="accent-[#dfff03]" aria-label={r.name ?? r.domain} checked={selected.includes(r.id)}
                        onChange={() => setSelected(s => (s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id]))} />
                    </td>
                    <td className="px-4 py-3 text-white" dir="auto">{r.name || r.domain}</td>
                    <td className="px-4 py-3"><WebsiteLink url={r.url} className="text-xs text-[#a0a0a0] break-all" /></td>
                    <td className="px-4 py-3 font-mono text-xs text-[#d0d0d0]" dir="ltr">{r.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(r.features ?? []).map(f => <span key={f} className="rounded bg-[#dfff03]/10 px-1.5 py-0.5 text-[11px] text-[#dfff03] whitespace-nowrap">{f}</span>)}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-xs text-xs text-[#a0a0a0]" dir="auto">{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={resultsTotal} onChange={next => { setSelected([]); void loadResults(next); }} />
      </Card>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Back to default settings?">
        <div className="space-y-4">
          <p className="text-sm text-[#d0d0d0]">{t('The form will be filled with the default sectors, cities and signals. Nothing is saved until you press Save.')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResetOpen(false)}>{t('Cancel')}</Button>
            <Button disabled={configBusy === 'reset'} onClick={() => void resetConfig()}>{t('Load defaults')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={stopOpen} onClose={() => setStopOpen(false)} title="Finish this search?">
        <div className="space-y-4">
          <p className="text-sm text-[#d0d0d0]">{t('Remaining searches are cancelled. Results already found stay for review.')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStopOpen(false)}>{t('Cancel')}</Button>
            <Button variant="danger" disabled={runBusy} onClick={() => void setRunState('stopped')}>{t('Finish')}</Button>
          </div>
        </div>
      </Modal>

      {toast && (
        <div role="status" className={`fixed bottom-4 start-1/2 z-50 -translate-x-1/2 rtl:translate-x-1/2 w-max max-w-[calc(100vw-2rem)] rounded-lg border px-4 py-2.5 text-sm shadow-lg anim-banner ${toast.ok ? 'border-[#64dc78]/30 bg-[#0f1a12] text-[#64dc78]' : 'border-[#ff6464]/30 bg-[#1a0f0f] text-[#ff8888]'}`}>
          {toast.ok ? '✓ ' : '✕ '}{t(toast.text)}
        </div>
      )}
    </div>
  );
}
