import { useState } from 'react';
import { Role } from './data/mockData';
import Login from './components/Login';
import AppShell from './components/AppShell';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminLeads from './components/admin/AdminLeads';
import AdminUsers from './components/admin/AdminUsers';
import AdminMeetings from './components/admin/AdminMeetings';
import AdminReports from './components/admin/AdminReports';
import ManagerDashboard from './components/manager/ManagerDashboard';
import TelesalesDashboard from './components/telesales/TelesalesDashboard';
import SalesDashboard from './components/sales/SalesDashboard';
import ContractsModule from './components/shared/ContractsModule';

export default function App() {
  const [session, setSession] = useState<{ role: Role; userId: string } | null>(null);

  if (!session) {
    return <Login onLogin={(role, userId) => setSession({ role, userId })} />;
  }

  return (
    <AppShell
      role={session.role}
      userId={session.userId}
      onLogout={() => setSession(null)}
    >
      {(page) => {
        if (session.role === 'admin') {
          if (page === 'dashboard') return <AdminDashboard />;
          if (page === 'leads') return <AdminLeads />;
          if (page === 'users') return <AdminUsers />;
          if (page === 'meetings') return <AdminMeetings />;
          if (page === 'reports') return <AdminReports />;
          if (page === 'contracts') return <ContractsModule userId={session.userId} role="admin" />;
        }
        if (session.role === 'manager') {
          if (page === 'dashboard') return <ManagerDashboard userId={session.userId} />;
          if (page === 'contracts') return <ContractsModule userId={session.userId} role="manager" />;
        }
        if (session.role === 'telesales') {
          return <TelesalesDashboard userId={session.userId} />;
        }
        if (session.role === 'sales') {
          if (page === 'meetings') return <SalesDashboard userId={session.userId} />;
          if (page === 'contracts') return <ContractsModule userId={session.userId} role="sales" />;
        }
        return null;
      }}
    </AppShell>
  );
}
