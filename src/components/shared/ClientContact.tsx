import { useI18n } from '../../i18n/I18nProvider';
import { Badge, WebsiteLink } from '../ui';
import { toast } from './toast';
import WhatsAppButton from './WhatsAppButton';

/** Client code badge (e.g. CLT-XXXXXXXX); nothing when empty. */
export function ClientCodeBadge({ code }: { code?: string | null }) {
  if (!code) return null;
  return <Badge className="bg-[#dfff03]/10 text-[#dfff03] border border-[#dfff03]/20" >{code}</Badge>;
}

/** Phone as a tel: link + copy + WhatsApp. Works from the meeting snapshot, no access to `leads` needed. */
export function PhoneActions({ phone, leadId, className = '' }: { phone?: string | null; leadId: string; className?: string }) {
  const { t } = useI18n();
  const value = phone?.trim();
  if (!value) return <span className="text-[#6b6b6b] text-xs">—</span>;

  async function copy(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value!);
      toast(t('Phone copied'));
    } catch (err) {
      toast(err instanceof Error ? err.message : t('Could not copy'), false);
    }
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} onClick={event => event.stopPropagation()}>
      <a href={`tel:${value.replace(/[^\d+]/g, '')}`} dir="ltr" className="font-mono hover:underline" title={t('Call')}>
        {value}
      </a>
      <button type="button" onClick={copy} title={t('Copy')} aria-label={t('Copy')}
        className="rounded p-1 text-[#6b6b6b] hover:bg-[#252525] hover:text-white">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth={2} />
          <path strokeWidth={2} strokeLinecap="round" d="M5 15V6a2 2 0 012-2h9" />
        </svg>
      </button>
      <WhatsAppButton variant="icon" leadId={leadId} stage="meeting" />
    </span>
  );
}

/** Code badge, phone actions and website in one block (meeting cards, requests, details). */
export default function ClientContact({ leadId, phone, code, website, phoneClassName = '' }: {
  leadId: string;
  phone?: string | null;
  code?: string | null;
  website?: string | null;
  phoneClassName?: string;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <ClientCodeBadge code={code} />
      <PhoneActions phone={phone} leadId={leadId} className={phoneClassName} />
      {website && <WebsiteLink url={website} className="text-[#a0a0a0] break-all" />}
    </div>
  );
}
