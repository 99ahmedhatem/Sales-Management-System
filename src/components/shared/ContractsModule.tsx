import { useState } from 'react';
import { CONTRACTS, generateCode, USERS, Contract } from '../../data/mockData';
import { Button, Card, KpiCard, Modal, StatusBadge, Table, Td, Tr, WebsiteLink } from '../ui';

const PRODUCT_TYPES = ['E-commerce Platform', 'SaaS Platform', 'Mobile App', 'ERP System', 'Custom Solution'];
const PACKAGE_TYPES = ['Starter', 'Business', 'Enterprise', 'Custom'];
const TRANSFER_TYPES = ['Tabby', 'Emkan', 'Bank Transfer', 'Cash'];

interface Props {
  userId: string;
  role: 'admin' | 'manager' | 'sales' | 'telesales';
  managerId?: string; // for manager: filter to team only
}

export default function ContractsModule({ userId, role, managerId }: Props) {
  const [contracts, setContracts] = useState<Contract[]>(CONTRACTS);
  const [detail, setDetail] = useState<Contract | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [search, setSearch] = useState('');

  const salesUsers = USERS.filter(u => u.role === 'sales');
  const telesalesUsers = USERS.filter(u => u.role === 'telesales');

  // Role-scoped filtering
  const visible = contracts.filter(c => {
    if (role === 'admin') return true;
    if (role === 'manager') {
      const myTeamIds = USERS.filter(u => u.managerId === userId).map(u => u.id);
      return myTeamIds.includes(c.salesUserId) || myTeamIds.includes(c.telesalesUserId);
    }
    if (role === 'sales') return c.salesUserId === userId;
    return c.telesalesUserId === userId;
  }).filter(c => {
    const q = search.toLowerCase();
    return !q || c.clientName.toLowerCase().includes(q) || c.clientCode.toLowerCase().includes(q);
  });

  const totalValue = visible.reduce((a, c) => a + c.totalContractValue, 0);
  const totalPaid = visible.reduce((a, c) => a + c.totalPaid, 0);
  const totalRemaining = visible.reduce((a, c) => a + c.remainingAmount, 0);
  const finalized = visible.filter(c => c.isFinalized).length;

  const [form, setForm] = useState({
    clientName: '',
    clientPhone: '',
    email: '',
    contractDate: '2026-09-18',
    productType: PRODUCT_TYPES[0],
    storeLink: '',
    subscriptionMonths: 12,
    packageType: PACKAGE_TYPES[1],
    packageDetails: '',
    contractStartDate: '2026-09-20',
    contractEndDate: '2027-09-20',
    clientNotes: '',
    transferType: TRANSFER_TYPES[2],
    amountTabby: 0,
    amountEmkan: 0,
    amountBank: 0,
    totalContractValue: 0,
    salesUserId: salesUsers[0]?.id || '',
    telesalesUserId: telesalesUsers[0]?.id || '',
  });

  const totalCalc = form.amountTabby + form.amountEmkan + form.amountBank;

  const handleSubmit = () => {
    if (!form.clientName || !form.clientPhone) return;
    const contract: Contract = {
      id: `con${Date.now()}`,
      leadId: '',
      clientCode: generateCode('CLT'),
      ...form,
      totalPaid: totalCalc,
      remainingAmount: Math.max(0, form.totalContractValue - totalCalc),
      isFinalized: false,
      createdAt: new Date().toISOString().slice(0, 10),
      contractFileUrl: undefined,
      invoiceFileUrl: undefined,
    };
    setContracts(prev => [contract, ...prev]);
    setAddModal(false);
  };

  const canFinalize = role === 'admin';
  const canAdd = role !== 'telesales';

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Contracts & Payments</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">{visible.length} records</p>
        </div>
        {canAdd && (
          <div className="flex gap-2">
            <button className="flex items-center gap-2 bg-[#1e1e1e] border border-[#2a2a2a] text-[#a0a0a0] hover:text-white rounded-lg px-4 py-2 text-sm transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export
            </button>
            <Button variant="primary" size="sm" onClick={() => setAddModal(true)}>+ New Contract</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Value" value={`AED ${totalValue.toLocaleString()}`} sub="All contracts" />
        <KpiCard label="Collected" value={`AED ${totalPaid.toLocaleString()}`} accent sub="Total paid" />
        <KpiCard label="Outstanding" value={`AED ${totalRemaining.toLocaleString()}`} sub="Remaining" />
        <KpiCard label="Finalized" value={finalized} sub={`${visible.length - finalized} pending`} />
      </div>

      <div className="flex gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search client name or code..."
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 w-72"
        />
      </div>

      <Card>
        <Table headers={['Client', 'Code', 'Package', 'Period', 'Total', 'Paid', 'Remaining', 'Sales', 'Status', '']}>
          {visible.map(c => {
            const salesUser = USERS.find(u => u.id === c.salesUserId);
            const remaining = c.remainingAmount;
            return (
              <Tr key={c.id} onClick={() => setDetail(c)}>
                <Td>
                  <div className="font-medium text-white">{c.clientName}</div>
                  <div className="text-xs text-[#6b6b6b]">{c.clientPhone}</div>
                </Td>
                <Td><span className="font-mono text-xs text-[#dfff03]">{c.clientCode}</span></Td>
                <Td>
                  <div className="text-sm text-white">{c.packageType}</div>
                  <div className="text-xs text-[#6b6b6b]">{c.productType}</div>
                </Td>
                <Td>
                  <div className="text-xs font-mono text-[#a0a0a0]">{c.contractStartDate}</div>
                  <div className="text-xs font-mono text-[#a0a0a0]">→ {c.contractEndDate}</div>
                </Td>
                <Td><span className="font-mono text-sm font-medium text-white">AED {c.totalContractValue.toLocaleString()}</span></Td>
                <Td><span className="font-mono text-sm text-[#64dc78]">AED {c.totalPaid.toLocaleString()}</span></Td>
                <Td>
                  <span className={`font-mono text-sm ${remaining > 0 ? 'text-[#ffc832]' : 'text-[#64dc78]'}`}>
                    {remaining > 0 ? `AED ${remaining.toLocaleString()}` : 'Paid'}
                  </span>
                </Td>
                <Td><span className="text-[#a0a0a0] text-xs">{salesUser?.fullName}</span></Td>
                <Td>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.isFinalized ? 'bg-[#64dc78]/15 text-[#64dc78]' : 'bg-[#ffc832]/10 text-[#ffc832]'}`}>
                    {c.isFinalized ? 'Finalized' : 'Draft'}
                  </span>
                </Td>
                <Td>
                  <button className="text-[#4a4a4a] hover:text-[#dfff03] transition-colors" onClick={e => { e.stopPropagation(); setDetail(c); }}>
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

      {/* Detail Modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Contract Details">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[#dfff03] text-sm">{detail.clientCode}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${detail.isFinalized ? 'bg-[#64dc78]/15 text-[#64dc78]' : 'bg-[#ffc832]/10 text-[#ffc832]'}`}>
                {detail.isFinalized ? 'Finalized' : 'Draft'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Client', detail.clientName],
                ['Phone', detail.clientPhone],
                ['Email', detail.email || '—'],
                ['Contract Date', detail.contractDate],
                ['Product', detail.productType],
                ['Package', detail.packageType],
                ['Duration', `${detail.subscriptionMonths} months`],
                ['Store Link', detail.storeLink || '—'],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{k}</div>
                  <div className="text-white text-sm font-medium break-all">{k === 'Store Link' ? <WebsiteLink url={String(v)} /> : v}</div>
                </div>
              ))}
            </div>
            {detail.packageDetails && (
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Package Details</div>
                <div className="text-[#d0d0d0] text-sm">{detail.packageDetails}</div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Contract Value</div>
                <div className="text-white font-bold font-mono">AED {detail.totalContractValue.toLocaleString()}</div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Total Paid</div>
                <div className="text-[#64dc78] font-bold font-mono">AED {detail.totalPaid.toLocaleString()}</div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">Remaining</div>
                <div className={`font-bold font-mono ${detail.remainingAmount > 0 ? 'text-[#ffc832]' : 'text-[#64dc78]'}`}>
                  {detail.remainingAmount > 0 ? `AED ${detail.remainingAmount.toLocaleString()}` : 'Fully Paid'}
                </div>
              </div>
            </div>
            <div className="bg-[#1a1a1a] rounded p-3">
              <div className="text-[#6b6b6b] text-xs mb-2">Payment Breakdown</div>
              <div className="space-y-1 text-sm">
                {detail.amountTabby > 0 && <div className="flex justify-between"><span className="text-[#a0a0a0]">Tabby</span><span className="text-white font-mono">AED {detail.amountTabby.toLocaleString()}</span></div>}
                {detail.amountEmkan > 0 && <div className="flex justify-between"><span className="text-[#a0a0a0]">Emkan</span><span className="text-white font-mono">AED {detail.amountEmkan.toLocaleString()}</span></div>}
                {detail.amountBank > 0 && <div className="flex justify-between"><span className="text-[#a0a0a0]">Bank Transfer</span><span className="text-white font-mono">AED {detail.amountBank.toLocaleString()}</span></div>}
              </div>
            </div>
            <div className="flex gap-2">
              {canFinalize && !detail.isFinalized && (
                <Button variant="primary" size="sm" onClick={() => {
                  setContracts(prev => prev.map(c => c.id === detail.id ? { ...c, isFinalized: true } : c));
                  setDetail(prev => prev ? { ...prev, isFinalized: true } : null);
                }}>
                  Finalize Contract
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Contract Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="New Contract & Payment">
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Client Name *', key: 'clientName', placeholder: 'Hassan Al-Rashid' },
              { label: 'Phone *', key: 'clientPhone', placeholder: '+971 50 123 4567' },
              { label: 'Email', key: 'email', placeholder: 'client@example.com' },
              { label: 'Contract Date', key: 'contractDate', type: 'date' },
              { label: 'Store Link', key: 'storeLink', placeholder: 'https://...' },
              { label: 'Start Date', key: 'contractStartDate', type: 'date' },
              { label: 'End Date', key: 'contractEndDate', type: 'date' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-[#a0a0a0] mb-1">{f.label}</label>
                <input
                  type={f.type || 'text'}
                  value={(form as any)[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60"
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Product Type</label>
              <select value={form.productType} onChange={e => setForm(p => ({ ...p, productType: e.target.value }))} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60">
                {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Package Type</label>
              <select value={form.packageType} onChange={e => setForm(p => ({ ...p, packageType: e.target.value }))} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60">
                {PACKAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Package Details</label>
            <textarea value={form.packageDetails} onChange={e => setForm(p => ({ ...p, packageDetails: e.target.value }))} rows={2} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-[#a0a0a0] mb-1">Payment Method</label>
            <select value={form.transferType} onChange={e => setForm(p => ({ ...p, transferType: e.target.value }))} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60">
              {TRANSFER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Contract Value (AED)', key: 'totalContractValue' },
              { label: 'Duration (Months)', key: 'subscriptionMonths' },
              { label: 'Amount via Tabby', key: 'amountTabby' },
              { label: 'Amount via Emkan', key: 'amountEmkan' },
              { label: 'Amount via Bank', key: 'amountBank' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-[#a0a0a0] mb-1">{f.label}</label>
                <input
                  type="number"
                  value={(form as any)[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) || 0 }))}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
                />
              </div>
            ))}
            <div className="bg-[#1a1a1a] rounded p-3 flex flex-col justify-center">
              <div className="text-[#6b6b6b] text-xs">Total Paid (auto)</div>
              <div className="text-[#dfff03] font-bold font-mono">AED {totalCalc.toLocaleString()}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Sales Agent</label>
              <select value={form.salesUserId} onChange={e => setForm(p => ({ ...p, salesUserId: e.target.value }))} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60">
                {salesUsers.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">Telesales Agent</label>
              <select value={form.telesalesUserId} onChange={e => setForm(p => ({ ...p, telesalesUserId: e.target.value }))} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60">
                {telesalesUsers.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2 sticky bottom-0 bg-[#161616] pb-1">
            <Button variant="primary" disabled={!form.clientName || !form.clientPhone} onClick={handleSubmit}>Save Contract</Button>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
