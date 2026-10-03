export interface ExtractedContract {
  client_name: string
  client_phone: string
  package_name: string
  price: number
  currency: string
  duration_months: number
  start_date: string
  end_date: string
  store_url: string
  has_client_signature: boolean
  has_company_signature: boolean
  page_count: number
  readable: boolean
}

export interface ContractMismatch {
  field: string
  expected: unknown
  found: unknown
  severity: 'high' | 'medium'
  note: string
}

export interface ReviewComparison {
  extracted: ExtractedContract
  mismatches: ContractMismatch[]
  status: 'passed' | 'needs_attention'
}

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const asFiniteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const asBoolean = (value: unknown): boolean => value === true

export function normalizeExtracted(value: unknown): ExtractedContract {
  const raw = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}

  return {
    client_name: asString(raw.client_name),
    client_phone: asString(raw.client_phone),
    package_name: asString(raw.package_name),
    price: asFiniteNumber(raw.price),
    currency: asString(raw.currency).toUpperCase(),
    duration_months: asFiniteNumber(raw.duration_months),
    start_date: asString(raw.start_date),
    end_date: asString(raw.end_date),
    store_url: asString(raw.store_url),
    has_client_signature: asBoolean(raw.has_client_signature),
    has_company_signature: asBoolean(raw.has_company_signature),
    page_count: asFiniteNumber(raw.page_count),
    readable: asBoolean(raw.readable),
  }
}

function cleanedName(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function normalizeName(value: string): string {
  return cleanedName(value)
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

const arabicToLatin: Record<string, string> = {
  ا: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's',
  ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q',
  ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y',
  ء: '', ؤ: 'w', ئ: 'y',
}

function nameConsonants(value: string): string[] {
  return cleanedName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      const latin = [...token].map(char => arabicToLatin[char] ?? char).join('')
      return latin
        .replace(/[aeiouwy]/g, '')
        .replace(/(.)\1+/g, '$1')
    })
    .sort()
}

function nameSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeName(left).split(' ').filter(Boolean))
  const rightTokens = new Set(normalizeName(right).split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  const shared = [...leftTokens].filter(token => rightTokens.has(token)).length
  const directScore = shared / Math.max(leftTokens.size, rightTokens.size)

  const leftConsonants = new Set(nameConsonants(left))
  const rightConsonants = new Set(nameConsonants(right))
  if (leftConsonants.has('') || rightConsonants.has('')) return directScore
  const sharedConsonants = [...leftConsonants].filter(token => rightConsonants.has(token)).length
  const transliterationScore = sharedConsonants / Math.max(leftConsonants.size, rightConsonants.size)
  if (transliterationScore === 1) {
    const allTokensInformative = [...leftConsonants, ...rightConsonants].every(token => token.length >= 3)
    if (leftConsonants.size > 1 || allTokensInformative) return 1
  }
  return Math.max(directScore, Math.min(transliterationScore, 0.75))
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, '').replace(/^00/, '')
  if (digits.startsWith('966') && digits.length > 10) digits = digits.slice(3)
  if (digits.startsWith('20') && digits.length > 11) digits = digits.slice(2)
  return digits.replace(/^0+/, '')
}

function normalizeDate(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? ''
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\/+$/, '')
  return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '')
}

export function compareContract(
  rawExtracted: unknown,
  expected: {
    clientName: string
    clientPhone: string
    packageName: string
    priceSar: number
    durationMonths: number
    startDate: string | null
    endDate: string | null
    storeUrl: string | null
  },
): ReviewComparison {
  const extracted = normalizeExtracted(rawExtracted)
  const mismatches: ContractMismatch[] = []
  const add = (
    field: string,
    expectedValue: unknown,
    found: unknown,
    severity: ContractMismatch['severity'],
    note: string,
  ) => mismatches.push({ field, expected: expectedValue, found, severity, note })

  if (!extracted.readable) {
    add('readable', true, false, 'high', 'العقد غير مقروء بالكامل أو توجد صفحات غير واضحة.')
  }
  if (extracted.page_count <= 0) {
    add('page_count', 'صفحة واحدة على الأقل', extracted.page_count, 'high', 'تعذر تحديد صفحات العقد.')
  }
  if (!extracted.has_client_signature) {
    add('has_client_signature', true, false, 'high', 'توقيع العميل غير ظاهر في العقد.')
  }
  if (!extracted.has_company_signature) {
    add('has_company_signature', true, false, 'high', 'توقيع الشركة غير ظاهر في العقد.')
  }

  const nameScore = nameSimilarity(expected.clientName, extracted.client_name)
  if (nameScore < 1) {
    add(
      'client_name',
      expected.clientName,
      extracted.client_name,
      nameScore >= 0.5 ? 'medium' : 'high',
      nameScore >= 0.5 ? 'اسم العميل متقارب لكنه غير مطابق تمامًا.' : 'اسم العميل في العقد مختلف بوضوح.',
    )
  }

  if (
    expected.clientPhone
    && normalizePhone(expected.clientPhone) !== normalizePhone(extracted.client_phone)
  ) {
    add('client_phone', expected.clientPhone, extracted.client_phone, 'high', 'رقم الهاتف في العقد غير مطابق.')
  }
  if (normalizeName(expected.packageName) !== normalizeName(extracted.package_name)) {
    add('package_name', expected.packageName, extracted.package_name, 'high', 'الباقة في العقد غير مطابقة.')
  }
  if (extracted.currency !== 'SAR' || extracted.price !== expected.priceSar) {
    add(
      'price',
      { amount: expected.priceSar, currency: 'SAR' },
      { amount: extracted.price, currency: extracted.currency },
      'high',
      'سعر الإغلاق أو العملة في العقد غير مطابقين.',
    )
  }
  if (extracted.duration_months !== expected.durationMonths) {
    add('duration_months', expected.durationMonths, extracted.duration_months, 'high', 'مدة الاشتراك في العقد غير مطابقة.')
  }

  for (const [field, expectedValue, found] of [
    ['start_date', expected.startDate, extracted.start_date],
    ['end_date', expected.endDate, extracted.end_date],
  ] as const) {
    if (expectedValue && normalizeDate(expectedValue) !== normalizeDate(found)) {
      add(field, normalizeDate(expectedValue), normalizeDate(found), 'medium', 'التاريخ في العقد غير مطابق.')
    }
  }

  if (expected.storeUrl && normalizeUrl(expected.storeUrl) !== normalizeUrl(extracted.store_url)) {
    add('store_url', expected.storeUrl, extracted.store_url, 'medium', 'رابط المتجر في العقد غير مطابق.')
  }

  return {
    extracted,
    mismatches,
    status: mismatches.length === 0 ? 'passed' : 'needs_attention',
  }
}

export function parseClaudeJson(responseText: string): {
  extracted: unknown
  summary: string
} {
  const trimmed = responseText.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed: unknown = JSON.parse(withoutFence)
  if (typeof parsed !== 'object' || parsed === null || !('extracted' in parsed)) {
    throw new Error('Claude returned invalid review JSON: missing extracted fields')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.extracted !== 'object' || record.extracted === null) {
    throw new Error('Claude returned invalid review JSON: extracted must be an object')
  }
  const extracted = record.extracted as Record<string, unknown>
  const stringFields = [
    'client_name',
    'client_phone',
    'package_name',
    'currency',
    'start_date',
    'end_date',
    'store_url',
  ]
  const numberFields = ['price', 'duration_months', 'page_count']
  const booleanFields = [
    'has_client_signature',
    'has_company_signature',
    'readable',
  ]
  if (
    stringFields.some(field => typeof extracted[field] !== 'string')
    || numberFields.some(field =>
      typeof extracted[field] !== 'number' || !Number.isFinite(extracted[field])
    )
    || booleanFields.some(field => typeof extracted[field] !== 'boolean')
  ) {
    throw new Error('Claude returned invalid review JSON: extracted fields have invalid types')
  }
  if (typeof record.summary !== 'string' || !record.summary.trim()) {
    throw new Error('Claude returned invalid review JSON: missing summary')
  }
  return { extracted: record.extracted, summary: record.summary.trim().slice(0, 4000) }
}
