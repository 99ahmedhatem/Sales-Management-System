import { useEffect, useState } from "react"
import {
  loadManageableMeetingRequestsPage,
  MeetingRequest,
} from "../../data/meetings"
import { supabase } from "../../supabaseClient"
import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"
import { Avatar, Button, Card, Pagination, Select } from "../ui"

const PAGE_SIZE = 20

interface SalesUser {
  id: string
  fullName: string
}

interface Props {
  role: "admin" | "manager"
  userId: string
}

export default function MeetingRequestsManagement({ role, userId }: Props) {
  const [requests, setRequests] = useState<MeetingRequest[]>([])
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([])
  const [targetSalesByRequest, setTargetSalesByRequest] = useState<
    Record<string, string>
  >({})
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState("")
  const [error, setError] = useState("")
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError("")
      let usersQuery = supabase
        .from("users")
        .select("id, full_name")
        .eq("role", "sales")
        .eq("status", "active")
        .order("full_name")
      if (role === "manager") {
        usersQuery = usersQuery.eq("manager_id", userId)
      }
      const [requestsResult, usersResult] = await Promise.all([
        loadManageableMeetingRequestsPage({ page, pageSize: PAGE_SIZE }),
        usersQuery,
      ])
      if (!active) return

      if (requestsResult.error || usersResult.error || requestsResult.data === null) {
        setError(
          requestsResult.error ??
            usersResult.error?.message ??
            "Could not load meeting requests.",
        )
        setRequests([])
        setTotal(0)
      } else {
        setRequests(requestsResult.data)
        setTotal(requestsResult.count)
        setSalesUsers(
          (usersResult.data ?? []).map((row) => ({
            id: row.id,
            fullName: row.full_name,
          })),
        )
      }
      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [page, refreshVersion, role, userId])

  useRealtimeRefresh(["meeting_requests"], () =>
    setRefreshVersion((version) => version + 1),
  )

  async function reassign(request: MeetingRequest) {
    const targetSalesId = targetSalesByRequest[request.id]
    if (!targetSalesId || targetSalesId === request.assignedSalesId) return

    setUpdatingId(request.id)
    setError("")
    const { error: rpcError } = await supabase.rpc(
      "reassign_meeting_request",
      {
        target_request_id: request.id,
        target_sales_id: targetSalesId,
      },
    )
    if (rpcError) {
      setError(rpcError.message)
    } else {
      setRefreshVersion((version) => version + 1)
    }
    setUpdatingId("")
  }

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">Pending Meeting Requests</h2>
          <p className="mt-1 text-xs text-[#6b6b6b]">
            {role === "admin" ? "All teams" : "Your team"}
          </p>
        </div>
        <span className="rounded bg-[#ffc832]/10 px-2 py-1 text-xs text-[#ffc832]">
          {total} pending
        </span>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]"
        >
          {error}
        </div>
      )}
      {loading ? (
        <div className="py-6 text-center text-sm text-[#6b6b6b]">
          Loading requests...
        </div>
      ) : requests.length === 0 ? (
        <div className="py-6 text-center text-sm text-[#6b6b6b]">
          No pending requests.
        </div>
      ) : (
        <div className="divide-y divide-[#242424]">
          {requests.map((request) => {
            const targetSalesId =
              targetSalesByRequest[request.id] ?? request.assignedSalesId
            return (
              <div
                key={request.id}
                className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium text-white">{request.leadName}</div>
                  <div className="mt-1 font-mono text-xs text-[#a0a0a0]">
                    {request.leadPhone}
                  </div>
                  <div className="mt-2 text-sm text-[#a0a0a0]">
                    {request.notes || "No additional notes."}
                  </div>
                  {request.preferredDate && (
                    <div className="mt-1 text-xs text-[#ffc832]">
                      Preferred: {new Date(request.preferredDate).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex min-w-64 items-center gap-3">
                  <Avatar name={request.assignedSalesName} size="sm" />
                  <Select
                    value={targetSalesId}
                    onChange={(value) =>
                      setTargetSalesByRequest((current) => ({
                        ...current,
                        [request.id]: value,
                      }))
                    }
                    options={salesUsers.map((user) => ({
                      value: user.id,
                      label: user.fullName,
                    }))}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      updatingId === request.id ||
                      !targetSalesId ||
                      targetSalesId === request.assignedSalesId
                    }
                    onClick={() => void reassign(request)}
                  >
                    {updatingId === request.id ? "Saving..." : "Reassign"}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {!loading && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
        />
      )}
    </Card>
  )
}
