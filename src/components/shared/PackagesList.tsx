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

export default function PackagesList() {
  const { t } = useI18n()

  const [packages, setPackages] = useState<SalesPackage[]>([])

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

      const { data, error: queryError } = await supabase

        .from("packages")

        .select(
          "id, name, description, features, duration_months, price_sar, min_price_sar, is_active",
        )

        .eq("is_active", true)

        .order("price_sar")

        .order("name")

        .range(from, from + PAGE_SIZE)

      if (!active) return

      if (queryError) {
        setError(queryError.message)

        setPackages([])
      } else {
        const rows = (data ?? []) as SalesPackageRow[]

        setHasMore(rows.length > PAGE_SIZE)

        setPackages(rows.slice(0, PAGE_SIZE).map(mapSalesPackage))
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
          className="rounded border border-[#ff6464]/30 bg-[#ff6464]/10 p-3 text-sm text-[#ff8888]"
        >
          {error}
        </div>
      )}
      {loading ? (
        <div className="py-12 text-center text-sm text-[#6b6b6b]">
          {t("Loading packages...")}
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
