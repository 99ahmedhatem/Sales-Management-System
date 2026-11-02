// Website check run from YOUR computer (VS Code terminal), more accurate than the Supabase Edge Function:
//   · requests come from a normal internet connection, not a data-center server that many Gulf sites block
//   · real Chrome headers, 20 s timeout, a second try, and fallbacks (http ↔ https, with / without www.)
//   · a site that answers 401 / 403 / 429 is alive (it only refuses robots) → "working (protected)"
//   · optional --browser pass: sites that still fail are opened in a real headless Chrome (Playwright)
// Results are saved with the same database function as the system's check (save_website_checks):
// a status you set by hand is never overwritten, and the team sees a comment when a site's status changes.
//
// Setup (once): put these two lines in .env.local in the project folder (the file is git-ignored):
//   SUPABASE_URL=https://zchhqqsagrqyexzpfrms.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<Supabase → Project Settings → API Keys → service_role (secret)>
//
// Run (Node 22.6 or newer):
//   node --experimental-strip-types scripts/check-websites-local.mjs                 → clients never checked
//   node --experimental-strip-types scripts/check-websites-local.mjs --failed        → only "not working" (re-check)
//   node --experimental-strip-types scripts/check-websites-local.mjs --all           → every client with a website
//   add --limit 200 to try a few first, --dry-run to print without saving, --browser for the real-Chrome pass
import fs from 'node:fs';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { classifyNetworkError, classifyResponse, normalizeUrl } from '../supabase/functions/check-websites/classify.ts';

// ---------- settings ----------
for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local (see the top of this file).');
  process.exit(1);
}
const args = process.argv.slice(2);
const mode = args.includes('--all') ? 'all' : args.includes('--failed') ? 'failed' : 'unchecked';
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) || 0 : 0;
const DRY = args.includes('--dry-run');
const BROWSER = args.includes('--browser');
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 10;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- one site ----------
async function fetchOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: HEADERS });
    let html = '';
    const reader = res.body?.getReader();
    if (reader) {
      const dec = new TextDecoder();
      while (html.length < 200_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    }
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    const r = classifyResponse(url, res.url || url, res.status, html, headers);
    // The server answered: 401/403/429 = it blocks robots, the site itself is up
    if (r.status === 'not_working' && [401, 403, 429].includes(res.status)) {
      return { ...r, status: 'working', category: 'ok_protected', note: `الموقع يعمل لكن بيرفض الفحص الآلي (${res.status}) — افتحه يدوياً للتأكد.` };
    }
    return r;
  } finally {
    clearTimeout(timer);
  }
}

function variants(url) {
  const u = new URL(url);
  const out = [url];
  const flipWww = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
  if (u.protocol === 'https:') out.push(`http://${u.host}${u.pathname}`);
  out.push(`${u.protocol}//${flipWww}${u.pathname}`);
  return out;
}

async function checkSite(raw) {
  const url = normalizeUrl(raw);
  if (!url) return { status: 'not_working', category: 'invalid_url', note: 'رابط الموقع غير صالح أو ناقص.', httpStatus: null, isSalla: false };
  let first = null;
  for (const [i, u] of variants(url).entries()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetchOnce(u);
        if (r.status === 'working') return i === 0 ? r : { ...r, note: `يعمل على ${new URL(u).host}${u.startsWith('http://') ? ' (http فقط)' : ''}.` };
        first ??= r;
        break; // a real answer (404, 5xx, parked…): no need to retry the same address
      } catch (e) {
        const r = classifyNetworkError(e);
        first ??= r;
        if (!['timeout', 'network', 'refused'].includes(r.category)) break;
        await sleep(1500);
      }
    }
  }
  return first;
}

// ---------- optional: real Chrome for the ones that still fail ----------
let browser = null;
async function checkInBrowser(raw) {
  if (!browser) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  }
  const page = await browser.newPage({ userAgent: HEADERS['User-Agent'], locale: 'ar-SA' });
  try {
    const res = await page.goto(normalizeUrl(raw), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const status = res?.status() ?? 0;
    const html = (await page.content()).slice(0, 200_000);
    return classifyResponse(normalizeUrl(raw), page.url(), status || 200, html, res ? await res.allHeaders() : {});
  } catch (e) {
    return classifyNetworkError(e);
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- load clients ----------
async function loadLeads() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from('leads').select('id, website, website_status, website_status_source')
      .not('website', 'is', null).neq('website', '').order('id').range(from, from + 999);
    if (mode === 'unchecked') q = q.is('website_checked_at', null);
    if (mode === 'failed') q = q.eq('website_status', 'not_working');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000 || (LIMIT && rows.length >= LIMIT)) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function save(results) {
  if (DRY || !results.length) return;
  const payload = results.map(r => ({ id: r.id, status: r.status, category: r.category, note: r.note, http_status: r.httpStatus, is_salla: r.isSalla }));
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.rpc('save_website_checks', { p_results: payload.slice(i, i + 200) });
    if (error) throw new Error(`Saving failed: ${error.message}`);
  }
}

// ---------- run ----------
const leads = await loadLeads();
console.log(`Checking ${leads.length} websites (${mode}${DRY ? ', dry run' : ''}${BROWSER ? ', + real Chrome for failures' : ''})…`);
const summary = {};
let done = 0;
let buffer = [];
const queue = [...leads];
async function worker() {
  for (let lead = queue.shift(); lead; lead = queue.shift()) {
    let r = await checkSite(lead.website);
    if (BROWSER && r.status === 'not_working' && r.category !== 'invalid_url') {
      const b = await checkInBrowser(lead.website);
      if (b.status === 'working') r = b;
    }
    summary[r.category] = (summary[r.category] ?? 0) + 1;
    buffer.push({ id: lead.id, ...r });
    done++;
    if (DRY && r.status === 'not_working') console.log(`  ✗ ${lead.website} → ${r.category}: ${r.note}`);
    if (buffer.length >= 100) { const batch = buffer; buffer = []; await save(batch); }
    if (done % 50 === 0 || done === leads.length) process.stdout.write(`\r  ${done} / ${leads.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await save(buffer);
if (browser) await browser.close();
console.log('\nDone. Results by reason:');
console.table(summary);
if (DRY) console.log('(dry run: nothing was saved)');
