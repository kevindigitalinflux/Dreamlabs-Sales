function cell(value: string): string {
  return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** RFC-4180 CSV: quoted cells where needed, CRLF rows. */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
