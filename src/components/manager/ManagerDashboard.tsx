import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { MEETINGS, Lead, LeadStatus, User } from '../../data/mockData';
import { Avatar, Button, Card, KpiCard, Modal, Pagination, SearchInput, Select, StatusBadge, Table, Td, Tr } from '../ui';
import { WebsiteLink } from '../ui';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { recordActivity } from '../../data/activityLog';
import { createNotification } from '../../data/notifications';

const ROLE_REGION_OPTIONS = [
  { value: '', label: 'All Countries' },
  { value: 'Saudi Arabia', label: 'Saudi Arabia' }, { value: 'Oman', label: 'Oman' },
  { value: 'Iraq', label: 'Iraq' }, { value: 'UAE', label: 'UAE' }, { value: 'Egypt', label: 'Egypt' },
];
const ROLE_TYPE_OPTIONS = [{ value: '', label: 'All Types' }, { value: 'software', label: 'Software' }, { value: 'salla', label: 'Salla Store' }];
const ROLE_QUALITY_OPTIONS = [{ value: '', label: 'All Quality' }, { value: 'normal', label: 'Normal' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'Strong' }];
const ROLE_PHONE_OPTIONS = [{ value: '', label: 'All Phones' }, { value: 'has', label: 'Has phone' }, { value: 'missing', label: 'No phone' }];

interface Props {
  userId: string;
}

export default function ManagerDashboard({ userId }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const me = users.find(u => u.id === userId);

  // My team: all Sales/Telesales who have managerId = me
  const myTeam = users.filter(u => u.managerId === userId);
  const myTeamIds = myTeam.map(u => u.id);

  // My leads: leads assigned to any of my team members OR directly to me
  const myLeads = allLeads.filter(l => l.assignedTo && (myTeamIds.includes(l.assignedTo) || l.assignedTo === userId));

  // Meetings for my team
  const myMeetings = MEETINGS.filter(m => myTeamIds.includes(m.assignedSalesId) || myTeamIds.includes(m.bookedById));

  const converted = myLeads.filter(l => ['Subscribed', 'Converted'].includes(l.status)).length;
  const won = myMeetings.filter(m => m.outcome === 'Deal Closed – Won').length;

  const telesalesTeam = myTeam.filter(u => u.role === 'telesales');
  const salesTeam = myTeam.filter(u => u.role === 'sales');

  // Assignment
  const [assignModal, setAssignModal] = useState(false);
  const [assignLeads, setAssignLeads] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState('');
  const [selectedPoolLeads, setSelectedPoolLeads] = useState<string[]>([]);
  const [editingCustomerNumberId, setEditingCustomerNumberId] = useState<string | null>(null);
  const [editingCustomerNumber, setEditingCustomerNumber] = useState('');
  const [editingPhone, setEditingPhone] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [leadCountry, setLeadCountry] = useState('');
  const [leadType, setLeadType] = useState('');
  const [leadQuality, setLeadQuality] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [leadPage, setLeadPage] = useState(0);
  const [totalTeamLeads, setTotalTeamLeads] = useState(0);
  const [receivedCount, setReceivedCount] = useState(0);
  const [distributedCount, setDistributedCount] = useState(0);
    const [workedClientCount, setWorkedClientCount] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const pageSize = 100;
  useEffect(() => {
    async function loadManagerData() {
      setLoading(true);
      setErrorMsg('');
      const [usersRes, leadsRes] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('leads').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(leadPage * pageSize, (leadPage + 1) * pageSize - 1),
      ]);
      if (usersRes.error || leadsRes.error) {
        setErrorMsg(usersRes.error?.message || leadsRes.error?.message || 'Could not load manager data.');
      } else {
        const mappedUsers = (usersRes.data ?? []).map(row => ({
          id: row.id,
          username: row.username,
          fullName: row.full_name,
          role: row.role,
          status: row.status,
          email: row.email,
          lastLogin: row.last_login,
          managerId: row.manager_id ?? undefined,
        }));
        setUsers(mappedUsers);
        setAllLeads((leadsRes.data ?? []).map(row => ({
          id: row.id,
          customerNumber: row.customer_number ?? undefined,
          website: row.website ?? undefined,
          quantity: row.quantity ?? 0,
          clientCode: row.client_code,
          name: row.name,
          phone: row.phone,
          company: row.company ?? undefined,
          region: row.region ?? undefined,
          source: row.source ?? undefined,
          isSallaStore: row.is_salla_store ?? false,
          dataQuality: row.data_quality ?? 'normal',
          status: row.status,
          assignedTo: row.assigned_to ?? undefined,
          notes: row.notes ?? undefined,
          callbackDate: row.callback_date ?? undefined,
          freeTrialEndDate: row.free_trial_end_date ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })));
        setTotalTeamLeads(leadsRes.count ?? 0);
        const teamIds = mappedUsers.filter(user => user.managerId === userId).map(user => user.id);
        const [receivedRes, distributedRes, activityRes] = await Promise.all([
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('assigned_to', userId),
          teamIds.length ? supabase.from('leads').select('id', { count: 'exact', head: true }).in('assigned_to', teamIds) : Promise.resolve({ count: 0, error: null }),
          teamIds.length ? supabase.from('activity_logs').select('lead_id').in('actor_id', teamIds).in('activity_type', ['call', 'forward']) : Promise.resolve({ data: [], error: null }),
        ]);
        setReceivedCount(receivedRes.count ?? 0);
        setDistributedCount(distributedRes.count ?? 0);
        const workedLeadIds = new Set((activityRes.data ?? []).map(row => row.lead_id));
        MEETINGS.filter(meeting => teamIds.includes(meeting.assignedSalesId) || teamIds.includes(meeting.bookedById)).forEach(meeting => workedLeadIds.add(meeting.leadId));
        setWorkedClientCount(workedLeadIds.size);
      }
      setLoading(false);
    }
    loadManagerData();
  }, [leadPage, refreshVersion]);

  useRealtimeRefresh(['leads', 'users'], () => setRefreshVersion(version => version + 1));

  const agentStats = telesalesTeam.map(agent => {
    const leads = myLeads.filter(l => l.assignedTo === agent.id);
    const conv = leads.filter(l => ['Subscribed', 'Converted'].includes(l.status)).length;
    return { agent, total: leads.length, contacted: leads.filter(l => !['New', 'Assigned'].includes(l.status)).length, converted: conv, rate: leads.length ? Math.round(conv / leads.length * 100) : 0 };
  });

  const salesStats = salesTeam.map(agent => {
    const meetings = myMeetings.filter(m => m.assignedSalesId === agent.id);
    const dealWon = meetings.filter(m => m.outcome === 'Deal Closed – Won').length;
    return { agent, total: meetings.length, won: dealWon, rate: meetings.length ? Math.round(dealWon / meetings.length * 100) : 0 };
  });

  const handleAssign = async () => {
    if (!assignTo || assignLeads.length === 0) return;
    const { error } = await supabase
      .from('leads')
      .update({ assigned_to: assignTo, status: 'Assigned' as LeadStatus, updated_at: new Date().toISOString() })
      .in('id', assignLeads);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await Promise.all(assignLeads.map(leadId => recordActivity({
      leadId,
      actorId: userId,
      actorName: me?.fullName || 'Manager',
      actorRole: 'manager',
      activityType: 'assignment',
      outcome: 'Assigned',
      notes: `Assigned to ${users.find(user => user.id === assignTo)?.fullName || 'team member'}`,
    })));
    await createNotification(assignTo, 'New leads assigned', `${assignLeads.length} client(s) were assigned to you by ${me?.fullName || 'your manager'}.`);
    setAllLeads(prev => prev.map(l => assignLeads.includes(l.id) ? { ...l, assignedTo: assignTo, status: 'Assigned' as LeadStatus } : l));
    setAssignModal(false);
    setAssignLeads([]);
    setAssignTo('');
    setSelectedPoolLeads([]);
  };

  const saveCustomerNumber = async (leadId: string) => {
    const value = editingCustomerNumber.trim();
    const number = value ? Number(value) : null;
    if (number !== null && (!Number.isSafeInteger(number) || number <= 0)) {
      setErrorMsg('Customer number must be a positive whole number.');
      setEditingCustomerNumberId(null);
      return;
    }
    const { error } = await supabase.rpc('set_lead_customer_number', { target_lead_id: leadId, new_customer_number: number });
    if (error) { setErrorMsg(error.message); return; }
    setAllLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, customerNumber: number ?? undefined } : lead));
    setEditingCustomerNumberId(null);
  };

  const savePhone = async (leadId: string) => {
    const phone = editingPhone.trim();
    const { error } = await supabase.from('leads').update({ phone: phone || null, phone_source: phone ? 'manual' : null, updated_at: new Date().toISOString() }).eq('id', leadId);
    if (error) { setErrorMsg(error.message); return; }
    setAllLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, phone } : lead));
  };

  const unassignedToMe = allLeads.filter(l => l.assignedTo === userId);
  const filteredPool = unassignedToMe.filter(lead => {
    const query = leadSearch.toLowerCase();
    return (!query || lead.name.toLowerCase().includes(query) || lead.phone.includes(query) || (lead.company || '').toLowerCase().includes(query))
      && (!leadStatus || lead.status === leadStatus)
      && (!leadCountry || lead.region === leadCountry)
      && (!leadType || (leadType === 'salla' ? lead.isSallaStore : !lead.isSallaStore))
      && (!leadQuality || lead.dataQuality === leadQuality)
      && (!leadPhone || (leadPhone === 'has' ? Boolean(lead.phone) : !lead.phone));
  });
  const togglePoolLead = (leadId: string) => {
    setSelectedPoolLeads(prev => prev.includes(leadId) ? prev.filter(id => id !== leadId) : [...prev, leadId]);
  };
  const toggleAllPoolLeads = () => {
    setSelectedPoolLeads(prev => prev.length === unassignedToMe.length ? [] : unassignedToMe.map(lead => lead.id));
  };

  if (loading) {
    return <div className="p-6 text-[#a0a0a0] text-sm">Loading team data…</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {errorMsg && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">{errorMsg}</div>}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Team Overview</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{me?.fullName || 'Manager'} — Manager</p>
        </div>
        {unassignedToMe.length > 0 && (
          <Button variant="primary" size="sm" disabled={!selectedPoolLeads.length} onClick={() => { setAssignLeads(selectedPoolLeads); setAssignTo(''); setAssignModal(true); }}>
            Distribute Selected ({selectedPoolLeads.length})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Clients Worked" value={workedClientCount} sub="Distinct team clients" />
        <KpiCard label="Team Members" value={myTeam.length} sub={`${telesalesTeam.length} telesales · ${salesTeam.length} sales`} />
        <KpiCard label="Received from Admin" value={receivedCount} sub="Waiting in your pool" />
        <KpiCard label="Distributed" value={distributedCount} sub="Assigned to your team" />
        <KpiCard label="Converted" value={converted} accent sub={`${myLeads.length > 0 ? Math.round(converted / myLeads.length * 100) : 0}% rate`} />
        <KpiCard label="Deals Won" value={won} sub={`${myMeetings.length} total meetings`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Telesales Performance */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Telesales Team</h3>
          </div>
          {telesalesTeam.length === 0 && <p className="text-[#4a4a4a] text-sm">No telesales agents assigned to your team.</p>}
          <div className="space-y-3">
            {agentStats.map(({ agent, total, contacted, converted, rate }) => (
              <div key={agent.id} className="p-3 bg-[#1a1a1a] rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <Avatar name={agent.fullName} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{agent.fullName}</div>
                    <div className="text-[#6b6b6b] text-xs">{total} leads · {contacted} contacted</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#dfff03] font-bold text-lg font-mono">{rate}%</div>
                    <div className="text-[#6b6b6b] text-xs">{converted} cvt</div>
                  </div>
                </div>
                <div className="h-1.5 bg-[#262626] rounded-full">
                  <div className="h-full bg-[#dfff03] rounded-full" style={{ width: `${rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Sales Performance */}
        <Card className="p-5">
          <h3 className="text-white font-semibold mb-4">Sales Team</h3>
          {salesTeam.length === 0 && <p className="text-[#4a4a4a] text-sm">No sales agents assigned to your team.</p>}
          <div className="space-y-3">
            {salesStats.map(({ agent, total, won, rate }) => (
              <div key={agent.id} className="p-3 bg-[#1a1a1a] rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <Avatar name={agent.fullName} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{agent.fullName}</div>
                    <div className="text-[#6b6b6b] text-xs">{total} meetings · {won} won</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#64dc78] font-bold text-lg font-mono">{rate}%</div>
                    <div className="text-[#6b6b6b] text-xs">win rate</div>
                  </div>
                </div>
                <div className="h-1.5 bg-[#262626] rounded-full">
                  <div className="h-full bg-[#64dc78] rounded-full" style={{ width: `${rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Team Leads Table */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">My Leads Pool ({unassignedToMe.length} unassigned to agents)</h3>
          {unassignedToMe.length > 0 && (
            <button onClick={toggleAllPoolLeads} className="text-[#dfff03] text-xs hover:underline">
              {selectedPoolLeads.length === unassignedToMe.length ? 'Clear selection' : 'Select all'}
            </button>
          )}
        </div>
        <div className="flex gap-3 mb-4">
          <SearchInput value={leadSearch} onChange={setLeadSearch} placeholder="Search name, phone, company..." />
          <Select value={leadStatus} onChange={setLeadStatus} options={[{ value: '', label: 'All Statuses' }, { value: 'New', label: 'New' }, { value: 'Assigned', label: 'Assigned' }, { value: 'Contacted', label: 'Contacted' }, { value: 'Interested', label: 'Interested' }]} className="w-40" />
          <Select value={leadCountry} onChange={setLeadCountry} options={ROLE_REGION_OPTIONS} className="w-40" />
          <Select value={leadType} onChange={setLeadType} options={ROLE_TYPE_OPTIONS} className="w-36" />
          <Select value={leadQuality} onChange={setLeadQuality} options={ROLE_QUALITY_OPTIONS} className="w-36" />
          <Select value={leadPhone} onChange={setLeadPhone} options={ROLE_PHONE_OPTIONS} className="w-36" />
        </div>
        {unassignedToMe.length === 0 ? (
          <p className="text-[#4a4a4a] text-sm py-4">All leads have been distributed to your team members.</p>
        ) : (
          <div>
            <Table headers={['', 'No.', 'Code', 'Name', 'Phone', 'Company', 'Website', 'Quantity', 'Status', '']}>
              {filteredPool.map(l => (
                <Tr key={l.id} onClick={() => setDetailLead(l)}>
                <Td>
                  <input type="checkbox" checked={selectedPoolLeads.includes(l.id)} onChange={() => togglePoolLead(l.id)} className="accent-[#dfff03]" />
                </Td>
                <Td>
                  <div onDoubleClick={e => { e.stopPropagation(); setEditingCustomerNumberId(l.id); setEditingCustomerNumber(String(l.customerNumber ?? '')); }}>
                    {editingCustomerNumberId === l.id ? (
                      <input autoFocus type="number" min="1" value={editingCustomerNumber} onChange={e => setEditingCustomerNumber(e.target.value)} onBlur={() => saveCustomerNumber(l.id)} onKeyDown={e => { if (e.key === 'Enter') saveCustomerNumber(l.id); if (e.key === 'Escape') setEditingCustomerNumberId(null); }} onClick={e => e.stopPropagation()} className="w-20 bg-[#1a1a1a] border border-[#dfff03] rounded px-2 py-1 text-xs text-white" />
                    ) : <span className="font-mono text-xs text-[#a0a0a0] cursor-text">{l.customerNumber ?? '—'}</span>}
                  </div>
                </Td>
                <Td><span className="font-mono text-xs text-[#dfff03]">{l.clientCode}</span></Td>
                <Td><span className="text-white font-medium">{l.name}</span></Td>
                <Td><span className="font-mono text-xs">{l.phone}</span></Td>
                <Td><span className="text-[#a0a0a0] text-xs">{l.company || '—'}</span></Td>
                <Td><WebsiteLink url={l.website} className="text-[#a0a0a0] text-xs truncate max-w-40 inline-block" /></Td>
                <Td><span className="font-mono text-xs text-[#a0a0a0]">{l.quantity ?? 0}</span></Td>
                <Td><StatusBadge status={l.status} /></Td>
                <Td>
                  <button
                    onClick={() => { setSelectedPoolLeads([l.id]); setAssignLeads([l.id]); setAssignTo(''); setAssignModal(true); }}
                    className="text-[#dfff03] text-xs hover:underline"
                  >
                    Assign
                  </button>
                </Td>
                </Tr>
              ))}
            </Table>
            <Pagination page={leadPage} pageSize={pageSize} total={totalTeamLeads} onChange={nextPage => { setSelectedPoolLeads([]); setLeadPage(nextPage); }} />
          </div>
        )}
      </Card>

      <Modal open={!!detailLead} onClose={() => setDetailLead(null)} title="Lead Details">
        {detailLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Name', detailLead.name], ['Website', detailLead.website || '—'],
                ['Quantity', detailLead.quantity ?? 0], ['Company', detailLead.company || '—'], ['Region', detailLead.region || '—'],
                ['Source', detailLead.source || '—'], ['Data Quality', detailLead.dataQuality || 'normal'],
              ].map(([label, value]) => <div key={label} className="bg-[#1a1a1a] rounded p-3"><div className="text-[#6b6b6b] text-xs mb-1">{label}</div><div className="text-white text-sm font-medium break-all">{label === 'Website' ? <WebsiteLink url={String(value)} /> : value}</div></div>)}
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">Phone Number</div>
              <div className="flex gap-2">
                <input value={editingPhone || detailLead.phone} onChange={e => setEditingPhone(e.target.value)} placeholder="Add phone number" className="flex-1 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white" />
                <Button variant="primary" size="sm" onClick={() => savePhone(detailLead.id)}>Save Phone</Button>
              </div>
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">Customer Number</div>
              <div className="flex gap-2">
                <input type="number" min="1" value={editingCustomerNumberId === detailLead.id ? editingCustomerNumber : String(detailLead.customerNumber ?? '')} onChange={e => { setEditingCustomerNumberId(detailLead.id); setEditingCustomerNumber(e.target.value); }} placeholder="Enter customer number" className="flex-1 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white" />
                <Button variant="primary" size="sm" onClick={() => saveCustomerNumber(detailLead.id)}>Save Number</Button>
              </div>
            </div>
            <Button variant="ghost" onClick={() => setDetailLead(null)}>Close</Button>
          </div>
        )}
      </Modal>

      {/* Upcoming meetings */}
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-4">Team Upcoming Meetings</h3>
        <div className="space-y-2">
          {myMeetings.filter(m => m.outcome === 'Scheduled').map(m => {
            const salesUser = users.find(u => u.id === m.assignedSalesId);
            return (
              <div key={m.id} className="flex items-center gap-4 p-3 bg-[#1a1a1a] rounded-lg">
                <div className="flex-1">
                  <div className="text-white text-sm font-medium">{m.leadName}</div>
                  <div className="text-[#6b6b6b] text-xs">{m.leadPhone}</div>
                </div>
                <div className="text-right">
                  <div className="text-[#dfff03] text-xs font-mono">{m.proposedDate}</div>
                  <div className="text-[#6b6b6b] text-xs">{salesUser?.fullName}</div>
                </div>
                <StatusBadge status={m.outcome} />
              </div>
            );
          })}
          {myMeetings.filter(m => m.outcome === 'Scheduled').length === 0 && (
            <p className="text-[#4a4a4a] text-sm py-4">No upcoming meetings.</p>
          )}
        </div>
      </Card>

      {/* Assign leads modal */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title="Distribute Leads to Team Member">
        <div className="space-y-4">
          <p className="text-[#a0a0a0] text-sm">Assign leads from your pool to a telesales agent on your team.</p>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-2">Assign to:</label>
            <div className="space-y-2">
              {telesalesTeam.map(u => {
                const count = myLeads.filter(l => l.assignedTo === u.id).length;
                return (
                  <button
                    key={u.id}
                    onClick={() => setAssignTo(u.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${assignTo === u.id ? 'border-[#dfff03] bg-[#dfff03]/5' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'}`}
                  >
                    <div className="text-white text-sm font-medium">{u.fullName}</div>
                    <div className="text-[#6b6b6b] text-xs">{count} leads currently assigned</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="bg-[#1a1a1a] rounded p-3 text-xs text-[#6b6b6b]">
            {assignLeads.length > 0 ? `${assignLeads.length} lead(s) selected` : 'Select leads from your pool first'}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!assignTo} onClick={handleAssign}>Assign Leads</Button>
            <Button variant="ghost" onClick={() => setAssignModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
