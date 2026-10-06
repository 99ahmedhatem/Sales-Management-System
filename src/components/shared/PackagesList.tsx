import { TableSkeleton } from "./motion"
import { useEffect, useState } from "react"

import { supabase } from "../../supabaseClient"

import {
  mapSalesPackage,
  SalesPackage,
  SalesPackageRow,
} from "../../data/packages"

import { Button, Card } from "../ui"

import { useI18n } from "../../i18n/I18nProvider"

const PAGE_SIZE = 12

const formatSar = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "SAR",
})

/** list_packages() returns min_price_sar = null without the packages.view_min_price permission (047). */
type ListedPackage = SalesPackage & { minPriceVisible: number | null }

export default function PackagesList() {
  const { t } = useI18n()

  const [packages, setPackages] = useState<ListedPackage[]>([])

  const [page, setPage] = useState(0)

  const [hasMore, setHasMore] = useState(false)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function loadPackages() {
      setLoading(true)

      setError("")

      const from = page * PAGE_SIZE

      // Read-only for every role with packages.view; sensitive columns are hidden by the RPC
      const { data, error: queryError } = await supabase.rpc("list_packages")

      if (!active) return

      if (queryError) {
        setError(queryError.message)

        setPackages([])
      } else {
        const rows = ((data ?? []) as (Omit<SalesPackageRow, "min_price_sar"> & { min_price_sar: number | null })[])
          .filter((row) => row.is_active)
          .sort((a, b) => Number(a.price_sar) - Number(b.price_sar) || a.name.localeCompare(b.name))

        setHasMore(rows.length > from + PAGE_SIZE)

        setPackages(
          rows.slice(from, from + PAGE_SIZE).map((row) => ({
            ...mapSalesPackage({ ...row, min_price_sar: row.min_price_sar ?? 0 }),
            minPriceVisible: row.min_price_sar == null ? null : Number(row.min_price_sar),
          })),
        )
      }

      setLoading(false)
    }

    loadPackages()

    return () => {
      active = false
    }
  }, [page])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-white text-2xl font-bold">{t("Packages")}</h1>
        <p className="text-[#6b6b6b] text-sm mt-0.5">
          {t("Available packages and included features")}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888] anim-banner"
        >
          {error}
        </div>
      )}
      {loading ? (
        <div className="py-12 text-center text-sm text-[#6b6b6b]">
          <TableSkeleton />
        </div>
      ) : !error && packages.length === 0 ? (
        <div className="py-12 text-center text-sm text-[#6b6b6b]">
          {t("No active packages available.")}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {packages.map((item) => (
            <Card key={item.id} className="flex flex-col p-5">
              <div className="flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">
                    {item.name}
                  </h2>
                  <span className="shrink-0 rounded bg-[#dfff03]/10 px-2 py-1 text-xs text-[#dfff03]">
                    {t("{n} months", { n: item.durationMonths })}
                  </span>
                </div>
                <p className="mt-2 min-h-10 text-sm text-[#a0a0a0]">
                  {item.description}
                </p>
                {item.features.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {item.features.map((feature, index) => (
                      <li
                        key={`${item.id}-${index}`}
                        className="flex gap-2 text-sm text-[#d0d0d0]"
                      >
                        <span className="text-[#64dc78]">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-5 border-t border-[#262626] pt-4">
                <div className="text-xs uppercase tracking-wider text-[#6b6b6b]">
                  {t("Starting at")}
                </div>
                <div className="mt-1 text-xl font-bold text-[#dfff03]">
                  {formatSar.format(item.priceSar)}
                </div>
                {item.minPriceVisible != null && (
                  <div className="mt-1 text-xs text-[#a0a0a0]">
                    {t("Minimum price: {price}", { price: formatSar.format(item.minPriceVisible) })}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

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
    </div>
  )
}
