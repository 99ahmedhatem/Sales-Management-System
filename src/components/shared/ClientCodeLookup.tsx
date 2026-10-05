import { useEffect, useRef, useState } from "react"
import { supabase } from "../../supabaseClient"
import { useI18n } from "../../i18n/I18nProvider"

/** One row of lookup_client_for_deal (022). */
export interface ClientLookupResult {
  lead_id: string
  name: string | null
  phone: string | null
  client_code: string | null
  customer_number: number | null
  status: string | null
  owner_name: string | null
  open_deal_status: string | null
  reason: string | null
}

interface Props {
  onFound: (client: ClientLookupResult) => void
  onClear: () => void
  disabled?: boolean
}

/**
 * Type a client code, customer number or phone; the client is looked up automatically
 * (lookup_client_for_deal checks the caller may close a deal for them). create_deal still
 * enforces the real permission — this is only for display and early feedback.
 */
export default function ClientCodeLookup({ onFound, onClear, disabled }: Props) {
  const { t } = useI18n()
  const [code, setCode] = useState("")
  const [client, setClient] = useState<ClientLookupResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")
  const requestId = useRef(0)
  // Latest callbacks without re-running the lookup effect when the parent re-renders.
  const callbacks = useRef({ onFound, onClear })
  callbacks.current = { onFound, onClear }

  useEffect(() => {
    const value = code.trim()
    setError("")
    if (!value) {
      if (client) {
        setClient(null)
        callbacks.current.onClear()
      }
      return
    }
    const id = ++requestId.current
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true)
        const { data, error: rpcError } = await supabase.rpc("lookup_client_for_deal", { p_code: value })
        if (id !== requestId.current) return
        setSearching(false)
        const row = (Array.isArray(data) ? data[0] : data) as ClientLookupResult | null | undefined
        if (rpcError || !row) {
          setError(rpcError?.message ?? "No client found with this code")
          if (client) {
            setClient(null)
            callbacks.current.onClear()
          }
          return
        }
        setClient(row)
        callbacks.current.onFound(row)
      })()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [code])

  return (
    <div className="space-y-2">
      <label className="block text-xs text-[#a0a0a0]">
        {t("Client code")}
        <input
          value={code}
          disabled={disabled}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t("Client code, customer number or phone")}
          dir="ltr"
          className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white disabled:opacity-50"
        />
      </label>
      {searching && <div className="text-xs text-[#6b6b6b]">{t("Searching…")}</div>}
      {!searching && error && <div className="text-xs text-[#ff8888]">{t(error)}</div>}
      {!searching && client && (
        <div className="rounded border border-[#dfff03]/30 bg-[#dfff03]/5 p-3 text-xs space-y-1">
          <div className="text-sm font-medium text-white">{client.name || "—"}</div>
          <div className="text-[#a0a0a0]" dir="ltr">
            {[client.client_code, client.customer_number != null ? `#${client.customer_number}` : null, client.phone].filter(Boolean).join(" · ")}
          </div>
          <div className="text-[#6b6b6b]">
            {t("Status")}: {client.status ? t(client.status) : "—"} · {t("Owner")}: {client.owner_name ?? "—"}
          </div>
          {client.reason && (
            <div role="alert" className="mt-1 rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-2 text-[#ffc832] anim-banner">
              {t(client.reason)}{client.open_deal_status ? ` (${t(client.open_deal_status.replace("_", " "))})` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
