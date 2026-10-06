import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Modal } from '../ui';

export const WHATSAPP_STAGES = ['new', 'assigned', 'contacted', 'interested', 'callback', 'no_answer', 'meeting', 'renewal', 'payment_due', 'general'] as const;
export type WhatsAppStage = (typeof WHATSAPP_STAGES)[number];

export interface WhatsAppTemplate {
  id: string;
  stage: WhatsAppStage;
  title: string;
  body: string;
  is_active: boolean;
  sort_order?: number;
}

/** Same mapping as get_whatsapp_link() uses when no template is chosen. */
export function stageForLeadStatus(status?: string | null): WhatsAppStage {
  switch (status) {
    case 'New': return 'new';
    case 'Assigned': return 'assigned';
    case 'Contacted': return 'contacted';
    case 'Interested': return 'interested';
    case 'Call Back Later': return 'callback';
    case 'No Answer': return 'no_answer';
    default: return 'general';
  }
}

function WhatsAppIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/**
 * WhatsApp button for one client: pick a template (suggested from the client's stage),
 * preview/edit the message, then open wa.me in a new tab.
 */
export default function WhatsAppButton({ leadId, leadStatus, stage, variant = 'button', label = 'WhatsApp' }: {
  leadId: string;
  leadStatus?: string | null;
  /** Force a stage (e.g. 'payment_due' from the installments panel). */
  stage?: WhatsAppStage;
  variant?: 'button' | 'icon';
  label?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [message, setMessage] = useState('');
  const [original, setOriginal] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const suggested = stage ?? stageForLeadStatus(leadStatus);

  async function preview(id: string) {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('get_whatsapp_link', { p_lead_id: leadId, p_template_id: id || null });
    setLoading(false);
    if (rpcError) { setError(rpcError.message); setUrl(''); return; }
    const row = (Array.isArray(data) ? data[0] : data) as { url: string; message: string } | undefined;
    setUrl(row?.url ?? '');
    setMessage(row?.message ?? '');
    setOriginal(row?.message ?? '');
  }

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      const { data, error: listError } = await supabase
        .from('whatsapp_templates')
        .select('id, stage, title, body, is_active, sort_order')
        .eq('is_active', true)
        .order('sort_order')
        .order('created_at')
        .limit(200);
      if (!active) return;
      if (listError) { setError(listError.message); setLoading(false); return; }
      const rows = (data ?? []) as WhatsAppTemplate[];
      setTemplates(rows);
      const pick = rows.find(r => r.stage === suggested) ?? rows.find(r => r.stage === 'general') ?? rows[0];
      setTemplateId(pick?.id ?? '');
      await preview(pick?.id ?? '');
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId]);

  async function send() {
    if (opening) return;
    // Open the tab now (inside the click) so popup blockers allow it, then point it at wa.me.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    let target = url;
    if (message !== original) {
      setOpening(true);
      const { data, error: rpcError } = await supabase.rpc('get_whatsapp_link', { p_lead_id: leadId, p_custom_text: message });
      setOpening(false);
      if (rpcError) { win?.close(); setError(rpcError.message); return; }
      const row = (Array.isArray(data) ? data[0] : data) as { url: string } | undefined;
      target = row?.url ?? '';
    }
    if (!target) { win?.close(); setError(t('Could not build the WhatsApp link.')); return; }
    if (win) win.location.href = target;
    else window.open(target, '_blank', 'noopener');
    setOpen(false);
  }

  return (
    // Stop clicks (also inside the modal) from reaching a clickable table row behind it
    <span className="inline-flex" onClick={e => e.stopPropagation()}>
      {variant === 'icon' ? (
        <button
          type="button"
          title={t(label)}
          aria-label={t(label)}
          onClick={() => setOpen(true)}
          className="text-[#4a4a4a] hover:text-[#25d366] transition-colors"
        >
          <WhatsAppIcon />
        </button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <span className="text-[#25d366]"><WhatsAppIcon /></span>{t(label)}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Send WhatsApp message">
        <div className="space-y-3">
          <label className="block text-xs text-[#a0a0a0]">
            {t('Template')}
            <select
              value={templateId}
              onChange={e => { setTemplateId(e.target.value); void preview(e.target.value); }}
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              {templates.length === 0 && <option value="">{t('No templates — default message')}</option>}
              {templates.map(tpl => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.stage === suggested ? '★ ' : ''}{t(`wa_stage_${tpl.stage}`)} · {tpl.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[#a0a0a0]">
            {t('Message (you can edit it before sending)')}
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
              dir="auto"
              disabled={loading}
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60 disabled:opacity-50"
            />
          </label>
          {error && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-2 text-sm text-[#ff8888]">{t(error)}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
            <Button onClick={() => void send()} disabled={loading || opening || (!url && message === original)}>
              {opening ? t('Opening…') : t('Open WhatsApp')}
            </Button>
          </div>
        </div>
      </Modal>
    </span>
  );
}
