import { useEffect, useMemo, useState } from "react"
import { SalesPackage, SalesPackageRow, mapSalesPackage } from "../../data/packages"
import {
  invokeContractReview,
  requestContractReview,
} from "../../data/contractReviewActions"
import { supabase } from "../../supabaseClient"
import { Button, Modal } from "../ui"
import { useI18n } from "../../i18n/I18nProvider"
import { usePermissions } from "../../hooks/usePermissions"
import ClientCodeLookup, { ClientLookupResult } from "./ClientCodeLookup"

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (dealId: string) => void
  initialLeadId?: string
  /** Manager / admin: recording is optional (they may close without a recorded sales meeting). */
  role?: "manager" | "admin"
}

interface LeadOption {
  id: string
  name: string
  phone: string | null
  clientCode?: string | null
}

/** Value of the "custom service" entry in the package list (create_custom_deal, 056). */
const CUSTOM_PACKAGE = "__custom__"

/** Text safe inside a PostgREST or() filter. */
function filterText(value: string) {
  return value.replace(/[,()%*\\]/g, " ").trim()
}

function leadLabel(lead: LeadOption) {
  const name = lead.name || lead.phone || lead.clientCode || "—"
  return [name, lead.phone !== name ? lead.phone : "", lead.clientCode !== name ? lead.clientCode : ""]
    .filter(Boolean)
    .join(" — ")
}

const formatSar = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "SAR",
})

function localDateToday() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function safeFilename(name: string) {
  return name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "recording"
}

export default function DealCreateModal({
  open,
  onClose,
  onCreated,
  initialLeadId,
  role,
}: Props) {
  const { t } = useI18n()
  const { can } = usePermissions()
  const seeMinPrice = can("packages.view_min_price")
  const reviewLabel = (status: string | null | undefined) => t((status ?? "submitted").replace("_", " "))
  const [leads, setLeads] = useState<LeadOption[]>([])
  const [leadSearch, setLeadSearch] = useState("")
  const [leadId, setLeadId] = useState(initialLeadId ?? "")
  const [packages, setPackages] = useState<SalesPackage[]>([])
  const [packageId, setPackageId] = useState("")
  const [priceSar, setPriceSar] = useState("")
  const [serviceName, setServiceName] = useState("")
  const [durationMonths, setDurationMonths] = useState("")
  const [startDate, setStartDate] = useState(localDateToday)
  const [notes, setNotes] = useState("")
  const [recording, setRecording] = useState<File | null>(null)
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attachingContract, setAttachingContract] = useState(false)
  const [createdDealId, setCreatedDealId] = useState("")
  const [recordingAttached, setRecordingAttached] = useState(false)
  const [contractAttached, setContractAttached] = useState(false)
  const [contractReviewId, setContractReviewId] = useState("")
  const [reviewStatus, setReviewStatus] = useState("")
  const [retryingReview, setRetryingReview] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  // Client picked by code (ClientCodeLookup); bumping lookupKey clears the code field.
  const [codeClient, setCodeClient] = useState<ClientLookupResult | null>(null)
  const [lookupKey, setLookupKey] = useState(0)
  const priceIsValid = priceSar.trim() !== "" && Number.isFinite(Number(priceSar)) && Number(priceSar) >= 0

  function changeClient() {
    setCodeClient(null)
    setLeadId("")
    setLookupKey((key) => key + 1)
  }

  const isCustom = packageId === CUSTOM_PACKAGE
  const durationIsValid =
    Number.isInteger(Number(durationMonths)) && Number(durationMonths) >= 1 && Number(durationMonths) <= 120
  const customIsValid = !isCustom || (serviceName.trim() !== "" && durationIsValid)

  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === packageId),
    [packages, packageId],
  )
  const isBelowMinimum =
    seeMinPrice &&
    selectedPackage !== undefined &&
    priceSar.trim() !== "" &&
    Number.isFinite(Number(priceSar)) &&
    Number(priceSar) < selectedPackage.minPriceSar

  useEffect(() => {
    if (!open) return
    let active = true
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        const search = filterText(leadSearch)
        const leadQuery = supabase
          .from("leads")
          .select("id, name, phone, client_code")
          .order("updated_at", { ascending: false })
          .range(0, 24)
        // Sales can't read the telesales lead (RLS); their meetings carry a copy of name/phone/code (056).
        let meetingQuery = supabase
          .from("meetings")
          .select("lead_id, lead_name, lead_phone, client_code")
          .order("proposed_date", { ascending: false })
          .range(0, 49)
        if (initialLeadId) meetingQuery = meetingQuery.eq("lead_id", initialLeadId)
        else if (search)
          meetingQuery = meetingQuery.or(
            `lead_name.ilike.%${search}%,lead_phone.ilike.%${search}%,client_code.ilike.%${search}%`,
          )
        const [
          { data: leadRows, error: leadError },
          { data: packageRows, error: packageError },
          { data: meetingRows, error: meetingError },
        ] = await Promise.all([
            initialLeadId
              ? supabase
                  .from("leads")
                  .select("id, name, phone, client_code")
                  .eq("id", initialLeadId)
                  .limit(1)
              : search
                ? leadQuery.or(`name.ilike.%${search}%,phone.ilike.%${search}%,client_code.ilike.%${search}%`)
                : leadQuery,
            supabase
              .from("packages")
              .select(
                "id, name, description, features, duration_months, price_sar, min_price_sar, is_active",
              )
              .eq("is_active", true)
              .order("price_sar")
              .range(0, 99),
            meetingQuery,
          ])
        if (!active) return
        if (leadError || packageError || meetingError) {
          setError(leadError?.message ?? packageError?.message ?? meetingError?.message ?? t("Could not load deal data."))
        } else {
          const leadOptions: LeadOption[] = (leadRows ?? []).map((row) => ({
            id: row.id,
            name: row.name ?? "",
            phone: row.phone,
            clientCode: row.client_code,
          }))
          for (const row of meetingRows ?? []) {
            if (leadOptions.some((lead) => lead.id === row.lead_id)) continue
            leadOptions.push({
              id: row.lead_id,
              name: row.lead_name ?? "",
              phone: row.lead_phone,
              clientCode: row.client_code,
            })
          }
          setLeads(leadOptions)
          if (initialLeadId) setLeadId(initialLeadId)
          else if (!leadId && leadOptions.length > 0) setLeadId(leadOptions[0].id)
          const packageOptions = ((packageRows ?? []) as SalesPackageRow[]).map(mapSalesPackage)
          setPackages(packageOptions)
          if (packageId !== CUSTOM_PACKAGE && !packageOptions.some((item) => item.id === packageId)) {
            setPackageId(packageOptions[0]?.id ?? "")
          }
        }
        setLoading(false)
      })()
    }, leadSearch ? 250 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [open, leadSearch, initialLeadId])

  async function createDeal() {
    if (saving || createdDealId) return
    setError("")
    setSuccess("")
    const numericPrice = Number(priceSar)
    const recordingRequired = !role
    if (!customIsValid) {
      setError(t("Enter the service name and a duration of 1 to 120 months."))
      return
    }
    if (!leadId || !packageId || !Number.isFinite(numericPrice) || numericPrice < 0 || !startDate || (recordingRequired && !recording)) {
      setError(
        recordingRequired
          ? t("Choose a lead and package, enter the closing price and start date, and attach a meeting recording.")
          : t("Choose a lead and package, and enter the closing price and start date.")
      )
      return
    }

    setSaving(true)
    const { data: dealId, error: createError } = isCustom
      ? await supabase.rpc("create_custom_deal", {
          target_lead_id: leadId,
          custom_service_name: serviceName.trim(),
          custom_duration_months: Number(durationMonths),
          target_price_sar: numericPrice,
          target_start_date: startDate,
          deal_notes: notes.trim() || null,
        })
      : await supabase.rpc("create_deal", {
          target_lead_id: leadId,
          target_package_id: packageId,
          target_price_sar: numericPrice,
          target_start_date: startDate,
          deal_notes: notes.trim() || null,
        })
    if (createError || !dealId) {
      setError(createError?.message ?? t("The deal could not be created."))
      setSaving(false)
      return
    }

    setCreatedDealId(dealId)
    onCreated(dealId)
    if (!recording) {
      setSuccess(t("Deal created."))
      setRecordingAttached(true)
      setSaving(false)
      return
    }
    const objectPath = `${dealId}/${crypto.randomUUID()}-${safeFilename(recording.name)}`
    const { error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(objectPath, recording, { upsert: false })
    if (uploadError) {
      setError(t("Deal {id} was created, but the recording upload failed: {msg}", { id: dealId, msg: uploadError.message }))
      setSaving(false)
      return
    }

    const { error: attachError } = await supabase.rpc("attach_recording", {
      target_deal_id: dealId,
      target_recording_path: objectPath,
    })
    if (attachError) {
      setError(t("Deal {id} was created and the recording uploaded, but it could not be attached: {msg}", { id: dealId, msg: attachError.message }))
      setSaving(false)
      return
    }
    setSuccess(t("Deal created and meeting recording attached."))
    setRecordingAttached(true)
    setSaving(false)
  }

  async function retryRecording() {
    if (!createdDealId || !recording || saving) return
    setSaving(true)
    setError("")
    const objectPath = `${createdDealId}/${crypto.randomUUID()}-${safeFilename(recording.name)}`
    const { error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(objectPath, recording, { upsert: false })
    if (uploadError) {
      setError(t("Recording upload failed: {msg}", { msg: uploadError.message }))
      setSaving(false)
      return
    }
    const { error: attachError } = await supabase.rpc("attach_recording", {
      target_deal_id: createdDealId,
      target_recording_path: objectPath,
    })
    if (attachError) {
      setError(t("Recording uploaded but could not be attached: {msg}", { msg: attachError.message }))
    } else {
      setRecordingAttached(true)
      setSuccess(t("Meeting recording attached."))
      onCreated(createdDealId)
    }
    setSaving(false)
  }

  async function attachContract() {
    if (!createdDealId || !contractFile || attachingContract) return
    setError("")
    setAttachingContract(true)
    const objectPath = `${createdDealId}/${crypto.randomUUID()}-${safeFilename(contractFile.name)}`
    const { error: uploadError } = await supabase.storage
      .from("contracts")
      .upload(objectPath, contractFile, { upsert: false })
    if (uploadError) {
      setError(t("Contract upload failed: {msg}", { msg: uploadError.message }))
      setAttachingContract(false)
      return
    }
    const { data: reviewId, error: attachError } = await supabase.rpc("attach_contract", {
      target_deal_id: createdDealId,
      target_contract_path: objectPath,
    })
    if (attachError || typeof reviewId !== "string") {
      setError(t("Contract uploaded but could not be attached: {msg}", { msg: attachError?.message ?? t("No review ID was returned.") }))
      setAttachingContract(false)
      return
    }
    setContractAttached(true)
    setContractReviewId(reviewId)
    const result = await invokeContractReview(reviewId)
    if (result.error) {
      setError(t("Contract attached, but AI review failed: {msg}", { msg: result.error }))
    } else {
      setReviewStatus(result.status ?? "submitted")
      setSuccess(t("Contract attached. AI review status: {status}.", { status: reviewLabel(result.status) }))
    }
    setAttachingContract(false)
  }

  async function retryContractReview() {
    if (!createdDealId || retryingReview) return
    setError("")
    setRetryingReview(true)
    const result = await requestContractReview(createdDealId)
    if (result.error) {
      setError(result.error)
    } else {
      setReviewStatus(result.status ?? "submitted")
      setSuccess(t("AI review status: {status}.", { status: reviewLabel(result.status) }))
    }
    setRetryingReview(false)
  }

  function closeModal() {
    if (saving) return
    setError("")
    setSuccess("")
    setCreatedDealId("")
    setRecordingAttached(false)
    setContractAttached(false)
    setContractReviewId("")
    setReviewStatus("")
    setLeadSearch("")
    setLeadId(initialLeadId ?? "")
    setPackageId("")
    setPriceSar("")
    setServiceName("")
    setDurationMonths("")
    setStartDate(localDateToday())
    setNotes("")
    setRecording(null)
    setContractFile(null)
    setCodeClient(null)
    setLookupKey((key) => key + 1)
    onClose()
  }

  return (
    <Modal open={open} onClose={closeModal} title="New Deal">
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-shake">
            {error}
          </div>
        )}
        {success && (
          <div role="status" className="rounded border border-[#64dc78]/30 bg-[#64dc78]/10 p-3 text-sm text-[#64dc78]">
            {success}
          </div>
        )}
        {createdDealId && !recordingAttached && (
          <div className="space-y-2 rounded border border-[#ffc832]/30 p-3">
            <label className="block text-xs text-[#a0a0a0]">
              {t("Meeting recording *")}
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={(event) => setRecording(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-[#a0a0a0] file:me-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
              />
            </label>
            <Button disabled={!recording || saving} onClick={() => void retryRecording()}>
              {saving ? t("Attaching recording...") : t("Retry recording upload")}
            </Button>
          </div>
        )}
        {createdDealId && recordingAttached && !contractAttached && (
          <div className="space-y-2 rounded border border-[#2a2a2a] p-3">
            <label className="block text-xs text-[#a0a0a0]">
              {t("Signed contract (optional, PDF or image)")}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => setContractFile(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-[#a0a0a0] file:me-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
              />
            </label>
            <Button disabled={!contractFile || attachingContract} onClick={() => void attachContract()}>
              {attachingContract ? t("Uploading contract...") : t("Upload & Attach Contract")}
            </Button>
          </div>
        )}
        {createdDealId && contractAttached && (
          <div className="space-y-2 rounded border border-[#2a2a2a] p-3">
            <div className="text-sm text-[#a0a0a0]">
              {t("Contract review:")} {reviewStatus ? reviewLabel(reviewStatus) : contractReviewId ? t("submitted") : t("not started")}
            </div>
            <Button
              variant="secondary"
              disabled={retryingReview}
              onClick={() => void retryContractReview()}
            >
              {retryingReview ? t("Retrying review...") : t("Retry AI review")}
            </Button>
          </div>
        )}
        {!createdDealId && (
          <>
            {!initialLeadId && (
              <ClientCodeLookup
                key={lookupKey}
                onFound={(client) => {
                  setCodeClient(client)
                  setLeadId(client.lead_id)
                  setLeads((prev) =>
                    prev.some((lead) => lead.id === client.lead_id)
                      ? prev
                      : [{ id: client.lead_id, name: client.name ?? "", phone: client.phone }, ...prev],
                  )
                }}
                onClear={() => {
                  setCodeClient(null)
                  if (!initialLeadId) setLeadId("")
                }}
                disabled={!!initialLeadId}
              />
            )}
            {codeClient ? (
              <div className="flex items-center justify-between gap-3 rounded border border-[#2a2a2a] bg-[#1a1a1a] p-3">
                <div className="min-w-0 text-xs text-[#a0a0a0]">
                  {t("Lead *")}
                  <div className="truncate text-sm font-medium text-white">{codeClient.name || "—"}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={changeClient}>{t("Change client")}</Button>
              </div>
            ) : (
            <>
            {!initialLeadId && (
              <label className="block text-xs text-[#a0a0a0]">
                {t("Find lead")}
                <input
                  value={leadSearch}
                  onChange={(event) => setLeadSearch(event.target.value)}
                  placeholder={t("Search name, phone or client code...")}
                  className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                />
              </label>
            )}
            <label className="block text-xs text-[#a0a0a0]">
              {t("Lead *")}
              <select
                value={leadId}
                onChange={(event) => setLeadId(event.target.value)}
                disabled={Boolean(initialLeadId) || loading}
                className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
              >
                <option value="">{t("Select a lead")}</option>
                {leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {leadLabel(lead)}
                  </option>
                ))}
              </select>
              {!loading && leads.length === 0 && (
                <span className="mt-1 block text-xs text-[#ffc832]">
                  {t("No accessible leads found. Sales can close only leads with an assigned meeting.")}
                </span>
              )}
            </label>
            </>
            )}
            <label className="block text-xs text-[#a0a0a0]">
              {t("Package *")}
              <select
                value={packageId}
                onChange={(event) => setPackageId(event.target.value)}
                className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
              >
                <option value="">{t("Select a package")}</option>
                {packages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {formatSar.format(item.priceSar)}
                  </option>
                ))}
                <option value={CUSTOM_PACKAGE}>{t("➕ Custom service (not one of the packages)")}</option>
              </select>
            </label>
            {isCustom && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-[#a0a0a0]">
                  {t("Service name *")}
                  <input
                    value={serviceName}
                    maxLength={200}
                    onChange={(event) => setServiceName(event.target.value)}
                    className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block text-xs text-[#a0a0a0]">
                  {t("Duration (months) *")}
                  <input
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    value={durationMonths}
                    onChange={(event) => setDurationMonths(event.target.value)}
                    className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>
            )}
            {selectedPackage && (
              <div className="rounded bg-[#1a1a1a] p-3 text-xs text-[#a0a0a0]">
                {seeMinPrice
                  ? t("List price: {price} · Minimum: {min} · {n} months", {
                      price: formatSar.format(selectedPackage.priceSar),
                      min: formatSar.format(selectedPackage.minPriceSar),
                      n: selectedPackage.durationMonths,
                    })
                  : t("List price: {price} · {n} months", {
                      price: formatSar.format(selectedPackage.priceSar),
                      n: selectedPackage.durationMonths,
                    })}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[#a0a0a0]">
                {t("Closing price (SAR) *")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceSar}
                  onChange={(event) => setPriceSar(event.target.value)}
                  className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block text-xs text-[#a0a0a0]">
                {t("Start date *")}
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
            {isBelowMinimum && (
              <div role="alert" className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-3 text-sm text-[#ffc832] anim-banner">
                {t("This closing price is below the package minimum. The deal will be flagged for the approver.")}
              </div>
            )}
            <label className="block text-xs text-[#a0a0a0]">
              {role ? t("Meeting recording (optional)") : t("Meeting recording *")}
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={(event) => setRecording(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-[#a0a0a0] file:me-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
              />
            </label>
            <label className="block text-xs text-[#a0a0a0]">
              {t("Notes")}
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1 w-full resize-y rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
              />
            </label>
          </>
        )}
        <div className="flex gap-2">
          {!createdDealId && (
            <Button disabled={saving || loading || !leadId || !packageId || !priceIsValid || !customIsValid} onClick={() => void createDeal()}>
              {saving ? t("Creating deal...") : t("Create Deal")}
            </Button>
          )}
          <Button variant="ghost" disabled={saving} onClick={closeModal}>
            {createdDealId ? t("Done") : t("Cancel")}
          </Button>
        </div>
        {createdDealId && (
          <p className="text-xs text-[#6b6b6b]">{t("Deal reference: {id}", { id: createdDealId })}</p>
        )}
      </div>
    </Modal>
  )
}
