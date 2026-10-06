import { TableSkeleton } from "./motion"
import { useCallback, useEffect, useState } from "react"
import { Deal, loadDealsPage } from "../../data/deals"
import {
  ContractReview,
  ContractReviewRow,
  mapContractReview,
} from "../../data/contractReviews"
import {
  invokeContractReview,
  requestContractReview,
} from "../../data/contractReviewActions"
import { supabase } from "../../supabaseClient"
import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"
import { Button, Card, Modal, Pagination, SearchInput, StatusBadge, Table, Td, Tr } from "../ui"
import DealCreateModal from "./DealCreateModal"
import { useI18n } from "../../i18n/I18nProvider"
import { ClientLink } from "./AppOverlays"
import { DealInstallments } from "./Installments"
import { onOpenDeal, takePendingDealId } from "../../lib/navigation"
import { usePermissions } from "../../hooks/usePermissions"

interface Props {
  userId: string
  role: "admin" | "manager" | "sales" | "telesales"
}

const PAGE_SIZE = 25
const formatSar = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "SAR",
})

const STATUS_LABELS: Record<Deal["status"], string> = {
  draft: "Draft",
  contract_uploaded: "Contract Uploaded",
  pending_approval: "Pending Approval",
  approved: "Approved",
  active: "Active",
  cancelled: "Cancelled",
}

export default function ContractsModule({ userId, role }: Props) {
  const { t } = useI18n()
  const { can } = usePermissions()
  const [deals, setDeals] = useState<Deal[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [review, setReview] = useState<ContractReview | null>(null)
  const [loadingReview, setLoadingReview] = useState(false)
  const [reviewAction, setReviewAction] = useState(false)
  const [approvalOverrideOpen, setApprovalOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [signedRecordingUrl, setSignedRecordingUrl] = useState("")
  const [signedContractUrl, setSignedContractUrl] = useState("")
  const [signingUrls, setSigningUrls] = useState(false)
  const [uploadingContract, setUploadingContract] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    const result = await loadDealsPage(page, PAGE_SIZE)
    if (result.error || result.data === null) {
      setDeals([])
      setTotal(0)
      setError(result.error ?? "Could not load deals.")
    } else {
      setDeals(result.data)
      setTotal(result.count)
    }
    setLoading(false)
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  useRealtimeRefresh(["deals"], () => void load())

  // "Open deal" from the client card or the installments panel
  const openDealById = useCallback(async (dealId: string) => {
    const result = await loadDealsPage(0, 1, dealId)
    if (result.error) setError(result.error)
    else if (result.data?.[0]) { setError(""); setSelectedDeal(result.data[0]) }
    else setError("Deal not found or you don't have access to it.")
  }, [])

  useEffect(() => {
    const pending = takePendingDealId()
    if (pending) void openDealById(pending)
    return onOpenDeal((dealId) => { takePendingDealId(); void openDealById(dealId) })
  }, [openDealById])

  useEffect(() => {
    if (!selectedDeal) return
    const latest = deals.find((deal) => deal.id === selectedDeal.id)
    if (latest && latest !== selectedDeal) setSelectedDeal(latest)
  }, [deals, selectedDeal])

  async function loadReview(dealId: string) {
    setLoadingReview(true)
    const { data, error: queryError } = await supabase
      .from("contract_reviews")
      .select("id, deal_id, status, extracted, mismatches, summary, error, model, created_at, completed_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (queryError) {
      setError(queryError.message)
      setReview(null)
    } else {
      setReview(data ? mapContractReview(data as ContractReviewRow) : null)
    }
    setLoadingReview(false)
  }

  useRealtimeRefresh(
    ["contract_reviews"],
    () => {
      if (selectedDeal) void loadReview(selectedDeal.id)
    },
  )

  useEffect(() => {
    if (selectedDeal) void loadReview(selectedDeal.id)
    else setReview(null)
  }, [selectedDeal])

  useEffect(() => {
    let active = true
    async function loadSignedUrls() {
      setSignedRecordingUrl("")
      setSignedContractUrl("")
      if (!selectedDeal) return
      setSigningUrls(true)
      const [recordingResult, contractResult] = await Promise.all([
        selectedDeal.recordingPath
          ? supabase.storage.from("recordings").createSignedUrl(selectedDeal.recordingPath, 3600)
          : Promise.resolve({ data: null, error: null }),
        selectedDeal.contractPath
          ? supabase.storage.from("contracts").createSignedUrl(selectedDeal.contractPath, 3600)
          : Promise.resolve({ data: null, error: null }),
      ])
      if (!active) return
      if (recordingResult.error || contractResult.error) {
        setError(recordingResult.error?.message ?? contractResult.error?.message ?? "Could not create secure file links.")
      }
      setSignedRecordingUrl(recordingResult.data?.signedUrl ?? "")
      setSignedContractUrl(contractResult.data?.signedUrl ?? "")
      setSigningUrls(false)
    }
    void loadSignedUrls()
    return () => {
      active = false
    }
  }, [selectedDeal])

  const visibleDeals = deals.filter((deal) => {
    const query = search.trim().toLowerCase()
    return (
      !query ||
      deal.leadName.toLowerCase().includes(query) ||
      deal.leadPhone.toLowerCase().includes(query) ||
      deal.packageName.toLowerCase().includes(query)
    )
  })
  const canCreateDeal = (role === "sales" || role === "telesales" || role === "manager") && can("deals.create")
  const canUploadContract =
    canCreateDeal && selectedDeal?.closedByUserId === userId
  const canApprove = (role === "admin" || role === "manager") && can("deals.approve")
  const canRequestReview =
    role === "admin" ||
    role === "manager" ||
    selectedDeal?.closedByUserId === userId

  async function uploadContract() {
    if (!selectedDeal || !contractFile || uploadingContract) return
    setError("")
    setUploadingContract(true)
    const filename = contractFile.name.replace(/[^\w.-]+/g, "_") || "contract"
    const path = `${selectedDeal.id}/${crypto.randomUUID()}-${filename}`
    const { error: uploadError } = await supabase.storage
      .from("contracts")
      .upload(path, contractFile, { upsert: false })
    if (uploadError) {
      setError(uploadError.message)
      setUploadingContract(false)
      return
    }
    const { data: reviewId, error: attachError } = await supabase.rpc("attach_contract", {
      target_deal_id: selectedDeal.id,
      target_contract_path: path,
    })
    if (attachError || typeof reviewId !== "string") {
      setError(
        t("Contract uploaded but could not be attached: {msg}", { msg: attachError?.message ?? t("No review ID was returned.") }),
      )
      setUploadingContract(false)
      return
    }
    setSelectedDeal({ ...selectedDeal, contractPath: path, status: "contract_uploaded" })
    setContractFile(null)
    await loadReview(selectedDeal.id)
    const reviewResult = await invokeContractReview(reviewId)
    if (reviewResult.error) {
      setError(t("Contract attached, but AI review failed: {msg}", { msg: reviewResult.error }))
    } else if (reviewResult.status === "passed") {
      setError("")
    } else if (reviewResult.status === "needs_attention" || reviewResult.status === "failed") {
      setError("")
    }
    setUploadingContract(false)
    void load()
  }

  async function rerunReview() {
    if (!selectedDeal || reviewAction) return
    setError("")
    setReviewAction(true)
    const result =
      review?.status === "queued"
        ? await invokeContractReview(review.id)
        : await requestContractReview(selectedDeal.id)
    if (result.error) setError(result.error)
    await loadReview(selectedDeal.id)
    setReviewAction(false)
  }

  async function approveDeal(reason?: string) {
    if (!selectedDeal) return
    setError("")
    const { error: approvalError } = await supabase.rpc("approve_deal", {
      target_deal_id: selectedDeal.id,
      override_reason_text: reason ?? null,
    })
    if (approvalError) {
      setError(approvalError.message)
      return
    }
    setSelectedDeal({ ...selectedDeal, status: "approved" })
    setApprovalOverrideOpen(false)
    setOverrideReason("")
    void load()
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("Deals & Contracts")}</h1>
          <p className="mt-0.5 text-sm text-[#6b6b6b]">{t("{n} deals visible to your account", { n: total })}</p>
        </div>
        {canCreateDeal && (
          <Button onClick={() => setCreateOpen(true)}>{t("+ New Deal")}</Button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-banner">
          {t(error)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t("Deals on page")}</div>
          <div className="mt-2 text-2xl font-bold text-white">{visibleDeals.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t("Pending approval")}</div>
          <div className="mt-2 text-2xl font-bold text-[#ffc832]">{deals.filter((deal) => deal.status === "pending_approval").length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t("Below minimum")}</div>
          <div className="mt-2 text-2xl font-bold text-[#ffc832]">{deals.filter((deal) => deal.belowMinPrice).length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t("Deal value on page")}</div>
          <div className="mt-2 text-lg font-bold text-[#dfff03]">{formatSar.format(visibleDeals.reduce((sum, deal) => sum + deal.priceSar, 0))}</div>
        </Card>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search lead, phone, or package on this page..."
      />

      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]"><TableSkeleton /></div>
        ) : visibleDeals.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]">{t("No deals yet — request a meeting from a lead, then create the deal after the meeting.")}</div>
        ) : (
          <Table headers={["Client", "Package", "Closing price", "Dates", "Owner", "Status", ""]}>
            {visibleDeals.map((deal) => (
              <Tr key={deal.id} onClick={() => { setError(""); setSelectedDeal(deal) }}>
                <Td>
                  <div className="font-medium text-white"><ClientLink leadId={deal.leadId}>{deal.leadName}</ClientLink></div>
                  <div className="font-mono text-xs text-[#6b6b6b]" dir="ltr">{deal.leadPhone || "—"}</div>
                  {deal.belowMinPrice && <div className="mt-1 text-xs text-[#ffc832]">{t("Below package minimum")}</div>}
                </Td>
                <Td>
                  <div className="text-white">{deal.packageName}</div>
                  <div className="text-xs text-[#6b6b6b]">{t("{n} months · List {price}", { n: deal.packageDurationMonths, price: formatSar.format(deal.listPriceSar) })}</div>
                </Td>
                <Td><span className="font-mono text-white">{formatSar.format(deal.priceSar)}</span></Td>
                <Td>
                  <div className="font-mono text-xs text-[#a0a0a0]">{deal.startDate}</div>
                  <div className="font-mono text-xs text-[#6b6b6b]">{t("to {date}", { date: deal.endDate })}</div>
                </Td>
                <Td>
                  <div className="text-xs text-white">{deal.salesName || deal.telesalesName}</div>
                  {deal.salesName && <div className="text-xs text-[#6b6b6b]">{t("Telesales: {name}", { name: deal.telesalesName })}</div>}
                </Td>
                <Td><StatusBadge status={STATUS_LABELS[deal.status]} /></Td>
                <Td><Button variant="secondary" size="sm" onClick={() => { setError(""); setSelectedDeal(deal) }}>{t("Details")}</Button></Td>
              </Tr>
            ))}
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
      </Card>

      <Modal
        open={!!selectedDeal}
        onClose={() => { setSelectedDeal(null); setContractFile(null); setError("") }}
        title={t("Deal details — {name}", { name: selectedDeal?.leadName ?? "" })}
      >
        {selectedDeal && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge status={STATUS_LABELS[selectedDeal.status]} />
              <span className="font-mono text-xs text-[#6b6b6b]">{selectedDeal.id}</span>
            </div>
            {selectedDeal.belowMinPrice && (
              <div className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-3 text-sm text-[#ffc832]">
                {t("This closing price is below the package minimum ({min}). Reviewer attention is required.", { min: formatSar.format(selectedDeal.minPriceSar) })}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Client", selectedDeal.leadName],
                ["Phone", selectedDeal.leadPhone || "—"],
                ["Package", selectedDeal.packageName],
                ["Duration", t("{n} months", { n: selectedDeal.packageDurationMonths })],
                ["List price", formatSar.format(selectedDeal.listPriceSar)],
                ["Closing price", formatSar.format(selectedDeal.priceSar)],
                ["Start date", selectedDeal.startDate],
                ["End date", selectedDeal.endDate],
                ["Sales", selectedDeal.salesName || t("Self-closed by telesales")],
                ["Telesales", selectedDeal.telesalesName],
              ].map(([label, value]) => (
                <div key={label} className="rounded bg-[#1a1a1a] p-3">
                  <div className="text-xs text-[#6b6b6b]">{t(label)}</div>
                  <div className="mt-1 break-all text-sm text-white">{value}</div>
                </div>
              ))}
            </div>
            {selectedDeal.notes && (
              <div className="rounded bg-[#1a1a1a] p-3">
                <div className="text-xs text-[#6b6b6b]">{t("Notes")}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#d0d0d0]">{selectedDeal.notes}</p>
              </div>
            )}
            {selectedDeal.approvalOverrideReason && (
              <div className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-3">
                <div className="text-xs font-semibold text-[#ffc832]">{t("Admin approval override")}</div>
                <p className="mt-1 text-sm text-[#d0d0d0]">{selectedDeal.approvalOverrideReason}</p>
              </div>
            )}
            <DealInstallments
              dealId={selectedDeal.id}
              priceSar={selectedDeal.priceSar}
              dealStatus={selectedDeal.status}
              canManage={role === "admin" || role === "manager"}
            />
            <div className="space-y-2 rounded bg-[#1a1a1a] p-3">
              <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t("Private files")}</div>
              {signingUrls ? (
                <div className="text-sm text-[#6b6b6b]">{t("Preparing secure links...")}</div>
              ) : (
                <>
                  {selectedDeal.recordingPath ? (
                    signedRecordingUrl ? <a className="block text-sm text-[#dfff03] underline" href={signedRecordingUrl} target="_blank" rel="noreferrer">{t("Open meeting recording")}</a> : <div className="text-sm text-[#ffc832]">{t("Recording link unavailable.")}</div>
                  ) : <div className="text-sm text-[#6b6b6b]">{t("No meeting recording attached.")}</div>}
                  {selectedDeal.contractPath ? (
                    signedContractUrl ? <a className="block text-sm text-[#dfff03] underline" href={signedContractUrl} target="_blank" rel="noreferrer">{t("Open signed contract")}</a> : <div className="text-sm text-[#ffc832]">{t("Contract link unavailable.")}</div>
                  ) : <div className="text-sm text-[#6b6b6b]">{t("No signed contract attached.")}</div>}
                </>
              )}
            </div>
            <div className="space-y-3 rounded border border-[#2a2a2a] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">{t("AI contract review")}</div>
                  <div className="mt-1 text-sm text-white">
                    {loadingReview
                      ? t("Loading review...")
                      : review
                        ? t(review.status.replace("_", " "))
                        : t("No review submitted")}
                  </div>
                </div>
                {canRequestReview && selectedDeal.contractPath && review && review.status !== "processing" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={reviewAction}
                    onClick={() => void rerunReview()}
                  >
                    {reviewAction ? t("Reviewing...") : t("Re-run review")}
                  </Button>
                )}
              </div>
              {review?.summary && (
                <p className="text-sm leading-relaxed text-[#d0d0d0]">{review.summary}</p>
              )}
              {review?.error && (
                <div className="rounded bg-[#ff6464]/10 p-2 text-sm text-[#ff8888]">{review.error}</div>
              )}
              {review?.mismatches.length ? (
                <div className="space-y-2">
                  {review.mismatches.map((mismatch, index) => (
                    <div key={`${mismatch.field}-${index}`} className="rounded bg-[#0f0f0f] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white">{t(mismatch.field.replace(/_/g, " "))}</span>
                        <span className={mismatch.severity === "high" ? "text-xs font-semibold text-[#ff8888]" : "text-xs font-semibold text-[#ffc832]"}>
                          {t(mismatch.severity.toUpperCase())}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                        <div className="break-all text-[#a0a0a0]">{t("Expected:")} {JSON.stringify(mismatch.expected) ?? "—"}</div>
                        <div className="break-all text-[#a0a0a0]">{t("Found:")} {JSON.stringify(mismatch.found) ?? "—"}</div>
                      </div>
                      {mismatch.note && <div className="mt-1 text-xs text-[#6b6b6b]">{mismatch.note}</div>}
                    </div>
                  ))}
                </div>
              ) : review && review.status === "passed" ? (
                <div className="text-sm text-[#64dc78]">{t("No mismatches found.")}</div>
              ) : null}
              {review?.extracted && Object.keys(review.extracted).length > 0 && (
                <details className="rounded bg-[#0f0f0f] p-3">
                  <summary className="cursor-pointer text-xs text-[#a0a0a0]">{t("Extracted contract fields")}</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs text-[#d0d0d0]" dir="ltr">
                    {JSON.stringify(review.extracted, null, 2)}
                  </pre>
                </details>
              )}
            </div>
            {canApprove && review?.status === "passed" && selectedDeal.status === "pending_approval" && (
              <Button onClick={() => void approveDeal()}>{t("Approve deal")}</Button>
            )}
            {role === "admin" && review && !["passed", "queued", "processing"].includes(review.status) && selectedDeal.status !== "approved" && selectedDeal.status !== "active" && selectedDeal.status !== "cancelled" && (
              <Button variant="danger" onClick={() => setApprovalOverrideOpen(true)}>{t("Approve anyway")}</Button>
            )}
            {canUploadContract && (
              <div className="space-y-2 rounded border border-[#2a2a2a] p-3">
                <label className="block text-xs text-[#a0a0a0]">
                  {t("Upload or replace signed contract (PDF or image)")}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(event) => setContractFile(event.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-sm text-[#a0a0a0] file:me-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
                  />
                </label>
                <Button disabled={!contractFile || uploadingContract} onClick={() => void uploadContract()}>
                  {uploadingContract ? t("Uploading and reviewing...") : t("Upload, attach & review")}
                </Button>
                <p className="text-xs text-[#6b6b6b]">{t("The uploaded contract is private and starts a new AI review.")}</p>
              </div>
            )}
            <Button variant="ghost" onClick={() => { setSelectedDeal(null); setContractFile(null) }}>{t("Close")}</Button>
          </div>
        )}
      </Modal>

      <Modal
        open={approvalOverrideOpen}
        onClose={() => setApprovalOverrideOpen(false)}
        title="Admin approval override"
      >
        <div className="space-y-3">
          <p className="text-sm text-[#ffc832]">
            {t("Only use this when the latest contract review has not passed. The reason is recorded for audit.")}
          </p>
          <label className="block text-xs text-[#a0a0a0]">
            {t("Reason (at least five words) *")}
            <textarea
              rows={4}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              className="mt-1 w-full resize-y rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white"
            />
          </label>
          <Button
            variant="danger"
            disabled={overrideReason.trim().split(/\s+/).filter(Boolean).length < 5}
            onClick={() => void approveDeal(overrideReason.trim())}
          >
            {t("Approve with override")}
          </Button>
        </div>
      </Modal>

      {canCreateDeal && (
        <DealCreateModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void load()}
          role={role === "manager" ? "manager" : undefined}
        />
      )}
    </div>
  )
}
