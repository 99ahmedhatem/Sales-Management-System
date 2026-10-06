// send-notifications: يبعت إشعارات السستم (جدول notifications) كـ Push على الأجهزة و/أو إيميل.
// المستدعي: الجدولة كل دقيقة (header x-cron-secret = CRON_SECRET) أو الأدمن (JWT) للتجربة.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
//          اختياري للإيميل: RESEND_API_KEY, MAIL_FROM
// انشره بـ --no-verify-jwt عشان الجدولة تقدر تناديه بالـ secret؛ التحقق بيتم هنا.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface Claimed {
  notification_id: string
  user_id: string
  type: string
  title: string
  message: string
  email: string | null
  push_enabled: boolean
  email_enabled: boolean
  subscriptions: { endpoint: string; p256dh: string; auth: string }[]
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: 'Supabase function secrets are not configured' })

  const fromCron = Boolean(cronSecret) && request.headers.get('x-cron-secret') === cronSecret
  if (!fromCron) {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Authentication required' })
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data: role, error } = await userClient.rpc('my_role')
    if (error) return json(500, { error: `Could not verify caller role: ${error.message}` })
    if (role !== 'admin') return json(403, { error: 'Only admin can send notifications manually' })
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  const pushReady = Boolean(vapidPublic && vapidPrivate && vapidSubject)
  if (pushReady) webpush.setVapidDetails(vapidSubject!, vapidPublic!, vapidPrivate!)
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const mailFrom = Deno.env.get('MAIL_FROM')
  const emailReady = Boolean(resendKey && mailFrom)

  const service = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await service.rpc('claim_notifications_to_send', { p_limit: 100 })
  if (error) return json(500, { error: error.message })
  const rows = (data ?? []) as Claimed[]

  let pushed = 0, pushFailed = 0, removedDevices = 0, emailed = 0, emailFailed = 0

  for (const n of rows) {
    if (pushReady && n.push_enabled) {
      const payload = JSON.stringify({ title: n.title, body: n.message, type: n.type, id: n.notification_id, url: '/' })
      for (const sub of n.subscriptions ?? []) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 * 24 })
          pushed++
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode
          if (code === 404 || code === 410) {
            // الجهاز لغى الاشتراك: نشيله
            await service.rpc('drop_push_subscription', { p_endpoint: sub.endpoint })
            removedDevices++
          } else {
            pushFailed++
            console.error('push failed', code, (e as Error).message)
          }
        }
      }
    }
    if (emailReady && n.email_enabled && n.email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: mailFrom,
          to: [n.email],
          subject: n.title,
          html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px"><p><b>${escapeHtml(n.title)}</b></p><p>${escapeHtml(n.message)}</p></div>`,
          text: `${n.title}\n\n${n.message}`,
        }),
      })
      if (res.ok) emailed++
      else { emailFailed++; console.error('email failed', res.status, await res.text()) }
    }
  }

  return json(200, {
    claimed: rows.length, pushed, push_failed: pushFailed, removed_devices: removedDevices,
    emailed, email_failed: emailFailed, push_configured: pushReady, email_configured: emailReady,
  })
})
