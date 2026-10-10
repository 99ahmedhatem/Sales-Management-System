import { TableSkeleton } from "../shared/motion"
import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import {
  mapSalesPackage,
  SalesPackage,
  SalesPackageRow,
} from "../../data/packages"

import { Button, Card, Modal, Table, Td, Tr } from "../ui"

import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh"

import { useI18n } from "../../i18n/I18nProvider"

const PAGE_SIZE = 25

const formatSar = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "SAR",
})

interface PackageForm {
  name: string

  description: string

  features: string

  durationMonths: string

  priceSar: string

  minPriceSar: string
}

const EMPTY_FORM: PackageForm = {
  name: "",

  description: "",

  features: "",

  durationMonths: "12",

  priceSar: "",

  minPriceSar: "",
}

interface ManagerOption {
  id: string

  fullName: string
}

/** get_package_access() rows grouped by package; a package with no rows is visible to everyone (065). */
type AccessMap = Record<string, string[]>

function mapToForm(item: SalesPackage): PackageForm {
  return {
    name: item.name,

    description: item.description,

    features: item.features.join("\n"),

    durationMonths: String(item.durationMonths),

    priceSar: String(item.priceSar),

    minPriceSar: String(item.minPriceSar),
  }
}

export default function AdminPackages() {
  const { t } = useI18n()

  const [packages, setPackages] = useState<SalesPackage[]>([])

  const [page, setPage] = useState(0)

  const [hasMore, setHasMore] = useState(false)

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [error, setError] = useState("")

  const [modalOpen, setModalOpen] = useState(false)

  const [editing, setEditing] = useState<SalesPackage | null>(null)

  const [form, setForm] = useState<PackageForm>(EMPTY_FORM)

  const [managers, setManagers] = useState<ManagerOption[]>([])

  const [access, setAccess] = useState<AccessMap>({})

  const [accessLoaded, setAccessLoaded] = useState(false)

  const [managerFilter, setManagerFilter] = useState("")

  const [accessFor, setAccessFor] = useState<SalesPackage | null>(null)

  const [accessDraft, setAccessDraft] = useState<string[]>([])

  const [accessError, setAccessError] = useState("")

  const [selected, setSelected] = useState<string[]>([])

  const [bulkManager, setBulkManager] = useState("")

  const [bulkSaving, setBulkSaving] = useState(false)

  async function loadAccess() {
    const [accessResult, managersResult] = await Promise.all([
      supabase.rpc("get_package_access"),

      supabase
        .from("users")
        .select("id, full_name")
        .eq("role", "manager")
        .eq("status", "active")
        .order("full_name"),
    ])

    if (accessResult.error || managersResult.error) {
      setError(
        accessResult.error?.message ??
          managersResult.error?.message ??
          "Could not load package visibility.",
      )

      setAccessLoaded(false)

      return null
    }

    const grouped: AccessMap = {}

    for (const row of (accessResult.data ?? []) as {
      package_id: string
      manager_id: string
    }[]) {
      ;(grouped[row.package_id] ??= []).push(row.manager_id)
    }

    setAccess(grouped)

    setManagers(
      ((managersResult.data ?? []) as { id: string; full_name: string | null }[]).map(
        (row) => ({ id: row.id, fullName: row.full_name ?? "—" }),
      ),
    )

    setAccessLoaded(true)

    return grouped
  }

  async function loadPackages() {
    setLoading(true)

    setError("")

    const grouped = await loadAccess()

    const from = page * PAGE_SIZE

    let query = supabase

      .from("packages")

      .select(
        "id, name, description, features, duration_months, price_sar, min_price_sar, is_active",
      )

      .order("created_at", { ascending: false })

      .range(from, from + PAGE_SIZE)

    // "Show packages of manager": hide the packages limited to other managers only
    if (managerFilter && grouped) {
      const hidden = Object.entries(grouped)
        .filter(([, ids]) => !ids.includes(managerFilter))
        .map(([id]) => id)

      if (hidden.length) query = query.not("id", "in", `(${hidden.join(",")})`)
    }

    const { data, error: queryError } = await query

    if (queryError) {
      setError(queryError.message)

      setPackages([])

      setHasMore(false)
    } else {
      const rows = (data ?? []) as SalesPackageRow[]

      setHasMore(rows.length > PAGE_SIZE)

      setPackages(rows.slice(0, PAGE_SIZE).map(mapSalesPackage))
    }

    setLoading(false)
  }

  useEffect(() => {
    setSelected([])

    loadPackages()
  }, [page, managerFilter])

  useRealtimeRefresh(["packages"], loadPackages)

  function openCreate() {
    setEditing(null)

    setForm(EMPTY_FORM)

    setError("")

    setModalOpen(true)
  }

  function openEdit(item: SalesPackage) {
    setEditing(item)

    setForm(mapToForm(item))

    setError("")

    setModalOpen(true)
  }

  async function savePackage() {
    const priceSar = Number(form.priceSar)

    const minPriceSar = Number(form.minPriceSar)

    const durationMonths = Number(form.durationMonths)

    if (
      !form.name.trim() ||
      !form.priceSar.trim() ||
      !form.minPriceSar.trim() ||
      !Number.isFinite(priceSar) ||
      !Number.isFinite(minPriceSar) ||
      !Number.isInteger(durationMonths) ||
      durationMonths <= 0 ||
      priceSar < 0 ||
      minPriceSar < 0 ||
      minPriceSar > priceSar
    ) {
      setError(
        "Enter a name, positive whole-number duration, and valid prices. Minimum price cannot exceed the package price.",
      )

      return
    }

    setSaving(true)

    setError("")

    const values = {
      name: form.name.trim(),

      description: form.description.trim() || null,

      features: form.features
        .split("\n")
        .map((feature) => feature.trim())
        .filter(Boolean),

      duration_months: durationMonths,

      price_sar: priceSar,

      min_price_sar: minPriceSar,

      updated_at: new Date().toISOString(),
    }

    const result = editing
      ? await supabase.from("packages").update(values).eq("id", editing.id)
      : await supabase.from("packages").insert(values)

    if (result.error) {
      setError(result.error.message)
    } else {
      setModalOpen(false)

      await loadPackages()
    }

    setSaving(false)
  }

  async function toggleActive(item: SalesPackage) {
    setError("")

    const { error: updateError } = await supabase

      .from("packages")

      .update({
        is_active: !item.isActive,
        updated_at: new Date().toISOString(),
      })

      .eq("id", item.id)

    if (updateError) setError(updateError.message)
    else await loadPackages()
  }

  const managerName = (id: string) =>
    managers.find((manager) => manager.id === id)?.fullName ?? "—"

  function openAccess(item: SalesPackage) {
    setAccessFor(item)

    setAccessDraft(access[item.id] ?? [])

    setAccessError("")
  }

  async function saveAccess() {
    if (!accessFor) return

    setSaving(true)

    setAccessError("")

    const { error: rpcError } = await supabase.rpc("set_package_access", {
      p_package_id: accessFor.id,

      p_manager_ids: accessDraft,
    })

    setSaving(false)

    if (rpcError) {
      setAccessError(rpcError.message)

      return
    }

    setAccessFor(null)

    await loadPackages()
  }

  /** Adds the manager to each selected package's current list (a package for everyone becomes limited to him). */
  async function assignSelectedToManager() {
    if (!bulkManager || selected.length === 0) return

    setBulkSaving(true)

    setError("")

    const failures: string[] = []

    for (const packageId of selected) {
      const current = access[packageId] ?? []

      if (current.includes(bulkManager)) continue

      const { error: rpcError } = await supabase.rpc("set_package_access", {
        p_package_id: packageId,

        p_manager_ids: [...current, bulkManager],
      })

      if (rpcError) {
        const name = packages.find((item) => item.id === packageId)?.name ?? packageId

        failures.push(`${name}: ${rpcError.message}`)
      }
    }

    setBulkSaving(false)

    setSelected([])

    await loadPackages()

    if (failures.length) setError(failures.join(" · "))
  }

  const allSelected =
    packages.length > 0 && packages.every((item) => selected.includes(item.id))

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold">{t("Packages")}</h1>
          <p className="text-[#6b6b6b] text-sm mt-0.5">
            {t("Create, update, or disable sales packages")}
          </p>
        </div>
        <Button onClick={openCreate}>{t("+ New Package")}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[#a0a0a0]">
          {t("Show packages of manager:")}
          <select
            value={managerFilter}
            onChange={(event) => {
              setPage(0)

              setManagerFilter(event.target.value)
            }}
            className="rounded border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1.5 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
          >
            <option value="">{t("All packages")}</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.fullName}
              </option>
            ))}
          </select>
        </label>

        {packages.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[#a0a0a0]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? [] : packages.map((item) => item.id))
              }
              className="accent-[#dfff03]"
            />
            {t("Select all on this page")}
          </label>
        )}

        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-[#dfff03]/30 bg-[#dfff03]/5 px-3 py-1.5">
            <span className="text-xs text-[#dfff03]">
              {t("{n} selected", { n: selected.length })}
            </span>
            <select
              value={bulkManager}
              onChange={(event) => setBulkManager(event.target.value)}
              className="rounded border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1 text-xs text-white focus:border-[#dfff03]/60 focus:outline-none"
            >
              <option value="">{t("Choose a manager")}</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.fullName}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!bulkManager || bulkSaving || !accessLoaded}
              onClick={assignSelectedToManager}
            >
              {bulkSaving ? t("Saving...") : t("Assign to manager")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={bulkSaving}
              onClick={() => setSelected([])}
            >
              {t("Cancel")}
            </Button>
          </div>
        )}
      </div>

      {error && !modalOpen && (
        <div
          role="alert"
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-banner"
        >
          {t(error)}
        </div>
      )}
      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]">
            <TableSkeleton />
          </div>
        ) : packages.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6b6b6b]">
            {error ? t("Unable to load packages.") : t("No packages found.")}
          </div>
        ) : (
          <Table
            headers={[
              "",
              "Package",
              "Duration",
              "Price",
              "Minimum",
              "Visibility",
              "Status",
              "",
            ]}
          >
            {packages.map((item) => (
              <Tr key={item.id}>
                <Td>
                  <input
                    type="checkbox"
                    aria-label={item.name}
                    checked={selected.includes(item.id)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                    className="accent-[#dfff03]"
                  />
                </Td>
                <Td>
                  <div className="font-medium text-white">{item.name}</div>
                  <div className="max-w-sm truncate text-xs text-[#6b6b6b]">
                    {item.description || "—"}
                  </div>
                </Td>
                <Td>{t("{n} months", { n: item.durationMonths })}</Td>
                <Td>
                  <span className="font-mono text-white">
                    {formatSar.format(item.priceSar)}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-[#a0a0a0]">
                    {formatSar.format(item.minPriceSar)}
                  </span>
                </Td>
                <Td>
                  {!accessLoaded ? (
                    <span className="text-xs text-[#6b6b6b]">—</span>
                  ) : (access[item.id] ?? []).length === 0 ? (
                    <span className="text-xs text-[#a0a0a0]">{t("Everyone")}</span>
                  ) : (
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {(access[item.id] ?? []).map((managerId) => (
                        <span
                          key={managerId}
                          className="rounded-full border border-[#dfff03]/30 bg-[#dfff03]/10 px-2 py-0.5 text-xs text-[#dfff03]"
                        >
                          {managerName(managerId)}
                        </span>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>
                  <span
                    className={
                      item.isActive ? "text-[#64dc78]" : "text-[#6b6b6b]"
                    }
                  >
                    {item.isActive ? t("Active") : t("Disabled")}
                  </span>
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEdit(item)}
                    >
                      {t("Edit")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!accessLoaded}
                      onClick={() => openAccess(item)}
                    >
                      {t("Set visibility")}
                    </Button>
                    <Button
                      variant={item.isActive ? "danger" : "ghost"}
                      size="sm"
                      onClick={() => toggleActive(item)}
                    >
                      {item.isActive ? t("Disable") : t("Enable")}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {!loading && !error && (page > 0 || hasMore) && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#6b6b6b]">{t("Page {n}", { n: page + 1 })}</span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >
              {t("Previous")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasMore}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("Next")}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(accessFor)}
        onClose={() => setAccessFor(null)}
        title="Package visibility"
      >
        <div className="space-y-4">
          <div className="text-sm font-medium text-white">{accessFor?.name}</div>
          {accessError && (
            <div
              role="alert"
              className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-shake"
            >
              {accessError}
            </div>
          )}
          <p className="text-xs text-[#a0a0a0]">
            {t("If you don't select anyone, the package is visible to everyone.")}
          </p>
          {managers.length === 0 ? (
            <p className="text-sm text-[#6b6b6b]">{t("No active managers.")}</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {managers.map((manager) => (
                <label
                  key={manager.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-white hover:bg-[#1a1a1a]"
                >
                  <input
                    type="checkbox"
                    checked={accessDraft.includes(manager.id)}
                    onChange={() =>
                      setAccessDraft((current) =>
                        current.includes(manager.id)
                          ? current.filter((id) => id !== manager.id)
                          : [...current, manager.id],
                      )
                    }
                    className="accent-[#dfff03]"
                  />
                  {manager.fullName}
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button disabled={saving} onClick={saveAccess}>
              {saving ? t("Saving...") : t("Save")}
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setAccessFor(null)}
            >
              {t("Cancel")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Package" : "New Package"}
      >
        <div className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-shake"
            >
              {t(error)}
            </div>
          )}
          <label className="block text-xs text-[#a0a0a0]">
            {t("Name *")}
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-[#a0a0a0]">
            {t("Description")}
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={2}
              className="mt-1 w-full resize-y rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-[#a0a0a0]">
            {t("Features (one per line)")}
            <textarea
              value={form.features}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  features: event.target.value,
                }))
              }
              rows={4}
              className="mt-1 w-full resize-y rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Duration (months) *", key: "durationMonths" as const },

              { label: "Price (SAR) *", key: "priceSar" as const },

              { label: "Minimum price (SAR) *", key: "minPriceSar" as const },
            ].map((field) => (
              <label key={field.key} className="block text-xs text-[#a0a0a0]">
                {t(field.label)}
                <input
                  type="number"
                  min="0"
                  step={field.key === "durationMonths" ? "1" : "0.01"}
                  value={form[field.key]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus:border-[#dfff03]/60 focus:outline-none"
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <Button disabled={saving} onClick={savePackage}>
              {saving ? t("Saving...") : t("Save Package")}
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setModalOpen(false)}
            >
              {t("Cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
