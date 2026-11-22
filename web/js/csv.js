// RFC 4180 CSV parser with delimiter detection (, ; tab |), BOM removal and quoted fields.

const DELIMS = [",", ";", "\t", "|"];

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",", bestScore = -1;
  for (const d of DELIMS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const nonZero = counts.filter((c) => c > 0);
    if (!nonZero.length) continue;
    // consistent counts across lines matter more than raw frequency
    const mode = mostCommon(nonZero);
    const score = nonZero.filter((c) => c === mode).length * 10 + mode;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

function mostCommon(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/** Parse CSV text into an array of rows (arrays of strings). Blank lines become [] so index + 1 = line. */
export function parseCSV(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = "", q = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { q = true; i++; continue; }
    if (ch === d) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); field = "";
      rows.push(row.some((c) => c.trim() !== "") ? row : []); // blank lines kept: indexes stay file lines
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++; continue;
    }
    field += ch; i++;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** CSV writer. Cells starting with = + - @ are prefixed with ' (spreadsheet formula injection). */
export function toCSV(rows, delimiter = ",") {
  return rows.map((r) => r.map((c) => cell(c, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}

function cell(v, d) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  if (s.includes(d) || s.includes('"') || s.includes("\n") || s.includes("\r")) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
