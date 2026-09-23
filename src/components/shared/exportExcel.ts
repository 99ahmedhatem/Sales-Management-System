import * as XLSX from 'xlsx';

export function exportRowsToExcel<T extends Record<string, unknown>>(rows: T[], filenamePrefix: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  worksheet['!cols'] = headers.map(header => {
    const maxLength = Math.max(header.length, ...rows.map(row => String(row[header] ?? '').length));
    return { wch: Math.min(Math.max(maxLength + 2, 12), 42) };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
  XLSX.writeFile(workbook, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
