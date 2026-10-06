import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Avatar, Badge, Button, Card, SearchInput, Select, StatusBadge, Toggle } from '../ui';
import { TableSkeleton } from '../shared/motion';

interface UserPermissions {
  user_id: string;
  username: string | null;
  full_name: string;
  role: 'manager' | 'sales' | 'telesales';
  status: string;
  permissions: Record<string, boolean>;
  overrides: Record<string, boolean>;
}
interface CatalogItem { key: string; label: string; group: string }
/** Pending change per key: true/false = override, null = back to the role default. */
type Draft = Record<string, boolean | null>;

// The catalog labels are Arabic (label_ar); these are shown when the UI is in English.
const LABELS_EN: Record<string, string> = {
  'leads.view_all': 'View all clients', 'leads.edit': 'Edit client data', 'leads.export': 'Export clients',
  'leads.distribute': 'Distribute clients', 'leads.delete': 'Delete clients', 'deals.create': 'Create deals',
  'deals.approve': 'Approve deals', 'payments.confirm': 'Confirm payments', 'packages.manage': 'Manage packages',
  'users.manage': 'Manage users', 'salaries.view': 'View salaries & commissions', 'reports.view': 'View reports',
  'audit.view': 'View activity log',
};
const GROUPS_EN: Record<string, string> = { 'العملاء': 'Clients', 'الصفقات': 'Deals', 'الإدارة': 'Administration' };
const ROLE_LABELS: Record<string, string> = { manager: 'Manager', sales: 'Sales', telesales: 'Telesales' };

/** Admin only: per-user permissions on top of the role defaults (037). */
export default function AdminPermissions() {
  const { t, lang } = useI18n();
  const [users, setUsers] = useState<UserPermissions[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [defaults, setDefaults] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState<'' | 'save' | 'reset'>('');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    window.setTimeout(() => setToast(cur => (cur?.text === text ? null : cur)), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [usersRes, catalogRes, defaultsRes] = await Promise.all([
      supabase.rpc('get_all_users_permissions'),
      supabase.rpc('get_permission_catalog'),
      supabase.from('role_default_permissions').select('role, permission_key').range(0, 999),
    ]);
    const err = usersRes.error?.message || catalogRes.error?.message || defaultsRes.error?.message || '';
    setError(err);
    if (!usersRes.error) setUsers((usersRes.data ?? []) as UserPermissions[]);
    if (!catalogRes.error) setCatalog((catalogRes.data ?? []) as CatalogItem[]);
    if (!defaultsRes.error) {
      const map: Record<string, Set<string>> = {};
      for (const r of (defaultsRes.data ?? []) as { role: string; permission_key: string }[]) (map[r.role] ??= new Set()).add(r.permission_key);
      setDefaults(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = users.find(u => u.user_id === selectedId) ?? null;
  const changedCount = Object.keys(draft).length;

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u =>
      (!roleFilter || u.role === roleFilter) &&
      (!q || u.full_name?.toLowerCase().includes(q) || (u.username ?? '').toLowerCase().includes(q)));
  }, [users, search, roleFilter]);

  const groups = useMemo(() => {
    const out: { group: string; items: CatalogItem[] }[] = [];
    for (const item of catalog) {
      const g = out.find(x => x.group === item.group);
      if (g) g.items.push(item); else out.push({ group: item.group, items: [item] });
    }
    return out;
  }, [catalog]);

  function pick(id: string) {
    if (id === selectedId) return;
    if (changedCount && !window.confirm(t('Discard unsaved changes?'))) return;
    setDraft({});
    setSelectedId(id);
  }

  function roleDefault(u: UserPermissions, key: string) {
    return defaults[u.role]?.has(key) ?? false;
  }

  function effective(u: UserPermissions, key: string): boolean {
    if (key in draft) return draft[key] === null ? roleDefault(u, key) : Boolean(draft[key]);
    return Boolean(u.permissions[key]);
  }

  function isCustom(u: UserPermissions, key: string): boolean {
    if (key in draft) return draft[key] !== null;
    return key in (u.overrides ?? {});
  }

  function toggle(u: UserPermissions, key: string, value: boolean) {
    setDraft(prev => {
      const next = { ...prev };
      const hadOverride = key in (u.overrides ?? {});
      // Same as the role default and no stored override → nothing to send
      if (value === roleDefault(u, key) && !hadOverride) delete next[key];
      else if (hadOverride && u.overrides[key] === value) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function backToDefault(u: UserPermissions, key: string) {
    setDraft(prev => {
      const next = { ...prev };
      if (key in (u.overrides ?? {})) next[key] = null;
      else delete next[key];
      return next;
    });
  }

  async function save() {
    if (!selected || !changedCount || busy) return;
    if (!window.confirm(t('Save {n} permission changes for {name}?', { n: changedCount, name: selected.full_name }))) return;
    setBusy('save');
    const { error: rpcError } = await supabase.rpc('set_user_permissions', { p_user: selected.user_id, p_perms: draft });
    setBusy('');
    if (rpcError) { showToast(false, rpcError.message); return; }
    setDraft({});
    showToast(true, t('Permissions saved'));
    await load();
  }

  async function reset() {
    if (!selected || busy) return;
    if (!window.confirm(t('Reset all permissions of {name} to the role defaults?', { name: selected.full_name }))) return;
    setBusy('reset');
    const { error: rpcError } = await supabase.rpc('reset_user_permissions', { p_user: selected.user_id });
    setBusy('');
    if (rpcError) { showToast(false, rpcError.message); return; }
    setDraft({});
    showToast(true, t('Permissions reset to the role defaults'));
    await load();
  }

  const label = (item: CatalogItem) => (lang === 'ar' ? item.label : LABELS_EN[item.key] ?? item.label);
  const groupLabel = (g: string) => (lang === 'ar' ? g : GROUPS_EN[g] ?? g);
  const overrideCount = (u: UserPermissions) => Object.keys(u.overrides ?? {}).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-white text-2xl font-bold">{t('Permissions')}</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">{t('Per-user permissions on top of the role defaults. Admins always have every permission.')}</p>
      </div>

      {error && (
        <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-banner">
          {t(error)} <button className="ms-2 underline" onClick={() => void load()}>{t('Retry')}</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* Users list (hidden on phones while a user is open) */}
        <Card className={`p-3 space-y-3 ${selected ? 'hidden lg:block' : ''}`}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or username..." />
          <Select
            value={roleFilter}
            onChange={setRoleFilter}
            className="w-full"
            options={[{ value: '', label: 'All roles' }, { value: 'manager', label: 'Manager' }, { value: 'sales', label: 'Sales' }, { value: 'telesales', label: 'Telesales' }]}
          />
          {loading && !users.length ? <TableSkeleton rows={6} cols={1} /> : visibleUsers.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#4a4a4a]">{t('No users match.')}</p>
          ) : (
            <ul className="space-y-1 anim-rows max-h-[70vh] overflow-y-auto">
              {visibleUsers.map(u => (
                <li key={u.user_id}>
                  <button
                    onClick={() => pick(u.user_id)}
                    className={`w-full flex items-center gap-3 rounded-lg p-2.5 text-start transition-colors ${u.user_id === selectedId ? 'bg-[#dfff03]/10' : 'hover:bg-[#1a1a1a]'}`}
                  >
                    <Avatar name={u.full_name || '?'} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm font-medium ${u.user_id === selectedId ? 'text-[#dfff03]' : 'text-white'}`}>{u.full_name}</div>
                      <div className="text-xs text-[#6b6b6b]">{t(ROLE_LABELS[u.role] ?? u.role)}{u.username ? ` · ${u.username}` : ''}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={u.status} />
                      {overrideCount(u) > 0 && <Badge className="bg-[#dfff03]/10 text-[#dfff03]">{t('{n} custom', { n: overrideCount(u) })}</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Permissions of the selected user */}
        <div className={selected ? '' : 'hidden lg:block'}>
          {!selected ? (
            <Card className="p-10 text-center text-sm text-[#4a4a4a]">{t('Choose a user to see their permissions.')}</Card>
          ) : (
            <Card className="p-4 space-y-4 anim-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button className="lg:hidden text-[#a0a0a0] hover:text-white text-sm" onClick={() => pick('')}>← {t('Back')}</button>
                  <Avatar name={selected.full_name || '?'} size="md" />
                  <div className="min-w-0">
                    <div className="truncate text-white font-semibold">{selected.full_name}</div>
                    <div className="text-xs text-[#6b6b6b]">{t(ROLE_LABELS[selected.role] ?? selected.role)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void reset()}>
                    {busy === 'reset' ? t('Resetting…') : t('Back to defaults')}
                  </Button>
                  <Button size="sm" disabled={!changedCount || !!busy} onClick={() => void save()}>
                    {busy === 'save' ? t('Saving…') : changedCount ? t('Save ({n})', { n: changedCount }) : t('Save')}
                  </Button>
                </div>
              </div>

              {groups.map(({ group, items }) => (
                <section key={group} className="space-y-1">
                  <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{groupLabel(group)}</div>
                  <ul className="divide-y divide-[#1e1e1e] rounded-lg border border-[#262626]">
                    {items.map(item => {
                      const on = effective(selected, item.key);
                      const custom = isCustom(selected, item.key);
                      const pending = item.key in draft;
                      return (
                        <li key={item.key} className={`flex items-center justify-between gap-3 px-3 py-2.5 transition-colors ${pending ? 'bg-[#dfff03]/5' : ''}`}>
                          <div className="min-w-0">
                            <div className="text-sm text-white">{label(item)}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[10px] text-[#4a4a4a]" dir="ltr">{item.key}</span>
                              {custom ? (
                                <button
                                  onClick={() => backToDefault(selected, item.key)}
                                  title={t('Back to the role default')}
                                  className="inline-flex items-center gap-1 rounded bg-[#dfff03]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#dfff03] hover:bg-[#dfff03]/20"
                                >
                                  {t('Custom')} ✕
                                </button>
                              ) : (
                                <span className="text-[10px] text-[#6b6b6b]">{t('Role default')}</span>
                              )}
                              {pending && <span className="text-[10px] text-[#ffc832]">● {t('Unsaved')}</span>}
                            </div>
                          </div>
                          <Toggle checked={on} disabled={!!busy} onChange={v => toggle(selected, item.key, v)} />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </Card>
          )}
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 start-1/2 z-50 -translate-x-1/2 rtl:translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-lg anim-banner ${toast.ok ? 'border-[#64dc78]/30 bg-[#0f1a12] text-[#64dc78]' : 'border-[#ff6464]/30 bg-[#1a0f0f] text-[#ff8888]'}`}
        >
          {toast.ok ? '✓ ' : '✕ '}{toast.text}
        </div>
      )}
    </div>
  );
}
