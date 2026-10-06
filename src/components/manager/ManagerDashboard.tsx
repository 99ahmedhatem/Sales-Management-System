import { TableSkeleton } from '../shared/motion';
import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Lead, LeadStatus, User } from '../../data/mockData';
import { loadMeetingsPage, Meeting } from '../../data/meetings';
import { dateLocale } from '../../i18n/locale';
import { Avatar, Button, Card, KpiCard, Modal, Pagination, SearchInput, Select, StatusBadge, Table, Td, Tr, WebsiteLink } from '../ui';
import { EditablePhoneCell, WebsiteStatusToggle } from '../shared/LeadRowControls';
import { exportRowsToExcel } from '../shared/exportExcel';
import DistributeLeadsModal from '../shared/DistributeLeadsModal';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { recordActivity } from '../../data/activityLog';
import { createNotification } from '../../data/notifications';
import { useI18n } from '../../i18n/I18nProvider';
import { ClientLink } from '../shared/AppOverlays';

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
  const { t, lang } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const me = users.find(u => u.id === userId);

  // My team: all Sales/Telesales who have managerId = me
  const myTeam = users.filter(u => u.managerId === userId);

  // Team meetings come from the real meetings table (exact counts per sales agent).
  const [salesMeetingCounts, setSalesMeetingCounts] = useState<Record<string, { total: number; won: number }>>({});
  const [upcomingMeetings, setUpcomingMeetings] = useState<Meeting[]>([]);
  const teamMeetingTotal = Object.values(salesMeetingCounts).reduce((sum, row) => sum + row.total, 0);
  const won = Object.values(salesMeetingCounts).reduce((sum, row) => sum + row.won, 0);

  // Exact per-user lead counts (get_team_lead_stats), not just the leads on the current page.
  const [leadStats, setLeadStats] = useState<Record<string, { total: number; contacted: number; converted: number }>>({});
  const statsFor = (id: string) => leadStats[id] ?? { total: 0, contacted: 0, converted: 0 };
  const teamLeadTotal = Object.values(leadStats).reduce((sum, row) => sum + row.total, 0);
  const converted = Object.values(leadStats).reduce((sum, row) => sum + row.converted, 0);

  const telesalesTeam = myTeam.filter(u => u.role === 'telesales');
  const assignableTelesales = telesalesTeam.filter(u => u.status === 'active');
  const salesTeam = myTeam.filter(u => u.role === 'sales');

  // Assignment
  const [assignModal, setAssignModal] = useState(false);
  const [assignLeads, setAssignLeads] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState('');
  const [distributeModal, setDistributeModal] = useState(false);
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
  const [assignmentFilter, setAssignmentFilter] = useState('manager');
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [leadPage, setLeadPage] = useState(0);
  const [totalTeamLeads, setTotalTeamLeads] = useState(0);
  const [receivedCount, setReceivedCount] = useState(0);
  const [distributedCount, setDistributedCount] = useState(0);
    const [workedClientCount, setWorkedClientCount] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const pageSize = 100;
  useEffect(() => {
    async function loadManagerData() {
      setLoading(true);
      setErrorMsg('');
      const [usersRes, leadsRes] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('leads').select('*', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }).range(leadPage * pageSize, (leadPage + 1) * pageSize - 1),
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
          websiteStatus: row.website_status ?? undefined,
          websiteStatusSource: row.website_status_source ?? undefined,
          phoneSource: row.phone_source ?? undefined,
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
        const salesIds = mappedUsers.filter(user => user.managerId === userId && user.role === 'sales').map(user => user.id);
        const meetingCount = (salesId: string, outcome?: string) => {
          let query = supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('assigned_sales_id', salesId);
          if (outcome) query = query.eq('outcome', outcome);
          return query;
        };
        const [receivedRes, distributedRes, workedRes, leadStatsRes, upcomingRes, ...salesCountRes] = await Promise.all([
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('assigned_to', userId),
          teamIds.length ? supabase.from('leads').select('id', { count: 'exact', head: true }).in('assigned_to', teamIds) : Promise.resolve({ count: 0, error: null }),
          teamIds.length ? supabase.rpc('get_worked_clients_count', { p_user_ids: teamIds }) : Promise.resolve({ data: 0, error: null }),
          supabase.rpc('get_team_lead_stats', { p_user_ids: [userId, ...teamIds] }),
          salesIds.length
            ? loadMeetingsPage({ page: 0, pageSize: 10, assignedSalesIds: salesIds, outcome: 'Scheduled', proposedAfter: new Date().toISOString() })
            : Promise.resolve({ data: [] as Meeting[], count: 0, error: null }),
          ...salesIds.flatMap(id => [meetingCount(id), meetingCount(id, 'Deal Closed – Won')]),
        ]);
        const countError = receivedRes.error?.message || distributedRes.error?.message || workedRes.error?.message
          || leadStatsRes.error?.message || upcomingRes.error || salesCountRes.find(res => res.error)?.error?.message;
        if (countError) setErrorMsg(countError);
        setLeadStats(Object.fromEntries(((leadStatsRes.data ?? []) as { user_id: string; total: number; contacted: number; converted: number }[])
          .map(row => [row.user_id, { total: Number(row.total), contacted: Number(row.contacted), converted: Number(row.converted) }])));
        setReceivedCount(receivedRes.count ?? 0);
        setDistributedCount(distributedRes.count ?? 0);
        setWorkedClientCount(Number(workedRes.data ?? 0));
        setUpcomingMeetings(upcomingRes.data ?? []);
        setSalesMeetingCounts(Object.fromEntries(salesIds.map((id, index) => [id, {
          total: salesCountRes[index * 2]?.count ?? 0,
          won: salesCountRes[index * 2 + 1]?.count ?? 0,
        }])));
      }
      setLoading(false);
    }
    loadManagerData();
  }, [leadPage, refreshVersion]);

  useRealtimeRefresh(['leads', 'users', 'meetings'], () => setRefreshVersion(version => version + 1));

  const agentStats = telesalesTeam.map(agent => {
    const { total, contacted, converted: conv } = statsFor(agent.id);
    return { agent, total, contacted, converted: conv, rate: total ? Math.round(conv / total * 100) : 0 };
  });

  const salesStats = salesTeam.map(agent => {
    const { total, won: dealWon } = salesMeetingCounts[agent.id] ?? { total: 0, won: 0 };
    return { agent, total, won: dealWon, rate: total ? Math.round(dealWon / total * 100) : 0 };
  });

  const handleAssign = async () => {
    if (!assignTo || assignLeads.length === 0 || assigning || !assignableTelesales.some(u => u.id === assignTo)) return;
    setAssigning(true);
    setErrorMsg('');
    const { error } = await supabase
      .from('leads')
      .update({ assigned_to: assignTo, status: 'Assigned' as LeadStatus, updated_at: new Date().toISOString() })
      .in('id', assignLeads);
    if (error) {
      setErrorMsg(error.message);
      setAssigning(false);
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
    setAssigning(false);
    setRefreshVersion(version => version + 1);
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
    if (savingPhone) return;
    const phone = editingPhone.trim();
    setSavingPhone(true);
    setErrorMsg('');
    const { error } = await supabase.from('leads').update({ phone: phone || null, phone_source: phone ? 'manual' : null, updated_at: new Date().toISOString() }).eq('id', leadId);
    setSavingPhone(false);
    if (error) { setErrorMsg(error.message); return; }
    setAllLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, phone } : lead));
    setRefreshVersion(version => version + 1);
  };

  const saveInlinePhone = async (lead: Lead, value: string) => {
    const phone = value.replace(/[^\d+]/g, '');
    const { error } = await supabase.from('leads').update({ phone: phone || null, phone_source: phone ? 'manual' : null, updated_at: new Date().toISOString() }).eq('id', lead.id);
    if (error) {
      setErrorMsg(error.message);
      throw new Error(error.message);
    }
    setAllLeads(prev => prev.map(item => item.id === lead.id ? { ...item, phone, phoneSource: phone ? 'manual' : undefined } : item));
  };

  const toggleWebsiteStatus = async (lead: Lead, nextStatus: 'working' | 'not_working') => {
    const previousStatus = lead.websiteStatus;
    setAllLeads(prev => prev.map(item => item.id === lead.id ? { ...item, websiteStatus: nextStatus, websiteStatusSource: 'manual' } : item));
    const { error } = await supabase.from('leads').update({ website_status: nextStatus, website_status_source: 'manual', updated_at: new Date().toISOString() }).eq('id', lead.id);
    if (error) {
      setAllLeads(prev => prev.map(item => item.id === lead.id ? { ...item, websiteStatus: previousStatus, websiteStatusSource: lead.websiteStatusSource } : item));
      setErrorMsg(error.message);
      throw new Error(error.message);
    }
  };

  const poolLeads = assignmentFilter === 'all'
    ? allLeads
    : assignmentFilter === 'unassigned'
      ? allLeads.filter(lead => !lead.assignedTo)
      : allLeads.filter(lead => lead.assignedTo === userId);
  const filteredPool = poolLeads.filter(lead => {
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
    setSelectedPoolLeads(prev => prev.length === poolLeads.length ? [] : poolLeads.map(lead => lead.id));
  };

  const exportLeads = async () => {
    setExporting(true);
    setErrorMsg('');
    try {
      const queryBuilder = supabase.from('leads').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
      const data: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: pageRows, error } = await queryBuilder.range(from, from + 999);
        if (error) throw error;
        data.push(...(pageRows ?? []));
        if (!pageRows || pageRows.length < 1000) break;
      }
      const searchQuery = leadSearch.toLowerCase();
      const rows = (data ?? []).filter(row => {
        const assignedTo = row.assigned_to as string | null;
        const matchesAssignment = assignmentFilter === 'all'
          ? true
          : assignmentFilter === 'unassigned'
            ? !assignedTo
            : assignedTo === userId;
        return matchesAssignment
          && (!searchQuery || String(row.name ?? '').toLowerCase().includes(searchQuery) || String(row.phone ?? '').includes(searchQuery) || String(row.company ?? '').toLowerCase().includes(searchQuery))
          && (!leadStatus || row.status === leadStatus)
          && (!leadCountry || row.region === leadCountry)
          && (!leadType || (leadType === 'salla' ? row.is_salla_store : !row.is_salla_store))
          && (!leadQuality || row.data_quality === leadQuality)
          && (!leadPhone || (leadPhone === 'has' ? Boolean(row.phone) : !row.phone));
      });
      exportRowsToExcel(rows.map(row => ({
        'NO.': row.customer_number ?? '',
        CODE: row.client_code,
        NAME: row.name,
        PHONE: row.phone ?? '',
        COMPANY: row.company ?? '',
        WEBSITE: row.website ?? '',
        'WEBSITE STATUS': row.website_status === 'working' ? 'Working' : row.website_status === 'not_working' ? 'Not Working' : 'Not Checked',
        QUANTITY: row.quantity ?? 0,
        STATUS: row.status ?? '',
      })), 'manager-leads-export');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not export leads.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-[#a0a0a0] text-sm"><TableSkeleton /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      {errorMsg && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3 anim-banner">{t(errorMsg)}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{t('Team Overview')}</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{me?.fullName || t('Manager')} — {t('Manager')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDistributeModal(true)}>{t('Distribute evenly')}</Button>
          {poolLeads.length > 0 && (
            <Button variant="primary" size="sm" disabled={!selectedPoolLeads.length} onClick={() => { setAssignLeads(selectedPoolLeads); setAssignTo(''); setAssignModal(true); }}>
              {t('Distribute Selected ({n})', { n: selectedPoolLeads.length })}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 anim-stagger">
        <KpiCard label="Clients Worked" value={workedClientCount} sub="Distinct team clients" />
        <KpiCard label="Team Members" value={myTeam.length} sub={t('{a} telesales · {b} sales', { a: telesalesTeam.length, b: salesTeam.length })} />
        <KpiCard label="Received from Admin" value={receivedCount} sub="Waiting in your pool" />
        <KpiCard label="Distributed" value={distributedCount} sub="Assigned to your team" />
        <KpiCard label="Converted" value={converted} accent sub={t('{n}% rate', { n: teamLeadTotal > 0 ? Math.round(converted / teamLeadTotal * 100) : 0 })} />
        <KpiCard label="Deals Won" value={won} sub={t('{n} total meetings', { n: teamMeetingTotal })} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Telesales Performance */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">{t('Telesales Team')}</h3>
          </div>
          {telesalesTeam.length === 0 && <p className="text-[#4a4a4a] text-sm">{t('No telesales agents assigned to your team.')}</p>}
          <div className="space-y-3">
            {agentStats.map(({ agent, total, contacted, converted, rate }) => (
              <div key={agent.id} className="p-3 bg-[#1a1a1a] rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <Avatar name={agent.fullName} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{agent.fullName}</div>
                    <div className="text-[#6b6b6b] text-xs">{t('{a} leads · {b} contacted', { a: total, b: contacted })}</div>
                  </div>
                  <div className="text-end">
                    <div className="text-[#dfff03] font-bold text-lg font-mono">{rate}%</div>
                    <div className="text-[#6b6b6b] text-xs">{t('{n} cvt', { n: converted })}</div>
                  </div>
                </div>
                <div className="h-1.5 bg-[#262626] rounded-full">
                  <div className="h-full bg-[#dfff03] rounded-full anim-bar" style={{ width: `${rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Sales Performance */}
        <Card className="p-5">
          <h3 className="text-white font-semibold mb-4">{t('Sales Team')}</h3>
          {salesTeam.length === 0 && <p className="text-[#4a4a4a] text-sm">{t('No sales agents assigned to your team.')}</p>}
          <div className="space-y-3">
            {salesStats.map(({ agent, total, won, rate }) => (
              <div key={agent.id} className="p-3 bg-[#1a1a1a] rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <Avatar name={agent.fullName} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{agent.fullName}</div>
                    <div className="text-[#6b6b6b] text-xs">{t('{a} meetings · {b} won', { a: total, b: won })}</div>
                  </div>
                  <div className="text-end">
                    <div className="text-[#64dc78] font-bold text-lg font-mono">{rate}%</div>
                    <div className="text-[#6b6b6b] text-xs">{t('win rate')}</div>
                  </div>
                </div>
                <div className="h-1.5 bg-[#262626] rounded-full">
                  <div className="h-full bg-[#64dc78] rounded-full anim-bar" style={{ width: `${rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Team Leads Table */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">{t('My Leads Pool ({n} unassigned to agents)', { n: poolLeads.length })}</h3>
          {poolLeads.length > 0 && (
            <button onClick={toggleAllPoolLeads} className="text-[#dfff03] text-xs hover:underline">
              {selectedPoolLeads.length === poolLeads.length ? t('Clear selection') : t('Select all')}
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
          <Select value={assignmentFilter} onChange={setAssignmentFilter} options={[{ value: 'all', label: 'All' }, { value: 'manager', label: 'Distributed to a manager' }, { value: 'unassigned', label: 'Not distributed' }]} className="w-48" />
          <Button variant="secondary" size="sm" disabled={exporting} onClick={exportLeads}>{exporting ? t('Exporting...') : t('Export Excel')}</Button>
        </div>
        {poolLeads.length === 0 ? (
          <p className="text-[#4a4a4a] text-sm py-4">{t('All leads have been distributed to your team members.')}</p>
        ) : (
          <div>
            <Table headers={['', 'No.', 'Code', 'Name', 'Phone', 'Company', 'Website', 'Website Status', 'Quantity', 'Status', '']}>
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
                <Td><ClientLink leadId={l.id} className="text-white font-medium">{l.name}</ClientLink></Td>
                <Td><EditablePhoneCell phone={l.phone} onSave={phone => saveInlinePhone(l, phone)} /></Td>
                <Td><span className="text-[#a0a0a0] text-xs">{l.company || '—'}</span></Td>
                <Td><WebsiteLink url={l.website} className="text-[#a0a0a0] text-xs truncate max-w-40 inline-block" /></Td>
                <Td><WebsiteStatusToggle status={l.websiteStatus} onToggle={nextStatus => toggleWebsiteStatus(l, nextStatus)} /></Td>
                <Td><span className="font-mono text-xs text-[#a0a0a0]">{l.quantity ?? 0}</span></Td>
                <Td><StatusBadge status={l.status} /></Td>
                <Td>
                  <button
                    onClick={() => { setSelectedPoolLeads([l.id]); setAssignLeads([l.id]); setAssignTo(''); setAssignModal(true); }}
                    className="text-[#dfff03] text-xs hover:underline"
                  >
                    {t('Assign')}
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
              ].map(([label, value]) => <div key={label} className="bg-[#1a1a1a] rounded p-3"><div className="text-[#6b6b6b] text-xs mb-1">{t(String(label))}</div><div className="text-white text-sm font-medium break-all">{label === 'Website' ? <WebsiteLink url={String(value)} /> : label === 'Data Quality' ? t(String(value)) : value}</div></div>)}
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">{t('Phone Number')}</div>
              <div className="flex gap-2">
                <input value={editingPhone || detailLead.phone} onChange={e => setEditingPhone(e.target.value)} placeholder={t('Add phone number')} dir="ltr" className="flex-1 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white" />
                <Button variant="primary" size="sm" disabled={savingPhone} onClick={() => savePhone(detailLead.id)}>{savingPhone ? t('Saving...') : t('Save Phone')}</Button>
              </div>
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">{t('Customer Number')}</div>
              <div className="flex gap-2">
                <input type="number" min="1" value={editingCustomerNumberId === detailLead.id ? editingCustomerNumber : String(detailLead.customerNumber ?? '')} onChange={e => { setEditingCustomerNumberId(detailLead.id); setEditingCustomerNumber(e.target.value); }} placeholder={t('Enter customer number')} className="flex-1 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white" />
                <Button variant="primary" size="sm" onClick={() => saveCustomerNumber(detailLead.id)}>{t('Save Number')}</Button>
              </div>
            </div>
            <Button variant="ghost" onClick={() => setDetailLead(null)}>{t('Close')}</Button>
          </div>
        )}
      </Modal>

      {/* Upcoming meetings */}
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-4">{t('Team Upcoming Meetings')}</h3>
        <div className="space-y-2">
          {upcomingMeetings.map(m => {
            const salesUser = users.find(u => u.id === m.assignedSalesId);
            return (
              <div key={m.id} className="flex items-center gap-4 p-3 bg-[#1a1a1a] rounded-lg">
                <div className="flex-1">
                  <div className="text-white text-sm font-medium"><ClientLink leadId={m.leadId}>{m.leadName}</ClientLink></div>
                  <div className="text-[#6b6b6b] text-xs" dir="ltr">{m.leadPhone}</div>
                </div>
                <div className="text-end">
                  <div className="text-[#dfff03] text-xs font-mono">{new Date(m.proposedDate).toLocaleString(dateLocale(lang))}</div>
                  <div className="text-[#6b6b6b] text-xs">{salesUser?.fullName ?? m.assignedSalesName}</div>
                </div>
                <StatusBadge status={m.outcome} />
              </div>
            );
          })}
          {upcomingMeetings.length === 0 && (
            <p className="text-[#4a4a4a] text-sm py-4">{t('No upcoming meetings.')}</p>
          )}
        </div>
      </Card>

      {/* Assign leads modal */}
      <DistributeLeadsModal
        open={distributeModal}
        onClose={() => setDistributeModal(false)}
        agents={assignableTelesales}
        managerPool
        onDone={() => setRefreshVersion(version => version + 1)}
      />

      <Modal open={assignModal} onClose={() => setAssignModal(false)} title="Distribute Leads to Team Member">
        <div className="space-y-4">
          <p className="text-[#a0a0a0] text-sm">{t('Assign leads from your pool to a telesales agent on your team.')}</p>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-2">{t('Assign to:')}</label>
            <div className="space-y-2">
              {assignableTelesales.map(u => {
                const count = statsFor(u.id).total;
                return (
                  <button
                    key={u.id}
                    onClick={() => setAssignTo(u.id)}
                    className={`w-full text-start p-3 rounded-lg border transition-all ${assignTo === u.id ? 'border-[#dfff03] bg-[#dfff03]/5' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'}`}
                  >
                    <div className="text-white text-sm font-medium">{u.fullName}</div>
                    <div className="text-[#6b6b6b] text-xs">{t('{n} leads currently assigned', { n: count })}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="bg-[#1a1a1a] rounded p-3 text-xs text-[#6b6b6b]">
            {assignLeads.length > 0 ? t('{n} lead(s) selected', { n: assignLeads.length }) : t('Select leads from your pool first')}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!assignTo || assigning} onClick={handleAssign}>{assigning ? t('Saving...') : t('Assign Leads')}</Button>
            <Button variant="ghost" onClick={() => setAssignModal(false)}>{t('Cancel')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
