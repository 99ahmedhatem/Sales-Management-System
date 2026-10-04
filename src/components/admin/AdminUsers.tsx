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
  const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '', role: 'telesales' as Role, managerId: '', commissionPercent: '' });

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
    const [usersRes, emailRes] = await Promise.all([
      supabase.from('users').select('*').neq('role', 'admin').order('full_name'),
      supabase.rpc('list_email_confirmations'),
    ]);
    if (usersRes.error) setErrorMsg(usersRes.error.message);
    else {
      const loadedUsers = (usersRes.data ?? []).map(mapUser);
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
        commission_percent: Number(newUser.commissionPercent) || 0,
      },
    });
    setCreatingUser(false);
    if (error || !data?.username) {
      setErrorMsg(await functionErrorMessage(error, t('Could not create the user.')));
      return;
    }
    await loadUsers();
    setCreatedCredentials({ username: data.username, email: data.email ?? newUser.email.trim(), password: newUser.password });
    setNewUser({ fullName: '', email: '', password: '', role: 'telesales', managerId: '', commissionPercent: '' });
    setAddModal(false);
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
    const { error } = await supabase.from('users').update({ status: newStatus }).eq('id', u.id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadUsers();
  };

  const saveCommission = async (u: User, value: string) => {
    const percent = Math.min(100, Math.max(0, Number(value) || 0));
    const { error } = await supabase.from('users').update({ commission_percent: percent }).eq('id', u.id);
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
    return <div className="p-6 text-[#a0a0a0] text-sm">{t('Loading users…')}</div>;
  }

  return (
    <div className="p-6 space-y-4">
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">
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
                <div className="flex gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => toggleStatus(u)}>
                    {u.status === 'active' ? t('Deactivate') : t('Activate')}
                  </Button>
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Selected User')}</div><div className="text-white text-sm font-medium mt-1">{selectedUser?.fullName || '—'}</div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Assigned Clients')}</div><div className="text-[#dfff03] text-2xl font-bold mt-1">{clientCounts.total.toLocaleString('en-US')}</div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Active')}</div><div className="text-white text-2xl font-bold mt-1">{clientCounts.active.toLocaleString('en-US')}</div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Converted')}</div><div className="text-white text-2xl font-bold mt-1">{clientCounts.converted.toLocaleString('en-US')}</div></Card>
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
          {clientsLoading && <div className="p-4 text-center text-[#6b6b6b] text-xs">{t('Loading clients…')}</div>}
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
            { label: 'Commission % (of each deal price)', key: 'commissionPercent', placeholder: '10' },
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