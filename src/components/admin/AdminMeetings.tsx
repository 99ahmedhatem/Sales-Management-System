import { useState } from 'react';
import { MEETINGS, USERS, Meeting, MeetingOutcome } from '../../data/mockData';
import { Card, StatusBadge, Table, Td, Tr, Modal, Button, Select, Avatar } from '../ui';

const OUTCOME_OPTIONS = [
  { value: 'Scheduled', label: 'Scheduled' },
  { value: 'Deal Closed – Won', label: 'Deal Closed – Won' },
  { value: 'Deal Lost', label: 'Deal Lost' },
  { value: 'Rescheduled', label: 'Rescheduled' },
  { value: 'No-Show', label: 'No-Show' },
];

export default function AdminMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>(MEETINGS);
  const [detail, setDetail] = useState<Meeting | null>(null);
  const [filter, setFilter] = useState('');

  const salesUsers = USERS.filter(u => u.role === 'sales');

  const filtered = meetings.filter(m => !filter || m.outcome === filter);

  const wonCount = meetings.filter(m => m.outcome === 'Deal Closed – Won').length;
  const lostCount = meetings.filter(m => m.outcome === 'Deal Lost').length;
  const scheduledCount = meetings.filter(m => m.outcome === 'Scheduled').length;

  const updateOutcome = (id: string, outcome: MeetingOutcome) => {
    setMeetings(prev => prev.map(m => m.id === id ? { ...m, outcome } : m));
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-white text-2xl font-bold">Meetings</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">{scheduledCount} upcoming · {wonCount} won · {lostCount} lost</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Scheduled', value: scheduledCount, color: '#dfff03' },
          { label: 'Won', value: wonCount, color: '#64dc78' },
          { label: 'Lost', value: lostCount, color: '#ff6464' },
          { label: 'Total', value: meetings.length, color: '#6495ed' },
        ].map(s => (
          <Card key={s.label} className="p-4 text-center">
            <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[#6b6b6b] text-xs mt-1">{s.label}</div>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <Select
          value={filter}
          onChange={setFilter}
          options={[{ value: '', label: 'All Outcomes' }, ...OUTCOME_OPTIONS]}
          className="w-48"
        />
      </div>

      <Card>
        <Table headers={['Client', 'Phone', 'Sales Agent', 'Date & Time', 'Telesales Notes', 'Outcome', '']}>
          {filtered.map(m => {
            const salesUser = USERS.find(u => u.id === m.assignedSalesId);
            const booker = USERS.find(u => u.id === m.bookedById);
            return (
              <Tr key={m.id} onClick={() => setDetail(m)}>
                <Td><span className="font-medium text-white">{m.leadName}</span></Td>
                <Td><span className="font-mono text-xs">{m.leadPhone}</span></Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Avatar name={salesUser?.fullName || ''} size="sm" />
                    <span className="text-[#a0a0a0] text-xs">{salesUser?.fullName}</span>
                  </div>
                </Td>
                <Td><span className="font-mono text-xs text-[#dfff03]">{m.proposedDate}</span></Td>
                <Td>
                  <span className="text-[#6b6b6b] text-xs line-clamp-1 max-w-48">
                    {m.telesalesNotes.slice(0, 60)}{m.telesalesNotes.length > 60 ? '...' : ''}
                  </span>
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

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Meeting Details">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Client', detail.leadName],
                ['Phone', detail.leadPhone],
                ['Date & Time', detail.proposedDate],
                ['Booked', new Date(detail.createdAt).toLocaleDateString()],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{k}</div>
                  <div className="text-white text-sm font-medium">{v}</div>
                </div>
              ))}
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">Telesales Notes</div>
              <div className="text-[#d0d0d0] text-sm">{detail.telesalesNotes}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#6b6b6b] text-xs">Current Outcome:</span>
              <StatusBadge status={detail.outcome} />
            </div>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
