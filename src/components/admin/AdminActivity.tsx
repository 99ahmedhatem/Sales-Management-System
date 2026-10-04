import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { ActivityLog } from '../../data/mockData';
import { mapActivity } from '../../data/activityLog';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { Card, Pagination, SearchInput, Select, StatusBadge, Table, Td, Tr } from '../ui';
import { EditablePhoneCell } from '../shared/LeadRowControls';
import { useI18n } from '../../i18n/I18nProvider';
import { dateLocale } from '../../i18n/locale';

interface LeadRow {
  id: string;
  customerNumber?: number;
  clientCode: string;
  name: string;
  phone: string;
  status: string;
  region?: string;
  isSallaStore: boolean;
  dataQuality: string;
  assignedTo?: string;
}

interface ActivityCounts {
  total: number;
  calls: number;
  comments: number;
  clients: number;
}

const PAGE_SIZE = 50;
const ALL_ACTIVITY_TYPES = ['call', 'comment', 'assignment', 'forward'];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'New', label: 'New' },
  { value: 'Assigned', label: 'Assigned' },
  { value: 'Contacted', label: 'Contacted' },
  { value: 'Interested', label: 'Interested' },
  { value: 'Not Interested', label: 'Not Interested' },
  { value: 'Call Back Later', label: 'Call Back Later' },
  { value: 'Converted', label: 'Converted' },
  { value: 'No Answer', label: 'No Answer' },
];

export default function AdminActivity() {
  const { t, lang } = useI18n();
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<ActivityCounts | null>(null);
  const [page, setPage] = useState(0);
  const [pageTotal, setPageTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [leadType, setLeadType] = useState('');
  const [quality, setQuality] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const saveLeadPhone = async (lead: LeadRow, value: string) => {
    const phone = value.replace(/[^\d+]/g, '');
    const { error: saveError } = await supabase.from('leads').update({ phone: phone || null, phone_source: phone ? 'manual' : null, updated_at: new Date().toISOString() }).eq('id', lead.id);
    if (saveError) {
      setError(saveError.message);
      throw new Error(saveError.message);
    }
    setLeads(prev => prev.map(item => item.id === lead.id ? { ...item, phone } : item));
  };

  // One page of activity, then only the leads that appear on it (never the whole leads table).
  async function loadActivity(nextPage = page) {
    setError('');
    let pageQuery = supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1);
    if (type) pageQuery = pageQuery.eq('activity_type', type);
    const typeCount = (activityType?: string) => {
      let query = supabase.from('activity_logs').select('id', { count: 'exact', head: true });
      if (activityType) query = query.eq('activity_type', activityType);
      return query;
    };
    const [activityRes, userRes, totalRes, callsRes, commentsRes] = await Promise.all([
      pageQuery,
      supabase.from('users').select('id'),
      typeCount(),
      typeCount('call'),
      typeCount('comment'),
    ]);
    const firstError = activityRes.error?.message || userRes.error?.message || totalRes.error?.message || callsRes.error?.message || commentsRes.error?.message;
    if (firstError) {
      setError(firstError);
      setLoading(false);
      return;
    }
    const pageActivities = (activityRes.data ?? []).map(mapActivity);
    const leadIds = [...new Set(pageActivities.map(activity => activity.leadId).filter(Boolean))];
    const userIds = (userRes.data ?? []).map(row => row.id);
    const [leadRes, clientsRes] = await Promise.all([
      leadIds.length
        ? supabase.from('leads').select('id, customer_number, client_code, name, phone, status, region, is_salla_store, data_quality, assigned_to').in('id', leadIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.rpc('get_worked_clients_count', { p_user_ids: userIds, p_activity_types: ALL_ACTIVITY_TYPES }),
    ]);
    if (leadRes.error) setError(leadRes.error.message);
    if (clientsRes.error) setError(clientsRes.error.message);
    setActivities(pageActivities);
    setPageTotal(activityRes.count ?? 0);
    setPage(nextPage);
    setLeads((leadRes.data ?? []).map(row => ({
      id: row.id,
      customerNumber: row.customer_number ?? undefined,
      clientCode: row.client_code,
      name: row.name,
      phone: row.phone ?? '',
      status: row.status,
      region: row.region ?? undefined,
      isSallaStore: row.is_salla_store ?? false,
      dataQuality: row.data_quality ?? 'normal',
      assignedTo: row.assigned_to ?? undefined,
    })));
    setCounts({
      total: totalRes.count ?? 0,
      calls: callsRes.count ?? 0,
      comments: commentsRes.count ?? 0,
      clients: Number(clientsRes.data ?? 0),
    });
    setLoading(false);
  }

  useEffect(() => { loadActivity(0); }, [type]);
  useRealtimeRefresh(['activity_logs', 'leads', 'client_comments'], () => loadActivity(page));

  const leadById = new Map(leads.map(lead => [lead.id, lead]));
  // Lead filters and search apply to the activity on the current page.
  const visible = activities.filter(activity => {
    const lead = leadById.get(activity.leadId);
    const query = search.toLowerCase();
    return (!status || lead?.status === status)
      && (!country || lead?.region === country)
      && (!leadType || (leadType === 'salla' ? lead?.isSallaStore : !lead?.isSallaStore))
      && (!quality || lead?.dataQuality === quality)
      && (!phone || (phone === 'has' ? Boolean(lead?.phone) : !lead?.phone))
      && (!query || lead?.name.toLowerCase().includes(query) || lead?.phone.includes(query) || activity.actorName.toLowerCase().includes(query));
  });
  const formatCount = (value?: number) => (counts && value !== undefined ? value.toLocaleString('en-US') : '—');

  if (loading) return <div className="p-6 text-[#a0a0a0] text-sm">{t('Loading worked clients...')}</div>;

  return (
    <div className="p-6 space-y-6">
      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">{t(error)}</div>}
      <div>
        <h1 className="text-white text-2xl font-bold">{t('Worked Clients')}</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">{t('Every call, comment, and handoff stays here after a lead leaves the queue.')}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Activities')}</div><div className="text-white text-2xl font-bold mt-1">{formatCount(counts?.total)}</div></Card>
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Clients Worked')}</div><div className="text-white text-2xl font-bold mt-1">{formatCount(counts?.clients)}</div></Card>
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Calls')}</div><div className="text-white text-2xl font-bold mt-1">{formatCount(counts?.calls)}</div></Card>
        <Card className="p-4"><div className="text-[#6b6b6b] text-xs">{t('Comments')}</div><div className="text-white text-2xl font-bold mt-1">{formatCount(counts?.comments)}</div></Card>
      </div>
      <div className="flex flex-wrap gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search client, phone, or agent..." />
        <Select value={type} onChange={setType} options={[{ value: '', label: 'All Activity' }, { value: 'call', label: 'Calls' }, { value: 'comment', label: 'Comments' }, { value: 'assignment', label: 'Assignments' }, { value: 'forward', label: 'Forwarded' }]} className="w-44" />
        <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-40" />
        <Select value={country} onChange={setCountry} options={[{ value: '', label: 'All Countries' }, { value: 'Saudi Arabia', label: 'Saudi Arabia' }, { value: 'Oman', label: 'Oman' }, { value: 'Iraq', label: 'Iraq' }, { value: 'UAE', label: 'UAE' }, { value: 'Egypt', label: 'Egypt' }]} className="w-40" />
        <Select value={leadType} onChange={setLeadType} options={[{ value: '', label: 'All Types' }, { value: 'software', label: 'Software' }, { value: 'salla', label: 'Salla Store' }]} className="w-36" />
        <Select value={quality} onChange={setQuality} options={[{ value: '', label: 'All Quality' }, { value: 'normal', label: 'Normal' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'Strong' }]} className="w-36" />
        <Select value={phone} onChange={setPhone} options={[{ value: '', label: 'All Phones' }, { value: 'has', label: 'Has phone' }, { value: 'missing', label: 'No phone' }]} className="w-36" />
      </div>
      <p className="text-[#6b6b6b] text-xs -mt-3">{t('Search and client filters apply to the activity on this page.')}</p>
      <Card>
        <Table headers={['Client', 'Phone', 'Agent', 'Activity', 'Outcome', 'Notes', 'Time']}>
          {visible.map(activity => {
            const lead = leadById.get(activity.leadId);
            return <Tr key={activity.id}>
              <Td><div className="text-white font-medium">{lead?.name || t('Deleted client')}</div><div className="text-[#dfff03] text-xs font-mono">{lead?.clientCode}</div></Td>
              <Td>{lead ? <EditablePhoneCell phone={lead.phone} onSave={value => saveLeadPhone(lead, value)} /> : <span className="font-mono text-xs">—</span>}</Td>
              <Td><div className="text-white text-sm">{activity.actorName}</div><div className="text-[#6b6b6b] text-xs">{t(activity.actorRole)}</div></Td>
              <Td><span className="text-[#a0a0a0] text-xs capitalize">{t(activity.activityType)}</span></Td>
              <Td>{activity.outcome ? <StatusBadge status={activity.outcome} /> : <span className="text-[#4a4a4a]">—</span>}</Td>
              <Td><span className="text-[#a0a0a0] text-xs">{activity.notes || '—'}</span></Td>
              <Td><span className="text-[#6b6b6b] text-xs font-mono">{new Date(activity.createdAt).toLocaleString(dateLocale(lang))}</span></Td>
            </Tr>;
          })}
        </Table>
        {visible.length === 0 && <div className="p-8 text-center text-[#4a4a4a] text-sm">{t('No worked-client activity found.')}</div>}
        <Pagination page={page} pageSize={PAGE_SIZE} total={pageTotal} onChange={next => loadActivity(next)} />
      </Card>
    </div>
  );
}
