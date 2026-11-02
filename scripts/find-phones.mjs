// Finds the phone number on each client's website and saves it in the client's phone field.
// Runs from YOUR computer (VS Code terminal) — sites answer a normal connection better than a cloud server.
//
// For every client that has a website and NO phone:
//   1) opens the home page (real Chrome headers, 20 s, retries, http ↔ https and with / without www.)
//   2) reads numbers from: tel: links, WhatsApp links (wa.me, api.whatsapp.com), structured data ("telephone"),
//      and the page text (Arabic digits too: ٠٥٥…)
//   3) if none: opens the site's contact / about pages (links found on the home page + /contact, /contact-us …)
//   4) picks the best number: WhatsApp / tel: links first, then mobiles before landlines, then the most repeated
//   5) saves it as an international number (+9665…, +9715…) — never over an existing phone, and never a number that
//      already belongs to another client (the system allows one client per phone); then tries the next number
// It can be stopped any time and continues where it stopped (checkpoint). A CSV report is written at the end.
//
// Setup (once): .env.local in the project folder (git-ignored) with
//   SUPABASE_URL=https://zchhqqsagrqyexzpfrms.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<Supabase → Project Settings → API Keys → secret key>
//
// Run:
//   npm run find:phones -- --limit 50 --dry-run    try 50 clients, print what it finds, save nothing
//   npm run find:phones                            all clients without a phone (continues after a stop)
//   npm run find:phones -- --from-start            start again from the first client
//   npm run find:phones -- --extra-to-notes        also write the other numbers found into the client's notes
//
// Second pass for the clients still without a number (run after the first pass; clients that got a phone are skipped):
//   npm run find:phones -- --browser --from-start  open each site in a real Chrome: finds numbers that the site
//                                                   shows with JavaScript (WhatsApp buttons, footers, React / Salla stores)
//                                                   once: npm i -D playwright  &&  npx playwright install chromium
//   npm run find:phones -- --google --from-start   ask Google (Serper "places", the same key as Lead discovery) for the
//                                                   business phone by name + website — 1 Serper credit per client
//   (the two can be used together: --browser --google)
//   npm run find:phones -- --clean-shared          remove a platform / agency number that got saved on a client (see below)
import fs from 'node:fs';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

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
const argValue = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const LIMIT = Number(argValue('--limit')) || 0;
const DRY = args.includes('--dry-run');
const FROM_START = args.includes('--from-start');
const EXTRA_TO_NOTES = args.includes('--extra-to-notes');
const BROWSER = args.includes('--browser');
const GOOGLE = args.includes('--google');
const CONCURRENCY = Number(argValue('--parallel')) || (BROWSER ? 4 : 8);
const TIMEOUT_MS = 20_000;
const CHECKPOINT = 'scripts/find-phones.checkpoint.json';
const REPORT = `.tmp-find-phones-report-${new Date().toISOString().slice(0, 10)}.csv`;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
};
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- countries ----------
// code: calling code · mobile: national mobile pattern (without the leading 0) · land: other valid national numbers
const COUNTRIES = {
  '966': { tld: ['sa'], names: ['saudi', 'السعودية', 'ksa'], mobile: /^5\d{8}$/, land: /^(1\d{8}|9200\d{5}|800\d{7})$/ },
  '971': { tld: ['ae'], names: ['emirates', 'uae', 'الإمارات', 'الامارات'], mobile: /^5\d{8}$/, land: /^([2-7]\d{7}|800\d{4,7}|600\d{6})$/ },
  '965': { tld: ['kw'], names: ['kuwait', 'الكويت'], mobile: /^[569]\d{7}$/, land: /^(2\d{7}|1\d{6})$/ },
  '974': { tld: ['qa'], names: ['qatar', 'قطر'], mobile: /^[3567]\d{7}$/, land: /^(4\d{7}|800\d{4})$/ },
  '973': { tld: ['bh'], names: ['bahrain', 'البحرين'], mobile: /^[36]\d{7}$/, land: /^(1\d{7}|8000\d{4})$/ },
  '968': { tld: ['om'], names: ['oman', 'عمان', 'عُمان'], mobile: /^[79]\d{7}$/, land: /^(2\d{7}|800\d{5})$/ },
  '20':  { tld: ['eg'], names: ['egypt', 'مصر'], mobile: /^1[0125]\d{8}$/, land: /^([2-9]\d{7,8}|19\d{3})$/ },
};

function guessCountry(lead) {
  const region = String(lead.region ?? '').toLowerCase();
  for (const [cc, c] of Object.entries(COUNTRIES)) if (c.names.some(n => region.includes(n))) return cc;
  try {
    const host = new URL(homeUrl(lead.website)).hostname;
    const tld = host.split('.').pop();
    for (const [cc, c] of Object.entries(COUNTRIES)) if (c.tld.includes(tld)) return cc;
  } catch { /* fall through */ }
  return '966';
}

/** Any written number → { e164, key, mobile } or null. Knows +cc / 00cc / local 0… forms. */
function normalizePhone(raw, defaultCc) {
  let s = String(raw).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  s = s.replace(/%2B/gi, '+').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  let cc = null; let nat = null;
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    cc = Object.keys(COUNTRIES).sort((a, b) => b.length - a.length).find(c => digits.startsWith(c));
    if (!cc) return null;
    nat = digits.slice(cc.length).replace(/^0/, '');
  } else {
    const digits = s;
    const withCc = Object.keys(COUNTRIES).find(c => digits.startsWith(c) && digits.length >= c.length + 7 && (COUNTRIES[c].mobile.test(digits.slice(c.length)) || COUNTRIES[c].land.test(digits.slice(c.length))));
    if (withCc) { cc = withCc; nat = digits.slice(withCc.length); }
    else { cc = defaultCc; nat = digits.replace(/^0/, ''); }
  }
  const c = COUNTRIES[cc];
  if (!c) return null;
  const mobile = c.mobile.test(nat);
  if (!mobile && !c.land.test(nat)) return null;
  if (/^(\d)\1+$/.test(nat) || /12345678|23456789|98765432/.test(nat)) return null; // 0555555555, 123456789…
  return { e164: `+${cc}${nat}`, key: nat.slice(-9), mobile };
}

// ---------- read numbers from a page ----------
function phonesFromHtml(html, defaultCc) {
  const found = new Map(); // e164 → { score, mobile, key }
  const add = (raw, weight) => {
    const p = normalizePhone(raw, defaultCc);
    if (!p) return;
    const cur = found.get(p.e164) ?? { ...p, score: 0 };
    cur.score += weight + (p.mobile ? 2 : 0);
    found.set(p.e164, cur);
  };
  const h = html.slice(0, 600_000);
  for (const m of h.matchAll(/href\s*=\s*["']\s*tel:([^"'<>]{6,30})/gi)) add(decodeURIComponent(m[1]), 10);
  for (const m of h.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|web\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\/?\?phone=)\+?([\d%]{8,20})/gi)) add(`+${decodeURIComponent(m[1])}`, 12);
  for (const m of h.matchAll(/"telephone"\s*:\s*"([^"]{6,30})"/gi)) add(m[1], 8);
  // visible text (tags removed); Arabic digits are converted inside normalizePhone
  const text = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
  for (const m of text.matchAll(/(?:\+|00)\s?(?:966|971|965|974|973|968|20)[\s\-.()]*(?:[\d٠-٩][\s\-.()]*){7,10}/g)) add(m[0], 4);
  // local numbers: only spaces / dashes inside, and never part of a decimal (0.178571429) or a longer number
  for (const m of text.matchAll(/(?<![\d٠-٩.,])[0٠](?:[\s-]?[\d٠-٩]){8,9}(?![\d٠-٩]|[.,][\d٠-٩])/g)) add(m[0], 3);
  for (const m of text.matchAll(/(?<![\d٠-٩.,])(?:9200|920|800)(?:[\s-]?[\d٠-٩]){5,7}(?![\d٠-٩]|[.,][\d٠-٩])/g)) add(m[0], 2);
  return found;
}

function contactLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = m[1]; const label = m[2].replace(/<[^>]+>/g, ' ');
    if (/contact|call|about|support|تواصل|اتصل|اتصال|من نحن|عن ?الشركة|خدمة العملاء/i.test(`${href} ${label}`)) {
      try {
        const u = new URL(href, base);
        if (u.hostname.replace(/^www\./, '') === new URL(base).hostname.replace(/^www\./, '')) out.add(u.href);
      } catch { /* bad link */ }
    }
  }
  for (const p of ['/contact', '/contact-us', '/contactus', '/ar/contact', '/ar/contact-us', '/en/contact', '/en/contact-us', '/about', '/about-us']) {
    try { out.add(new URL(p, base).href); } catch { /* ignore */ }
  }
  return [...out].slice(0, 6);
}

// ---------- fetching ----------
async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: HEADERS });
    if (res.status >= 400) return { ok: false, status: res.status, html: '', finalUrl: res.url || url };
    const reader = res.body?.getReader(); let html = '';
    if (reader) {
      const dec = new TextDecoder();
      while (html.length < 600_000) { const { done, value } = await reader.read(); if (done) break; html += dec.decode(value, { stream: true }); }
      reader.cancel().catch(() => {});
    }
    return { ok: true, status: res.status, html, finalUrl: res.url || url };
  } catch (e) {
    return { ok: false, status: 0, html: '', finalUrl: url, error: e?.name === 'AbortError' ? 'timeout' : String(e?.cause?.code || e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function homeUrl(website) {
  const s = String(website).trim();
  const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  return `${u.protocol}//${u.host}/`;
}

async function openHome(website) {
  let base;
  try { base = homeUrl(website); } catch { return null; }
  const u = new URL(base);
  const flip = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
  for (const url of [base, `http://${u.host}/`, `${u.protocol}//${flip}/`]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetchHtml(url);
      if (r.ok) return r;
      if (r.status) break;            // the server answered with an error: no retry on this address
      await sleep(1000);
    }
  }
  return null;
}

async function findPhones(lead) {
  const cc = guessCountry(lead);
  const home = await openHome(lead.website);
  if (!home) return { result: 'site_not_opening', phones: [] };
  const all = phonesFromHtml(home.html, cc);
  if (![...all.values()].some(p => p.score >= 8)) {
    for (const link of contactLinks(home.html, home.finalUrl)) {
      const page = await fetchHtml(link);
      if (!page.ok) continue;
      for (const [e164, p] of phonesFromHtml(page.html, cc)) {
        const cur = all.get(e164); if (cur) cur.score += p.score; else all.set(e164, p);
      }
      if ([...all.values()].some(p => p.score >= 8)) break;
    }
  }
  let phones = [...all.values()].sort((a, b) => b.score - a.score || Number(b.mobile) - Number(a.mobile));
  if (phones.length) return { result: 'found', phones, via: 'site' };
  return { result: 'no_number_on_site', phones: [] };
}

// ---------- second pass: real Chrome ----------
let browserPromise = null;
async function browserPage() {
  browserPromise ??= import('playwright').then(({ chromium }) => chromium.launch());
  const browser = await browserPromise;
  return browser.newPage({ userAgent: HEADERS['User-Agent'], locale: 'ar-SA' });
}

async function renderedHtml(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await page.mouse.wheel(0, 20_000).catch(() => {});      // footers often load on scroll
    await page.waitForTimeout(1_500);
    const hrefs = await page.$$eval('a[href]', as => as.map(a => `<a href="${a.getAttribute('href')}">${(a.textContent || '').slice(0, 60)}</a>`).join(' ')).catch(() => '');
    return (await page.content()) + hrefs;
  } catch {
    return null;
  }
}

async function findPhonesInBrowser(lead) {
  const cc = guessCountry(lead);
  let base; try { base = homeUrl(lead.website); } catch { return null; }
  const page = await browserPage();
  try {
    const html = await renderedHtml(page, base);
    if (html === null) return null;
    const all = phonesFromHtml(html, cc);
    if (![...all.values()].some(p => p.score >= 8)) {
      for (const link of contactLinks(html, page.url() || base).slice(0, 3)) {
        const more = await renderedHtml(page, link);
        if (!more) continue;
        for (const [e164, p] of phonesFromHtml(more, cc)) { const cur = all.get(e164); if (cur) cur.score += p.score; else all.set(e164, p); }
        if ([...all.values()].some(p => p.score >= 8)) break;
      }
    }
    return [...all.values()].sort((a, b) => b.score - a.score || Number(b.mobile) - Number(a.mobile));
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- second pass: Google (Serper places) ----------
let serperKey;
async function getSerperKey() {
  if (serperKey !== undefined) return serperKey;
  const { data } = await supabase.from('discovery_settings').select('value').eq('key', 'serper_key').maybeSingle();
  serperKey = data?.value || process.env.SERPER_API_KEY || null;
  if (!serperKey) console.error('\n  No Serper key: save it in Lead discovery (or SERPER_API_KEY in .env.local) to use --google.');
  return serperKey;
}
const GL = { '966': 'sa', '971': 'ae', '965': 'kw', '974': 'qa', '973': 'bh', '968': 'om', '20': 'eg' };

async function findPhonesOnGoogle(lead) {
  const key = await getSerperKey();
  if (!key) return null;
  const cc = guessCountry(lead);
  const host = bareHost(lead.website);
  const q = [lead.name && !/^https?:/i.test(lead.name) ? lead.name : '', host].filter(Boolean).join(' ');
  try {
    const res = await fetch('https://google.serper.dev/places', {
      method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: GL[cc] ?? 'sa', hl: 'ar' }),
    });
    if (!res.ok) return null;
    const places = (await res.json()).places ?? [];
    // only a place whose website is this client's site (safe), or a single result named like the client
    const sameSite = places.filter(p => p.website && bareHost(p.website) === host);
    const pick = sameSite.length ? sameSite : places.length === 1 && lead.name && places[0].title?.includes(lead.name.slice(0, 12)) ? places : [];
    const out = [];
    for (const p of pick) { const n = p.phoneNumber && normalizePhone(p.phoneNumber, cc); if (n) out.push({ ...n, score: 9 }); }
    return out;
  } catch {
    return null;
  }
}

/** First pass on the site; then, if asked, real Chrome and Google for the ones still without a number. */
async function findPhonesAllWays(lead) {
  const first = await findPhones(lead);
  if (first.result === 'found') return first;
  if (BROWSER) {
    const phones = await findPhonesInBrowser(lead);
    if (phones?.length) return { result: 'found', phones, via: 'browser' };
  }
  if (GOOGLE) {
    const phones = await findPhonesOnGoogle(lead);
    if (phones?.length) return { result: 'found', phones, via: 'google' };
  }
  return first;
}

function bareHost(u) { try { return new URL(homeUrl(u)).hostname.replace(/^www\./, ''); } catch { return ''; } }

// ---------- shared numbers (platforms, web agencies) ----------
// Salla / Zid stores show the platform's own support number in their footer, and web agencies put their number on
// every site they build. Such a number is not the client's: it is never saved.
const PLATFORM_NUMBERS = new Set(['920033102']); // key = last 9 digits · Salla support (seen on every Salla store)
const numberSites = new Map(); // key → Set of sites where this number was found during this run
function noteNumbers(lead, phones) {
  const host = bareHost(lead.website);
  for (const p of phones) { const s = numberSites.get(p.key) ?? new Set(); s.add(host); numberSites.set(p.key, s); }
}
const isShared = p => PLATFORM_NUMBERS.has(p.key) || (numberSites.get(p.key)?.size ?? 0) >= 3;

// ---------- database ----------
async function phoneTakenByOther(key, leadId) {
  const { data } = await supabase.from('leads').select('id').eq('phone_key', key).neq('id', leadId).limit(1);
  return Boolean(data?.length);
}

async function savePhone(lead, phones) {
  noteNumbers(lead, phones);
  for (const p of phones) {
    if (isShared(p)) continue;
    if (await phoneTakenByOther(p.key, lead.id)) continue;
    if (DRY) return { saved: p.e164 };
    const update = { phone: p.e164, phone_source: 'auto_scraped', updated_at: new Date().toISOString() };
    const others = phones.filter(x => x.e164 !== p.e164).map(x => x.e164);
    if (EXTRA_TO_NOTES && others.length) {
      update.notes = [lead.notes, `أرقام إضافية من الموقع: ${others.join(' / ')}`].filter(Boolean).join('\n');
    }
    const { error } = await supabase.from('leads').update(update).eq('id', lead.id).or('phone.is.null,phone.eq.');
    if (!error) return { saved: p.e164 };
    if (error.code !== '23505') return { error: error.message }; // 23505 = taken a moment ago: try the next number
  }
  return { duplicate: true, onlyShared: phones.every(isShared) };
}

async function loadBatch(afterId) {
  let q = supabase.from('leads').select('id, name, website, region, notes, phone')
    .not('website', 'is', null).neq('website', '').or('phone.is.null,phone.eq.')
    .order('id').limit(500);
  if (afterId) q = q.gt('id', afterId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

// ---------- clean-up: remove a shared number that was saved before it was recognised ----------
// npm run find:phones -- --clean-shared   reads the reports in the project folder; a number seen on 3+ sites (or a
// platform number) is removed from the client it was auto-saved on, so the next run looks for that client's own number.
if (args.includes('--clean-shared')) {
  const sites = new Map();
  for (const f of fs.readdirSync('.').filter(n => n.startsWith('.tmp-find-phones-report-'))) {
    for (const row of fs.readFileSync(f, 'utf8').split('\n').slice(1)) {
      const cols = row.match(/"((?:[^"]|"")*)"/g)?.map(c => c.slice(1, -1).replace(/""/g, '"')) ?? [];
      const [, website, , phone, others] = cols;
      for (const n of [phone, ...(others ?? '').split(' ')].filter(Boolean)) {
        const key = n.replace(/\D/g, '').slice(-9);
        const s = sites.get(key) ?? { e164: n, hosts: new Set() };
        s.hosts.add(bareHost(website)); sites.set(key, s);
      }
    }
  }
  const shared = [...sites.entries()].filter(([k, s]) => PLATFORM_NUMBERS.has(k) || s.hosts.size >= 3).map(([, s]) => s.e164);
  console.log(`Shared numbers found: ${shared.length ? shared.join(', ') : 'none'}`);
  for (const n of shared) {
    const { data, error } = DRY ? { data: [] } : await supabase.from('leads')
      .update({ phone: null, phone_source: null, updated_at: new Date().toISOString() })
      .eq('phone', n).eq('phone_source', 'auto_scraped').select('id');
    console.log(`  ${n}: ${error ? `error ${error.message}` : `removed from ${data.length} client(s)`}`);
  }
  process.exit(0);
}

// ---------- run ----------
const checkpoint = !FROM_START && !DRY && fs.existsSync(CHECKPOINT) ? JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')) : {};
let afterId = checkpoint.lastId ?? null;
const stats = { checked: 0, saved: 0, no_number_on_site: 0, site_not_opening: 0, number_belongs_to_other_client: 0, errors: 0 };
const report = ['client_id,website,result,phone,other_numbers'];
console.log(`Finding phones for clients without a phone${DRY ? ' (dry run: nothing is saved)' : ''}${afterId ? ' — continuing after the last stop' : ''}…`);

outer: while (true) {
  const batch = await loadBatch(afterId);
  if (!batch.length) break;
  const queue = [...batch];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let lead = queue.shift(); lead; lead = queue.shift()) {
      if (LIMIT && stats.checked >= LIMIT) return;
      stats.checked++;
      let line;
      try {
        const { result, phones, via } = await findPhonesAllWays(lead);
        if (result !== 'found') {
          stats[result]++;
          line = [lead.id, lead.website, result, '', ''];
        } else {
          const r = await savePhone(lead, phones);
          if (r.saved) { stats.saved++; if (via !== 'site') stats[`saved_via_${via}`] = (stats[`saved_via_${via}`] ?? 0) + 1; line = [lead.id, lead.website, `saved (${via})`, r.saved, phones.filter(p => p.e164 !== r.saved).map(p => p.e164).join(' ')]; }
          else if (r.onlyShared) { stats.only_platform_number = (stats.only_platform_number ?? 0) + 1; line = [lead.id, lead.website, 'only_platform_number', '', phones.map(p => p.e164).join(' ')]; }
          else if (r.duplicate) { stats.number_belongs_to_other_client++; line = [lead.id, lead.website, 'number_belongs_to_other_client', '', phones.map(p => p.e164).join(' ')]; }
          else { stats.errors++; line = [lead.id, lead.website, `error: ${r.error}`, '', '']; }
          if (DRY) console.log(`  ${lead.website} → ${line[2]} ${line[3]} ${line[4] ? `(others: ${line[4]})` : ''}`);
        }
      } catch (e) {
        stats.errors++; line = [lead.id, lead.website, `error: ${e?.message || e}`, '', ''];
      }
      report.push(line.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      if (stats.checked % 25 === 0) process.stdout.write(`\r  checked ${stats.checked} · saved ${stats.saved} · no number ${stats.no_number_on_site} · not opening ${stats.site_not_opening}   `);
    }
  }));
  afterId = batch[batch.length - 1].id;
  if (!DRY) fs.writeFileSync(CHECKPOINT, JSON.stringify({ lastId: afterId, at: new Date().toISOString() }, null, 2));
  fs.writeFileSync(REPORT, report.join('\n'));
  if (LIMIT && stats.checked >= LIMIT) break outer;
}

fs.writeFileSync(REPORT, report.join('\n'));
if (browserPromise) await (await browserPromise).close().catch(() => {});
if (!DRY && !LIMIT && fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT); // finished: the next run starts from the beginning
console.log('\n\nDone.');
console.table(stats);
console.log(`Report (open in Excel): ${REPORT}`);
