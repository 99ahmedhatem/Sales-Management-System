import { TableSkeleton } from "../shared/motion"
import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import {
  ClientComment,
  Lead,
  LeadStatus,
  User,
} from "../../data/crmTypes"

import { addClientComment, loadClientComments } from "../../data/clientComments"

import { recordActivity } from "../../data/activityLog"

import {
  Avatar,
  Button,
  Card,
  KpiCard,
  Modal,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  Td,
  Tr,
  WebsiteLink,
} from "../ui"

import {
  EditablePhoneCell,
  WebsiteStatusToggle,
} from "../shared/LeadRowControls"

import DealCreateModal from "../shared/DealCreateModal"

import { exportRowsToExcel } from "../shared/exportExcel"

import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"

import { useI18n } from "../../i18n/I18nProvider"
import { ClientLink } from "../shared/AppOverlays"
import { usePermissions } from "../../hooks/usePermissions"

const ROLE_REGION_OPTIONS = [
  { value: "", label: "All Countries" },
  { value: "Saudi Arabia", label: "Saudi Arabia" },
  { value: "Oman", label: "Oman" },
  { value: "Iraq", label: "Iraq" },
  { value: "UAE", label: "UAE" },
  { value: "Egypt", label: "Egypt" },
]

const ROLE_TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "software", label: "Software" },
  { value: "salla", label: "Salla Store" },
]

const ROLE_QUALITY_OPTIONS = [
  { value: "", label: "All Quality" },
  { value: "normal", label: "Normal" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "Strong" },
]

const ROLE_PHONE_OPTIONS = [
  { value: "", label: "All Phones" },
  { value: "has", label: "Has phone" },
  { value: "missing", label: "No phone" },
]

const CALL_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "No Answer", label: "No Answer" },

  { value: "Call Back Later", label: "Call Back Later" },

  { value: "Contacted", label: "Contacted" },

  { value: "Interested", label: "Interested" },

  { value: "Not Interested", label: "Not Interested" },

  { value: "Free Trial", label: "Free Trial" },

  { value: "Subscribed", label: "Subscribed" },

  { value: "Did Not Subscribe", label: "Did Not Subscribe" },

  { value: "Converted", label: "Converted" },
]

interface Props {
  userId: string
}

interface TelesalesLead extends Lead {
  needsMeeting: boolean
}

interface PendingLeadMeetingRequest {
  id: string
  leadId: string
  preferredDate: string | null
}

export default function TelesalesDashboard({ userId }: Props) {
  const { t } = useI18n()
  const { can } = usePermissions()

  const [users, setUsers] = useState<User[]>([])

  const me = users.find((u) => u.id === userId)

  const [leads, setLeads] = useState<TelesalesLead[]>([])

  // Exact counts from the server; the full call history is never loaded into the browser.
  const [callCount, setCallCount] = useState(0)

  const [workedClientCount, setWorkedClientCount] = useState(0)

  const [savingCall, setSavingCall] = useState(false)

  const [postingComment, setPostingComment] = useState(false)

  const [savingPhone, setSavingPhone] = useState(false)

  const [cancellingLeadId, setCancellingLeadId] = useState("")

  const [loading, setLoading] = useState(true)

  const [loadError, setLoadError] = useState("")

  const [page, setPage] = useState(0)

  const [totalLeads, setTotalLeads] = useState(0)

  const [refreshVersion, setRefreshVersion] = useState(0)

  const [exporting, setExporting] = useState(false)

  const pageSize = 100

  useEffect(() => {
    async function loadQueue() {
      setLoading(true)

      setLoadError("")

      const [userRes, leadRes, callCountRes, workedRes] = await Promise.all([
        supabase
          .from("users")
          .select(
            "id, username, full_name, role, status, email, manager_id, last_login",
          ),

        supabase
          .from("leads")
          .select(
            "id, customer_number, website, website_status, website_status_source, phone_source, quantity, client_code, name, phone, company, region, source, is_salla_store, data_quality, status, assigned_to, notes, callback_date, free_trial_end_date, needs_meeting, created_at, updated_at",
            { count: "exact" },
          )
          .eq("assigned_to", userId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1),

        supabase
          .from("activity_logs")
          .select("id", { count: "exact", head: true })
          .eq("actor_id", userId)
          .eq("activity_type", "call"),

        supabase.rpc("get_worked_clients_count", {
          p_user_ids: [userId],
          p_activity_types: ["call"],
        }),
      ])

      if (userRes.error || leadRes.error || callCountRes.error || workedRes.error) {
        setLoadError(
          userRes.error?.message ||
            leadRes.error?.message ||
            callCountRes.error?.message ||
            workedRes.error?.message ||
            "Could not load your queue.",
        )
      } else {
        setUsers(
          (userRes.data ?? []).map((row) => ({
            id: row.id,

            username: row.username,

            fullName: row.full_name,

            role: row.role,

            status: row.status,

            email: row.email,

            lastLogin: row.last_login,

            managerId: row.manager_id ?? undefined,
          })),
        )

        setLeads(
          (leadRes.data ?? []).map((row) => ({
            id: row.id,

            customerNumber: row.customer_number ?? undefined,

            website: row.website ?? undefined,

            websiteStatus: row.website_status ?? undefined,

            websiteStatusSource: row.website_status_source ?? undefined,

            needsMeeting: row.needs_meeting ?? false,

            phoneSource: row.phone_source ?? undefined,

            quantity: row.quantity ?? 0,

            clientCode: row.client_code,

            name: row.name,

            phone: row.phone,

            company: row.company ?? undefined,

            region: row.region ?? undefined,

            source: row.source ?? undefined,

            isSallaStore: row.is_salla_store ?? false,

            dataQuality: row.data_quality ?? "normal",

            status: row.status,

            assignedTo: row.assigned_to ?? undefined,

            notes: row.notes ?? undefined,

            callbackDate: row.callback_date ?? undefined,

            freeTrialEndDate: row.free_trial_end_date ?? undefined,

            createdAt: row.created_at,

            updatedAt: row.updated_at,
          })),
        )

        setTotalLeads(leadRes.count ?? 0)

        setCallCount(callCountRes.count ?? 0)

        setWorkedClientCount(Number(workedRes.data ?? 0))

        const leadIds = (leadRes.data ?? []).map((row) => row.id)

        if (leadIds.length === 0) {
          setMeetingRequests([])
        } else {
          const { data: requestRows, error: requestError } = await supabase

            .from("meeting_requests")

            .select("id, lead_id, preferred_date")

            .eq("requested_by", userId)

            .eq("status", "pending")

            .in("lead_id", leadIds)

          if (requestError) {
            setLoadError(requestError.message)
          } else {
            setMeetingRequests(
              (requestRows ?? []).map((row) => ({
                id: row.id,
                leadId: row.lead_id,
                preferredDate: row.preferred_date,
              })),
            )
          }
        }
      }

      setLoading(false)
    }

    loadQueue()
  }, [userId, page, refreshVersion])

  useRealtimeRefresh(["leads", "users", "meeting_requests"], () =>
    setRefreshVersion((version) => version + 1),
  )

  const activeLeads = leads.filter(
    (l) => !["Subscribed", "Converted", "Did Not Subscribe"].includes(l.status),
  )

  const doneLeads = leads.filter((l) =>
    ["Subscribed", "Converted", "Did Not Subscribe"].includes(l.status),
  )

  const [search, setSearch] = useState("")

  const [statusFilter, setStatusFilter] = useState("")

  const [countryFilter, setCountryFilter] = useState("")

  const [typeFilter, setTypeFilter] = useState("")

  const [qualityFilter, setQualityFilter] = useState("")

  const [phoneFilter, setPhoneFilter] = useState("")

  const [needsMeetingFilter, setNeedsMeetingFilter] = useState("")

  const [tab, setTab] = useState<"queue" | "done">("queue")

  // Modals

  const [callModal, setCallModal] = useState<Lead | null>(null)

  const [forwardModal, setForwardModal] = useState<Lead | null>(null)

  const [commentModal, setCommentModal] = useState<Lead | null>(null)

  const [detailModal, setDetailModal] = useState<Lead | null>(null)

  const [dealLeadId, setDealLeadId] = useState<string | null>(null)

  const [editingCustomerNumberId, setEditingCustomerNumberId] =
    useState<string | null>(null)

  const [editingCustomerNumber, setEditingCustomerNumber] = useState("")

  const [editingPhone, setEditingPhone] = useState("")

  const [callStatus, setCallStatus] = useState<LeadStatus>("Contacted")

  const [callNotes, setCallNotes] = useState("")

  const [callbackDate, setCallbackDate] = useState("")

  const [freeTrialEnd, setFreeTrialEnd] = useState("")

  const [forwardTo, setForwardTo] = useState("")

  const [meetingRequestNotes, setMeetingRequestNotes] = useState("")

  const [preferredMeetingDate, setPreferredMeetingDate] = useState("")

  const [requestingMeeting, setRequestingMeeting] = useState(false)

  const [meetingRequests, setMeetingRequests] = useState<
    PendingLeadMeetingRequest[]
  >([])

  const [newComment, setNewComment] = useState("")

  const salesUsers = users.filter(
    (u) => u.role === "sales" && u.status === "active",
  )

  const saveCustomerNumber = async (leadId: string) => {
    const value = editingCustomerNumber.trim()

    const number = value ? Number(value) : null

    if (number !== null && (!Number.isSafeInteger(number) || number <= 0)) {
      setLoadError("Customer number must be a positive whole number.")

      setEditingCustomerNumberId(null)

      return
    }

    const { error } = await supabase.rpc("set_lead_customer_number", {
      target_lead_id: leadId,
      new_customer_number: number,
    })

    if (error) {
      setLoadError(error.message)
      return
    }

    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, customerNumber: number ?? undefined }
          : lead,
      ),
    )

    setEditingCustomerNumberId(null)
  }

  const savePhone = async (leadId: string) => {
    if (savingPhone) return

    const phone = editingPhone.trim()

    setSavingPhone(true)

    setLoadError("")

    const { error } = await supabase
      .from("leads")
      .update({
        phone: phone || null,
        phone_source: phone ? "manual" : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)

    setSavingPhone(false)

    if (error) {
      setLoadError(error.message)
      return
    }

    setLeads((prev) =>
      prev.map((lead) => (lead.id === leadId ? { ...lead, phone } : lead)),
    )

    setRefreshVersion((version) => version + 1)
  }

  const saveInlinePhone = async (lead: Lead, value: string) => {
    const phone = value.replace(/[^\d+]/g, "")

    const { error } = await supabase
      .from("leads")
      .update({
        phone: phone || null,
        phone_source: phone ? "manual" : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id)

    if (error) {
      setLoadError(error.message)

      throw new Error(error.message)
    }

    setLeads((prev) =>
      prev.map((item) =>
        item.id === lead.id
          ? { ...item, phone, phoneSource: phone ? "manual" : undefined }
          : item,
      ),
    )
  }

  const toggleWebsiteStatus = async (
    lead: Lead,
    nextStatus: "working" | "not_working",
  ) => {
    const previousStatus = lead.websiteStatus

    setLeads((prev) =>
      prev.map((item) =>
        item.id === lead.id
          ? {
              ...item,
              websiteStatus: nextStatus,
              websiteStatusSource: "manual",
            }
          : item,
      ),
    )

    const { error } = await supabase
      .from("leads")
      .update({
        website_status: nextStatus,
        website_status_source: "manual",
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id)

    if (error) {
      setLeads((prev) =>
        prev.map((item) =>
          item.id === lead.id
            ? {
                ...item,
                websiteStatus: previousStatus,
                websiteStatusSource: lead.websiteStatusSource,
              }
            : item,
        ),
      )

      setLoadError(error.message)

      throw new Error(error.message)
    }
  }

  useEffect(() => {
    if (!commentModal) return

    loadClientComments(commentModal.id).then(({ data, error }) => {
      if (error) {
        setLoadError(error)
        return
      }

      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === commentModal.id ? { ...lead, comments: data } : lead,
        ),
      )

      setCommentModal((prev) => (prev ? { ...prev, comments: data } : null))
    })
  }, [commentModal?.id])

  const filtered = (tab === "queue" ? activeLeads : doneLeads).filter((l) => {
    const q = search.toLowerCase()

    return (
      (!q || l.name.toLowerCase().includes(q) || l.phone.includes(q)) &&
      (!statusFilter || l.status === statusFilter) &&
      (!countryFilter || l.region === countryFilter) &&
      (!typeFilter ||
        (typeFilter === "salla" ? l.isSallaStore : !l.isSallaStore)) &&
      (!qualityFilter || l.dataQuality === qualityFilter) &&
      (!phoneFilter || (phoneFilter === "has" ? Boolean(l.phone) : !l.phone)) &&
      (!needsMeetingFilter || l.needsMeeting)
    )
  })

  const updateLead = (id: string, patch: Partial<Lead>) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, ...patch, updatedAt: new Date().toISOString().slice(0, 10) }
          : l,
      ),
    )
  }

  const exportLeads = async () => {
    setExporting(true)

    setLoadError("")

    try {
      const queryBuilder = supabase
        .from("leads")
        .select(
          "id, customer_number, website, website_status, phone_source, quantity, client_code, name, phone, company, region, source, is_salla_store, data_quality, status, assigned_to, notes, callback_date, free_trial_end_date, needs_meeting, created_at, updated_at",
        )
        .eq("assigned_to", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })

      const data: any[] = []

      for (let from = 0; ; from += 1000) {
        const { data: pageRows, error } = await queryBuilder.range(
          from,
          from + 999,
        )

        if (error) throw error

        data.push(...(pageRows ?? []))

        if (!pageRows || pageRows.length < 1000) break
      }

      const searchQuery = search.toLowerCase()

      const rows = (data ?? []).filter((row) => {
        const isDone = [
          "Subscribed",
          "Converted",
          "Did Not Subscribe",
        ].includes(row.status)

        return (
          (tab === "done" ? isDone : !isDone) &&
          (!searchQuery ||
            String(row.name ?? "")
              .toLowerCase()
              .includes(searchQuery) ||
            String(row.phone ?? "").includes(searchQuery)) &&
          (!statusFilter || row.status === statusFilter) &&
          (!countryFilter || row.region === countryFilter) &&
          (!typeFilter ||
            (typeFilter === "salla"
              ? row.is_salla_store
              : !row.is_salla_store)) &&
          (!qualityFilter || row.data_quality === qualityFilter) &&
          (!phoneFilter ||
            (phoneFilter === "has" ? Boolean(row.phone) : !row.phone)) &&
          (!needsMeetingFilter || row.needs_meeting)
        )
      })

      exportRowsToExcel(
        rows.map((row) => ({
          "NO.": row.customer_number ?? "",

          CODE: row.client_code,

          LEAD: row.name,

          PHONE: row.phone ?? "",

          WEBSITE: row.website ?? "",

          "WEBSITE STATUS":
            row.website_status === "working"
              ? "Working"
              : row.website_status === "not_working"
                ? "Not Working"
                : "Not Checked",

          QUANTITY: row.quantity ?? 0,

          STATUS: row.status ?? "",

          NOTES: row.notes ?? "",

          DUE: row.callback_date ?? row.free_trial_end_date ?? "",
        })),
        "telesales-queue-export",
      )
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not export leads.",
      )
    } finally {
      setExporting(false)
    }
  }

  const logCall = async () => {
    if (!callModal || savingCall) return

    const lead = callModal

    setSavingCall(true)

    setLoadError("")

    const { error } = await supabase
      .from("leads")
      .update({
        status: callStatus,

        notes: callNotes || null,

        callback_date:
          callStatus === "Call Back Later" ? callbackDate || null : null,

        free_trial_end_date:
          callStatus === "Free Trial" ? freeTrialEnd || null : null,

        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id)

    if (error) {
      setLoadError(error.message)

      setSavingCall(false)

      return
    }

    const activityError = await recordActivity({
      leadId: lead.id,

      actorId: userId,

      actorName: me?.fullName || "Telesales",

      actorRole: "telesales",

      activityType: "call",

      outcome: callStatus,

      notes: callNotes,
    })

    setSavingCall(false)

    if (activityError) {
      setLoadError(activityError)

      return
    }

    updateLead(lead.id, {
      status: callStatus,

      notes: callNotes,

      callbackDate: callStatus === "Call Back Later" ? callbackDate : undefined,

      freeTrialEndDate: callStatus === "Free Trial" ? freeTrialEnd : undefined,
    })

    setCallModal(null)

    setCallNotes("")

    setCallStatus("Contacted")

    setCallbackDate("")

    setFreeTrialEnd("")

    // Reload the queue and the call counts from the server.
    setRefreshVersion((version) => version + 1)
  }

  const requestMeeting = async () => {
    if (!forwardModal || !forwardTo || requestingMeeting) return

    const preferredDate = preferredMeetingDate
      ? new Date(preferredMeetingDate)
      : null
    if (
      preferredDate &&
      (Number.isNaN(preferredDate.getTime()) ||
        preferredDate.getTime() <= Date.now())
    ) {
      setLoadError("Preferred meeting time must be in the future.")
      return
    }

    setRequestingMeeting(true)

    setLoadError("")

    const { data: createdRequestId, error } = await supabase.rpc(
      "request_meeting",
      {
      target_lead_id: forwardModal.id,

      target_sales_id: forwardTo,

      request_notes: meetingRequestNotes.trim() || null,

      preferred_meeting_date: preferredDate?.toISOString() ?? null,
      },
    )

    if (error) {
      setLoadError(error.message)

      setRequestingMeeting(false)

      return
    }

    setMeetingRequests((current) => [
      ...current.filter((item) => item.leadId !== forwardModal.id),
      {
        id: createdRequestId,
        leadId: forwardModal.id,
        preferredDate: preferredDate?.toISOString() ?? null,
      },
    ])
    setLeads((current) =>
      current.map((lead) =>
        lead.id === forwardModal.id ? { ...lead, needsMeeting: true } : lead,
      ),
    )

    setForwardModal(null)

    setForwardTo("")

    setMeetingRequestNotes("")

    setPreferredMeetingDate("")

    setRequestingMeeting(false)
  }

  const cancelMeetingRequest = async (leadId: string) => {
    const request = meetingRequests.find((item) => item.leadId === leadId)
    if (!request || cancellingLeadId) return
    setLoadError("")
    setCancellingLeadId(leadId)
    const { error } = await supabase.rpc("cancel_meeting_request", {
      target_request_id: request.id,
    })
    setCancellingLeadId("")
    if (error) {
      setLoadError(error.message)
      return
    }
    setMeetingRequests((current) =>
      current.filter((item) => item.id !== request.id),
    )
    setLeads((current) =>
      current.map((lead) =>
        lead.id === leadId ? { ...lead, needsMeeting: false } : lead,
      ),
    )
    setRefreshVersion((version) => version + 1)
  }

  const addComment = async () => {
    if (!commentModal || !newComment.trim() || postingComment) return

    setPostingComment(true)

    const { data: comment, error } = await addClientComment({
      leadId: commentModal.id,

      authorId: userId,

      authorName: me?.fullName || "Telesales",

      actorRole: "telesales",

      text: newComment.trim(),
    })

    setPostingComment(false)

    if (error || !comment) {
      setLoadError(
        error || t("Could not save the comment. Run supabase-setup.sql first."),
      )

      return
    }

    const updated = leads.map((l) =>
      l.id === commentModal.id
        ? { ...l, comments: [...(l.comments || []), comment] }
        : l,
    )

    setLeads(updated)

    setCommentModal(updated.find((l) => l.id === commentModal.id) || null)

    setNewComment("")
  }

  const totalConverted = leads.filter((l) =>
    ["Subscribed", "Converted"].includes(l.status),
  ).length

  const freeTrial = leads.filter((l) => l.status === "Free Trial").length

  const convRate =
    leads.length > 0 ? Math.round((totalConverted / leads.length) * 100) : 0

  // Kept after every hook: returning before a hook breaks React's rules of hooks.
  if (loading) {
    return <div className="p-6 text-[#a0a0a0] text-sm"><TableSkeleton /></div>
  }

  return (
    <div className="p-6 space-y-6">
      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3 anim-banner">
          {t(loadError)}
        </div>
      )}
      <div>
        <h1 className="text-white text-2xl font-bold">{t("My Queue")}</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">
          {t("Welcome back, {name}", { name: me?.fullName || t("Telesales") })}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 anim-stagger">
        <KpiCard
          label="Clients Worked"
          value={workedClientCount}
          sub="Distinct clients contacted"
        />
        <KpiCard
          label="Active Queue"
          value={activeLeads.length}
          sub="Leads to contact"
        />
        <KpiCard
          label="Subscribed"
          value={totalConverted}
          accent
          sub={t("{n}% rate", { n: convRate })}
        />
        <KpiCard label="Free Trial" value={freeTrial} sub="Awaiting decision" />
        <KpiCard label="Calls Logged" value={callCount} sub="All time" />
      </div>

      {/* Callback reminders */}
      {leads.filter((l) => l.status === "Call Back Later" && l.callbackDate)
        .length > 0 && (
        <div className="bg-[#ffc832]/8 border border-[#ffc832]/20 rounded-lg px-4 py-3">
          <div className="text-[#ffc832] text-xs font-medium mb-1">
            ⏰ {t("Callback Reminders")}
          </div>
          <div className="flex flex-wrap gap-2">
            {leads
              .filter((l) => l.status === "Call Back Later" && l.callbackDate)
              .map((l) => (
                <span
                  key={l.id}
                  className="text-xs text-[#a0a0a0] bg-[#1e1e1e] rounded px-2 py-1"
                >
                  {l.name} —{" "}
                  <span className="text-[#ffc832] font-mono">
                    {l.callbackDate}
                  </span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Free trial reminders */}
      {leads.filter((l) => l.status === "Free Trial" && l.freeTrialEndDate)
        .length > 0 && (
        <div className="bg-[#64c8ff]/8 border border-[#64c8ff]/20 rounded-lg px-4 py-3">
          <div className="text-[#64c8ff] text-xs font-medium mb-1">
            🔁 {t("Free Trial Ending")}
          </div>
          <div className="flex flex-wrap gap-2">
            {leads
              .filter((l) => l.status === "Free Trial" && l.freeTrialEndDate)
              .map((l) => (
                <span
                  key={l.id}
                  className="text-xs text-[#a0a0a0] bg-[#1e1e1e] rounded px-2 py-1"
                >
                  {l.name} — {t("ends")}{" "}
                  <span className="text-[#64c8ff] font-mono">
                    {l.freeTrialEndDate}
                  </span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1 w-fit">
        {([
          { key: "queue", label: t("Active ({n})", { n: activeLeads.length }) },

          { key: "done", label: t("Completed ({n})", { n: doneLeads.length }) },
        ] as const).map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`px-4 py-1.5 text-sm rounded-md transition-all ${
              tab === tabItem.key
                ? "bg-[#dfff03] text-black font-medium"
                : "text-[#6b6b6b] hover:text-white"
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name or phone..."
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "", label: "All Status" },
            ...CALL_STATUS_OPTIONS.map((s) => ({
              value: s.value,
              label: s.label,
            })),
          ]}
          className="w-44"
        />
        <Select
          value={countryFilter}
          onChange={setCountryFilter}
          options={ROLE_REGION_OPTIONS}
          className="w-40"
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          options={ROLE_TYPE_OPTIONS}
          className="w-36"
        />
        <Select
          value={qualityFilter}
          onChange={setQualityFilter}
          options={ROLE_QUALITY_OPTIONS}
          className="w-36"
        />
        <Select
          value={phoneFilter}
          onChange={setPhoneFilter}
          options={ROLE_PHONE_OPTIONS}
          className="w-36"
        />
        <Select
          value={needsMeetingFilter}
          onChange={setNeedsMeetingFilter}
          options={[
            { value: "", label: "All Meeting States" },
            { value: "needs", label: "Needs Meeting" },
          ]}
          className="w-44"
        />
        {can("leads.export") && (
          <Button
            variant="secondary"
            size="sm"
            disabled={exporting}
            onClick={exportLeads}
          >
            {exporting ? t("Exporting...") : t("Export Excel")}
          </Button>
        )}
      </div>

      <Card>
        <Table
          headers={[
            "No.",
            "Code",
            "Lead",
            "Phone",
            "Website",
            "Website Status",
            "Quantity",
            "Status",
            "Notes",
            "Due",
            "Actions",
          ]}
        >
          {filtered.map((lead) => (
            <Tr key={lead.id} onClick={() => setDetailModal(lead)}>
              <Td>
                <div
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingCustomerNumberId(lead.id)
                    setEditingCustomerNumber(String(lead.customerNumber ?? ""))
                  }}
                >
                  {editingCustomerNumberId === lead.id ? (
                    <input
                      autoFocus
                      type="number"
                      min="1"
                      value={editingCustomerNumber}
                      onChange={(e) => setEditingCustomerNumber(e.target.value)}
                      onBlur={() => saveCustomerNumber(lead.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveCustomerNumber(lead.id)
                        if (e.key === "Escape") setEditingCustomerNumberId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-20 bg-[#1a1a1a] border border-[#dfff03] rounded px-2 py-1 text-xs text-white"
                    />
                  ) : (
                    <span className="font-mono text-xs text-[#a0a0a0] cursor-text">
                      {lead.customerNumber ?? "—"}
                    </span>
                  )}
                </div>
              </Td>
              <Td>
                <span className="font-mono text-xs text-[#dfff03]">
                  {lead.clientCode}
                </span>
              </Td>
              <Td>
                <ClientLink leadId={lead.id} className="font-medium text-white">{lead.name}</ClientLink>
              </Td>
              <Td>
                <EditablePhoneCell
                  phone={lead.phone}
                  onSave={(phone) => saveInlinePhone(lead, phone)}
                />
              </Td>
              <Td>
                <WebsiteLink
                  url={lead.website}
                  className="text-[#a0a0a0] text-xs truncate max-w-40 inline-block"
                />
              </Td>
              <Td>
                <WebsiteStatusToggle
                  status={lead.websiteStatus}
                  onToggle={(nextStatus) =>
                    toggleWebsiteStatus(lead, nextStatus)
                  }
                />
              </Td>
              <Td>
                <span className="font-mono text-xs text-[#a0a0a0]">
                  {lead.quantity ?? 0}
                </span>
              </Td>
              <Td>
                <StatusBadge status={lead.status} />
              </Td>
              <Td>
                <span className="text-[#6b6b6b] text-xs">
                  {lead.notes
                    ? lead.notes.slice(0, 45) +
                      (lead.notes.length > 45 ? "…" : "")
                    : "—"}
                </span>
              </Td>
              <Td>
                {lead.callbackDate && (
                  <span className="font-mono text-xs text-[#ffc832]">
                    {lead.callbackDate}
                  </span>
                )}
                {lead.freeTrialEndDate && (
                  <span className="font-mono text-xs text-[#64c8ff]">
                    {lead.freeTrialEndDate}
                  </span>
                )}
                {!lead.callbackDate && !lead.freeTrialEndDate && (
                  <span className="text-[#4a4a4a] text-xs">—</span>
                )}
              </Td>
              <Td>
                <div
                  className="flex gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCallModal(lead)
                      setCallStatus(lead.status as LeadStatus || "Contacted")
                      setCallNotes(lead.notes || "")
                    }}
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                    {t("Log")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCommentModal(lead)
                    }}
                  >
                    <span title={t("Comments")} aria-label={t("Comments")}>💬</span>
                  </Button>
                  {lead.needsMeeting ? (
                    <>
                      <span className="rounded bg-[#ffc832]/10 px-2 py-1 text-xs text-[#ffc832]">
                        {t("Needs Meeting")}
                      </span>
                      {meetingRequests.some((item) => item.leadId === lead.id) && (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={cancellingLeadId === lead.id}
                          onClick={() => void cancelMeetingRequest(lead.id)}
                        >
                          {t("Cancel request")}
                        </Button>
                      )}
                    </>
                  ) : (
                    ["Interested", "Free Trial"].includes(lead.status) && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setForwardModal(lead)
                          setMeetingRequestNotes(lead.notes ?? "")
                          setPreferredMeetingDate("")
                        }}
                      >
                        {t("Needs Meeting")}
                      </Button>
                    )
                  )}
                  {["Interested", "Free Trial"].includes(lead.status) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDealLeadId(lead.id)}
                    >
                      {t("Close deal myself")}
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={totalLeads}
          onChange={setPage}
        />
      </Card>

      {/* Lead Detail Modal */}
      <Modal
        open={!!detailModal}
        onClose={() => setDetailModal(null)}
        title={t("Client — {name}", { name: detailModal?.name ?? "" })}
      >
        {detailModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Code", detailModal.clientCode],

                ["Customer Number", detailModal.customerNumber ?? "—"],

                ["Company", detailModal.company || "—"],

                ["Website", detailModal.website || "—"],

                ["Quantity", detailModal.quantity ?? 0],

                ["Region", detailModal.region ? t(detailModal.region) : "—"],

                ["Source", detailModal.source || "—"],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#1a1a1a] rounded p-3">
                  <div className="text-[#6b6b6b] text-xs mb-1">{t(String(k))}</div>
                  <div className="text-white text-sm font-medium">
                    {k === "Website" ? <WebsiteLink url={String(v)} /> : v}
                  </div>
                </div>
              ))}
              <div className="bg-[#1a1a1a] rounded p-3 col-span-2">
                <div className="text-[#6b6b6b] text-xs mb-1">{t("Phone Number")}</div>
                <div className="flex gap-2">
                  <input
                    value={editingPhone || detailModal.phone}
                    onChange={(e) => setEditingPhone(e.target.value)}
                    placeholder={t("Add phone number")}
                    dir="ltr"
                    className="flex-1 bg-[#0e0e0e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={savingPhone}
                    onClick={() => savePhone(detailModal.id)}
                  >
                    {savingPhone ? t("Saving...") : t("Save Phone")}
                  </Button>
                </div>
              </div>
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">{t("Status")}</div>
                <StatusBadge status={detailModal.status} />
              </div>
            </div>
            {detailModal.notes && (
              <div className="bg-[#1a1a1a] rounded p-3">
                <div className="text-[#6b6b6b] text-xs mb-1">{t("Notes")}</div>
                <div className="text-[#d0d0d0] text-sm">
                  {detailModal.notes}
                </div>
              </div>
            )}
            <div>
              <div className="text-[#6b6b6b] text-xs mb-2">
                {t("Comments ({n})", { n: (detailModal.comments || []).length })}
              </div>
              <div className="space-y-2">
                {(detailModal.comments || []).map((c) => (
                  <div key={c.id} className="bg-[#1a1a1a] rounded p-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-[#dfff03] text-xs font-medium">
                        {c.authorName}
                      </span>
                      <span className="text-[#4a4a4a] text-xs font-mono">
                        {c.createdAt}
                      </span>
                    </div>
                    <p className="text-[#d0d0d0] text-sm">{c.text}</p>
                  </div>
                ))}
                {(detailModal.comments || []).length === 0 && (
                  <p className="text-[#4a4a4a] text-xs">{t("No comments yet.")}</p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDetailModal(null)}
            >
              {t("Close")}
            </Button>
          </div>
        )}
      </Modal>

      {/* Log Call Modal */}
      <Modal
        open={!!callModal}
        onClose={() => setCallModal(null)}
        title={t("Log Call — {name}", { name: callModal?.name ?? "" })}
      >
        {callModal && (
          <div className="space-y-4">
            <div className="bg-[#1a1a1a] rounded p-3 flex gap-4">
              <div>
                <div className="text-[#6b6b6b] text-xs">{t("Phone")}</div>
                <div className="text-[#dfff03] font-mono text-sm" dir="ltr">
                  {callModal.phone}
                </div>
              </div>
              <div>
                <div className="text-[#6b6b6b] text-xs">{t("Code")}</div>
                <div className="text-white font-mono text-sm">
                  {callModal.clientCode}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">
                {t("Call Outcome *")}
              </label>
              <select
                value={callStatus}
                onChange={(e) => setCallStatus(e.target.value as LeadStatus)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
              >
                {CALL_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.label)}
                  </option>
                ))}
              </select>
            </div>
            {callStatus === "Call Back Later" && (
              <div>
                <label className="block text-xs text-[#a0a0a0] mb-1">
                  {t("Callback Date")}
                </label>
                <input
                  type="date"
                  value={callbackDate}
                  onChange={(e) => setCallbackDate(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
                />
              </div>
            )}
            {callStatus === "Free Trial" && (
              <div>
                <label className="block text-xs text-[#a0a0a0] mb-1">
                  {t("Free Trial End Date")}
                </label>
                <input
                  type="date"
                  value={freeTrialEnd}
                  onChange={(e) => setFreeTrialEnd(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#dfff03]/60"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">{t("Notes")}</label>
              <textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={3}
                placeholder={t("What was discussed, objections, next steps...")}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" disabled={savingCall} onClick={logCall}>
                {savingCall ? t("Saving...") : t("Save Call Log")}
              </Button>
              <Button variant="ghost" onClick={() => setCallModal(null)}>
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Comment Modal */}
      <Modal
        open={!!commentModal}
        onClose={() => setCommentModal(null)}
        title={t("Comments — {name}", { name: commentModal?.name ?? "" })}
      >
        {commentModal && (
          <div className="space-y-4">
            <div className="max-h-48 overflow-y-auto space-y-2">
              {(commentModal.comments || []).map((c) => (
                <div key={c.id} className="bg-[#1a1a1a] rounded p-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-[#dfff03] text-xs font-medium">
                      {c.authorName}
                    </span>
                    <span className="text-[#4a4a4a] text-xs font-mono">
                      {c.createdAt}
                    </span>
                  </div>
                  <p className="text-[#d0d0d0] text-sm">{c.text}</p>
                </div>
              ))}
              {(commentModal.comments || []).length === 0 && (
                <p className="text-[#4a4a4a] text-xs">{t("No comments yet.")}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">
                {t("Add Comment")}
              </label>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={3}
                placeholder={t("Add a note about this client...")}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white placeholder-[#4a4a4a] focus:outline-none focus:border-[#dfff03]/60 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!newComment.trim() || postingComment}
                onClick={addComment}
              >
                {postingComment ? t("Saving...") : t("Post Comment")}
              </Button>
              <Button variant="ghost" onClick={() => setCommentModal(null)}>
                {t("Close")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Meeting Request Modal */}
      <Modal
        open={!!forwardModal}
        onClose={() => setForwardModal(null)}
        title={t("Request Meeting — {name}", { name: forwardModal?.name ?? "" })}
      >
        {forwardModal && (
          <div className="space-y-4">
            <p className="text-[#a0a0a0] text-sm">
              {t("Choose a sales agent. They will accept the request and set the meeting time.")}
            </p>
            <div className="space-y-2">
              {salesUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setForwardTo(u.id)}
                  className={`w-full text-start p-3 rounded-lg border transition-all ${
                    forwardTo === u.id
                      ? "border-[#dfff03] bg-[#dfff03]/5"
                      : "border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={u.fullName} size="sm" />
                    <span className="text-white text-sm">{u.fullName}</span>
                  </div>
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs text-[#a0a0a0] mb-1">
                {t("Meeting Notes")}
              </label>
              <label className="mt-3 block text-xs text-[#a0a0a0]">
                {t("Preferred date and time (optional)")}
                <input
                  type="datetime-local"
                  value={preferredMeetingDate}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  onChange={(event) =>
                    setPreferredMeetingDate(event.target.value)
                  }
                  className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
                />
              </label>
              <textarea
                value={meetingRequestNotes}
                onChange={(e) => setMeetingRequestNotes(e.target.value)}
                rows={3}
                className="w-full resize-none rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!forwardTo || requestingMeeting}
                onClick={requestMeeting}
              >
                {requestingMeeting ? t("Sending...") : t("Request Meeting")}
              </Button>
              <Button
                variant="ghost"
                disabled={requestingMeeting}
                onClick={() => setForwardModal(null)}
              >
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <DealCreateModal
        open={Boolean(dealLeadId)}
        onClose={() => setDealLeadId(null)}
        onCreated={() => setRefreshVersion((version) => version + 1)}
        initialLeadId={dealLeadId ?? undefined}
      />
    </div>
  )
}
