// يقارن الكود (src/) بالداتابيز الحية: جداول/أعمدة/RPCs اللي الكود بيستخدمها وهي مش موجودة.
// التشغيل (على جهازك فقط، المفتاح ما بيتحطش في git ولا في VITE_):
//   PowerShell:  $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/check-schema.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
if (!res.ok) { console.error('Cannot read schema:', res.status, await res.text()); process.exit(2); }
const spec = await res.json();
const tables = Object.fromEntries(Object.entries(spec.definitions ?? {}).map(([t, d]) => [t, new Set(Object.keys(d.properties ?? {}))]));
const rpcs = new Set(Object.keys(spec.paths ?? {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)));

const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(f) && files.push(p); } })('src');

const problems = new Set();
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\.rpc\(\s*['"`](\w+)['"`]/g))
    if (!rpcs.has(m[1])) problems.add(`${f}: RPC غير موجودة  ${m[1]}`);
  for (const m of s.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)\s*\.select\(\s*(['"`])([\s\S]*?)\2/g)) {
    const t = m[1];
    if (!tables[t]) { problems.add(`${f}: جدول/فيو غير موجود  ${t}`); continue; }
    if (/[()]/.test(m[3])) continue;
    for (let c of m[3].split(',').map(x => x.trim()).filter(Boolean)) {
      c = c.split(':').pop().trim();
      if (c === '*' || c.includes('!')) continue;
      if (!tables[t].has(c)) problems.add(`${f}: عمود غير موجود  ${t}.${c}`);
    }
  }
}
if (problems.size) { console.log([...problems].join('\n')); console.log(`\n❌ ${problems.size} مشكلة`); process.exit(1); }
console.log('✅ الكود متطابق مع الداتابيز');
