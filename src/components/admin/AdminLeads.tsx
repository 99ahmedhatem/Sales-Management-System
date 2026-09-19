import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../supabaseClient';
import { addClientComment, loadClientComments } from '../../data/clientComments';
import { generateCode, Lead, LeadDataQuality, LeadStatus, User } from '../../data/mockData';
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

interface ImportLeadRow {
  name: string;
  phone: string;
  company: string;
  region: string;
  source: string;
  notes: string;
  isSallaStore: boolean;
  dataQuality: LeadDataQuality;
}

function readImportValue(row: Record<string, unknown>, names: string[]): string {
  const normalized = Object.entries(row).reduce<Record<string, unknown>>((result, [key, value]) => {
    result[key.trim().toLowerCase().replace(/[\s_-]+/g, '')] = value;
    return result;
  }, {});
  const value = names.map(name => normalized[name.replace(/[\s_-]+/g, '').toLowerCase()]).find(value => value !== undefined && value !== '');
  return String(value ?? '').trim();
}

function parseImportBoolean(value: string): boolean {
  return ['true', 'yes', 'y', '1', 'سلة', 'متجر سلة'].includes(value.toLowerCase());
}

function parseImportQuality(value: string): LeadDataQuality {
  const normalized = value.toLowerCase();
  if (['high', 'عالية', 'عالي'].includes(normalized)) return 'high';
  if (['medium', 'متوسطة', 'متوسط'].includes(normalized)) return 'medium';
  return 'normal';
}

// Supabase columns are snake_case; the rest of the app expects the camelCase
// Lead/User shape from mockData.ts, so we translate rows on the way in.
function mapLead(row: any): Lead {
  return {
    id: row.id,
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
  };
}

function mapUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    email: row.email,
    lastLogin: row.last_login,
    managerId: row.manager_id ?? undefined,
  };
}

export default function AdminLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [assignModal, setAssignModal] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', phone: '', company: '', region: '', source: '', isSallaStore: false, dataQuality: 'normal' as LeadDataQuality });
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<ImportLeadRow[]>([]);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  async function loadData() {
    setLoading(true);
    setErrorMsg('');
    const [leadsRes, usersRes] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('users').select('*'),
    ]);
    if (leadsRes.error) setErrorMsg(leadsRes.error.message);
    else setLeads((leadsRes.data ?? []).map(mapLead));
    if (usersRes.error) setErrorMsg(usersRes.error.message);
    else setUsers((usersRes.data ?? []).map(mapUser));
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!detailLead) return;
    loadClientComments(detailLead.id).then(({ data }) => {
      setDetailLead((prev: any) => prev ? { ...prev, comments: data } : null);
    });
  }, [detailLead?.id]);

  const assignableUsers = users.filter(u => ['manager', 'telesales'].includes(u.role) && u.status === 'active');

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

  const handleAssign = async () => {
    if (!assignTo) return;
    const { error } = await supabase
      .from('leads')
      .update({ assigned_to: assignTo, status: 'Assigned' as LeadStatus, updated_at: new Date().toISOString() })
      .in('id', selected);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadData();
    setSelected([]);
    setAssignModal(false);
    setAssignTo('');
  };

  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone) return;
    const { error } = await supabase.from('leads').insert({
      client_code: generateCode('CLT'),
      name: newLead.name,
      phone: newLead.phone,
      company: newLead.company || null,
      region: newLead.region || null,
      source: newLead.source || 'Manual',
      is_salla_store: newLead.isSallaStore,
      data_quality: newLead.dataQuality,
      status: 'New',
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadData();
    setNewLead({ name: '', phone: '', company: '', region: '', source: '', isSallaStore: false, dataQuality: 'normal' });
    setAddModal(false);
  };

  const handleAddComment = async () => {
    if (!detailLead || !commentText.trim()) return;
    setCommentError('');
    const { data, error } = await addClientComment({
      leadId: detailLead.id,
      authorId: (await supabase.auth.getUser()).data.user?.id || '',
      authorName: 'Admin',
      text: commentText.trim(),
    });
    if (error || !data) {
      setCommentError(error || 'Could not save the comment.');
      return;
    }
    setDetailLead((prev: any) => prev ? { ...prev, comments: [...(prev.comments || []), data] } : null);
    setCommentText('');
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportFile(file);
    setImportError('');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const parsed = rows.map(row => ({
        name: readImportValue(row, ['name', 'full name', 'client name', 'الاسم']),
        phone: readImportValue(row, ['phone', 'phone number', 'mobile', 'رقم الهاتف']),
        company: readImportValue(row, ['company', 'الشركة']),
        region: readImportValue(row, ['region', 'المنطقة']),
        source: readImportValue(row, ['source', 'المصدر']) || 'Excel Import',
        notes: readImportValue(row, ['notes', 'ملاحظات']),
        isSallaStore: parseImportBoolean(readImportValue(row, ['salla store', 'salla', 'is salla', 'متجر سلة'])),
        dataQuality: parseImportQuality(readImportValue(row, ['data quality', 'quality', 'جودة البيانات'])),
      })).filter(row => row.name && row.phone);
      if (!parsed.length) {
        setImportError('No valid rows found. Name and Phone are required.');
        setImportRows([]);
        return;
      }
      setImportRows(parsed);
    } catch {
      setImportError('Could not read this file. Use .xlsx, .xls, or .csv.');
      setImportRows([]);
    }
  };

  const handleImport = async () => {
    if (!importRows.length) return;
    setImporting(true);
    setImportError('');
    const { error } = await supabase.from('leads').insert(importRows.map(row => ({
      client_code: generateCode('CLT'),
      name: row.name,
      phone: row.phone,
      company: row.company || null,
      region: row.region || null,
      source: row.source,
      notes: row.notes || null,
      is_salla_store: row.isSallaStore,
      data_quality: row.dataQuality,
      status: 'New',
    })));
    setImporting(false);
    if (error) {
      setImportError(error.message);
      return;
    }
    await loadData();
    setImportFile(null);
    setImportRows([]);
    setImportModal(false);
  };

  const unassigned = leads.filter(l => !l.assignedTo).length;

  if (loading) {
    return <div className="p-6 text-[#a0a0a0] text-sm">Loading leads…</div>;
  }

  return (
    <div className="p-6 space-y-4">
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">
          {errorMsg}
        </div>
      )}
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
        <Table headers={['', 'Code', 'Name', 'Phone', 'Company', 'Salla', 'Quality', 'Status', 'Assigned To', 'Updated', '']}>
          <tr className="border-b border-[#262626]">
            <td className="py-3 px-4">
              <input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleAll} className="accent-[#dfff03]" />
            </td>
            <td colSpan={9} className="py-3 px-2 text-[#6b6b6b] text-xs">{filtered.length} records shown</td>
          </tr>
          {filtered.map(lead => {
            const assignedUser = users.find(u => u.id === lead.assignedTo);
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
                <Td><span className={lead.isSallaStore ? 'text-[#dfff03] text-xs' : 'text-[#6b6b6b] text-xs'}>{lead.isSallaStore ? 'Yes' : 'No'}</span></Td>
                <Td><span className="text-[#a0a0a0] text-xs">{lead.dataQuality}</span></Td>
                <Td><StatusBadge status={lead.status} /></Td>
                <Td>
                  {assignedUser ? (
                    <span className="text-[#a0a0a0] text-xs">{assignedUser.fullName}</span>
                  ) : (
                    <span className="text-[#4a4a4a] text-xs italic">Unassigned</span>
                  )}
                </Td>
                <Td><span className="text-xs font-mono text-[#6b6b6b]">{lead.updatedAt?.slice(0, 10)}</span></Td>
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
                ['Salla Store', detailLead.isSallaStore ? 'Yes' : 'No'],
                ['Data Quality', detailLead.dataQuality],
                ['Created', detailLead.createdAt?.slice(0, 10)],
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
            <div>
              <div className="text-[#6b6b6b] text-xs mb-2">Comments ({(detailLead.comments || []).length})</div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {(detailLead.comments || []).map(comment => (
                  <div key={comment.id} className="bg-[#1a1a1a] rounded-lg p-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-[#dfff03] text-xs font-medium">{comment.authorName}</span>
                      <span className="text-[#4a4a4a] text-xs">{comment.createdAt}</span>
                    </div>
                    <p className="text-[#d0d0d0] text-sm">{comment.text}</p>
                  </div>
                ))}
              </div>
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                rows={3}
                placeholder="Add a comment about this client..."
                className="w-full mt-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none"
              />
              {commentError && <p className="text-[#ff6464] text-xs mt-1">{commentError}</p>}
              <Button variant="secondary" size="sm" className="mt-2" disabled={!commentText.trim()} onClick={handleAddComment}>Post Comment</Button>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setDetailLead(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Assign Modal */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title={`Assign ${selected.length} Leads`}>
        <div className="space-y-4">
            <p className="text-[#a0a0a0] text-sm">Select a manager or Telesales agent to assign these leads to:</p>
          <div className="space-y-2">
            {assignableUsers.map(u => {
              const assignedCount = leads.filter(l => l.assignedTo === u.id).length;
              return (
                <button
                  key={u.id}
                  onClick={() => setAssignTo(u.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${assignTo === u.id ? 'border-[#dfff03] bg-[#dfff03]/5' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'}`}
                >
                  <div className="text-white text-sm font-medium">{u.fullName}</div>
                  <div className="text-[#6b6b6b] text-xs">{u.role === 'manager' ? 'Manager' : 'Telesales'} · {assignedCount} leads currently assigned</div>
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
          <label className="flex items-center gap-2 text-sm text-[#d0d0d0]">
            <input type="checkbox" checked={newLead.isSallaStore} onChange={e => setNewLead(prev => ({ ...prev, isSallaStore: e.target.checked }))} className="accent-[#dfff03]" />
            Salla store
          </label>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Data Quality</label>
            <select value={newLead.dataQuality} onChange={e => setNewLead(prev => ({ ...prev, dataQuality: e.target.value as LeadDataQuality }))} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60">
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="normal">Normal</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="primary" disabled={!newLead.name || !newLead.phone} onClick={handleAddLead}>Add Lead</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importModal} onClose={() => setImportModal(false)} title="Import Leads from Excel">
        <div className="space-y-4">
          <label className="block border-2 border-dashed border-[#2a2a2a] rounded-lg p-8 text-center hover:border-[#dfff03]/30 transition-colors cursor-pointer">
            <svg className="w-10 h-10 text-[#4a4a4a] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <p className="text-[#a0a0a0] text-sm">{importFile?.name || 'Choose an Excel or CSV file'}</p>
            <p className="text-[#4a4a4a] text-xs mt-1">.xlsx, .xls, .csv supported</p>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => handleImportFile(e.target.files?.[0])} />
          </label>
          {importRows.length > 0 && <p className="text-[#dfff03] text-xs">{importRows.length} valid rows ready to import.</p>}
          {importError && <p className="text-[#ff6464] text-xs">{importError}</p>}
          <div className="bg-[#1a1a1a] rounded-lg p-3 text-xs text-[#6b6b6b]">
            <p className="font-medium text-[#a0a0a0] mb-1">Expected columns:</p>
            <p>Name (required) · Phone (required) · Company · Region · Source · Notes · Salla Store · Data Quality</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!importRows.length || importing} onClick={handleImport}>{importing ? 'Importing...' : 'Import Leads'}</Button>
            <Button variant="ghost" onClick={() => setImportModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}