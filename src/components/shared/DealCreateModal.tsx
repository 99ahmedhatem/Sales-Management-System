import { useEffect, useMemo, useState } from "react"
import { SalesPackage, SalesPackageRow, mapSalesPackage } from "../../data/packages"
import {
  invokeContractReview,
  requestContractReview,
} from "../../data/contractReviewActions"
import { supabase } from "../../supabaseClient"
import { Button, Modal } from "../ui"

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (dealId: string) => void
  initialLeadId?: string
  role?: "manager"
}

interface LeadOption {
  id: string
  name: string
  phone: string | null
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
  const [leads, setLeads] = useState<LeadOption[]>([])
  const [leadSearch, setLeadSearch] = useState("")
  const [leadId, setLeadId] = useState(initialLeadId ?? "")
  const [packages, setPackages] = useState<SalesPackage[]>([])
  const [packageId, setPackageId] = useState("")
  const [priceSar, setPriceSar] = useState("")
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

  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === packageId),
    [packages, packageId],
  )
  const isBelowMinimum =
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
        const leadQuery = supabase
          .from("leads")
          .select("id, name, phone")
          .order("updated_at", { ascending: false })
          .range(0, 24)
        const [{ data: leadRows, error: leadError }, { data: packageRows, error: packageError }] =
          await Promise.all([
            initialLeadId
              ? supabase
                  .from("leads")
                  .select("id, name, phone")
                  .eq("id", initialLeadId)
                  .limit(1)
              : leadSearch.trim()
                ? leadQuery.ilike("name", `%${leadSearch.trim()}%`)
                : leadQuery,
            supabase
              .from("packages")
              .select(
                "id, name, description, features, duration_months, price_sar, min_price_sar, is_active",
              )
              .eq("is_active", true)
              .order("price_sar")
              .range(0, 99),
          ])
        if (!active) return
        if (leadError || packageError) {
          setError(leadError?.message ?? packageError?.message ?? "Could not load deal data.")
        } else {
          const leadOptions = (leadRows ?? []) as LeadOption[]
          setLeads(leadOptions)
          if (initialLeadId) setLeadId(initialLeadId)
          else if (!leadId && leadOptions.length > 0) setLeadId(leadOptions[0].id)
          const packageOptions = ((packageRows ?? []) as SalesPackageRow[]).map(mapSalesPackage)
          setPackages(packageOptions)
          if (!packageOptions.some((item) => item.id === packageId)) {
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
    const recordingRequired = role !== "manager"
    if (!leadId || !packageId || !Number.isFinite(numericPrice) || numericPrice < 0 || !startDate || (recordingRequired && !recording)) {
      setError(
        recordingRequired
          ? "Choose a lead and package, enter the closing price and start date, and attach a meeting recording."
          : "Choose a lead and package, and enter the closing price and start date."
      )
      return
    }

    setSaving(true)
    const { data: dealId, error: createError } = await supabase.rpc("create_deal", {
      target_lead_id: leadId,
      target_package_id: packageId,
      target_price_sar: numericPrice,
      target_start_date: startDate,
      deal_notes: notes.trim() || null,
    })
    if (createError || !dealId) {
      setError(createError?.message ?? "The deal could not be created.")
      setSaving(false)
      return
    }

    setCreatedDealId(dealId)
    onCreated(dealId)
    if (!recording) {
      setSuccess("Deal created.")
      setRecordingAttached(true)
      setSaving(false)
      return
    }
    const objectPath = `${dealId}/${crypto.randomUUID()}-${safeFilename(recording.name)}`
    const { error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(objectPath, recording, { upsert: false })
    if (uploadError) {
      setError(`Deal ${dealId} was created, but the recording upload failed: ${uploadError.message}`)
      setSaving(false)
      return
    }

    const { error: attachError } = await supabase.rpc("attach_recording", {
      target_deal_id: dealId,
      target_recording_path: objectPath,
    })
    if (attachError) {
      setError(`Deal ${dealId} was created and the recording uploaded, but it could not be attached: ${attachError.message}`)
      setSaving(false)
      return
    }
    setSuccess("Deal created and meeting recording attached.")
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
      setError(`Recording upload failed: ${uploadError.message}`)
      setSaving(false)
      return
    }
    const { error: attachError } = await supabase.rpc("attach_recording", {
      target_deal_id: createdDealId,
      target_recording_path: objectPath,
    })
    if (attachError) {
      setError(`Recording uploaded but could not be attached: ${attachError.message}`)
    } else {
      setRecordingAttached(true)
      setSuccess("Meeting recording attached.")
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
      setError(`Contract upload failed: ${uploadError.message}`)
      setAttachingContract(false)
      return
    }
    const { data: reviewId, error: attachError } = await supabase.rpc("attach_contract", {
      target_deal_id: createdDealId,
      target_contract_path: objectPath,
    })
    if (attachError || typeof reviewId !== "string") {
      setError(`Contract uploaded but could not be attached: ${attachError?.message ?? "No review ID was returned."}`)
      setAttachingContract(false)
      return
    }
    setContractAttached(true)
    setContractReviewId(reviewId)
    const result = await invokeContractReview(reviewId)
    if (result.error) {
      setError(`Contract attached, but AI review failed: ${result.error}`)
    } else {
      setReviewStatus(result.status?.replace("_", " ") ?? "submitted")
      setSuccess(`Contract attached. AI review status: ${result.status?.replace("_", " ") ?? "submitted"}.`)
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
      setReviewStatus(result.status?.replace("_", " ") ?? "submitted")
      setSuccess(`AI review status: ${result.status?.replace("_", " ") ?? "submitted"}.`)
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
    setStartDate(localDateToday())
    setNotes("")
    setRecording(null)
    setContractFile(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={closeModal} title="New Deal">
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]">
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
              Meeting recording *
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={(event) => setRecording(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-[#a0a0a0] file:mr-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
              />
            </label>
            <Button disabled={!recording || saving} onClick={() => void retryRecording()}>
              {saving ? "Attaching recording..." : "Retry recording upload"}
            </Button>
          </div>
        )}
        {createdDealId && recordingAttached && !contractAttached && (
          <div className="space-y-2 rounded border border-[#2a2a2a] p-3">
            <label className="block text-xs text-[#a0a0a0]">
              Signed contract (optional, PDF or image)
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => setContractFile(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-[#a0a0a0] file:mr-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
              />
            </label>
            <Button disabled={!contractFile || attachingContract} onClick={() => void attachContract()}>
              {attachingContract ? "Uploading contract..." : "Upload & Attach Contract"}
            </Button>
          </div>
        )}
        {createdDealId && contractAttached && (
          <div className="space-y-2 rounded border border-[#2a2a2a] p-3">
            <div className="text-sm text-[#a0a0a0]">
              Contract review: {reviewStatus || (contractReviewId ? "submitted" : "not started")}
            </div>
            <Button
              variant="secondary"
              disabled={retryingReview}
              onClick={() => void retryContractReview()}
            >
              {retryingReview ? "Retrying review..." : "Retry AI review"}
            </Button>
          </div>
        )}
        {!createdDealId && (
          <>
            {!initialLeadId && (
              <label className="block text-xs text-[#a0a0a0]">
                Find lead
                <input
                  value={leadSearch}
                  onChange={(event) => setLeadSearch(event.target.value)}
                  placeholder="Search lead name..."
                  className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                />
              </label>
            )}
            <label className="block text-xs text-[#a0a0a0]">
              Lead *
              <select
                value={leadId}
                onChange={(event) => setLeadId(event.target.value)}
                disabled={Boolean(initialLeadId) || loading}
                className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
              >
                <option value="">Select a lead</option>
                {leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name}{lead.phone ? ` — ${lead.phone}` : ""}
                  </option>
                ))}
              </select>
              {!loading && leads.length === 0 && (
                <span className="mt-1 block text-xs text-[#ffc832]">
                  No accessible leads found. Sales can close only leads with an assigned meeting.
                </span>
              )}
            </label>
            <label className="block text-xs text-[#a0a0a0]">
              Package *
              <select
                value={packageId}
                onChange={(event) => setPackageId(event.target.value)}
                className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
              >
                <option value="">Select a package</option>
                {packages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {formatSar.format(item.priceSar)}
                  </option>
                ))}
              </select>
            </label>
            {selectedPackage && (
              <div className="rounded bg-[#1a1a1a] p-3 text-xs text-[#a0a0a0]">
                List price: {formatSar.format(selectedPackage.priceSar)} · Minimum:{" "}
                {formatSar.format(selectedPackage.minPriceSar)} · {selectedPackage.durationMonths} months
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[#a0a0a0]">
                Closing price (SAR) *
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
                Start date *
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
            {isBelowMinimum && (
              <div role="alert" className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-3 text-sm text-[#ffc832]">
                This closing price is below the package minimum. The deal will be flagged for the approver.
              </div>
            )}
            <label className="block text-xs text-[#a0a0a0]">
              {role === "manager" ? "Meeting recording (optional)" : "Meeting recording *"}
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={(event) => setRecording(event.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-[#a0a0a0] file:mr-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
              />
            </label>
            <label className="block text-xs text-[#a0a0a0]">
              Notes
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
            <Button disabled={saving || loading} onClick={() => void createDeal()}>
              {saving ? "Creating deal..." : "Create Deal"}
            </Button>
          )}
          <Button variant="ghost" disabled={saving} onClick={closeModal}>
            {createdDealId ? "Done" : "Cancel"}
          </Button>
        </div>
        {createdDealId && (
          <p className="text-xs text-[#6b6b6b]">Deal reference: {createdDealId}</p>
        )}
      </div>
    </Modal>
  )
}
