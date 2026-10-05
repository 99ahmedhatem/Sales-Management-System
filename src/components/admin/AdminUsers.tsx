import { AnimatedNumber, TableSkeleton } from '../shared/motion';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { User, Role } from '../../data/mockData';
import { Avatar, Badge, Button, Card, Modal, Pagination, SearchInput, Select, StatusBadge, Table, Td, Toggle, Tr } from '../ui';
import { EditablePhoneCell } from '../shared/LeadRowControls';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useI18n } from '../../i18n/I18nProvider';
import { dateLocale } from '../../i18n/locale';

function mapUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    email: row.email,
    lastLogin: row.last_login ?? undefined,
    managerId: row.manager_id ?? undefined,
    commissionPercent: row.commission_percent !== null && row.commission_percent !== undefined ? Number(row.commission_percent) : 0,
  };
}

export default function AdminUsers() {
  const { t, lang } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [emailConfirmed, setEmailConfirmed] = useState<Record<string, boolean>>({});
  const [togglingEmail, setTogglingEmail] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; email: string; password: string } | null>(null);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [resetMessage, setResetMessage] = useState('');
  const [tab, setTab] = useState<'all' | 'manager' | 'telesales' | 'sales'>('all');
  const [pageView, setPageView] = useState<'users' | 'clients'>('users');
  const [assignedLeads, setAssignedLeads] = useState<AssignedLead[]>([]);
  const [clientCounts, setClientCounts] = useState({ total: 0, active: 0, converted: 0, matching: 0 });
  const [clientPage, setClientPage] = useState(0);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [debouncedClientSearch, setDebouncedClientSearch] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const clientsRequestId = useRef(0);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT);
  const [editInitial, setEditInitial] = useState<EditForm>(EMPTY_EDIT);
  const [editTeamMembers, setEditTeamMembers] = useState(0);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [myId, setMyId] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? ''));
  }, []);

  const saveAssignedLeadPhone = async (lead: AssignedLead, value: string) => {
    const phone = value.replace(/[^\d+]/g, '');
    const { error } = await supabase.from('leads').update({ phone: phone || null, phone_source: phone ? 'manual' : null, updated_at: new Date().toISOString() }).eq('id', lead.id);
    if (error) {
      setErrorMsg(error.message);
      throw new Error(error.message);
    }
    setAssignedLeads(prev => prev.map(item => item.id === lead.id ? { ...item, phone } : item));
  };

  async function loadUsers() {
    setLoading(true);
    setErrorMsg('');
    const [usersRes, emailRes, ratesRes] = await Promise.all([
      supabase.from('users').select('*').neq('role', 'admin').order('full_name'),
      supabase.rpc('list_email_confirmations'),
      // Same source as Edit User (admin_get_user_pay): the closer % lives in user_commission_rates.
      supabase.from('user_commission_rates').select('user_id, closer_percent'),
    ]);
    if (usersRes.error) setErrorMsg(usersRes.error.message);
    else if (ratesRes.error) setErrorMsg(ratesRes.error.message);
    else {
      const closer = new Map(((ratesRes.data ?? []) as { user_id: string; closer_percent: number | string }[]).map(r => [r.user_id, Number(r.closer_percent)]));
      const loadedUsers = (usersRes.data ?? []).map(row => {
        const user = mapUser(row);
        return closer.has(user.id) ? { ...user, commissionPercent: closer.get(user.id) } : user;
      });
      setUsers(loadedUsers);
      setSelectedUserId(current => current || loadedUsers[0]?.id || '');
    }
    if (!emailRes.error) {
      const map: Record<string, boolean> = {};
      for (const row of (emailRes.data ?? []) as { id: string; confirmed: boolean }[]) map[row.id] = row.confirmed;
      setEmailConfirmed(map);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useRealtimeRefresh(['users'], loadUsers);

  // Only the selected user's leads are loaded, one page at a time.
  async function loadClients(nextPage = clientPage) {
    if (!selectedUserId) return;
    const reqId = ++clientsRequestId.current;
    setClientsLoading(true);
    let pageQuery = supabase
      .from('leads')
      .select('id, customer_number, client_code, name, phone, company, quantity, status, assigned_to, updated_at', { count: 'exact' })
      .eq('assigned_to', selectedUserId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(nextPage * CLIENT_PAGE_SIZE, (nextPage + 1) * CLIENT_PAGE_SIZE - 1);
    const q = debouncedClientSearch.replace(/[%,()]/g, ' ').trim();
    if (q) pageQuery = pageQuery.or(`name.ilike.%${q}%,phone.ilike.%${q}%,client_code.ilike.%${q}%,company.ilike.%${q}%`);
    const countFor = () => supabase.from('leads').select('id', { count: 'exact', head: true }).eq('assigned_to', selectedUserId);
    const [pageRes, totalRes, closedRes, convertedRes] = await Promise.all([
      pageQuery,
      countFor(),
      countFor().in('status', CLOSED_STATUSES),
      countFor().in('status', CONVERTED_STATUSES),
    ]);
    if (reqId !== clientsRequestId.current) return;
    const firstError = pageRes.error?.message || totalRes.error?.message || closedRes.error?.message || convertedRes.error?.message;
    if (firstError) setErrorMsg(firstError);
    else {
      setAssignedLeads((pageRes.data ?? []).map(mapAssignedLead));
      setClientPage(nextPage);
      const total = totalRes.count ?? 0;
      setClientCounts({ total, active: Math.max(0, total - (closedRes.count ?? 0)), converted: convertedRes.count ?? 0, matching: pageRes.count ?? 0 });
    }
    setClientsLoading(false);
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedClientSearch(clientSearch), 300);
    return () => clearTimeout(timer);
  }, [clientSearch]);

  useEffect(() => {
    if (pageView === 'clients') loadClients(0);
  }, [pageView, selectedUserId, debouncedClientSearch]);

  const managers = users.filter(u => u.role === 'manager');
  const filtered = users.filter(u => tab === 'all' || u.role === tab);
  const selectedUser = users.find(user => user.id === selectedUserId);

  const handleAdd = async () => {
    if (!newUser.fullName || !newUser.email || newUser.password.length < 8) return;
    setErrorMsg('');
    setCreatingUser(true);
    // Created server-side so the admin's own browser session is never replaced.
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: {
        email: newUser.email.trim(),
        password: newUser.password,
        full_name: newUser.fullName.trim(),
        role: newUser.role,
        manager_id: ['sales', 'telesales'].includes(newUser.role) && newUser.managerId ? newUser.managerId : null,
        base_salary: Number(newUser.baseSalary) || 0,
        base_currency: newUser.baseCurrency,
        commission_percent: newUser.role === 'manager' ? 0 : Number(newUser.commissionPercent) || 0,
        lead_percent: newUser.role === 'telesales' ? Number(newUser.leadPercent) || 0 : 0,
        manager_percent: newUser.role === 'manager' ? 0 : Number(newUser.managerPercent) || 0,
      },
    });
    setCreatingUser(false);
    if (error || !data?.username) {
      setErrorMsg(await functionErrorMessage(error, t('Could not create the user.')));
      return;
    }
    await loadUsers();
    setCreatedCredentials({ username: data.username, email: data.email ?? newUser.email.trim(), password: newUser.password });
    setNewUser(EMPTY_NEW_USER);
    setAddModal(false);
  };

  const openEdit = async (u: User) => {
    setEditUser(u);
    setEditError('');
    setEditForm(EMPTY_EDIT);
    setEditLoading(true);
    const { data, error } = await supabase.rpc('admin_get_user_pay', { p_user_id: u.id });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      setEditError(error?.message ?? 'User not found');
    } else {
      const form: EditForm = {
        fullName: row.full_name ?? '',
        role: row.role,
        managerId: row.manager_id ?? '',
        status: row.status === 'inactive' ? 'inactive' : 'active',
        baseSalary: String(row.base_salary ?? 0),
        baseCurrency: row.base_currency === 'SAR' ? 'SAR' : 'EGP',
        commissionPercent: String(row.closer_percent ?? 0),
        leadPercent: String(row.lead_percent ?? 0),
        managerPercent: String(row.manager_percent ?? 0),
      };
      setEditForm(form);
      setEditInitial(form);
      setEditTeamMembers(Number(row.team_members ?? 0));
    }
    setEditLoading(false);
  };

  /** Sends only the fields that changed; the DB keeps the rest. */
  const saveEdit = async () => {
    if (!editUser) return;
    const f = editForm, init = editInitial;
    const changed = (key: keyof EditForm) => f[key] !== init[key];
    const numberChanged = (key: keyof PayForm) => Number(f[key]) !== Number(init[key]);
    const params: Record<string, unknown> = { p_user_id: editUser.id };
    if (f.fullName.trim() !== init.fullName) params.p_full_name = f.fullName.trim();
    if (changed('role')) params.p_role = f.role;
    if (['sales', 'telesales'].includes(f.role) && changed('managerId')) {
      params.p_set_manager = true;
      params.p_manager_id = f.managerId || null;
    }
    if (changed('status')) params.p_status = f.status;
    if (numberChanged('baseSalary')) params.p_base_salary = Number(f.baseSalary) || 0;
    if (changed('baseCurrency')) params.p_base_currency = f.baseCurrency;
    if (numberChanged('commissionPercent')) params.p_closer_percent = Number(f.commissionPercent) || 0;
    if (f.role === 'telesales' && numberChanged('leadPercent')) params.p_lead_percent = Number(f.leadPercent) || 0;
    if (['sales', 'telesales'].includes(f.role) && numberChanged('managerPercent')) params.p_manager_percent = Number(f.managerPercent) || 0;
    if (Object.keys(params).length === 1) {
      setEditUser(null);
      return;
    }
    setEditSaving(true);
    setEditError('');
    const { error } = await supabase.rpc('admin_update_user', params);
    setEditSaving(false);
    if (error) {
      setEditError(error.message);
      return;
    }
    setEditUser(null);
    await loadUsers();
  };

  const sendPasswordReset = async (u: User) => {
    if (!u.email) return;
    setResetMessage('');
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: window.location.origin,
    });
    setResetMessage(error ? error.message : t('A password reset link was sent to {email}.', { email: u.email }));
  };

  const toggleStatus = async (u: User) => {
    const newStatus = u.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.rpc('admin_update_user', { p_user_id: u.id, p_status: newStatus });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadUsers();
  };

  const saveCommission = async (u: User, value: string) => {
    const percent = Math.min(100, Math.max(0, Number(value) || 0));
    // Through admin_update_user so user_commission_rates.closer_percent stays in sync.
    const { error } = await supabase.rpc('admin_update_user', { p_user_id: u.id, p_closer_percent: percent });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadUsers();
  };

  const toggleEmailConfirmed = async (u: User) => {
    const next = !emailConfirmed[u.id];
    setTogglingEmail(prev => ({ ...prev, [u.id]: true }));
    const { error } = await supabase.rpc('set_user_email_confirmed', { target_user_id: u.id, should_confirm: next });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setEmailConfirmed(prev => ({ ...prev, [u.id]: next }));
    }
    setTogglingEmail(prev => ({ ...prev, [u.id]: false }));
  };

  const deleteUser = async (u: User) => {
    if (!window.confirm(t('Delete {name}? This also removes their login account and cannot be undone.', { name: u.fullName }))) return;
    setErrorMsg('');
    const { error } = await supabase.rpc('delete_user_account', { target_user_id: u.id });
    if (error) {
      setErrorMsg(t('{msg}. Run supabase-setup.sql in Supabase SQL Editor, then refresh the page.', { msg: error.message }));
      return;
    }
    await loadUsers();
  };

  const roleLabel: Record<Role, string> = { admin: 'Admin', manager: 'Manager', telesales: 'Telesales', sales: 'Sales' };
  const roleColor: Record<Role, string> = {
    admin: 'bg-purple-500/10 text-purple-300',
    manager: 'bg-orange-500/10 text-orange-300',
    telesales: 'bg-[#dfff03]/10 text-[#dfff03]',
    sales: 'bg-blue-500/10 text-blue-300',
  };

  if (loading) {
    return <div className="p-6 text-[#a0a0a0] text-sm"><TableSkeleton /></div>;
  }

  return (
    <div className="p-6 space-y-4">
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3 anim-banner">
          {t(errorMsg)}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">{t('Users')}</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{t('{a} active · {b} total', { a: users.filter(u => u.status === 'active').length, b: users.length })}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>{t('+ Add User')}</Button>
      </div>

      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {[
          { key: 'users', label: 'User Data' },
          { key: 'clients', label: 'Distributed Clients' },
        ].map(view => (
          <button key={view.key} onClick={() => setPageView(view.key as 'users' | 'clients')} className={`px-4 py-1.5 text-sm rounded-md transition-all ${pageView === view.key ? 'bg-[#dfff03] text-black font-medium' : 'text-[#6b6b6b] hover:text-white'}`}>
            {t(view.label)}
          </button>
        ))}
      </div>

      {pageView === 'users' && <>
      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {(['all', 'manager', 'telesales', 'sales'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-1.5 text-sm rounded-md transition-all capitalize ${tab === tabKey ? 'bg-[#dfff03] text-black font-medium' : 'text-[#6b6b6b] hover:text-white'}`}
          >
            {tabKey === 'all' ? t('All Users') : tabKey === 'manager' ? t('Managers') : t(roleLabel[tabKey])}
          </button>
        ))}
      </div>

      <Card>
        <Table headers={['User', 'Username', 'Role', 'Password', 'Commission %', 'Team / Manager', 'Status', 'Email Confirmed', 'Last Login', 'Actions']}>
          {filtered.map(u => (
            <Tr key={u.id} onClick={() => setDetailUser(u)}>
              <Td>
                <div className="flex items-center gap-3">
                  <Avatar name={u.fullName} />
                  <div>
                    <div className="text-white font-medium text-sm">{u.fullName}</div>
                    <div className="text-[#6b6b6b] text-xs">{u.email}</div>
                  </div>
                </div>
              </Td>
              <Td><span className="font-mono text-xs text-[#a0a0a0]">{u.username}</span></Td>
              <Td>
                <Badge className={roleColor[u.role]}>{t(roleLabel[u.role])}</Badge>
              </Td>
              <Td>
                <span className="text-[#6b6b6b] text-xs">{t('Hidden for security')}</span>
              </Td>
              <Td>
                <div onClick={event => event.stopPropagation()}>
                  <input
                    key={`${u.id}-${u.commissionPercent ?? 0}`}
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    defaultValue={u.commissionPercent ?? 0}
                    onBlur={event => {
                      const value = event.target.value;
                      if (Number(value) !== (u.commissionPercent ?? 0)) saveCommission(u, value);
                    }}
                    className="w-16 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#dfff03]/60"
                  />
                  <span className="text-[#6b6b6b] text-xs ms-1">%</span>
                </div>
              </Td>
              <Td>
                {u.role === 'manager' ? (
                  <span className="text-[#6b6b6b] text-xs">{t('{n} team members', { n: users.filter(x => x.managerId === u.id).length })}</span>
                ) : u.managerId ? (
                  <span className="text-[#a0a0a0] text-xs">{users.find(x => x.id === u.managerId)?.fullName || '—'}</span>
                ) : (
                  <span className="text-[#4a4a4a] text-xs italic">{t('Unassigned')}</span>
                )}
              </Td>
              <Td><StatusBadge status={u.status} /></Td>
              <Td onClick={event => event.stopPropagation()}>
                <Toggle checked={!!emailConfirmed[u.id]} onChange={() => toggleEmailConfirmed(u)} disabled={!!togglingEmail[u.id]} />
              </Td>
              <Td><span className="font-mono text-xs text-[#6b6b6b]">{u.lastLogin ? u.lastLogin.slice(0, 10) : t('Never')}</span></Td>
              <Td>
                <div className="flex gap-2 flex-wrap" onClick={event => event.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => toggleStatus(u)}>
                    {u.status === 'active' ? t('Deactivate') : t('Activate')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>{t('Edit')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => sendPasswordReset(u)}>{t('Change Password')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteUser(u)}>{t('Delete')}</Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
      </>}

      {pageView === 'clients' && <>
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={selectedUserId} onChange={setSelectedUserId} options={users.map(user => ({ value: user.id, label: `${user.fullName} · ${t(roleLabel[user.role])}` }))} className="w-64" />
          <SearchInput value={clientSearch} onChange={setClientSearch} placeholder="Search assigned clients..." />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 anim-stagger">
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Selected User')}</div><div className="text-white text-sm font-medium mt-1">{selectedUser?.fullName || '—'}</div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Assigned Clients')}</div><div className="text-[#dfff03] text-2xl font-bold mt-1"><AnimatedNumber value={clientCounts.total} /></div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Active')}</div><div className="text-white text-2xl font-bold mt-1"><AnimatedNumber value={clientCounts.active} /></div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Converted')}</div><div className="text-white text-2xl font-bold mt-1"><AnimatedNumber value={clientCounts.converted} /></div></Card>
        </div>
        <Card>
          <Table headers={['No.', 'Code', 'Client', 'Phone', 'Company', 'Quantity', 'Status', 'Last Updated']}>
            {assignedLeads.map(lead => (
              <Tr key={lead.id}>
                <Td><span className="font-mono text-xs text-[#a0a0a0]">{lead.customerNumber ?? '—'}</span></Td>
                <Td><span className="font-mono text-xs text-[#dfff03]">{lead.clientCode}</span></Td>
                <Td><span className="text-white font-medium">{lead.name}</span></Td>
                <Td><EditablePhoneCell phone={lead.phone} onSave={value => saveAssignedLeadPhone(lead, value)} /></Td>
                <Td><span className="text-[#a0a0a0] text-xs">{lead.company || '—'}</span></Td>
                <Td><span className="font-mono text-xs text-[#a0a0a0]">{lead.quantity}</span></Td>
                <Td><StatusBadge status={lead.status} /></Td>
                <Td><span className="font-mono text-xs text-[#6b6b6b]">{lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString(dateLocale(lang)) : '—'}</span></Td>
              </Tr>
            ))}
          </Table>
          {!clientsLoading && assignedLeads.length === 0 && <div className="p-8 text-center text-[#4a4a4a] text-sm">{t('No clients are assigned to this user.')}</div>}
          {clientsLoading && <div className="p-4 text-center text-[#6b6b6b] text-xs"><TableSkeleton /></div>}
          <Pagination page={clientPage} pageSize={CLIENT_PAGE_SIZE} total={clientCounts.matching} onChange={next => loadClients(next)} />
        </Card>
      </>}

      {/* Permissions note */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-[#dfff03]/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-[#dfff03]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <div className="text-white text-sm font-medium mb-1">{t('Role-Based Access Control')}</div>
            <div className="text-[#6b6b6b] text-xs leading-relaxed">
              {t("Telesales users see only their assigned leads. Sales users see only their meetings. Managers see their own team's data. Admins have full access to all data, users, imports, and reports.")}
            </div>
            <div className="text-[#6b6b6b] text-xs leading-relaxed mt-2">
              {t('Passwords cannot be read from Supabase. Use Change Password to send a secure reset link, or copy the temporary password shown once after creating a user.')}
            </div>
          </div>
        </div>
      </Card>

      {/* Add User Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Register a Team Member">
        <div className="space-y-3">
          <div className="bg-[#1a1a1a] rounded p-3 text-xs text-[#a0a0a0] leading-relaxed">
            {t('Set the password for this account. Use at least 8 characters and share it with the employee through a secure channel.')}
          </div>
          {[
            { label: 'Full Name *', key: 'fullName', placeholder: 'Diana Reeves' },
            { label: 'Email', key: 'email', placeholder: 'diana@company.com' },
            { label: 'Password * (min. 8 characters)', key: 'password', placeholder: 'Create a password', type: 'password' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-[#a0a0a0] mb-1">{t(f.label)}</label>
              <input
                value={(newUser as any)[f.key]}
                onChange={e => setNewUser(prev => ({ ...prev, [f.key]: e.target.value }))}
                type={f.type || 'text'}
                placeholder={t(f.placeholder)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">{t('Role *')}</label>
            <select
              value={newUser.role}
              onChange={e => setNewUser(prev => ({ ...prev, role: e.target.value as Role }))}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              <option value="manager">{t('Manager')}</option>
              <option value="telesales">{t('Telesales')}</option>
              <option value="sales">{t('Sales')}</option>
            </select>
          </div>
          {['sales', 'telesales'].includes(newUser.role) && (
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">{t('Assign to Manager')}</label>
              <select
                value={newUser.managerId}
                onChange={e => setNewUser(prev => ({ ...prev, managerId: e.target.value }))}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
              >
                <option value="">{t('— No manager —')}</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </div>
          )}
          <PayFields role={newUser.role} value={newUser} onChange={patch => setNewUser(prev => ({ ...prev, ...patch }))} />
          <div className="flex gap-2 pt-2">
            <Button variant="primary" disabled={creatingUser || !newUser.email || !newUser.fullName || newUser.password.length < 8} onClick={handleAdd}>{creatingUser ? t('Creating…') : t('Register User')}</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>{t('Cancel')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!createdCredentials} onClose={() => setCreatedCredentials(null)} title="User Created Successfully">
        {createdCredentials && (
          <div className="space-y-4">
            <div className="bg-[#dfff03]/10 border border-[#dfff03]/30 rounded-lg p-3 text-[#dfff03] text-sm">
              {t('Save or send these credentials now. The temporary password will not be shown again.')}
            </div>
            <div className="space-y-3">
              {[
                ['Username', createdCredentials.username],
                ['Email', createdCredentials.email],
                ['Temporary Password', createdCredentials.password],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{t(label)}</div>
                  <div className="text-white font-mono text-sm break-all select-all" dir="ltr">{value}</div>
                </div>
              ))}
            </div>
            <Button variant="primary" onClick={() => setCreatedCredentials(null)}>{t('Done')}</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Edit User">
        {editUser && (
          <div className="space-y-3">
            <div className="text-[#6b6b6b] text-xs">{editUser.email}</div>
            {editError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded p-2 break-words anim-shake">{t(editError)}</div>}
            {editLoading ? (
              <div className="text-[#6b6b6b] text-xs py-4"><TableSkeleton /></div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-[#a0a0a0] mb-1">{t('Full Name *')}</label>
                  <input value={editForm.fullName} onChange={e => setEditForm(prev => ({ ...prev, fullName: e.target.value }))} className={INPUT_CLASS} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-[#a0a0a0] mb-1">{t('Role *')}</label>
                    <select
                      value={editForm.role}
                      disabled={editInitial.role === 'admin' || editUser.id === myId}
                      onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value as Role }))}
                      className={`${INPUT_CLASS} disabled:opacity-50`}
                    >
                      {editInitial.role === 'admin' && <option value="admin">{t('Admin')}</option>}
                      <option value="manager">{t('Manager')}</option>
                      <option value="telesales">{t('Telesales')}</option>
                      <option value="sales">{t('Sales')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#a0a0a0] mb-1">{t('Status')}</label>
                    <select value={editForm.status} onChange={e => setEditForm(prev => ({ ...prev, status: e.target.value as EditForm['status'] }))} className={INPUT_CLASS}>
                      <option value="active">{t('Active')}</option>
                      <option value="inactive">{t('Inactive')}</option>
                    </select>
                  </div>
                </div>
                {['sales', 'telesales'].includes(editForm.role) && (
                  <div>
                    <label className="block text-xs text-[#a0a0a0] mb-1">{t('Assign to Manager')}</label>
                    <select value={editForm.managerId} onChange={e => setEditForm(prev => ({ ...prev, managerId: e.target.value }))} className={INPUT_CLASS}>
                      <option value="">{t('— No manager —')}</option>
                      {managers.filter(m => m.id !== editUser.id).map(m => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                    </select>
                  </div>
                )}
                {editInitial.role === 'manager' && (
                  <div className="bg-[#1a1a1a] rounded p-2 text-xs text-[#a0a0a0]">{t('{n} team members', { n: editTeamMembers })}</div>
                )}
                <PayFields role={editForm.role} value={editForm} onChange={patch => setEditForm(prev => ({ ...prev, ...patch }))} managerCommission />
                <p className="text-[#6b6b6b] text-[11px] leading-relaxed">{t('Changing the role or rates only affects new deals; approved deals keep the rates they were approved with.')}</p>
              </>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="primary" disabled={editLoading || editSaving || !editForm.fullName.trim()} onClick={saveEdit}>{editSaving ? t('Saving…') : t('Save')}</Button>
              <Button variant="ghost" onClick={() => setEditUser(null)}>{t('Cancel')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!detailUser} onClose={() => setDetailUser(null)} title="User Login Details">
        {detailUser && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">{t('Username')}</div>
                <div className="text-white font-mono text-sm select-all">{detailUser.username}</div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">{t('Email')}</div>
                <div className="text-white text-sm break-all select-all">{detailUser.email}</div>
              </div>
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">{t('Password')}</div>
              <div className="text-[#6b6b6b] text-sm">{t('Not readable or stored in plain text')}</div>
            </div>
            <p className="text-[#a0a0a0] text-xs leading-relaxed">
              {t('To give this user access, send a password reset link or use the temporary password shown immediately after creating a new account.')}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => sendPasswordReset(detailUser)}>{t('Send Password Reset')}</Button>
              <Button variant="ghost" onClick={() => setDetailUser(null)}>{t('Close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {resetMessage && (
        <div className="fixed bottom-5 end-5 z-50 max-w-sm bg-[#161616] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-[#dfff03] shadow-xl">
          {resetMessage}
        </div>
      )}
    </div>
  );
}

interface PayForm {
  baseSalary: string;
  baseCurrency: 'EGP' | 'SAR';
  commissionPercent: string;
  leadPercent: string;
  managerPercent: string;
}

const EMPTY_PAY: PayForm = { baseSalary: '', baseCurrency: 'EGP', commissionPercent: '', leadPercent: '', managerPercent: '' };
interface EditForm extends PayForm {
  fullName: string;
  role: Role;
  managerId: string;
  status: 'active' | 'inactive';
}

const EMPTY_EDIT: EditForm = { fullName: '', role: 'telesales', managerId: '', status: 'active', ...EMPTY_PAY };
const INPUT_CLASS = 'w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60';
const EMPTY_NEW_USER = { fullName: '', email: '', password: '', role: 'telesales' as Role, managerId: '', ...EMPTY_PAY };

/**
 * Salary + percentages for one employee (stored in user_commission_rates).
 * manager → salary only (+ commission % when managerCommission) · sales → + commission, manager % · telesales → + lead %.
 */
function PayFields({ role, value, onChange, managerCommission = false }: { role: Role; value: PayForm; onChange: (patch: Partial<PayForm>) => void; managerCommission?: boolean }) {
  const { t } = useI18n();
  const inputClass = INPUT_CLASS;
  const percent = (key: 'commissionPercent' | 'leadPercent' | 'managerPercent', label: string, hint: string) => (
    <div key={key}>
      <label className="block text-xs text-[#a0a0a0] mb-1">{t(label)}</label>
      <input type="number" min={0} max={100} step="0.1" value={value[key]} placeholder="0"
        onChange={e => onChange({ [key]: e.target.value })} className={inputClass} />
      <p className="text-[#6b6b6b] text-[11px] mt-1">{t(hint)}</p>
    </div>
  );
  return (
    <div className="space-y-3 border-t border-[#2a2a2a] pt-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="block text-xs text-[#a0a0a0] mb-1">{t('Base salary')}</label>
          <input type="number" min={0} step="1" value={value.baseSalary} placeholder="0"
            onChange={e => onChange({ baseSalary: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-[#a0a0a0] mb-1">{t('Currency')}</label>
          <select value={value.baseCurrency} onChange={e => onChange({ baseCurrency: e.target.value as PayForm['baseCurrency'] })} className={inputClass}>
            <option value="EGP">{t('EGP')}</option>
            <option value="SAR">{t('SAR')}</option>
          </select>
        </div>
      </div>
      {(role === 'sales' || role === 'telesales' || (managerCommission && role === 'manager')) && percent('commissionPercent', 'Commission %', 'Of each deal this employee closes')}
      {role === 'telesales' && percent('leadPercent', 'Lead %', 'When a sales rep closes a deal on this employee’s lead')}
      {role !== 'manager' && role !== 'admin' && percent('managerPercent', 'Manager %', 'What this employee’s manager earns from each of their deals')}
    </div>
  );
}

const CLIENT_PAGE_SIZE = 50;
const CLOSED_STATUSES = ['Converted', 'Subscribed', 'Did Not Subscribe'];
const CONVERTED_STATUSES = ['Converted', 'Subscribed'];

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // fall through to the generic message
    }
  }
  return error instanceof Error ? error.message : fallback;
}

interface AssignedLead {
  id: string;
  customerNumber?: number;
  clientCode: string;
  name: string;
  phone: string;
  company?: string;
  quantity: number;
  status: string;
  assignedTo?: string;
  updatedAt: string;
}

function mapAssignedLead(row: any): AssignedLead {
  return {
    id: row.id,
    customerNumber: row.customer_number ?? undefined,
    clientCode: row.client_code,
    name: row.name,
    phone: row.phone ?? '',
    company: row.company ?? undefined,
    quantity: row.quantity ?? 0,
    status: row.status,
    assignedTo: row.assigned_to ?? undefined,
    updatedAt: row.updated_at,
  };
}
