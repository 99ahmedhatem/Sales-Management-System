import { lazy, Suspense, useState } from 'react';
import { Role } from './data/mockData';
import Login from './components/Login';
import AppShell from './components/AppShell';

const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'));
const AdminLeads = lazy(() => import('./components/admin/AdminLeads'));
const AdminUsers = lazy(() => import('./components/admin/AdminUsers'));
const AdminMeetings = lazy(() => import('./components/admin/AdminMeetings'));
const AdminReports = lazy(() => import('./components/admin/AdminReports'));
const ManagerDashboard = lazy(() => import('./components/manager/ManagerDashboard'));
const TelesalesDashboard = lazy(() => import('./components/telesales/TelesalesDashboard'));
const SalesDashboard = lazy(() => import('./components/sales/SalesDashboard'));
const ContractsModule = lazy(() => import('./components/shared/ContractsModule'));

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
      {(page) => (
        <Suspense fallback={<div className="p-6 text-sm text-[#6b6b6b]">Loading...</div>}>
          {session.role === 'admin' && page === 'dashboard' && <AdminDashboard />}
          {session.role === 'admin' && page === 'leads' && <AdminLeads />}
          {session.role === 'admin' && page === 'users' && <AdminUsers />}
          {session.role === 'admin' && page === 'meetings' && <AdminMeetings />}
          {session.role === 'admin' && page === 'reports' && <AdminReports />}
          {session.role === 'admin' && page === 'contracts' && <ContractsModule userId={session.userId} role="admin" />}
          {session.role === 'manager' && page === 'dashboard' && <ManagerDashboard userId={session.userId} />}
          {session.role === 'manager' && page === 'contracts' && <ContractsModule userId={session.userId} role="manager" />}
          {session.role === 'telesales' && <TelesalesDashboard userId={session.userId} />}
          {session.role === 'sales' && page === 'meetings' && <SalesDashboard userId={session.userId} />}
          {session.role === 'sales' && page === 'contracts' && <ContractsModule userId={session.userId} role="sales" />}
        </Suspense>
      )}
    </AppShell>
  );
}
