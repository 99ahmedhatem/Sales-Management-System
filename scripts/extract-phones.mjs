import fs from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const checkpointPath = new URL('./extract-phones.checkpoint.json', import.meta.url);
const pageSize = 500;
const concurrency = 6;
const delayBetweenBatchesMs = 750;
const timeoutMs = 10_000;
const userAgent = 'SalesManagementSystemPhoneExtractor/1.0 (+https://example.com/bot-info)';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readCheckpoint() {
  try {
    return JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeCheckpoint(lastId, stats) {
  await fs.writeFile(checkpointPath, JSON.stringify({ lastId, ...stats }, null, 2));
}

function normalizeCandidate(value) {
  let phone = value
    .replace(/&amp;/gi, '&')
    .replace(/^tel:/i, '')
    .replace(/^whatsapp:\/\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/[^\d+]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (phone.startsWith('+')) return /^\+\d{8,15}$/.test(phone) ? phone : null;
  if (/^05\d{8}$/.test(phone)) return phone;
  return /^\d{8,15}$/.test(phone) ? phone : null;
}

function extractPhones(html) {
  const candidates = [];
  const add = value => {
    const phone = normalizeCandidate(value);
    if (phone && !candidates.includes(phone)) candidates.push(phone);
  };

  for (const match of html.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) add(match[1]);
  for (const match of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)([^&"'\s]+)/gi)) add(match[1]);
  for (const match of html.matchAll(/(?:\+966\s?5\d{2}[\s-]?\d{3}[\s-]?\d{4}|05\d{2}[\s-]?\d{3}[\s-]?\d{4})/g)) add(match[0]);
  for (const match of html.matchAll(/\+\d[\d\s().-]{7,18}/g)) add(match[0]);
  return candidates;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return { html: '', unreachable: true };
    return { html: await response.text(), unreachable: false };
  } catch {
    return { html: '', unreachable: true };
  } finally {
    clearTimeout(timeout);
  }
}

function websiteUrl(value) {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function findPhone(website) {
  const homepage = websiteUrl(website);
  const pages = [homepage];
  try {
    const parsed = new URL(homepage);
    pages.push(new URL('/contact', parsed).href, new URL('/contact-us', parsed).href);
  } catch {
    return { phone: null, unreachable: true };
  }

  let unreachable = false;
  for (const page of pages) {
    const result = await fetchPage(page);
    unreachable ||= result.unreachable;
    if (!result.html) continue;
    const phone = extractPhones(result.html)[0];
    if (phone) return { phone, unreachable: false };
  }
  return { phone: null, unreachable };
}

async function main() {
  const checkpoint = await readCheckpoint();
  const baseQuery = supabase.from('leads').select('id', { count: 'exact', head: true }).or('phone.is.null,phone.eq.').not('website', 'is', null).neq('website', '');
  const { count, error: countError } = await baseQuery;
  if (countError) throw countError;

  const stats = { processed: 0, found: 0, unreachable: 0, noNumber: 0 };
  let lastId = checkpoint.lastId;
  console.log(`Starting phone extraction for ${count ?? 0} leads${lastId ? ` after checkpoint ${lastId}` : ''}.`);

  while (true) {
    let query = supabase.from('leads').select('id, website').or('phone.is.null,phone.eq.').not('website', 'is', null).neq('website', '').order('id', { ascending: true }).limit(pageSize);
    if (lastId) query = query.gt('id', lastId);
    const { data: leads, error } = await query;
    if (error) throw error;
    if (!leads?.length) break;

    let nextLastId = leads[leads.length - 1].id;
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= leads.length) return;
        const lead = leads[index];
        const result = await findPhone(lead.website);
        if (result.unreachable) stats.unreachable += 1;
        if (result.phone) {
          const update = await supabase.from('leads').update({ phone: result.phone, phone_source: 'website', updated_at: new Date().toISOString() }).eq('id', lead.id);
          if (update.error) throw update.error;
          stats.found += 1;
        } else {
          stats.noNumber += 1;
        }
        stats.processed += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, worker));
    lastId = nextLastId;
    await writeCheckpoint(lastId, stats);
    console.log(`${stats.processed}/${count ?? '?'} processed, ${stats.found} numbers found, ${stats.unreachable} unreachable/timed out, ${stats.noNumber} without a number.`);
    if (leads.length === pageSize) await sleep(delayBetweenBatchesMs);
  }

  console.log(`Finished. Processed: ${stats.processed}; found: ${stats.found}; unreachable/timed out: ${stats.unreachable}; no number found: ${stats.noNumber}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
