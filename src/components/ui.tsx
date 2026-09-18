import { ReactNode, useState } from 'react';

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
  };
  return <Badge className={map[status] || 'status-no-answer'}>{status}</Badge>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-[#161616] border border-[#262626] rounded-lg ${className}`}>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <Card className="p-5">
      <div className="text-[#6b6b6b] text-xs font-medium uppercase tracking-widest mb-2">{label}</div>
      <div className={`text-3xl font-bold leading-none mb-1 ${accent ? 'text-[#dfff03]' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-[#6b6b6b] text-xs">{sub}</div>}
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
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60 transition-colors ${className}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#161616] border border-[#262626] rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#262626]">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[#6b6b6b] hover:text-white transition-colors text-xl leading-none">&times;</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#262626]">
            {headers.map((h, i) => (
              <th key={i} className="text-left text-[#6b6b6b] font-medium text-xs uppercase tracking-wider py-3 px-4">{h}</th>
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

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`py-3 px-4 text-[#d0d0d0] ${className}`}>{children}</td>;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a4a4a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Search...'}
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded pl-9 pr-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 transition-colors w-full"
      />
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
          {t}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-[#4a4a4a]">
      <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  );
}
