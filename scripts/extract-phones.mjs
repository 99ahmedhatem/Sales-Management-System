import fs from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');

const supabase = createClient(supabaseUrl, serviceRoleKey);
const checkpointPath = new URL('./extract-phones.checkpoint.json', import.meta.url);
const pageSize = 500;
const concurrency = 6;
const delayBetweenBatchesMs = 750;
const timeoutMs = 10_000;
const force = process.argv.includes('--force');
const fromStart = process.argv.includes('--from-start');
const userAgent = 'SalesManagementSystemWebsiteChecker/1.0';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function readCheckpoint() {
  try { return JSON.parse(await fs.readFile(checkpointPath, 'utf8')); } catch { return {}; }
}
async function writeCheckpoint(lastId, stats) {
  await fs.writeFile(checkpointPath, JSON.stringify({ lastId, ...stats }, null, 2));
}

function normalizeCandidate(value) {
  let phone = value.replace(/&amp;/gi, '&').replace(/^tel:/i, '').replace(/^whatsapp:\/\//i, '').replace(/[?#].*$/, '').replace(/[^\d+]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (phone.startsWith('+')) return /^\+\d{8,15}$/.test(phone) ? phone : null;
  if (/^05\d{8}$/.test(phone)) return phone;
  return /^\d{8,15}$/.test(phone) ? phone : null;
}

function extractPhones(html) {
  const phones = [];
  const add = value => {
    const phone = normalizeCandidate(value);
    if (phone && !phones.includes(phone)) phones.push(phone);
  };
  for (const match of html.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) add(match[1]);
  for (const match of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)([^&"'\s]+)/gi)) add(match[1]);
  for (const match of html.matchAll(/(?:\+966\s?5\d{2}[\s-]?\d{3}[\s-]?\d{4}|05\d{2}[\s-]?\d{3}[\s-]?\d{4})/g)) add(match[0]);
  for (const match of html.matchAll(/\+\d[\d\s().-]{7,18}/g)) add(match[0]);
  return phones;
}

async function fetchPage(url, method = 'GET') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: controller.signal });
    return { response, html: method === 'GET' && response.ok ? await response.text() : '' };
  } catch {
    return { response: null, html: '' };
  } finally {
    clearTimeout(timeout);
  }
}

function websiteUrl(value) {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function checkWebsite(website) {
  const homepage = websiteUrl(website);
  let url;
  try { url = new URL(homepage); } catch { return { status: 'not_working', phone: null }; }
  const homepageResult = await fetchPage(homepage, 'GET');
  const status = homepageResult.response && homepageResult.response.status >= 200 && homepageResult.response.status < 400 ? 'working' : 'not_working';
  let phone = extractPhones(homepageResult.html)[0] || null;
  if (!phone) {
    for (const path of ['/contact', '/contact-us']) {
      const page = await fetchPage(new URL(path, url).href, 'GET');
      phone = extractPhones(page.html)[0] || null;
      if (phone) break;
    }
  }
  return { status, phone };
}

// إعادة محاولة لعملية الحفظ في Supabase لو فشلت بسبب مشكلة شبكة مؤقتة
async function updateLeadWithRetry(lead, update, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const saved = await supabase.from('leads').update(update).eq('id', lead.id);
      if (saved.error) throw saved.error;
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function main() {
  const checkpoint = fromStart ? {} : await readCheckpoint();
  const stats = { processed: 0, found: 0, unreachable: 0, noNumber: 0, checked: 0, working: 0, not_working: 0, preservedManualStatus: 0, errors: 0 };
  let lastId = checkpoint.lastId;
  console.log(`Starting website checks${fromStart ? ' from the beginning' : lastId ? ` after checkpoint ${lastId}` : ''}${force ? ' with --force' : ''}.`);
  while (true) {
    let query = supabase.from('leads').select('id, website, phone, website_status_source').not('website', 'is', null).neq('website', '').order('id', { ascending: true }).limit(pageSize);
    if (lastId) query = query.gt('id', lastId);
    let leads;
    {
      let lastErr;
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          const result = await query;
          if (result.error) throw result.error;
          leads = result.data;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.error(`Batch fetch failed (attempt ${attempt + 1}/4): ${err?.message || err}`);
          if (attempt < 3) await sleep(1000 * (attempt + 1));
        }
      }
      if (lastErr) throw lastErr;
    }
    if (!leads?.length) break;
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= leads.length) return;
        const lead = leads[index];
        try {
          const result = await checkWebsite(lead.website);
          const update = { updated_at: new Date().toISOString() };
          if (force || lead.website_status_source !== 'manual') {
            update.website_status = result.status;
            update.website_status_source = 'auto_checked';
          } else {
            stats.preservedManualStatus += 1;
          }
          if (!lead.phone && result.phone) { update.phone = result.phone; update.phone_source = 'auto_scraped'; stats.found += 1; }
          await updateLeadWithRetry(lead, update);
          stats.checked += 1;
          stats.processed += 1;
          stats[result.status] += 1;
          if (result.status === 'not_working') stats.unreachable += 1;
          if (!result.phone) stats.noNumber += 1;
        } catch (err) {
          stats.errors += 1;
          stats.processed += 1;
          console.error(`Skipping lead ${lead.id} (${lead.website}): ${err?.message || err}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, worker));
    lastId = leads[leads.length - 1].id;
    await writeCheckpoint(lastId, stats);
    console.log(`${stats.processed} processed, ${stats.checked} checked, ${stats.working} working, ${stats.not_working} not_working, ${stats.found} numbers found, ${stats.preservedManualStatus} manual statuses preserved, ${stats.errors} errors.`);
    if (leads.length === pageSize) await sleep(delayBetweenBatchesMs);
  }
  console.log(`Finished. Total checked: ${stats.checked}; working: ${stats.working}; not_working: ${stats.not_working}; manual statuses preserved: ${stats.preservedManualStatus}; numbers found: ${stats.found}; no number found: ${stats.noNumber}; errors: ${stats.errors}.`);
}

main().catch(error => {
  console.error('Website check failed:', error);
  process.exitCode = 1;
});
