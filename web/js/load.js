// File loading shared by the UI: bytes -> rows -> header + guessed mapping.

import { parseCSV } from "./csv.js";
import { readXlsx, XlsxError } from "./xlsx.js";
import { detectHeaderRow, guessMapping } from "./columns.js";

export const MAX_BYTES = 25 * 1024 * 1024;

export class LoadError extends Error {}

/** name: file name; buffer: ArrayBuffer. Returns { name, rows, headerRow, headerLine, headers, data, dataLines, mapping, sheet }. */
export async function loadTable(name, buffer) {
  if (buffer.byteLength === 0) throw new LoadError(`« ${name} » est vide.`);
  if (buffer.byteLength > MAX_BYTES) throw new LoadError(`« ${name} » dépasse 25 Mo.`);
  const lower = name.toLowerCase();
  const head = new Uint8Array(buffer.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  let rows, sheet = null;
  if (lower.endsWith(".xls") && !isZip) {
    throw new LoadError(`« ${name} » est un ancien fichier Excel (.xls). Enregistrez-le en .xlsx ou en .csv puis réessayez.`);
  }
  if (lower.endsWith(".pdf") || (head[0] === 0x25 && head[1] === 0x50)) {
    throw new LoadError(`« ${name} » est un PDF. CostDiff lit les fichiers .xlsx et .csv ; exportez la liste en Excel ou en CSV.`);
  }
  if (isZip || lower.endsWith(".xlsx")) {
    try {
      const wb = await readXlsx(buffer);
      rows = wb.rows; sheet = wb.sheet;
    } catch (e) {
      throw new LoadError(e instanceof XlsxError ? `« ${name} » : ${e.message}` : `« ${name} » n'a pas pu être lu comme fichier Excel.`);
    }
  } else {
    const text = decodeText(buffer);
    if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw new LoadError(`« ${name} » n'est pas un fichier texte CSV lisible.`);
    rows = parseCSV(text);
  }
  // blank rows are dropped here, but each kept row remembers its line in the original file
  const lines = [];
  rows = rows.filter((r, i) => (r.some((c) => String(c).trim() !== "") ? lines.push(i + 1) : false));
  if (!rows.length) throw new LoadError(`« ${name} » ne contient aucune ligne.`);
  const headerRow = detectHeaderRow(rows);
  const width = Math.max(...rows.slice(headerRow, headerRow + 50).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(rows[headerRow][i] ?? "").trim() || `Colonne ${i + 1}`);
  const data = rows.slice(headerRow + 1);
  const dataLines = lines.slice(headerRow + 1);
  const headerLine = lines[headerRow];
  if (!data.length) throw new LoadError(`« ${name} » ne contient que des titres, aucune ligne de produit.`);
  const mapping = guessMapping(headers, data.slice(0, 50));
  return { name, sheet, rows, headerRow, headerLine, headers, data, dataLines, mapping };
}

function decodeText(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  // Excel "CSV (séparateur : point-virgule)" is often Windows-1252: fall back when UTF-8 shows replacement chars
  if (utf8.includes("�")) {
    try { return new TextDecoder("windows-1252").decode(buffer); } catch { /* keep utf-8 */ }
  }
  return utf8;
}

/** Mapping for buildList from a loaded table and the user's choices. */
export function listMapping(table, m) {
  const keyRole = m.keyRole || (m.ean >= 0 && m.sku < 0 ? "ean" : "sku");
  return {
    key: keyRole === "ean" ? m.ean : m.sku, keyRole,
    name: m.name, price: m.price, pack: m.pack, lines: table.dataLines,
  };
}
