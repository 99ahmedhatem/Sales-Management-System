/**
 * Smart Excel import: finds the columns of a sheet whatever their name or order.
 *   1) exact header match (after normalizing Arabic letters, case, spaces and punctuation)
 *   2) partial header match (longest alias wins; phone / website / email before name / notes)
 *   3) content sniffing — a column where ≥ 60% of the cells look like phones is the phone column, etc.
 * A header that matched by name but whose cells clearly are not phones / links / emails is dropped and
 * left to step 3 (this is what lost 9,835 phones before: the column name did not match exactly).
 * Pure functions only, so it can be tested without the app (scripts/test-smart-import.mts).
 */
import type { WorkSheet } from 'xlsx';

export type ImportField =
  | 'name' | 'phone' | 'website' | 'company' | 'region' | 'source' | 'notes' | 'customerNumber' | 'quantity' | 'email';

/** Order of the rows in the review table */
export const IMPORT_FIELDS: ImportField[] = [
  'name', 'phone', 'website', 'company', 'region', 'source', 'notes', 'customerNumber', 'quantity', 'email',
];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Name', phone: 'Phone', website: 'Website', company: 'Company', region: 'Country',
  source: 'Source', notes: 'Notes', customerNumber: 'Customer Number', quantity: 'Quantity', email: 'Email',
};

export type ColumnMapping = Partial<Record<ImportField, number>>;

// ---------------------------------------------------------------- normalizing

/** Removes tashkeel, unifies alef / yaa / taa marbuta, drops case, spaces and punctuation */
export function normalizeHeader(s: unknown): string {
  return String(s ?? '')
    .replace(/[ً-ْـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[\s_\-./\\()[\]{}:;,'"«»#*|]+/g, '')
    .trim();
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
/** ٠١٢ / ۰۱۲ → 012 */
function latinDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, d => String((d.charCodeAt(0) & 0xf) % 10));
}

const EMPTY_VALUES = new Set(['-', '--', '—', '–', '_', '.', 'n/a', 'na', 'none', 'null', 'nil', '#n/a',
  'غير متوفر', 'غيرمتوفر', 'لا يوجد', 'لايوجد', 'غير موجود', 'لا شيء']);

/** Cell text: trimmed, Arabic digits made Latin, "-", "N/A", "غير متوفر" … → '' */
export function cleanCell(v: unknown): string {
  const s = latinDigits(String(v ?? '')).replace(/ /g, ' ').trim();
  return EMPTY_VALUES.has(s.toLowerCase()) ? '' : s;
}

// ---------------------------------------------------------------- aliases

const FIELD_ALIASES: Record<ImportField, string[]> = {
  phone: [
    'phone', 'phonenumber', 'phoneno', 'mobile', 'mobileno', 'mobilenumber', 'tel', 'telephone',
    'cell', 'cellphone', 'contact', 'contactnumber', 'whatsapp', 'whatsappnumber', 'wa', 'msisdn',
    'الهاتف', 'رقمالهاتف', 'هاتف', 'الجوال', 'جوال', 'رقمالجوال', 'الموبايل', 'موبايل', 'رقمالموبايل',
    'التليفون', 'تليفون', 'رقمالتليفون', 'المحمول', 'محمول', 'واتساب', 'الواتساب', 'رقمالواتس',
    'رقمالتواصل', 'رقمالاتصال', 'الرقم', 'التواصل',
  ],
  name: [
    'name', 'fullname', 'clientname', 'customername', 'contactname', 'owner', 'ownername', 'title',
    'storename', 'shopname', 'brand', 'brandname',
    'الاسم', 'اسم', 'اسمالعميل', 'اسمالمتجر', 'اسمالشركه', 'اسمالمحل', 'العميل', 'المتجر', 'صاحبالمتجر',
    'الاسمالكامل', 'العلامهالتجاريه',
  ],
  website: [
    'website', 'websit', 'web', 'websiteurl', 'url', 'site', 'siteurl', 'link', 'domain', 'storelink',
    'storeurl', 'page', 'webpage', 'homepage',
    'الموقع', 'الموقعالالكتروني', 'رابط', 'الرابط', 'رابطالموقع', 'رابطالمتجر', 'موقع', 'الدومين',
    'دومين', 'صفحهالمتجر', 'المتجرالالكتروني',
  ],
  company: [
    'company', 'companyname', 'business', 'businessname', 'organization', 'org', 'establishment',
    'الشركه', 'اسمالشركه', 'المنشاه', 'المؤسسه', 'الجهه', 'النشاط', 'النشاطالتجاري',
  ],
  region: [
    'country', 'region', 'city', 'area', 'location', 'state', 'province', 'countryname',
    'الدوله', 'الدول', 'المنطقه', 'المدينه', 'البلد', 'الموقعالجغرافي', 'المحافظه',
  ],
  source: [
    'source', 'leadsource', 'channel', 'origin', 'referrer', 'via',
    'المصدر', 'مصدر', 'القناه', 'مصدرالعميل', 'طريقهالوصول',
  ],
  notes: [
    'notes', 'note', 'comment', 'comments', 'remark', 'remarks', 'description', 'details', 'info',
    'ملاحظات', 'ملاحظه', 'تعليق', 'تعليقات', 'تفاصيل', 'وصف', 'بيانات', 'معلومات', 'ملحوظات',
  ],
  customerNumber: [
    'customernumber', 'customerno', 'customerid', 'clientid', 'clientno', 'id', 'no', 'serial', 'ref',
    'refno', 'code', 'clientcode',
    'رقمالعميل', 'كودالعميل', 'رقم', 'مسلسل', 'الرقمالتسلسلي', 'المعرف', 'الكود',
  ],
  quantity: [
    'quantity', 'qty', 'count', 'amount', 'products', 'productcount', 'items', 'itemscount',
    'الكميه', 'العدد', 'عددالمنتجات', 'عددالاصناف', 'كميه',
  ],
  email: ['email', 'emailaddress', 'mail', 'e-mail', 'البريد', 'البريدالالكتروني', 'الايميل', 'ايميل'],
};

// aliases go through the same normalizer as headers, so 'e-mail' → 'email', 'الشركة' → 'الشركه'
const ALIASES: Record<ImportField, string[]> = Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([f, list]) => [f, [...new Set(list.map(normalizeHeader))]]),
) as Record<ImportField, string[]>;

// Specific fields are matched before general ones, so "رقم جوال العميل" is a phone, not a name
const MATCH_TIERS: ImportField[][] = [
  ['phone', 'website', 'email'],
  ['customerNumber', 'quantity', 'company', 'region', 'source'],
  ['name', 'notes'],
];
const MATCH_ORDER = MATCH_TIERS.flat();

// ---------------------------------------------------------------- content sniffing

const PHONE_SPLIT = /\s*(?:[,;/|،\n]|\s{2,}|\bor\b|او|أو)\s*/;

export const SNIFF = {
  phone: (v: string) => {
    const first = v.split(PHONE_SPLIT).find(Boolean) ?? '';
    return /^[+]?[\d\s()\-]{7,20}$/.test(first) && first.replace(/\D/g, '').length >= 8;
  },
  website: (v: string) => /^(https?:\/\/|www\.)|\.(com|net|org|sa|store|shop|app|co|io|me|online|site|ae|eg)(\/|$|\?)/i.test(v) && !/\s/.test(v.trim()) && !v.includes('@'),
  email: (v: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v),
  quantity: (v: string) => /^\d{1,6}$/.test(v),
};

function looksLikeData(v: string): boolean {
  return SNIFF.phone(v) || SNIFF.website(v) || SNIFF.email(v) || /^[+-]?\d+([.,]\d+)?$/.test(v);
}

/** Share of the non-empty cells of column `col` that pass `test` (0 when the column is empty) */
function hitRate(rows: string[][], col: number, test: (v: string) => boolean): number {
  let filled = 0;
  let hits = 0;
  for (const row of rows) {
    const v = row[col] ?? '';
    if (!v) continue;
    filled++;
    if (test(v)) hits++;
  }
  return filled ? hits / filled : 0;
}

function avgLength(rows: string[][], col: number): number {
  let filled = 0;
  let total = 0;
  for (const row of rows) {
    const v = row[col] ?? '';
    if (!v) continue;
    filled++;
    total += v.length;
  }
  return filled ? total / filled : 0;
}

// ---------------------------------------------------------------- sheet → text matrix

/**
 * The sheet as rows of text, the way Excel shows them. Whole numbers are written out in full
 * (966533672708, never 9.66534E+11), and a number shown with leading zeros keeps them (0533…).
 * matrix[i] is Excel row i + 1 and matrix[i][c] is column c (A = 0), so row numbers and letters match Excel.
 * Trailing empty rows are removed.
 */
export function sheetToMatrix(sheet: WorkSheet, utils: { decode_range: (r: string) => { s: { r: number; c: number }; e: { r: number; c: number } }; encode_cell: (c: { r: number; c: number }) => string }): string[][] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = utils.decode_range(ref);
  const out: string[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = r < range.s.r || c < range.s.c ? undefined
        : sheet[utils.encode_cell({ r, c })] as { t?: string; v?: unknown; w?: string } | undefined;
      row.push(cleanCell(cellText(cell)));
    }
    out.push(row);
  }
  while (out.length && !out[out.length - 1].some(Boolean)) out.pop();
  return out;
}

function cellText(cell: { t?: string; v?: unknown; w?: string } | undefined): string {
  if (!cell || cell.v == null) return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const shown = (cell.w ?? '').replace(/\s/g, '');
    if (/^\+?\d+$/.test(shown)) return shown;                       // keeps a shown leading 0 or +
    if (Number.isInteger(cell.v) && Math.abs(cell.v) < 1e16) return String(cell.v); // no 9.66E+11
    return cell.w ?? String(cell.v);
  }
  return cell.w ?? String(cell.v);
}

/** Number of non-empty rows, used to pick the biggest sheet */
export function countRows(matrix: string[][]): number {
  return matrix.filter(r => r.some(Boolean)).length;
}

// ---------------------------------------------------------------- header row

function aliasHit(header: string): boolean {
  const h = normalizeHeader(header);
  if (!h) return false;
  return MATCH_ORDER.some(f => ALIASES[f].some(a => a === h || (a.length >= 3 && h.includes(a))));
}

/**
 * Index of the header row in the first 10 rows, or -1 when the file is raw data from the first row.
 * A header row has ≥ 2 filled text cells and none that look like data (phone, link, email, number).
 */
export function detectHeaderRow(matrix: string[][]): number {
  // the first 10 rows that have something in them (blank lines at the top are skipped)
  const firstRows = matrix.map((r, i) => (r.some(Boolean) ? i : -1)).filter(i => i >= 0).slice(0, 10);
  const isCandidate = (row: string[]) => {
    const filled = row.filter(Boolean);
    return filled.length >= 2 && !filled.some(looksLikeData) && filled.every(v => v.length <= 60);
  };
  // 1) a candidate that has at least one known column name
  for (const i of firstRows) {
    if (isCandidate(matrix[i]) && matrix[i].some(aliasHit)) return i;
  }
  // 2) any candidate with a column of phones / links / emails under it
  for (const [k, i] of firstRows.entries()) {
    if (!isCandidate(matrix[i])) continue;
    const below = matrix.slice(i + 1, i + 51);
    if (!below.length) return -1;
    const width = Math.max(...below.map(r => r.length));
    let dataColumn = false;
    for (let c = 0; c < width && !dataColumn; c++) {
      dataColumn = [SNIFF.phone, SNIFF.website, SNIFF.email].some(t => hitRate(below, c, t) >= 0.6);
    }
    if (dataColumn) return i;
    // no typed column at all: fall back to the plain rule only for the first filled row
    if (k === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- columns

/** Column index → which field it is. `headers` may be all '' (no header row). */
export function detectColumns(headers: string[], sampleRows: string[][]): ColumnMapping {
  const rows = sampleRows.slice(0, 50);
  const width = Math.max(headers.length, ...rows.map(r => r.length), 0);
  const columns = Array.from({ length: width }, (_, i) => i).filter(
    c => (headers[c] ?? '') !== '' || rows.some(r => (r[c] ?? '') !== ''),
  );
  const norm = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const take = (f: ImportField, c: number) => { mapping[f] = c; used.add(c); };

  // Stage 1 — exact header
  for (const f of MATCH_ORDER) {
    const c = columns.find(c => !used.has(c) && norm[c] && ALIASES[f].includes(norm[c]));
    if (c !== undefined) take(f, c);
  }

  // Stage 2 — partial header, tier by tier, longest alias first
  for (const tier of MATCH_TIERS) {
    const candidates: { f: ImportField; c: number; len: number }[] = [];
    for (const f of tier) {
      if (mapping[f] !== undefined) continue;
      for (const c of columns) {
        const h = norm[c];
        if (used.has(c) || !h) continue;
        for (const a of ALIASES[f]) {
          if (a.length < 3) continue;
          if (h.includes(a) || (h.length >= 3 && a.includes(h))) candidates.push({ f, c, len: a.length });
        }
      }
    }
    candidates.sort((x, y) => y.len - x.len || tier.indexOf(x.f) - tier.indexOf(y.f));
    for (const { f, c } of candidates) {
      if (mapping[f] === undefined && !used.has(c)) take(f, c);
    }
  }

  // A typed column found by its name must also look like it (a "الرقم" column of 1, 2, 3 is not a phone)
  for (const f of ['phone', 'website', 'email'] as const) {
    const c = mapping[f];
    if (c === undefined) continue;
    const filled = rows.filter(r => r[c]).length;
    if (filled >= 3 && hitRate(rows, c, SNIFF[f]) < 0.2) { delete mapping[f]; used.delete(c); }
  }

  // Stage 3 — content
  for (const f of ['phone', 'website', 'email', 'quantity'] as const) {
    if (mapping[f] !== undefined) continue;
    let best = -1;
    let bestRate = 0.6;
    for (const c of columns) {
      if (used.has(c)) continue;
      const rate = hitRate(rows, c, SNIFF[f]);
      if (rate >= bestRate && (rate > bestRate || best === -1)) { best = c; bestRate = rate; }
    }
    if (best >= 0) take(f, best);
  }

  // Remaining text columns: very long → notes, longest → name, next → company
  const textColumns = columns
    .filter(c => !used.has(c) && rows.some(r => r[c]) && hitRate(rows, c, v => !looksLikeData(v)) >= 0.6)
    .map(c => ({ c, len: avgLength(rows, c) }))
    .sort((a, b) => b.len - a.len);
  if (mapping.notes === undefined && textColumns.length && textColumns[0].len > 60) {
    take('notes', textColumns.shift()!.c);
  }
  for (const f of ['name', 'company'] as const) {
    if (mapping[f] !== undefined) continue;
    const next = textColumns.shift();
    if (next) take(f, next.c);
  }

  // "اسم الشركة" only: the company column is also the client's name
  if (mapping.name === undefined && mapping.company !== undefined) {
    mapping.name = mapping.company;
    delete mapping.company;
  }
  return mapping;
}

/** True when some column of the sheet looks like phone numbers (for the "phone not found" warning) */
export function hasPhoneLikeColumn(rows: string[][]): boolean {
  const sample = rows.slice(0, 50);
  const width = Math.max(0, ...sample.map(r => r.length));
  for (let c = 0; c < width; c++) if (hitRate(sample, c, SNIFF.phone) >= 0.6) return true;
  return false;
}

// ---------------------------------------------------------------- sheet analysis

export interface SheetAnalysis {
  headerRow: number;          // -1: no header row
  firstLine: number;          // Excel row number of dataRows[0]
  columns: { index: number; label: string }[]; // non-empty columns, for the dropdowns
  dataRows: string[][];
  mapping: ColumnMapping;
}

function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function analyzeMatrix(matrix: string[][]): SheetAnalysis {
  const headerRow = detectHeaderRow(matrix);
  const headers = headerRow >= 0 ? matrix[headerRow] : [];
  const dataRows = matrix.slice(headerRow + 1);
  const width = Math.max(headers.length, 0, ...dataRows.map(r => r.length));
  const columns: SheetAnalysis['columns'] = [];
  for (let c = 0; c < width; c++) {
    const h = headers[c] ?? '';
    if (!h && !dataRows.some(r => r[c])) continue; // empty column in the middle
    columns.push({ index: c, label: h ? `${h} (${columnLetter(c)})` : `Column ${columnLetter(c)}` });
  }
  const filledRows = dataRows.filter(r => r.some(Boolean));
  return { headerRow, firstLine: headerRow + 2, columns, dataRows, mapping: detectColumns(headers, filledRows) };
}

// ---------------------------------------------------------------- values

/** +966 for Saudi numbers written 05…, 5…, 9665…, 009665…; '' when shorter than 8 */
export function cleanImportPhone(v: unknown): string {
  let s = latinDigits(String(v ?? '')).replace(/[^\d+]/g, '');
  if (!s) return '';
  s = s[0] + s.slice(1).replace(/\+/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^9665\d{8}$/.test(s)) s = '+' + s;          // 9665xxxxxxxx
  if (/^05\d{8}$/.test(s)) s = '+966' + s.slice(1); // 05xxxxxxxx
  if (/^5\d{8}$/.test(s)) s = '+966' + s;           // 5xxxxxxxx
  return s.replace(/\D/g, '').length >= 8 ? s : '';
}

/** First valid phone of a cell + the other valid ones ("0533…, 0555…" or "0533… / 0555…") */
export function splitPhones(v: string): { phone: string; extra: string[] } {
  const found = v.split(PHONE_SPLIT).map(cleanImportPhone).filter(Boolean);
  const unique = [...new Set(found)];
  return { phone: unique[0] ?? '', extra: unique.slice(1) };
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  'Saudi Arabia': ['saudi arabia', 'saudi', 'ksa', 'sa', 'السعودية', 'السعوديه', 'المملكة العربية السعودية'],
  Oman: ['oman', 'om', 'omn', 'عمان', 'سلطنة عمان'],
  Iraq: ['iraq', 'iq', 'irq', 'العراق'],
  UAE: ['uae', 'ae', 'united arab emirates', 'emirates', 'الامارات', 'الإمارات', 'dubai', 'abu dhabi', 'sharjah', 'ajman', 'fujairah', 'rak', 'ras al khaimah', 'دبي', 'ابوظبي', 'أبوظبي', 'الشارقة'],
  Egypt: ['egypt', 'eg', 'مصر'],
};

/** "ksa", "KSA", "السعودية" … → "Saudi Arabia". Unknown values are kept as written. */
export function normalizeCountry(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return '';
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.includes(key)) return country;
  }
  return value.trim();
}

export function parseCustomerNumber(value: string): number | undefined {
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseQuantity(value: string): number {
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export interface ImportLeadRow {
  line: number;               // row number in the sheet (1-based, as Excel shows it)
  customerNumber?: number;
  website?: string;
  websiteKey?: string;
  name: string;
  phone: string;              // cleaned, may be empty
  company: string;
  region: string;
  source: string;
  notes: string;
  quantity: number;
}

export interface RejectedRow { line: number; reason: string; values: Record<string, string> }

/**
 * Builds the rows to upload. Rows without a name are rejected. `firstLine` is the Excel row number
 * of dataRows[0] (for the "skipped rows" file).
 */
export function buildImportRows(
  dataRows: string[][], mapping: ColumnMapping, firstLine: number,
): { rows: ImportLeadRow[]; rejected: RejectedRow[] } {
  const get = (row: string[], f: ImportField) => (mapping[f] === undefined ? '' : cleanCell(row[mapping[f]!]));
  const rows: ImportLeadRow[] = [];
  const rejected: RejectedRow[] = [];
  dataRows.forEach((row, i) => {
    const line = firstLine + i;
    if (!row.some(Boolean)) return; // blank line
    const { phone, extra } = splitPhones(get(row, 'phone'));
    const email = get(row, 'email');
    const notes = [
      get(row, 'notes'),
      extra.length ? `Other phones: ${extra.join(', ')}` : '',
      email ? `Email: ${email}` : '',
    ].filter(Boolean).join(' · ');
    const name = get(row, 'name') || get(row, 'company');
    const out: ImportLeadRow = {
      line,
      customerNumber: parseCustomerNumber(get(row, 'customerNumber')),
      website: get(row, 'website'),
      quantity: parseQuantity(get(row, 'quantity')),
      name,
      phone,
      company: get(row, 'company'),
      region: normalizeCountry(get(row, 'region')),
      source: get(row, 'source') || 'Excel Import',
      notes,
    };
    if (!name) {
      rejected.push({ line, reason: 'No name', values: rowValues(out) });
      return;
    }
    rows.push(out);
  });
  return { rows, rejected };
}

/** A row as plain columns for the "skipped rows" Excel file */
export function rowValues(r: ImportLeadRow): Record<string, string> {
  return {
    Name: r.name, Phone: r.phone, Website: r.website ?? '', Company: r.company, Country: r.region,
    Source: r.source, Notes: r.notes, 'Customer Number': r.customerNumber ? String(r.customerNumber) : '',
    Quantity: r.quantity ? String(r.quantity) : '',
  };
}
