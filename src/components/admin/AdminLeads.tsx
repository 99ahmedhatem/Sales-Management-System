import { useState } from 'react';
import { LEADS, USERS, Lead, LeadStatus } from '../../data/mockData';
import { Button, SearchInput, Select, StatusBadge, Table, Td, Tr, Modal, Card, Badge } from '../ui';

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

const REGION_OPTIONS = [
  { value: '', label: 'All Regions' },
  { value: 'Dubai', label: 'Dubai' },
  { value: 'Abu Dhabi', label: 'Abu Dhabi' },
  { value: 'Sharjah', label: 'Sharjah' },
  { value: 'Ajman', label: 'Ajman' },
  { value: 'Fujairah', label: 'Fujairah' },
  { value: 'RAK', label: 'RAK' },
];

export default function AdminLeads() {
  const [leads, setLeads] = useState<Lead[]>(LEADS);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [assignModal, setAssignModal] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', phone: '', company: '', region: '', source: '' });
  const [importModal, setImportModal] = useState(false);

  const telesalesUsers = USERS.filter(u => u.role === 'telesales' && u.status === 'active');

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchQ = !q || l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.company || '').toLowerCase().includes(q);
    const matchS = !statusFilter || l.status === statusFilter;
    const matchR = !regionFilter || l.region === regionFilter;
    return matchQ && matchS && matchR;
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleAll = () => {
    if (selected.length === filtered.length) setSelected([]);
    else setSelected(filtered.map(l => l.id));
  };

  const handleAssign = () => {
    if (!assignTo) return;
    setLeads(prev => prev.map(l =>
      selected.includes(l.id) ? { ...l, assignedTo: assignTo, status: 'Assigned' as LeadStatus } : l
    ));
    setSelected([]);
    setAssignModal(false);
    setAssignTo('');
  };

  const handleAddLead = () => {
    if (!newLead.name || !newLead.phone) return;
    const n = Date.now();
    const lead: Lead = {
      id: `l${n}`,
      clientCode: `CLT-${String(n).slice(-4)}`,
      name: newLead.name,
      phone: newLead.phone,
      company: newLead.company || undefined,
      region: newLead.region || undefined,
      source: newLead.source || 'Manual',
      status: 'New',
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setLeads(prev => [lead, ...prev]);
    setNewLead({ name: '', phone: '', company: '', region: '', source: '' });
    setAddModal(false);
  };

  const unassigned = leads.filter(l => !l.assignedTo).length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Leads</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{leads.length} total · {unassigned} unassigned</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setImportModal(true)}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import Excel
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>
            + Add Lead
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, company..." />
        <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} className="w-40" />
        <Select value={regionFilter} onChange={setRegionFilter} options={REGION_OPTIONS} className="w-36" />
        {selected.length > 0 && (
          <Button variant="primary" size="sm" onClick={() => setAssignModal(true)}>
            Assign {selected.length} Selected
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <Table headers={['', 'Code', 'Name', 'Phone', 'Company', 'Region', 'Status', 'Assigned To', 'Updated', '']}>
          <tr className="border-b border-[#262626]">
            <td className="py-3 px-4">
              <input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleAll} className="accent-[#dfff03]" />
            </td>
            <td colSpan={8} className="py-3 px-2 text-[#6b6b6b] text-xs">{filtered.length} records shown</td>
          </tr>
          {filtered.map(lead => {
            const assignedUser = USERS.find(u => u.id === lead.assignedTo);
            return (
              <Tr key={lead.id} onClick={() => setDetailLead(lead)}>
                <Td>
                  <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleSelect(lead.id)} onClick={e => e.stopPropagation()} className="accent-[#dfff03]" />
                </Td>
                <Td><span className="font-mono text-xs text-[#dfff03]">{lead.clientCode}</span></Td>
                <Td><span className="font-medium text-white">{lead.name}</span></Td>
                <Td><span className="font-mono text-xs">{lead.phone}</span></Td>
                <Td><span className="text-[#a0a0a0]">{lead.company || '—'}</span></Td>
                <Td><span className="text-[#a0a0a0]">{lead.region || '—'}</span></Td>
                <Td><StatusBadge status={lead.status} /></Td>
                <Td>
                  {assignedUser ? (
                    <span className="text-[#a0a0a0] text-xs">{assignedUser.fullName}</span>
                  ) : (
                    <span className="text-[#4a4a4a] text-xs italic">Unassigned</span>
                  )}
                </Td>
                <Td><span className="text-xs font-mono text-[#6b6b6b]">{lead.updatedAt}</span></Td>
                <Td>
                  <button className="text-[#4a4a4a] hover:text-[#dfff03] transition-colors" onClick={e => { e.stopPropagation(); setDetailLead(lead); }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </Td>
              </Tr>
            );
          })}
        </Table>
      </Card>

      {/* Lead Detail Modal */}
      <Modal open={!!detailLead} onClose={() => setDetailLead(null)} title="Lead Details">
        {detailLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Name', detailLead.name],
                ['Phone', detailLead.phone],
                ['Company', detailLead.company || '—'],
                ['Region', detailLead.region || '—'],
                ['Source', detailLead.source || '—'],
                ['Created', detailLead.createdAt],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded-lg p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{k}</div>
                  <div className="text-white text-sm font-medium">{v}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#6b6b6b] text-xs">Status:</span>
              <StatusBadge status={detailLead.status} />
            </div>
            {detailLead.notes && (
              <div className="bg-[#1a1a1a] rounded-lg p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Notes</div>
                <div className="text-[#d0d0d0] text-sm">{detailLead.notes}</div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setDetailLead(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Assign Modal */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title={`Assign ${selected.length} Leads`}>
        <div className="space-y-4">
          <p className="text-[#a0a0a0] text-sm">Select a Telesales agent to assign these leads to:</p>
          <div className="space-y-2">
            {telesalesUsers.map(u => {
              const assignedCount = leads.filter(l => l.assignedTo === u.id).length;
              return (
                <button
                  key={u.id}
                  onClick={() => setAssignTo(u.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${assignTo === u.id ? 'border-[#dfff03] bg-[#dfff03]/5' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'}`}
                >
                  <div className="text-white text-sm font-medium">{u.fullName}</div>
                  <div className="text-[#6b6b6b] text-xs">{assignedCount} leads currently assigned</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!assignTo} onClick={handleAssign}>Assign Leads</Button>
            <Button variant="ghost" onClick={() => setAssignModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Add Lead Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add New Lead">
        <div className="space-y-3">
          {[
            { label: 'Full Name *', key: 'name', placeholder: 'e.g. Ahmed Al-Rashid' },
            { label: 'Phone Number *', key: 'phone', placeholder: '+971 50 000 0000' },
            { label: 'Company', key: 'company', placeholder: 'Company name' },
            { label: 'Region', key: 'region', placeholder: 'Dubai, Abu Dhabi...' },
            { label: 'Source', key: 'source', placeholder: 'Referral, Website...' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-[#a0a0a0] mb-1">{f.label}</label>
              <input
                value={(newLead as any)[f.key]}
                onChange={e => setNewLead(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Button variant="primary" disabled={!newLead.name || !newLead.phone} onClick={handleAddLead}>Add Lead</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importModal} onClose={() => setImportModal(false)} title="Import Leads from Excel">
        <div className="space-y-4">
          <div className="border-2 border-dashed border-[#2a2a2a] rounded-lg p-8 text-center hover:border-[#dfff03]/30 transition-colors cursor-pointer">
            <svg className="w-10 h-10 text-[#4a4a4a] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <p className="text-[#a0a0a0] text-sm">Drop your Excel file here, or click to browse</p>
            <p className="text-[#4a4a4a] text-xs mt-1">.xlsx, .xls, .csv supported</p>
          </div>
          <div className="bg-[#1a1a1a] rounded-lg p-3 text-xs text-[#6b6b6b]">
            <p className="font-medium text-[#a0a0a0] mb-1">Expected columns:</p>
            <p>Name (required) · Phone (required) · Company · Region · Source · Notes</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary">Upload & Preview</Button>
            <Button variant="ghost" onClick={() => setImportModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
