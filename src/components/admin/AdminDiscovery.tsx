import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { dateLocale } from '../../i18n/locale';
import { Button, Card, Modal, Pagination, Select, Toggle, WebsiteLink, stickyHead, tableScroll } from '../ui';
import { toast } from '../shared/toast';
import { TableSkeleton } from '../shared/motion';
import { PLATFORM_GROUPS_EN, PLATFORM_PRESETS, PlatformPreset } from './discoveryPlatforms';

// ---------- Config shape (043) ----------
interface CountryDef { name_ar: string; name_en: string; gl: string; tld: string; query_word: string; cc: string; signals: string[]; extra_queries: string[]; cities: string[] }
interface CustomFeature { label: string; keywords: string[] }
interface Config {
  countries: string[];
  country_defs: Record<string, CountryDef>;
  /** any_site (046): accept any website in the chosen countries, whatever the platform. */
  features: { app: boolean; dashboard: boolean; wordpress: boolean; any_site?: boolean };
  custom_features: CustomFeature[];
  sectors: string[];
  include_cities: boolean;
  pages_per_query: number; serper_per_min: number; fetch_per_min: number;
  skip_domains: string[]; contact_paths: string[];
  app_signals: string[]; dashboard_signals: string[]; wordpress_signals: string[];
  [key: string]: unknown;
}

const FEATURES = [
  { key: 'wordpress', label: 'WordPress' },
  { key: 'app', label: 'Mobile app' },
  { key: 'dashboard', label: 'Dashboard / client portal' },
  { key: 'any_site', label: 'Any regular website (any platform)' },
] as const;
type Features = Config['features'];
const NO_FEATURES = { app: false, dashboard: false, wordpress: false, any_site: false };
/** Always send all four keys as explicit true/false (053). */
const explicitFeatures = (f: Partial<Features> | null | undefined): Required<Features> => ({
  app: Boolean(f?.app), dashboard: Boolean(f?.dashboard), wordpress: Boolean(f?.wordpress), any_site: Boolean(f?.any_site),
});
const ADV_LISTS =['skip_domains', 'contact_paths', 'app_signals', 'dashboard_signals', 'wordpress_signals'] as const;
const ADV_NUMBERS = ['pages_per_query', 'serper_per_min', 'fetch_per_min'] as const;
type AdvList = (typeof ADV_LISTS)[number];
type AdvNumber = (typeof ADV_NUMBERS)[number];
type Advanced = Record<AdvList | AdvNumber, string> & { country_defs: string };

const FIELD_LABELS: Record<string, string> = {
  skip_domains: 'Skipped domains', contact_paths: 'Contact page paths',
  app_signals: 'App signals', dashboard_signals: 'Dashboard signals', wordpress_signals: 'WordPress signals',
  pages_per_query: 'Search depth (result pages per search)', serper_per_min: 'Searches per minute', fetch_per_min: 'Site fetches per minute',
  country_defs: 'Country definitions (JSON)',
};

interface Progress {
  run_id: string; status: 'running' | 'paused' | 'done' | 'stopped'; total_queries: number; done_queries: number;
  pending_pages: number; found: number; new_results: number; duplicates: number; errors: number;
  last_error: string | null; created_at: string; finished_at: string | null;
}
interface Result {
  id: string; name: string | null; url: string; domain: string; phone: string | null; phones: string[] | null;
  features: string[] | null; notes: string | null; status: string; found_at: string; country: string | null; country_code: string | null;
}

/** Quick choices for pages_per_query; 50 = "until the last result". */
const DEPTH_CHOICES = [1, 2, 5, 10, 50] as const;
const PRESET_LABELS = new Set(PLATFORM_PRESETS.map(p => p.label));
const splitItems = (s: string) => s.split(/[\n,،]/).map(x => x.trim()).filter(Boolean);

type Quality = 'normal' | 'medium' | 'high';
/** Client type when adding results: auto = Salla if the result was matched on Salla, else software (054). */
type TypeChoice = 'auto' | 'salla' | 'software';
const TYPE_VALUE: Record<TypeChoice, boolean | null> = { auto: null, salla: true, software: false };
const TYPE_LABEL: Record<TypeChoice, string> = { auto: 'Auto (as detected)', salla: 'Salla Store', software: 'Software' };
const QUALITY_KEY = 'discovery.addQuality';
const TYPE_KEY = 'discovery.addType';
const readSession = (k: string) => { try { return window.sessionStorage.getItem(k); } catch { return null; } };
const writeSession = (k: string, v: string) => { try { window.sessionStorage.setItem(k, v); } catch { /* storage blocked: keep in state only */ } };

const PAGE_SIZE = 100;
const POLL_MS = 5000;
const RUN_STATE_TIMEOUT_MS = 15_000;
const ESTIMATE_WARN = 3000;
/** Warn above the Start button for searches bigger than this. */
const SERPER_WARN = 2000;
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const uniq = (xs: string[]) => [...new Set(xs)];

function toAdvanced(cfg: Config): Advanced {
  const a = { country_defs: JSON.stringify(cfg.country_defs ?? {}, null, 2) } as Advanced;
  for (const k of ADV_LISTS) a[k] = asList(cfg[k]).join('\n');
  for (const k of ADV_NUMBERS) a[k] = cfg[k] == null ? '' : String(cfg[k]);
  return a;
}

/** Admin only: find new client websites (Serper search + site checks run by the database cron). */
export default function AdminDiscovery() {
  const { t, lang } = useI18n();
  const showToast = (ok: boolean, text: string) => toast(t(text), ok);

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
  const [cfg, setCfg] = useState<Config | null>(null);
  const [sectorCatalog, setSectorCatalog] = useState<string[]>([]);
  const [allSectors, setAllSectors] = useState(true);
  const [sectorSearch, setSectorSearch] = useState('');
  const [newSector, setNewSector] = useState('');
  const [platformSearch, setPlatformSearch] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customKeywords, setCustomKeywords] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [adv, setAdv] = useState<Advanced | null>(null);
  const [instructions, setInstructions] = useState('');
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [configBusy, setConfigBusy] = useState<'' | 'save' | 'reset'>('');
  const [resetOpen, setResetOpen] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);

  /** fresh = loading the defaults: every "what to look for" chip starts off (053: nothing selected = any site). */
  const applyConfig = useCallback((next: Config, defaults: Config | null, fresh = false) => {
    const catalog = uniq([...asList(defaults?.sectors), ...asList(next.sectors)]);
    setCfg({
      ...next,
      features: fresh ? { ...NO_FEATURES } : explicitFeatures(next.features),
      custom_features: !fresh && Array.isArray(next.custom_features) ? next.custom_features : [],
    });
    setSectorCatalog(catalog);
    setAllSectors(catalog.every(s => next.sectors?.includes(s)));
    setAdv(toAdvanced(next));
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const [cfgRes, defRes, rowRes] = await Promise.all([
      supabase.rpc('get_discovery_config', { p_name: 'default' }),
      supabase.rpc('discovery_default_config'),
      supabase.from('discovery_configs').select('instructions').eq('name', 'default').maybeSingle(),
    ]);
    const err = cfgRes.error?.message || defRes.error?.message || rowRes.error?.message || '';
    setConfigError(err);
    if (!cfgRes.error) {
      applyConfig(cfgRes.data as Config, defRes.error ? null : (defRes.data as Config));
      setInstructions((rowRes.data as { instructions?: string | null } | null)?.instructions ?? '');
    }
    setConfigLoading(false);
  }, [applyConfig]);

  /** The config to save / estimate: simple choices + advanced fields. null = advanced JSON is invalid. */
  const built = useMemo<{ config: Config | null; error: string }>(() => {
    if (!cfg || !adv) return { config: null, error: '' };
    let countryDefs: Record<string, CountryDef>;
    try {
      countryDefs = JSON.parse(adv.country_defs || '{}');
      if (!countryDefs || typeof countryDefs !== 'object' || Array.isArray(countryDefs)) throw new Error();
    } catch {
      return { config: null, error: 'Country definitions are not valid JSON.' };
    }
    const out: Config = { ...cfg, features: explicitFeatures(cfg.features), country_defs: countryDefs, sectors: allSectors ? sectorCatalog : cfg.sectors };
    for (const k of ADV_LISTS) out[k] = lines(adv[k]);
    for (const k of ADV_NUMBERS) out[k] = Number(adv[k]) || 0;
    out.pages_per_query = Math.max(1, Math.floor(Number(adv.pages_per_query) || 1));
    out.countries = cfg.countries.filter(c => countryDefs[c]);
    return { config: out, error: '' };
  }, [cfg, adv, allSectors, sectorCatalog]);

  const builtKey = built.config ? JSON.stringify(built.config) : '';

  // Estimate the Serper requests 400ms after the last change
  useEffect(() => {
    if (!built.config) { setEstimate(null); return; }
    const snapshot = built.config;
    setEstimating(true);
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc('discovery_estimate', { p_config: snapshot });
      setEstimating(false);
      setEstimate(error ? null : Number(data ?? 0));
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builtKey]);

  const hasCustom = (cfg?.custom_features.length ?? 0) > 0;
  const onFeatures = cfg ? FEATURES.filter(f => cfg.features?.[f.key]).length : 0;
  const anySiteOn = Boolean(cfg?.features?.any_site);
  const nothingSelected = onFeatures === 0 && !hasCustom;
  /** "Any site" together with a platform/feature returns every site, not only that platform. */
  const anySiteMixed = anySiteOn && (hasCustom || onFeatures > 1);

  function toggleCountry(code: string) {
    if (!cfg) return;
    const on = cfg.countries.includes(code);
    if (on && cfg.countries.length === 1) { showToast(false, t('Choose at least one country')); return; }
    setCfg({ ...cfg, countries: on ? cfg.countries.filter(c => c !== code) : [...cfg.countries, code] });
  }

  function toggleFeature(key: (typeof FEATURES)[number]['key']) {
    if (!cfg) return;
    const on = Boolean(cfg.features?.[key]);
    if (key === 'any_site' && !on) {
      // "Any site" and a specific platform contradict each other: turning it on clears the rest
      setCfg({ ...cfg, features: { ...NO_FEATURES, any_site: true }, custom_features: [] });
      return;
    }
    setCfg({ ...cfg, features: { ...explicitFeatures(cfg.features), [key]: !on, ...(key !== 'any_site' && !on ? { any_site: false } : {}) } });
  }

  /** Turns every "what to look for" chip and platform off (= any site, no filter). */
  function clearLookFor() {
    if (!cfg) return;
    setCfg({ ...cfg, features: { ...NO_FEATURES }, custom_features: [] });
  }

  function addCustom() {
    if (!cfg) return;
    const label = customLabel.trim();
    const keywords = uniq(customKeywords.split(/[,،\n]/).map(x => x.trim()).filter(Boolean));
    if (!label || !keywords.length) { showToast(false, t('Write a name and at least one keyword.')); return; }
    setCfg({ ...cfg, features: { ...explicitFeatures(cfg.features), any_site: false }, custom_features: [...cfg.custom_features.filter(f => f.label !== label), { label, keywords }] });
    setCustomLabel('');
    setCustomKeywords('');
  }

  function removeCustom(label: string) {
    if (!cfg) return;
    setCfg({ ...cfg, custom_features: cfg.custom_features.filter(f => f.label !== label) });
  }

  function setAllSectorsOn(on: boolean) {
    if (!cfg) return;
    setAllSectors(on);
    if (!on) setCfg({ ...cfg, sectors: cfg.sectors.length ? cfg.sectors.filter(s => sectorCatalog.includes(s)) : [] });
  }

  function toggleSector(s: string) {
    if (!cfg) return;
    setCfg({ ...cfg, sectors: cfg.sectors.includes(s) ? cfg.sectors.filter(x => x !== s) : [...cfg.sectors, s] });
  }

  /** Adds one or many business types (one per line or comma), no limit. */
  function addSector() {
    if (!cfg) return;
    const items = uniq(splitItems(newSector));
    if (!items.length) return;
    setSectorCatalog(c => uniq([...c, ...items]));
    setCfg({ ...cfg, sectors: uniq([...cfg.sectors, ...items]) });
    setNewSector('');
  }

  function platformOn(p: PlatformPreset) {
    return Boolean(cfg?.custom_features.some(f => f.label === p.label));
  }

  function setPlatforms(list: PlatformPreset[], on: boolean) {
    if (!cfg) return;
    const labels = new Set(list.map(p => p.label));
    const rest = cfg.custom_features.filter(f => !labels.has(f.label));
    const next = on ? [...rest, ...list.map(p => ({ label: p.label, keywords: p.keywords }))] : rest;
    // Picking a platform only adds it to custom_features; it never turns on app / any_site
    setCfg({ ...cfg, features: on ? { ...explicitFeatures(cfg.features), any_site: false } : explicitFeatures(cfg.features), custom_features: next });
  }

  async function saveConfig(silent = false): Promise<boolean> {
    if (!built.config) { showToast(false, t(built.error || 'Settings are not ready yet.')); return false; }
    setConfigBusy('save');
    const { error } = await supabase.rpc('save_discovery_config', {
      p_config: built.config, p_name: 'default', p_instructions: instructions.trim() || null,
    });
    setConfigBusy('');
    if (error) { showToast(false, error.message); return false; }
    if (!silent) showToast(true, t('Settings saved'));
    return true;
  }

  async function resetConfig() {
    setConfigBusy('reset');
    const { data, error } = await supabase.rpc('discovery_default_config');
    setConfigBusy('');
    setResetOpen(false);
    if (error) { showToast(false, error.message); return; }
    applyConfig(data as Config, data as Config, true);
    showToast(true, t('Default settings loaded — press Save to keep them'));
  }

  // ---------- Run ----------
  const [progress, setProgress] = useState<Progress | null>(null);
  const [runError, setRunError] = useState('');
  const [runBusy, setRunBusy] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  const loadProgress = useCallback(async () => {
    const { data, error } = await supabase.rpc('discovery_progress');
    if (error) { setRunError(error.message); return; }
    setRunError('');
    const row = (Array.isArray(data) ? data[0] : data) as Progress | undefined;
    setProgress(row ? { ...row, done_queries: Number(row.done_queries), pending_pages: Number(row.pending_pages), found: Number(row.found), new_results: Number(row.new_results) } : null);
  }, []);

  const active = progress?.status === 'running' || progress?.status === 'paused';

  // ---------- Diagnostics (044) ----------
  const [diag, setDiag] = useState<{ item: string; value: string }[]>([]);
  const [diagError, setDiagError] = useState('');

  const loadDiag = useCallback(async (runId?: string) => {
    const { data, error } = await supabase.rpc('discovery_diagnose', runId ? { p_run: runId } : {});
    if (error) { setDiagError(error.message); return; }
    setDiagError('');
    setDiag((data ?? []) as { item: string; value: string }[]);
  }, []);

  /** Full run: saves the settings, then starts with them as they are (044 fills any missing keys). */
  async function startRun() {
    if (runBusy || !built.config) return;
    setRunBusy(true);
    const saved = await saveConfig(true);
    if (!saved) { setRunBusy(false); return; }
    const { error } = await supabase.rpc('start_discovery_run', { p_name: 'default', p_config: built.config });
    setRunBusy(false);
    if (error) { showToast(false, error.message); return; }
    showToast(true, t('Search started'));
    await loadProgress();
  }

  /** Small trial: same settings, first 3 business types, 1 result page. Not saved. */
  async function startTrial() {
    if (runBusy || !built.config) return;
    const sectors = built.config.sectors.slice(0, 3);
    if (!sectors.length) { showToast(false, t('No search queries — check sectors and countries')); return; }
    setRunBusy(true);
    const { error } = await supabase.rpc('start_discovery_run', { p_name: 'default', p_config: { ...built.config, sectors, pages_per_query: 1 } });
    setRunBusy(false);
    if (error) { showToast(false, error.message); return; }
    showToast(true, t('Small trial started'));
    await loadProgress();
  }

  async function setRunState(state: 'running' | 'paused' | 'stopped') {
    if (!progress || runBusy) return;
    setRunBusy(true);
    setStopOpen(false);
    if (state === 'stopped') setStopping(true); // show "Finishing…" right away, don't wait for the polling
    const { error } = await supabase
      .rpc('set_discovery_run_state', { p_run: progress.run_id, p_state: state })
      .abortSignal(AbortSignal.timeout(RUN_STATE_TIMEOUT_MS));
    setRunBusy(false);
    setStopping(false);
    if (error) {
      const timedOut = /abort|timeout/i.test(`${error.name ?? ''} ${error.message}`);
      showToast(false, timedOut ? t('The server did not answer in 15 seconds — try again.') : error.message);
      return;
    }
    setProgress(p => (p && p.run_id === progress.run_id ? { ...p, status: state } : p));
    await loadProgress();
  }

  // ---------- Results ----------
  const [results, setResults] = useState<Result[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [resultsError, setResultsError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  // Last quality + type choice is kept for the browser session (054)
  const [quality, setQuality] = useState<Quality>(() => {
    const v = readSession(QUALITY_KEY);
    return v === 'high' || v === 'medium' ? v : 'normal';
  });
  const [typeChoice, setTypeChoice] = useState<TypeChoice>(() => {
    const v = readSession(TYPE_KEY);
    return v === 'salla' || v === 'software' ? v : 'auto';
  });
  useEffect(() => { writeSession(QUALITY_KEY, quality); }, [quality]);
  useEffect(() => { writeSession(TYPE_KEY, typeChoice); }, [typeChoice]);
  const [resultBusy, setResultBusy] = useState<'' | 'selected' | 'all' | 'reject'>('');
  const [lastAdd, setLastAdd] = useState<{ received: number; added: number; duplicates: number } | null>(null);

  // Each load gets a number; a load that finishes after a newer load (or after an add / reject) is ignored,
  // so a slow poll can't bring back rows that were just added.
  const resultsReq = useRef(0);
  const resultBusyRef = useRef(false);
  const loadResults = useCallback(async (nextPage: number) => {
    const req = ++resultsReq.current;
    setResultsLoading(true);
    const { data, error, count } = await supabase
      .from('discovery_results')
      .select('id,name,url,domain,phone,phones,features,notes,status,found_at,country,country_code', { count: 'exact' })
      .eq('status', 'new')
      .order('found_at', { ascending: false })
      .order('id', { ascending: false })
      .range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1);
    if (req !== resultsReq.current) return;
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
    const usedType = typeChoice;
    const usedQuality = quality;
    resultBusyRef.current = true;
    setResultBusy(kind);
    const { data, error } = await supabase.rpc('approve_discovery_results', {
      p_ids: ids, p_data_quality: usedQuality, p_is_salla: TYPE_VALUE[usedType],
    });
    resultBusyRef.current = false;
    setResultBusy('');
    if (error) { showToast(false, error.message); return; }
    // The rows are now 'added' / 'duplicate' in the database: drop them from the list right away,
    // and ignore any load that started before the add finished.
    resultsReq.current++;
    if (ids) {
      const gone = new Set(ids);
      setResults(rs => rs.filter(r => !gone.has(r.id)));
      setResultsTotal(n => Math.max(0, n - ids.length));
    } else {
      setResults([]);
      setResultsTotal(0);
    }
    setSelected([]);
    const row = (Array.isArray(data) ? data[0] : data) as { received: number; added: number; duplicates: number } | undefined;
    const res = { received: Number(row?.received ?? 0), added: Number(row?.added ?? 0), duplicates: Number(row?.duplicates ?? 0) };
    setLastAdd(res);
    showToast(true, t('Added {a} clients ({type} · {q} quality) · {b} duplicates', {
      a: res.added, b: res.duplicates, type: t(TYPE_LABEL[usedType]), q: t(usedQuality),
    }));
    // Clients page needs nothing here: it loads fresh when opened and listens to realtime on `leads`.
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

  // Diagnostics for the latest run: once when it changes, then every 5s while it runs
  const runId = progress?.run_id;
  useEffect(() => { if (runId) void loadDiag(runId); }, [runId, loadDiag]);

  // Poll every 5s while the run is active (stops on done / stopped); calls run one after the other, never overlapping
  useEffect(() => {
    if (!active || stopping) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      await loadProgress();
      if (cancelled) return;
      if (runId) await loadDiag(runId);
      if (cancelled) return;
      if (page === 0 && !selected.length && !resultBusyRef.current) await loadResults(0);
      if (!cancelled) timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    timer = window.setTimeout(() => void tick(), POLL_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, stopping, loadProgress, loadDiag, runId, loadResults, page, selected.length]);

  const pct = progress && progress.total_queries > 0 ? Math.min(100, Math.round((progress.done_queries / progress.total_queries) * 100)) : 0;
  const statusLabel: Record<string, string> = { running: 'Running', paused: 'Paused', done: 'Finished', stopped: 'Stopped' };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(lang), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const input = 'w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60';
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-[#dfff03]/60 bg-[#dfff03]/10 text-[#dfff03]' : 'border-[#2a2a2a] text-[#a0a0a0] hover:border-[#4a4a4a] hover:text-white'}`;
  const allOnPage = results.length > 0 && results.every(r => selected.includes(r.id));
  const countryName = (code: string | null, fallback: string | null) => {
    const d = code ? cfg?.country_defs?.[code] : undefined;
    return d ? (lang === 'ar' ? d.name_ar : d.name_en) : fallback || '—';
  };
  const visibleSectors = sectorCatalog.filter(s => !sectorSearch.trim() || s.toLowerCase().includes(sectorSearch.trim().toLowerCase()));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-white text-2xl font-bold">{t('Lead discovery')}</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">{t('Find Gulf websites with a mobile app, a client dashboard or WordPress, review them, then add them as clients.')}</p>
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
            <input type="password" autoComplete="off" value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
              placeholder={t('Paste the key from serper.dev')} className={input} dir="ltr" />
            <div className="flex gap-2">
              <Button onClick={() => void saveKey()} disabled={keyBusy || !keyDraft.trim()}>{keyBusy ? t('Saving…') : t('Save')}</Button>
              {keyEditing && <Button variant="ghost" onClick={() => { setKeyEditing(false); setKeyDraft(''); }}>{t('Cancel')}</Button>}
            </div>
          </div>
        )}
        {keyError && <div role="alert" className="text-sm text-[#ff8888]">{t(keyError)}</div>}
      </Card>

      {/* 2) Simple settings */}
      <Card className="p-4 space-y-5 anim-card">
        <h3 className="text-white font-semibold">{t('Search settings')}</h3>
        {configError && <div role="alert" className="text-sm text-[#ff8888]">{t(configError)}</div>}
        {configLoading && !cfg ? <TableSkeleton rows={4} cols={1} /> : cfg && adv && (
          <>
            {/* Countries */}
            <section className="space-y-2">
              <div className="text-sm text-white">{t('Countries')}</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(cfg.country_defs ?? {}).map(([code, d]) => {
                  const on = cfg.countries.includes(code);
                  return (
                    <button key={code} type="button" aria-pressed={on} onClick={() => toggleCountry(code)} className={chip(on)}>
                      {on && <span aria-hidden="true">✓</span>}{lang === 'ar' ? d.name_ar : d.name_en}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[#6b6b6b]">{t('Searches the whole country — no need to pick cities.')}</p>
            </section>

            {/* What to look for */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-white">{t('What are you looking for?')}</div>
                <button type="button" onClick={clearLookFor} disabled={nothingSelected} className="text-xs text-[#dfff03] hover:underline disabled:opacity-40 disabled:no-underline">
                  {t('Unselect all')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {FEATURES.map(f => {
                  const on = Boolean(cfg.features?.[f.key]);
                  return (
                    <button key={f.key} type="button" aria-pressed={on} onClick={() => toggleFeature(f.key)} className={chip(on)}>
                      {on && <span aria-hidden="true">✓</span>}{t(f.label)}
                    </button>
                  );
                })}
                {cfg.custom_features.filter(f => !PRESET_LABELS.has(f.label)).map(f => (
                  <span key={f.label} className={chip(true)} title={f.keywords.join(', ')}>
                    ✓ {f.label}
                    <button type="button" onClick={() => removeCustom(f.label)} aria-label={t('Remove {name}', { name: f.label })} className="ms-1 text-[#dfff03]/70 hover:text-white">×</button>
                  </span>
                ))}
              </div>
              <p className="text-xs text-[#6b6b6b]">{t('"Any regular website" shows every site with the same business types and country, on any platform or none.')}</p>
              {nothingSelected && (
                <p className="text-xs text-[#dfff03]/80">{t('No options selected: the search brings every website, without filtering.')}</p>
              )}
              {anySiteMixed && (
                <div className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-2 text-xs text-[#ffc832]">
                  ! {t('"Any regular website" is on: the search brings every site, not only the selected platforms.')}
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder={t('Add something else to look for (e.g. Shopify)')} className={`${input} sm:w-64`} dir="auto" />
                <input value={customKeywords} onChange={e => setCustomKeywords(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
                  placeholder={t('e.g. cdn.shopify.com, myshopify')} className={input} dir="auto" />
                <Button variant="secondary" onClick={addCustom} disabled={!customLabel.trim() || !customKeywords.trim()}>{t('Add')}</Button>
              </div>
            </section>

            {/* Platforms (saved as custom features) */}
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-white">
                  {t('Platforms & technologies')}
                  <span className="ms-2 text-xs text-[#6b6b6b]">{t('{n} selected', { n: PLATFORM_PRESETS.filter(platformOn).length })}</span>
                </div>
                {anySiteMixed && <span className="text-xs text-[#ffc832]">! {t('Brings every site, not only the platform')}</span>}
                <input value={platformSearch} onChange={e => setPlatformSearch(e.target.value)} placeholder={t('Search platforms…')} className={`${input} sm:w-56`} dir="auto" />
              </div>
              {Object.keys(PLATFORM_GROUPS_EN).map(group => {
                const q = platformSearch.trim().toLowerCase();
                const items = PLATFORM_PRESETS.filter(p => p.group === group && (!q || p.label.toLowerCase().includes(q)));
                if (!items.length) return null;
                const allOn = items.every(platformOn);
                return (
                  <div key={group} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-[#6b6b6b]">{lang === 'ar' ? group : PLATFORM_GROUPS_EN[group]}</span>
                      <button type="button" onClick={() => setPlatforms(items, !allOn)} className="text-xs text-[#dfff03] hover:underline">
                        {allOn ? t('Clear all') : t('Select all')}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map(p => {
                        const on = platformOn(p);
                        return (
                          <button key={p.label} type="button" aria-pressed={on} title={p.keywords.join(', ')} onClick={() => setPlatforms([p], !on)} className={`${chip(on)} py-1 text-xs`}>
                            {on && <span aria-hidden="true">✓</span>}{p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-[#6b6b6b]">{t('The check reads the page code, so results are most accurate for platforms that leave a clear trace in it (Salla, Zid, Shopify, Wix…).')}</p>
            </section>

            {/* Sectors */}
            <section className="space-y-2">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-white">{t('All business types ({n})', { n: sectorCatalog.length })}</span>
                <Toggle checked={allSectors} onChange={setAllSectorsOn} />
              </label>
              {!allSectors && (
                <div className="space-y-2 rounded-lg border border-[#262626] p-3 anim-card">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input value={sectorSearch} onChange={e => setSectorSearch(e.target.value)} placeholder={t('Search business types…')} className={input} dir="auto" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setCfg({ ...cfg, sectors: uniq([...cfg.sectors, ...visibleSectors]) })}>{t('Select all')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setCfg({ ...cfg, sectors: cfg.sectors.filter(s => !visibleSectors.includes(s)) })}>{t('Clear')}</Button>
                    </div>
                  </div>
                  <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                    {visibleSectors.map(s => {
                      const on = cfg.sectors.includes(s);
                      return <button key={s} type="button" aria-pressed={on} onClick={() => toggleSector(s)} className={`${chip(on)} py-1 text-xs`}>{s}</button>;
                    })}
                  </div>
                  <div className="text-xs text-[#6b6b6b]">{t('{n} selected', { n: cfg.sectors.length })}</div>
                </div>
              )}
              {/* Any business type, any number: one per line or comma (paste a whole list) */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <textarea
                  rows={1}
                  value={newSector}
                  onChange={e => setNewSector(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addSector(); } }}
                  placeholder={t('Add business types (e.g. law firms, salons, dental clinics) — paste a list, one per line or comma')}
                  className={`${input} min-h-[38px] resize-y`}
                  dir="auto"
                />
                <Button variant="secondary" onClick={addSector} disabled={!newSector.trim()}>
                  {splitItems(newSector).length > 1 ? t('Add {n}', { n: splitItems(newSector).length }) : t('Add')}
                </Button>
              </div>
              <p className="text-xs text-[#6b6b6b]">{t('The list is only suggestions — choose any number or add your own.')}</p>
            </section>

            {/* Cities */}
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm text-white">{t('Search in cities too (more results, higher cost)')}</span>
              <Toggle checked={Boolean(cfg.include_cities)} onChange={v => setCfg({ ...cfg, include_cities: v })} />
            </label>

            {/* Search depth: no upper limit */}
            <section className="space-y-2">
              <div className="text-sm text-white">{t(FIELD_LABELS.pages_per_query)}</div>
              <div className="flex flex-wrap items-center gap-2">
                {DEPTH_CHOICES.map(n => {
                  const on = Number(adv.pages_per_query) === n;
                  return (
                    <button key={n} type="button" aria-pressed={on} onClick={() => setAdv({ ...adv, pages_per_query: String(n) })} className={`${chip(on)} py-1 text-xs`}>
                      {n === 50 ? t('Until the last result') : n}
                    </button>
                  );
                })}
                <input
                  type="number" min={1} step={1} aria-label={t(FIELD_LABELS.pages_per_query)}
                  value={adv.pages_per_query} onChange={e => setAdv({ ...adv, pages_per_query: e.target.value })}
                  className={`${input} w-24`}
                />
              </div>
            </section>

            {/* Estimate */}
            <div className={`rounded-lg p-3 text-sm ${estimate != null && estimate > ESTIMATE_WARN ? 'border border-[#ffc832]/30 bg-[#ffc832]/10 text-[#ffc832]' : 'bg-[#1a1a1a] text-[#d0d0d0]'}`} aria-live="polite">
              {built.error ? <span className="text-[#ff8888]">{t(built.error)}</span>
                : estimate == null ? (estimating ? t('Calculating…') : '—')
                : <>
                    {t('≈ {n} searches (uses {n} of your Serper credit)', { n: estimate.toLocaleString('en-US') })}
                    {estimating && <span className="ms-2 text-xs text-[#6b6b6b]">…</span>}
                    {estimate > ESTIMATE_WARN && <div className="mt-1 text-xs">{t('That is a lot of searches — make sure your Serper credit covers it. You can still start.')}</div>}
                  </>}
            </div>

            {/* Advanced */}
            <div className="rounded-lg border border-[#262626]">
              <button type="button" onClick={() => setAdvOpen(o => !o)} className="flex w-full items-center justify-between p-3 text-start text-sm text-[#a0a0a0] hover:text-white" aria-expanded={advOpen}>
                {t('Advanced settings')}
                <span className={`transition-transform ${advOpen ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
              </button>
              {advOpen && (
                <div className="space-y-3 border-t border-[#262626] p-3 anim-card">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(['serper_per_min', 'fetch_per_min'] as const).map(k => (
                      <label key={k} className="text-xs text-[#a0a0a0]">{t(FIELD_LABELS[k])}
                        <input type="number" min={1} step={1} className={`mt-1 ${input}`} value={adv[k]} onChange={e => setAdv({ ...adv, [k]: e.target.value })} />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {ADV_LISTS.map(k => (
                      <label key={k} className="text-xs text-[#a0a0a0]">{t(FIELD_LABELS[k])} <span className="text-[#4a4a4a]">({lines(adv[k]).length})</span>
                        <textarea rows={5} dir="auto" className={`mt-1 ${input} text-xs`} value={adv[k]} onChange={e => setAdv({ ...adv, [k]: e.target.value })} />
                      </label>
                    ))}
                  </div>
                  <label className="block text-xs text-[#a0a0a0]">{t(FIELD_LABELS.country_defs)}
                    <textarea rows={10} dir="ltr" spellCheck={false} className={`mt-1 ${input} font-mono text-xs`} value={adv.country_defs} onChange={e => setAdv({ ...adv, country_defs: e.target.value })} />
                  </label>
                  <p className="text-xs text-[#6b6b6b]">{t('Each country has its query word, domain ending, phone code, signals and cities.')}</p>
                  <label className="block text-xs text-[#a0a0a0]">{t('Notes / instructions for these settings')}
                    <textarea rows={3} dir="auto" className={`mt-1 ${input}`} value={instructions} onChange={e => setInstructions(e.target.value)} />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="secondary" disabled={!!configBusy} onClick={() => setResetOpen(true)}>{t('Back to defaults')}</Button>
                    <Button size="sm" disabled={!!configBusy} onClick={() => void saveConfig()}>{configBusy === 'save' ? t('Saving…') : t('Save')}</Button>
                  </div>
                </div>
              )}
            </div>
          </>
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
            {active && <Button size="sm" variant="danger" disabled={runBusy || stopping} onClick={() => setStopOpen(true)}>{stopping ? t('Finishing…') : t('Finish')}</Button>}
            {!active && (
              <>
                <Button size="sm" variant="secondary" disabled={runBusy || !hasKey || !built.config} onClick={() => void startTrial()}>
                  {t('Small trial')}
                </Button>
                <Button size="sm" disabled={runBusy || !hasKey || !built.config} onClick={() => void startRun()}>
                  {runBusy ? t('Starting…') : t('Start search')}
                </Button>
              </>
            )}
          </div>
        </div>
        {!active && estimate != null && estimate > SERPER_WARN && (
          <div className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-2 text-xs text-[#ffc832]">
            ! {t('This is a big search ({n}) and will use Serper credit — try a small trial with one or two business types first.', { n: estimate.toLocaleString('en-US') })}
          </div>
        )}
        {!hasKey && hasKey !== null && <p className="text-xs text-[#ffc832]">{t('Save the Serper key first.')}</p>}
        {!active && <p className="text-xs text-[#6b6b6b]">{t('Starting saves the settings above first.')} {t('Small trial = same settings, first 3 business types and 1 result page (not saved).')}</p>}
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

            {/* Diagnostics (044) */}
            <details className="rounded-lg border border-[#262626]" open={active}>
              <summary className="cursor-pointer p-3 text-sm text-[#a0a0a0] hover:text-white">{t('Search diagnostics')}</summary>
              <div className="border-t border-[#262626] p-3">
                {diagError ? <div role="alert" className="text-xs text-[#ff8888]">{t(diagError)}</div>
                  : diag.length === 0 ? <div className="text-xs text-[#6b6b6b]">{t('Loading…')}</div>
                  : (
                    <table className="w-full text-xs">
                      <tbody>
                        {diag.map(d => (
                          <tr key={d.item} className="border-b border-[#1e1e1e] last:border-0">
                            <td className="py-1.5 pe-3 text-[#a0a0a0]">{t(`diag_${d.item}`) === `diag_${d.item}` ? d.item : t(`diag_${d.item}`)}</td>
                            <td className={`py-1.5 text-end font-mono tabular-nums ${d.item === 'last_error' && d.value ? 'text-[#ffc832]' : 'text-white'}`} dir="auto">
                              {d.item === 'status' ? t(statusLabel[d.value] ?? d.value) : d.value || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </div>
            </details>
          </>
        )}
      </Card>

      {/* 4) Results */}
      <Card className="anim-card">
        {/* Header + add / reject buttons stay under the top bar while scrolling the results */}
        <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-[#262626] bg-[#161616] p-4">
          <div>
            <h3 className="text-white font-semibold">{t('Results to review')}</h3>
            <p className="text-xs text-[#6b6b6b]">
              {t('{n} new', { n: resultsTotal.toLocaleString('en-US') })}{selected.length > 0 && ` · ${t('{n} selected', { n: selected.length })}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-[#6b6b6b]">{t('Client type')}
              <Select value={typeChoice} onChange={v => setTypeChoice(v as TypeChoice)} className="w-44"
                options={(Object.keys(TYPE_LABEL) as TypeChoice[]).map(k => ({ value: k, label: TYPE_LABEL[k] }))} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[#6b6b6b]">{t('Data quality')}
              <Select value={quality} onChange={v => setQuality(v as Quality)} className="w-32"
                options={[{ value: 'high', label: 'high' }, { value: 'medium', label: 'medium' }, { value: 'normal', label: 'normal' }]} />
            </label>
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
        {resultsTotal > 0 && (
          <div className="border-b border-[#262626] px-4 py-2 text-xs text-[#d0d0d0]" aria-live="polite">
            {t('You will add {n} clients → {type} · {q} quality', {
              n: (selected.length || resultsTotal).toLocaleString('en-US'), type: t(TYPE_LABEL[typeChoice]), q: t(quality),
            })}
            <span className="ms-1 text-[#6b6b6b]">({selected.length ? t('selected') : t('all new')})</span>
          </div>
        )}
        {lastAdd && (
          <div role="status" className="border-b border-[#262626] bg-[#0f1a12] px-4 py-2 text-xs text-[#64dc78]">
            ✓ {t('Last add: received {r} · added {a} · duplicates {d}', { r: lastAdd.received, a: lastAdd.added, d: lastAdd.duplicates })}
          </div>
        )}
        {resultsError && <div role="alert" className="m-4 text-sm text-[#ff8888]">{t(resultsError)}</div>}
        {resultsLoading && !results.length ? <div className="p-4"><TableSkeleton /></div> : results.length === 0 ? (
          !resultsError && <p className="p-8 text-center text-sm text-[#4a4a4a]">{t('No new results. Start a search to find websites.')}</p>
        ) : (
          <div className={tableScroll}>
            <table className="w-full text-sm anim-rows">
              <thead className={stickyHead}>
                <tr className="border-b border-[#262626] text-xs uppercase tracking-wider text-[#6b6b6b]">
                  <th className="px-4 py-3 text-start">
                    <input type="checkbox" className="accent-[#dfff03]" aria-label={t('Select all')} checked={allOnPage}
                      onChange={() => setSelected(allOnPage ? selected.filter(id => !results.some(r => r.id === id)) : uniq([...selected, ...results.map(r => r.id)]))} />
                  </th>
                  <th className="px-4 py-3 text-start font-medium">{t('Name')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('Country')}</th>
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
                    <td className="px-4 py-3 text-xs text-[#a0a0a0] whitespace-nowrap">{countryName(r.country_code, r.country)}</td>
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
          <p className="text-sm text-[#d0d0d0]">{t('The settings will be filled with the defaults. Nothing is saved until you press Save or start a search.')}</p>
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

    </div>
  );
}
