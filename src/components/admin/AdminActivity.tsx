import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { ActivityLog } from '../../data/mockData';
import { mapActivity } from '../../data/activityLog';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { Card, SearchInput, Select, StatusBadge, Table, Td, Tr } from '../ui';

interface LeadRow {
  id: string;
  customerNumber?: number;
  clientCode: string;
  name: string;
  phone: string;
  status: string;
  assignedTo?: string;
}

export default function AdminActivity() {
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadActivity() {
    const [activityRes, leadRes, userRes] = await Promise.all([
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from('leads').select('id, customer_number, client_code, name, phone, status, assigned_to'),
      supabase.from('users').select('id, full_name'),
    ]);
    if (activityRes.error) setError(activityRes.error.message);
    else setActivities((activityRes.data ?? []).map(mapActivity));
    if (!leadRes.error) setLeads((leadRes.data ?? []).map(row => ({
      id: row.id,
      customerNumber: row.customer_number ?? undefined,
      clientCode: row.client_code,
      name: row.name,
      phone: row.phone ?? '',
      status: row.status,
      assignedTo: row.assigned_to ?? undefined,
    })));
    if (!userRes.error) setUsers(Object.fromEntries((userRes.data ?? []).map(row => [row.id, row.full_name])));
    setLoading(false);
  }

  useEffect(() => { loadActivity(); }, []);
  useRealtimeRefresh(['activity_logs', 'leads', 'client_comments'], loadActivity);

  const leadById = new Map(leads.map(lead => [lead.id, lead]));
  const visible = activities.filter(activity => {
    const lead = leadById.get(activity.leadId);
    const query = search.toLowerCase();
    return (!type || activity.activityType === type)
      && (!query || lead?.name.toLowerCase().includes(query) || lead?.phone.includes(query) || activity.actorName.toLowerCase().includes(query));
  });

  if (loading) return <div className="p-6 text-[#a0a0a0] text-sm">Loading worked clients...</div>;

  return (
    <div className="p-6 space-y-6">
      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">{error}</div>}
      <div>
        <h1 className="text-white text-2xl font-bold">Worked Clients</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">Every call, comment, and handoff stays here after a lead leaves the queue.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Activities</div><div className="text-white text-2xl font-bold mt-1">{activities.length}</div></Card>
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Clients Worked</div><div className="text-white text-2xl font-bold mt-1">{new Set(activities.map(activity => activity.leadId)).size}</div></Card>
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Calls</div><div className="text-white text-2xl font-bold mt-1">{activities.filter(activity => activity.activityType === 'call').length}</div></Card>
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">Comments</div><div className="text-white text-2xl font-bold mt-1">{activities.filter(activity => activity.activityType === 'comment').length}</div></Card>
      </div>
      <div className="flex gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search client, phone, or agent..." />
        <Select value={type} onChange={setType} options={[{ value: '', label: 'All Activity' }, { value: 'call', label: 'Calls' }, { value: 'comment', label: 'Comments' }, { value: 'assignment', label: 'Assignments' }, { value: 'forward', label: 'Forwarded' }]} className="w-44" />
      </div>
      <Card>
        <Table headers={['Client', 'Phone', 'Agent', 'Activity', 'Outcome', 'Notes', 'Time']}>
          {visible.map(activity => {
            const lead = leadById.get(activity.leadId);
            return <Tr key={activity.id}>
              <Td><div className="text-white font-medium">{lead?.name || 'Deleted client'}</div><div className="text-[#dfff03] text-xs font-mono">{lead?.clientCode}</div></Td>
              <Td><span className="font-mono text-xs">{lead?.phone || '—'}</span></Td>
              <Td><div className="text-white text-sm">{activity.actorName}</div><div className="text-[#6b6b6b] text-xs">{activity.actorRole}</div></Td>
              <Td><span className="text-[#a0a0a0] text-xs capitalize">{activity.activityType}</span></Td>
              <Td>{activity.outcome ? <StatusBadge status={activity.outcome} /> : <span className="text-[#4a4a4a]">—</span>}</Td>
              <Td><span className="text-[#a0a0a0] text-xs">{activity.notes || '—'}</span></Td>
              <Td><span className="text-[#6b6b6b] text-xs font-mono">{new Date(activity.createdAt).toLocaleString()}</span></Td>
            </Tr>;
          })}
        </Table>
        {visible.length === 0 && <div className="p-8 text-center text-[#4a4a4a] text-sm">No worked-client activity found.</div>}
      </Card>
    </div>
  );
}