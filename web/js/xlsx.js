// Minimal, dependency-free .xlsx reader: values of the first worksheet (or a named one).
// Uses the platform's DecompressionStream("deflate-raw") (Chrome, Edge, Firefox, Safari 16.4+, Node 18+).
// Formulas are read from their cached values; dates stay as serial numbers; styles are ignored.

const MAX_UNCOMPRESSED = 200 * 1024 * 1024;

export class XlsxError extends Error {}

export async function readXlsx(buffer, sheetName) {
  const bytes = new Uint8Array(buffer);
  const files = listZip(bytes);
  const wb = await text(bytes, files, "xl/workbook.xml");
  const rels = await text(bytes, files, "xl/_rels/workbook.xml.rels", true);
  const sheets = [...wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: decode(attr(m[1], "name") || ""),
    rid: attr(m[1], "r:id") || attr(m[1], "id"),
  }));
  if (!sheets.length) throw new XlsxError("Ce classeur ne contient aucune feuille.");
  const target = (sheetName && sheets.find((s) => s.name === sheetName)) || sheets[0];
  let path = "xl/worksheets/sheet1.xml";
  if (rels && target.rid) {
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => attr(a, "Id") === target.rid);
    const t = rel && attr(rel, "Target");
    if (t) path = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
  }
  const shared = await text(bytes, files, "xl/sharedStrings.xml", true);
  const strings = shared ? [...shared.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => richText(m[1])) : [];
  const xml = await text(bytes, files, path);
  return { sheets: sheets.map((s) => s.name), sheet: target.name, rows: sheetRows(xml, strings) };
}

function sheetRows(xml, strings) {
  const rows = [];
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const r = Number(attr(rm[1], "r")) || rows.length + 1;
    const row = [];
    for (const cm of (rm[2] || "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = cm[1], body = cm[2] || "";
      const ref = attr(a, "r");
      const col = ref ? colIndex(ref) : row.length;
      const t = attr(a, "t");
      const v = (body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
      let val = "";
      if (t === "s") val = strings[Number(v)] ?? "";
      else if (t === "inlineStr") val = richText(body);
      else if (t === "str" || t === "e") val = decode(v ?? "");
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) { const n = Number(v); val = Number.isFinite(n) ? n : decode(v); }
      row[col] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    while (row.length && String(row[row.length - 1]).trim() === "") row.pop(); // styled empty cells up to XFD
    rows[r - 1] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []; // index + 1 = Excel row number
  return rows;
}

function richText(s) {
  return [...s.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1])).join("");
}

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/i)[0].toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function attr(s, name) {
  const m = s.match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`));
  return m ? m[1] : null;
}

function decode(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
    const map = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

// --- ZIP (central directory) ---------------------------------------------------------------
function listZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError("Ce fichier n'est pas un classeur .xlsx valide (archive ZIP introuvable).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError("Archive .xlsx endommagée.");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    files.set(name, { method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

async function text(b, files, name, optional = false) {
  const f = files.get(name);
  if (!f) {
    if (optional) return null;
    throw new XlsxError(`Classeur incomplet : « ${name} » manquant. Est-ce bien un fichier Excel .xlsx ?`);
  }
  if (f.usize > MAX_UNCOMPRESSED) throw new XlsxError("Feuille trop volumineuse.");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(f.local, true) !== 0x04034b50) throw new XlsxError("Archive .xlsx endommagée.");
  const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
  const data = b.subarray(start, start + f.csize);
  let out;
  if (f.method === 0) out = data;
  else if (f.method === 8) out = await inflate(data);
  else throw new XlsxError("Compression .xlsx non prise en charge.");
  return new TextDecoder().decode(out);
}

async function inflate(data) {
  // the size declared inside the zip cannot be trusted (zip bomb): count while inflating, stop past the limit
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNCOMPRESSED) {
      await reader.cancel();
      throw new XlsxError("Feuille trop volumineuse (plus de 200 Mo une fois décompressée).");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
