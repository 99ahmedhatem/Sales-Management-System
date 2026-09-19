import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Role } from './data/mockData';
import Login from './components/Login';
import CompleteAdminSetup from './components/CompleteAdminSetup';
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