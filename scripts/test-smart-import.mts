// Checks the smart Excel import against the cases of the spec. Run: node --experimental-strip-types scripts/test-smart-import.mts
import * as XLSX from 'xlsx';
import { analyzeMatrix, buildImportRows, sheetToMatrix, cleanImportPhone, splitPhones } from '../src/lib/smartImport.ts';

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`);
};

// Write as a real .xlsx and read it back, the same way the app does
function roundTrip(aoa: unknown[][], type: 'xlsx' | 'csv' = 'xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: type });
  const back = XLSX.read(buf, { type: 'array', raw: type === 'csv' });
  const matrix = sheetToMatrix(back.Sheets[back.SheetNames[0]], XLSX.utils);
  const a = analyzeMatrix(matrix);
  return { a, ...buildImportRows(a.dataRows, a.mapping, a.firstLine) };
}
const pick = (r: { name: string; phone: string; website?: string }) => [r.name, r.phone, r.website ?? ''];

const P = '+966533672708';

{
  const { a, rows } = roundTrip([
    ['الاسم', 'الهاتف', 'الموقع'],
    ['متجر محتواي', '+966533672708', 'https://mohtaway.com/'],
    ['Anneau', '0555123456', 'anneau.sa'],
  ]);
  eq('1 arabic headers: mapping', a.mapping, { phone: 1, website: 2, name: 0 });
  eq('1 arabic headers: rows', rows.map(pick), [['متجر محتواي', P, 'https://mohtaway.com/'], ['Anneau', '+966555123456', 'anneau.sa']]);
}
{
  const { a, rows } = roundTrip([
    ['اسم المتجر', 'الجوال', 'رابط المتجر'],
    ['متجر محتواي', '0533672708', 'mohtaway.com'],
  ]);
  eq('2 other arabic headers: mapping', a.mapping, { phone: 1, website: 2, name: 0 });
  eq('2 other arabic headers: phone', rows[0].phone, P);
}
{
  const { a, rows } = roundTrip([
    ['URL', 'Mobile', 'Store Name'],
    ['https://a.com', '533672708', 'Store A'],
  ]);
  eq('3 english reversed: mapping', a.mapping, { phone: 1, website: 0, name: 2 });
  eq('3 english reversed: rows', rows.map(pick), [['Store A', P, 'https://a.com']]);
}
{
  const { a, rows } = roundTrip([
    ['متجر محتواي', '+966533672708', 'https://mohtaway.com/'],
    ['Anneau', 966555123456, 'anneau.sa'],
    ['متجر ثالث', '0544000111', 'third.store'],
  ]);
  eq('4 no header row: header', a.headerRow, -1);
  eq('4 no header row: rows', rows.map(pick), [
    ['متجر محتواي', P, 'https://mohtaway.com/'], ['Anneau', '+966555123456', 'anneau.sa'], ['متجر ثالث', '+966544000111', 'third.store'],
  ]);
}
{
  const { a, rows } = roundTrip([
    ['تقرير العملاء'],
    [],
    ['الاسم', '', '', 'رقم الجوال', 'الموقع'],
    ['A', '', '', '0533672708', 'a.com'],
    ['B', '', '', '0555123456', 'b.com'],
  ]);
  eq('5 title + empty columns: header row', a.headerRow, 2);
  eq('5 title + empty columns: columns', a.columns.map(c => c.index), [0, 3, 4]);
  eq('5 title + empty columns: rows', rows.map(pick), [['A', P, 'a.com'], ['B', '+966555123456', 'b.com']]);
  eq('5 excel line numbers', rows.map(r => r.line), [4, 5]);
}
{
  eq('6 phone formats', ['+966533672708', '0533672708', '533672708', '966533672708', 966533672708, '00966533672708', '٠٥٣٣٦٧٢٧٠٨', '053 367 2708', '-']
    .map(cleanImportPhone), [P, P, P, P, P, P, P, P, '']);
  const { rows } = roundTrip([['Name', 'Phone'], ['X', 966533672708], ['Y', 533672708]]);
  eq('6 numeric cells in xlsx', rows.map(r => r.phone), [P, P]);
  const csv = roundTrip([['Name', 'Phone'], ['X', '0533672708']], 'csv');
  eq('6 csv keeps leading zero', csv.rows[0].phone, P);
}
{
  eq('multi phones in a cell', splitPhones('0533672708, 0555123456 / 0533672708'), { phone: P, extra: ['+966555123456'] });
  const { rows } = roundTrip([['Name', 'Phone'], ['X', '0533672708 / 0555123456']]);
  eq('multi phones go to notes', rows[0].notes, 'Other phones: +966555123456');
}
{
  // The bug that lost 9,835 phones: header "الهاتف" next to a serial "الرقم" column
  const { a, rows } = roundTrip([
    ['الرقم', 'اسم المتجر', 'الهاتف'],
    [1, 'A', '0533672708'], [2, 'B', '0555123456'], [3, 'C', '0544000111'],
  ]);
  eq('serial "الرقم" is not the phone', a.mapping.phone, 2);
  eq('all phones read', rows.filter(r => r.phone).length, 3);
}
{
  // Header with an unknown phone column name → found by content
  const { a } = roundTrip([
    ['Store', 'Numbers here', 'Link'],
    ['A', '0533672708', 'a.com'], ['B', '0555123456', 'b.com'], ['C', '0544000111', 'c.com'],
  ]);
  eq('unknown header name, phone by content', a.mapping.phone, 1);
}
{
  const { a, rows } = roundTrip([['اسم الشركة', 'الهاتف'], ['شركة 1', '0533672708']]);
  eq('only "اسم الشركة" → it is the name', [a.mapping.name, rows[0].name], [0, 'شركة 1']);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
