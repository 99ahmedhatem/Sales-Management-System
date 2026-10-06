import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { formatEgp, formatMoney, formatSar } from '../../lib/format';
import { currentPushSubscription, disablePush, enablePush, needsHomeScreenInstall, pushConfigured, pushSupported } from '../../lib/push';
import { Button, StatusBadge, Toggle } from '../ui';
import { Empty, ErrorNote, Kpi, Panel, ProgressRow, nf } from './charts';
import { TableSkeleton } from './motion';

interface Profile {
  user: { id: string; full_name: string; role: string; email: string | null; manager_name: string | null; status: string };
  month: string;
  rates: { base_salary?: number; base_currency?: string; closer_percent?: number; lead_percent?: number; manager_percent?: number };
  stats: { calls_done?: number; meetings_done?: number; deals_done?: number; revenue_sar?: number };
  pay: { deals_count?: number; commission_sar?: number; commission_egp?: number; base_salary?: number; base_currency?: string; total_sar?: number; total_egp?: number };
  target: { calls_target?: number; meetings_target?: number; deals_target?: number; revenue_target_sar?: number; collected_sar?: number } | null;
  deals: { id: string; client: string; status: string; price_sar: number; created_at: string }[];
  open_leads: number;
  overdue_followups: number;
}

const DEAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', contract_uploaded: 'Contract Uploaded', pending_approval: 'Pending Approval',
  approved: 'Approved', active: 'Active', cancelled: 'Cancelled',
};
const ROLE_LABELS: Record<string, string> = { admin: 'Administrator', manager: 'Manager', sales: 'Sales', telesales: 'Telesales' };

const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

/** My profile (no userId) or an employee's profile opened by admin / manager. */
export default function ProfileView({ userId }: { userId?: string }) {
  const { t } = useI18n();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data: res, error: rpcError } = await supabase.rpc('get_my_profile', { p_month: `${month}-01`, ...(userId ? { p_user_id: userId } : {}) });
    if (rpcError) { setError(rpcError.message); setData(null); }
    else setData(res as Profile);
    setLoading(false);
  }, [month, userId]);

  useEffect(() => { void load(); }, [load]);

  const tgt = data?.target;
  const stats = data?.stats ?? {};
  const hasTarget = Boolean(tgt && (Number(tgt.calls_target) || Number(tgt.meetings_target) || Number(tgt.deals_target) || Number(tgt.revenue_target_sar)));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#e5e5e5]">{userId ? t('Employee profile') : t('My profile')}</h1>
          <p className="text-xs text-[#8a8a8a]">{t('Salary = base + commissions · Collected = confirmed payments only')}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month" value={month} max={thisMonth()} aria-label={t('Month')}
            onChange={e => e.target.value && setMonth(e.target.value)}
            className="bg-[#0c0c0c] border border-[#262626] rounded px-2 py-1 text-sm text-[#e5e5e5]"
          />
          <button onClick={() => void load()} disabled={loading} className="text-xs border border-[#262626] rounded px-2 py-1.5 text-[#e5e5e5] hover:border-[#dfff03] disabled:opacity-40">
            {t('Refresh')}
          </button>
        </div>
      </div>

      {error && <ErrorNote message={t(error)} />}
      {loading && !data && <TableSkeleton />}

      {data && (
        <>
          <Panel title={data.user.full_name}>
            <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
              <div><div className="text-xs text-[#8a8a8a]">{t('Role')}</div><div className="text-white">{t(ROLE_LABELS[data.user.role] ?? data.user.role)}</div></div>
              <div><div className="text-xs text-[#8a8a8a]">{t('Email')}</div><div className="truncate text-white" dir="ltr">{data.user.email ?? '—'}</div></div>
              <div><div className="text-xs text-[#8a8a8a]">{t('Manager')}</div><div className="text-white">{data.user.manager_name ?? '—'}</div></div>
              <div><div className="text-xs text-[#8a8a8a]">{t('Status')}</div><StatusBadge status={data.user.status} /></div>
            </div>
          </Panel>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 anim-stagger">
            <Kpi label={t('Base salary')} value={formatMoney(data.pay.base_salary ?? data.rates.base_salary ?? 0, data.pay.base_currency ?? data.rates.base_currency)} />
            <Kpi label={t('Commission (SAR)')} value={formatSar(data.pay.commission_sar ?? 0)} sub={formatEgp(data.pay.commission_egp ?? 0)} />
            <Kpi label={t('Total (SAR)')} value={formatSar(data.pay.total_sar ?? 0)} sub={formatEgp(data.pay.total_egp ?? 0)} />
            <Kpi label={t('Deals with commission')} value={nf(data.pay.deals_count ?? 0)} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={t('Calls')} value={nf(stats.calls_done ?? 0)} />
            <Kpi label={t('Meetings')} value={nf(stats.meetings_done ?? 0)} />
            <Kpi label={t('Deals')} value={nf(stats.deals_done ?? 0)} />
            <Kpi label={t('Revenue (SAR)')} value={formatSar(stats.revenue_sar ?? 0)} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel title={t('Target progress')} hint={data.month}>
              {hasTarget && tgt ? (
                <div className="space-y-3">
                  {Number(tgt.calls_target) > 0 && <ProgressRow label={t('Calls')} done={Number(stats.calls_done ?? 0)} target={Number(tgt.calls_target)} />}
                  {Number(tgt.meetings_target) > 0 && <ProgressRow label={t('Meetings')} done={Number(stats.meetings_done ?? 0)} target={Number(tgt.meetings_target)} />}
                  {Number(tgt.deals_target) > 0 && <ProgressRow label={t('Deals')} done={Number(stats.deals_done ?? 0)} target={Number(tgt.deals_target)} />}
                  {Number(tgt.revenue_target_sar) > 0 && <ProgressRow label={t('Collected (SAR)')} done={Number(tgt.collected_sar ?? stats.revenue_sar ?? 0)} target={Number(tgt.revenue_target_sar)} unit=" SAR" />}
                </div>
              ) : <Empty text={t('No target set for this month.')} />}
            </Panel>
            <Panel title={t('Rates')} hint={t('Set by the admin')}>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-[#8a8a8a]">{t('Commission %')}</div><div className="text-white">{nf(data.rates.closer_percent ?? 0, 2)}%</div></div>
                <div><div className="text-xs text-[#8a8a8a]">{t('Lead %')}</div><div className="text-white">{nf(data.rates.lead_percent ?? 0, 2)}%</div></div>
                <div><div className="text-xs text-[#8a8a8a]">{t('Manager %')}</div><div className="text-white">{nf(data.rates.manager_percent ?? 0, 2)}%</div></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded bg-[#1a1a1a] p-3"><div className="text-xs text-[#8a8a8a]">{t('Open clients')}</div><div className="text-xl font-bold text-white">{nf(data.open_leads)}</div></div>
                <div className="rounded bg-[#1a1a1a] p-3">
                  <div className="text-xs text-[#8a8a8a]">{t('Overdue follow-ups')}</div>
                  <div className={`text-xl font-bold ${data.overdue_followups > 0 ? 'text-[#ff8888]' : 'text-white'}`}>{data.overdue_followups > 0 ? '! ' : ''}{nf(data.overdue_followups)}</div>
                </div>
              </div>
            </Panel>
          </div>

          <Panel title={t('Latest deals')} hint={data.month}>
            {data.deals.length === 0 ? <Empty text={t('No deals this month.')} /> : (
              <ul className="divide-y divide-[#1d1d1d]">
                {data.deals.map(d => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-white">{d.client}</div>
                      <div className="text-xs text-[#6b6b6b]">{String(d.created_at).slice(0, 10)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-white">{formatSar(d.price_sar)}</span>
                      <StatusBadge status={DEAL_STATUS_LABELS[d.status] ?? d.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {!userId && <NotificationSettings />}
        </>
      )}
    </div>
  );
}

/** Push (this device) and email preferences. */
function NotificationSettings() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<{ push: boolean; email: boolean; devices: number } | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const canPush = pushConfigured() && pushSupported();

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('get_notification_prefs');
    if (rpcError) setError(rpcError.message);
    else {
      const row = (Array.isArray(data) ? data[0] : data) as { push: boolean; email: boolean; devices: number } | undefined;
      setPrefs(row ? { push: row.push, email: row.email, devices: Number(row.devices) } : { push: true, email: false, devices: 0 });
    }
    if (canPush) setSubscribed(Boolean(await currentPushSubscription().catch(() => null)));
  }, [canPush]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<string>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const err = await action();
      if (err) setError(err);
      else setMsg(okMsg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function savePrefs(next: { push: boolean; email: boolean }) {
    await run(async () => {
      const { error: rpcError } = await supabase.rpc('set_notification_prefs', { p_push: next.push, p_email: next.email });
      return rpcError ? rpcError.message : '';
    }, t('Saved'));
  }

  return (
    <Panel title={t('Notifications')} hint={t('Get system notifications outside the website')}>
      {!prefs && !error ? <TableSkeleton rows={2} /> : (
        <div className="space-y-4 text-sm">
          {prefs && (
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[#e5e5e5]">{t('Push notifications on my devices')}</span>
                <Toggle checked={prefs.push} disabled={busy} onChange={v => void savePrefs({ push: v, email: prefs.email })} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-[#e5e5e5]">{t('Email notifications')}</span>
                <Toggle checked={prefs.email} disabled={busy} onChange={v => void savePrefs({ push: prefs.push, email: v })} />
              </label>
              <div className="text-xs text-[#8a8a8a]">{t('Registered devices: {n}', { n: prefs.devices })}</div>
            </div>
          )}
          {/* The device button is hidden when VITE_VAPID_PUBLIC_KEY is not set */}
          {pushConfigured() && (
            needsHomeScreenInstall() ? (
              <p className="rounded bg-[#1a1a1a] p-3 text-xs text-[#ffc832]">{t('On iPhone: open this site in Safari, tap Share → "Add to Home Screen", then open the app from the Home Screen and enable notifications there.')}</p>
            ) : canPush ? (
              <div className="rounded bg-[#1a1a1a] p-3">
                {subscribed ? (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(disablePush, t('Notifications turned off on this device.'))}>
                    {t('Turn off notifications on this device')}
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => void run(enablePush, t('Notifications enabled on this device.'))}>
                    {t('Enable notifications on this device')}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#8a8a8a]">{t('This browser does not support push notifications.')}</p>
            )
          )}
          {msg && <div className="text-xs text-[#64dc78]">{msg}</div>}
          {error && <ErrorNote message={t(error)} />}
        </div>
      )}
    </Panel>
  );
}
