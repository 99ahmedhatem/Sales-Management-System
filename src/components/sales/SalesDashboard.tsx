import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { MEETINGS, LEADS, USERS, Meeting, MeetingOutcome, ClientComment, LeadStatus } from '../../data/mockData';
import { addClientComment, loadClientComments } from '../../data/clientComments';
import { Avatar, Button, Card, KpiCard, Modal, SearchInput, Select, StatusBadge, Table, Td, Tr } from '../ui';

const CLIENT_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'Subscribed', label: 'Subscribed' },
  { value: 'Did Not Subscribe', label: 'Did Not Subscribe' },
  { value: 'Free Trial', label: 'Free Trial' },
  { value: 'Interested', label: 'Interested' },
  { value: 'Not Interested', label: 'Not Interested' },
];

interface Props {
  userId: string;
}

const OUTCOME_OPTIONS: { value: MeetingOutcome; label: string }[] = [
  { value: 'Scheduled', label: 'Scheduled' },
  { value: 'Deal Closed – Won', label: 'Deal Closed – Won' },
  { value: 'Deal Lost', label: 'Deal Lost' },
  { value: 'Rescheduled', label: 'Rescheduled' },
  { value: 'No-Show', label: 'No-Show' },
];

export default function SalesDashboard({ userId }: Props) {
  const me = USERS.find(u => u.id === userId);
  const myMeetings = MEETINGS.filter(m => m.assignedSalesId === userId);
  const [meetings, setMeetings] = useState<Meeting[]>(myMeetings);
  const [detail, setDetail] = useState<Meeting | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'all'>('upcoming');
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [commentModal, setCommentModal] = useState<{ meetingId: string; leadId: string; leadName: string } | null>(null);
  const [newComment, setNewComment] = useState('');
  const [customerNumber, setCustomerNumber] = useState<number | undefined>();
  const [customerWebsite, setCustomerWebsite] = useState<string | undefined>();
  const [customerQuantity, setCustomerQuantity] = useState(0);
  const [editingCustomerNumber, setEditingCustomerNumber] = useState(false);
  const [customerNumberInput, setCustomerNumberInput] = useState('');
  const [leadComments, setLeadComments] = useState<Record<string, ClientComment[]>>({});

  useEffect(() => {
    if (!commentModal) return;
    loadClientComments(commentModal.leadId).then(({ data }) => {
      setLeadComments(prev => ({ ...prev, [commentModal.leadId]: data }));
    });
  }, [commentModal?.leadId]);

  useEffect(() => {
    if (!detail) return;
    supabase.from('leads').select('customer_number, website, quantity').eq('id', detail.leadId).maybeSingle().then(({ data }) => {
      setCustomerNumber(data?.customer_number ?? undefined);
      setCustomerNumberInput(data?.customer_number ? String(data.customer_number) : '');
      setCustomerWebsite(data?.website ?? undefined);
      setCustomerQuantity(data?.quantity ?? 0);
    });
  }, [detail?.leadId]);

  const saveCustomerNumber = async () => {
    const value = customerNumberInput.trim();
    const number = value ? Number(value) : null;
    if (number !== null && (!Number.isSafeInteger(number) || number <= 0)) return;
    const { error } = await supabase.rpc('set_lead_customer_number', { target_lead_id: detail?.leadId, new_customer_number: number });
    if (!error) {
      setCustomerNumber(number ?? undefined);
      setEditingCustomerNumber(false);
    }
  };

  const upcoming = meetings.filter(m => m.outcome === 'Scheduled');
  const wonCount = meetings.filter(m => m.outcome === 'Deal Closed – Won').length;
  const lostCount = meetings.filter(m => m.outcome === 'Deal Lost').length;

  const updateOutcome = (id: string, outcome: MeetingOutcome) => {
    setMeetings(prev => prev.map(m => m.id === id ? { ...m, outcome } : m));
    if (detail?.id === id) setDetail(prev => prev ? { ...prev, outcome } : null);
  };

  const addComment = async () => {
    if (!commentModal || !newComment.trim()) return;
    const { data: comment, error } = await addClientComment({
      leadId: commentModal.leadId,
      authorId: userId,
      authorName: me?.fullName || 'Sales',
      text: newComment.trim(),
    });
    if (error || !comment) {
      window.alert(error || 'Could not save the comment. Run supabase-setup.sql first.');
      return;
    }
    setLeadComments(prev => ({ ...prev, [commentModal.leadId]: [...(prev[commentModal.leadId] || []), comment] }));
    setNewComment('');
  };

  const displayed = (tab === 'upcoming' ? upcoming : meetings).filter(meeting => {
    const query = search.toLowerCase();
    return (!query || meeting.leadName.toLowerCase().includes(query) || meeting.leadPhone.includes(query))
      && (!outcomeFilter || meeting.outcome === outcomeFilter);
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-white text-2xl font-bold">My Meetings</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">Welcome back, {me?.fullName}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Upcoming" value={upcoming.length} sub="Scheduled meetings" />
        <KpiCard label="Deals Won" value={wonCount} accent sub="Closed successfully" />
        <KpiCard label="Deals Lost" value={lostCount} sub="Not converted" />
        <KpiCard label="Total" value={meetings.length} sub="All meetings" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {([
          { key: 'upcoming', label: `Upcoming (${upcoming.length})` },
          { key: 'all', label: `All Meetings (${meetings.length})` },
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
        <SearchInput value={search} onChange={setSearch} placeholder="Search client or phone..." />
        <Select value={outcomeFilter} onChange={setOutcomeFilter} options={[{ value: '', label: 'All Outcomes' }, ...OUTCOME_OPTIONS.map(option => ({ value: option.value, label: option.label }))]} className="w-48" />
      </div>

      {/* Meeting cards for upcoming */}
      {tab === 'upcoming' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {upcoming.length === 0 && (
            <div className="col-span-2 flex flex-col items-center justify-center py-16 text-[#4a4a4a]">
              <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">No upcoming meetings</p>
            </div>
          )}
          {upcoming.map(m => {
            const booker = USERS.find(u => u.id === m.bookedById);
            return (
              <div key={m.id} className="bg-[#161616] border border-[#262626] rounded-lg p-5 cursor-pointer hover:border-[#dfff03]/30 transition-colors" onClick={() => setDetail(m)}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-semibold text-base">{m.leadName}</h3>
                    <p className="text-[#dfff03] font-mono text-sm mt-0.5">{m.leadPhone}</p>
                  </div>
                  <StatusBadge status={m.outcome} />
                </div>
                <div className="flex items-center gap-2 text-[#6b6b6b] text-sm mb-3">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="font-mono">{m.proposedDate}</span>
                </div>
                <div className="bg-[#1a1a1a] rounded p-3 mb-4">
                  <div className="text-[#6b6b6b] text-xs mb-1">Telesales Notes</div>
                  <div className="text-[#d0d0d0] text-sm leading-relaxed">{m.telesalesNotes}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar name={booker?.fullName || ''} size="sm" />
                    <span className="text-[#6b6b6b] text-xs">Booked by {booker?.fullName}</span>
                  </div>
                  <select
                    value={m.outcome}
                    onChange={e => { updateOutcome(m.id, e.target.value as MeetingOutcome); }}
                    onClick={e => e.stopPropagation()}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#dfff03]/60"
                  >
                    {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'all' && (
        <Card>
          <Table headers={['Client', 'Phone', 'Date & Time', 'Booked By', 'Outcome', 'Update']}>
            {displayed.map(m => {
              const booker = USERS.find(u => u.id === m.bookedById);
              return (
                <Tr key={m.id} onClick={() => setDetail(m)}>
                  <Td><span className="font-medium text-white">{m.leadName}</span></Td>
                  <Td><span className="font-mono text-xs">{m.leadPhone}</span></Td>
                  <Td><span className="font-mono text-xs text-[#dfff03]">{m.proposedDate}</span></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={booker?.fullName || ''} size="sm" />
                      <span className="text-[#a0a0a0] text-xs">{booker?.fullName}</span>
                    </div>
                  </Td>
                  <Td><StatusBadge status={m.outcome} /></Td>
                  <Td>
                    <select
                      value={m.outcome}
                      onChange={e => { updateOutcome(m.id, e.target.value as MeetingOutcome); }}
                      onClick={e => e.stopPropagation()}
                      className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#dfff03]/60"
                    >
                      {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Td>
                </Tr>
              );
            })}
          </Table>
        </Card>
      )}

      {/* Detail Modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Meeting Details">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Client', detail.leadName],
                ['Phone', detail.leadPhone],
                ['Scheduled', detail.proposedDate],
                ['Created', detail.createdAt],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{k}</div>
                  <div className="text-white text-sm font-medium">{v}</div>
                </div>
              ))}
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">Customer Number</div>
              {editingCustomerNumber ? (
                <input autoFocus type="number" min="1" value={customerNumberInput} onChange={e => setCustomerNumberInput(e.target.value)} onBlur={saveCustomerNumber} onKeyDown={e => { if (e.key === 'Enter') saveCustomerNumber(); if (e.key === 'Escape') setEditingCustomerNumber(false); }} className="w-28 bg-[#0e0e0e] border border-[#dfff03] rounded px-2 py-1 text-sm text-white" />
              ) : (
                <button onDoubleClick={() => setEditingCustomerNumber(true)} className="text-white text-sm font-medium cursor-text">{customerNumber ?? '—'}</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Website</div>
                <div className="text-white text-sm font-medium break-all">{customerWebsite || '—'}</div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Quantity</div>
                <div className="text-white text-sm font-medium">{customerQuantity}</div>
              </div>
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">Telesales Qualifying Notes</div>
              <div className="text-[#d0d0d0] text-sm leading-relaxed">{detail.telesalesNotes}</div>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Update Outcome</label>
              <select
                value={detail.outcome}
                onChange={e => updateOutcome(detail.id, e.target.value as MeetingOutcome)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
              >
                {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { if (detail) setCommentModal({ meetingId: detail.id, leadId: detail.leadId, leadName: detail.leadName }); }}>💬 Add Comment</Button>
              <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Comment Modal */}
      <Modal open={!!commentModal} onClose={() => setCommentModal(null)} title={`Comments — ${commentModal?.leadName}`}>
        {commentModal && (
          <div className="space-y-4">
            <div className="max-h-40 overflow-y-auto space-y-2">
              {(leadComments[commentModal.leadId] || []).map(c => (
                <div key={c.id} className="bg-[#1a1a1a] rounded p-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-[#dfff03] text-xs font-medium">{c.authorName}</span>
                    <span className="text-[#4a4a4a] text-xs font-mono">{c.createdAt}</span>
                  </div>
                  <p className="text-[#d0d0d0] text-sm">{c.text}</p>
                </div>
              ))}
              {(leadComments[commentModal.leadId] || []).length === 0 && <p className="text-[#4a4a4a] text-xs">No comments yet.</p>}
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Add Comment</label>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} rows={3} placeholder="Update on client status, meeting notes..." className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none" />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" disabled={!newComment.trim()} onClick={addComment}>Post</Button>
              <Button variant="ghost" onClick={() => setCommentModal(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
