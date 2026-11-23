import { TableSkeleton } from '../shared/motion';
import { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../supabaseClient';
import { recordActivity } from '../../data/activityLog';
import { createNotification } from '../../data/notifications';
import { generateCode, Lead, LeadDataQuality, LeadStatus, User } from '../../data/mockData';
import { Button, RoleBadge, SearchInput, Select, StatusBadge, Table, Td, Tr, Modal, Card, Pagination, WebsiteLink, EmptyState, useConfirm } from '../ui';
import { toast } from '../shared/toast';
import { useMyContacts } from '../../hooks/useMyContacts';
import { CONTACT_FILTER_OPTIONS, ContactedToggle } from '../shared/Contacted';
import { usePersistentState } from '../../hooks/usePersistentState';
import { EditablePhoneCell, WebsiteStatusToggle } from '../shared/LeadRowControls';
import { exportRowsToExcel } from '../shared/exportExcel';
import { SelectFirstN, fetchAllPages, fetchLeadsByIds } from '../shared/LeadSelection';
import DistributeLeadsModal, { QUALITY_FILTER_OPTIONS, REGION_OPTIONS } from '../shared/DistributeLeadsModal';
import AutoDistributionCard from './AutoDistributionCard';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useI18n } from '../../i18n/I18nProvider';
import { normalizeWebsite } from '../../lib/websiteKey';
import {
  analyzeMatrix, buildImportRows, countRows, hasPhoneLikeColumn, rowValues, sheetToMatrix,
  parseCustomerNumber, parseQuantity, IMPORT_FIELDS, IMPORT_FIELD_LABELS,
  type ColumnMapping, type ImportField, type ImportLeadRow, type SheetAnalysis,
} from '../../lib/smartImport';
import { useLeadCard } from '../shared/AppOverlays';
import WebsiteChecks, { WEBSITE_REASON_FILTER_OPTIONS, WEBSITE_STATUS_FILTER_OPTIONS, websiteCategoryLabel } from '../shared/WebsiteChecks';
import WhatsAppButton from '../shared/WhatsAppButton';
import { usePermissions } from '../../hooks/usePermissions';
import { BulkLeadTypesModal, LeadTypeBadges, LeadTypeChecklist, LeadTypeFilter, LeadTypesManagerModal, applyLeadTypeFilter, useLeadTypeLabel, useLeadTypes } from '../shared/LeadTypes';

const HISTORY_FILTER_OPTIONS = [
  { value: '', label: 'All clients' },
  { value: 'previous', label: 'Previously distributed' },
  { value: 'fresh', label: 'Brand new' },
];

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

// Keeps digits and a leading +. A dash or empty cell becomes '' (no phone).
function cleanPhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

// Same as public.phone_key() on the server: the last 9 digits
function phoneKeyOf(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-9);
}

// A row that was not imported, as it goes into the "skipped rows" Excel file
type SkippedRow = { line: number; reason: string } & Record<string, string | number>;
function skippedRow(row: ImportLeadRow, reason: string): SkippedRow {
  return { line: row.line, reason, ...rowValues(row) };
}

interface ImportReport {
  added: number;
  filled: number;     // stores that existed without a phone and got the phone from the file
  ignored: number;    // existing website, phone used by another client, or dropped in the file
  skippedRows: SkippedRow[];
}

function mapLead(row: any): Lead {
  return {
    id: row.id,
    customerNumber: row.customer_number ?? undefined,
    website: row.website ?? undefined,
    websiteStatus: row.website_status ?? undefined,
    websiteStatusSource: row.website_status_source ?? undefined,
    websiteCheckCategory: row.website_check_category ?? undefined,
    phoneSource: row.phone_source ?? undefined,
    quantity: row.quantity ?? 0,
    clientCode: row.client_code,
    name: row.name,
    phone: row.phone ?? '',
    company: row.company ?? undefined,
    region: row.region ?? undefined,
    source: row.source ?? undefined,
    isSallaStore: row.is_salla_store ?? false,
    leadTypes: Array.isArray(row.lead_types) ? row.lead_types : [],
    tag: row.tag ?? undefined,
    contactedAt: row.contacted_at ?? undefined,
    contactedBy: row.contacted_by ?? undefined,
    wasDistributed: row.was_distributed ?? false,
    releasedAt: row.released_at ?? undefined,
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

export default function AdminLeads({ userId: myId }: { userId: string }) {
  const { t } = useI18n();
  const openLead = useLeadCard();
  const { can } = usePermissions();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  // Search + filters are remembered for this browser tab, so coming back to the page keeps them
  const [search, setSearch] = usePersistentState('leads.search', '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [statusFilter, setStatusFilter] = usePersistentState('leads.status', '');
  const [regionFilter, setRegionFilter] = usePersistentState('leads.region', '');
  const [phoneFilter, setPhoneFilter] = usePersistentState('leads.phone', '');
  // Client types (lead_types text[]): any of the chosen (overlaps) or all of them together (contains)
  const [typeFilter, setTypeFilter] = usePersistentState<string[]>('leads.types', []);
  const [typeMatchAll, setTypeMatchAll] = usePersistentState('leads.typesMatchAll', false);
  const { types: leadTypes, error: leadTypesError, reload: reloadLeadTypes } = useLeadTypes();
  const typeLabel = useLeadTypeLabel(leadTypes);
  const [bulkTypesModal, setBulkTypesModal] = useState(false);
  const [typesManager, setTypesManager] = useState(false);
  const [qualityFilter, setQualityFilter] = usePersistentState('leads.quality', '');
  const [assignmentFilter, setAssignmentFilter] = usePersistentState('leads.assignment', '');
  const [websiteFilter, setWebsiteFilter] = usePersistentState('leads.website', '');
  const [websiteReasonFilter, setWebsiteReasonFilter] = usePersistentState('leads.websiteReason', '');
  const [historyFilter, setHistoryFilter] = usePersistentState('leads.history', '');
  // Tag (064): set in Lead discovery; '__none__' = clients without a tag
  const [tagFilter, setTagFilter] = usePersistentState('leads.tag', '');
  // "تواصلت" (070): '' | 'yes' | 'no' — contacted by anyone
  const [contactFilter, setContactFilter] = usePersistentState('leads.contacted', '');
  const [tagOptions, setTagOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    void supabase.rpc('discovery_tags').then(({ data, error }) => {
      if (error) return; // 064 not run yet: no tag filter options
      setTagOptions(((data ?? []) as { tag: string; leads: number }[]).filter(r => r.tag && r.leads > 0)
        .map(r => ({ value: r.tag, label: `${r.tag} (${r.leads})` })));
    });
  }, []);
  const hasFilters = !!(search.trim() || statusFilter || regionFilter || phoneFilter || typeFilter.length || qualityFilter || assignmentFilter || websiteFilter || websiteReasonFilter || historyFilter || tagFilter || contactFilter);
  const clearFilters = () => {
    setSearch(''); setStatusFilter(''); setRegionFilter(''); setPhoneFilter(''); setTypeFilter([]);
    setQualityFilter(''); setAssignmentFilter(''); setWebsiteFilter(''); setWebsiteReasonFilter(''); setHistoryFilter(''); setTagFilter(''); setContactFilter('');
  };
  const { confirm, confirmUi } = useConfirm();
  const [showWebsiteChecks, setShowWebsiteChecks] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignModal, setAssignModal] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [distributeModal, setDistributeModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [newLead, setNewLead] = useState({
    name: '',
    phone: '',
    company: '',
    website: '',
    region: '',
    source: '',
    leadTypes: ['custom'] as string[],
    dataQuality: 'normal' as LeadDataQuality,
    quantity: 0,
  });
  const [importModal, setImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  // Smart import: every sheet of the file as text, the analysis of the chosen one, and the column mapping
  // the user can correct in the review table. The rows to upload are derived from these.
  const [importSheets, setImportSheets] = useState<{ name: string; matrix: string[][] }[]>([]);
  const [importSheet, setImportSheet] = useState('');
  const [importAnalysis, setImportAnalysis] = useState<SheetAnalysis | null>(null);
  const [importMapping, setImportMapping] = useState<ColumnMapping>({});
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  // Which save is in flight, so its button is disabled and double clicks are ignored.
  const [busy, setBusy] = useState<'' | 'assign' | 'delete' | 'phone' | 'addLead' | 'comment'>('');
  const runBusy = async (key: Exclude<typeof busy, ''>, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy('');
    }
  };
  // Types given to every imported client (nothing chosen = custom)
  const [importTypes, setImportTypes] = useState<string[]>(['custom']);
  const [importDataQuality, setImportDataQuality] = useState<LeadDataQuality>('normal');
  const [importProgress, setImportProgress] = useState(0);

  // Rows ready to upload + rows dropped in the browser (no name, or the same website / phone twice in the file)
  const importParsed = useMemo(() => {
    if (!importAnalysis) return { rows: [] as ImportLeadRow[], rejected: [] as SkippedRow[], total: 0 };
    const { rows: built, rejected } = buildImportRows(importAnalysis.dataRows, importMapping, importAnalysis.firstLine);
    const skipped: SkippedRow[] = rejected.map(r => ({ line: r.line, reason: r.reason, ...r.values }));
    const seenWebsites = new Set<string>();
    const seenPhones = new Set<string>();
    const rows = built.filter(row => {
      const websiteKey = normalizeWebsite(row.website || '');
      row.websiteKey = websiteKey;
      const phoneKey = (row.phone || '').replace(/\D/g, '').slice(-9);
      if (websiteKey && seenWebsites.has(websiteKey)) { skipped.push(skippedRow(row, 'Same website twice in the file')); return false; }
      if (phoneKey.length >= 7 && seenPhones.has(phoneKey)) { skipped.push(skippedRow(row, 'Same phone twice in the file')); return false; }
      if (websiteKey) seenWebsites.add(websiteKey);
      if (phoneKey.length >= 7) seenPhones.add(phoneKey);
      return true;
    });
    return { rows, rejected: skipped, total: built.length + rejected.length };
  }, [importAnalysis, importMapping]);
  const importRows = importParsed.rows;
  const [editingCustomerNumberId, setEditingCustomerNumberId] = useState<string | null>(null);
  const [editingCustomerNumber, setEditingCustomerNumber] = useState('');
  const [page, setPage] = useState(0);
  const [totalLeads, setTotalLeads] = useState<number | null>(0); // after filters (null = count unavailable)
  const [allCount, setAllCount] = useState<number | null>(null); // all leads in the database
  const [unassignedCount, setUnassignedCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);
  const pageSize = 100;

  /** Website status / check reason (033) and distribution history (066) filters, shared by the list and the Excel export. */
  function applyWebsiteFilters<Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null | boolean) => Q; not: (c: string, op: string, v: null | boolean) => Q }>(query: Q): Q {
    let q = query;
    if (websiteFilter === 'working' || websiteFilter === 'not_working') q = q.eq('website_status', websiteFilter);
    if (websiteFilter === 'unchecked') q = q.not('website', 'is', null).is('website_checked_at', null).is('website_status', null);
    if (websiteReasonFilter) q = q.eq('website_check_category', websiteReasonFilter);
    // 066: was_distributed = the lead came back after its telesales was deleted
    if (historyFilter === 'previous') q = q.is('was_distributed', true);
    if (historyFilter === 'fresh') q = q.not('was_distributed', 'is', true);
    return q;
  }

  /** Every list filter (search, status, …, assignment). Shared by the list, the Excel export and "Select first N". */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyListFilters(query: any, managerIds: string[]) {
    let q = query;
    const s = debouncedSearch.replace(/[%,()]/g, ' ').trim();
    if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,company.ilike.%${s}%`);
    if (statusFilter) q = q.eq('status', statusFilter);
    if (regionFilter) q = q.eq('region', regionFilter);
    if (phoneFilter === 'missing') q = q.is('phone', null);
    if (phoneFilter === 'has') q = q.not('phone', 'is', null);
    q = applyLeadTypeFilter(q, typeFilter, typeMatchAll);
    if (tagFilter === '__none__') q = q.is('tag', null);
    else if (tagFilter) q = q.eq('tag', tagFilter);
    if (contactFilter === 'yes') q = q.not('contacted_at', 'is', null);
    if (contactFilter === 'no') q = q.is('contacted_at', null);
    if (qualityFilter) q = q.eq('data_quality', qualityFilter);
    q = applyWebsiteFilters(q);
    if (assignmentFilter === 'manager') q = managerIds.length ? q.in('assigned_to', managerIds) : q.eq('id', '00000000-0000-0000-0000-000000000000');
    if (assignmentFilter === 'unassigned') q = q.is('assigned_to', null);
    return q;
  }

  async function loadData(nextPage = page, silent = false) {
    const reqId = ++requestId.current;
    if (!silent) setLoading(true);
    setErrorMsg('');

    const { data: userRows, error: usersError } = await supabase.from('users').select('*');
    const loadedUsers = (userRows ?? []).map(mapUser);
    const managerIds = loadedUsers.filter(user => user.role === 'manager').map(user => user.id);

    const q = debouncedSearch.replace(/[%,()]/g, ' ').trim();
    const otherFilters = Boolean(q || statusFilter || regionFilter || phoneFilter || typeFilter.length || qualityFilter || websiteFilter || websiteReasonFilter || historyFilter || tagFilter || contactFilter);
    // With no filters (or only "Not distributed") the total comes from get_leads_counts, so skip the slow count.
    const countFromRpc = !otherFilters && (assignmentFilter === '' || assignmentFilter === 'unassigned');

    const leadsQuery = applyListFilters(supabase
      .from('leads')
      .select('*', countFromRpc ? undefined : { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }) // stable order so pages never overlap
      .range(nextPage * pageSize, (nextPage + 1) * pageSize - 1), managerIds);

    const [leadsRes, countsRes] = await Promise.all([
      leadsQuery as PromiseLike<{ data: any[] | null; error: { message: string } | null; count: number | null }>,
      supabase.rpc('get_leads_counts'),
    ]);

    if (reqId !== requestId.current) return; // a newer request replaced this one

    // Exact counts only: never show an estimate (RLS makes planner estimates far off).
    const counts = countsRes.error ? null : (countsRes.data as { total: number; unassigned: number }[] | null)?.[0] ?? null;
    if (countsRes.error) setErrorMsg(countsRes.error.message);
    setAllCount(counts ? Number(counts.total) : null);
    setUnassignedCount(counts ? Number(counts.unassigned) : null);

    if (leadsRes.error) setErrorMsg(leadsRes.error.message);
    else {
      setLeads((leadsRes.data ?? []).map(mapLead));
      setTotalLeads(countFromRpc
        ? counts ? Number(assignmentFilter === 'unassigned' ? counts.unassigned : counts.total) : null
        : leadsRes.count ?? 0);
      setPage(nextPage);
    }
    if (usersError) setErrorMsg(usersError.message);
    else setUsers(loadedUsers);
    setLoading(false);
    setFirstLoad(false);
  }

  // Wait 300ms after typing before querying the database
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // The selection survives filter and page changes; only "Clear selection" (or a bulk action) empties it.
  useEffect(() => {
    loadData(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, regionFilter, phoneFilter, typeFilter.join(','), typeMatchAll, qualityFilter, assignmentFilter, websiteFilter, websiteReasonFilter, historyFilter, tagFilter, contactFilter]);

  // Live updates: when anyone changes a lead or a user, this page refreshes by itself
  useRealtimeRefresh(['leads', 'users'], () => loadData(page, true));

  // Recipients: telesales, managers and admins (they work their own queue too)
  const { contacted: myContacts, toggle: toggleContact } = useMyContacts(myId, leads.map(l => l.id));
  const assignableUsers = users.filter(u => ['telesales', 'sales_telesales', 'manager', 'admin'].includes(u.role) && u.status === 'active');
  const recipientAgents = assignableUsers.map(u => ({ id: u.id, fullName: u.fullName, role: u.role }));

  const toggleSelect = (id: string) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };
  // Header checkbox: current page only; other pages' selections stay.
  const allOnPage = leads.length > 0 && leads.every(l => selected.includes(l.id));
  const toggleAll = () => {
    const pageIds = new Set(leads.map(l => l.id));
    setSelected(prev => (allOnPage ? prev.filter(id => !pageIds.has(id)) : [...new Set([...prev, ...pageIds])]));
  };

  const handleAssign = async () => {
    if (!assignTo || selected.length === 0) return;
    const { error } = await supabase.rpc('assign_leads', { p_lead_ids: selected, p_assignee: assignTo });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const assignee = users.find(user => user.id === assignTo);
    // Show the new owner right away; the reload below brings the final data
    const moved = new Set(selected);
    setLeads(prev => prev.map(l => (moved.has(l.id) ? { ...l, assignedTo: assignTo, status: 'Assigned' as LeadStatus } : l)));
    toast(t('Assigned {n} clients to {name}', { n: selected.length, name: assignee?.fullName ?? '' }));
    const authUserId = myId;
    const admin = (await supabase.from('users').select('full_name').eq('id', authUserId).maybeSingle()).data;
    await Promise.all(selected.map(leadId => recordActivity({
      leadId,
      actorId: authUserId,
      actorName: admin?.full_name || 'Admin',
      actorRole: 'admin',
      activityType: 'assignment',
      outcome: 'Assigned',
      notes: `Assigned to ${assignee?.fullName || 'team member'}`,
    })));
    await createNotification(assignTo, 'New leads assigned', `${selected.length} client(s) were assigned to you.`);
    await loadData(page);
    setSelected([]);
    setAssignModal(false);
    setAssignTo('');
  };

  const handleDeleteSelected = async () => {
    if (!selected.length) return;
    const ok = await confirm({ title: 'Delete clients', message: t('Delete {n} selected customer(s)?', { n: selected.length }), confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setErrorMsg('');
    const batchSize = 500;
    for (let start = 0; start < selected.length; start += batchSize) {
      const { error } = await supabase.from('leads').delete().in('id', selected.slice(start, start + batchSize));
      if (error) {
        setErrorMsg(t('Delete stopped after {n} customers: {msg}', { n: start, msg: error.message }));
        return;
      }
    }
    const deleted = selected.length;
    setLeads(prev => prev.filter(lead => !selected.includes(lead.id)));
    setSelected([]);
    toast(t('Deleted {n} clients', { n: deleted }));
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

  const saveInlinePhone = async (lead: Lead, value: string) => {
    const phone = cleanPhone(value);
    const { error } = await supabase.from('leads').update({
      phone: phone || null,
      phone_source: phone ? 'manual' : null,
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id);
    if (error) {
      setErrorMsg(error.message);
      throw new Error(error.message);
    }
    setLeads(prev => prev.map(item => item.id === lead.id ? { ...item, phone, phoneSource: phone ? 'manual' : undefined } : item));
  };

  const toggleWebsiteStatus = async (lead: Lead, nextStatus: 'working' | 'not_working') => {
    setLeads(prev => prev.map(item => item.id === lead.id ? { ...item, websiteStatus: nextStatus, websiteStatusSource: 'manual' } : item));
    const { error } = await supabase.from('leads').update({ website_status: nextStatus, website_status_source: 'manual', updated_at: new Date().toISOString() }).eq('id', lead.id);
    if (error) {
      setLeads(prev => prev.map(item => item.id === lead.id ? { ...item, websiteStatus: lead.websiteStatus, websiteStatusSource: lead.websiteStatusSource } : item));
      setErrorMsg(error.message);
      throw new Error(error.message);
    }
  };

  /** Current filters, newest first — same conditions as the list. */
  const filteredLeadsQuery = (columns: string) => applyListFilters(
    supabase.from('leads').select(columns).order('created_at', { ascending: false }).order('id', { ascending: false }),
    users.filter(user => user.role === 'manager').map(user => user.id),
  );

  /** "Select first N": ids of the first n clients of the current filters. */
  const selectFirstN = async (n: number) => {
    setErrorMsg('');
    try {
      const rows = await fetchAllPages((from, to) => filteredLeadsQuery('id').range(from, to), n);
      setSelected(rows.map(row => row.id as string));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not select clients.');
    }
  };

  const exportLeads = async () => {
    setExporting(true);
    setErrorMsg('');
    try {
      // Selected clients only (the selection is the reference, filters are ignored); otherwise every filter result
      const data = selected.length > 0
        ? await fetchLeadsByIds(selected)
        : await fetchAllPages((from, to) => filteredLeadsQuery('*').range(from, to));
      const assignedNames = new Map(users.map(user => [user.id, user.fullName]));
      exportRowsToExcel((data ?? []).map(row => ({
        CODE: row.client_code,
        NAME: row.name,
        PHONE: row.phone ?? '',
        WEBSITE: row.website ?? '',
        TYPES: (Array.isArray(row.lead_types) ? row.lead_types as string[] : []).map(typeLabel).join('، '),
        SALLA: row.is_salla_store ? 'Yes' : 'No',
        TAG: row.tag ?? '',
        CONTACTED: row.contacted_at ? String(row.contacted_at).slice(0, 10) : '',
        QUALITY: row.data_quality ?? '',
        STATUS: row.status ?? '',
        'WEBSITE STATUS': row.website_status === 'working' ? 'Working' : row.website_status === 'not_working' ? 'Not Working' : 'Not Checked',
        'ASSIGNED TO': row.assigned_to ? assignedNames.get(row.assigned_to) ?? '' : 'Unassigned',
        UPDATED: row.updated_at ? String(row.updated_at).slice(0, 10) : '',
      })), 'leads-export');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not export leads.');
    } finally {
      setExporting(false);
    }
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
          phone_source: cleanPhone(newLead.phone) ? 'manual' : null,
          company: newLead.company || null,
          website: newLead.website || null,
          website_key: normalizeWebsite(newLead.website || '') || null,
          region: newLead.region || null,
          source: newLead.source || 'Manual',
          quantity: newLead.quantity,
          lead_types: newLead.leadTypes.length ? newLead.leadTypes : ['custom'],
          is_salla_store: newLead.leadTypes.includes('salla'),
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
    void reloadLeadTypes();
    setNewLead({ name: '', phone: '', company: '', website: '', region: '', source: '', leadTypes: ['custom'], dataQuality: 'normal', quantity: 0 });
    setAddModal(false);
  };

  const resetImport = () => {
    setImportFile(null);
    setImportSheets([]);
    setImportSheet('');
    setImportAnalysis(null);
    setImportMapping({});
    setImportReport(null);
    setImportProgress(0);
    setImportError('');
  };

  // Analyses one sheet: header row, then which column is which field (the user can correct it after)
  const chooseImportSheet = (sheets: { name: string; matrix: string[][] }[], name: string) => {
    const sheet = sheets.find(s => s.name === name);
    setImportSheet(name);
    setImportReport(null);
    if (!sheet || !countRows(sheet.matrix)) {
      setImportAnalysis(null);
      setImportMapping({});
      setImportError('This sheet is empty.');
      return;
    }
    const analysis = analyzeMatrix(sheet.matrix);
    setImportAnalysis(analysis);
    setImportMapping(analysis.mapping);
    setImportError('');
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    resetImport();
    setImportFile(file);
    try {
      // raw: CSV cells stay as written (0533… keeps its 0). Excel cells are turned to text by sheetToMatrix,
      // which writes long numbers in full (966533672708, not 9.66534E+11).
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
      const sheets = workbook.SheetNames.map(name => ({ name, matrix: sheetToMatrix(workbook.Sheets[name], XLSX.utils) }));
      setImportSheets(sheets);
      // the sheet with the most rows is the one with the clients
      const biggest = sheets.reduce((best, s) => (countRows(s.matrix) > countRows(best.matrix) ? s : best), sheets[0]);
      chooseImportSheet(sheets, biggest?.name ?? '');
    } catch {
      setImportError('Could not read this file. Use .xlsx, .xls, or .csv.');
      setImportSheets([]);
      setImportAnalysis(null);
      setImportMapping({});
    }
  };

  // One column per field: giving a column to a field takes it away from the field that had it
  const setImportColumn = (field: ImportField, column: number | undefined) => {
    setImportMapping(prev => {
      const next: ColumnMapping = { ...prev };
      if (column !== undefined) {
        for (const f of IMPORT_FIELDS) if (next[f] === column) delete next[f];
        next[field] = column;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  // Which rows of a batch import_leads will skip: website already in the system, phone used by another
  // client, or customer number taken. Only used to list the skipped rows; the server is what decides.
  const findExisting = async (batch: ImportLeadRow[]) => {
    const sites = new Map<string, string>(); // website_key → phone of the existing client ('' = none)
    const phones = new Set<string>();
    const numbers = new Set<number>();
    const chunks = <T,>(list: T[]) => {
      const out: T[][] = [];
      for (let i = 0; i < list.length; i += 100) out.push(list.slice(i, i + 100));
      return out;
    };
    const keys = [...new Set(batch.map(r => r.websiteKey || '').filter(Boolean))];
    const phoneKeys = [...new Set(batch.map(r => phoneKeyOf(r.phone)).filter(Boolean))];
    const custNumbers = [...new Set(batch.map(r => r.customerNumber ?? 0).filter(Boolean))];
    const fail = (error: unknown) => { if (error) throw error; };
    await Promise.all([
      ...chunks(keys).map(async list => {
        const { data, error } = await supabase.from('leads').select('website_key, phone').in('website_key', list);
        fail(error);
        data?.forEach(d => sites.set(d.website_key, d.phone ?? ''));
      }),
      ...chunks(phoneKeys).map(async list => {
        const { data, error } = await supabase.from('leads').select('phone_key').in('phone_key', list);
        fail(error);
        data?.forEach(d => phones.add(d.phone_key));
      }),
      ...chunks(custNumbers).map(async list => {
        const { data, error } = await supabase.from('leads').select('customer_number').in('customer_number', list);
        fail(error);
        data?.forEach(d => numbers.add(Number(d.customer_number)));
      }),
    ]);
    return { sites, phones, numbers };
  };

  const handleImport = async () => {
    if (!importRows.length || importMapping.name === undefined) return;
    setImporting(true);
    setImportError('');
    setImportProgress(0);
    const batchSize = 500;
    let added = 0;
    let skipped = 0;
    let listComplete = true;
    const skippedRows: SkippedRow[] = [...importParsed.rejected];
    const chosenImportTypes = importTypes.length ? importTypes : ['custom'];

    // import_leads (019) inserts on the server and skips any row that already exists:
    // same website, same phone, or same customer number. One duplicate never stops the import.
    for (let start = 0; start < importRows.length; start += batchSize) {
      const rows = importRows.slice(start, start + batchSize);
      const existing = await findExisting(rows).catch(() => null);
      const batch = rows.map(row => ({
        ...(row.customerNumber ? { customer_number: row.customerNumber } : {}),
        website: row.website || null,
        website_key: row.websiteKey || null,
        name: row.name,
        phone: row.phone || null,
        company: row.company || null,
        region: row.region || null,
        source: row.source,
        notes: row.notes || null,
        quantity: row.quantity || 0,
      }));
      const { data, error } = await supabase.rpc('import_leads', {
        p_rows: batch, p_is_salla: chosenImportTypes.includes('salla'), p_data_quality: importDataQuality,
        p_types: chosenImportTypes,
      });
      if (error) {
        setImportError(t('Import stopped at row {n}: {msg}', { n: rows[0]?.line ?? start + 1, msg: error.message }));
        setImporting(false);
        if (added) await loadData(0);
        return;
      }
      const res = (Array.isArray(data) ? data[0] : data) as { inserted?: number; skipped?: number } | null;
      added += Number(res?.inserted ?? 0);
      skipped += Number(res?.skipped ?? 0);
      if (!existing) listComplete = false;
      else for (const row of rows) {
        const sitePhone = row.websiteKey ? existing.sites.get(row.websiteKey) : undefined;
        const phoneTaken = !!row.phone && existing.phones.has(phoneKeyOf(row.phone));
        if (sitePhone !== undefined) {
          // an existing store without a phone gets the phone below, so it is not "ignored"
          if (sitePhone || !row.phone || phoneTaken) skippedRows.push(skippedRow(row, 'Website already in the system'));
        } else if (phoneTaken) {
          skippedRows.push(skippedRow(row, 'Phone already used by another client'));
        } else if (row.customerNumber && existing.numbers.has(row.customerNumber)) {
          skippedRows.push(skippedRow(row, 'Customer number already used'));
        }
      }
      setImportProgress(Math.round(((start + rows.length) / importRows.length) * 90));
    }

    // Stores that already exist (same website) are skipped above, so fill their phone if it was empty
    let filled = 0;
    const withPhone = importRows
      .filter(r => r.phone && r.websiteKey)
      .map(r => ({ website_key: r.websiteKey, phone: r.phone }));
    for (let start = 0; start < withPhone.length; start += batchSize) {
      const { data, error } = await supabase.rpc('fill_missing_phones', { rows: withPhone.slice(start, start + batchSize) });
      if (error) {
        setImportError(t('Leads were imported, but updating phones of existing stores failed: {msg}', { msg: error.message }));
        setImporting(false);
        await loadData(0);
        return;
      }
      filled += Number(data ?? 0);
    }

    setImportProgress(100);
    setImporting(false);
    skippedRows.sort((a, b) => a.line - b.line);
    setImportReport({
      added,
      filled,
      ignored: Math.max(0, skipped - filled) + importParsed.rejected.length,
      skippedRows: listComplete ? skippedRows : importParsed.rejected,
    });
    await loadData(0);
    void reloadLeadTypes();
  };

  const downloadSkippedRows = () => {
    if (!importReport?.skippedRows.length) return;
    exportRowsToExcel(
      importReport.skippedRows.map(({ line, reason, ...rest }) => ({ [t('Row')]: line, [t('Reason')]: t(reason), ...rest })),
      'skipped-import-rows',
    );
  };

  if (firstLoad) {
    return <div className="p-6 text-[#a0a0a0] text-sm"><TableSkeleton /></div>;
  }

  return (
    <div className="p-6 space-y-4">
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3 anim-banner">
          {t(errorMsg)}
        </div>
      )}
      {leadTypesError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3 anim-banner">
          {t('Could not load client types: {msg}', { msg: leadTypesError })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{t('Leads')}</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">
            {t('{a} total · {b} unassigned', { a: formatCount(allCount), b: formatCount(unassignedCount) })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setTypesManager(true)}>{t('Client types')}</Button>
          <Button variant="secondary" size="sm" onClick={() => setImportModal(true)}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {t('Import Excel')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>
            {t('+ Add Lead')}
          </Button>
        </div>
      </div>

      {can('leads.distribute') && (
        <AutoDistributionCard
          agents={recipientAgents}
          onDistributed={() => { setSelected([]); void loadData(0); }}
        />
      )}

      <div>
        <Button variant="secondary" size="sm" onClick={() => setShowWebsiteChecks(v => !v)}>
          {showWebsiteChecks ? t('Hide website checks') : t('Website checks')}
        </Button>
        {showWebsiteChecks && <div className="mt-3"><WebsiteChecks canRun /></div>}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, company..." />
        <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} className="w-40" />
        <Select value={regionFilter} onChange={setRegionFilter} options={REGION_OPTIONS} className="w-48" />
        <LeadTypeFilter types={leadTypes} value={typeFilter} onChange={setTypeFilter} matchAll={typeMatchAll} onMatchAllChange={setTypeMatchAll} />
        <Select value={contactFilter} onChange={setContactFilter} options={CONTACT_FILTER_OPTIONS} className="w-44" />
        {(tagOptions.length > 0 || tagFilter) && (
          <Select value={tagFilter} onChange={setTagFilter} className="w-44"
            options={[{ value: '', label: 'All tags' }, { value: '__none__', label: 'No tag' }, ...tagOptions]} />
        )}
        <Select value={qualityFilter} onChange={setQualityFilter} options={QUALITY_FILTER_OPTIONS} className="w-40" />
        <Select value={phoneFilter} onChange={setPhoneFilter} options={PHONE_FILTER_OPTIONS} className="w-36" />
        <Select value={websiteFilter} onChange={setWebsiteFilter} options={WEBSITE_STATUS_FILTER_OPTIONS} className="w-44" />
        <Select value={websiteReasonFilter} onChange={setWebsiteReasonFilter} options={WEBSITE_REASON_FILTER_OPTIONS} className="w-52" />
        <Select value={assignmentFilter} onChange={setAssignmentFilter} options={[{ value: '', label: 'All Assignments' }, { value: 'manager', label: 'Distributed to a manager' }, { value: 'unassigned', label: 'Not distributed' }]} className="w-48" />
        <Select value={historyFilter} onChange={setHistoryFilter} options={HISTORY_FILTER_OPTIONS} className="w-44" />
        {can('leads.export') && (
          <Button variant="secondary" size="sm" disabled={exporting} onClick={exportLeads}>
            {exporting ? t('Exporting...') : selected.length > 0 ? t('Export selected ({n})', { n: selected.length }) : t('Export Excel')}
          </Button>
        )}
        {can('leads.distribute') && <Button variant="secondary" size="sm" onClick={() => setDistributeModal(true)}>{t('Distribute evenly')}</Button>}
        {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>{t('Clear filters')}</Button>}
        <SelectFirstN selectedCount={selected.length} max={totalLeads} onSelect={selectFirstN} onClear={() => setSelected([])} />
      </div>

      {/* Bulk actions: stay under the top bar while scrolling */}
      {selected.length > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-[#dfff03]/30 bg-[#161616]/95 px-3 py-2 shadow-lg backdrop-blur anim-banner">
          <span className="text-sm text-[#dfff03]">{t('{n} selected', { n: selected.length })}</span>
          <Button variant="primary" size="sm" onClick={() => setAssignModal(true)}>{t('Assign {n} Selected', { n: selected.length })}</Button>
          <Button variant="secondary" size="sm" onClick={() => setBulkTypesModal(true)}>{t('Edit types')}</Button>
          {can('leads.delete') && <Button variant="danger" size="sm" disabled={busy === 'delete'} onClick={() => runBusy('delete', handleDeleteSelected)}>{t('Delete {n}', { n: selected.length })}</Button>}
          <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setSelected([])}>{t('Clear selection')}</Button>
        </div>
      )}

      {/* Table */}
      <div className={loading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
        <Card>
          <Table headers={['', 'Code', 'Name', 'Contacted', 'Phone', 'Website', 'Website Status', 'Type', 'Quality', 'Status', 'Assigned To', 'Updated', '']}>
            <tr className="border-b border-[#262626]">
              <td className="py-3 px-4">
                <input
                  type="checkbox"
                  checked={allOnPage}
                  onChange={toggleAll}
                  className="accent-[#dfff03]"
                />
              </td>
              <td colSpan={13} className="py-3 px-2 text-[#6b6b6b] text-xs">
                {t('{a} shown of {b} records', { a: leads.length.toLocaleString('en-US'), b: formatCount(totalLeads) })}
              </td>
            </tr>
            {leads.map(lead => {
              const assignedUser = users.find(u => u.id === lead.assignedTo);
              return (
                <Tr key={lead.id} onClick={() => openLead(lead.id)}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={selected.includes(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      onClick={e => e.stopPropagation()}
                      className="accent-[#dfff03]"
                    />
                  </Td>
                  <Td><span className="font-mono text-xs text-[#dfff03]">{lead.clientCode}</span></Td>
                  <Td>
                    <span className="font-medium text-white">{lead.name}</span>
                    {lead.tag && (
                      <button type="button" onClick={e => { e.stopPropagation(); setTagFilter(lead.tag!); }} title={t('Show only this tag')}
                        className="ms-2 inline-flex items-center rounded bg-[#64a0ff]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#8fb8ff] hover:bg-[#64a0ff]/20" dir="auto">
                        🏷 {lead.tag}
                      </button>
                    )}
                    {lead.wasDistributed && (
                      <span
                        className="ms-2 inline-flex items-center rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-300"
                        title={lead.releasedAt
                          ? t('Returned to the list on {date}', { date: new Date(lead.releasedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) })
                          : t('Previously distributed')}
                      >
                        {t('Previously distributed')}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <ContactedToggle
                      on={Boolean(myContacts[lead.id])}
                      byName={lead.contactedBy && lead.contactedBy !== myId ? users.find(u => u.id === lead.contactedBy)?.fullName : undefined}
                      onToggle={() => void toggleContact(lead.id).then(r => { if (r !== null) void loadData(page, true); })}
                    />
                  </Td>
                  <Td><EditablePhoneCell phone={lead.phone} onSave={phone => saveInlinePhone(lead, phone)} /></Td>
                  <Td><WebsiteLink url={lead.website} className="text-[#a0a0a0] text-xs truncate max-w-40 inline-block" /></Td>
                  <Td>
                    <WebsiteStatusToggle status={lead.websiteStatus} onToggle={nextStatus => toggleWebsiteStatus(lead, nextStatus)} />
                    {lead.websiteCheckCategory && lead.websiteCheckCategory !== 'ok' && (
                      <div className="mt-1 text-[10px] text-[#6b6b6b]" title={t(websiteCategoryLabel(lead.websiteCheckCategory))}>{t(websiteCategoryLabel(lead.websiteCheckCategory))}</div>
                    )}
                  </Td>
                  <Td><LeadTypeBadges codes={lead.leadTypes} types={leadTypes} /></Td>
                  <Td><span className="text-[#a0a0a0] text-xs">{t(lead.dataQuality ?? 'normal')}</span></Td>
                  <Td><StatusBadge status={lead.status} /></Td>
                  <Td>
                    {assignedUser ? (
                      <span className="text-[#a0a0a0] text-xs">{assignedUser.fullName}</span>
                    ) : (
                      <span className="text-[#4a4a4a] text-xs italic">{t('Unassigned')}</span>
                    )}
                  </Td>
                  <Td><span className="text-xs font-mono text-[#6b6b6b]">{lead.updatedAt?.slice(0, 10)}</span></Td>
                  <Td>
                    <div className="flex items-center gap-3">
                    {lead.phone && <WhatsAppButton variant="icon" leadId={lead.id} leadStatus={lead.status} />}
                    <button
                      className="text-[#4a4a4a] hover:text-[#dfff03] transition-colors"
                      title={t('View details')}
                      aria-label={t('View details')}
                      onClick={e => {
                        e.stopPropagation();
                        openLead(lead.id);
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Table>
          {!loading && leads.length === 0 && !errorMsg && (
            hasFilters
              ? <EmptyState message="No clients match these filters." actionLabel="Clear filters" onAction={clearFilters} />
              : <EmptyState message="No clients yet." actionLabel="+ Add Lead" onAction={() => setAddModal(true)} />
          )}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={totalLeads ?? leads.length}
            onChange={nextPage => { void loadData(nextPage); }}
          />
        </Card>
      </div>

      {/* Assign Modal */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title={t('Assign {n} Leads', { n: selected.length })}>
        <div className="space-y-4">
          <p className="text-[#a0a0a0] text-sm">{t('Select who gets these leads (telesales, manager or admin):')}</p>
          <div className="space-y-2">
            {assignableUsers.map(u => {
              const assignedCount = leads.filter(l => l.assignedTo === u.id).length;
              return (
                <button
                  key={u.id}
                  onClick={() => setAssignTo(u.id)}
                  className={`w-full text-start p-3 rounded-lg border transition-all ${assignTo === u.id ? 'border-[#dfff03] bg-[#dfff03]/5' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'}`}
                >
                  <div className="flex items-center gap-2 text-white text-sm font-medium">{u.fullName} <RoleBadge role={u.role} /></div>
                  <div className="text-[#6b6b6b] text-xs">
                    {t('{n} leads currently assigned', { n: assignedCount })}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!assignTo || busy === 'assign'} onClick={() => runBusy('assign', handleAssign)}>{busy === 'assign' ? t('Saving...') : t('Assign Leads')}</Button>
            <Button variant="ghost" onClick={() => setAssignModal(false)}>{t('Cancel')}</Button>
          </div>
        </div>
      </Modal>

      <BulkLeadTypesModal
        open={bulkTypesModal}
        onClose={() => setBulkTypesModal(false)}
        leadIds={selected}
        types={leadTypes}
        onDone={() => { setSelected([]); void loadData(page); void reloadLeadTypes(); }}
      />
      <LeadTypesManagerModal
        open={typesManager}
        onClose={() => setTypesManager(false)}
        types={leadTypes}
        onChanged={() => void reloadLeadTypes()}
      />

      <DistributeLeadsModal
        open={distributeModal}
        onClose={() => setDistributeModal(false)}
        agents={recipientAgents}
        onDone={() => { setSelected([]); void loadData(0); }}
      />

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
              <label className="block text-xs text-[#a0a0a0] mb-1">{t(f.label)}</label>
              <input
                value={(newLead as any)[f.key]}
                onChange={e => setNewLead(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={t(f.placeholder)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">{t('Quantity')}</label>
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
            <label className="block text-xs text-[#a0a0a0] mb-1">{t('Country')}</label>
            <select
              value={newLead.region}
              onChange={e => setNewLead(prev => ({ ...prev, region: e.target.value }))}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              {REGION_FORM_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{t(o.label)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">{t('Source')}</label>
            <input
              value={newLead.source}
              onChange={e => setNewLead(prev => ({ ...prev, source: e.target.value }))}
              placeholder={t('Referral, Website...')}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
            />
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">{t('Client types')}</label>
            <LeadTypeChecklist types={leadTypes} value={newLead.leadTypes} onChange={next => setNewLead(prev => ({ ...prev, leadTypes: next }))} />
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">{t('Data Quality')}</label>
            <select
              value={newLead.dataQuality}
              onChange={e => setNewLead(prev => ({ ...prev, dataQuality: e.target.value as LeadDataQuality }))}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
            >
              <option value="high">{t('High')}</option>
              <option value="medium">{t('Medium')}</option>
              <option value="normal">{t('Normal')}</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="primary" disabled={!newLead.name || busy === 'addLead'} onClick={() => runBusy('addLead', handleAddLead)}>{busy === 'addLead' ? t('Saving...') : t('Add Lead')}</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>{t('Cancel')}</Button>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importModal} onClose={() => setImportModal(false)} title="Import Leads from Excel">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-2">{t('Client types for this import')}</label>
            <LeadTypeChecklist types={leadTypes} value={importTypes} onChange={setImportTypes} disabled={importing} />
            {importTypes.length === 0 && <p className="mt-1 text-[11px] text-[#6b6b6b]">{t('Nothing chosen: clients are imported as custom software.')}</p>}
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">{t('Data quality for this import')}</label>
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
            <p className="text-[#a0a0a0] text-sm">{importFile?.name || t('Choose an Excel or CSV file')}</p>
            <p className="text-[#4a4a4a] text-xs mt-1">{t('.xlsx, .xls, .csv supported')}</p>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { handleImportFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {importSheets.length > 1 && !importReport && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[#a0a0a0]">{t('Sheet:')}</span>
              <select
                value={importSheet}
                onChange={e => chooseImportSheet(importSheets, e.target.value)}
                disabled={importing}
                className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white focus:outline-none focus:border-[#dfff03]/60"
              >
                {importSheets.map(s => (
                  <option key={s.name} value={s.name}>{s.name} ({countRows(s.matrix).toLocaleString('en-US')} {t('rows')})</option>
                ))}
              </select>
            </div>
          )}
          {importAnalysis && !importReport && (() => {
            const samples = (field: ImportField) => {
              const col = importMapping[field];
              if (col === undefined) return [] as string[];
              const out: string[] = [];
              for (const row of importAnalysis.dataRows) {
                const v = row[col];
                if (v && !out.includes(v)) out.push(v);
                if (out.length === 2) break;
              }
              return out;
            };
            const withPhone = importRows.filter(r => r.phone).length;
            const phoneMissing = importParsed.total > 0 && withPhone === 0 && hasPhoneLikeColumn(importAnalysis.dataRows);
            return (
              <div className="space-y-2">
                <div className="text-white text-xs font-medium">
                  {t('Check the columns before importing')}
                  <span className="text-[#6b6b6b] font-normal">
                    {' · '}{importAnalysis.headerRow >= 0 ? t('Header row: {n}', { n: importAnalysis.headerRow + 1 }) : t('No header row — columns found from their content')}
                  </span>
                </div>
                <div className="border border-[#2a2a2a] rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#1a1a1a] text-[#a0a0a0]">
                      <tr>
                        <th className="text-start font-medium px-3 py-2">{t('Field')}</th>
                        <th className="text-start font-medium px-3 py-2">{t('Detected column')}</th>
                        <th className="text-start font-medium px-3 py-2">{t('Sample values')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {IMPORT_FIELDS.map(field => {
                        const values = samples(field);
                        const missingName = field === 'name' && importMapping.name === undefined;
                        return (
                          <tr key={field} className="border-t border-[#2a2a2a]">
                            <td className={`px-3 py-1.5 whitespace-nowrap ${missingName ? 'text-[#ff6464]' : 'text-white'}`}>
                              {t(IMPORT_FIELD_LABELS[field])}{field === 'name' ? ' *' : ''}
                            </td>
                            <td className="px-3 py-1.5">
                              <select
                                value={importMapping[field] ?? ''}
                                onChange={e => setImportColumn(field, e.target.value === '' ? undefined : Number(e.target.value))}
                                disabled={importing}
                                className={`w-full min-w-[9rem] bg-[#1a1a1a] border rounded px-2 py-1 text-white focus:outline-none focus:border-[#dfff03]/60 ${missingName || (field === 'phone' && phoneMissing) ? 'border-[#ff6464]' : 'border-[#2a2a2a]'}`}
                              >
                                <option value="">{t('(Ignore)')}</option>
                                {importAnalysis.columns.map(c => (
                                  <option key={c.index} value={c.index}>{c.label.startsWith('Column ') ? `${t('Column')} ${c.label.slice(7)}` : c.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-1.5 text-[#a0a0a0] max-w-[14rem] truncate" dir="auto" title={values.join(' · ')}>
                              {values.length ? values.join('، ') : <span className="text-[#4a4a4a]">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[#dfff03] text-xs">
                  {t('{n} rows found · {m} with a phone · {k} without a phone', {
                    n: importRows.length.toLocaleString('en-US'),
                    m: withPhone.toLocaleString('en-US'),
                    k: (importRows.length - withPhone).toLocaleString('en-US'),
                  })}
                </p>
                {importParsed.rejected.length > 0 && (
                  <p className="text-[#ffc832] text-xs">
                    {t('{n} rows will be skipped (no name, or the same website / phone twice in the file).', { n: importParsed.rejected.length.toLocaleString('en-US') })}
                  </p>
                )}
                {phoneMissing && (
                  <p className="bg-[#ff6464]/10 border border-[#ff6464]/40 text-[#ff6464] text-sm font-medium rounded-lg px-3 py-2">
                    {t('The phone column was not recognized — pick it from the list before importing.')}
                  </p>
                )}
                {importMapping.name === undefined && (
                  <p className="text-[#ff6464] text-xs">{t('Pick the name column to enable the import.')}</p>
                )}
              </div>
            );
          })()}
          {importing && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[#a0a0a0]"><span>{t('Uploading customers')}</span><span>{importProgress}%</span></div>
              <div className="h-1.5 bg-[#262626] rounded-full overflow-hidden"><div className="h-full bg-[#dfff03] transition-all" style={{ width: `${importProgress}%` }} /></div>
            </div>
          )}
          {importReport && (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 space-y-1.5 text-sm">
              <div className="text-white font-medium mb-2">{t('Import finished')}</div>
              <div className="text-[#dfff03]">{t('Added: {n} new clients', { n: importReport.added.toLocaleString('en-US') })}</div>
              <div className="text-white">{t('Phone filled for {n} clients that had no phone', { n: importReport.filled.toLocaleString('en-US') })}</div>
              <div className="text-[#ffc832]">{t('Ignored {n} rows (existing website or phone already used)', { n: importReport.ignored.toLocaleString('en-US') })}</div>
              {importReport.skippedRows.length > 0 && (
                <div className="pt-2">
                  <Button variant="secondary" size="sm" onClick={downloadSkippedRows}>
                    {t('Download skipped rows')} ({importReport.skippedRows.length.toLocaleString('en-US')})
                  </Button>
                </div>
              )}
            </div>
          )}
          {importRows.length > 0 && !importReport && (
            <div className="bg-[#dfff03]/5 border border-[#dfff03]/20 rounded-lg p-3 text-xs">
              <div className="text-white font-medium">{t('Import settings')}</div>
              <div className="text-[#a0a0a0] mt-1">
                {t('Type:')} <span className="text-[#dfff03]">{(importTypes.length ? importTypes : ['custom']).map(typeLabel).join('، ')}</span>
                {' · '}
                {t('Data quality:')}{' '}
                <span className="text-[#dfff03]">
                  {importDataQuality === 'high' ? t('Strong') : importDataQuality === 'medium' ? t('Medium') : t('Normal')}
                </span>
              </div>
              <div className="text-[#6b6b6b] mt-1">{t('These settings will be applied to all imported customers.')}</div>
            </div>
          )}
          {importError && <p className="text-[#ff6464] text-xs">{t(importError)}</p>}
          {!importAnalysis && (
            <div className="bg-[#1a1a1a] rounded-lg p-3 text-xs text-[#6b6b6b]">
              <p className="font-medium text-[#a0a0a0] mb-1">{t('Columns are found automatically')}</p>
              <p>{t('Any column names and any order, Arabic or English, with or without a header row. You can check and correct them before importing.')}</p>
              <p className="mt-1">{t('If two rows use the same website, only the first row is imported.')}</p>
              <p className="mt-1">{t('If a store already exists without a phone and the sheet has one, the phone is added to it.')}</p>
              <p className="mt-1 text-[#dfff03]">{t('The selected client type and data quality above apply to every imported row.')}</p>
            </div>
          )}
          <div className="flex gap-2">
            {importReport ? (
              <Button variant="primary" onClick={() => { resetImport(); setImportModal(false); }}>{t('Done')}</Button>
            ) : (
              <>
                <Button variant="primary" disabled={!importRows.length || importMapping.name === undefined || importing} onClick={handleImport}>
                  {importing ? t('Importing...') : t('Import Leads')}
                </Button>
                <Button variant="ghost" disabled={importing} onClick={() => setImportModal(false)}>{t('Cancel')}</Button>
              </>
            )}
          </div>
        </div>
      </Modal>
      {confirmUi}
    </div>
  );
}

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}
