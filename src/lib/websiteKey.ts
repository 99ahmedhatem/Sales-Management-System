/** The dedupe key for a website (leads.website_key). Used by Add Lead, Import and the client card. */
export function normalizeWebsite(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}
