// check-websites: يفحص مواقع العملاء (يعمل / لا يعمل + السبب) ويحفظ النتيجة عبر save_website_checks.
// المستدعي: الأدمن من الموقع (JWT) أو الجدولة (header x-cron-secret = CRON_SECRET).
//   body { batch: 40 }  → يحجز دفعة بـ claim_websites_to_check ويفحصها
//   body { lead_id }    → يفحص عميل واحد (أدمن أو مدير يقدر يشوف العميل)
// يرجّع { checked, saved, by_category, remaining }
// انشره بـ --no-verify-jwt عشان الجدولة تقدر تناديه بالـ secret؛ التحقق بيتم هنا.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CheckResult, classifyError, classifyResponse, invalidUrl, normalizeUrl } from './classify.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMEOUT_MS = 12_000
const MAX_BODY_BYTES = 200_000
const CONCURRENCY = 8
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function readSome(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < MAX_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      size += value.length
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) { all.set(c, offset); offset += c.length }
  return new TextDecoder('utf-8', { fatal: false }).decode(all)
}

async function fetchOnce(url: string): Promise<CheckResult> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ar,en;q=0.8' },
  })
  const body = await readSome(response)
  return classifyResponse(response.status, response.url || url, body, response.headers.get('server') ?? '')
}

export async function checkWebsite(raw: string): Promise<CheckResult> {
  const url = normalizeUrl(raw)
  if (!url) return invalidUrl()
  try {
    return await fetchOnce(url)
  } catch (error) {
    const first = classifyError(error)
    // بعض المواقع القديمة شغالة على http بس (أو شهادتها بايظة): نجرب http قبل ما نحكم
    if ((first.category === 'ssl' || first.category === 'refused' || first.category === 'network') && url.startsWith('https://')) {
      try {
        const viaHttp = await fetchOnce(url.replace(/^https:/, 'http:'))
        if (viaHttp.status === 'working' && first.category === 'ssl') {
          return { ...viaHttp, note: `${viaHttp.note} (يعمل على http فقط — شهادة SSL غير صالحة)` }
        }
        return viaHttp
      } catch { /* نرجّع الخطأ الأول */ }
    }
    return first
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: 'Supabase function secrets are not configured' })

  let body: Record<string, unknown> = {}
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch { /* empty body = default batch */ }

  const leadId = typeof body.lead_id === 'string' ? body.lead_id : ''
  if (leadId && !UUID_PATTERN.test(leadId)) return json(400, { error: 'Invalid lead_id' })
  const batch = Math.min(Math.max(Number(body.batch) || 40, 1), 100)

  // ---- مين بينادي؟ ----
  const fromCron = Boolean(cronSecret) && request.headers.get('x-cron-secret') === cronSecret
  if (!fromCron) {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Authentication required' })
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) return json(401, { error: 'Invalid or expired access token' })
    const { data: role, error: roleError } = await userClient.rpc('my_role')
    if (roleError) return json(500, { error: `Could not verify caller role: ${roleError.message}` })
    if (leadId) {
      if (role !== 'admin' && role !== 'manager') return json(403, { error: 'Only admin or manager can check a website' })
      const { data: canView, error: viewError } = await userClient.rpc('can_view_lead', { p_lead_id: leadId })
      if (viewError) return json(500, { error: viewError.message })
      if (!canView) return json(403, { error: 'You are not allowed to view this client' })
    } else if (role !== 'admin') {
      return json(403, { error: 'Only admin can run the website check' })
    }
  }

  const service = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // ---- إيه اللي هيتفحص؟ ----
  let rows: { id: string; website: string }[] = []
  if (leadId) {
    const { data, error } = await service.from('leads').select('id, website').eq('id', leadId).maybeSingle()
    if (error) return json(500, { error: error.message })
    if (!data) return json(404, { error: 'Client not found' })
    if (!data.website || !String(data.website).trim()) return json(400, { error: 'This client has no website' })
    rows = [{ id: data.id, website: data.website }]
  } else {
    const { data, error } = await service.rpc('claim_websites_to_check', { p_limit: batch })
    if (error) return json(500, { error: error.message })
    rows = (data ?? []) as { id: string; website: string }[]
  }

  const results = await mapPool(rows, CONCURRENCY, async row => ({ id: row.id, ...(await checkWebsite(row.website)) }))

  let saved = 0
  if (results.length) {
    const { data, error } = await service.rpc('save_website_checks', { p_results: results })
    if (error) return json(500, { error: error.message })
    saved = Number(data ?? 0)
  }

  const byCategory: Record<string, number> = {}
  for (const r of results) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1

  // المتبقي: مواقع لسه ما اتفحصتش أبداً (ونفس شروط claim_websites_to_check)
  const { count, error: countError } = await service
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .not('website', 'is', null)
    .neq('website', '')
    .is('website_checked_at', null)
    .or('website_status_source.is.null,website_status_source.neq.manual,website_status.is.null')

  return json(200, {
    checked: results.length,
    saved,
    by_category: byCategory,
    remaining: countError ? null : count ?? 0,
    results: leadId ? results : undefined,
  })
})
