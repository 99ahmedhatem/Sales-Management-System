import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Lang, useI18n } from '../../i18n/I18nProvider';
import { dateLocale } from '../../i18n/locale';
import { Meeting } from '../../data/meetings';
import { MeetingOutcome } from '../../data/crmTypes';
import { Button, Modal } from '../ui';
import { toast } from './toast';

type Patch = Partial<Meeting>;

const TWO_HOURS = 2 * 60 * 60 * 1000;

/** "الإثنين 12 أكتوبر، 11:00 ص" instead of the raw ISO value. */
export function formatMeetingDate(iso: string | null | undefined, lang: Lang) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(dateLocale(lang), {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

/**
 * Phone for wa.me: digits only, international, no "+" / "00".
 * A local number (leading 0) gets a country code from its shape: 05xxxxxxxx → 966 (Saudi), 01xxxxxxxxx → 20 (Egypt).
 */
export function waPhone(raw: string) {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (/^01\d{9}$/.test(digits)) return `20${digits.slice(1)}`;
  if (digits.startsWith('0')) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;
  return digits;
}

function zoneName() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const names: Record<string, string> = { 'Asia/Riyadh': 'السعودية', 'Africa/Cairo': 'القاهرة', 'Asia/Dubai': 'الإمارات', 'Asia/Kuwait': 'الكويت', 'Asia/Qatar': 'قطر' };
  return names[zone] ?? zone;
}

function defaultMessage(meeting: Meeting, link: string) {
  const date = new Date(meeting.proposedDate);
  const day = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  const time = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' }).format(date);
  const name = meeting.leadName && meeting.leadName !== 'Unknown lead' ? meeting.leadName : '';
  return `أهلاً ${name}، موعد اجتماعنا يوم ${day} الساعة ${time} بتوقيت ${zoneName()}.\nلينك الاجتماع: ${link}\nمع تحيات فريق intillaq.`;
}

async function saveLink(meetingId: string, link: string, markSent: boolean) {
  const { error } = await supabase.rpc('set_meeting_link', { target_meeting_id: meetingId, p_link: link, p_mark_sent: markSent });
  return error?.message ?? '';
}

/** "✓ Attended" button → green badge with the time + undo. Optimistic; reverts on error. */
export function AttendanceControl({ meeting, onChange }: { meeting: Meeting; onChange: (patch: Patch) => void }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);

  async function setAttended(attended: boolean) {
    if (busy) return;
    const before = { attendedAt: meeting.attendedAt, attendedBy: meeting.attendedBy };
    onChange(attended ? { attendedAt: new Date().toISOString() } : { attendedAt: null, attendedBy: null });
    setBusy(true);
    const { error } = await supabase.rpc('mark_meeting_attended', { target_meeting_id: meeting.id, p_attended: attended });
    setBusy(false);
    if (error) {
      onChange(before);
      toast(error.message, false);
    }
  }

  if (meeting.attendedAt) {
    return (
      <span className="inline-flex items-center gap-2" onClick={event => event.stopPropagation()}>
        <span className="rounded border border-[#64dc78]/30 bg-[#64dc78]/10 px-2 py-1 text-xs text-[#64dc78]">
          ✓ {t('Attended — {time}', { time: formatMeetingDate(meeting.attendedAt, lang) })}
        </span>
        <button type="button" disabled={busy} onClick={() => void setAttended(false)} className="text-xs text-[#6b6b6b] underline hover:text-white disabled:opacity-50">
          {t('Undo')}
        </button>
      </span>
    );
  }

  const early = new Date(meeting.proposedDate).getTime() - Date.now() > TWO_HOURS;
  return (
    <span onClick={event => event.stopPropagation()}>
      <Button
        size="sm"
        variant={early ? 'ghost' : 'secondary'}
        disabled={busy}
        onClick={() => void setAttended(true)}
      >
        <span title={early ? t('The meeting time has not come yet') : undefined} className={early ? 'opacity-60' : ''}>
          ✓ {t('I attended the meeting')}
        </span>
      </Button>
    </span>
  );
}

/** Meeting link field (saved on blur / Enter) — set_meeting_link(p_mark_sent: false). */
export function MeetingLinkField({ meeting, onChange }: { meeting: Meeting; onChange: (patch: Patch) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(meeting.meetingLink);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(meeting.meetingLink), [meeting.meetingLink]);

  async function save() {
    const link = value.trim();
    if (saving || link === meeting.meetingLink) return;
    setSaving(true);
    onChange({ meetingLink: link });
    const error = await saveLink(meeting.id, link, false);
    setSaving(false);
    if (error) {
      onChange({ meetingLink: meeting.meetingLink });
      toast(error, false);
    } else toast(t('Meeting link saved'));
  }

  return (
    <input
      value={value}
      dir="ltr"
      placeholder={t('Meeting link (Google Meet / Zoom...)')}
      onClick={event => event.stopPropagation()}
      onChange={event => setValue(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={event => { if (event.key === 'Enter') void save(); }}
      disabled={saving}
      className="w-full min-w-0 rounded border border-[#2a2a2a] bg-[#0e0e0e] px-2 py-1 text-xs text-white placeholder-[#4a4a4a] focus:border-[#dfff03]/60 focus:outline-none"
    />
  );
}

/** WhatsApp button that sends the meeting link (asks for the link first when there is none). */
export function MeetingWhatsAppButton({ meeting, onChange }: { meeting: Meeting; onChange: (patch: Patch) => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [messageEdited, setMessageEdited] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const phone = waPhone(meeting.leadPhone);

  function start(event: React.MouseEvent) {
    event.stopPropagation();
    setLink(meeting.meetingLink);
    setMessage(defaultMessage(meeting, meeting.meetingLink));
    setMessageEdited(false);
    setError('');
    setOpen(true);
  }

  async function send() {
    const cleanLink = link.trim();
    if (!cleanLink) { setError(t('Enter the meeting link first')); return; }
    if (!phone) { setError(t('No valid phone number')); return; }
    // Open WhatsApp inside the click so popup blockers allow it
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    setSending(true);
    const before = { meetingLink: meeting.meetingLink, linkSentAt: meeting.linkSentAt };
    onChange({ meetingLink: cleanLink, linkSentAt: new Date().toISOString() });
    const saveError = await saveLink(meeting.id, cleanLink, true);
    setSending(false);
    if (saveError) {
      onChange(before);
      setError(saveError);
      return;
    }
    setOpen(false);
  }

  return (
    <span className="inline-flex items-center gap-1.5" onClick={event => event.stopPropagation()}>
      <button
        type="button"
        onClick={start}
        disabled={!phone}
        title={t('Send the meeting link on WhatsApp')}
        aria-label={t('Send the meeting link on WhatsApp')}
        className="rounded p-1 text-[#25d366] hover:bg-[#25d366]/10 disabled:opacity-40"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 004.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.13c-.25.69-1.43 1.32-1.98 1.4-.51.08-1.15.11-1.86-.12-.43-.13-.98-.32-1.68-.62-2.96-1.28-4.9-4.26-5.05-4.46-.15-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.17 1.03-2.46.27-.3.59-.37.79-.37h.57c.18 0 .43-.07.67.51.25.59.84 2.04.91 2.19.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.39 1.47.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.73.82 2.03.97.3.15.49.22.57.35.07.12.07.71-.18 1.4z" />
        </svg>
      </button>
      {meeting.linkSentAt && (
        <span className="rounded bg-[#25d366]/10 px-1.5 py-0.5 text-[10px] text-[#25d366]" title={formatMeetingDate(meeting.linkSentAt, lang)}>
          {t('Link sent')}
        </span>
      )}
      <Modal open={open} onClose={() => { if (!sending) setOpen(false); }} title={t('Send meeting link — {name}', { name: meeting.leadName })}>
        <div className="space-y-3">
          {error && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-shake">{error}</div>}
          <label className="block text-xs text-[#a0a0a0]">
            {t('Meeting link *')}
            <input
              autoFocus={!meeting.meetingLink}
              dir="ltr"
              value={link}
              placeholder="https://meet.google.com/..."
              onChange={event => {
                setLink(event.target.value);
                if (!messageEdited) setMessage(defaultMessage(meeting, event.target.value.trim()));
              }}
              className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-[#a0a0a0]">
            {t('Message')}
            <textarea
              rows={5}
              value={message}
              onChange={event => { setMessage(event.target.value); setMessageEdited(true); }}
              className="mt-1 w-full resize-y rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
            />
          </label>
          <div className="text-xs text-[#6b6b6b]" dir="ltr">+{phone}</div>
          <div className="flex gap-2">
            <Button disabled={sending} onClick={() => void send()}>{sending ? t('Saving...') : t('Open WhatsApp')}</Button>
            <Button variant="ghost" disabled={sending} onClick={() => setOpen(false)}>{t('Cancel')}</Button>
          </div>
        </div>
      </Modal>
    </span>
  );
}

interface LossReason { code: string; label_ar: string }

/** After attendance: close deal / lost (with reason) / rescheduled / no-show. */
export function MeetingOutcomeButtons({ meeting, onChange, onCloseDeal }: {
  meeting: Meeting;
  onChange: (patch: Patch) => void;
  onCloseDeal: (meeting: Meeting) => void;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [reasons, setReasons] = useState<LossReason[]>([]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function setOutcome(outcome: MeetingOutcome) {
    if (busy) return;
    const before = meeting.outcome;
    onChange({ outcome });
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('update_meeting_outcome', { target_meeting_id: meeting.id, new_outcome: outcome });
    setBusy(false);
    if (rpcError) {
      onChange({ outcome: before });
      toast(rpcError.message, false);
    }
  }

  async function openLost() {
    setError('');
    setReason('');
    setNote('');
    setLostOpen(true);
    if (reasons.length) return;
    const { data, error: loadError } = await supabase
      .from('loss_reasons').select('code, label_ar').eq('is_active', true).order('sort_order').range(0, 99);
    if (loadError) setError(loadError.message);
    else setReasons((data ?? []) as LossReason[]);
  }

  async function saveLost() {
    if (!reason) { setError(t('Choose a loss reason')); return; }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('mark_meeting_lost', { target_meeting_id: meeting.id, p_reason_code: reason, p_note: note.trim() || null });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    onChange({ outcome: 'Deal Lost' });
    setLostOpen(false);
  }

  if (meeting.outcome === 'Deal Closed – Won') return null;
  return (
    <div className="flex flex-wrap gap-2" onClick={event => event.stopPropagation()}>
      <Button size="sm" onClick={() => onCloseDeal(meeting)}>{t('Close a deal')}</Button>
      <Button size="sm" variant="danger" disabled={busy} onClick={() => void openLost()}>{t('Deal lost (reason)')}</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setOutcome('Rescheduled')}>{t('Reschedule')}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setOutcome('No-Show')}>{t('Client did not show (No-Show)')}</Button>
      <Modal open={lostOpen} onClose={() => { if (!busy) setLostOpen(false); }} title={t('Deal lost — {name}', { name: meeting.leadName })}>
        <div className="space-y-3">
          {error && <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-shake">{t(error)}</div>}
          <label className="block text-xs text-[#a0a0a0]">
            {t('Loss reason *')}
            <select value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white">
              <option value="">{t('Choose a loss reason')}</option>
              {reasons.map(r => <option key={r.code} value={r.code}>{lang === 'ar' ? r.label_ar : r.code.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label className="block text-xs text-[#a0a0a0]">
            {t('Notes')}
            <textarea rows={3} value={note} maxLength={1000} onChange={event => setNote(event.target.value)} className="mt-1 w-full resize-y rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white" />
          </label>
          <div className="flex gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void saveLost()}>{busy ? t('Saving...') : t('Save')}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setLostOpen(false)}>{t('Cancel')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
