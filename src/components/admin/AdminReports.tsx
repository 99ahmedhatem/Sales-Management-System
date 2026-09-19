import { LEADS, MEETINGS, USERS, CALL_LOGS } from '../../data/mockData';
import { Card, KpiCard } from '../ui';

export default function AdminReports() {
  const totalLeads = LEADS.length;
  const convertedLeads = LEADS.filter(l => l.status === 'Converted').length;
  const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';
  const wonDeals = MEETINGS.filter(m => m.outcome === 'Deal Closed – Won').length;
  const lostDeals = MEETINGS.filter(m => m.outcome === 'Deal Lost').length;

  const telesalesUsers = USERS.filter(u => u.role === 'telesales');
  const salesUsers = USERS.filter(u => u.role === 'sales');

  const agentStats = telesalesUsers.map(agent => {
    const myLeads = LEADS.filter(l => l.assignedTo === agent.id);
    const converted = myLeads.filter(l => l.status === 'Converted').length;
    const callsMade = CALL_LOGS.filter(c => c.agentId === agent.id).length;
    const convRate = myLeads.length > 0 ? ((converted / myLeads.length) * 100).toFixed(1) : '0';
    return { agent, total: myLeads.length, converted, callsMade, convRate };
  });

  const salesStats = salesUsers.map(agent => {
    const myMeetings = MEETINGS.filter(m => m.assignedSalesId === agent.id);
    const won = myMeetings.filter(m => m.outcome === 'Deal Closed – Won').length;
    const lost = myMeetings.filter(m => m.outcome === 'Deal Lost').length;
    const winRate = myMeetings.length > 0 ? ((won / myMeetings.length) * 100).toFixed(1) : '0';
    return { agent, total: myMeetings.length, won, lost, winRate };
  });

  const sources = [...new Set(LEADS.map(l => l.source || 'Unknown'))];
  const sourceData = sources.map(s => ({
    source: s,
    count: LEADS.filter(l => l.source === s).length,
    converted: LEADS.filter(l => l.source === s && l.status === 'Converted').length,
  })).sort((a, b) => b.count - a.count);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">Reports & Analytics</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">Performance overview — Sep 2026</p>
        </div>
        <button className="flex items-center gap-2 bg-[#1e1e1e] border border-[#2a2a2a] text-[#a0a0a0] hover:text-white rounded-lg px-4 py-2 text-sm transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Leads" value={totalLeads} sub="All batches" />
        <KpiCard label="Conversion Rate" value={`${conversionRate}%`} sub={`${convertedLeads} converted`} accent />
        <KpiCard label="Deals Won" value={wonDeals} sub={`${lostDeals} lost`} />
        <KpiCard label="Win Rate" value={`${wonDeals + lostDeals > 0 ? ((wonDeals / (wonDeals + lostDeals)) * 100).toFixed(1) : 0}%`} sub="Meetings to close" />
      </div>

      {/* Lead Sources */}
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-4">Lead Sources</h3>
        <div className="space-y-3">
          {sourceData.map(s => (
            <div key={s.source} className="flex items-center gap-4">
              <div className="w-32 text-[#a0a0a0] text-sm truncate">{s.source}</div>
              <div className="flex-1 h-2 bg-[#1e1e1e] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#dfff03] rounded-full"
                  style={{ width: `${totalLeads > 0 ? (s.count / totalLeads) * 100 : 0}%` }}
                />
              </div>
              <div className="w-20 text-right">
                <span className="text-white text-sm font-medium">{s.count}</span>
                <span className="text-[#6b6b6b] text-xs"> leads</span>
              </div>
              <div className="w-16 text-right">
                <span className="text-[#64dc78] text-sm font-medium">{s.converted}</span>
                <span className="text-[#6b6b6b] text-xs"> cvt</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Telesales Performance */}
        <Card className="p-5">
          <h3 className="text-white font-semibold mb-4">Telesales Performance</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-4 text-xs text-[#6b6b6b] font-medium uppercase tracking-wide pb-2 border-b border-[#1e1e1e]">
              <span className="col-span-2">Agent</span>
              <span className="text-right">Calls</span>
              <span className="text-right">Conv. Rate</span>
            </div>
            {agentStats.map(({ agent, total, converted, callsMade, convRate }) => (
              <div key={agent.id} className="grid grid-cols-4 items-center">
                <div className="col-span-2">
                  <div className="text-white text-sm font-medium">{agent.fullName}</div>
                  <div className="text-[#6b6b6b] text-xs">{total} leads · {converted} converted</div>
                </div>
                <div className="text-right">
                  <span className="text-[#a0a0a0] font-mono text-sm">{callsMade}</span>
                </div>
                <div className="text-right">
                  <span className="text-[#dfff03] font-mono font-bold text-sm">{convRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Sales Performance */}
        <Card className="p-5">
          <h3 className="text-white font-semibold mb-4">Sales Performance</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-4 text-xs text-[#6b6b6b] font-medium uppercase tracking-wide pb-2 border-b border-[#1e1e1e]">
              <span className="col-span-2">Agent</span>
              <span className="text-right">Meetings</span>
              <span className="text-right">Win Rate</span>
            </div>
            {salesStats.map(({ agent, total, won, lost, winRate }) => (
              <div key={agent.id} className="grid grid-cols-4 items-center">
                <div className="col-span-2">
                  <div className="text-white text-sm font-medium">{agent.fullName}</div>
                  <div className="text-[#6b6b6b] text-xs">{won} won · {lost} lost</div>
                </div>
                <div className="text-right">
                  <span className="text-[#a0a0a0] font-mono text-sm">{total}</span>
                </div>
                <div className="text-right">
                  <span className="text-[#64dc78] font-mono font-bold text-sm">{winRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Pipeline Funnel */}
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-5">Pipeline Funnel</h3>
        <div className="flex items-end gap-2 h-32">
          {[
            { label: 'Total', value: totalLeads, color: '#6495ed' },
            { label: 'Assigned', value: LEADS.filter(l => l.assignedTo).length, color: '#dfff03' },
            { label: 'Contacted', value: LEADS.filter(l => ['Contacted', 'Interested', 'Not Interested', 'Converted', 'Call Back Later', 'No Answer'].includes(l.status)).length, color: '#64c8ff' },
            { label: 'Interested', value: LEADS.filter(l => l.status === 'Interested').length, color: '#ffc832' },
            { label: 'Converted', value: convertedLeads, color: '#64dc78' },
            { label: 'Won Deals', value: wonDeals, color: '#dfff03' },
          ].map((s, i) => (
            <div key={s.label} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-white font-mono font-bold text-sm">{s.value}</span>
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${totalLeads > 0 ? Math.max(8, (s.value / totalLeads) * 100) : 8}px`,
                  background: s.color,
                  opacity: 0.85,
                }}
              />
              <span className="text-[#6b6b6b] text-xs text-center leading-tight">{s.label}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
