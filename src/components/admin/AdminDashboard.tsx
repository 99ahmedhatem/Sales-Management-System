import { LEADS, MEETINGS } from '../../data/mockData';
import { KpiCard, Card, StatusBadge, Avatar } from '../ui';

export default function AdminDashboard() {
  const totalLeads = LEADS.length;
  const assignedLeads = LEADS.filter((l: any) => l.assignedTo).length;
  const convertedLeads = LEADS.filter((l: any) => l.status === 'Converted').length;
  const scheduledMeetings = MEETINGS.filter((m: any) => m.outcome === 'Scheduled').length;
  const wonDeals = MEETINGS.filter((m: any) => m.outcome === 'Deal Closed – Won').length;
  const lostDeals = MEETINGS.filter((m: any) => m.outcome === 'Deal Lost').length;
  const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-white text-2xl font-bold">Overview</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">Real-time summary of pipeline activity</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Leads" value={totalLeads} sub={`${assignedLeads} assigned`} />
        <KpiCard label="Converted" value={convertedLeads} sub={`${conversionRate}% conversion rate`} accent />
        <KpiCard label="Active Meetings" value={scheduledMeetings} sub={`${wonDeals} won · ${lostDeals} lost`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lead Status Breakdown */}
        <Card className="p-5 col-span-1">
          <h3 className="text-white font-semibold mb-4">Lead Status</h3>
          {[
            { label: 'New / Uncontacted', count: LEADS.filter(l => ['New', 'Assigned'].includes(l.status)).length, color: '#6495ed' },
            { label: 'Contacted', count: LEADS.filter(l => l.status === 'Contacted').length, color: '#64c8ff' },
            { label: 'Interested', count: LEADS.filter(l => l.status === 'Interested').length, color: '#64dc78' },
            { label: 'Callback Pending', count: LEADS.filter(l => l.status === 'Call Back Later').length, color: '#ffc832' },
            { label: 'Not Interested', count: LEADS.filter(l => l.status === 'Not Interested').length, color: '#ff6464' },
            { label: 'Converted', count: convertedLeads, color: '#dfff03' },
          ].map(row => (
            <div key={row.label} className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#a0a0a0]">{row.label}</span>
                <span className="text-white font-medium">{row.count}</span>
              </div>
              <div className="h-1.5 bg-[#1e1e1e] rounded-full">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${totalLeads > 0 ? Math.max(4, (row.count / totalLeads) * 100) : 0}%`, background: row.color }}
                />
              </div>
            </div>
          ))}
        </Card>

        {/* Agent Performance */}
        <Card className="p-5 col-span-1 lg:col-span-2">
          <h3 className="text-white font-semibold mb-4">Telesales Performance</h3>
          {/* <div className="space-y-3">
            {agentStats.map(({ agent, total, contacted, converted, convRate }) => (
              <div key={agent.id} className="flex items-center gap-4 p-3 bg-[#1a1a1a] rounded-lg">
                <Avatar name={agent.fullName} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium">{agent.fullName}</div>
                  <div className="text-[#6b6b6b] text-xs">{total} leads · {contacted} contacted</div>
                </div>
                <div className="text-right">
                  <div className="text-[#dfff03] font-bold text-lg font-mono">{convRate}%</div>
                  <div className="text-[#6b6b6b] text-xs">{converted} converted</div>
                </div>
                <div className="w-16 h-1.5 bg-[#1e1e1e] rounded-full">
                  <div className="h-full bg-[#dfff03] rounded-full" style={{ width: `${convRate}%` }} />
                </div>
              </div>
            ))}
          </div> */}
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-4">Recent Activity</h3>
        <div className="py-6 text-center text-[#4a4a4a] text-sm">
          No activity yet
        </div>
      </Card>

      {/* Upcoming Meetings */}
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-4">Upcoming Meetings</h3>
        {/* <div className="space-y-2">
          {MEETINGS.filter(m => m.outcome === 'Scheduled').map(m => {
            const salesUser = USERS.find(u => u.id === m.assignedSalesId);
            return (
              <div key={m.id} className="flex items-center gap-4 p-3 bg-[#1a1a1a] rounded-lg">
                <div className="w-10 h-10 bg-[#dfff03]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#dfff03]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium text-sm">{m.leadName}</div>
                  <div className="text-[#6b6b6b] text-xs">{m.leadPhone}</div>
                </div>
                <div className="text-right">
                  <div className="text-[#dfff03] text-xs font-mono">{m.proposedDate}</div>
                  <div className="text-[#6b6b6b] text-xs">{salesUser?.fullName}</div>
                </div>
                <StatusBadge status={m.outcome} />
              </div>
            );
          })}
        </div> */}
      </Card>
    </div>
  );
}
