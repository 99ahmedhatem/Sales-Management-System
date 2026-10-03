import assert from 'node:assert/strict'
import test from 'node:test'
import { compareContract, normalizeExtracted, parseClaudeJson } from './reviewLogic.ts'

const expected = {
  clientName: 'أحمد محمد علي',
  clientPhone: '+966 50 123 4567',
  packageName: 'Business',
  priceSar: 3200,
  durationMonths: 12,
  startDate: '2026-10-01',
  endDate: '2027-10-01',
  storeUrl: 'https://www.example.com/',
}

const matchingExtraction = {
  client_name: 'محمد أحمد علي',
  client_phone: '0501234567',
  package_name: 'Business',
  price: 3200,
  currency: 'SAR',
  duration_months: 12,
  start_date: '2026-10-01',
  end_date: '2027-10-01',
  store_url: 'https://example.com',
  has_client_signature: true,
  has_company_signature: true,
  page_count: 2,
  readable: true,
}

test('accepts equivalent names, normalized phones, and matching contract terms', () => {
  const result = compareContract(matchingExtraction, expected)
  assert.equal(result.status, 'passed')
  assert.deepEqual(result.mismatches, [])
})

test('matches Arabic and English transliterations and reordered names', () => {
  const result = compareContract({
    ...matchingExtraction,
    client_name: 'Mohammed Ahmed Ali',
  }, expected)
  assert.equal(result.status, 'passed')
  assert.deepEqual(result.mismatches, [])
})

test('flags an exact SAR closing-price mismatch as high severity', () => {
  const result = compareContract({ ...matchingExtraction, price: 3000 }, expected)
  assert.equal(result.status, 'needs_attention')
  assert.equal(result.mismatches.find(item => item.field === 'price')?.severity, 'high')
})

test('requires the SAR currency even if the numeric amount matches', () => {
  const result = compareContract({ ...matchingExtraction, currency: 'EGP' }, expected)
  assert.equal(result.mismatches.find(item => item.field === 'price')?.severity, 'high')
})

test('uses high severity for package, phone, and duration but medium for dates and store URL', () => {
  const result = compareContract({
    ...matchingExtraction,
    client_phone: '0500000000',
    package_name: 'Starter',
    duration_months: 6,
    start_date: '2026-11-01',
    store_url: 'https://different.example',
  }, expected)
  assert.equal(result.mismatches.find(item => item.field === 'client_phone')?.severity, 'high')
  assert.equal(result.mismatches.find(item => item.field === 'package_name')?.severity, 'high')
  assert.equal(result.mismatches.find(item => item.field === 'duration_months')?.severity, 'high')
  assert.equal(result.mismatches.find(item => item.field === 'start_date')?.severity, 'medium')
  assert.equal(result.mismatches.find(item => item.field === 'store_url')?.severity, 'medium')
})

test('flags missing signatures and unreadable pages', () => {
  const result = compareContract({
    ...matchingExtraction,
    has_client_signature: false,
    has_company_signature: false,
    readable: false,
    page_count: 0,
  }, expected)
  assert.equal(result.status, 'needs_attention')
  assert.ok(result.mismatches.some(item => item.field === 'has_client_signature' && item.severity === 'high'))
  assert.ok(result.mismatches.some(item => item.field === 'has_company_signature' && item.severity === 'high'))
  assert.ok(result.mismatches.some(item => item.field === 'readable' && item.severity === 'high'))
  assert.ok(result.mismatches.some(item => item.field === 'page_count' && item.severity === 'high'))
})

test('keeps a minor name difference at medium severity', () => {
  const result = compareContract({ ...matchingExtraction, client_name: 'أحمد علي' }, expected)
  assert.equal(result.mismatches.find(item => item.field === 'client_name')?.severity, 'medium')
})

test('parses only the expected Claude JSON fields', () => {
  const parsed = parseClaudeJson(`\`\`\`json\n${JSON.stringify({
    extracted: matchingExtraction,
    summary: 'تمت مراجعة العقد ومطابقة بياناته. التوقيعات واضحة.',
    mismatches: [{ field: 'ignored' }],
  })}\n\`\`\``)
  assert.deepEqual(normalizeExtracted(parsed.extracted), matchingExtraction)
  assert.equal(parsed.summary, 'تمت مراجعة العقد ومطابقة بياناته. التوقيعات واضحة.')
})

test('rejects malformed Claude output', () => {
  assert.throws(() => parseClaudeJson('not json'), SyntaxError)
})

test('rejects incomplete Claude extraction payloads', () => {
  assert.throws(
    () => parseClaudeJson(JSON.stringify({ extracted: {}, summary: 'تمت المراجعة.' })),
    /invalid review JSON/,
  )
})
