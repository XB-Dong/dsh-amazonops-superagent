export function parseCSV(text: string): string[][] {
  if (Buffer.byteLength(text) > 100000) throw new Error('REPORT_TOO_LARGE');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, '');
  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some(Boolean) || row.length > 1) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error('INVALID_CSV');
      quoted = true;
    } else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      if (closed) throw new Error('INVALID_CSV');
      cell += c;
    }
  }
  if (quoted) throw new Error('INVALID_CSV');
  if (cell || row.length || closed) pushRow();
  if (rows.length < 2 || rows.length > 1001) throw new Error('INVALID_REPORT_SIZE');
  if (
    new Set(rows[0]).size !== rows[0].length ||
    rows[0].some((v) => !v) ||
    rows.some((r) => r.length !== rows[0].length)
  )
    throw new Error('INVALID_CSV');
  return rows;
}
export function csvCell(value: string | number): string {
  const safe =
    typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value);
  return `"${safe.replaceAll('"', '""')}"`;
}
