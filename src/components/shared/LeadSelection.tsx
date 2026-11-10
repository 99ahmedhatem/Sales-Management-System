import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Button } from '../ui';
import { useI18n } from '../../i18n/I18nProvider';

type Row = Record<string, any>;

/** Rows for the given lead ids, in chunks of 200 ids, newest first (created_at desc, id desc). RLS decides what comes back. */
export async function fetchLeadsByIds(ids: string[], columns = '*'): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase.from('leads').select(columns)
      .in('id', ids.slice(start, start + 200));
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Row[]));
  }
  return rows.sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id).localeCompare(String(a.id)));
}

/** Pages through a query 1000 rows at a time; stops at `limit` rows (null = all). */
export async function fetchAllPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  limit: number | null = null,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; limit === null || from < limit; from += 1000) {
    const to = limit === null ? from + 999 : Math.min(from + 999, limit - 1);
    const { data, error } = await page(from, to);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < to - from + 1) break;
  }
  return rows;
}

/** "Number of clients" + "Select first N" (after the current filters) + "N clients selected · Clear selection". */
export function SelectFirstN({ selectedCount, max, onSelect, onClear }: {
  selectedCount: number;
  /** results of the current filters; null = unknown */
  max: number | null;
  /** select the first n ids of the current filters */
  onSelect: (n: number) => Promise<void>;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Math.floor(Number(value));
  const valid = Number.isFinite(n) && n > 0;

  const run = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSelect(max !== null ? Math.min(n, max) : n);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={max ?? undefined}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void run(); }}
          placeholder={t('e.g. 100')}
          aria-label={t('Number of clients')}
          title={t('Number of clients')}
          className="w-28 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-xs text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
        />
        <Button variant="secondary" size="sm" disabled={!valid || busy || max === 0} onClick={() => void run()}>
          {busy ? t('Selecting...') : t('Select first {n}', { n: valid ? (max !== null ? Math.min(n, max) : n) : 'N' })}
        </Button>
      </div>
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#dfff03]">{t('{n} clients selected', { n: selectedCount.toLocaleString('en-US') })}</span>
          <button type="button" onClick={onClear} className="text-[#a0a0a0] hover:text-white hover:underline">{t('Clear selection')}</button>
        </div>
      )}
    </div>
  );
}
