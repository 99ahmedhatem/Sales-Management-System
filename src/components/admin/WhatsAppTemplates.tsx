import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Card, EmptyState, Modal, Table, Td, Toggle, Tr } from '../ui';
import { TableSkeleton } from '../shared/motion';
import { WHATSAPP_STAGES, WhatsAppStage, WhatsAppTemplate } from '../shared/WhatsAppButton';

const VARIABLES: [string, string][] = [
  ['{name}', 'Client name'],
  ['{company}', 'Company (or client name if empty)'],
  ['{agent}', 'Your name (the employee sending)'],
  ['{website}', 'Client website'],
  ['{client_code}', 'Client code'],
];

interface Draft { id: string | null; stage: WhatsAppStage; title: string; body: string; is_active: boolean; sort_order: string }
const EMPTY: Draft = { id: null, stage: 'general', title: '', body: '', is_active: true, sort_order: '0' };

/** Admin: add / edit / pause WhatsApp message templates (upsert_whatsapp_template). */
export default function WhatsAppTemplates() {
  const { t } = useI18n();
  const [rows, setRows] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [togglingId, setTogglingId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: listError } = await supabase
      .from('whatsapp_templates')
      .select('id, stage, title, body, is_active, sort_order')
      .order('stage')
      .order('sort_order')
      .order('created_at')
      .range(0, 499);
    if (listError) setError(listError.message);
    else { setError(''); setRows((data ?? []) as WhatsAppTemplate[]); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function upsert(d: Draft) {
    return supabase.rpc('upsert_whatsapp_template', {
      p_id: d.id, p_stage: d.stage, p_title: d.title.trim(), p_body: d.body.trim(),
      p_active: d.is_active, p_sort: Number(d.sort_order) || 0,
    });
  }

  async function save() {
    if (!draft || saving) return;
    if (!draft.title.trim() || !draft.body.trim()) { setSaveError(t('Title and message are required.')); return; }
    setSaving(true);
    setSaveError('');
    const { error: rpcError } = await upsert(draft);
    setSaving(false);
    if (rpcError) { setSaveError(rpcError.message); return; }
    setDraft(null);
    await load();
  }

  async function toggleActive(row: WhatsAppTemplate, active: boolean) {
    if (togglingId) return;
    setTogglingId(row.id);
    const { error: rpcError } = await upsert({ id: row.id, stage: row.stage, title: row.title, body: row.body, is_active: active, sort_order: String(row.sort_order ?? 0) });
    setTogglingId('');
    if (rpcError) setError(rpcError.message);
    await load();
  }

  const input = 'w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60';

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">{t('WhatsApp templates')}</h1>
          <p className="text-xs text-[#6b6b6b]">{t('Ready messages per client stage. The suggested one is picked from the client status.')}</p>
        </div>
        <Button onClick={() => { setDraft({ ...EMPTY }); setSaveError(''); }}>{t('+ New template')}</Button>
      </div>

      <Card className="p-4">
        <div className="mb-2 text-xs uppercase tracking-wider text-[#6b6b6b]">{t('Variables you can use')}</div>
        <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {VARIABLES.map(([v, label]) => (
            <div key={v}><code className="font-mono text-[#dfff03]" dir="ltr">{v}</code> <span className="text-[#a0a0a0]">— {t(label)}</span></div>
          ))}
        </div>
      </Card>

      {error && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]">{t(error)}</div>}

      <Card>
        {loading && rows.length === 0 ? <div className="p-4"><TableSkeleton /></div> : rows.length === 0 ? (
          <EmptyState message="No templates yet — add the first one." />
        ) : (
          <Table headers={['Stage', 'Title', 'Message', 'Order', 'Active', '']}>
            {rows.map(row => (
              <Tr key={row.id}>
                <Td><span className="text-xs text-[#dfff03]">{t(`wa_stage_${row.stage}`)}</span></Td>
                <Td><span className="text-white">{row.title}</span></Td>
                <Td><p className="max-w-md truncate text-xs text-[#a0a0a0]" dir="auto" title={row.body}>{row.body}</p></Td>
                <Td><span className="font-mono text-xs">{row.sort_order ?? 0}</span></Td>
                <Td><Toggle checked={row.is_active} disabled={togglingId === row.id} onChange={v => void toggleActive(row, v)} /></Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => {
                    setDraft({ id: row.id, stage: row.stage, title: row.title, body: row.body, is_active: row.is_active, sort_order: String(row.sort_order ?? 0) });
                    setSaveError('');
                  }}>{t('Edit')}</Button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit template' : 'New template'}>
        {draft && (
          <div className="space-y-3">
            <label className="block text-xs text-[#a0a0a0]">{t('Stage')}
              <select className={`mt-1 ${input}`} value={draft.stage} onChange={e => setDraft({ ...draft, stage: e.target.value as WhatsAppStage })}>
                {WHATSAPP_STAGES.map(s => <option key={s} value={s}>{t(`wa_stage_${s}`)}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[#a0a0a0]">{t('Title')}
              <input className={`mt-1 ${input}`} maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="block text-xs text-[#a0a0a0]">{t('Message')}
              <textarea className={`mt-1 ${input}`} rows={6} maxLength={1500} dir="auto" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
              <span className="text-[#4a4a4a]">{draft.body.length}/1500</span>
            </label>
            <div className="flex items-center gap-4">
              <label className="text-xs text-[#a0a0a0]">{t('Order')}
                <input type="number" className={`mt-1 w-24 ${input}`} value={draft.sort_order} onChange={e => setDraft({ ...draft, sort_order: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-xs text-[#a0a0a0]">
                <Toggle checked={draft.is_active} onChange={v => setDraft({ ...draft, is_active: v })} /> {t('Active')}
              </label>
            </div>
            {saveError && <div role="alert" className="rounded bg-[#ff6464]/10 p-2 text-sm text-[#ff8888]">{t(saveError)}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>{t('Cancel')}</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving ? t('Saving…') : t('Save')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
