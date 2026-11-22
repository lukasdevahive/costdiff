// Price parsing for European and US supplier files ("1.234,56 €", "$1,234.56", "12,5", "EUR 3.20").

const CURRENCY = /(€|\$|£|eur|usd|gbp|chf|ht|ttc|excl\.?|incl\.?|btw|tva|vat|\s| | )/gi;

/** "1.250" or "2,375": one separator followed by exactly 3 digits, after 1-3 digits not starting with 0.
 *  Either a thousand (1250) or a price with 3 decimals (1.25): only the rest of the column can tell. */
export function isAmbiguous(s) {
  return /^-?[1-9]\d{0,2}[.,]\d{3}$/.test(s);
}

function clean(v) { return String(v ?? "").replace(CURRENCY, "").replace(/^\((.*)\)$/, "$1"); }

/** Decide the decimal separator of a column from its sample values: "," or ".", or null when nothing tells
 *  (only ambiguous values like "1.250", whole numbers, or Excel numbers, which need no separator). */
export function detectDecimal(values) {
  let comma = 0, dot = 0;
  for (const v of values) {
    if (typeof v === "number") continue; // already a number: says nothing about the text cells
    const s = clean(v);
    if (!s || isAmbiguous(s)) continue;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) { lc > ld ? comma++ : dot++; continue; }
    const sep = lc >= 0 ? "," : ld >= 0 ? "." : null;
    if (!sep) continue;
    const parts = s.split(sep);
    if (parts.length > 2) { if (thousandsShape(s, sep)) (sep === "." ? comma++ : dot++); continue; } // 1.234.567
    sep === "," ? comma++ : dot++; // 12,5 / 0,125 / 3.20 / 1234.5678: the separator is a decimal
  }
  if (!comma && !dot) return null;
  return comma > dot ? "," : ".";
}

/** How many values of a column were ambiguous (shown to the user with the assumed separator). */
export function countAmbiguous(values) {
  return values.filter((v) => typeof v !== "number" && isAmbiguous(clean(v))).length;
}

function thousandsShape(s, sep) {
  // "1.234" / "12,345,678": groups of 3 after 1-3 leading digits that do not start with 0
  const e = sep === "." ? "\\." : ",";
  return new RegExp(`^[1-9]\\d{0,2}(${e}\\d{3})+$`).test(s);
}

/** Parse one price with the column's decimal separator. Returns a finite number or null (never guesses on garbage). */
export function parsePrice(value, decimal = ".") {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(CURRENCY, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (!/^[\d.,']+$/.test(s) || !/\d/.test(s)) return null;
  s = s.replace(/'/g, "");
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  let dec;
  if (lc >= 0 && ld >= 0) {
    dec = lc > ld ? "," : "."; // "1.234,56" / "1,234.56": the last one is the decimal
    const intPart = s.slice(0, s.lastIndexOf(dec));
    if (!thousandsShape(intPart, dec === "," ? "." : ",")) return null; // "1,23.45" is not a price
  } else if (lc < 0 && ld < 0) dec = decimal;
  else {
    const sep = lc >= 0 ? "," : ".";
    const count = s.split(sep).length - 1;
    if (count > 1) {
      if (!thousandsShape(s, sep)) return null; // "1.2.3" is not a price
      dec = sep === "," ? "." : ",";
    } else if (sep === decimal || !thousandsShape(s, sep)) dec = sep; // 0,125 / 12,5 / column convention
    else dec = sep === "," ? "." : ","; // 1,234 in a "." column: thousands
  }
  const th = dec === "," ? "." : ",";
  s = s.split(th).join("");
  s = s.replace(dec, ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function round(n, digits = 4) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
