import { ReactNode, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

/** Chart colors (validated on the dark surface). Fixed order, never cycled. */
export const CHART_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
const GRID = '#262626';
const INK = '#e5e5e5';
const MUTED = '#8a8a8a';

export const nf = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(Number(n)) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(Number(n));

export const compact = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function Panel({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-[#161616] border border-[#262626] rounded-lg p-4 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-[#e5e5e5]">{title}</h3>
          {hint && <p className="text-xs text-[#8a8a8a] mt-0.5">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ text }: { text?: string }) {
  const { t } = useI18n();
  return <div className="text-xs text-[#8a8a8a] py-6 text-center">{text ?? t("No data in this period")}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="text-xs text-[#e5e5e5] bg-[#2a1a1a] border border-[#4a2a2a] rounded p-2 break-words anim-banner">⚠ {message}</div>;
}

export function Kpi({ label, value, sub, color }: { label: string; value: ReactNode; sub?: string; color?: string }) {
  return (
    <div className="bg-[#161616] border border-[#262626] rounded-lg p-4 min-w-0 anim-card">
      <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">
        {color && <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />}
        {label}
      </div>
      <div className="text-2xl font-semibold text-[#e5e5e5] mt-1 tabular-nums truncate">{value}</div>
      {sub && <div className="text-xs text-[#8a8a8a] mt-0.5">{sub}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-[#a3a3a3]">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Vertical columns (single series) with hover tooltip. */
export function ColumnChart({
  data, color, unit, height = 160,
}: { data: { label: string; value: number }[]; color: string; unit: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map(d => d.value));
  const W = 560, padL = 40, padB = 22, padT = 10;
  const H = height, plotH = H - padB - padT;
  const slot = (W - padL) / Math.max(1, data.length);
  const bw = Math.min(28, slot * 0.6);
  const ticks = [0, 0.5, 1].map(f => f * max);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${unit} per month`}>
        {ticks.map(t => {
          const y = padT + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill={MUTED}>{compact(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * plotH;
          const x = padL + i * slot + (slot - bw) / 2;
          const y = padT + plotH - h;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH + padB} fill="transparent" />
              {d.value > 0 && (
                <path
                  d={`M${x},${padT + plotH} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + bw - 4} Q${x + bw},${y} ${x + bw},${y + 4} V${padT + plotH} Z`}
                  fill={color} opacity={hover == null || hover === i ? 1 : 0.45}
                />
              )}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill={MUTED}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div
          className="absolute pointer-events-none bg-[#0c0c0c] border border-[#333] rounded px-2 py-1 text-xs text-[#e5e5e5] shadow"
          style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, top: 0, transform: 'translateX(-50%)' }}
        >
          <div className="text-[#8a8a8a]">{data[hover].label}</div>
          <div className="tabular-nums">{nf(data[hover].value)} {unit}</div>
        </div>
      )}
    </div>
  );
}

export interface BarRow { label: string; value: number; sub?: string; color?: string; tip?: string }

/** Horizontal bars: label + value, tooltip via title. */
export function HBars({ rows, unit = '', color = CHART_COLORS[0], format = (n: number) => nf(n) }: {
  rows: BarRow[]; unit?: string; color?: string; format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={`${i}-${r.label}`} title={r.tip ?? `${r.label}: ${format(r.value)} ${unit}`} className="group">
          <div className="flex items-baseline justify-between gap-2 text-xs mb-1">
            <span className="text-[#e5e5e5] truncate">{r.label}</span>
            <span className="text-[#a3a3a3] tabular-nums shrink-0">{format(r.value)}{unit && ` ${unit}`}{r.sub ? ` · ${r.sub}` : ''}</span>
          </div>
          <div className="h-2 bg-[#222] rounded-sm overflow-hidden">
            <div className="h-full rounded-e-sm group-hover:opacity-80 anim-bar" style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%`, background: r.color ?? color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Progress toward a target (0..100+). */
export function ProgressRow({ label, done, target, unit = '' }: { label: string; done: number; target: number; unit?: string }) {
  const pct = target > 0 ? (done / target) * 100 : 0;
  return (
    <div title={`${label}: ${nf(done)} / ${nf(target)} ${unit}`}>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#a3a3a3]">{label}</span>
        <span className="text-[#e5e5e5] tabular-nums">{nf(done)} / {target > 0 ? nf(target) : '—'}{target > 0 ? ` (${nf(pct)}%)` : ''}</span>
      </div>
      <div className="h-1.5 bg-[#222] rounded-sm overflow-hidden">
        <div className="h-full rounded-e-sm anim-bar" style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? CHART_COLORS[2] : CHART_COLORS[0] }} />
      </div>
    </div>
  );
}

/** Funnel: each stage as a horizontal bar relative to the first stage, plus conversion from the previous stage. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const { t } = useI18n();
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].value;
        const conv = prev && prev > 0 ? (s.value / prev) * 100 : null;
        return (
          <div key={s.label} title={`${s.label}: ${nf(s.value)}${conv != null ? ` (${t('{p}% of previous stage', { p: nf(conv, 1) })})` : ''}`}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[#e5e5e5]">{s.label}</span>
              <span className="text-[#a3a3a3] tabular-nums">{nf(s.value)}{conv != null ? ` · ${nf(conv, 1)}%` : ''}</span>
            </div>
            <div className="h-3 bg-[#222] rounded-sm overflow-hidden">
              <div className="h-full rounded-e-sm anim-bar" style={{ width: `${Math.max(s.value > 0 ? 1.5 : 0, (s.value / top) * 100)}%`, background: CHART_COLORS[0] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-[#e5e5e5] anim-rows">
        <thead>
          <tr className="text-[#8a8a8a] border-b border-[#262626]">
            {head.map(h => <th key={h} className="text-start font-medium py-1.5 pe-3 whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#1d1d1d]">
              {r.map((c, j) => <td key={j} className="py-1.5 pe-3 tabular-nums whitespace-nowrap">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
