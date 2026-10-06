// check-websites: يفحص مواقع الـ Leads على دفعات ويسجل (يعمل / لا يعمل + سبب المشكلة).
// الاستدعاء: POST (من الأدمن بالـ JWT، أو من الـ cron بـ header  x-cron-secret = CRON_SECRET)
//   body اختياري: { "batch": 40, "lead_id": "<uuid>" }  — lead_id لفحص عميل واحد فوراً.
import { findWorkingHost } from './suggest.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { classifyNetworkError, classifyResponse, normalizeUrl, type CheckResult } from './classify.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const TIMEOUT_MS = 12_000
const CONCURRENCY = 8
const UA = 'Mozilla/5.0 (compatible; IntillaqSiteCheck/1.0; +internal)'

async function checkOne(raw: string): Promise<CheckResult> {
  const url = normalizeUrl(raw)
  if (!url) return { status: 'not_working', category: 'invalid_url', note: 'رابط الموقع غير صالح أو ناقص.', httpStatus: null, isSalla: false, finalUrl: null }
  const tryFetch = async (u: string) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(u, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'ar,en;q=0.8' } })
      const reader = res.body?.getReader()
      let html = ''
      if (reader) {
        const dec = new TextDecoder()
        while (html.length < 200_000) {
          const { done, value } = await reader.read()
          if (done) break
          html += dec.decode(value, { stream: true })
        }
        reader.cancel().catch(() => {})
      }
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => { headers[k] = v })
      return classifyResponse(u, res.url || u, res.status, html, headers)
    } finally { clearTimeout(t) }
  }
  try {
    return await tryFetch(url)
  } catch (e1) {
    // لو https فشل بسبب SSL/اتصال، جرّب http مرة واحدة قبل الحكم
    const r1 = classifyNetworkError(e1)
    if (url.startsWith('https://') && ['ssl', 'refused', 'network'].includes(r1.category)) {
      try {
        const r2 = await tryFetch('http://' + url.slice(8))
        if (r2.status === 'working') return { ...r2, note: 'يعمل على http فقط (شهادة https بها مشكلة).' }
      } catch { /* نرجع بنتيجة https */ }
    }
    if (r1.category === 'dns') {
      try {
        const host = new URL(url).hostname
        const alt = await findWorkingHost(host)
        if (alt) return { ...r1, category: 'dns_typo', note: `الدومين غير موجود (${host}) — ربما المقصود: ${alt} (راجع كتابة الرابط).` }
        return { ...r1, note: `الدومين غير موجود أو منتهي (${host}) — ولا يوجد بديل قريب؛ غالباً الدومين انتهى أو الرابط خاطئ.` }
      } catch { /* نرجع بنتيجة dns */ }
    }
    return r1
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const service = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { batch?: number; lead_id?: string } = {}
  try { body = await req.json() } catch { /* body اختياري */ }

  // --- صلاحية: cron secret أو أدمن (أو مدير لعميل واحد) ---
  const cronSecret = Deno.env.get('CRON_SECRET')
  const fromCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
  if (!fromCron) {
    const auth = req.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return json(401, { error: 'Authentication required' })
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
    const { data: u } = await userClient.auth.getUser()
    if (!u?.user) return json(401, { error: 'Invalid session' })
    const { data: prof } = await service.from('users').select('role,status').eq('id', u.user.id).single()
    if (prof?.status !== 'active') return json(403, { error: 'Admin only' })
    if (prof?.role !== 'admin') {
      // المدير يقدر يعيد فحص عميل واحد يقدر يشوفه (زر Re-check في كارت العميل)، مش الفحص الجماعي
      if (prof?.role !== 'manager' || !body.lead_id) return json(403, { error: 'Admin only' })
      const { data: canView, error: viewErr } = await userClient.rpc('can_view_lead', { p_lead_id: body.lead_id })
      if (viewErr) return json(500, { error: viewErr.message })
      if (!canView) return json(403, { error: 'You are not allowed to view this client' })
    }
  }
  const batch = Math.min(Math.max(Number(body.batch) || 40, 1), 100)

  let rows: { id: string; website: string }[] | null = null
  if (body.lead_id) {
    const { data, error } = await service.from('leads').select('id,website').eq('id', body.lead_id).not('website', 'is', null)
    if (error) return json(500, { error: error.message })
    rows = data as { id: string; website: string }[]
  } else {
    const { data, error } = await service.rpc('claim_websites_to_check', { p_limit: batch })
    if (error) return json(500, { error: error.message })
    rows = data as { id: string; website: string }[]
  }
  if (!rows?.length) return json(200, { checked: 0, remaining: 0, message: 'Nothing to check' })

  const results = await pool(rows, CONCURRENCY, async (r) => ({ id: r.id, ...(await checkOne(r.website)) }))
  const payload = results.map((r) => ({ id: r.id, status: r.status, category: r.category, note: r.note, http_status: r.httpStatus, is_salla: r.isSalla }))
  const { data: saved, error: saveErr } = await service.rpc('save_website_checks', { p_results: payload })
  if (saveErr) return json(500, { error: saveErr.message })

  const summary: Record<string, number> = {}
  for (const r of results) summary[r.category] = (summary[r.category] ?? 0) + 1
  const { count } = await service.from('leads').select('id', { count: 'exact', head: true }).not('website', 'is', null).is('website_checked_at', null)
  return json(200, {
    checked: results.length, saved, by_category: summary, remaining: count ?? null,
    // لعميل واحد: النتيجة نفسها عشان كارت العميل يعرضها على طول
    results: body.lead_id ? payload : undefined,
  })
})
