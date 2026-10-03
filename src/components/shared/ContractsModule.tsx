import { useCallback, useEffect, useState } from "react"
import { Deal, loadDealsPage } from "../../data/deals"
import { supabase } from "../../supabaseClient"
import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"
import { Button, Card, Modal, Pagination, SearchInput, StatusBadge, Table, Td, Tr } from "../ui"
import DealCreateModal from "./DealCreateModal"

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
  const [deals, setDeals] = useState<Deal[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
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
  const canCreateDeal = role === "sales" || role === "telesales"
  const canUploadContract =
    canCreateDeal && selectedDeal?.closedByUserId === userId

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
    const { error: attachError } = await supabase.rpc("attach_contract", {
      target_deal_id: selectedDeal.id,
      target_contract_path: path,
    })
    if (attachError) {
      setError(`Contract uploaded but could not be attached: ${attachError.message}`)
      setUploadingContract(false)
      return
    }
    setSelectedDeal({ ...selectedDeal, contractPath: path, status: "contract_uploaded" })
    setContractFile(null)
    setUploadingContract(false)
    void load()
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Deals & Contracts</h1>
          <p className="mt-0.5 text-sm text-[#6b6b6b]">{total} deals visible to your account</p>
        </div>
        {canCreateDeal && (
          <Button onClick={() => setCreateOpen(true)}>+ New Deal</Button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">Deals on page</div>
          <div className="mt-2 text-2xl font-bold text-white">{visibleDeals.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">Pending approval</div>
          <div className="mt-2 text-2xl font-bold text-[#ffc832]">{deals.filter((deal) => deal.status === "pending_approval").length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">Below minimum</div>
          <div className="mt-2 text-2xl font-bold text-[#ffc832]">{deals.filter((deal) => deal.belowMinPrice).length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">Deal value on page</div>
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
          <div className="p-8 text-center text-sm text-[#6b6b6b]">Loading deals...</div>
        ) : visibleDeals.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]">No deals found.</div>
        ) : (
          <Table headers={["Client", "Package", "Closing price", "Dates", "Owner", "Status", ""]}>
            {visibleDeals.map((deal) => (
              <Tr key={deal.id} onClick={() => { setError(""); setSelectedDeal(deal) }}>
                <Td>
                  <div className="font-medium text-white">{deal.leadName}</div>
                  <div className="font-mono text-xs text-[#6b6b6b]">{deal.leadPhone || "—"}</div>
                  {deal.belowMinPrice && <div className="mt-1 text-xs text-[#ffc832]">Below package minimum</div>}
                </Td>
                <Td>
                  <div className="text-white">{deal.packageName}</div>
                  <div className="text-xs text-[#6b6b6b]">{deal.packageDurationMonths} months · List {formatSar.format(deal.listPriceSar)}</div>
                </Td>
                <Td><span className="font-mono text-white">{formatSar.format(deal.priceSar)}</span></Td>
                <Td>
                  <div className="font-mono text-xs text-[#a0a0a0]">{deal.startDate}</div>
                  <div className="font-mono text-xs text-[#6b6b6b]">to {deal.endDate}</div>
                </Td>
                <Td>
                  <div className="text-xs text-white">{deal.salesName || deal.telesalesName}</div>
                  {deal.salesName && <div className="text-xs text-[#6b6b6b]">Telesales: {deal.telesalesName}</div>}
                </Td>
                <Td><StatusBadge status={STATUS_LABELS[deal.status]} /></Td>
                <Td><Button variant="secondary" size="sm" onClick={() => { setError(""); setSelectedDeal(deal) }}>Details</Button></Td>
              </Tr>
            ))}
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
      </Card>

      <Modal
        open={!!selectedDeal}
        onClose={() => { setSelectedDeal(null); setContractFile(null); setError("") }}
        title={`Deal details — ${selectedDeal?.leadName ?? ""}`}
      >
        {selectedDeal && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge status={STATUS_LABELS[selectedDeal.status]} />
              <span className="font-mono text-xs text-[#6b6b6b]">{selectedDeal.id}</span>
            </div>
            {selectedDeal.belowMinPrice && (
              <div className="rounded border border-[#ffc832]/30 bg-[#ffc832]/10 p-3 text-sm text-[#ffc832]">
                This closing price is below the package minimum ({formatSar.format(selectedDeal.minPriceSar)}). Reviewer attention is required.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Client", selectedDeal.leadName],
                ["Phone", selectedDeal.leadPhone || "—"],
                ["Package", selectedDeal.packageName],
                ["Duration", `${selectedDeal.packageDurationMonths} months`],
                ["List price", formatSar.format(selectedDeal.listPriceSar)],
                ["Closing price", formatSar.format(selectedDeal.priceSar)],
                ["Start date", selectedDeal.startDate],
                ["End date", selectedDeal.endDate],
                ["Sales", selectedDeal.salesName || "Self-closed by telesales"],
                ["Telesales", selectedDeal.telesalesName],
              ].map(([label, value]) => (
                <div key={label} className="rounded bg-[#1a1a1a] p-3">
                  <div className="text-xs text-[#6b6b6b]">{label}</div>
                  <div className="mt-1 break-all text-sm text-white">{value}</div>
                </div>
              ))}
            </div>
            {selectedDeal.notes && (
              <div className="rounded bg-[#1a1a1a] p-3">
                <div className="text-xs text-[#6b6b6b]">Notes</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#d0d0d0]">{selectedDeal.notes}</p>
              </div>
            )}
            <div className="space-y-2 rounded bg-[#1a1a1a] p-3">
              <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">Private files</div>
              {signingUrls ? (
                <div className="text-sm text-[#6b6b6b]">Preparing secure links...</div>
              ) : (
                <>
                  {selectedDeal.recordingPath ? (
                    signedRecordingUrl ? <a className="block text-sm text-[#dfff03] underline" href={signedRecordingUrl} target="_blank" rel="noreferrer">Open meeting recording</a> : <div className="text-sm text-[#ffc832]">Recording link unavailable.</div>
                  ) : <div className="text-sm text-[#6b6b6b]">No meeting recording attached.</div>}
                  {selectedDeal.contractPath ? (
                    signedContractUrl ? <a className="block text-sm text-[#dfff03] underline" href={signedContractUrl} target="_blank" rel="noreferrer">Open signed contract</a> : <div className="text-sm text-[#ffc832]">Contract link unavailable.</div>
                  ) : <div className="text-sm text-[#6b6b6b]">No signed contract attached.</div>}
                </>
              )}
            </div>
            {canUploadContract && !selectedDeal.contractPath && (
              <div className="space-y-2 rounded border border-[#2a2a2a] p-3">
                <label className="block text-xs text-[#a0a0a0]">
                  Upload signed contract (PDF or image)
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(event) => setContractFile(event.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-sm text-[#a0a0a0] file:mr-3 file:rounded file:border-0 file:bg-[#252525] file:px-3 file:py-2 file:text-white"
                  />
                </label>
                <Button disabled={!contractFile || uploadingContract} onClick={() => void uploadContract()}>
                  {uploadingContract ? "Uploading..." : "Upload & Attach Contract"}
                </Button>
                <p className="text-xs text-[#6b6b6b]">Contract review will be available after the review service is configured.</p>
              </div>
            )}
            <Button variant="ghost" onClick={() => { setSelectedDeal(null); setContractFile(null) }}>Close</Button>
          </div>
        )}
      </Modal>

      {canCreateDeal && (
        <DealCreateModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void load()}
        />
      )}
    </div>
  )
}
