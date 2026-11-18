import { useEffect, useState } from "react"
import { supabase } from "../../supabaseClient"
import { useI18n } from "../../i18n/I18nProvider"

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  sales: "Sales",
  telesales: "Telesales",
  sales_telesales: "Telesales + Sales",
}

// Height of the bar. AppShell reads --imp-h to push its fixed sidebar and sticky header below it.
const BAR_H = "36px"

/** Shown on every page while an admin is browsing as another user (View as). */
export default function ImpersonationBanner({ name, role }: { name: string; role: string }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    document.documentElement.style.setProperty("--imp-h", BAR_H)
    return () => {
      document.documentElement.style.removeProperty("--imp-h")
    }
  }, [])

  const stop = async () => {
    setBusy(true)
    setError("")
    const { error: rpcError } = await supabase.rpc("stop_impersonation")
    if (rpcError) {
      setError(rpcError.message)
      setBusy(false)
      return
    }
    window.location.reload()
  }

  return (
    <div
      role="alert"
      style={{ height: BAR_H }}
      className="sticky top-0 z-50 flex items-center justify-center gap-3 px-4 bg-[#ea580c] text-white text-sm font-medium shadow-md"
    >
      <span className="truncate">
        {t("You are browsing as «{name}» ({role})", { name, role: t(ROLE_LABELS[role] ?? role) })}
      </span>
      {error && <span className="truncate text-xs text-white/80">{error}</span>}
      <button
        onClick={() => void stop()}
        disabled={busy}
        className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-bold text-[#c2410c] hover:bg-white/90 disabled:opacity-60"
      >
        {busy ? t("Returning…") : t("Back to your account")}
      </button>
    </div>
  )
}
