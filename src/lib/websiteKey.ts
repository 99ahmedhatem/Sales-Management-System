/**
 * The dedupe key for a website (leads.website_key). Used by Add Lead, Import and the client card.
 * Same rule as public.site_key() in the database (067), which is what really decides: the server
 * rewrites website_key on every save. This copy is only used to drop duplicates inside an Excel file
 * before upload and to match existing stores when filling missing phones.
 *   https://www.Example.com/ar/index.html?x=1 → example.com
 *   salla.sa/mystore/products                 → salla.sa/mystore   (shared platform: the store is in the path)
 *   https://salla.sa/                         → ''                 (a bare platform page is not a website)
 */
const PLATFORM_HOSTS = new Set([
  'salla.sa', 'salla.com', 'zid.store', 'zid.sa', 'linktr.ee', 'instagram.com', 'facebook.com', 'x.com',
  'tiktok.com', 'wa.me', 't.me', 'youtube.com', 'linkedin.com', 'sites.google.com', 'snapchat.com',
  'threads.net', 'behance.net', 'pinterest.com', 'beacons.ai', 'bio.link', 'taplink.cc',
]);
const HOST_ALIASES: Record<string, string> = {
  'm.facebook.com': 'facebook.com', 'fb.com': 'facebook.com', 'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com', 'm.youtube.com': 'youtube.com',
};
const TWO_PART_PREFIXES = new Set(['add', 'company', 'in', 'channel', 'c', 'user', 'view', 'p', 'pages']);
const EMPTY = new Set(['', '-', '—', '–', 'n/a', 'na', 'none', 'null']);

export function normalizeWebsite(url: string): string {
  let s = (url ?? '').trim().toLowerCase();
  if (EMPTY.has(s)) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^/@]*@/, '').replace(/[?#].*$/, '');
  const parts = s.split('/');
  let host = parts[0].replace(/:[0-9]+$/, '').replace(/^www[0-9]*\./, '').replace(/\.+$/, '');
  if (!/^[a-z0-9؀-ۿ-]+(\.[a-z0-9؀-ۿ-]+)+$/.test(host)) return '';
  host = HOST_ALIASES[host] ?? host;
  const seg = parts[1] || '';
  const seg2 = parts[2] || '';
  if (PLATFORM_HOSTS.has(host) || host.endsWith('.wixsite.com') || host.endsWith('.github.io')) {
    if (!seg) return '';
    if (TWO_PART_PREFIXES.has(seg) && seg2) return `${host}/${seg}/${seg2}`;
    return `${host}/${seg}`;
  }
  return host;
}

/**
 * The site's home page (068), same rule as public.site_home() in the database:
 *   https://www.example.com/blog/post-1 → https://www.example.com/   ·   salla.sa/mystore/p/1 → https://salla.sa/mystore/
 * Returns '' when the text is not a usable link (or is a bare platform page like salla.sa).
 */
export function siteHome(url: string): string {
  const key = normalizeWebsite(url);
  if (!key) return '';
  let s = (url ?? '').trim().toLowerCase();
  const scheme = /^http:\/\//.test(s) ? 'http://' : 'https://';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^/@]*@/, '');
  const host = s.split('/')[0].split('?')[0].split('#')[0].replace(/:[0-9]+$/, '').replace(/\.+$/, '');
  const www = /^www[0-9]*\./.exec(host)?.[0] ?? '';
  const keepWww = www && host.slice(www.length) === key.split('/')[0];
  return `${scheme}${keepWww ? www : ''}${key}/`;
}
