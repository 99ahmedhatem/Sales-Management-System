import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { dateLocale } from '../../i18n/locale';

type Row = {
  id: number; created_at: string; table_name: string; action: string; row_id: string | null;
  changed_by: string | null; changed_by_name: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null;
};
const PAGE = 50;

/** يعرض الحقول اللي اتغيّرت بس: old → new */
function diff(r: Row): string {
  const o = r.old_data ?? {}, n = r.new_data ?? {};
  if (r.action === 'INSERT') return Object.entries(n).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  if (r.action === 'DELETE') return Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)])).filter(k => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
  return keys.map(k => `${k}: ${o[k] == null ? '∅' : String(o[k])} → ${n[k] == null ? '∅' : String(n[k])}`).join(' · ');
}

export default function AdminAuditLog() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [tables, setTables] = useState<{ table_name: string; events: number }[]>([]);
  const [tableFilter, setTableFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const [feed, tabs] = await Promise.all([
      supabase.rpc('get_audit_feed', { p_limit: PAGE, p_offset: page * PAGE, p_table: tableFilter || null }),
      supabase.rpc('get_audit_tables'),
    ]);
    if (feed.error) setError(feed.error.message); else setRows((feed.data ?? []) as Row[]);
    if (!tabs.error) setTables((tabs.data ?? []) as { table_name: string; events: number }[]);
    setLoading(false);
  }, [page, tableFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{t('Activity log')}</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{t('Every important change made in the system, newest first')}</p>
        </div>
        <div className="flex gap-2">
          <select value={tableFilter} onChange={e => { setPage(0); setTableFilter(e.target.value); }}
            className="bg-[#0c0c0c] border border-[#262626] rounded px-2 py-1.5 text-sm text-white">
            <option value="">{t('All tables')}</option>
            {tables.map(x => <option key={x.table_name} value={x.table_name}>{x.table_name} ({x.events})</option>)}
          </select>
          <button onClick={load} className="border border-[#262626] rounded px-3 py-1.5 text-sm text-white hover:border-[#dfff03]">{t('Refresh')}</button>
        </div>
      </div>

      {error && <div className="text-sm text-white bg-[#2a1a1a] border border-[#4a2a2a] rounded p-3 break-words">⚠ {error}</div>}

      <div className="bg-[#161616] border border-[#262626] rounded-lg overflow-x-auto">
        <table className="w-full text-xs text-white">
          <thead>
            <tr className="text-[#6b6b6b] border-b border-[#262626] text-start">
              {[t('When'), t('Who'), t('Table'), t('Action'), t('Details')].map(h => <th key={h} className="text-start font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-8 text-center text-[#6b6b6b]">{t('Loading…')}</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-[#6b6b6b]">{t('No activity recorded yet')}</td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.id} className="border-b border-[#1d1d1d] align-top">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-[#a3a3a3]">{new Date(r.created_at).toLocaleString(dateLocale(lang))}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.changed_by_name ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap font-mono">{r.table_name}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${r.action === 'DELETE' ? 'bg-[#3a1a1a] text-[#ff8a8a]' : r.action === 'INSERT' ? 'bg-[#13281f] text-[#7be0b4]' : 'bg-[#1d2430] text-[#8fb8f5]'}`}>{r.action}</span>
                </td>
                <td className="px-3 py-2 text-[#d4d4d4] break-words max-w-[520px]">{diff(r) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-[#a3a3a3]">
        <button disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-[#262626] rounded disabled:opacity-40">{t('Previous')}</button>
        <span>{t('Page {n}', { n: page + 1 })}</span>
        <button disabled={rows.length < PAGE || loading} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-[#262626] rounded disabled:opacity-40">{t('Next')}</button>
      </div>
    </div>
  );
}
