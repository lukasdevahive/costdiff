// Fictitious demo price lists for prospect demos (experiments/costdiff/demo). Every file says FICTIF.
// Usage: node scripts/make_demo.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xlsxBytes } from "./xlsx_writer.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "experiments", "costdiff", "demo");
fs.mkdirSync(OUT, { recursive: true });

// 1. Hardware: the CSV pair already in the folder, also as .xlsx (what suppliers usually send)
for (const year of ["2026", "2027"]) {
  const csv = fs.readFileSync(path.join(OUT, `quincaillerie-tarif-${year}-FICTIF.csv`), "utf8").trim().split(/\r?\n/);
  const rows = csv.map((l) => l.split(";").map((c) => c.replace(/ €$/, "")))
    .map((r) => r.map((c, i) => (i === 3 && /^\d+,\d+$/.test(c) ? Number(c.replace(",", ".")) : c)));
  fs.writeFileSync(path.join(OUT, `quincaillerie-tarif-${year}-FICTIF.xlsx`), xlsxBytes(rows));
}

// 2. CHR beverages (segment 2): a wholesaler's price list for cafés and restaurants, EAN-keyed, Excel numbers
const head = [["GROSSISTE BOISSONS FICTIF - tarif CHR (données inventées pour la démonstration)"], [], ["EAN", "Article", "Conditionnement", "Prix HT"]];
const old = [
  ["5400000000010", "Bière blonde pils", "24 x 25 cl", 18.9],
  ["5400000000027", "Bière blonde pils fût", "fût 20 l", 64.0],
  ["5400000000034", "Eau plate", "24 x 50 cl", 9.6],
  ["5400000000041", "Eau pétillante", "24 x 50 cl", 10.2],
  ["5400000000058", "Cola", "24 x 33 cl", 19.8],
  ["5400000000065", "Jus d'orange", "24 x 20 cl", 21.6],
  ["5400000000072", "Tonic", "24 x 20 cl", 17.4],
  ["5400000000089", "Bière d'abbaye brune", "24 x 33 cl", 31.2],
  ["5400000000096", "Vin rouge maison", "6 x 75 cl", 33.0],
  ["5400000000102", "Limonade citron", "24 x 25 cl", 16.8],
];
const neu = [
  ["5400000000010", "Bière blonde pils", "24 x 25 cl", 19.6],
  ["5400000000027", "Bière blonde pils fût", "fût 20 l", 64.0],
  ["5400000000034", "Eau plate", "20 x 50 cl", 9.6],
  ["5400000000041", "Eau pétillante", "24 x 50 cl", 10.2],
  ["5400000000058", "Cola", "24 x 33 cl", 20.9],
  ["5400000000065", "Jus d'orange", "24 x 20 cl", 20.9],
  ["5400000000072", "Tonic", "24 x 20 cl", 17.4],
  ["5400000000089", "Bière d'abbaye brune", "24 x 30 cl", 31.2],
  ["5400000000096", "Vin rouge maison", "6 x 75 cl", 33.0],
  ["5400000000119", "Thé glacé pêche", "24 x 33 cl", 22.8],
];
fs.writeFileSync(path.join(OUT, "boissons-chr-tarif-janvier-FICTIF.xlsx"), xlsxBytes([...head, ...old]));
fs.writeFileSync(path.join(OUT, "boissons-chr-tarif-mars-FICTIF.xlsx"), xlsxBytes([...head, ...neu]));
console.log("demo files written to", OUT);
