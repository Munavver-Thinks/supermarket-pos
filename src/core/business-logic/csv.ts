/**
 * Renders rows as CSV for handing to an accountant or opening in a spreadsheet.
 *
 * Quoting follows RFC 4180: a field is wrapped in quotes when it contains a comma, a quote
 * or a newline, and embedded quotes are doubled. This matters more than it looks — a
 * product called `Toor Dal, 1kg` would otherwise split into two columns and silently shift
 * every figure on the row.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [headers.map(csvField).join(","), ...rows.map((row) => row.map(csvField).join(","))];
  // CRLF, because Excel on Windows is where these files are opened.
  return lines.join("\r\n");
}

function csvField(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Paise as a plain decimal for spreadsheets — no ₹, no thousands separators, so the cell
 * reads back as a number rather than text.
 */
export function paiseForCsv(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
