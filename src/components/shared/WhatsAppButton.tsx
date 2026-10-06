import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button } from '../ui';

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

function WhatsAppIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent anim-spin" />;
}

/**
 * WhatsApp for one client: a click opens wa.me right away with the message the server picks
 * (get_whatsapp_link chooses the template from the client's status). No preview window.
 */
export default function WhatsAppButton({ leadId, stage, variant = 'button', label = 'WhatsApp', allowTemplatePick = false }: {
  leadId: string;
  /** Kept for callers; the server picks the template from the status itself. */
  leadStatus?: string | null;
  /** Use the first active template of this stage instead (e.g. 'payment_due' from the installments panel). */
  stage?: WhatsAppStage;
  variant?: 'button' | 'icon';
  label?: string;
  /** Small ▾ next to the button to send with another template (client card only). */
  allowTemplatePick?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);
  const [menuError, setMenuError] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Close the template menu on an outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  async function open(templateId?: string) {
    if (busy) return;
    setMenuOpen(false);
    // Open the tab inside the click so popup blockers allow it, then point it at wa.me
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    setBusy(true);
    try {
      let pick = templateId;
      if (!pick && stage) {
        const { data, error } = await supabase
          .from('whatsapp_templates').select('id').eq('stage', stage).eq('is_active', true)
          .order('sort_order').order('created_at').limit(1).maybeSingle();
        if (error) throw new Error(error.message);
        pick = data?.id;
      }
      const { data, error } = await supabase.rpc('get_whatsapp_link', { p_lead_id: leadId, ...(pick ? { p_template_id: pick } : {}) });
      if (error) {
        throw new Error(/no phone/i.test(error.message) ? t('No valid phone number') : error.message);
      }
      const url = ((Array.isArray(data) ? data[0] : data) as { url?: string } | undefined)?.url;
      if (!url) throw new Error(t('No valid phone number'));
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      win?.close();
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMenu() {
    const next = !menuOpen;
    setMenuOpen(next);
    if (!next || templates) return;
    const { data, error } = await supabase
      .from('whatsapp_templates')
      .select('id, stage, title, body, is_active, sort_order')
      .eq('is_active', true)
      .order('stage').order('sort_order').order('created_at')
      .range(0, 199);
    if (error) setMenuError(error.message);
    else setTemplates((data ?? []) as WhatsAppTemplate[]);
  }

  return (
    // Stop clicks from reaching a clickable table row behind the button
    <span ref={wrapRef} className="relative inline-flex" onClick={e => e.stopPropagation()}>
      {variant === 'icon' ? (
        <button
          type="button"
          title={t(label)}
          aria-label={t(label)}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void open()}
          className="text-[#4a4a4a] hover:text-[#25d366] transition-colors disabled:cursor-wait"
        >
          {busy ? <Spinner /> : <WhatsAppIcon />}
        </button>
      ) : (
        <span className="inline-flex">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void open()} className={allowTemplatePick ? 'rounded-e-none' : ''}>
            <span className="text-[#25d366]">{busy ? <Spinner /> : <WhatsAppIcon />}</span>{t(label)}
          </Button>
          {allowTemplatePick && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void toggleMenu()} className="rounded-s-none border-s-0 px-2">
              <span aria-hidden="true">▾</span><span className="sr-only">{t('Choose another template')}</span>
            </Button>
          )}
        </span>
      )}

      {menuOpen && (
        <div role="menu" className="absolute top-full end-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto rounded-lg border border-[#262626] bg-[#161616] p-1 shadow-xl anim-modal">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#6b6b6b]">{t('Choose another template')}</div>
          {menuError ? (
            <div className="px-2 py-2 text-xs text-[#ff8888]">{t(menuError)}</div>
          ) : !templates ? (
            <div className="px-2 py-2 text-xs text-[#6b6b6b]">{t('Loading…')}</div>
          ) : templates.length === 0 ? (
            <div className="px-2 py-2 text-xs text-[#6b6b6b]">{t('No templates yet — add the first one.')}</div>
          ) : templates.map(tpl => (
            <button
              key={tpl.id}
              role="menuitem"
              onClick={() => void open(tpl.id)}
              className="block w-full rounded px-2 py-1.5 text-start text-sm text-[#d0d0d0] hover:bg-[#1e1e1e] hover:text-white"
            >
              <span className="text-xs text-[#dfff03]">{t(`wa_stage_${tpl.stage}`)}</span> · {tpl.title}
            </button>
          ))}
        </div>
      )}

      {toast && (
        <span role="alert" className="fixed bottom-4 start-1/2 z-50 -translate-x-1/2 rtl:translate-x-1/2 w-max max-w-[calc(100vw-2rem)] rounded-lg border border-[#ff6464]/30 bg-[#1a0f0f] px-4 py-2.5 text-sm text-[#ff8888] shadow-lg anim-banner">
          ✕ {t(toast)}
        </span>
      )}
    </span>
  );
}
