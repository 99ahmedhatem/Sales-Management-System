import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { dateLocale } from '../../i18n/locale';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { normalizeWebsite } from '../../lib/websiteKey';
import { formatSar } from '../../lib/format';
import { openDealInContracts } from '../../lib/navigation';
import { Button, StatusBadge, WebsiteLink } from '../ui';
import { REGION_OPTIONS } from './DistributeLeadsModal';
import WhatsAppButton from './WhatsAppButton';
import { websiteCategoryLabel } from './WebsiteChecks';
import { usePermissions } from '../../hooks/usePermissions';

type Role = 'admin' | 'manager' | 'sales' | 'telesales';

export interface LeadCardLead {
  id: string;
  client_code: string | null;
  customer_number: number | null;
  name: string;
  phone: string | null;
  company: string | null;
  region: string | null;
  website: string | null;
  website_status: 'working' | 'not_working' | null;
  website_status_source: 'manual' | 'auto_checked' | null;
  website_check_category: string | null;
  website_check_note: string | null;
  website_checked_at: string | null;
  is_salla_store: boolean | null;
  status: string;
  source: string | null;
  data_quality: 'high' | 'medium' | 'normal' | null;
  callback_date: string | null;
  quantity: number | null;
  assigned_to: string | null;
  owner_name: string | null;
  created_at: string;
  updated_at: string | null;
}

interface LeadCardData {
  lead: LeadCardLead;
  can_edit: boolean;
  comments: { id: string; author_name: string; text: string; created_at: string }[];
  deals: { id: string; status: string; package_name: string; price_sar: number; created_at: string }[];
  meetings: { id: string; proposed_date: string | null; outcome: string | null }[];
  history: { created_at: string; who: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }[];
}

/** Fields update_lead_details accepts (status / assigned_to have their own flows). */
const EDITABLE = ['name', 'phone', 'company', 'region', 'website', 'source', 'callback_date', 'quantity', 'data_quality', 'website_status'] as const;
type EditableField = (typeof EDITABLE)[number];
type Draft = Record<EditableField, string>;

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', phone: 'Phone', company: 'Company', region: 'Country', website: 'Website', website_key: 'Website key',
  source: 'Source', callback_date: 'Follow-up date', quantity: 'Quantity', data_quality: 'Data Quality',
  website_status: 'Website Status', status: 'Status', assigned_to: 'Assigned To', loss_reason: 'Loss reason',
  customer_number: 'Customer number',
};

const DEAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', contract_uploaded: 'Contract Uploaded', pending_approval: 'Pending Approval',
  approved: 'Approved', active: 'Active', cancelled: 'Cancelled',
};

const MAX_COMMENT = 2000;

function toDraft(lead: LeadCardLead): Draft {
  return {
    name: lead.name ?? '',
    phone: lead.phone ?? '',
    company: lead.company ?? '',
    region: lead.region ?? '',
    website: lead.website ?? '',
    source: lead.source ?? '',
    callback_date: lead.callback_date ? String(lead.callback_date).slice(0, 10) : '',
    quantity: lead.quantity == null ? '' : String(lead.quantity),
    data_quality: lead.data_quality ?? 'normal',
    website_status: lead.website_status ?? '',
  };
}

function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function LeadCard({ leadId, role, onClose }: { leadId: string; role: Role; onClose: () => void }) {
  const { t, lang, dir } = useI18n();
  const { can } = usePermissions();
  const [data, setData] = useState<LeadCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [comment, setComment] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState('');

  const fmtDateTime = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(dateLocale(lang), { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    const { data: card, error: rpcError } = await supabase.rpc('get_lead_card', { p_lead_id: leadId });
    if (rpcError) setError(rpcError.message);
    else setData(card as LeadCardData);
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setSaveError('');
    setSaveMsg('');
    setRecheckMsg('');
    void load();
  }, [load]);

  // Comments added by others show up while the card is open (not 'leads': any lead change would reload it)
  useRealtimeRefresh(['client_comments'], () => { if (!editing) void load(true); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lead = data?.lead;

  function startEdit() {
    if (!lead) return;
    setDraft(toDraft(lead));
    setSaveError('');
    setSaveMsg('');
    setEditing(true);
  }

  async function save() {
    if (!lead || !draft || saving) return;
    const before = toDraft(lead);
    const changes: Record<string, string | number | null> = {};
    for (const key of EDITABLE) {
      if (draft[key].trim() === before[key].trim()) continue;
      const v = draft[key].trim();
      if (key === 'quantity') changes.quantity = v === '' ? null : v;
      else changes[key] = v === '' ? null : v;
    }
    if ('website' in changes) {
      // Same key the import / Add Lead use, so duplicates are caught by the unique index
      changes.website_key = changes.website ? normalizeWebsite(String(changes.website)) || null : null;
    }
    if (Object.keys(changes).length === 0) { setEditing(false); return; }

    setSaving(true);
    setSaveError('');
    const { error: rpcError } = await supabase.rpc('update_lead_details', { p_lead_id: lead.id, p_changes: changes });
    setSaving(false);
    if (rpcError) {
      const msg = rpcError.message;
      const code = msg.match(/client\s+(\S+)\s*$/)?.[1];
      if (msg.startsWith('DUPLICATE_PHONE:')) setSaveError(code ? t('This phone already belongs to another client ({code})', { code }) : t('This phone already belongs to another client'));
      else if (msg.startsWith('DUPLICATE_WEBSITE:')) setSaveError(code ? t('This website already belongs to another client ({code})', { code }) : t('This website already belongs to another client'));
      else setSaveError(msg);
      return; // keep the user's edits
    }
    setEditing(false);
    setDraft(null);
    setSaveMsg(t('Saved'));
    await load(true);
  }

  async function addComment() {
    const text = comment.trim();
    if (!text || commenting || !lead) return;
    setCommenting(true);
    setCommentError('');
    const { error: rpcError } = await supabase.rpc('add_lead_comment', { p_lead_id: lead.id, p_text: text });
    setCommenting(false);
    if (rpcError) { setCommentError(rpcError.message); return; }
    setComment('');
    await load(true);
  }

  async function recheck() {
    if (!lead || rechecking) return;
    setRechecking(true);
    setRecheckMsg('');
    const { error: queueError } = await supabase.rpc('recheck_website', { p_lead_id: lead.id });
    if (queueError) { setRechecking(false); setRecheckMsg(queueError.message); return; }
    // Check right away; if the function is not deployed, the scheduled job picks it up later.
    const { data: res, error: fnError } = await supabase.functions.invoke('check-websites', { body: { lead_id: lead.id } });
    setRechecking(false);
    if (fnError) {
      let detail = fnError.message;
      try { detail = (await (fnError as { context?: Response }).context?.json())?.error ?? detail; } catch { /* keep message */ }
      setRecheckMsg(t('Queued for the next automatic check. ({error})', { error: detail }));
    } else {
      const first = (res as { results?: { note?: string }[] })?.results?.[0];
      setRecheckMsg(first?.note ?? t('Checked'));
    }
    await load(true);
  }

  const canRecheck = role === 'admin' || role === 'manager';
  const canOpenDeals = role !== 'telesales';

  const input = 'w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60';
  const regionOptions = REGION_OPTIONS.slice(1);
  const setField = (key: EditableField, value: string) => setDraft(prev => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="fixed inset-0 z-50 flex" dir={dir}>
      <div className="absolute inset-0 bg-black/70 anim-backdrop" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('Client card')}
        className="relative ms-auto h-full w-full max-w-2xl overflow-y-auto bg-[#121212] border-s border-[#262626] anim-drawer"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[#262626] bg-[#121212] p-5">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-widest text-[#6b6b6b]">{t('Client card')}</div>
            <h2 className="mt-1 truncate text-lg font-semibold text-white">{lead?.name ?? (loading ? t('Loading…') : '—')}</h2>
            {lead && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-[#dfff03]">{lead.client_code ?? '—'}</span>
                <StatusBadge status={lead.status} />
                <span className="text-[#6b6b6b]">{t('Owner')}: <span className="text-[#d0d0d0]">{lead.owner_name ?? t('Unassigned')}</span></span>
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label={t('Close')} className="text-2xl leading-none text-[#6b6b6b] hover:text-white">&times;</button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]">
              {t(error)}
              <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void load()}>{t('Retry')}</Button></div>
            </div>
          )}
          {loading && !data && (
            <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded bg-[#1a1a1a]" />)}</div>
          )}

          {lead && data && (
            <>
              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {lead.phone && <WhatsAppButton leadId={lead.id} leadStatus={lead.status} allowTemplatePick />}
                {data.can_edit && can('leads.edit') && !editing && <Button size="sm" variant="secondary" onClick={startEdit}>{t('Edit')}</Button>}
                {saveMsg && <span className="text-xs text-[#64dc78]">{saveMsg}</span>}
              </div>

              {/* Details / edit form */}
              {!editing ? (
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['Code', <span className="font-mono">{lead.client_code ?? '—'}</span>],
                    ['Customer number', lead.customer_number ?? '—'],
                    ['Name', lead.name],
                    ['Phone', <span dir="ltr" className="font-mono">{lead.phone || '—'}</span>],
                    ['Company', lead.company || '—'],
                    ['Country', lead.region ? t(lead.region) : '—'],
                    ['Website', <WebsiteLink url={lead.website ?? undefined} className="break-all" />],
                    ['Salla Store', lead.is_salla_store ? t('Yes') : t('No')],
                    ['Source', lead.source || '—'],
                    ['Data Quality', t(lead.data_quality ?? 'normal')],
                    ['Follow-up date', lead.callback_date ? String(lead.callback_date).slice(0, 10) : '—'],
                    ['Quantity', lead.quantity ?? 0],
                    ['Created', fmtDateTime(lead.created_at)],
                    ['Updated', fmtDateTime(lead.updated_at)],
                  ] as [string, React.ReactNode][]).map(([label, value]) => (
                    <div key={label} className="rounded bg-[#1a1a1a] p-3">
                      <div className="text-xs text-[#6b6b6b]">{t(label)}</div>
                      <div className="mt-1 break-words text-sm text-white">{value}</div>
                    </div>
                  ))}
                </div>
              ) : draft && (
                <div className="space-y-3 rounded border border-[#2a2a2a] p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs text-[#a0a0a0]">{t('Name')}
                      <input className={`mt-1 ${input}`} value={draft.name} onChange={e => setField('name', e.target.value)} />
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Phone')}
                      <input className={`mt-1 ${input} font-mono`} dir="ltr" value={draft.phone} onChange={e => setField('phone', e.target.value)} />
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Company')}
                      <input className={`mt-1 ${input}`} value={draft.company} onChange={e => setField('company', e.target.value)} />
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Country')}
                      <select className={`mt-1 ${input}`} value={draft.region} onChange={e => setField('region', e.target.value)}>
                        <option value="">{t('Select country')}</option>
                        {draft.region && !regionOptions.some(o => o.value === draft.region) && <option value={draft.region}>{draft.region}</option>}
                        {regionOptions.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-[#a0a0a0] sm:col-span-2">{t('Website')}
                      <input className={`mt-1 ${input}`} dir="ltr" value={draft.website} onChange={e => setField('website', e.target.value)} placeholder="example.com" />
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Source')}
                      <input className={`mt-1 ${input}`} value={draft.source} onChange={e => setField('source', e.target.value)} />
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Follow-up date')}
                      <input type="date" className={`mt-1 ${input}`} value={draft.callback_date} onChange={e => setField('callback_date', e.target.value)} />
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Quantity')}
                      <input type="number" min={0} step={1} className={`mt-1 ${input}`} value={draft.quantity} onChange={e => setField('quantity', e.target.value)} />
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Data Quality')}
                      <select className={`mt-1 ${input}`} value={draft.data_quality} onChange={e => setField('data_quality', e.target.value)}>
                        {['high', 'medium', 'normal'].map(q => <option key={q} value={q}>{t(q)}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-[#a0a0a0]">{t('Website Status')}
                      <select className={`mt-1 ${input}`} value={draft.website_status} onChange={e => setField('website_status', e.target.value)}>
                        <option value="">{t('Not checked')}</option>
                        <option value="working">{t('Working')}</option>
                        <option value="not_working">{t('Not working')}</option>
                      </select>
                    </label>
                  </div>
                  <p className="text-xs text-[#6b6b6b]">{t('Status and owner are changed from their own screens, not here.')}</p>
                  {saveError && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-2 text-sm text-[#ff8888]">{t(saveError)}</div>}
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => { setEditing(false); setDraft(null); setSaveError(''); }} disabled={saving}>{t('Cancel')}</Button>
                    <Button onClick={() => void save()} disabled={saving}>{saving ? t('Saving…') : t('Save')}</Button>
                  </div>
                </div>
              )}

              {/* Website status */}
              <section className="space-y-2 rounded border border-[#2a2a2a] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Website status')}</div>
                  {canRecheck && lead.website && (
                    <Button size="sm" variant="secondary" disabled={rechecking} onClick={() => void recheck()}>
                      {rechecking ? t('Checking…') : t('Re-check')}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <WebsiteStatusPill status={lead.website_status} hasWebsite={Boolean(lead.website)} />
                  {lead.website_check_category && <span className="text-xs text-[#a0a0a0]">{t(websiteCategoryLabel(lead.website_check_category))}</span>}
                  {lead.website_status && (
                    <span className="text-xs text-[#6b6b6b]">· {lead.website_status_source === 'manual' ? t('Set manually') : t('Automatic check')}</span>
                  )}
                </div>
                {lead.website_check_note && <p className="text-sm text-[#d0d0d0]">{lead.website_check_note}</p>}
                <div className="text-xs text-[#6b6b6b]">{t('Last checked')}: {fmtDateTime(lead.website_checked_at)}</div>
                {recheckMsg && <div className="text-xs text-[#ffc832]">{recheckMsg}</div>}
              </section>

              {/* Comments */}
              <section className="space-y-3">
                <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Comments ({n})', { n: data.comments.length })}</div>
                <div className="space-y-2">
                  <textarea
                    value={comment}
                    maxLength={MAX_COMMENT}
                    onChange={e => setComment(e.target.value)}
                    rows={3}
                    dir="auto"
                    placeholder={t('Write a comment…')}
                    className={input}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#4a4a4a]">{comment.length}/{MAX_COMMENT}</span>
                    <Button size="sm" onClick={() => void addComment()} disabled={commenting || !comment.trim()}>
                      {commenting ? t('Saving…') : t('Add comment')}
                    </Button>
                  </div>
                  {commentError && <div role="alert" className="text-sm text-[#ff8888]">{t(commentError)}</div>}
                </div>
                {data.comments.length === 0 ? (
                  <p className="text-sm text-[#4a4a4a]">{t('No comments yet.')}</p>
                ) : (
                  <ul className="space-y-2">
                    {data.comments.map(c => (
                      <li key={c.id} className="rounded bg-[#1a1a1a] p-3">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-[#dfff03]">{c.author_name}</span>
                          <span className="text-[#6b6b6b]">{fmtDateTime(c.created_at)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-[#d0d0d0]" dir="auto">{c.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Deals & meetings */}
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded border border-[#2a2a2a] p-4">
                  <div className="mb-2 text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Deals')} ({data.deals.length})</div>
                  {data.deals.length === 0 ? <p className="text-sm text-[#4a4a4a]">{t('No deals for this client.')}</p> : (
                    <ul className="space-y-2">
                      {data.deals.map(d => (
                        <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <div className="truncate text-white">{d.package_name}</div>
                            <div className="text-xs text-[#6b6b6b]">{formatSar(d.price_sar)} · {String(d.created_at).slice(0, 10)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={DEAL_STATUS_LABELS[d.status] ?? d.status} />
                            {canOpenDeals && (
                              <button className="text-xs text-[#dfff03] hover:underline" onClick={() => { onClose(); openDealInContracts(d.id); }}>{t('Open')}</button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded border border-[#2a2a2a] p-4">
                  <div className="mb-2 text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Meetings')} ({data.meetings.length})</div>
                  {data.meetings.length === 0 ? <p className="text-sm text-[#4a4a4a]">{t('No meetings for this client.')}</p> : (
                    <ul className="space-y-2">
                      {data.meetings.map(m => (
                        <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-xs text-[#a0a0a0]">{fmtDateTime(m.proposed_date)}</span>
                          {m.outcome ? <StatusBadge status={m.outcome} /> : <span className="text-xs text-[#6b6b6b]">{t('No outcome yet')}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* History */}
              <details className="rounded border border-[#2a2a2a] p-4">
                <summary className="cursor-pointer text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Change history ({n})', { n: data.history.length })}</summary>
                {data.history.length === 0 ? <p className="mt-3 text-sm text-[#4a4a4a]">{t('No changes recorded yet.')}</p> : (
                  <ul className="mt-3 space-y-2">
                    {data.history.map((h, i) => {
                      const keys = [...new Set([...Object.keys(h.old_data ?? {}), ...Object.keys(h.new_data ?? {})])]
                        .filter(k => fieldValue(h.old_data?.[k]) !== fieldValue(h.new_data?.[k]));
                      return (
                        <li key={i} className="rounded bg-[#1a1a1a] p-3 text-sm">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-[#d0d0d0]">{h.who} · {t(h.action)}</span>
                            <span className="text-[#6b6b6b]">{fmtDateTime(h.created_at)}</span>
                          </div>
                          {keys.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {keys.map(k => (
                                <li key={k} className="text-xs text-[#a0a0a0]">
                                  <span className="text-[#6b6b6b]">{t(FIELD_LABELS[k] ?? k)}:</span>{' '}
                                  <span className="line-through decoration-[#ff6464]/60">{fieldValue(h.old_data?.[k])}</span>{' → '}
                                  <span className="text-white">{fieldValue(h.new_data?.[k])}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </details>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** 🟢 working / 🔴 not working / ⚪ not checked — text + icon, not color only. */
export function WebsiteStatusPill({ status, hasWebsite = true }: { status: string | null | undefined; hasWebsite?: boolean }) {
  const { t } = useI18n();
  if (!hasWebsite) return <span className="inline-flex items-center gap-1 rounded bg-[#1e1e1e] px-2 py-0.5 text-xs text-[#6b6b6b]">— {t('No website')}</span>;
  if (status === 'working') return <span className="inline-flex items-center gap-1 rounded bg-[#64dc78]/10 px-2 py-0.5 text-xs text-[#64dc78]">● {t('Working')}</span>;
  if (status === 'not_working') return <span className="inline-flex items-center gap-1 rounded bg-[#ff6464]/10 px-2 py-0.5 text-xs text-[#ff8888]">✕ {t('Not working')}</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-[#1e1e1e] px-2 py-0.5 text-xs text-[#a0a0a0]">○ {t('Not checked')}</span>;
}
