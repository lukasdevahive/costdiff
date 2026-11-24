// Builds the FICTITIOUS sample files in web/samples/ (no real supplier, no real price).
// Run: node scripts/make_samples.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xlsxBytes } from "./xlsx_writer.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "samples");
fs.mkdirSync(out, { recursive: true });

// 1. Same fictitious supplier, two months. Old list: CSV exported from Excel in French (; and decimal comma),
//    with a title block above the header like many real price lists.
const oldCsv = [
  "Grossiste Exemple SPRL (fictif);;;;",
  "Tarif professionnel - janvier 2026 - prix HT;;;;",
  ";;;;",
  "Réf.;Désignation;Conditionnement;EAN;Prix HT",
  "FAR-055;Farine de blé T55;25 kg;5400000000010;18,90 €",
  "SUC-001;Sucre semoule;10 x 1 kg;5400000000027;12,40 €",
  "HUI-005;Huile de tournesol;5 L;5400000000034;11,75 €",
  "PAT-500;Pâtes penne;12 x 500 g;5400000000041;9,00 €",
  "TOM-410;Tomates concassées;6 x 2,5 kg;5400000000058;21,30 €",
  "CAF-100;Café grains;6 x 1 kg;5400000000065;89,00 €",
  "SEL-010;Sel fin;10 kg;5400000000072;4,20 €",
  "LAI-001;Lait UHT demi-écrémé;6 x 1 L;5400000000089;6,90 €",
  "BEU-250;Beurre doux;40 x 250 g;5400000000096;78,00 €",
  "RIZ-005;Riz basmati;5 kg;5400000000102;14,50 €",
  "VIN-075;Vinaigre de vin;6 x 75 cl;5400000000119;8,40 €",
  "CHO-001;Chocolat de couverture 64 %;5 kg;5400000000126;62,00 €",
].join("\r\n") + "\r\n";
fs.writeFileSync(path.join(out, "fournisseur-janvier.csv"), oldCsv, "utf8");

// New list: the supplier now sends Excel, in another column order, with a few traps.
const newRows = [
  ["Grossiste Exemple SPRL (fictif) - Tarif février 2026"],
  [],
  ["EAN", "Réf.", "Désignation", "Prix HT", "Conditionnement"],
  [5400000000010, "FAR-055", "Farine de blé T55", 19.85, "25 kg"],          // +5.0 %
  [5400000000027, "SUC-001", "Sucre semoule", 12.40, "10 x 1 kg"],         // same
  [5400000000034, "HUI-005", "Huile de tournesol", 13.20, "5 L"],          // +12.3 %
  [5400000000041, "PAT-500", "Pâtes penne", 9.00, "10 x 500 g"],           // hidden: same price, smaller pack (+20 %/kg)
  [5400000000058, "TOM-410", "Tomates concassées", 20.10, "6 x 2,5 kg"],   // -5.6 %
  [5400000000065, "CAF-100", "Café grains", 96.50, "6 x 1 kg"],            // +8.4 %
  [5400000000072, "SEL-010", "Sel fin", 4.20, "10 kg"],                    // same
  [5400000000089, "LAI-001", "Lait UHT demi-écrémé", 7.25, "6 x 1 L"],     // +5.1 %
  [5400000000096, "BEU-250", "Beurre doux", 81.00, "40 x 250 g"],          // +3.8 %
  [5400000000102, "RIZ-005", "Riz basmati", 14.50, "5 kg"],                // same
  [5400000000133, "MOU-002", "Moutarde de Dijon", 15.60, "6 x 1 kg"],      // new
  [5400000000126, "CHO-001", "Chocolat de couverture 64 %", "sur demande", "5 kg"], // unreadable price
  // VIN-075 removed from the range
];
fs.writeFileSync(path.join(out, "fournisseur-fevrier.xlsx"), xlsxBytes(newRows, "Février 2026"));

// 2. Three fictitious suppliers for the comparison, matched on EAN, different pack sizes.
const a = [
  ["EAN", "Article", "Description", "Pack", "Price"],
  ["5400000000010", "A-1", "Wheat flour T55", "25 kg", "18.90"],
  ["5400000000034", "A-2", "Sunflower oil", "5 l", "11.75"],
  ["5400000000041", "A-3", "Penne pasta", "12 x 500 g", "9.00"],
  ["5400000000065", "A-4", "Coffee beans", "6 x 1 kg", "89.00"],
  ["5400000000089", "A-5", "UHT milk", "6 x 1 l", "6.90"],
  ["5400000000102", "A-6", "Basmati rice", "5 kg", "14.50"],
];
fs.writeFileSync(path.join(out, "supplier-a.csv"), a.map((r) => r.join(",")).join("\n") + "\n", "utf8");
const b = [
  ["GTIN", "Artikelnr", "Omschrijving", "Verpakking", "Prijs"],
  ["05400000000010", "B-10", "Bloem T55", "10 kg", "7,40"],
  ["05400000000034", "B-11", "Zonnebloemolie", "10 l", "22,00"],
  ["05400000000041", "B-12", "Penne", "20 x 500 g", "14,20"],
  ["05400000000065", "B-13", "Koffiebonen", "1 kg", "15,90"],
  ["05400000000102", "B-14", "Basmatirijst", "10 kg", "30,50"],
  ["05400000000140", "B-15", "Rietsuiker", "5 kg", "9,80"],
];
fs.writeFileSync(path.join(out, "supplier-b.csv"), b.map((r) => r.join(";")).join("\n") + "\n", "utf8");
const c = [
  ["Code-barres", "Réf", "Libellé", "Colisage", "Prix net"],
  [5400000000010, "C-7", "Farine T55", "25 kg", 19.40],
  [5400000000034, "C-8", "Huile tournesol", "5 L", 10.95],
  [5400000000065, "C-9", "Café en grains", "6 x 1 kg", 92.00],
  [5400000000089, "C-10", "Lait UHT", "6 x 1 L", 6.60],
  [5400000000102, "C-11", "Riz basmati", "5 kg", 13.90],
];
fs.writeFileSync(path.join(out, "supplier-c.xlsx"), xlsxBytes(c, "Prix"));
fs.writeFileSync(path.join(out, "README.txt"),
  "Fichiers d'exemple FICTIFS (fournisseurs, références, EAN et prix inventés) pour essayer CostDiff.\r\n" +
  "Les EAN 54000000000xx ne correspondent à aucun produit réel.\r\n", "utf8");
console.log("samples written to", out);
