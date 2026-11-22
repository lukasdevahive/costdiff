// Core logic: turn raw rows into a priced item list, then compare two lists (price changes)
// or several suppliers (cheapest offer per product). Pure functions, no DOM: tested in Node.

import { detectDecimal, countAmbiguous, isAmbiguous, parsePrice, round } from "./numbers.js";
import { parsePack } from "./pack.js";

export const MAX_ROWS = 200000;

/** A problem with the user's files or choices (shown as a message), as opposed to a bug. */
export class InputError extends Error {}

export function normKey(v, role) {
  let s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (typeof v === "number" && Number.isFinite(v)) s = String(Math.round(v)); // Excel stores EANs as numbers
  if (role === "ean" && /^\d+$/.test(s)) s = s.replace(/^0+(?=\d{8})/, ""); // EAN-13 vs GTIN-14 leading zeros
  // purely numeric references: "00123" in a CSV and 123 in Excel (which drops leading zeros) are the same item
  else if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, "");
  return s;
}

/**
 * rows: data rows (header excluded). mapping: { key, keyRole, name, price, pack } column indexes (-1 = none).
 * Returns { items: Map(key -> item), issues: [...], stats }.
 */
export function buildList(rows, mapping, label = "") {
  if (mapping.key < 0) throw new InputError("Choisissez la colonne qui identifie le produit (référence ou EAN).");
  if (mapping.price < 0) throw new InputError("Choisissez la colonne du prix.");
  if (rows.length > MAX_ROWS) throw new InputError(`Fichier trop grand : ${rows.length} lignes (maximum ${MAX_ROWS}).`);
  const detected = detectDecimal(rows.slice(0, 500).map((r) => r[mapping.price]));
  // undecided column: use the other file's separator (same supplier), else "," (French / Dutch-speaking audience)
  const decimal = detected ?? mapping.decimalHint ?? ",";
  const prices = rows.map((r) => r[mapping.price]);
  const ambiguous = countAmbiguous(prices); // "1.250": a thousand, or 3 decimals?
  const ambiguousExample = ambiguous ? String(prices.find((v) => typeof v !== "number" && isAmbiguous(String(v).replace(/[^\d.,]/g, "")))).trim() : null;
  const items = new Map();
  const issues = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const line = mapping.lines?.[i] ?? (mapping.firstDataLine ?? 2) + i; // line in the original file
    const key = normKey(r[mapping.key], mapping.keyRole);
    const rawPrice = r[mapping.price];
    if (!key && (rawPrice === undefined || String(rawPrice).trim() === "")) { skipped++; return; }
    if (!key) { issues.push({ file: label, line, type: "missing-key", detail: "ligne sans référence" }); return; }
    const price = parsePrice(rawPrice, decimal);
    const name = mapping.name >= 0 ? String(r[mapping.name] ?? "").trim() : "";
    if (price === null || price < 0) {
      issues.push({ file: label, line, key, type: "bad-price", detail: `prix illisible : « ${String(rawPrice ?? "").slice(0, 40)} »` });
      return;
    }
    const packSource = mapping.pack >= 0 ? r[mapping.pack] : name;
    const pack = parsePack(packSource); // without a pack column, read it from the product name ("Farine T55 25 kg")
    const item = { key, name, price, pack, packFromName: mapping.pack < 0 && Boolean(pack), unitPrice: pack ? round(price / pack.amount, 6) : null, line };
    if (items.has(key)) {
      const first = items.get(key);
      issues.push({ file: label, line, key, type: "duplicate", detail: `référence en double (déjà ligne ${first.line}) : la première ligne est gardée` });
      return;
    }
    items.set(key, item);
  });
  return { items, issues, stats: { rows: rows.length, items: items.size, skipped, decimal, decimalSource: detected ? "colonne" : mapping.decimalHint ? "autre fichier" : "défaut", ambiguous, ambiguousExample } };
}

/** Compare an old and a new price list from the same supplier. */
export function diffLists(oldList, newList, { threshold = 0 } = {}) {
  const changes = [];
  for (const [key, n] of newList.items) {
    const o = oldList.items.get(key);
    if (!o) { changes.push({ key, status: "new", name: n.name, newPrice: n.price, newPack: n.pack }); continue; }
    const pct = o.price > 0 ? (n.price - o.price) / o.price * 100 : null;
    let packChanged = Boolean(o.pack && n.pack && (o.pack.unit !== n.pack.unit || Math.abs(o.pack.amount - n.pack.amount) > 1e-9));
    // pack sizes read from a reworded product name ("Pasta 12 x 500 g" -> "Pasta 500 g") are not trusted when they
    // jump by more than 2x or change unit: flagged "to check" instead of being reported as a hidden increase
    const ratio = packChanged && o.pack.unit === n.pack.unit ? n.pack.amount / o.pack.amount : 1;
    const packCheck = packChanged && (o.packFromName || n.packFromName) && (ratio > 2 || ratio < 0.5 || o.pack.unit !== n.pack.unit);
    if (packCheck) packChanged = false;
    let unitPct = null;
    if (!packCheck && o.unitPrice && n.unitPrice && o.pack.unit === n.pack.unit) unitPct = (n.unitPrice - o.unitPrice) / o.unitPrice * 100;
    // the change that matters: per kg / l / piece when the pack size moved, otherwise the price itself
    const effective = packChanged && unitPct !== null ? unitPct : pct;
    let status = "same";
    if (effective !== null && Math.abs(effective) > threshold + 1e-9) status = effective > 0 ? "up" : "down";
    else if (effective === null && n.price !== o.price) status = n.price > o.price ? "up" : "down";
    changes.push({
      key, status, name: n.name || o.name, oldPrice: o.price, newPrice: n.price,
      pct: pct === null ? null : round(pct, 2), unitPct: unitPct === null ? null : round(unitPct, 2),
      effectivePct: effective === null ? null : round(effective, 2),
      oldPack: o.pack, newPack: n.pack, packChanged, packCheck,
      hidden: packChanged && unitPct !== null && unitPct > threshold && (pct === null || pct <= threshold),
    });
  }
  for (const [key, o] of oldList.items) {
    if (!newList.items.has(key)) changes.push({ key, status: "removed", name: o.name, oldPrice: o.price, oldPack: o.pack });
  }
  const order = { up: 0, down: 1, new: 2, removed: 3, same: 4 };
  changes.sort((a, b) => order[a.status] - order[b.status] || Math.abs(b.effectivePct ?? 0) - Math.abs(a.effectivePct ?? 0) || a.key.localeCompare(b.key));
  return { changes, summary: summarise(changes) };
}

function summarise(changes) {
  const count = (s) => changes.filter((c) => c.status === s).length;
  const ups = changes.filter((c) => c.status === "up" && c.effectivePct !== null);
  return {
    up: count("up"), down: count("down"), same: count("same"), new: count("new"), removed: count("removed"),
    hidden: changes.filter((c) => c.hidden).length,
    packCheck: changes.filter((c) => c.packCheck).length,
    packChanged: changes.filter((c) => c.packChanged).length,
    avgUpPct: ups.length ? round(ups.reduce((a, c) => a + c.effectivePct, 0) / ups.length, 2) : null,
    maxUp: ups.length ? ups.reduce((a, c) => (c.effectivePct > a.effectivePct ? c : a)) : null,
  };
}

/**
 * Compare several suppliers. lists: [{ label, list }]. Products are matched on the key.
 * When every offer of a product has a pack size in the same unit, the comparison is per kg / l / piece.
 */
export function compareSuppliers(lists) {
  if (lists.length < 2) throw new InputError("Ajoutez au moins deux fournisseurs à comparer.");
  const keys = new Set();
  for (const { list } of lists) for (const k of list.items.keys()) keys.add(k);
  const rows = [];
  for (const key of keys) {
    const offers = lists.map(({ label, list }) => {
      const it = list.items.get(key);
      return it ? { supplier: label, price: it.price, pack: it.pack, unitPrice: it.unitPrice, name: it.name } : null;
    });
    const present = offers.filter(Boolean);
    const units = new Set(present.map((o) => (o.pack ? o.pack.unit : null)));
    const perUnit = present.length > 1 && !units.has(null) && units.size === 1;
    const value = (o) => (perUnit ? o.unitPrice : o.price);
    let best = null, worst = null;
    for (const o of present) {
      if (!best || value(o) < value(best)) best = o;
      if (!worst || value(o) > value(worst)) worst = o;
    }
    const spreadPct = present.length > 1 && value(best) > 0 ? round((value(worst) - value(best)) / value(best) * 100, 2) : null;
    rows.push({
      key, name: present.find((o) => o.name)?.name || "", offers, count: present.length, perUnit,
      basis: perUnit ? `par ${[...units][0]}` : "par ligne",
      best: best?.supplier ?? null, bestValue: best ? value(best) : null, spreadPct,
    });
  }
  rows.sort((a, b) => b.count - a.count || (b.spreadPct ?? -1) - (a.spreadPct ?? -1) || a.key.localeCompare(b.key));
  const comparable = rows.filter((r) => r.count > 1);
  const wins = Object.fromEntries(lists.map(({ label }) => [label, comparable.filter((r) => r.best === label).length]));
  return { rows, summary: { products: rows.length, comparable: comparable.length, onlyOne: rows.length - comparable.length, wins } };
}
