// منطق تصنيف حالة الموقع — دوال نقية (تشتغل في Deno و Node) عشان تتختبر بسهولة.
export type Category =
  | 'ok' | 'ok_protected' | 'dns' | 'dns_typo' | 'timeout' | 'ssl' | 'refused' | 'network'
  | 'http_404' | 'http_4xx' | 'http_5xx' | 'parked' | 'suspended' | 'redirect_loop' | 'invalid_url'

export interface CheckResult {
  status: 'working' | 'not_working'
  category: Category
  note: string          // وصف المشكلة بالعربي (يتخزن كملاحظة/كومنت)
  httpStatus: number | null
  isSalla: boolean
  finalUrl: string | null
}

const PARKED = [
  /this domain (is|may be) for sale/i, /domain is for sale/i, /buy this domain/i, /the domain .{0,40} has expired/i,
  /parked (free|domain)/i, /sedo\.com/i, /godaddy\.com\/domainsearch/i, /hugedomains/i, /dan\.com/i,
  /هذا النطاق (معروض|للبيع)/, /النطاق للبيع/,
]
const SUSPENDED = [
  /account (has been )?suspended/i, /this account has been suspended/i, /bandwidth limit exceeded/i,
  /site (is )?(temporarily )?(unavailable|disabled)/i, /الحساب (معلق|موقوف)/, /الموقع (متوقف|معطل)/,
]
const BOT_PROTECTION = [/cf-ray/i, /just a moment/i, /attention required/i, /cloudflare/i, /captcha/i, /access denied/i, /akamai/i, /incapsula/i, /sucuri/i]
const SALLA = [/cdn\.salla\.network/i, /salla\.sa/i, /<meta[^>]+salla/i, /salla-?(theme|app)/i, /\bSalla\b/]

export function normalizeUrl(raw: string | null | undefined): string | null {
  let s = (raw ?? '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '')
  try {
    const u = new URL(s)
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch { return null }
}

export function detectSalla(html: string, headers: Record<string, string> = {}): boolean {
  const h = Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n')
  return SALLA.some((r) => r.test(html) || r.test(h))
}

function hostOf(u: string | null): string {
  try { return new URL(u ?? '').hostname.replace(/^www\./, '') } catch { return '' }
}

/** يصنّف خطأ الشبكة من رسالته. */
export function classifyNetworkError(err: unknown): CheckResult {
  const name = (err as { name?: string })?.name ?? ''
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase()
  const cause = String(((err as { cause?: { code?: string; message?: string } })?.cause?.code ?? '') + ' ' +
                       ((err as { cause?: { message?: string } })?.cause?.message ?? '')).toLowerCase()
  const all = `${name} ${msg} ${cause}`.toLowerCase()
  const base = { httpStatus: null, isSalla: false, finalUrl: null } as const
  if (name === 'AbortError' || /timeout|timed out|aborted/.test(all))
    return { ...base, status: 'not_working', category: 'timeout', note: 'الموقع لا يستجيب (انتهت مهلة الاتصال 12 ثانية) — قد يكون بطيئاً جداً أو متوقفاً.' }
  if (/enotfound|dns|failed to lookup|name resolution|getaddrinfo|no such host|name or service not known/.test(all))
    return { ...base, status: 'not_working', category: 'dns', note: 'الدومين غير موجود أو منتهي (فشل DNS) — راجع كتابة الرابط أو أن الدومين ما زال مسجلاً.' }
  if (/certificate|ssl|tls|self.signed|cert_|handshake|unable to verify/.test(all))
    return { ...base, status: 'not_working', category: 'ssl', note: 'مشكلة شهادة الأمان (SSL) — المتصفح سيحذّر الزائر أو الموقع لا يفتح بـ https.' }
  if (/econnrefused|connection refused|refused/.test(all))
    return { ...base, status: 'not_working', category: 'refused', note: 'السيرفر رفض الاتصال — الموقع متوقف.' }
  if (/redirect/.test(all))
    return { ...base, status: 'not_working', category: 'redirect_loop', note: 'الموقع يعيد التوجيه في حلقة ولا يفتح.' }
  return { ...base, status: 'not_working', category: 'network', note: `تعذّر الاتصال بالموقع (${(msg || name || 'خطأ شبكة').slice(0, 80)}).` }
}

/** يصنّف استجابة HTTP (status + body + headers + الرابط النهائي بعد التحويلات). */
export function classifyResponse(
  originalUrl: string, finalUrl: string | null, status: number, html: string, headers: Record<string, string> = {},
): CheckResult {
  const isSalla = detectSalla(html, headers)
  const common = { httpStatus: status, isSalla, finalUrl }
  const hdr = Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n')
  const protectedBy = BOT_PROTECTION.some((r) => r.test(html) || r.test(hdr))

  if (status >= 500)
    return { ...common, status: 'not_working', category: 'http_5xx', note: `السيرفر يرجع خطأ ${status} — الموقع معطّل من جهة الاستضافة.` }
  if (status === 404 || status === 410)
    return { ...common, status: 'not_working', category: 'http_404', note: `الصفحة غير موجودة (${status}) — الرابط المسجّل خاطئ أو الموقع اتحذف.` }
  if ([401, 403, 429, 503].includes(status) && protectedBy)
    return { ...common, status: 'working', category: 'ok_protected', note: `الموقع يعمل لكن محمي ضد الفحص الآلي (${status}) — يحتاج فتح يدوي للتأكد.` }
  if (status >= 400)
    return { ...common, status: 'not_working', category: 'http_4xx', note: `الموقع يرد بخطأ ${status} — غير متاح للزوار.` }

  if (SUSPENDED.some((r) => r.test(html)))
    return { ...common, status: 'not_working', category: 'suspended', note: 'الموقع موقوف (الاستضافة معلّقة أو انتهت).' }
  const movedAway = hostOf(finalUrl) && hostOf(originalUrl) && hostOf(finalUrl) !== hostOf(originalUrl)
  if (PARKED.some((r) => r.test(html)) || (movedAway && /(sedo|godaddy|hugedomains|dan\.com|parking)/i.test(finalUrl ?? '')))
    return { ...common, status: 'not_working', category: 'parked', note: 'الدومين معروض للبيع أو غير مستخدم (صفحة Parked) — مفيش موقع فعلي.' }

  return { ...common, status: 'working', category: 'ok', note: movedAway ? `يعمل (تم تحويله إلى ${hostOf(finalUrl)}).` : 'الموقع يعمل.' }
}
