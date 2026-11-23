import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Modal } from '../ui';
import { toast } from './toast';

/**
 * Client types (leads.lead_types text[]). A client can have several types at once
 * (e.g. Salla store + influencer marketing). The list lives in lead_type_catalog;
 * leads.is_salla_store is still kept in sync by the DB (true when 'salla' is in the list).
 */
export interface LeadType {
  code: string;
  label_ar: string;
  label_en?: string | null;
  sort?: number | null;
  lead_count?: number | null;
}

/** list_lead_types(): every active type + how many clients have it. */
export function useLeadTypes() {
  const [types, setTypes] = useState<LeadType[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('list_lead_types');
    if (rpcError) setError(rpcError.message);
    else {
      setError('');
      setTypes((data ?? []) as LeadType[]);
    }
    setLoaded(true);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { types, error, loaded, reload };
}

// One fixed color per type, the same on every page, so the table can be read at a glance.
const TYPE_COLORS: Record<string, string> = {
  salla: '#2dd4bf',
  zid: '#a78bfa',
  shopify: '#84cc16',
  wordpress: '#60a5fa',
  woocommerce: '#f472b6',
  wix: '#facc15',
  custom: '#fb923c',
  influencer_marketing: '#f87171',
  social_only: '#38bdf8',
  other: '#a0a0a0',
};
const FALLBACK_COLORS = ['#34d399', '#e879f9', '#fbbf24', '#818cf8', '#fca5a5', '#5eead4', '#c4b5fd', '#fdba74'];

export function leadTypeColor(code: string): string {
  if (TYPE_COLORS[code]) return TYPE_COLORS[code];
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

/** Label in the current language (Arabic label is the main one). */
export function useLeadTypeLabel(types: LeadType[]) {
  const { lang } = useI18n();
  return useCallback((code: string) => {
    const type = types.find(x => x.code === code);
    if (!type) return code;
    return lang === 'ar' ? type.label_ar : type.label_en || type.label_ar;
  }, [types, lang]);
}

export function LeadTypeBadge({ code, label }: { code: string; label: string }) {
  const color = leadTypeColor(code);
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color, backgroundColor: `${color}1a`, borderColor: `${color}40` }}
      dir="auto"
    >
      {label}
    </span>
  );
}

/** Badges side by side; more than `max` → the first ones + "+N" with the rest in a tooltip. */
export function LeadTypeBadges({ codes, types, max = 2 }: { codes: string[] | null | undefined; types: LeadType[]; max?: number }) {
  const label = useLeadTypeLabel(types);
  const list = codes ?? [];
  if (!list.length) return <span className="text-xs text-[#4a4a4a]">—</span>;
  const shown = list.slice(0, max);
  const rest = list.slice(max);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map(code => <LeadTypeBadge key={code} code={code} label={label(code)} />)}
      {rest.length > 0 && (
        <span className="rounded bg-[#262626] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]" title={rest.map(label).join('، ')}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}

/** Checkbox list of types (used in the client card, the import and the Add Lead form). */
export function LeadTypeChecklist({
  types, value, onChange, showCounts = false, disabled = false,
}: {
  types: LeadType[];
  value: string[];
  onChange: (next: string[]) => void;
  showCounts?: boolean;
  disabled?: boolean;
}) {
  const label = useLeadTypeLabel(types);
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {types.map(type => {
        const on = value.includes(type.code);
        const color = leadTypeColor(type.code);
        return (
          <label
            key={type.code}
            className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs transition-colors ${on ? 'border-[#dfff03]/50 bg-[#dfff03]/5 text-white' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#d0d0d0] hover:border-[#3a3a3a]'} ${disabled ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input type="checkbox" checked={on} onChange={() => toggle(type.code)} disabled={disabled} className="accent-[#dfff03]" />
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="truncate" dir="auto">{label(type.code)}</span>
            {showCounts && type.lead_count != null && (
              <span className="ms-auto text-[10px] text-[#6b6b6b]">{Number(type.lead_count).toLocaleString('en-US')}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Type filter: several types; "any" = overlaps, "all" = contains.
 * Apply with applyLeadTypeFilter() so the list and the export use the same condition.
 */
export function LeadTypeFilter({
  types, value, onChange, matchAll, onMatchAllChange,
}: {
  types: LeadType[];
  value: string[];
  onChange: (next: string[]) => void;
  matchAll: boolean;
  onMatchAllChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const label = useLeadTypeLabel(types);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const buttonText = value.length === 0
    ? t('All Types')
    : value.length === 1 ? label(value[0]) : t('{n} types', { n: value.length });

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={`flex w-44 items-center justify-between gap-2 rounded border bg-[#1a1a1a] px-3 py-2 text-sm transition-colors ${value.length ? 'border-[#dfff03]/50 text-[#dfff03]' : 'border-[#2a2a2a] text-white'}`}
      >
        <span className="truncate" dir="auto">{buttonText}</span>
        <svg className="h-3.5 w-3.5 shrink-0 text-[#6b6b6b]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute start-0 top-full z-30 mt-1 w-72 rounded-lg border border-[#2a2a2a] bg-[#161616] p-3 shadow-xl anim-banner">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex rounded border border-[#2a2a2a] p-0.5 text-[11px]" role="group" aria-label={t('Match')}>
              <button type="button" onClick={() => onMatchAllChange(false)}
                className={`rounded px-2 py-0.5 ${!matchAll ? 'bg-[#dfff03] text-black' : 'text-[#a0a0a0] hover:text-white'}`}>
                {t('Any of them')}
              </button>
              <button type="button" onClick={() => onMatchAllChange(true)}
                className={`rounded px-2 py-0.5 ${matchAll ? 'bg-[#dfff03] text-black' : 'text-[#a0a0a0] hover:text-white'}`}>
                {t('All together')}
              </button>
            </div>
            <button type="button" disabled={!value.length} onClick={() => onChange([])}
              className="text-xs text-[#a0a0a0] hover:text-white disabled:opacity-40">
              {t('Clear choice')}
            </button>
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {types.length === 0 && <p className="py-2 text-xs text-[#6b6b6b]">{t('No types yet.')}</p>}
            {types.map(type => {
              const on = value.includes(type.code);
              return (
                <label key={type.code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[#1f1f1f]">
                  <input type="checkbox" checked={on} className="accent-[#dfff03]"
                    onChange={() => onChange(on ? value.filter(c => c !== type.code) : [...value, type.code])} />
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: leadTypeColor(type.code) }} />
                  <span className="truncate text-[#d0d0d0]" dir="auto">{label(type.code)}</span>
                  <span className="ms-auto text-xs text-[#6b6b6b]">{Number(type.lead_count ?? 0).toLocaleString('en-US')}</span>
                </label>
              );
            })}
          </div>
          {value.length > 1 && (
            <p className="mt-2 text-[11px] text-[#6b6b6b]">
              {matchAll ? t('Clients that have all the chosen types.') : t('Clients that have any of the chosen types.')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Same condition for the list, "Select first N" and the Excel export. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLeadTypeFilter(query: any, codes: string[], matchAll: boolean) {
  if (!codes.length) return query;
  return matchAll ? query.contains('lead_types', codes) : query.overlaps('lead_types', codes);
}

/** Bulk edit: add some types and remove others; the clients keep the types not mentioned. */
export function BulkLeadTypesModal({
  open, onClose, leadIds, types, onDone,
}: {
  open: boolean;
  onClose: () => void;
  leadIds: string[];
  types: LeadType[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setAdd([]); setRemove([]); setError(''); } }, [open]);

  // A type can be in one column only
  const setAddList = (next: string[]) => { setAdd(next); setRemove(prev => prev.filter(c => !next.includes(c))); };
  const setRemoveList = (next: string[]) => { setRemove(next); setAdd(prev => prev.filter(c => !next.includes(c))); };

  const save = async () => {
    if (saving || (!add.length && !remove.length) || !leadIds.length) return;
    setSaving(true);
    setError('');
    const chunk = 1000;
    for (let start = 0; start < leadIds.length; start += chunk) {
      const { error: rpcError } = await supabase.rpc('bulk_set_lead_types', {
        p_lead_ids: leadIds.slice(start, start + chunk), p_add: add, p_remove: remove,
      });
      if (rpcError) {
        setError(start > 0 ? t('Stopped after {n} clients: {msg}', { n: start, msg: rpcError.message }) : rpcError.message);
        setSaving(false);
        if (start > 0) onDone();
        return;
      }
    }
    setSaving(false);
    toast(t('Types updated for {n} clients', { n: leadIds.length.toLocaleString('en-US') }));
    onDone();
    onClose();
  };

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={t('Edit types for {n} clients', { n: leadIds.length.toLocaleString('en-US') })}>
      <div className="space-y-4">
        <p className="text-xs text-[#a0a0a0]">{t('Types you add are added to what each client already has; nothing else is removed.')}</p>
        <div>
          <div className="mb-1.5 text-xs font-medium text-[#64dc78]">{t('Add these types')}</div>
          <LeadTypeChecklist types={types} value={add} onChange={setAddList} disabled={saving} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-[#ff8888]">{t('Remove these types')}</div>
          <LeadTypeChecklist types={types} value={remove} onChange={setRemoveList} disabled={saving} />
        </div>
        {error && <p role="alert" className="text-xs text-[#ff6464]">{t(error)}</p>}
        <div className="flex gap-2">
          <Button variant="primary" disabled={saving || (!add.length && !remove.length)} onClick={() => void save()}>
            {saving ? t('Saving...') : t('Save')}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={onClose}>{t('Cancel')}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Admin: the type list + "Add type" (upsert_lead_type). Same code again = edit its names / order. */
export function LeadTypesManagerModal({
  open, onClose, types, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  types: LeadType[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const empty = { code: '', label_ar: '', label_en: '', sort: '' };
  const [form, setForm] = useState(empty);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm(empty); setEditingCode(null); setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeValid = /^[a-z][a-z0-9_]*$/.test(form.code);
  const nextSort = types.reduce((max, x) => Math.max(max, Number(x.sort ?? 0)), 0) + 10;

  const startEdit = (type: LeadType) => {
    setEditingCode(type.code);
    setForm({ code: type.code, label_ar: type.label_ar, label_en: type.label_en ?? '', sort: type.sort == null ? '' : String(type.sort) });
    setError('');
  };

  const save = async () => {
    if (saving || !codeValid || !form.label_ar.trim()) return;
    setSaving(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('upsert_lead_type', {
      p_code: form.code,
      p_label_ar: form.label_ar.trim(),
      p_label_en: form.label_en.trim() || null,
      p_sort: form.sort.trim() === '' ? nextSort : Number(form.sort),
    });
    setSaving(false);
    if (rpcError) { setError(rpcError.message); return; }
    toast(editingCode ? t('Type saved') : t('Type added'));
    setForm(empty);
    setEditingCode(null);
    onChanged();
  };

  const input = 'w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60';

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={t('Client types')}>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-[#2a2a2a]">
          <table className="w-full text-xs">
            <thead className="bg-[#1a1a1a] text-[#a0a0a0]">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('Type')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('Code')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('Clients')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {types.map(type => (
                <tr key={type.code} className="border-t border-[#2a2a2a]">
                  <td className="px-3 py-1.5"><LeadTypeBadge code={type.code} label={type.label_ar} />{type.label_en && <span className="ms-2 text-[#6b6b6b]">{type.label_en}</span>}</td>
                  <td className="px-3 py-1.5 font-mono text-[#a0a0a0]" dir="ltr">{type.code}</td>
                  <td className="px-3 py-1.5 text-end text-[#d0d0d0]">{Number(type.lead_count ?? 0).toLocaleString('en-US')}</td>
                  <td className="px-3 py-1.5 text-end">
                    <button type="button" className="text-[#dfff03] hover:underline" onClick={() => startEdit(type)}>{t('Edit')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 rounded-lg border border-[#2a2a2a] p-3">
          <div className="text-xs font-medium text-white">{editingCode ? t('Edit type') : t('Add type')}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-[#a0a0a0]">{t('Code (English, lowercase, no spaces)')}
              <input className={`mt-1 ${input} font-mono`} dir="ltr" value={form.code} disabled={!!editingCode || saving}
                placeholder="tiktok_shop" onChange={e => setForm(f => ({ ...f, code: e.target.value.trim().toLowerCase().replace(/\s+/g, '_') }))} />
            </label>
            <label className="text-xs text-[#a0a0a0]">{t('Arabic name (shown in the filter)')}
              <input className={`mt-1 ${input}`} dir="rtl" value={form.label_ar} disabled={saving}
                placeholder="متجر تيك توك" onChange={e => setForm(f => ({ ...f, label_ar: e.target.value }))} />
            </label>
            <label className="text-xs text-[#a0a0a0]">{t('English name')}
              <input className={`mt-1 ${input}`} dir="ltr" value={form.label_en} disabled={saving}
                placeholder="TikTok Shop" onChange={e => setForm(f => ({ ...f, label_en: e.target.value }))} />
            </label>
            <label className="text-xs text-[#a0a0a0]">{t('Order')}
              <input type="number" className={`mt-1 ${input}`} value={form.sort} disabled={saving}
                placeholder={String(nextSort)} onChange={e => setForm(f => ({ ...f, sort: e.target.value }))} />
            </label>
          </div>
          {form.code && !codeValid && <p className="text-xs text-[#ffc832]">{t('Code must start with a letter and use only a-z, 0-9 and _.')}</p>}
          {error && <p role="alert" className="text-xs text-[#ff6464]">{t(error)}</p>}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={saving || !codeValid || !form.label_ar.trim()} onClick={() => void save()}>
              {saving ? t('Saving...') : editingCode ? t('Save') : t('Add type')}
            </Button>
            {editingCode && <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setForm(empty); setEditingCode(null); }}>{t('Cancel')}</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
