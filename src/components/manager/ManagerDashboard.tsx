import { useState } from 'react';
import { LEADS, MEETINGS, USERS, CONTRACTS, Lead, LeadStatus } from '../../data/mockData';
import { Avatar, Button, Card, KpiCard, Modal, Select, StatusBadge, Table, Td, Tr } from '../ui';

interface Props {
  userId: string;
}

export default function ManagerDashboard({ userId }: Props) {
  const me = USERS.find(u => u.id === userId)!;

  // My team: all Sales/Telesales who have managerId = me
  const myTeam = USERS.filter(u => u.managerId === userId);
  const myTeamIds = myTeam.map(u => u.id);

  // My leads: leads assigned to any of my team members OR directly to me
  const myLeads = LEADS.filter(l => l.assignedTo && (myTeamIds.includes(l.assignedTo) || l.assignedTo === userId));
  const unassignedPool = LEADS.filter(l => !l.assignedTo);

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
  const [allLeads, setAllLeads] = useState<Lead[]>(LEADS);

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

  const handleAssign = () => {
    if (!assignTo || assignLeads.length === 0) return;
    setAllLeads(prev => prev.map(l => assignLeads.includes(l.id) ? { ...l, assignedTo: assignTo, status: 'Assigned' as LeadStatus } : l));
    setAssignModal(false);
    setAssignLeads([]);
    setAssignTo('');
  };

  const unassignedToMe = allLeads.filter(l => l.assignedTo === userId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Team Overview</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{me.fullName} — Manager</p>
        </div>
        {unassignedToMe.length > 0 && (
          <Button variant="primary" size="sm" onClick={() => setAssignModal(true)}>
            Distribute Leads ({unassignedToMe.length})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Team Members" value={myTeam.length} sub={`${telesalesTeam.length} telesales · ${salesTeam.length} sales`} />
        <KpiCard label="Team Leads" value={myLeads.length} sub="Assigned to team" />
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
        <h3 className="text-white font-semibold mb-4">My Leads Pool ({unassignedToMe.length} unassigned to agents)</h3>
        {unassignedToMe.length === 0 ? (
          <p className="text-[#4a4a4a] text-sm py-4">All leads have been distributed to your team members.</p>
        ) : (
          <Table headers={['Code', 'Name', 'Phone', 'Company', 'Status', '']}>
            {unassignedToMe.slice(0, 8).map(l => (
              <Tr key={l.id}>
                <Td><span className="font-mono text-xs text-[#dfff03]">{l.clientCode}</span></Td>
                <Td><span className="text-white font-medium">{l.name}</span></Td>
                <Td><span className="font-mono text-xs">{l.phone}</span></Td>
                <Td><span className="text-[#a0a0a0] text-xs">{l.company || '—'}</span></Td>
                <Td><StatusBadge status={l.status} /></Td>
                <Td>
                  <button
                    onClick={() => { setAssignLeads([l.id]); setAssignModal(true); }}
                    className="text-[#dfff03] text-xs hover:underline"
                  >
                    Assign
                  </button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Upcoming meetings */}
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-4">Team Upcoming Meetings</h3>
        <div className="space-y-2">
          {myMeetings.filter(m => m.outcome === 'Scheduled').map(m => {
            const salesUser = USERS.find(u => u.id === m.assignedSalesId);
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
            {assignLeads.length > 0 ? `${assignLeads.length} lead(s) selected` : `All ${unassignedToMe.length} unassigned leads will be assigned`}
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
