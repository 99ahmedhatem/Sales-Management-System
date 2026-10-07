import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { AnimatedNumber } from './shared/motion';
export function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
export function WebsiteLink({ url, className = '' }: { url?: string; className?: string }) {
  const displayUrl = url?.trim();
  if (!displayUrl) return <span className={className}>—</span>;
  return (
    <a
      href={normalizeWebsiteUrl(displayUrl)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event => event.stopPropagation()}
      className={`${className} hover:text-[#dfff03] hover:underline`}
    >
      {displayUrl}
    </a>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono ${className}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    'New': 'status-new',
    'Assigned': 'status-assigned',
    'Contacted': 'status-contacted',
    'Interested': 'status-interested',
    'Not Interested': 'status-not-interested',
    'Converted': 'status-converted',
    'Call Back Later': 'status-callback',
    'No Answer': 'status-no-answer',
    'Scheduled': 'meeting-scheduled',
    'Deal Closed – Won': 'meeting-won',
    'Deal Lost': 'meeting-lost',
    'Rescheduled': 'meeting-rescheduled',
    'No-Show': 'meeting-noshow',
    'active': 'status-interested',
    'inactive': 'status-not-interested',
    'Draft': 'status-assigned',
    'Contract Uploaded': 'status-callback',
    'Pending Approval': 'status-callback',
    'Approved': 'status-interested',
    'Active': 'status-interested',
    'Cancelled': 'status-not-interested',
  };
  const { t } = useI18n();
  return <Badge className={map[status] || 'status-no-answer'}>{t(status)}</Badge>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-[#161616] border border-[#262626] rounded-lg ${className}`}>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  const { t } = useI18n();
  return (
    <Card className="p-5 anim-card">
      <div className="text-[#6b6b6b] text-xs font-medium uppercase tracking-widest mb-2">{t(label)}</div>
      <div className={`text-3xl font-bold leading-none mb-1 ${accent ? 'text-[#dfff03]' : 'text-white'}`}>{typeof value === 'number' ? <AnimatedNumber value={value} /> : value}</div>
      {sub && <div className="text-[#6b6b6b] text-xs">{t(sub)}</div>}
    </Card>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-2.5 text-sm' };
  const variants = {
    primary: 'bg-[#dfff03] text-black hover:bg-[#d4f002] active:bg-[#c9e502]',
    secondary: 'bg-[#1e1e1e] text-white border border-[#2a2a2a] hover:bg-[#252525]',
    ghost: 'text-[#a0a0a0] hover:text-white hover:bg-[#1e1e1e]',
    danger: 'bg-[#ff4444]/10 text-[#ff6464] border border-[#ff4444]/20 hover:bg-[#ff4444]/20',
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 transition-colors ${className}`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60 transition-colors ${className}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
    </select>
  );
}

// Open modals, newest last: Esc closes only the top one, and the page doesn't scroll behind any of them.
const modalStack: number[] = [];
let modalSeq = 0;

/** Esc closes the top-most open modal; the page behind is locked while at least one is open. */
function useModalLayer(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = ++modalSeq;
    modalStack.push(id);
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
      if (!modalStack.length) document.body.style.overflow = '';
    };
  }, [open]);
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useI18n();
  useModalLayer(open, onClose);
  if (!open) return null;
  // Rendered on <body> so a transform / filter on any parent can't move it off screen
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={t(title)}>
      <div className="absolute inset-0 bg-black/70 anim-backdrop" onClick={onClose} />
      <div className="relative bg-[#161616] border border-[#262626] rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto anim-modal">
        <div className="flex items-center justify-between p-5 border-b border-[#262626]">
          <h3 className="text-white font-semibold">{t(title)}</h3>
          <button onClick={onClose} aria-label={t('Close')} className="text-[#6b6b6b] hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOptions { title?: string; message: string; confirmLabel?: string; danger?: boolean }

/**
 * In-page replacement for window.confirm:
 *   const { confirm, confirmUi } = useConfirm();
 *   if (!(await confirm({ message: t('Delete?'), danger: true }))) return;
 *   ... and render {confirmUi} once in the component.
 * Messages are passed already translated.
 */
export function useConfirm() {
  const { t } = useI18n();
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>(resolve => setReq({ ...opts, resolve })), []);
  const finish = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  const confirmUi = (
    <Modal open={!!req} onClose={() => finish(false)} title={req?.title ?? 'Confirm'}>
      <p className="text-sm text-[#d0d0d0] whitespace-pre-line">{req?.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => finish(false)}>{t('Cancel')}</Button>
        <Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>{t(req?.confirmLabel ?? 'Confirm')}</Button>
      </div>
    </Modal>
  );
  return { confirm, confirmUi };
}

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hidden?: boolean }

/** "⋯" button with a small menu (rendered on <body>, so a table's scroll box can't cut it). */
export function ActionMenu({ items, label = 'More actions' }: { items: MenuItem[]; label?: string }) {
  const { t } = useI18n();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const visible = items.filter(i => !i.hidden);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);
  if (!visible.length) return null;
  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = 192; // w-48
    const rtl = document.documentElement.dir === 'rtl';
    const left = Math.min(Math.max(8, rtl ? r.left : r.right - width), window.innerWidth - width - 8);
    const up = r.bottom + 40 * visible.length + 16 > window.innerHeight;
    setPos(up ? { bottom: window.innerHeight - r.top + 4, left } : { top: r.bottom + 4, left });
  };
  return (
    <>
      <button ref={btn} type="button" aria-label={t(label)} aria-haspopup="menu" aria-expanded={!!pos}
        onClick={e => { e.stopPropagation(); if (pos) setPos(null); else open(); }}
        className="rounded px-2 py-1 text-lg leading-none text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white">⋯</button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setPos(null)} />
          <div role="menu" style={pos}
            className="fixed z-[61] w-48 overflow-hidden rounded-lg border border-[#262626] bg-[#161616] py-1 shadow-2xl anim-banner">
            {visible.map(item => (
              <button key={item.label} role="menuitem" type="button" disabled={item.disabled}
                onClick={() => { setPos(null); item.onClick(); }}
                className={`block w-full px-3 py-2 text-start text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                  item.danger ? 'text-[#ff6464] hover:bg-[#ff4444]/10' : 'text-[#d0d0d0] hover:bg-[#1e1e1e] hover:text-white'}`}>
                {t(item.label)}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/** Shared table header style: sticks to the top of the table's own scroll box. */
export const stickyHead = 'sticky top-0 z-[1] bg-[#161616] shadow-[inset_0_-1px_0_#262626]';
/** Long lists scroll inside their card so the header row (and the page's action bar) stay in view. */
export const tableScroll = 'overflow-auto max-h-[calc(100vh-12rem)]';

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={tableScroll}>
      <table className="w-full text-sm anim-rows">
        <thead className={stickyHead}>
          <tr className="border-b border-[#262626]">
            {headers.map((h, i) => (
              <th key={i} className="text-start text-[#6b6b6b] font-medium text-xs uppercase tracking-wider py-3 px-4">{t(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-[#1e1e1e] transition-colors ${onClick ? 'cursor-pointer hover:bg-[#1a1a1a]' : ''}`}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: React.MouseEventHandler<HTMLTableCellElement> }) {
  return <td onClick={onClick} className={`py-3 px-4 text-[#d0d0d0] ${className}`}>{children}</td>;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <svg className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a4a4a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={t(placeholder || 'Search...')}
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded ps-9 pe-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 transition-colors w-full"
      />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const { t } = useI18n();
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-[#262626] px-4 py-3">
      <span className="text-xs text-[#6b6b6b]">{t('Page {page} of {pages} · {total} records', { page: page + 1, pages: pageCount, total: total.toLocaleString('en-US') })}</span>
      <div className="flex gap-2">
        <button disabled={page === 0} onClick={() => onChange(page - 1)} className="rounded border border-[#2a2a2a] px-3 py-1.5 text-xs text-[#a0a0a0] disabled:cursor-not-allowed disabled:opacity-30 hover:border-[#dfff03]">{t('Previous')}</button>
        <button disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)} className="rounded border border-[#2a2a2a] px-3 py-1.5 text-xs text-[#a0a0a0] disabled:cursor-not-allowed disabled:opacity-30 hover:border-[#dfff03]">{t('Next')}</button>
      </div>
    </div>
  );
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const sizeMap = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-11 h-11 text-base' };
  return (
    <div className={`${sizeMap[size]} rounded-full bg-[#dfff03]/10 text-[#dfff03] font-medium flex items-center justify-center flex-shrink-0`}>
      {initials}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  const { t: tr } = useI18n();
  return (
    <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1">
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-4 py-1.5 text-sm rounded-md transition-all ${
            active === t ? 'bg-[#dfff03] text-black font-medium' : 'text-[#6b6b6b] hover:text-white'
          }`}
        >
          {tr(t)}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-[#4a4a4a]">
      <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <p className="text-sm">{t(message)}</p>
      {actionLabel && onAction && <Button size="sm" className="mt-4" onClick={onAction}>{t(actionLabel)}</Button>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${checked ? 'bg-[#dfff03]' : 'bg-[#2a2a2a]'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5'}`}
      />
    </button>
  );
}
