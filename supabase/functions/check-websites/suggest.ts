// اقتراحات تصحيح الدومين لما الـ DNS يفشل (أخطاء كتابة شائعة / TLD مختلف / www)
const TLD_FIX: Record<string, string> = {
  con: 'com', cmo: 'com', ocm: 'com', coom: 'com', comm: 'com', vom: 'com', xom: 'com', cim: 'com', cok: 'com',
  ner: 'net', nte: 'net', ogr: 'org', orgg: 'org',
}
export function candidateHosts(host: string): string[] {
  const h = host.toLowerCase().replace(/\.$/, '')
  const out = new Set<string>()
  const bare = h.replace(/^www\./, '')
  out.add(h.startsWith('www.') ? bare : 'www.' + bare)
  const parts = bare.split('.')
  const tld = parts[parts.length - 1]
  const base = parts.slice(0, -1).join('.')
  if (TLD_FIX[tld]) out.add(`${base}.${TLD_FIX[tld]}`)
  if (bare.endsWith('.com.sa')) { out.add(bare.replace(/\.com\.sa$/, '.sa')); out.add(bare.replace(/\.com\.sa$/, '.com')) }
  else if (bare.endsWith('.sa')) { out.add(bare.replace(/\.sa$/, '.com.sa')); out.add(bare.replace(/\.sa$/, '.com')) }
  else if (bare.endsWith('.com')) { out.add(bare.replace(/\.com$/, '.sa')); out.add(bare.replace(/\.com$/, '.com.sa')); out.add(bare.replace(/\.com$/, '.net')) }
  else if (bare.endsWith('.net') || bare.endsWith('.org')) out.add(bare.replace(/\.(net|org)$/, '.com'))
  // حرف مكرر في بداية/نهاية الاسم (مثل  shoopy → shopy)
  const label = parts[0]
  const dedup = label.replace(/(.)\1+/g, '$1')
  if (dedup !== label) out.add([dedup, ...parts.slice(1)].join('.'))
  if (label.includes('-')) out.add([label.replace(/-/g, ''), ...parts.slice(1)].join('.'))
  out.delete(h)
  return [...out].slice(0, 8)
}
export async function findWorkingHost(host: string): Promise<string | null> {
  for (const c of candidateHosts(host)) {
    try {
      const a = await Deno.resolveDns(c, 'A')
      if (a.length) return c
    } catch { /* مش موجود */ }
  }
  return null
}
