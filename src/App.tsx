import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { lazy, Suspense } from 'react';
import { Role } from './data/mockData';
import Login from './components/Login';
import CompleteAdminSetup from './components/CompleteAdminSetup';
import AppShell from './components/AppShell';

const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'));
const AdminLeads = lazy(() => import('./components/admin/AdminLeads'));
const AdminActivity = lazy(() => import('./components/admin/AdminActivity'));
const AdminUsers = lazy(() => import('./components/admin/AdminUsers'));
const AdminMeetings = lazy(() => import('./components/admin/AdminMeetings'));
const AdminReports = lazy(() => import('./components/admin/AdminReports'));
const ManagerDashboard = lazy(() => import('./components/manager/ManagerDashboard'));
const TelesalesDashboard = lazy(() => import('./components/telesales/TelesalesDashboard'));
const SalesDashboard = lazy(() => import('./components/sales/SalesDashboard'));
const ContractsModule = lazy(() => import('./components/shared/ContractsModule'));

interface AppSession {
  role: Role;
  userId: string;
}

export default function App() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [needsProfile, setNeedsProfile] = useState<{ authId: string; email: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  async function loadProfile(authId: string, email: string) {
    const { data } = await supabase.from('users').select('*').eq('id', authId).maybeSingle();
    if (data) {
      setSession({ role: data.role, userId: data.id });
      setNeedsProfile(null);
    } else {
      setSession(null);
      setNeedsProfile({ authId, email });
    }
    setAuthChecked(true);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadProfile(data.session.user.id, data.session.user.email ?? '');
      else setAuthChecked(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession) {
        loadProfile(newSession.user.id, newSession.user.email ?? '');
      } else {
        setSession(null);
        setNeedsProfile(null);
        setAuthChecked(true);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0c0c0c] flex items-center justify-center text-[#a0a0a0] text-sm">
        Loading…
      </div>
    );
  }

  if (needsProfile) {
    return (
      <CompleteAdminSetup
        authId={needsProfile.authId}
        email={needsProfile.email}
        onDone={() => loadProfile(needsProfile.authId, needsProfile.email)}
      />
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <AppShell
      role={session.role}
      userId={session.userId}
      onLogout={() => supabase.auth.signOut()}
    >
      {(page) => (
        <Suspense fallback={<div className="p-6 text-sm text-[#6b6b6b]">Loading...</div>}>
          {session.role === 'admin' && page === 'dashboard' && <AdminDashboard />}
          {session.role === 'admin' && page === 'leads' && <AdminLeads />}
          {session.role === 'admin' && page === 'activity' && <AdminActivity />}
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