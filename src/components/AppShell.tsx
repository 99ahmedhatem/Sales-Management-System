import { useState, ReactNode } from 'react';
import { Role, NOTIFICATIONS } from '../data/mockData';
import { Avatar, Badge } from './ui';

type AdminPage = 'dashboard' | 'leads' | 'users' | 'meetings' | 'reports';
type SalesPage = 'meetings';
type TelesalesPage = 'queue';

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
}

const adminNav: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
  },
  {
    key: 'leads',
    label: 'Leads',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  },
  {
    key: 'meetings',
    label: 'Meetings',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  },
  {
    key: 'users',
    label: 'Users',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  },
  {
    key: 'contracts',
    label: 'Contracts',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  },
];

const salesNav: NavItem[] = [
  {
    key: 'meetings',
    label: 'My Meetings',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  },
  {
    key: 'contracts',
    label: 'Contracts',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  },
];

const managerNav: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Team Overview',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
  },
  {
    key: 'contracts',
    label: 'Contracts',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  },
];

const telesalesNav: NavItem[] = [
  {
    key: 'queue',
    label: 'My Queue',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
  },
];

interface Props {
  role: Role;
  userId: string;
  onLogout: () => void;
  children: (page: string) => ReactNode;
}

export default function AppShell({ role, userId, onLogout, children }: Props) {
  const nav = role === 'admin' ? adminNav : role === 'sales' ? salesNav : role === 'manager' ? managerNav : telesalesNav;
  const defaultPage = nav[0].key;
  const [page, setPage] = useState(defaultPage);
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);


  const myNotifs = NOTIFICATIONS.filter(n => n.userId === userId);
  const unreadCount = myNotifs.filter(n => !n.read).length;

  const roleLabel = { admin: 'Administrator', manager: 'Manager', sales: 'Sales', telesales: 'Telesales' }[role];
  const roleBadgeColor = { admin: 'bg-purple-500/10 text-purple-300', manager: 'bg-orange-500/10 text-orange-300', sales: 'bg-blue-500/10 text-blue-300', telesales: 'bg-[#dfff03]/10 text-[#dfff03]' }[role];

  return (
    <div className="min-h-screen bg-[#0c0c0c] flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-56 bg-[#0e0e0e] border-r border-[#1e1e1e] flex flex-col transition-transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        {/* Brand */}
        <div className="p-4 border-b border-[#1e1e1e]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#dfff03] rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden">
              <span className="text-black font-black text-lg leading-none tracking-[-0.15em]">N</span>
            </div>
            <span className="text-white font-bold text-base tracking-tight lowercase">intillaq</span>
          </div>
        </div>

        {/* User info
        <div className="p-4 border-b border-[#1e1e1e]">
          <div className="flex items-center gap-2.5">
            <Avatar name={me?.fullName || 'User'} size="md" />
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{me?.fullName}</div>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${roleBadgeColor}`}>{roleLabel}</span>
            </div>
          </div>
        </div> */}

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {nav.map(item => (
            <button
              key={item.key}
              onClick={() => { setPage(item.key); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                page === item.key
                  ? 'bg-[#dfff03]/10 text-[#dfff03] font-medium'
                  : 'text-[#6b6b6b] hover:text-white hover:bg-[#1a1a1a]'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-[#1e1e1e]">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#6b6b6b] hover:text-white hover:bg-[#1a1a1a] transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 bg-[#0e0e0e] border-b border-[#1e1e1e] flex items-center justify-between px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-[#6b6b6b] hover:text-white p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-[#6b6b6b] text-sm hidden lg:block">
            {new Date('2026-09-18').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative text-[#6b6b6b] hover:text-white p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-[#dfff03] text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-80 bg-[#161616] border border-[#262626] rounded-xl shadow-2xl z-20 overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
                      <span className="text-white font-medium text-sm">Notifications</span>
                      {unreadCount > 0 && <span className="text-[#dfff03] text-xs">{unreadCount} unread</span>}
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {myNotifs.length === 0 && (
                        <div className="p-6 text-center text-[#4a4a4a] text-sm">No notifications</div>
                      )}
                      {myNotifs.map(n => (
                        <div key={n.id} className={`px-4 py-3 border-b border-[#1e1e1e] last:border-0 ${!n.read ? 'bg-[#dfff03]/5' : ''}`}>
                          <div className="flex items-start gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.read ? 'bg-[#3a3a3a]' : 'bg-[#dfff03]'}`} />
                            <div>
                              <div className="text-white text-xs font-medium">{n.title}</div>
                              <div className="text-[#6b6b6b] text-xs mt-0.5 leading-relaxed">{n.message}</div>
                              <div className="text-[#4a4a4a] text-xs font-mono mt-1">{n.createdAt}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children(page)}
        </main>
      </div>
    </div>
  );
}
