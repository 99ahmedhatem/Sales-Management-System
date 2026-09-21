import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { generateCode, User, Role } from '../../data/mockData';
import { Avatar, Badge, Button, Card, Modal, SearchInput, Select, StatusBadge, Table, Td, Tr } from '../ui';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

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
  };
}

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; email: string; password: string } | null>(null);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [resetMessage, setResetMessage] = useState('');
  const [tab, setTab] = useState<'all' | 'manager' | 'telesales' | 'sales'>('all');
  const [pageView, setPageView] = useState<'users' | 'clients'>('users');
  const [assignedLeads, setAssignedLeads] = useState<AssignedLead[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '', role: 'telesales' as Role, managerId: '' });

  async function loadUsers() {
    setLoading(true);
    setErrorMsg('');
    const [usersRes, leadsRes] = await Promise.all([
      supabase.from('users').select('*').neq('role', 'admin').order('full_name'),
      supabase.from('leads').select('id, customer_number, client_code, name, phone, company, quantity, status, assigned_to, updated_at').not('assigned_to', 'is', null).order('updated_at', { ascending: false }),
    ]);
    if (usersRes.error) setErrorMsg(usersRes.error.message);
    else {
      const loadedUsers = (usersRes.data ?? []).map(mapUser);
      setUsers(loadedUsers);
      setSelectedUserId(current => current || loadedUsers[0]?.id || '');
    }
    if (leadsRes.error) setErrorMsg(leadsRes.error.message);
    else setAssignedLeads((leadsRes.data ?? []).map(mapAssignedLead));
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useRealtimeRefresh(['users', 'leads'], loadUsers);

  const managers = users.filter(u => u.role === 'manager');
  const filtered = users.filter(u => tab === 'all' || u.role === tab);
  const selectedUser = users.find(user => user.id === selectedUserId);
  const visibleAssignedLeads = assignedLeads.filter(lead => {
    const query = clientSearch.toLowerCase();
    return lead.assignedTo === selectedUserId
      && (!query || lead.name.toLowerCase().includes(query) || lead.phone.includes(query) || lead.clientCode.toLowerCase().includes(query) || (lead.company || '').toLowerCase().includes(query));
  });

  const handleAdd = async () => {
    if (!newUser.fullName || !newUser.email || newUser.password.length < 8) return;
    setErrorMsg('');
    const employeeCode = generateCode('EMP');
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: newUser.email.trim(),
      password: newUser.password,
      options: {
        data: {
          employee_code: employeeCode,
          full_name: newUser.fullName,
        },
      },
    });
    if (authError || !authData.user) {
      setErrorMsg(authError?.message || 'Could not create the login account.');
      return;
    }

    const { error } = await supabase.from('users').insert({
      id: authData.user.id,
      full_name: newUser.fullName,
      username: employeeCode,
      email: newUser.email || null,
      role: newUser.role,
      status: 'active',
      manager_id: ['sales', 'telesales'].includes(newUser.role) && newUser.managerId ? newUser.managerId : null,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadUsers();
    setCreatedCredentials({ username: employeeCode, email: newUser.email.trim(), password: newUser.password });
    setNewUser({ fullName: '', email: '', password: '', role: 'telesales', managerId: '' });
    setAddModal(false);
  };

  const sendPasswordReset = async (u: User) => {
    if (!u.email) return;
    setResetMessage('');
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: window.location.origin,
    });
    setResetMessage(error ? error.message : `A password reset link was sent to ${u.email}.`);
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

  const deleteUser = async (u: User) => {
    if (!window.confirm(`Delete ${u.fullName}? This also removes their login account and cannot be undone.`)) return;
    setErrorMsg('');
    const { error } = await supabase.rpc('delete_user_account', { target_user_id: u.id });
    if (error) {
      setErrorMsg(`${error.message}. Run supabase-setup.sql in Supabase SQL Editor, then refresh the page.`);
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
    return <div className="p-6 text-[#a0a0a0] text-sm">Loading users…</div>;
  }

  return (
    <div className="p-6 space-y-4">
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">
          {errorMsg}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Users</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{users.filter(u => u.status === 'active').length} active · {users.length} total</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>+ Add User</Button>
      </div>

      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {[
          { key: 'users', label: 'User Data' },
          { key: 'clients', label: 'Distributed Clients' },
        ].map(view => (
          <button key={view.key} onClick={() => setPageView(view.key as 'users' | 'clients')} className={`px-4 py-1.5 text-sm rounded-md transition-all ${pageView === view.key ? 'bg-[#dfff03] text-black font-medium' : 'text-[#6b6b6b] hover:text-white'}`}>
            {view.label}
          </button>
        ))}
      </div>

      {pageView === 'users' && <>
      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {(['all', 'manager', 'telesales', 'sales'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded-md transition-all capitalize ${tab === t ? 'bg-[#dfff03] text-black font-medium' : 'text-[#6b6b6b] hover:text-white'}`}
          >
            {t === 'all' ? 'All Users' : t === 'manager' ? 'Managers' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <Table headers={['User', 'Username', 'Role', 'Password', 'Team / Manager', 'Status', 'Last Login', 'Actions']}>
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
                <Badge className={roleColor[u.role]}>{roleLabel[u.role]}</Badge>
              </Td>
              <Td>
                <span className="text-[#6b6b6b] text-xs">Hidden for security</span>
              </Td>
              <Td>
                {u.role === 'manager' ? (
                  <span className="text-[#6b6b6b] text-xs">{users.filter(x => x.managerId === u.id).length} team members</span>
                ) : u.managerId ? (
                  <span className="text-[#a0a0a0] text-xs">{users.find(x => x.id === u.managerId)?.fullName || '—'}</span>
                ) : (
                  <span className="text-[#4a4a4a] text-xs italic">Unassigned</span>
                )}
              </Td>
              <Td><StatusBadge status={u.status} /></Td>
              <Td><span className="font-mono text-xs text-[#6b6b6b]">{u.lastLogin ? u.lastLogin.slice(0, 10) : 'Never'}</span></Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleStatus(u)}>
                    {u.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => sendPasswordReset(u)}>Change Password</Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteUser(u)}>Delete</Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
      </>}

      {pageView === 'clients' && <>
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={selectedUserId} onChange={setSelectedUserId} options={users.map(user => ({ value: user.id, label: `${user.fullName} · ${roleLabel[user.role]}` }))} className="w-64" />
          <SearchInput value={clientSearch} onChange={setClientSearch} placeholder="Search assigned clients..." />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Selected User</div><div className="text-white text-sm font-medium mt-1">{selectedUser?.fullName || '—'}</div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Assigned Clients</div><div className="text-[#dfff03] text-2xl font-bold mt-1">{visibleAssignedLeads.length}</div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Active</div><div className="text-white text-2xl font-bold mt-1">{visibleAssignedLeads.filter(lead => !['Converted', 'Subscribed', 'Did Not Subscribe'].includes(lead.status)).length}</div></Card>
          <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Converted</div><div className="text-white text-2xl font-bold mt-1">{visibleAssignedLeads.filter(lead => ['Converted', 'Subscribed'].includes(lead.status)).length}</div></Card>
        </div>
        <Card>
          <Table headers={['No.', 'Code', 'Client', 'Phone', 'Company', 'Quantity', 'Status', 'Last Updated']}>
            {visibleAssignedLeads.map(lead => (
              <Tr key={lead.id}>
                <Td><span className="font-mono text-xs text-[#a0a0a0]">{lead.customerNumber ?? '—'}</span></Td>
                <Td><span className="font-mono text-xs text-[#dfff03]">{lead.clientCode}</span></Td>
                <Td><span className="text-white font-medium">{lead.name}</span></Td>
                <Td><span className="font-mono text-xs">{lead.phone || '—'}</span></Td>
                <Td><span className="text-[#a0a0a0] text-xs">{lead.company || '—'}</span></Td>
                <Td><span className="font-mono text-xs text-[#a0a0a0]">{lead.quantity}</span></Td>
                <Td><StatusBadge status={lead.status} /></Td>
                <Td><span className="font-mono text-xs text-[#6b6b6b]">{lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString() : '—'}</span></Td>
              </Tr>
            ))}
          </Table>
          {visibleAssignedLeads.length === 0 && <div className="p-8 text-center text-[#4a4a4a] text-sm">No clients are assigned to this user.</div>}
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
            <div className="text-white text-sm font-medium mb-1">Role-Based Access Control</div>
            <div className="text-[#6b6b6b] text-xs leading-relaxed">
              Telesales users see only their assigned leads. Sales users see only their meetings. Managers see their own team's data. Admins have full access to all data, users, imports, and reports.
            </div>
            <div className="text-[#6b6b6b] text-xs leading-relaxed mt-2">
              Passwords cannot be read from Supabase. Use Change Password to send a secure reset link, or copy the temporary password shown once after creating a user.
            </div>
          </div>
        </div>
      </Card>

      {/* Add User Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Register a Team Member">
        <div className="space-y-3">
          <div className="bg-[#1a1a1a] rounded p-3 text-xs text-[#a0a0a0] leading-relaxed">
            Set the password for this account. Use at least 8 characters and share it with the employee through a secure channel.
          </div>
          {[
            { label: 'Full Name *', key: 'fullName', placeholder: 'Diana Reeves' },
            { label: 'Email', key: 'email', placeholder: 'diana@company.com' },
            { label: 'Password * (min. 8 characters)', key: 'password', placeholder: 'Create a password', type: 'password' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-[#a0a0a0] mb-1">{f.label}</label>
              <input
                value={(newUser as any)[f.key]}
                onChange={e => setNewUser(prev => ({ ...prev, [f.key]: e.target.value }))}
                type={f.type || 'text'}
                placeholder={f.placeholder}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Role *</label>
            <select
              value={newUser.role}
              onChange={e => setNewUser(prev => ({ ...prev, role: e.target.value as Role }))}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              <option value="manager">Manager</option>
              <option value="telesales">Telesales</option>
              <option value="sales">Sales</option>
            </select>
          </div>
          {['sales', 'telesales'].includes(newUser.role) && (
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Assign to Manager</label>
              <select
                value={newUser.managerId}
                onChange={e => setNewUser(prev => ({ ...prev, managerId: e.target.value }))}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
              >
                <option value="">— No manager —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="primary" disabled={!newUser.email || !newUser.fullName || newUser.password.length < 8} onClick={handleAdd}>Register User</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!createdCredentials} onClose={() => setCreatedCredentials(null)} title="User Created Successfully">
        {createdCredentials && (
          <div className="space-y-4">
            <div className="bg-[#dfff03]/10 border border-[#dfff03]/30 rounded-lg p-3 text-[#dfff03] text-sm">
              Save or send these credentials now. The temporary password will not be shown again.
            </div>
            <div className="space-y-3">
              {[
                ['Username', createdCredentials.username],
                ['Email', createdCredentials.email],
                ['Temporary Password', createdCredentials.password],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{label}</div>
                  <div className="text-white font-mono text-sm break-all select-all">{value}</div>
                </div>
              ))}
            </div>
            <Button variant="primary" onClick={() => setCreatedCredentials(null)}>Done</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!detailUser} onClose={() => setDetailUser(null)} title="User Login Details">
        {detailUser && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Username</div>
                <div className="text-white font-mono text-sm select-all">{detailUser.username}</div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Email</div>
                <div className="text-white text-sm break-all select-all">{detailUser.email}</div>
              </div>
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">Password</div>
              <div className="text-[#6b6b6b] text-sm">Not readable or stored in plain text</div>
            </div>
            <p className="text-[#a0a0a0] text-xs leading-relaxed">
              To give this user access, send a password reset link or use the temporary password shown immediately after creating a new account.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => sendPasswordReset(detailUser)}>Send Password Reset</Button>
              <Button variant="ghost" onClick={() => setDetailUser(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {resetMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-[#161616] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-[#dfff03] shadow-xl">
          {resetMessage}
        </div>
      )}
    </div>
  );
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