import { useState } from 'react';
import { USERS, User, Role } from '../../data/mockData';
import { Avatar, Badge, Button, Card, Modal, StatusBadge, Table, Td, Tr } from '../ui';

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>(USERS.filter(u => u.role !== 'admin'));
  const [addModal, setAddModal] = useState(false);
  const [tab, setTab] = useState<'all' | 'manager' | 'telesales' | 'sales'>('all');
  const [newUser, setNewUser] = useState({ fullName: '', username: '', email: '', role: 'telesales' as Role, password: '', managerId: '' });

  const managers = users.filter(u => u.role === 'manager');
  const filtered = users.filter(u => tab === 'all' || u.role === tab);

  const handleAdd = () => {
    if (!newUser.fullName || !newUser.username) return;
    const u: User = {
      id: `u${Date.now()}`,
      ...newUser,
      status: 'active',
      lastLogin: 'Never',
    };
    setUsers(prev => [...prev, u]);
    setNewUser({ fullName: '', username: '', email: '', role: 'telesales', password: '', managerId: '' });
    setAddModal(false);
  };

  const toggleStatus = (id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: u.status === 'active' ? 'inactive' : 'active' } : u));
  };

  const roleLabel: Record<Role, string> = { admin: 'Admin', manager: 'Manager', telesales: 'Telesales', sales: 'Sales' };
  const roleColor: Record<Role, string> = {
    admin: 'bg-purple-500/10 text-purple-300',
    manager: 'bg-orange-500/10 text-orange-300',
    telesales: 'bg-[#dfff03]/10 text-[#dfff03]',
    sales: 'bg-blue-500/10 text-blue-300',
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Users</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{users.filter(u => u.status === 'active').length} active · {users.length} total</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>+ Add User</Button>
      </div>

      {/* Tab Filter */}
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
        <Table headers={['User', 'Username', 'Role', 'Team / Manager', 'Status', 'Last Login', 'Actions']}>
          {filtered.map(u => (
            <Tr key={u.id}>
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
                {u.role === 'manager' ? (
                  <span className="text-[#6b6b6b] text-xs">{users.filter(x => x.managerId === u.id).length} team members</span>
                ) : u.managerId ? (
                  <span className="text-[#a0a0a0] text-xs">{users.find(x => x.id === u.managerId)?.fullName || '—'}</span>
                ) : (
                  <span className="text-[#4a4a4a] text-xs italic">Unassigned</span>
                )}
              </Td>
              <Td><StatusBadge status={u.status} /></Td>
              <Td><span className="font-mono text-xs text-[#6b6b6b]">{u.lastLogin}</span></Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleStatus(u.id)}>
                    {u.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button variant="ghost" size="sm">Reset PW</Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

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
              Telesales users see only their assigned leads. Sales users see only their meetings. Admins have full access to all data, users, imports, and reports.
            </div>
          </div>
        </div>
      </Card>

      {/* Add User Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Create New User">
        <div className="space-y-3">
          {[
            { label: 'Full Name *', key: 'fullName', placeholder: 'Diana Reeves' },
            { label: 'Username *', key: 'username', placeholder: 'diana.sales' },
            { label: 'Email', key: 'email', placeholder: 'diana@company.com' },
            { label: 'Initial Password *', key: 'password', placeholder: 'Min. 8 characters', type: 'password' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-[#a0a0a0] mb-1">{f.label}</label>
              <input
                type={f.type || 'text'}
                value={(newUser as any)[f.key]}
                onChange={e => setNewUser(prev => ({ ...prev, [f.key]: e.target.value }))}
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
          <div className="bg-[#1a1a1a] rounded p-3 text-xs text-[#6b6b6b]">
            Share credentials with the user out-of-band (verbally or via secure message).
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="primary" disabled={!newUser.fullName || !newUser.username} onClick={handleAdd}>Create User</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
