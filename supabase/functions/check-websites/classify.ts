// تصنيف نتيجة فحص موقع: يعمل / لا يعمل + سبب واضح بالعربي.
// منطق خالص (بدون شبكة) عشان يتختبر بسهولة؛ الشبكة في index.ts.

export type WebsiteCategory =
  | 'ok' | 'ok_protected'
  | 'dns' | 'timeout' | 'ssl' | 'refused' | 'network' | 'invalid_url'
  | 'http_404' | 'http_4xx' | 'http_5xx' | 'parked' | 'suspended'

export interface CheckResult {
  status: 'working' | 'not_working'
  category: WebsiteCategory
  note: string
  http_status: number | null
  is_salla: boolean
}

const NOTES: Record<WebsiteCategory, string> = {
  ok: 'الموقع يفتح بشكل طبيعي.',
  ok_protected: 'الموقع موجود لكنه محمي (Cloudflare/حماية من البوتات) فما قدرناش نقرأ محتواه.',
  dns: 'الدومين غير موجود أو منتهي (مفيش DNS).',
  timeout: 'الموقع ما ردّش خلال المهلة (بطيء جداً أو السيرفر واقف).',
  ssl: 'شهادة الأمان (SSL) منتهية أو غير صالحة.',
  refused: 'السيرفر رافض الاتصال (الاستضافة واقفة).',
  network: 'خطأ اتصال أثناء فتح الموقع.',
  invalid_url: 'رابط الموقع مكتوب غلط.',
  http_404: 'الصفحة غير موجودة (404).',
  http_4xx: 'الموقع رجّع خطأ في الطلب.',
  http_5xx: 'خطأ في سيرفر الموقع.',
  parked: 'الدومين معروض للبيع أو صفحة Parking (مفيش موقع فعلي).',
  suspended: 'الموقع أو المتجر موقوف/مغلق.',
}

const PARKED = [
  /domain (is )?for sale/i, /buy this domain/i, /this domain (name )?(is|has been) (parked|registered)/i,
  /parkingcrew|sedoparking|sedo\.com|bodis\.com|dan\.com\/buy|afternic|hugedomains/i,
  /godaddy.{0,40}(parked|coming soon)/i, /هذا النطاق (للبيع|معروض)/, /الدومين للبيع/,
]
const SUSPENDED = [
  /account (has been )?suspended/i, /this (site|website|account) (is|has been) suspended/i,
  /website (is )?(expired|disabled)/i, /store (is )?(closed|unavailable|not found)/i,
  /المتجر (مغلق|متوقف|غير متاح)/, /المتجر تحت الصيانة/, /تم إيقاف (المتجر|الموقع)/, /الموقع موقوف/,
]
const PROTECTED = [/cf-challenge|challenge-platform|just a moment\.\.\.|attention required! \| cloudflare/i, /captcha/i, /ddos-guard/i]
const SALLA = [/salla\.(sa|network|store)/i, /cdn\.salla/i]

export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (!url.hostname.includes('.') || /\s/.test(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function result(category: WebsiteCategory, http: number | null, isSalla: boolean, extra = ''): CheckResult {
  const working = category === 'ok' || category === 'ok_protected'
  return {
    status: working ? 'working' : 'not_working',
    category,
    note: extra ? `${NOTES[category]} ${extra}` : NOTES[category],
    http_status: http,
    is_salla: isSalla,
  }
}

/** خطأ شبكة (fetch رمى exception) → تصنيف. */
export function classifyError(error: unknown): CheckResult {
  const msg = String((error as Error)?.message ?? error).toLowerCase()
  const name = String((error as Error)?.name ?? '')
  if (name === 'TimeoutError' || name === 'AbortError' || msg.includes('timed out') || msg.includes('timeout')) return result('timeout', null, false)
  if (/dns|lookup|name or service not known|nodename nor servname|no address associated|failed to resolve/.test(msg)) return result('dns', null, false)
  if (/certificate|ssl|tls|handshake|unknownissuer|notvalidforname|expired/.test(msg)) return result('ssl', null, false)
  if (/connection refused|econnrefused|refused/.test(msg)) return result('refused', null, false)
  if (/invalid url|relative url|url parse/.test(msg)) return result('invalid_url', null, false)
  return result('network', null, false)
}

/** استجابة HTTP (مع أول جزء من الصفحة) → تصنيف. */
export function classifyResponse(status: number, finalUrl: string, body: string, server = ''): CheckResult {
  const isSalla = SALLA.some(re => re.test(finalUrl) || re.test(body))
  const protectedPage = PROTECTED.some(re => re.test(body)) || /cloudflare|ddos-guard/i.test(server)
  if ((status === 401 || status === 403 || status === 429 || status === 503) && protectedPage) return result('ok_protected', status, isSalla)
  if (status === 404 || status === 410) return result('http_404', status, isSalla)
  if (status >= 500) return result('http_5xx', status, isSalla, `(HTTP ${status})`)
  if (status === 401 || status === 403 || status === 429) return result('ok_protected', status, isSalla)
  if (status >= 400) return result('http_4xx', status, isSalla, `(HTTP ${status})`)
  if (PARKED.some(re => re.test(body))) return result('parked', status, isSalla)
  if (SUSPENDED.some(re => re.test(body))) return result('suspended', status, isSalla)
  return result('ok', status, isSalla)
}

export function invalidUrl(): CheckResult {
  return result('invalid_url', null, false)
}
