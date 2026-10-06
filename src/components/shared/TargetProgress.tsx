import { TableSkeleton } from './motion';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Modal } from '../ui';
import { Empty, ErrorNote, ProgressRow } from './charts';

/**
 * One row of get_target_progress_v2 as it runs on Supabase (025). There is no kind column:
 * a manager's row is their whole-team total, so `kind` is derived here from `role`.
 */
interface TargetRow {
  kind: 'member' | 'team';
  user_id: string;
  full_name: string;
  role: 'manager' | 'sales' | 'telesales';
  manager_id: string | null;
  team_size: number;
  calls_done: number;
  meetings_done: number;
  deals_done: number;
  revenue_sar: number;
  collected_sar: number;
  calls_target: number;
  meetings_target: number;
  deals_target: number;
  revenue_target_sar: number;
}

interface TargetForm { calls: string; meetings: string; deals: string; revenue: string }

const INPUT_CLASS = 'w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60';

/**
 * Target vs. achievement for the selected month. The database decides who appears:
 * admin = everyone, manager = their team total + each team member, sales/telesales = themselves.
 */
export default function TargetProgress({ month, canEdit }: { month: string; canEdit: boolean }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<TargetRow | null>(null);
  const [form, setForm] = useState<TargetForm>({ calls: '', meetings: '', deals: '', revenue: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('get_target_progress_v2', { p_month: `${month}-01` });
    if (rpcError) {
      setError(rpcError.message);
      setRows([]);
    } else {
      setRows(((data ?? []) as Omit<TargetRow, 'kind'>[]).map(r => ({
        ...r,
        kind: r.role === 'manager' ? 'team' : 'member',
        team_size: Number(r.team_size ?? 0), collected_sar: Number(r.collected_sar ?? 0),
        calls_done: Number(r.calls_done), meetings_done: Number(r.meetings_done), deals_done: Number(r.deals_done),
        revenue_sar: Number(r.revenue_sar), calls_target: Number(r.calls_target), meetings_target: Number(r.meetings_target),
        deals_target: Number(r.deals_target), revenue_target_sar: Number(r.revenue_target_sar),
      })));
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (row: TargetRow) => {
    setEditing(row);
    setSaveError('');
    setForm({
      calls: String(row.calls_target || ''),
      meetings: String(row.meetings_target || ''),
      deals: String(row.deals_target || ''),
      revenue: String(row.revenue_target_sar || ''),
    });
  };

  const saveTarget = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveError('');
    const { error: rpcError } = await supabase.rpc('admin_set_target', {
      p_user_id: editing.user_id,
      p_month: `${month}-01`,
      p_calls: Math.round(Number(form.calls) || 0),
      p_meetings: Math.round(Number(form.meetings) || 0),
      p_deals: Math.round(Number(form.deals) || 0),
      p_revenue_sar: Number(form.revenue) || 0,
    });
    setSaving(false);
    if (rpcError) {
      setSaveError(rpcError.message);
      return;
    }
    setEditing(null);
    await load();
  };

  const roleLabel = (role: string) => (role === 'manager' ? t('Manager') : role === 'sales' ? t('Sales') : t('Telesales'));

  const card = (row: TargetRow, compact = false) => (
    <div key={`${row.kind}-${row.user_id}`} className={`rounded-lg border p-4 space-y-2 ${row.kind === 'team' ? 'border-[#dfff03]/30 bg-[#dfff03]/5' : 'border-[#262626] bg-[#161616]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[#e5e5e5] truncate">
            {row.kind === 'team' ? t('Team of {name}', { name: row.full_name }) : row.full_name}
          </div>
          <div className="text-[11px] text-[#8a8a8a]">{row.kind === 'team' ? `${t('Whole-team total')} · ${t('{n} team members', { n: row.team_size })}` : roleLabel(row.role)}</div>
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>{t('Set target')}</Button>
        )}
      </div>
      <ProgressRow label={t('Revenue')} done={row.revenue_sar} target={row.revenue_target_sar} unit={t('SAR')} />
      <ProgressRow label={t('Deals')} done={row.deals_done} target={row.deals_target} />
      {!compact && <ProgressRow label={t('Meetings')} done={row.meetings_done} target={row.meetings_target} />}
      {!compact && <ProgressRow label={t('Calls')} done={row.calls_done} target={row.calls_target} />}
    </div>
  );

  const teams = rows.filter(r => r.kind === 'team');
  const members = rows.filter(r => r.kind === 'member');
  const teamIds = new Set(teams.map(r => r.user_id));
  const loose = members.filter(m => !m.manager_id || !teamIds.has(m.manager_id));

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#e5e5e5]">{t('Targets')}</h2>
        <span className="text-xs text-[#8a8a8a]">{month}</span>
      </div>
      {error && <ErrorNote message={t(error)} />}
      {loading && <div className="text-xs text-[#8a8a8a] py-4 text-center"><TableSkeleton /></div>}
      {!loading && !error && rows.length === 0 && <Empty text={t('No targets to show')} />}
      {!loading && !error && teams.map(team => (
        <div key={team.user_id} className="space-y-3">
          {card(team)}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 ps-0 sm:ps-4">
            {members.filter(m => m.manager_id === team.user_id).map(m => card(m, true))}
          </div>
        </div>
      ))}
      {!loading && !error && loose.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {loose.map(m => card(m, teams.length > 0))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Set target">
        {editing && (
          <div className="space-y-3">
            <div className="text-white text-sm font-medium">
              {editing.kind === 'team' ? t('Team of {name}', { name: editing.full_name }) : editing.full_name} · {month}
            </div>
            {editing.kind === 'team' && (
              <p className="text-[#6b6b6b] text-xs">{t('A manager’s target is for their whole team’s total.')}</p>
            )}
            {saveError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded p-2 break-words anim-shake">{t(saveError)}</div>}
            {([
              ['revenue', 'Revenue target (SAR)'],
              ['deals', 'Deals target'],
              ['meetings', 'Meetings target'],
              ['calls', 'Calls target'],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs text-[#a0a0a0] mb-1">{t(label)}</label>
                <input type="number" min={0} step="1" value={form[key]} placeholder="0"
                  onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))} className={INPUT_CLASS} />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="primary" disabled={saving} onClick={saveTarget}>{saving ? t('Saving…') : t('Save')}</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>{t('Cancel')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
