import { useState, useEffect } from "react"

import { supabase } from "./supabaseClient"

import { lazy, Suspense } from "react"

import { Role } from "./data/mockData"

import Login from "./components/Login"

import CompleteAdminSetup from "./components/CompleteAdminSetup"

import AppShell from "./components/AppShell"

import ErrorBoundary from "./components/shared/ErrorBoundary"
import { TableSkeleton } from "./components/shared/motion"
import { AppOverlaysProvider } from "./components/shared/AppOverlays"
import { registerServiceWorker } from "./lib/push"
import { PermissionsProvider } from "./hooks/usePermissions"

const AdminDashboard = lazy(() => import("./components/admin/AdminDashboard"))

const InsightsDashboard = lazy(() => import("./components/shared/InsightsDashboard"))

const AdminLeads = lazy(() => import("./components/admin/AdminLeads"))

const AdminActivity = lazy(() => import("./components/admin/AdminActivity"))

const AdminUsers = lazy(() => import("./components/admin/AdminUsers"))

const AdminMeetings = lazy(() => import("./components/admin/AdminMeetings"))

const AdminReports = lazy(() => import("./components/admin/AdminReports"))

const AdminAuditLog = lazy(() => import("./components/admin/AdminAuditLog"))

const TeamPerformance = lazy(() => import("./components/shared/TeamPerformance"))

const ManagerDashboard = lazy(
  () => import("./components/manager/ManagerDashboard"),
)

const TelesalesDashboard = lazy(
  () => import("./components/telesales/TelesalesDashboard"),
)

const SalesDashboard = lazy(() => import("./components/sales/SalesDashboard"))

const ContractsModule = lazy(
  () => import("./components/shared/ContractsModule"),
)

const AdminPackages = lazy(() => import("./components/admin/AdminPackages"))

const PackagesList = lazy(() => import("./components/shared/PackagesList"))

const ProfileView = lazy(() => import("./components/shared/ProfileView"))

const WhatsAppTemplates = lazy(() => import("./components/admin/WhatsAppTemplates"))

const AdminPermissions = lazy(() => import("./components/admin/AdminPermissions"))

const MeetingRequestsManagement = lazy(
  () => import("./components/shared/MeetingRequestsManagement"),
)

interface AppSession {
  role: Role

  userId: string
}

export default function App() {
  const [session, setSession] = useState<AppSession | null>(null)

  const [needsProfile, setNeedsProfile] = useState<{
    authId: string
    email: string
  } | null>(null)

  const [authChecked, setAuthChecked] = useState(false)

  async function loadProfile(authId: string, email: string) {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", authId)
      .maybeSingle()

    let profile = data

    if (!profile && email) {
      const { data: byEmail } = await supabase
        .from("users")
        .select("*")
        .ilike("email", email)
        .maybeSingle()

      profile = byEmail ?? null
    }

    if (error && error.code !== "PGRST116") {
      console.warn("Profile lookup failed:", error.message)
    }

    if (profile) {
      setSession({ role: profile.role, userId: profile.id })

      // Needed for push notifications (enabled per device from My profile)
      void registerServiceWorker()

      setNeedsProfile(null)
    } else {
      setSession(null)

      setNeedsProfile({ authId, email })
    }

    setAuthChecked(true)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session)
        loadProfile(data.session.user.id, data.session.user.email ?? "")
      else setAuthChecked(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (newSession) {
          loadProfile(newSession.user.id, newSession.user.email ?? "")
        } else {
          setSession(null)

          setNeedsProfile(null)

          setAuthChecked(true)
        }
      },
    )

    return () => listener.subscription.unsubscribe()
  }, [])

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0c0c0c] flex items-center justify-center text-[#a0a0a0] text-sm">
        <span role="status" aria-label="Loading" className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#dfff03] anim-spin" />
      </div>
    )
  }

  if (needsProfile) {
    return (
      <CompleteAdminSetup
        authId={needsProfile.authId}
        email={needsProfile.email}
        onDone={() => loadProfile(needsProfile.authId, needsProfile.email)}
      />
    )
  }

  if (!session) {
    return <Login />
  }

  return (
    <PermissionsProvider role={session.role} userId={session.userId}>
    <AppOverlaysProvider role={session.role}>
    <AppShell
      role={session.role}
      userId={session.userId}
      onLogout={() => supabase.auth.signOut()}
    >
      {(page) => (
        <ErrorBoundary resetKey={page}>
        <Suspense
          fallback={
            <div className="p-6"><TableSkeleton rows={6} /></div>
          }
        >
          {session.role === "admin" && page === "dashboard" && (
            <AdminDashboard />
          )}
          {session.role === "admin" && page === "insights" && <InsightsDashboard role="admin" />}
          {session.role === "manager" && page === "insights" && <InsightsDashboard role="manager" />}
          {(session.role === "admin" || session.role === "manager") && page === "team" && (
            <TeamPerformance mode="team" userId={session.userId} role={session.role} />
          )}
          {(session.role === "sales" || session.role === "telesales") && page === "earnings" && (
            <TeamPerformance mode="mine" userId={session.userId} role={session.role} />
          )}
          {session.role === "admin" && page === "leads" && <AdminLeads />}
          {session.role === "admin" && page === "activity" && <AdminActivity />}
          {session.role === "admin" && page === "users" && <AdminUsers />}
          {session.role === "admin" && page === "meetings" && (
            <AdminMeetings userId={session.userId} />
          )}
          {session.role === "admin" && page === "reports" && <AdminReports />}
          {session.role === "admin" && page === "audit" && <AdminAuditLog />}
          {session.role === "admin" && page === "contracts" && (
            <ContractsModule userId={session.userId} role="admin" />
          )}
          {session.role === "admin" && page === "packages" && <AdminPackages />}
          {session.role === "manager" && page === "dashboard" && (
            <ManagerDashboard userId={session.userId} />
          )}
          {session.role === "manager" && page === "meetings" && (
            <MeetingRequestsManagement role="manager" userId={session.userId} />
          )}
          {session.role === "manager" && page === "contracts" && (
            <ContractsModule userId={session.userId} role="manager" />
          )}
          {session.role === "telesales" && page === "queue" && (
            <TelesalesDashboard userId={session.userId} />
          )}
          {session.role === "telesales" && page === "packages" && (
            <PackagesList />
          )}
          {session.role === "sales" && page === "meetings" && (
            <SalesDashboard userId={session.userId} />
          )}
          {session.role === "sales" && page === "contracts" && (
            <ContractsModule userId={session.userId} role="sales" />
          )}
          {session.role === "sales" && page === "packages" && <PackagesList />}
          {page === "profile" && <ProfileView />}
          {session.role === "admin" && page === "whatsapp" && <WhatsAppTemplates />}
          {session.role === "admin" && page === "permissions" && <AdminPermissions />}
        </Suspense>
        </ErrorBoundary>
      )}
    </AppShell>
    </AppOverlaysProvider>
    </PermissionsProvider>
  )
}
