import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../supabaseClient';
import { addClientComment, loadClientComments } from '../../data/clientComments';
import { generateCode, Lead, LeadDataQuality, LeadStatus, User } from '../../data/mockData';
import { Button, SearchInput, Select, StatusBadge, Table, Td, Tr, Modal, Card, Pagination } from '../ui';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

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

// Stored in the database as the English name in "value"
const REGION_OPTIONS = [
  { value: '', label: 'All Countries' },
  { value: 'Saudi Arabia', label: 'Saudi Arabia (السعودية)' },
  { value: 'Oman', label: 'Oman (عمان)' },
  { value: 'Iraq', label: 'Iraq (العراق)' },
  { value: 'UAE', label: 'UAE (الإمارات)' },
  { value: 'Egypt', label: 'Egypt (مصر)' },
];

// Different ways a country can be written in a sheet, mapped to the names above
const COUNTRY_ALIASES: Record<string, string[]> = {
  'Saudi Arabia': ['saudi arabia', 'saudi', 'ksa', 'sa', 'السعودية', 'السعوديه', 'المملكة العربية السعودية'],
  Oman: ['oman', 'om', 'omn', 'عمان', 'سلطنة عمان'],
  Iraq: ['iraq', 'iq', 'irq', 'العراق'],
  UAE: ['uae', 'ae', 'united arab emirates', 'emirates', 'الامارات', 'الإمارات', 'dubai', 'abu dhabi', 'sharjah', 'ajman', 'fujairah', 'rak', 'ras al khaimah', 'دبي', 'ابوظبي', 'أبوظبي', 'الشارقة'],
  Egypt: ['egypt', 'eg', 'مصر'],
};

const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'software', label: 'Software' },
  { value: 'salla', label: 'Salla Store' },
];

const QUALITY_FILTER_OPTIONS = [
  { value: '', label: 'All Quality' },
  { value: 'normal', label: 'Normal (عادية)' },
  { value: 'medium', label: 'Medium (متوسطة)' },
  { value: 'high', label: 'Strong (قوية)' },
];

const PHONE_FILTER_OPTIONS = [
  { value: '', label: 'All Phones' },
  { value: 'has', label: 'Has phone' },
  { value: 'missing', label: 'No phone' },
];

// Same list as the filter, but the first option is "no region" for the Add Lead form
const REGION_FORM_OPTIONS = [
  { value: '', label: 'Select country' },
  ...REGION_OPTIONS.slice(1),
];

// Turns "ksa", "KSA", "السعودية" ... into "Saudi Arabia". Unknown values are kept as written.
function normalizeCountry(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return '';
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.includes(key)) return country;
  }
  return value.trim();
}

// A lead as shown in the details modal (comments are loaded separately)
type LeadWithComments = Lead & { comments?: any[] };

interface ImportLeadRow {
  customerNumber?: number;
  website?: string;
  websiteKey?: string;
  name: string;
  phone: string; // already cleaned, may be empty
  company: string;
  region: string;
  source: string;
  notes: string;
  quantity: number;
}

function readImportValue(row: Record<string, unknown>, names: string[]): string {
  const normalized = Object.entries(row).reduce<Record<string, unknown>>((result, [key, value]) => {
    result[key.trim().toLowerCase().replace(/[\s_-]+/g, '')] = value;
    return result;
  }, {});
  const value = names
    .map(name => normalized[name.replace(/[\s_-]+/g, '').toLowerCase()])
    .find(value => value !== undefined && value !== '');
  return String(value ?? '').trim();
}

function parseCustomerNumber(value: string): number | undefined {
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseQuantity(value: string): number {
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

// Keeps digits and a leading +. A dash or empty cell becomes '' (no phone).
function cleanPhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

function normalizeWebsite(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

function mapLead(row: any): Lead {
  return {
    id: row.id,
    customerNumber: row.customer_number ?? undefined,
    website: row.website ?? undefined,
    quantity: row.quantity ?? 0,
    clientCode: row.client_code,
    name: row.name,
    phone: row.phone ?? '',
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
  const [firstLoad, setFirstLoad] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detailLead, setDetailLead] = useState<LeadWithComments | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneMsg, setPhoneMsg] = useState('');
  const [assignModal, setAssignModal] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [newLead, setNewLead] = useState({
    name: '',
    phone: '',
    company: '',
    website: '',
    region: '',
    source: '',
    isSallaStore: false,
    dataQuality: 'normal' as LeadDataQuality,
    quantity: 0,
  });
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<ImportLeadRow[]>([]);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importType, setImportType] = useState<'salla' | 'software'>('software');
  const [importDataQuality, setImportDataQuality] = useState<LeadDataQuality>('normal');
  const [importProgress, setImportProgress] = useState(0);
  const [duplicateImportCount, setDuplicateImportCount] = useState(0);
  const [editingCustomerNumberId, setEditingCustomerNumberId] = useState<string | null>(null);
  const [editingCustomerNumber, setEditingCustomerNumber] = useState('');
  const [page, setPage] = useState(0);
  const [totalLeads, setTotalLeads] = useState(0); // after filters
  const [allCount, setAllCount] = useState(0); // all leads in the database
  const [unassignedCount, setUnassignedCount] = useState(0);
  const requestId = useRef(0);
  const pageSize = 100;

  async function loadData(nextPage = page, silent = false) {
    const reqId = ++requestId.current;
    if (!silent) setLoading(true);
    setErrorMsg('');

    let leadsQuery = supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }) // stable order so pages never overlap
      .range(nextPage * pageSize, (nextPage + 1) * pageSize - 1);

    const q = debouncedSearch.replace(/[%,()]/g, ' ').trim();
    if (q) leadsQuery = leadsQuery.or(`name.ilike.%${q}%,phone.ilike.%${q}%,company.ilike.%${q}%`);
    if (statusFilter) leadsQuery = leadsQuery.eq('status', statusFilter);
    if (regionFilter) leadsQuery = leadsQuery.eq('region', regionFilter);
    if (phoneFilter === 'missing') leadsQuery = leadsQuery.is('phone', null);
    if (phoneFilter === 'has') leadsQuery = leadsQuery.not('phone', 'is', null);
    if (typeFilter) leadsQuery = leadsQuery.eq('is_salla_store', typeFilter === 'salla');
    if (qualityFilter) leadsQuery = leadsQuery.eq('data_quality', qualityFilter);

    const [leadsRes, usersRes, allRes, unassignedRes] = await Promise.all([
      leadsQuery,
      supabase.from('users').select('*'),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).is('assigned_to', null),
    ]);

    if (reqId !== requestId.current) return; // a newer request replaced this one

    if (leadsRes.error) setErrorMsg(leadsRes.error.message);
    else {
      setLeads((leadsRes.data ?? []).map(mapLead));
      setTotalLeads(leadsRes.count ?? 0);
      setPage(nextPage);
    }
    if (usersRes.error) setErrorMsg(usersRes.error.message);
    else setUsers((usersRes.data ?? []).map(mapUser));
    setAllCount(allRes.count ?? 0);
    setUnassignedCount(unassignedRes.count ?? 0);
    setLoading(false);
    setFirstLoad(false);
  }

  // Wait 300ms after typing before querying the database
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setSelected([]);
    loadData(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, regionFilter, phoneFilter, typeFilter, qualityFilter]);

  useEffect(() => {
    if (!detailLead) return;
    setPhoneDraft(detailLead.phone ?? '');
    setPhoneMsg('');
    loadClientComments(detailLead.id).then(({ data }) => {
      setDetailLead(prev => (prev ? { ...prev, comments: data } : null));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailLead?.id]);

  // Live updates: when anyone changes a lead or a user, this page refreshes by itself
  useRealtimeRefresh(['leads', 'users'], () => loadData(page, true));

  const assignableUsers = users.filter(u => ['manager', 'telesales'].includes(u.role) && u.status === 'active');

  const toggleSelect = (id: string) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  const toggleAll = () => {
    if (selected.length === leads.length) setSelected([]);
    else setSelected(leads.map(l => l.id));
  };

  const handleAssign = async () => {
    if (!assignTo || selected.length === 0) return;
    const { error } = await supabase
      .from('leads')
      .update({ assigned_to: assignTo, status: 'Assigned' as LeadStatus, updated_at: new Date().toISOString() })
      .in('id', selected);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadData(page);
    setSelected([]);
    setAssignModal(false);
    setAssignTo('');
  };

  const handleDeleteSelected = async () => {
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected customer(s)?`)) return;
    setErrorMsg('');
    const batchSize = 500;
    for (let start = 0; start < selected.length; start += batchSize) {
      const { error } = await supabase.from('leads').delete().in('id', selected.slice(start, start + batchSize));
      if (error) {
        setErrorMsg(`Delete stopped after ${start} customers: ${error.message}`);
        return;
      }
    }
    setLeads(prev => prev.filter(lead => !selected.includes(lead.id)));
    setSelected([]);
    await loadData(page);
  };

  const saveCustomerNumber = async (leadId: string) => {
    const value = editingCustomerNumber.trim();
    const customerNumber = value ? parseCustomerNumber(value) : undefined;
    if (value && customerNumber === undefined) {
      setErrorMsg('Customer number must be a positive whole number.');
      setEditingCustomerNumberId(null);
      return;
    }
    const { error } = await supabase.rpc('set_lead_customer_number', {
      target_lead_id: leadId,
      new_customer_number: customerNumber ?? null,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setLeads(prev => prev.map(lead => (lead.id === leadId ? { ...lead, customerNumber } : lead)));
    setEditingCustomerNumberId(null);
  };

  const handleSavePhone = async () => {
    if (!detailLead) return;
    const phone = cleanPhone(phoneDraft);
    const { error } = await supabase
      .from('leads')
      .update({ phone: phone || null, updated_at: new Date().toISOString() })
      .eq('id', detailLead.id);
    if (error) {
      setPhoneMsg(error.message);
      return;
    }
    setPhoneDraft(phone);
    setDetailLead(prev => (prev ? { ...prev, phone } : null));
    setLeads(prev => prev.map(l => (l.id === detailLead.id ? { ...l, phone } : l)));
    setPhoneMsg('Saved');
  };

  const handleAddLead = async () => {
    if (!newLead.name) return;
    setErrorMsg('');
    const { data, error } = await supabase
      .from('leads')
      .upsert(
        {
          client_code: generateCode('CLT'),
          name: newLead.name,
          phone: cleanPhone(newLead.phone) || null,
          company: newLead.company || null,
          website: newLead.website || null,
          website_key: normalizeWebsite(newLead.website || '') || null,
          region: newLead.region || null,
          source: newLead.source || 'Manual',
          quantity: newLead.quantity,
          is_salla_store: newLead.isSallaStore,
          data_quality: newLead.dataQuality,
          status: 'New',
        },
        { onConflict: 'website_key', ignoreDuplicates: true }
      )
      .select('id');
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setErrorMsg('A lead with this website already exists, so nothing was added.');
      return;
    }
    await loadData(0);
    setNewLead({ name: '', phone: '', company: '', website: '', region: '', source: '', isSallaStore: false, dataQuality: 'normal', quantity: 0 });
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
    setDetailLead(prev => (prev ? { ...prev, comments: [...(prev.comments || []), data] } : null));
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
      const parsedRows: ImportLeadRow[] = rows
        .map(row => ({
          customerNumber: parseCustomerNumber(readImportValue(row, ['customer number', 'customer no', 'number', 'رقم العميل', 'الرقم'])),
          website: readImportValue(row, ['website', 'web site', 'site', 'url', 'رابط الموقع', 'الموقع']),
          quantity: parseQuantity(readImportValue(row, ['quantity', 'qty', 'الكمية'])),
          name: readImportValue(row, ['name', 'full name', 'client name', 'الاسم']),
          phone: cleanPhone(readImportValue(row, ['phone', 'phone number', 'mobile', 'رقم الهاتف'])),
          company: readImportValue(row, ['company', 'الشركة']),
          region: normalizeCountry(readImportValue(row, ['country', 'region', 'الدولة', 'المنطقة'])),
          source: readImportValue(row, ['source', 'المصدر']) || 'Excel Import',
          notes: readImportValue(row, ['notes', 'ملاحظات']),
        }))
        .filter(row => row.name); // phone is optional
      const seenWebsites = new Set<string>();
      const parsed = parsedRows.filter(row => {
        const websiteKey = normalizeWebsite(row.website || '');
        row.websiteKey = websiteKey;
        if (!websiteKey) return true;
        if (seenWebsites.has(websiteKey)) return false;
        seenWebsites.add(websiteKey);
        return true;
      });
      setDuplicateImportCount(parsedRows.length - parsed.length);
      if (!parsed.length) {
        setImportError('No valid rows found. Name is required.');
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
    setImportProgress(0);
    const batchSize = 500;
    let quantitySupported = true;

    // Rows are already de-duplicated by website when the file is read
    for (let start = 0; start < importRows.length; start += batchSize) {
      const batch = importRows.slice(start, start + batchSize).map(row => ({
        ...(row.customerNumber ? { customer_number: row.customerNumber } : {}),
        website: row.website || null,
        website_key: row.websiteKey || null,
        client_code: generateCode('CLT'),
        name: row.name,
        phone: row.phone || null,
        company: row.company || null,
        region: row.region || null,
        source: row.source,
        notes: row.notes || null,
        is_salla_store: importType === 'salla',
        data_quality: importDataQuality,
        ...(quantitySupported ? { quantity: row.quantity } : {}),
        status: 'New',
      }));
      let { error } = await supabase.from('leads').upsert(batch, { onConflict: 'website_key', ignoreDuplicates: true });
      if (error && quantitySupported && isMissingQuantityColumn(error)) {
        quantitySupported = false;
        const legacyBatch = batch.map(({ quantity: _quantity, ...row }) => row);
        const retry = await supabase.from('leads').upsert(legacyBatch, { onConflict: 'website_key', ignoreDuplicates: true });
        error = retry.error;
        if (!error) {
          setImportError('Import is continuing, but quantity is not being saved. Run supabase-setup.sql once to add the quantity column.');
        }
      }
      if (error) {
        setImportError(`Import stopped at row ${start + 1}: ${error.message}`);
        setImporting(false);
        return;
      }
      setImportProgress(Math.round(((start + batch.length) / importRows.length) * 90));
    }

    // Stores that already exist (same website) are skipped above, so fill their phone if it was empty
    const withPhone = importRows
      .filter(r => r.phone && r.websiteKey)
      .map(r => ({ website_key: r.websiteKey, phone: r.phone }));
    for (let start = 0; start < withPhone.length; start += batchSize) {
      const { error } = await supabase.rpc('fill_missing_phones', { rows: withPhone.slice(start, start + batchSize) });
      if (error) {
        setImportError(`Leads were imported, but updating phones of existing stores failed: ${error.message}`);
        setImporting(false);
        await loadData(0);
        return;
      }
    }

    setImportProgress(100);
    setImporting(false);
    await loadData(0);
    setImportFile(null);
    setImportRows([]);
    setImportProgress(0);
    setDuplicateImportCount(0);
    setImportModal(false);
  };

  if (firstLoad) {
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
          <p className="text-[#6b6b6b] text-sm mt-0.5">
            {allCount.toLocaleString()} total · {unassignedCount.toLocaleString()} unassigned
          </p>
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
        <Select value={regionFilter} onChange={setRegionFilter} options={REGION_OPTIONS} className="w-48" />
        <Select value={typeFilter} onChange={setTypeFilter} options={TYPE_FILTER_OPTIONS} className="w-36" />
        <Select value={qualityFilter} onChange={setQualityFilter} options={QUALITY_FILTER_OPTIONS} className="w-40" />
        <Select value={phoneFilter} onChange={setPhoneFilter} options={PHONE_FILTER_OPTIONS} className="w-36" />
        {selected.length > 0 && (
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => setAssignModal(true)}>Assign {selected.length} Selected</Button>
            <Button variant="danger" size="sm" onClick={handleDeleteSelected}>Delete {selected.length}</Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className={loading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
        <Card>
          <Table headers={['', 'No.', 'Quantity', 'Code', 'Name', 'Phone', 'Company', 'Website', 'Country', 'Salla', 'Quality', 'Status', 'Assigned To', 'Updated', '']}>
            <tr className="border-b border-[#262626]">
              <td className="py-3 px-4">
                <input
                  type="checkbox"
                  checked={selected.length === leads.length && leads.length > 0}
                  onChange={toggleAll}
                  className="accent-[#dfff03]"
                />
              </td>
              <td colSpan={14} className="py-3 px-2 text-[#6b6b6b] text-xs">
                {leads.length.toLocaleString()} shown of {totalLeads.toLocaleString()} records
              </td>
            </tr>
            {leads.map(lead => {
              const assignedUser = users.find(u => u.id === lead.assignedTo);
              return (
                <Tr key={lead.id} onClick={() => setDetailLead(lead)}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={selected.includes(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      onClick={e => e.stopPropagation()}
                      className="accent-[#dfff03]"
                    />
                  </Td>
                  <Td>
                    <div onDoubleClick={e => { e.stopPropagation(); setEditingCustomerNumberId(lead.id); setEditingCustomerNumber(String(lead.customerNumber ?? '')); }}>
                      {editingCustomerNumberId === lead.id ? (
                        <input
                          autoFocus
                          type="number"
                          min="1"
                          value={editingCustomerNumber}
                          onChange={e => setEditingCustomerNumber(e.target.value)}
                          onBlur={() => saveCustomerNumber(lead.id)}
                          onKeyDown={e => { if (e.key === 'Enter') saveCustomerNumber(lead.id); if (e.key === 'Escape') setEditingCustomerNumberId(null); }}
                          onClick={e => e.stopPropagation()}
                          className="w-24 bg-[#1a1a1a] border border-[#dfff03] rounded px-2 py-1 text-xs text-white focus:outline-none"
                        />
                      ) : (
                        <span className="font-mono text-xs text-[#a0a0a0] cursor-text">{lead.customerNumber ?? '—'}</span>
                      )}
                    </div>
                  </Td>
                  <Td><span className="font-mono text-xs text-[#a0a0a0]">{lead.quantity ?? 0}</span></Td>
                  <Td><span className="font-mono text-xs text-[#dfff03]">{lead.clientCode}</span></Td>
                  <Td><span className="font-medium text-white">{lead.name}</span></Td>
                  <Td>
                    {lead.phone ? (
                      <span className="font-mono text-xs">{lead.phone}</span>
                    ) : (
                      <span className="text-[#4a4a4a] text-xs">—</span>
                    )}
                  </Td>
                  <Td><span className="text-[#a0a0a0]">{lead.company || '—'}</span></Td>
                  <Td><span className="text-[#a0a0a0] text-xs truncate max-w-40 inline-block">{lead.website || '—'}</span></Td>
                  <Td><span className="text-[#a0a0a0]">{lead.region || '—'}</span></Td>
                  <Td>
                    <span className={lead.isSallaStore ? 'text-[#dfff03] text-xs' : 'text-[#6b6b6b] text-xs'}>
                      {lead.isSallaStore ? 'Yes' : 'No'}
                    </span>
                  </Td>
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
                    <button
                      className="text-[#4a4a4a] hover:text-[#dfff03] transition-colors"
                      onClick={e => {
                        e.stopPropagation();
                        setDetailLead(lead);
                      }}
                    >
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
          <Pagination
            page={page}
            pageSize={pageSize}
            total={totalLeads}
            onChange={nextPage => {
              setSelected([]);
              loadData(nextPage);
            }}
          />
        </Card>
      </div>

      {/* Lead Detail Modal */}
      <Modal open={!!detailLead} onClose={() => setDetailLead(null)} title="Lead Details">
        {detailLead && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Name', detailLead.name],
                ['Quantity', detailLead.quantity ?? 0],
                ['Company', detailLead.company || '—'],
                ['Website', detailLead.website || '—'],
                ['Country', detailLead.region || '—'],
                ['Source', detailLead.source || '—'],
                ['Salla Store', detailLead.isSallaStore ? 'Yes' : 'No'],
                ['Data Quality', detailLead.dataQuality],
                ['Created', detailLead.createdAt?.slice(0, 10)],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded-lg p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{k}</div>
                  <div className="text-white text-sm font-medium break-words">{v}</div>
                </div>
              ))}
            </div>

            {/* Phone (add or edit manually) */}
            <div className="bg-[#1a1a1a] rounded-lg p-3">
              <div className="text-[#6b6b6b] text-xs mb-1">Phone</div>
              <div className="flex gap-2">
                <input
                  value={phoneDraft}
                  onChange={e => { setPhoneDraft(e.target.value); setPhoneMsg(''); }}
                  placeholder="Add phone number"
                  className="flex-1 bg-[#111] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={cleanPhone(phoneDraft) === (detailLead.phone ?? '')}
                  onClick={handleSavePhone}
                >
                  Save
                </Button>
              </div>
              {phoneMsg && <p className="text-xs mt-1 text-[#a0a0a0]">{phoneMsg}</p>}
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
                {(detailLead.comments || []).map((comment: any) => (
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
              <Button variant="secondary" size="sm" className="mt-2" disabled={!commentText.trim()} onClick={handleAddComment}>
                Post Comment
              </Button>
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
                  <div className="text-[#6b6b6b] text-xs">
                    {u.role === 'manager' ? 'Manager' : 'Telesales'} · {assignedCount} leads currently assigned
                  </div>
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
            { label: 'Phone Number (optional)', key: 'phone', placeholder: '+971 50 000 0000' },
            { label: 'Company', key: 'company', placeholder: 'Company name' },
            { label: 'Website', key: 'website', placeholder: 'example.com' },
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
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Quantity</label>
            <input
              type="number"
              min="0"
              value={newLead.quantity}
              onChange={e => setNewLead(prev => ({ ...prev, quantity: parseQuantity(e.target.value) }))}
              placeholder="0"
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
            />
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Country</label>
            <select
              value={newLead.region}
              onChange={e => setNewLead(prev => ({ ...prev, region: e.target.value }))}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              {REGION_FORM_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Source</label>
            <input
              value={newLead.source}
              onChange={e => setNewLead(prev => ({ ...prev, source: e.target.value }))}
              placeholder="Referral, Website..."
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#d0d0d0]">
            <input
              type="checkbox"
              checked={newLead.isSallaStore}
              onChange={e => setNewLead(prev => ({ ...prev, isSallaStore: e.target.checked }))}
              className="accent-[#dfff03]"
            />
            Salla store
          </label>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Data Quality</label>
            <select
              value={newLead.dataQuality}
              onChange={e => setNewLead(prev => ({ ...prev, dataQuality: e.target.value as LeadDataQuality }))}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="normal">Normal</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="primary" disabled={!newLead.name} onClick={handleAddLead}>Add Lead</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importModal} onClose={() => setImportModal(false)} title="Import Leads from Excel">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-2">Client type for this import</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'software' as const, label: 'Software', description: 'Regular software client' },
                { value: 'salla' as const, label: 'Salla Store', description: 'Salla store client' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setImportType(option.value)}
                  className={`text-left rounded-lg border p-3 transition-colors ${importType === option.value ? 'border-[#dfff03] bg-[#dfff03]/5' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'}`}
                >
                  <div className="text-white text-sm font-medium">{option.label}</div>
                  <div className="text-[#6b6b6b] text-xs mt-1">{option.description}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Data quality for this import</label>
            <select
              value={importDataQuality}
              onChange={e => setImportDataQuality(e.target.value as LeadDataQuality)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              <option value="high">Strong (قوية)</option>
              <option value="medium">Medium (متوسطة)</option>
              <option value="normal">Normal (عادية)</option>
            </select>
          </div>
          <label className="block border-2 border-dashed border-[#2a2a2a] rounded-lg p-8 text-center hover:border-[#dfff03]/30 transition-colors cursor-pointer">
            <svg className="w-10 h-10 text-[#4a4a4a] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <p className="text-[#a0a0a0] text-sm">{importFile?.name || 'Choose an Excel or CSV file'}</p>
            <p className="text-[#4a4a4a] text-xs mt-1">.xlsx, .xls, .csv supported</p>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => handleImportFile(e.target.files?.[0])} />
          </label>
          {importRows.length > 0 && (
            <p className="text-[#dfff03] text-xs">
              {importRows.length.toLocaleString()} valid rows ready to import
              {' · '}
              {importRows.filter(r => r.phone).length.toLocaleString()} with a phone number.
            </p>
          )}
          {duplicateImportCount > 0 && <p className="text-[#ffc832] text-xs">{duplicateImportCount.toLocaleString()} duplicate website rows were skipped automatically.</p>}
          {importing && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[#a0a0a0]"><span>Uploading customers</span><span>{importProgress}%</span></div>
              <div className="h-1.5 bg-[#262626] rounded-full overflow-hidden"><div className="h-full bg-[#dfff03] transition-all" style={{ width: `${importProgress}%` }} /></div>
            </div>
          )}
          {importRows.length > 0 && (
            <div className="bg-[#dfff03]/5 border border-[#dfff03]/20 rounded-lg p-3 text-xs">
              <div className="text-white font-medium">Import settings</div>
              <div className="text-[#a0a0a0] mt-1">
                Type: <span className="text-[#dfff03]">{importType === 'salla' ? 'Salla Store' : 'Software'}</span>
                {' · '}
                Data quality:{' '}
                <span className="text-[#dfff03]">
                  {importDataQuality === 'high' ? 'Strong' : importDataQuality === 'medium' ? 'Medium' : 'Normal'}
                </span>
              </div>
              <div className="text-[#6b6b6b] mt-1">These settings will be applied to all imported customers.</div>
            </div>
          )}
          {importError && <p className="text-[#ff6464] text-xs">{importError}</p>}
          <div className="bg-[#1a1a1a] rounded-lg p-3 text-xs text-[#6b6b6b]">
            <p className="font-medium text-[#a0a0a0] mb-1">Expected columns:</p>
            <p>Customer Number (optional) · Website (optional) · Quantity · Name (required) · Phone (optional) · Company · Country · Source · Notes</p>
            <p className="mt-1">If two rows use the same website, only the first row is imported.</p>
            <p className="mt-1">If a store already exists without a phone and the sheet has one, the phone is added to it.</p>
            <p className="mt-1 text-[#dfff03]">The selected client type and data quality above apply to every imported row.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!importRows.length || importing} onClick={handleImport}>
              {importing ? 'Importing...' : 'Import Leads'}
            </Button>
            <Button variant="ghost" onClick={() => setImportModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function isMissingQuantityColumn(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /quantity.*column|column.*quantity|schema cache/i.test(error.message));
}