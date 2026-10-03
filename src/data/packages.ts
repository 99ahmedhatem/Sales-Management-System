export interface SalesPackage {
  id: string

  name: string

  description: string

  features: string[]

  durationMonths: number

  priceSar: number

  minPriceSar: number

  isActive: boolean
}

export interface SalesPackageRow {
  id: string

  name: string

  description: string | null

  features: string[] | null

  duration_months: number

  price_sar: number

  min_price_sar: number

  is_active: boolean
}

export function mapSalesPackage(row: SalesPackageRow): SalesPackage {
  return {
    id: row.id,

    name: row.name,

    description: row.description ?? "",

    features: row.features ?? [],

    durationMonths: row.duration_months,

    priceSar: Number(row.price_sar),

    minPriceSar: Number(row.min_price_sar),

    isActive: row.is_active,
  }
}
