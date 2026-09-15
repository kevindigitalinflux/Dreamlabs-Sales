function cell(value: string): string {
  return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** RFC-4180 CSV: quoted cells where needed, CRLF rows. */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** RFC-4180 CSV parser: quoted cells, escaped "" quotes, CRLF/LF rows. Returns raw
 * string cells with no type coercion — the header row is rows[0]. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  function endCell() {
    row.push(cell);
    cell = '';
  }
  function endRow() {
    endCell();
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }
    if (char === '"') { inQuotes = true; i += 1; continue; }
    if (char === ',') { endCell(); i += 1; continue; }
    if (char === '\r') { i += 1; continue; }
    if (char === '\n') { endRow(); i += 1; continue; }
    cell += char;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}
