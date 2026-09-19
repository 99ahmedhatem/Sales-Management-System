import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Lead, LeadStatus, CallLog, ClientComment, User } from '../../data/mockData';
import { addClientComment, loadClientComments } from '../../data/clientComments';
import { Avatar, Button, Card, KpiCard, Modal, Pagination, SearchInput, Select, StatusBadge, Table, Td, Tr } from '../ui';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

const ROLE_REGION_OPTIONS = [{ value: '', label: 'All Countries' }, { value: 'Saudi Arabia', label: 'Saudi Arabia' }, { value: 'Oman', label: 'Oman' }, { value: 'Iraq', label: 'Iraq' }, { value: 'UAE', label: 'UAE' }, { value: 'Egypt', label: 'Egypt' }];
const ROLE_TYPE_OPTIONS = [{ value: '', label: 'All Types' }, { value: 'software', label: 'Software' }, { value: 'salla', label: 'Salla Store' }];
const ROLE_QUALITY_OPTIONS = [{ value: '', label: 'All Quality' }, { value: 'normal', label: 'Normal' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'Strong' }];
const ROLE_PHONE_OPTIONS = [{ value: '', label: 'All Phones' }, { value: 'has', label: 'Has phone' }, { value: 'missing', label: 'No phone' }];

const CALL_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'No Answer', label: 'No Answer' },
  { value: 'Call Back Later', label: 'Call Back Later' },
  { value: 'Contacted', label: 'Contacted' },
  { value: 'Interested', label: 'Interested' },
  { value: 'Not Interested', label: 'Not Interested' },
  { value: 'Free Trial', label: 'Free Trial' },
  { value: 'Subscribed', label: 'Subscribed' },
  { value: 'Did Not Subscribe', label: 'Did Not Subscribe' },
  { value: 'Converted', label: 'Converted' },
];

interface Props {
  userId: string;
}

export default function TelesalesDashboard({ userId }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const me = users.find(u => u.id === userId);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(0);
  const [totalLeads, setTotalLeads] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const pageSize = 100;

  useEffect(() => {
    async function loadQueue() {
      setLoading(true);
      const [userRes, leadRes] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('leads').select('*', { count: 'exact' }).eq('assigned_to', userId).order('created_at', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1),
      ]);
      if (userRes.error || leadRes.error) {
        setLoadError(userRes.error?.message || leadRes.error?.message || 'Could not load your queue.');
      } else {
        setUsers((userRes.data ?? []).map(row => ({
          id: row.id,
          username: row.username,
          fullName: row.full_name,
          role: row.role,
          status: row.status,
          email: row.email,
          lastLogin: row.last_login,
          managerId: row.manager_id ?? undefined,
        })));
        setLeads((leadRes.data ?? []).map(row => ({
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
        setTotalLeads(leadRes.count ?? 0);
      }
      setLoading(false);
    }
    loadQueue();
  }, [userId, page, refreshVersion]);

  useRealtimeRefresh(['leads', 'users'], () => setRefreshVersion(version => version + 1));

  const activeLeads = leads.filter(l => !['Subscribed', 'Converted', 'Did Not Subscribe'].includes(l.status));
  const doneLeads = leads.filter(l => ['Subscribed', 'Converted', 'Did Not Subscribe'].includes(l.status));

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');
  const [tab, setTab] = useState<'queue' | 'done'>('queue');

  // Modals
  const [callModal, setCallModal] = useState<Lead | null>(null);
  const [forwardModal, setForwardModal] = useState<Lead | null>(null);
  const [commentModal, setCommentModal] = useState<Lead | null>(null);
  const [detailModal, setDetailModal] = useState<Lead | null>(null);
  const [editingCustomerNumberId, setEditingCustomerNumberId] = useState<string | null>(null);
  const [editingCustomerNumber, setEditingCustomerNumber] = useState('');
  const [editingPhone, setEditingPhone] = useState('');

  const [callStatus, setCallStatus] = useState<LeadStatus>('Contacted');
  const [callNotes, setCallNotes] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [freeTrialEnd, setFreeTrialEnd] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [newComment, setNewComment] = useState('');

  const salesUsers = users.filter(u => u.role === 'sales' && u.status === 'active');

  const saveCustomerNumber = async (leadId: string) => {
    const value = editingCustomerNumber.trim();
    const number = value ? Number(value) : null;
    if (number !== null && (!Number.isSafeInteger(number) || number <= 0)) {
      setLoadError('Customer number must be a positive whole number.');
      setEditingCustomerNumberId(null);
      return;
    }
    const { error } = await supabase.rpc('set_lead_customer_number', { target_lead_id: leadId, new_customer_number: number });
    if (error) { setLoadError(error.message); return; }
    setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, customerNumber: number ?? undefined } : lead));
    setEditingCustomerNumberId(null);
  };

  const savePhone = async (leadId: string) => {
    const phone = editingPhone.trim();
    const { error } = await supabase.from('leads').update({ phone: phone || null, updated_at: new Date().toISOString() }).eq('id', leadId);
    if (error) { setLoadError(error.message); return; }
    setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, phone } : lead));
  };

  if (loading) {
    return <div className="p-6 text-[#a0a0a0] text-sm">Loading your queue…</div>;
  }

  useEffect(() => {
    if (!commentModal) return;
    loadClientComments(commentModal.id).then(({ data, error }) => {
      if (error) return;
      setLeads(prev => prev.map(lead => lead.id === commentModal.id ? { ...lead, comments: data } : lead));
      setCommentModal(prev => prev ? { ...prev, comments: data } : null);
    });
  }, [commentModal?.id]);

  const filtered = (tab === 'queue' ? activeLeads : doneLeads).filter(l => {
    const q = search.toLowerCase();
    return (!q || l.name.toLowerCase().includes(q) || l.phone.includes(q))
      && (!statusFilter || l.status === statusFilter)
      && (!countryFilter || l.region === countryFilter)
      && (!typeFilter || (typeFilter === 'salla' ? l.isSallaStore : !l.isSallaStore))
      && (!qualityFilter || l.dataQuality === qualityFilter)
      && (!phoneFilter || (phoneFilter === 'has' ? Boolean(l.phone) : !l.phone));
  });

  const updateLead = (id: string, patch: Partial<Lead>) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...patch, updatedAt: new Date().toISOString().slice(0, 10) } : l));
  };

  const logCall = () => {
    if (!callModal) return;
    const log: CallLog = {
      id: `c${Date.now()}`,
      leadId: callModal.id,
      agentId: userId,
      outcome: callStatus,
      notes: callNotes,
      calledAt: new Date().toLocaleString(),
    };
    setCallLogs(prev => [...prev, log]);
    updateLead(callModal.id, {
      status: callStatus,
      notes: callNotes,
      callbackDate: callStatus === 'Call Back Later' ? callbackDate : undefined,
      freeTrialEndDate: callStatus === 'Free Trial' ? freeTrialEnd : undefined,
    });
    setCallModal(null);
    setCallNotes('');
    setCallStatus('Contacted');
    setCallbackDate('');
    setFreeTrialEnd('');
  };

  const forwardToSales = () => {
    if (!forwardModal || !forwardTo || !meetingDate) return;
    updateLead(forwardModal.id, { status: 'Converted' });
    setForwardModal(null);
    setForwardTo('');
    setMeetingDate('');
  };

  const addComment = async () => {
    if (!commentModal || !newComment.trim()) return;
    const { data: comment, error } = await addClientComment({
      leadId: commentModal.id,
      authorId: userId,
      authorName: me?.fullName || 'Telesales',
      text: newComment.trim(),
    });
    if (error || !comment) {
      window.alert(error || 'Could not save the comment. Run supabase-setup.sql first.');
      return;
    }
    const updated = leads.map(l => l.id === commentModal.id
      ? { ...l, comments: [...(l.comments || []), comment] }
      : l
    );
    setLeads(updated);
    setCommentModal(updated.find(l => l.id === commentModal.id) || null);
    setNewComment('');
  };

  const todayCalls = callLogs.length;
  const totalConverted = leads.filter(l => ['Subscribed', 'Converted'].includes(l.status)).length;
  const freeTrial = leads.filter(l => l.status === 'Free Trial').length;
  const convRate = leads.length > 0 ? Math.round((totalConverted / leads.length) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      {loadError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">{loadError}</div>}
      <div>
        <h1 className="text-white text-2xl font-bold">My Queue</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">Welcome back, {me?.fullName || 'Telesales'}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Active Queue" value={activeLeads.length} sub="Leads to contact" />
        <KpiCard label="Subscribed" value={totalConverted} accent sub={`${convRate}% rate`} />
        <KpiCard label="Free Trial" value={freeTrial} sub="Awaiting decision" />
        <KpiCard label="Calls Logged" value={todayCalls} sub="This session" />
      </div>

      {/* Callback reminders */}
      {leads.filter(l => l.status === 'Call Back Later' && l.callbackDate).length > 0 && (
        <div className="bg-[#ffc832]/8 border border-[#ffc832]/20 rounded-lg px-4 py-3">
          <div className="text-[#ffc832] text-xs font-medium mb-1">⏰ Callback Reminders</div>
          <div className="flex flex-wrap gap-2">
            {leads.filter(l => l.status === 'Call Back Later' && l.callbackDate).map(l => (
              <span key={l.id} className="text-xs text-[#a0a0a0] bg-[#1e1e1e] rounded px-2 py-1">
                {l.name} — <span className="text-[#ffc832] font-mono">{l.callbackDate}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Free trial reminders */}
      {leads.filter(l => l.status === 'Free Trial' && l.freeTrialEndDate).length > 0 && (
        <div className="bg-[#64c8ff]/8 border border-[#64c8ff]/20 rounded-lg px-4 py-3">
          <div className="text-[#64c8ff] text-xs font-medium mb-1">🔁 Free Trial Ending</div>
          <div className="flex flex-wrap gap-2">
            {leads.filter(l => l.status === 'Free Trial' && l.freeTrialEndDate).map(l => (
              <span key={l.id} className="text-xs text-[#a0a0a0] bg-[#1e1e1e] rounded px-2 py-1">
                {l.name} — ends <span className="text-[#64c8ff] font-mono">{l.freeTrialEndDate}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {([
          { key: 'queue', label: `Active (${activeLeads.length})` },
          { key: 'done', label: `Completed (${doneLeads.length})` },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 text-sm rounded-md transition-all ${tab === t.key ? 'bg-[#dfff03] text-black font-medium' : 'text-[#6b6b6b] hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or phone..." />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: '', label: 'All Status' }, ...CALL_STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))]}
          className="w-44"
        />
        <Select value={countryFilter} onChange={setCountryFilter} options={ROLE_REGION_OPTIONS} className="w-40" />
        <Select value={typeFilter} onChange={setTypeFilter} options={ROLE_TYPE_OPTIONS} className="w-36" />
        <Select value={qualityFilter} onChange={setQualityFilter} options={ROLE_QUALITY_OPTIONS} className="w-36" />
        <Select value={phoneFilter} onChange={setPhoneFilter} options={ROLE_PHONE_OPTIONS} className="w-36" />
      </div>

      <Card>
        <Table headers={['No.', 'Code', 'Lead', 'Phone', 'Website', 'Quantity', 'Status', 'Notes', 'Due', 'Actions']}>
          {filtered.map(lead => (
            <Tr key={lead.id} onClick={() => setDetailModal(lead)}>
              <Td>
                <div onDoubleClick={e => { e.stopPropagation(); setEditingCustomerNumberId(lead.id); setEditingCustomerNumber(String(lead.customerNumber ?? '')); }}>
                  {editingCustomerNumberId === lead.id ? (
                    <input autoFocus type="number" min="1" value={editingCustomerNumber} onChange={e => setEditingCustomerNumber(e.target.value)} onBlur={() => saveCustomerNumber(lead.id)} onKeyDown={e => { if (e.key === 'Enter') saveCustomerNumber(lead.id); if (e.key === 'Escape') setEditingCustomerNumberId(null); }} onClick={e => e.stopPropagation()} className="w-20 bg-[#1a1a1a] border border-[#dfff03] rounded px-2 py-1 text-xs text-white" />
                  ) : <span className="font-mono text-xs text-[#a0a0a0] cursor-text">{lead.customerNumber ?? '—'}</span>}
                </div>
              </Td>
              <Td><span className="font-mono text-xs text-[#dfff03]">{lead.clientCode}</span></Td>
              <Td><span className="font-medium text-white">{lead.name}</span></Td>
              <Td><span className="font-mono text-xs">{lead.phone}</span></Td>
              <Td><span className="text-[#a0a0a0] text-xs truncate max-w-40 inline-block">{lead.website || '—'}</span></Td>
              <Td><span className="font-mono text-xs text-[#a0a0a0]">{lead.quantity ?? 0}</span></Td>
              <Td><StatusBadge status={lead.status} /></Td>
              <Td>
                <span className="text-[#6b6b6b] text-xs">
                  {lead.notes ? lead.notes.slice(0, 45) + (lead.notes.length > 45 ? '…' : '') : '—'}
                </span>
              </Td>
              <Td>
                {lead.callbackDate && <span className="font-mono text-xs text-[#ffc832]">{lead.callbackDate}</span>}
                {lead.freeTrialEndDate && <span className="font-mono text-xs text-[#64c8ff]">{lead.freeTrialEndDate}</span>}
                {!lead.callbackDate && !lead.freeTrialEndDate && <span className="text-[#4a4a4a] text-xs">—</span>}
              </Td>
              <Td>
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <Button variant="secondary" size="sm" onClick={() => { setCallModal(lead); setCallStatus(lead.status as LeadStatus || 'Contacted'); setCallNotes(lead.notes || ''); }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    Log
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setCommentModal(lead); }}>💬</Button>
                  {['Interested', 'Free Trial'].includes(lead.status) && (
                    <Button variant="primary" size="sm" onClick={() => setForwardModal(lead)}>→</Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={pageSize} total={totalLeads} onChange={setPage} />
      </Card>

      {/* Lead Detail Modal */}
      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title={`Client — ${detailModal?.name}`}>
        {detailModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Code', detailModal.clientCode],
                ['Customer Number', detailModal.customerNumber ?? '—'],
                ['Company', detailModal.company || '—'],
                ['Website', detailModal.website || '—'],
                ['Quantity', detailModal.quantity ?? 0],
                ['Region', detailModal.region || '—'],
                ['Source', detailModal.source || '—'],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{k}</div>
                  <div className="text-white text-sm font-medium">{v}</div>
                </div>
              ))}
              <div className="bg-[#1a1a1a] rounded p-3 col-span-2">
                <div className="text-[#6b6b6b] text-xs mb-1">Phone Number</div>
                <div className="flex gap-2">
                  <input value={editingPhone || detailModal.phone} onChange={e => setEditingPhone(e.target.value)} placeholder="Add phone number" className="flex-1 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white" />
                  <Button variant="primary" size="sm" onClick={() => savePhone(detailModal.id)}>Save Phone</Button>
                </div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Status</div>
                <StatusBadge status={detailModal.status} />
              </div>
            </div>
            {detailModal.notes && (
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Notes</div>
                <div className="text-[#d0d0d0] text-sm">{detailModal.notes}</div>
              </div>
            )}
            <div>
              <div className="text-[#6b6b6b] text-xs mb-2">Comments ({(detailModal.comments || []).length})</div>
              <div className="space-y-2">
                {(detailModal.comments || []).map(c => (
                  <div key={c.id} className="bg-[#1a1a1a] rounded p-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-[#dfff03] text-xs font-medium">{c.authorName}</span>
                      <span className="text-[#4a4a4a] text-xs font-mono">{c.createdAt}</span>
                    </div>
                    <p className="text-[#d0d0d0] text-sm">{c.text}</p>
                  </div>
                ))}
                {(detailModal.comments || []).length === 0 && <p className="text-[#4a4a4a] text-xs">No comments yet.</p>}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDetailModal(null)}>Close</Button>
          </div>
        )}
      </Modal>

      {/* Log Call Modal */}
      <Modal open={!!callModal} onClose={() => setCallModal(null)} title={`Log Call — ${callModal?.name}`}>
        {callModal && (
          <div className="space-y-4">
            <div className="bg-[#1a1a1a] rounded p-3 flex gap-4">
              <div>
                <div className="text-[#6b6b6b] text-xs">Phone</div>
                <div className="text-[#dfff03] font-mono text-sm">{callModal.phone}</div>
              </div>
              <div>
                <div className="text-[#6b6b6b] text-xs">Code</div>
                <div className="text-white font-mono text-sm">{callModal.clientCode}</div>
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Call Outcome *</label>
              <select
                value={callStatus}
                onChange={e => setCallStatus(e.target.value as LeadStatus)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
              >
                {CALL_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            {callStatus === 'Call Back Later' && (
              <div>
                <label className="block text-xs text-[#a0a0a0] mb-1">Callback Date</label>
                <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60" />
              </div>
            )}
            {callStatus === 'Free Trial' && (
              <div>
                <label className="block text-xs text-[#a0a0a0] mb-1">Free Trial End Date</label>
                <input type="date" value={freeTrialEnd} onChange={e => setFreeTrialEnd(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60" />
              </div>
            )}
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Notes</label>
              <textarea
                value={callNotes}
                onChange={e => setCallNotes(e.target.value)}
                rows={3}
                placeholder="What was discussed, objections, next steps..."
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={logCall}>Save Call Log</Button>
              <Button variant="ghost" onClick={() => setCallModal(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Comment Modal */}
      <Modal open={!!commentModal} onClose={() => setCommentModal(null)} title={`Comments — ${commentModal?.name}`}>
        {commentModal && (
          <div className="space-y-4">
            <div className="max-h-48 overflow-y-auto space-y-2">
              {(commentModal.comments || []).map(c => (
                <div key={c.id} className="bg-[#1a1a1a] rounded p-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-[#dfff03] text-xs font-medium">{c.authorName}</span>
                    <span className="text-[#4a4a4a] text-xs font-mono">{c.createdAt}</span>
                  </div>
                  <p className="text-[#d0d0d0] text-sm">{c.text}</p>
                </div>
              ))}
              {(commentModal.comments || []).length === 0 && <p className="text-[#4a4a4a] text-xs">No comments yet.</p>}
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Add Comment</label>
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                rows={3}
                placeholder="Add a note about this client..."
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" disabled={!newComment.trim()} onClick={addComment}>Post Comment</Button>
              <Button variant="ghost" onClick={() => setCommentModal(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Forward to Sales Modal */}
      <Modal open={!!forwardModal} onClose={() => setForwardModal(null)} title={`Forward to Sales — ${forwardModal?.name}`}>
        {forwardModal && (
          <div className="space-y-4">
            <p className="text-[#a0a0a0] text-sm">Select a Sales agent and propose a meeting time.</p>
            <div className="space-y-2">
              {salesUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => setForwardTo(u.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${forwardTo === u.id ? 'border-[#dfff03] bg-[#dfff03]/5' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'}`}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={u.fullName} size="sm" />
                    <span className="text-white text-sm">{u.fullName}</span>
                  </div>
                </button>
              ))}
              <div className="bg-[#1a1a1a] rounded p-3 col-span-2">
                <div className="text-[#6b6b6b] text-xs mb-1">Add / Edit Customer Number</div>
                <input
                  type="number"
                  min="1"
                  value={editingCustomerNumberId === detailModal?.id ? editingCustomerNumber : String(detailModal?.customerNumber ?? '')}
                  onChange={e => { if (detailModal) setEditingCustomerNumberId(detailModal.id); setEditingCustomerNumber(e.target.value); }}
                  onBlur={() => { if (detailModal) saveCustomerNumber(detailModal.id); }}
                  onKeyDown={e => { if (e.key === 'Enter' && detailModal) saveCustomerNumber(detailModal.id); }}
                  placeholder="Enter customer number"
                  className="w-full bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white"
                />
                <Button variant="primary" size="sm" className="mt-2" onClick={() => { if (detailModal) saveCustomerNumber(detailModal.id); }}>Save Number</Button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Proposed Meeting Date & Time *</label>
              <input type="datetime-local" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60" />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" disabled={!forwardTo || !meetingDate} onClick={forwardToSales}>Forward Lead</Button>
              <Button variant="ghost" onClick={() => setForwardModal(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
