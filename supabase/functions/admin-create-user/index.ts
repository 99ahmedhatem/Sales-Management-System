import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CREATABLE_ROLES = new Set(['manager', 'sales', 'telesales'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Optional number; empty/missing = 0, invalid = NaN. */
function numberField(value: unknown): number {
  return value === undefined || value === null || value === '' ? 0 : Number(value)
}

function employeeCode(): string {
  return `EMP-${crypto.randomUUID().split('-')[0].toUpperCase()}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Authentication required' })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error()
    body = parsed as Record<string, unknown>
  } catch {
    return jsonResponse(400, { error: 'Request body must be a JSON object' })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const role = typeof body.role === 'string' ? body.role : ''
  const managerId = typeof body.manager_id === 'string' && body.manager_id ? body.manager_id : null
  const commissionPercent = numberField(body.commission_percent)
  const leadPercent = numberField(body.lead_percent)
  const managerPercent = numberField(body.manager_percent)
  const baseSalary = numberField(body.base_salary)
  const baseCurrency = typeof body.base_currency === 'string' && body.base_currency ? body.base_currency : 'EGP'

  if (!EMAIL_PATTERN.test(email)) return jsonResponse(400, { error: 'A valid email is required' })
  if (password.length < 8) return jsonResponse(400, { error: 'Password must be at least 8 characters' })
  if (!fullName) return jsonResponse(400, { error: 'Full name is required' })
  if (!CREATABLE_ROLES.has(role)) return jsonResponse(400, { error: 'Role must be manager, sales or telesales' })
  for (const [label, value] of [['Commission %', commissionPercent], ['Lead %', leadPercent], ['Manager %', managerPercent]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return jsonResponse(400, { error: `${label} must be between 0 and 100` })
    }
  }
  if (!Number.isFinite(baseSalary) || baseSalary < 0) return jsonResponse(400, { error: 'Base salary cannot be negative' })
  if (baseCurrency !== 'EGP' && baseCurrency !== 'SAR') return jsonResponse(400, { error: 'Currency must be SAR or EGP' })
  if (managerId && !UUID_PATTERN.test(managerId)) return jsonResponse(400, { error: 'Invalid manager id' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')
    ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Supabase function secrets are not configured' })
  }

  // Caller identity and role are checked with the caller's own JWT.
  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) {
    return jsonResponse(401, { error: 'Invalid or expired access token' })
  }
  const { data: callerRole, error: roleError } = await userClient.rpc('my_role')
  if (roleError) {
    return jsonResponse(500, { error: `Could not verify caller role: ${roleError.message}` })
  }
  if (callerRole !== 'admin') {
    return jsonResponse(403, { error: 'Only admins can create users' })
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const assignedManagerId = ['sales', 'telesales'].includes(role) ? managerId : null
  if (assignedManagerId) {
    const { data: manager, error: managerError } = await service
      .from('users')
      .select('id')
      .eq('id', assignedManagerId)
      .eq('role', 'manager')
      .maybeSingle()
    if (managerError) return jsonResponse(500, { error: managerError.message })
    if (!manager) return jsonResponse(400, { error: 'Selected manager does not exist' })
  }

  const username = employeeCode()
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { employee_code: username, full_name: fullName },
  })
  if (createError || !created.user) {
    return jsonResponse(400, { error: createError?.message ?? 'Could not create the login account' })
  }

  // on_auth_user_created inserts the profile with role 'sales'; set the real values.
  const { error: profileError } = await service.from('users').upsert({
    id: created.user.id,
    full_name: fullName,
    username,
    email,
    role,
    status: 'active',
    manager_id: assignedManagerId,
    commission_percent: commissionPercent,
  })
  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id)
    return jsonResponse(500, { error: `Could not save the user profile: ${profileError.message}` })
  }

  // Salary and percentages (008). Sales/telesales only: managers earn from their team's rows.
  const earnsCommission = role === 'sales' || role === 'telesales'
  const { error: payError } = await service.from('user_commission_rates').upsert({
    user_id: created.user.id,
    base_salary: baseSalary,
    base_currency: baseCurrency,
    closer_percent: earnsCommission ? commissionPercent : 0,
    lead_percent: role === 'telesales' ? leadPercent : 0,
    manager_percent: earnsCommission ? managerPercent : 0,
    updated_by: authData.user.id,
  })
  if (payError) {
    await service.auth.admin.deleteUser(created.user.id)
    return jsonResponse(500, { error: `Could not save salary and commission: ${payError.message}` })
  }

  return jsonResponse(200, { user_id: created.user.id, username, email })
})
