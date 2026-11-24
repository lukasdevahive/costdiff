// Header-row detection and column guessing for supplier files in EN / FR / NL / DE.

export const ROLES = ["sku", "ean", "name", "price", "pack"];

const SYNONYMS = {
  sku: ["sku", "ref", "réf", "reference", "référence", "item no", "item number", "item code", "article", "article no",
        "art nr", "artnr", "artikelnummer", "artikelnr", "art. nr", "code article", "product code", "part number",
        "part no", "mpn", "code", "item", "codice"],
  ean: ["ean", "ean13", "ean-13", "gtin", "barcode", "bar code", "code barre", "code-barres", "code barres", "upc", "streepjescode"],
  name: ["description", "désignation", "designation", "libellé", "libelle", "product", "produit", "product name",
         "name", "nom", "omschrijving", "benaming", "bezeichnung", "artikel", "item description", "title", "titre"],
  price: ["price", "prix", "prijs", "preis", "unit price", "cost", "coût", "cout", "tarif", "net price", "prix net",
          "prix ht", "price excl", "nettoprijs", "netto", "inkoopprijs", "einkaufspreis", "wholesale", "pu ht", "p.u.",
          "prix unitaire", "amount", "eur", "€"],
  pack: ["pack", "pack size", "packaging", "conditionnement", "colisage", "unit", "unité", "uom", "size", "format",
         "contenance", "verpakking", "inhoud", "eenheid", "verpackung", "inhalt", "case size", "qty per case"],
};

function norm(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[_./()\-:#]+/g, " ").replace(/\s+/g, " ").trim();
}

const NORM_SYN = Object.fromEntries(Object.entries(SYNONYMS).map(([k, v]) => [k, v.map(norm)]));

function score(header, role) {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  for (const syn of NORM_SYN[role]) {
    if (h === syn) best = Math.max(best, 10);
    else if (new RegExp(`(^| )${syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(h)) best = Math.max(best, 6 + Math.min(syn.length, 8) / 8);
  }
  return best;
}

/** Index of the header row among the first 30 rows: the row that looks most like column titles. */
export function detectHeaderRow(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] || [];
    const filled = row.filter((c) => String(c).trim() !== "");
    if (filled.length < 2) continue;
    const textCells = filled.filter((c) => typeof c !== "number" && !/^[\d\s.,€$%-]+$/.test(String(c)));
    const keyword = row.reduce((a, c) => a + Math.max(...ROLES.map((r) => score(c, r))), 0);
    const s = keyword * 2 + textCells.length + (textCells.length === filled.length ? 3 : 0);
    if (s > bestScore) { best = i; bestScore = s; }
  }
  return best;
}

/** Guess which column plays which role. Returns { sku, ean, name, price, pack } as column indexes or -1. */
export function guessMapping(headers, sampleRows = []) {
  const used = new Set();
  const out = Object.fromEntries(ROLES.map((r) => [r, -1]));
  // most specific roles first so "EAN code" goes to ean, not sku
  for (const role of ["ean", "price", "sku", "pack", "name"]) {
    let best = -1, bestScore = 0;
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      let s = score(h, role);
      if (role === "price" && s > 0) s += numericShare(sampleRows, i) * 3;
      if (role === "ean" && s === 0 && /^\d{8,14}$/.test(String(sampleRows[0]?.[i] ?? "")) && numericShare(sampleRows, i) > 0.9) s = 2;
      if (s > bestScore) { best = i; bestScore = s; }
    });
    if (best >= 0) { out[role] = best; used.add(best); }
  }
  // French price lists often title the product NAME "Article" (also a reference synonym): a "reference" column
  // holding mostly words ("Bière blonde pils") is the name, so the products are matched on their EAN instead
  if (out.name < 0 && out.sku >= 0 && wordShare(sampleRows, out.sku) > 0.6) { out.name = out.sku; out.sku = -1; }
  return out;
}

function wordShare(rows, col) {
  const vals = rows.map((r) => r?.[col]).filter((v) => v !== undefined && String(v).trim() !== "");
  if (!vals.length) return 0;
  return vals.filter((v) => /[a-zà-ÿ]{3}/.test(String(v))).length / vals.length;
}

function numericShare(rows, col) {
  const vals = rows.map((r) => r?.[col]).filter((v) => v !== undefined && String(v).trim() !== "");
  if (!vals.length) return 0;
  return vals.filter((v) => typeof v === "number" || /^[\s€$£]*-?[\d.,']+\s*(€|eur)?$/i.test(String(v))).length / vals.length;
}
