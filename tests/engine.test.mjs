import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePrice, detectDecimal, countAmbiguous } from "../web/js/numbers.js";
import { parseCSV, detectDelimiter, toCSV } from "../web/js/csv.js";
import { parsePack } from "../web/js/pack.js";
import { detectHeaderRow, guessMapping } from "../web/js/columns.js";
import { buildList, diffLists, compareSuppliers, normKey } from "../web/js/engine.js";
import { readXlsx } from "../web/js/xlsx.js";
import { loadTable, listMapping, LoadError } from "../web/js/load.js";
import { xlsxBytes } from "../scripts/xlsx_writer.mjs";

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "samples");
const buf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

test("prices: European, US, currency signs, garbage", () => {
  assert.equal(parsePrice("1.234,56 €", ","), 1234.56);
  assert.equal(parsePrice("$1,234.56", "."), 1234.56);
  assert.equal(parsePrice("12,5", "."), 12.5);          // lone comma that does not group by 3: decimal
  assert.equal(parsePrice("1,234", "."), 1234);          // groups by 3 in a dot column: thousands
  assert.equal(parsePrice("3.20", ","), 3.2);
  assert.equal(parsePrice("EUR 18,90 HT", ","), 18.9);
  assert.equal(parsePrice("(4,00)", ","), -4);
  assert.equal(parsePrice(19.85), 19.85);
  for (const bad of ["sur demande", "", null, "1,2,3,4.5.6", "n/a", "12 kg"]) assert.equal(parsePrice(bad, ","), null, String(bad));
  assert.equal(detectDecimal(["18,90 €", "12,40 €", "1.234,00"]), ",");
  assert.equal(detectDecimal(["18.90", "12.40", 3]), ".");
});

test("3-decimal prices are never read as thousands (reviewer finding 22/11)", () => {
  assert.deepEqual(["0.125", "1.250", "2.375", "0.990"].map((v) => parsePrice(v, detectDecimal(["0.125", "1.250", "2.375", "0.990"]))), [0.125, 1.25, 2.375, 0.99]);
  assert.deepEqual(["0,125", "1,250", "2,375"].map((v) => parsePrice(v, detectDecimal(["0,125", "1,250", "2,375"]))), [0.125, 1.25, 2.375]);
  assert.equal(detectDecimal(["1.250", "1.5"]), ".");           // ambiguous values do not vote
  assert.equal(parsePrice("1.250", "."), 1.25);
  assert.equal(parsePrice("1.250", ","), 1250);                 // in a "," column the dot groups thousands
  assert.equal(parsePrice("1.234.567", ","), 1234567);
  assert.equal(parsePrice("1,23.45", "."), null);               // malformed: refused, not guessed
  assert.equal(countAmbiguous(["1.250", "0.5", "1,000", 3]), 2);
  assert.equal(detectDecimal(["1,250", "2,375", 4]), null);     // nothing decides: the caller chooses
});

test("a price column with only ambiguous values takes the other list's separator (reviewer finding)", () => {
  const m = { key: 0, keyRole: "sku", name: -1, price: 1, pack: -1 };
  const oldL = buildList([["A", "1,250"], ["B", "2,375"]], m);
  const newL = buildList([["A", "1,300"], ["B", "12,50"]], m);
  assert.equal(oldL.stats.decimalSource, "défaut");
  assert.equal(newL.stats.decimal, ",");
  const fixed = buildList([["A", "1,250"], ["B", "2,375"]], { ...m, decimalHint: newL.stats.decimal });
  assert.deepEqual([...fixed.items.values()].map((i) => i.price), [1.25, 2.375]);
  assert.equal(fixed.stats.decimalSource, "autre fichier");
  assert.equal(fixed.stats.ambiguousExample, "1,250");
  const ups = diffLists(fixed, newL).changes.map((c) => c.effectivePct);
  assert.ok(ups.every((p) => Math.abs(p) < 500), String(ups)); // no fake -99.9 % from mixed readings
  // an all-ambiguous "1.250" column with no other evidence: default "," -> the dot groups thousands
  assert.equal([...buildList([["A", "1.250"]], m).items.values()][0].price, 1250);
});

test("csv: delimiter detection, quotes, BOM, empty lines", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2,5;3\n"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2\n"), "\t");
  const rows = parseCSV('﻿ref,name,price\r\n"A-1","Flour, ""T55""",1.5\r\n\r\nB,"multi\nline",2\n');
  assert.deepEqual(rows, [["ref", "name", "price"], ["A-1", 'Flour, "T55"', "1.5"], [], ["B", "multi\nline", "2"]]); // blank line kept as []
});

test("csv export neutralises spreadsheet formulas but keeps negative numbers", () => {
  const out = toCSV([["=HYPERLINK(\"x\")", "-3.5", "@SUM(A1)", "a,b"]]);
  assert.equal(out, `"'=HYPERLINK(""x"")",-3.5,'@SUM(A1),"a,b"\r\n`);
});

test("pack sizes", () => {
  assert.deepEqual(parsePack("12 x 500 g"), { amount: 6, unit: "kg" });
  assert.deepEqual(parsePack("6x1L"), { amount: 6, unit: "l" });
  assert.deepEqual(parsePack("4 x 6 x 33 cl"), { amount: 7.92, unit: "l" });
  assert.deepEqual(parsePack("2,5 kg"), { amount: 2.5, unit: "kg" });
  assert.deepEqual(parsePack("1 l x 6"), { amount: 6, unit: "l" });
  assert.deepEqual(parsePack("carton de 24"), { amount: 24, unit: "pc" });
  assert.deepEqual(parsePack("24 pcs"), { amount: 24, unit: "pc" });
  assert.deepEqual(parsePack("Farine T55 25 kg"), { amount: 25, unit: "kg" });
  assert.deepEqual(parsePack(12), { amount: 12, unit: "pc" });
  assert.equal(parsePack("Chocolat noir"), null);
  assert.equal(parsePack("0 kg"), null);
});

test("header row below a title block, and columns guessed in FR / NL / EN", () => {
  const rows = [["Grossiste (fictif)"], ["Tarif janvier"], [], ["Réf.", "Désignation", "Conditionnement", "EAN", "Prix HT"], ["A", "B", "25 kg", "540", "1,00"]]
    .filter((r) => r.length);
  const h = detectHeaderRow(rows);
  assert.deepEqual(rows[h], ["Réf.", "Désignation", "Conditionnement", "EAN", "Prix HT"]);
  assert.deepEqual(guessMapping(rows[h], rows.slice(h + 1)), { sku: 0, ean: 3, name: 1, price: 4, pack: 2 });
  assert.deepEqual(guessMapping(["GTIN", "Artikelnr", "Omschrijving", "Verpakking", "Prijs"]), { sku: 1, ean: 0, name: 2, price: 4, pack: 3 });
  assert.deepEqual(guessMapping(["Item code", "Description", "Unit price", "Pack size"]), { sku: 0, ean: -1, name: 1, price: 2, pack: 3 });
  assert.deepEqual(guessMapping(["Artikelnummer", "Bezeichnung", "Verpackung", "Einkaufspreis"]), { sku: 0, ean: -1, name: 1, price: 3, pack: 2 });
});

test("EAN keys match across EAN-13, GTIN-14 and Excel numbers", () => {
  assert.equal(normKey("05400000000017", "ean"), normKey(5400000000017, "ean"));
  assert.equal(normKey(" fa r-055 ", "sku"), "FAR-055");
  assert.equal(normKey("00123", "sku"), normKey(123, "sku")); // Excel drops leading zeros of numeric references
  assert.equal(normKey("0", "sku"), "0");
});

test("list building reports duplicates, unreadable prices and missing keys instead of guessing", () => {
  const rows = [["A", "Flour 25 kg", "10,00"], ["A", "Flour again", "11,00"], ["B", "Sugar", "sur demande"], ["", "No ref", "3,00"], ["", "", ""]];
  const l = buildList(rows, { key: 0, keyRole: "sku", name: 1, price: 2, pack: -1, firstDataLine: 2 }, "f");
  assert.equal(l.items.size, 1);
  assert.deepEqual(l.items.get("A").pack, { amount: 25, unit: "kg" }); // pack read from the name
  assert.deepEqual(l.issues.map((i) => [i.type, i.line]), [["duplicate", 3], ["bad-price", 4], ["missing-key", 5]]);
  assert.throws(() => buildList(rows, { key: -1, price: 2 }), /colonne qui identifie/);
});

test("price changes: increase, decrease, new, removed, and a hidden increase through a smaller pack", () => {
  const m = { key: 0, keyRole: "sku", name: 1, price: 2, pack: 3 };
  const oldL = buildList([["P", "Pasta", "9.00", "12 x 500 g"], ["F", "Flour", "18.90", "25 kg"], ["T", "Tomato", "21.30", "6 x 2.5 kg"], ["V", "Vinegar", "8.40", "6 x 75 cl"], ["S", "Salt", "4.20", "10 kg"]], m);
  const newL = buildList([["P", "Pasta", "9.00", "10 x 500 g"], ["F", "Flour", "19.85", "25 kg"], ["T", "Tomato", "20.10", "6 x 2.5 kg"], ["S", "Salt", "4.20", "10 kg"], ["M", "Mustard", "15.60", "6 x 1 kg"]], m);
  const { changes, summary } = diffLists(oldL, newL);
  const by = Object.fromEntries(changes.map((c) => [c.key, c]));
  assert.equal(by.P.status, "up");
  assert.equal(by.P.hidden, true);
  assert.equal(by.P.pct, 0);
  assert.equal(by.P.unitPct, 20);
  assert.equal(by.F.status, "up"); assert.equal(by.F.pct, 5.03);
  assert.equal(by.T.status, "down");
  assert.equal(by.S.status, "same");
  assert.equal(by.M.status, "new");
  assert.equal(by.V.status, "removed");
  assert.deepEqual([summary.up, summary.down, summary.same, summary.new, summary.removed, summary.hidden], [2, 1, 1, 1, 1, 1]);
  assert.equal(changes[0].key, "P"); // biggest effective increase first
  // a threshold hides small moves
  assert.equal(diffLists(oldL, newL, { threshold: 10 }).summary.up, 1);
});

test("a pack read from a reworded name is flagged 'to check', not reported as a hidden increase", () => {
  const m = { key: 0, keyRole: "sku", name: 1, price: 2, pack: -1 };
  const oldL = buildList([["P", "Pasta 12 x 500 g", "9.00"], ["Q", "Rice 5 kg", "10.00"]], m);
  const newL = buildList([["P", "Pasta 500 g", "9.00"], ["Q", "Rice 4 kg", "10.00"]], m);
  const by = Object.fromEntries(diffLists(oldL, newL).changes.map((c) => [c.key, c]));
  assert.equal(by.P.packCheck, true);
  assert.equal(by.P.hidden, false);
  assert.equal(by.P.status, "same");   // price itself did not move
  assert.equal(by.Q.packCheck, false); // 5 kg -> 4 kg is plausible: a real hidden increase (+25 %/kg)
  assert.equal(by.Q.hidden, true);
  assert.equal(by.Q.unitPct, 25);
});

test("xlsx: styled empty cells at the end of a row do not create columns", async () => {
  const bytes = xlsxBytes([["Ref", "Prix", "", "", ""], ["A", 1, "", " ", ""]]);
  const wb = await readXlsx(buf(bytes));
  assert.deepEqual(wb.rows, [["Ref", "Prix"], ["A", 1]]);
});

test("supplier comparison per kg / l when every offer has a pack size, otherwise per line", () => {
  const m = { key: 0, keyRole: "ean", name: 1, price: 2, pack: 3 };
  const a = buildList([["5400000000017", "Flour", "18.90", "25 kg"], ["5400000000062", "Coffee", "89.00", "6 x 1 kg"], ["111", "Thing", "5", ""]], m);
  const b = buildList([["05400000000017", "Bloem", "7.40", "10 kg"], ["05400000000062", "Koffie", "15.90", "1 kg"], ["111", "Thing", "4", ""]], m);
  const r = compareSuppliers([{ label: "A", list: a }, { label: "B", list: b }]);
  const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
  assert.equal(by["5400000000017"].best, "B");   // 0.74/kg vs 0.756/kg
  assert.equal(by["5400000000017"].basis, "par kg");
  assert.equal(by["5400000000062"].best, "A");   // 14.83/kg vs 15.90/kg
  assert.equal(by["111"].basis, "par ligne");
  assert.equal(by["111"].best, "B");
  assert.throws(() => compareSuppliers([{ label: "A", list: a }]), /au moins deux/);
});

test("xlsx reader: shared strings, numbers, sparse cells, sheet name", async () => {
  const bytes = xlsxBytes([["Titre"], [], ["EAN", "Réf.", "Prix & co <HT>"], [5400000000017, "FAR-055", 19.85], [null, "X", 1]], "Février");
  const wb = await readXlsx(buf(bytes));
  assert.equal(wb.sheet, "Février");
  assert.deepEqual(wb.rows, [["Titre"], [], ["EAN", "Réf.", "Prix & co <HT>"], [5400000000017, "FAR-055", 19.85], ["", "X", 1]]);
});

test("loader rejects PDFs, old .xls, empty and broken files with a clear message", async () => {
  await assert.rejects(loadTable("tarif.pdf", buf(Buffer.from("%PDF-1.7 ..."))), (e) => e instanceof LoadError && /PDF/.test(e.message));
  await assert.rejects(loadTable("tarif.xls", buf(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))), /ancien fichier Excel/);
  await assert.rejects(loadTable("vide.csv", new ArrayBuffer(0)), /vide/);
  await assert.rejects(loadTable("casse.xlsx", buf(Buffer.from("PK\u0003\u0004 not really a zip"))), /Excel|xlsx/);
  await assert.rejects(loadTable("titres.csv", buf(Buffer.from("Réf;Prix\n"))), /aucune ligne de produit/);
});

test("end to end on the fictitious samples: January CSV vs February Excel", async () => {
  const oldT = await loadTable("fournisseur-janvier.csv", buf(fs.readFileSync(path.join(SAMPLES, "fournisseur-janvier.csv"))));
  const newT = await loadTable("fournisseur-fevrier.xlsx", buf(fs.readFileSync(path.join(SAMPLES, "fournisseur-fevrier.xlsx"))));
  assert.equal(oldT.headers[0], "Réf.");
  assert.equal(oldT.headerLine, 4); // title block + blank line above the header: the real file line
  assert.equal(newT.headerLine, 3); // Excel row 3 (row 2 is empty)
  assert.equal(newT.headers[0], "EAN");
  const oldL = buildList(oldT.data, listMapping(oldT, oldT.mapping), "janvier");
  const newL = buildList(newT.data, listMapping(newT, newT.mapping), "février");
  const { summary, changes } = diffLists(oldL, newL);
  assert.deepEqual([summary.up, summary.down, summary.same, summary.new, summary.removed, summary.hidden], [6, 1, 3, 1, 2, 1]);
  assert.equal(changes[0].key, "PAT-500");
  assert.deepEqual(newL.issues.map((i) => [i.type, i.line]), [["bad-price", 15]]); // Excel row 15 // chocolate "sur demande": reported, not invented
});

test("end to end: three fictitious suppliers matched on EAN", async () => {
  const lists = [];
  for (const f of ["supplier-a.csv", "supplier-b.csv", "supplier-c.xlsx"]) {
    const t = await loadTable(f, buf(fs.readFileSync(path.join(SAMPLES, f))));
    lists.push({ label: f, list: buildList(t.data, listMapping(t, { ...t.mapping, keyRole: "ean" }), f) });
  }
  const r = compareSuppliers(lists);
  const flour = r.rows.find((x) => x.key === "5400000000017");
  assert.equal(flour.count, 3);
  assert.equal(flour.best, "supplier-b.csv"); // 0.74/kg vs 0.756 and 0.776
  assert.equal(r.summary.onlyOne, 1);         // cane sugar only at B
});

// Realistic supplier formats checked on 24/11 (see docs/LIMITES.md)
const csvBuf = (s, cp1252 = false) => {
  const b = cp1252 ? Uint8Array.from([...s].map((c) => (c === "€" ? 0x80 : c.charCodeAt(0) & 255))) : new TextEncoder().encode(s);
  return b.buffer;
};
async function diffCsv(a, b, cp1252 = false) {
  const A = await loadTable("old.csv", csvBuf(a, cp1252)), B = await loadTable("new.csv", csvBuf(b, cp1252));
  const la = buildList(A.data, listMapping(A, A.mapping), "old"), lb = buildList(B.data, listMapping(B, B.mapping), "new");
  return { la, lb, ...diffLists(la, lb) };
}

test("formats: Excel FR export (Windows-1252, title lines, € and thousands) finds the hidden increase", async () => {
  const head = "Tarif Grossiste 2026\nValable au 01/01/2026\n\nRéf.;Désignation;Conditionnement;Prix HT\n";
  const r = await diffCsv(head + "A100;Pâtes;12 x 500 g;24,00 €\nA200;Huile;6 x 1 L;1.234,56 €\n",
    head + "A100;Pâtes;10 x 500 g;24,00 €\nA200;Huile;6 x 1 L;1.250,00 €\n", true);
  const byKey = Object.fromEntries(r.changes.map((c) => [c.key, c]));
  assert.equal(byKey.A100.hidden, true);
  assert.equal(byKey.A100.effectivePct, 20);
  assert.equal(byKey.A200.newPrice, 1250);
});





test("formats: Dutch tab export and leading zeros vs. Excel numbers", async () => {
  const nl = await diffCsv("Artikelnr\tOmschrijving\tVerpakking\tPrijs excl. btw\n1001\tMelk\t6x1L\t5,40\n", "Artikelnr\tOmschrijving\tVerpakking\tPrijs excl. btw\n1001\tMelk\t6x1L\t5,70\n");
  assert.equal(nl.changes[0].status, "up");
  const z = await diffCsv('Code;Libellé;Prix\n00123;"Vis; tête plate";12,50\n', 'Code;Libellé;Prix\n123;"Vis; tête plate";13,10\n');
  assert.equal(z.changes.length, 1);
  assert.equal(z.changes[0].key, "123");
});

test("formats: known limits stay visible (gross price + discount column, TOTAL row)", async () => {
  // the discount column is not applied: a 30% -> 25% discount change is NOT detected (documented limit)
  const d = await diffCsv("Réf;Désignation;Prix brut;Remise %\nR1;A;100,00;30\n", "Réf;Désignation;Prix brut;Remise %\nR1;A;100,00;25\n");
  assert.equal(d.changes[0].status, "same");
  // a TOTAL line is read as a product (documented limit)
  const t = await diffCsv("SKU,Item,Unit price\nX1,W,10.00\nTOTAL,,10.00\n", "SKU,Item,Unit price\nX1,W,11.00\n");
  assert.ok(t.changes.some((c) => c.key === "TOTAL" && c.status === "removed"));
});

test("formats: French 'Article' column holding product names is the name, and EAN becomes the key", () => {
  const m = guessMapping(["EAN", "Article", "Conditionnement", "Prix HT"],
    [["5400000000017", "Bière blonde pils", "24 x 25 cl", 18.9], ["5400000000055", "Cola", "24 x 33 cl", 19.8], ["5400000000031", "Eau plate", "24 x 50 cl", 9.6]]);
  assert.equal(m.name, 1);
  assert.equal(m.sku, -1);
  assert.equal(m.ean, 0);
  // a real reference column titled "Article" keeps its role
  const r = guessMapping(["Article", "Désignation", "Prix"], [["VIS-440", "Vis inox", "8,40"], ["CHV-08", "Chevilles", "4,90"]]);
  assert.equal(r.sku, 0);
  assert.equal(r.name, 1);
});
