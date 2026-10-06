const sar = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'SAR' });
const egp = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP' });

export const formatSar = (n: number | string | null | undefined) => (n == null || n === '' || Number.isNaN(Number(n)) ? '—' : sar.format(Number(n)));
export const formatEgp = (n: number | string | null | undefined) => (n == null || n === '' || Number.isNaN(Number(n)) ? '—' : egp.format(Number(n)));
export const formatMoney = (n: number | string | null | undefined, currency: string | null | undefined) =>
  currency === 'EGP' ? formatEgp(n) : formatSar(n);

/** First day of the month as YYYY-MM-01 (what the month RPCs expect). */
export const monthStart = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
