// Pack-size parsing, so that "12 x 500 g" at 9.00 and "10 x 500 g" at 8.00 are compared per kg.
// Returns { amount, unit } with unit in "kg" | "l" | "pc", or null when nothing reliable is found.

const UNITS = {
  kg: ["kg", 1], kilo: ["kg", 1], kilos: ["kg", 1], g: ["kg", 0.001], gr: ["kg", 0.001], grs: ["kg", 0.001], mg: ["kg", 0.000001],
  l: ["l", 1], lt: ["l", 1], ltr: ["l", 1], liter: ["l", 1], litre: ["l", 1], litres: ["l", 1], liters: ["l", 1],
  cl: ["l", 0.01], ml: ["l", 0.001], dl: ["l", 0.1],
};
const PACK_WORDS = /\b(?:box|case|carton|colis|pack|doos|karton|lot|bag|sac|tray|plateau)\s*(?:of|de|van|à)?\s*(\d+)\b/i;

function num(s) { return Number(String(s).replace(",", ".")); }

export function parsePack(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return input > 0 ? { amount: input, unit: "pc" } : null;
  const s = String(input).toLowerCase().replace(/×/g, "x").replace(/\s+/g, " ").trim();
  if (!s) return null;
  // 12 x 500 g / 6x1l / 4 x 6 x 33 cl
  const multi = s.match(/((?:\d+(?:[.,]\d+)?\s*x\s*)+)(\d+(?:[.,]\d+)?)\s*([a-z]+)\b/);
  if (multi && UNITS[multi[3]]) {
    const factors = multi[1].split("x").map((p) => p.trim()).filter(Boolean).map(num);
    const [unit, mult] = UNITS[multi[3]];
    const amount = factors.reduce((a, b) => a * b, 1) * num(multi[2]) * mult;
    return amount > 0 ? { amount: round(amount), unit } : null;
  }
  // 1 l x 6 / 500g x 12
  const after = s.match(/(\d+(?:[.,]\d+)?)\s*([a-z]+)\s*x\s*(\d+)\b/);
  if (after && UNITS[after[2]]) {
    const [unit, mult] = UNITS[after[2]];
    const amount = num(after[1]) * mult * Number(after[3]);
    return amount > 0 ? { amount: round(amount), unit } : null;
  }
  // 500 g / 2,5 kg / 75cl
  const single = s.match(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*([a-z]+)\b/);
  if (single && UNITS[single[2]]) {
    const [unit, mult] = UNITS[single[2]];
    const amount = num(single[1]) * mult;
    return amount > 0 ? { amount: round(amount), unit } : null;
  }
  const box = s.match(PACK_WORDS);
  if (box) return Number(box[1]) > 0 ? { amount: Number(box[1]), unit: "pc" } : null;
  // 24 pcs / 12 st / x24
  const count = s.match(/(\d+)\s*(pcs?|pieces?|pièces?|st(?:uks?)?|stk|units?|unités?|ea)\b/) || s.match(/\bx\s*(\d+)\b/);
  if (count) return Number(count[1]) > 0 ? { amount: Number(count[1]), unit: "pc" } : null;
  // a bare number in a dedicated pack column: a count of pieces
  if (/^\d+$/.test(s)) return Number(s) > 0 ? { amount: Number(s), unit: "pc" } : null;
  return null;
}

function round(n) { return Math.round(n * 1e6) / 1e6; }

export function formatPack(p) {
  if (!p) return "";
  if (p.unit === "pc") return `${p.amount} pc`;
  if (p.unit === "kg") return p.amount < 1 ? `${round(p.amount * 1000)} g` : `${p.amount} kg`;
  return p.amount < 1 ? `${round(p.amount * 100)} cl` : `${p.amount} l`;
}
