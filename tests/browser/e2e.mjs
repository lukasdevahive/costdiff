// Real-browser test of CostDiff: drives the locally installed Google Chrome with playwright-core.
// Prerequisite: the server is running (npm start). Usage: node tests/browser/e2e.mjs [--headed]
// Writes screenshots to docs/screens/ and fails (exit 1) on any failed check.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xlsxBytes } from "../../scripts/xlsx_writer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.join(HERE, "..", "..", "docs", "screens");
const IMG = path.join(HERE, "..", "..", "web", "img");
const BASE = process.env.COSTDIFF_URL || "http://127.0.0.1:8765";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SCREENS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// fresh, different data than the samples: a generated 5,000-line supplier list, two months
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "costdiff-e2e-"));
const N = 5000;
const oldRows = [["Item code", "Description", "Unit price", "Pack size"]];
const newRows = [["Description", "Item code", "Pack size", "Net price"]];
let expectUp = 0, expectHidden = 0;
for (let i = 0; i < N; i++) {
  const code = `X${String(i).padStart(5, "0")}`, price = 2 + (i % 97) * 0.37, pack = `${6 + (i % 4) * 6} x 250 g`;
  oldRows.push([code, `Product ${i}`, price.toFixed(2), pack]);
  if (i % 50 === 0) continue; // removed
  let np = price, npack = pack;
  if (i % 7 === 0) { np = price * 1.06; expectUp++; }
  else if (i % 101 === 0) { npack = `${6 + (i % 4) * 6 - 2} x 250 g`; expectHidden++; expectUp++; }
  newRows.push([`Product ${i}`, code, npack, Number(np.toFixed(2))]);
}
fs.writeFileSync(path.join(tmp, "acme-2026-01.csv"), oldRows.map((r) => r.join(",")).join("\n"));
fs.writeFileSync(path.join(tmp, "acme-2026-02.xlsx"), xlsxBytes(newRows));
fs.writeFileSync(path.join(tmp, "tarif.pdf"), "%PDF-1.7\n1 0 obj\n");
fs.writeFileSync(path.join(tmp, "other-supplier.csv"), "ref;prix\nZZ-1;3,00\nZZ-2;4,00\n");

const browser = await chromium.launch({ executablePath: CHROME, headless: !process.argv.includes("--headed") });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, locale: "fr-BE" });
const page = await context.newPage();
const errors = [], requests = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("request", (r) => requests.push(r.url()));

try {
  // 1. landing
  await page.goto(`${BASE}/index.html`);
  check("landing: value proposition visible", await page.getByRole("heading", { level: 1 }).textContent().then((t) => /tarif fournisseur/.test(t)));
  await page.screenshot({ path: path.join(SCREENS, "01-landing-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "Essayer avec vos fichiers" }).click();
  await page.waitForURL(/app\.html/);
  check("landing -> app link works", page.url().endsWith("/app.html"));

  // 2. sample diff, opened from the landing page's demo link
  await page.goto(`${BASE}/index.html`);
  await page.getByRole("link", { name: "ou avec des exemples fictifs" }).click();
  await page.waitForURL(/demo=1/);
  await page.locator(".mapping").nth(1).waitFor();
  check("samples loaded with detected header rows", (await page.locator(".mapping-head").first().textContent()).includes("en-têtes ligne 4"));
  await page.getByRole("button", { name: "Comparer les deux listes" }).click();
  await page.locator(".cards").first().waitFor();
  const nums = await page.locator("#result-diff .card .n").allTextContents();
  check("sample diff: 6 up, 1 hidden, 1 down, 1 new, 2 removed, 3 same", nums.join(",") === "6,1,1,1,2,3", nums.join(","));
  const firstRow = await page.locator("#result-diff table.result tbody tr").first().textContent();
  check("hidden increase listed first (pasta, +20 %/kg)", /Hausse cachée.*PAT-500.*\+20\s?%/.test(firstRow.replace(/\s+/g, " ")), firstRow.replace(/\s+/g, " ").slice(0, 120));
  check("unreadable price reported, not invented", (await page.locator("#result-diff .issues summary").textContent()).includes("1 point"));
  await page.screenshot({ path: path.join(SCREENS, "02-diff-sample.png"), fullPage: true });
  await page.locator("#result-diff").screenshot({ path: path.join(IMG, "app-diff.png") });
  await page.getByRole("button", { name: "Retirés" }).click();
  check("filter 'Retirés' shows 2 rows", (await page.locator("#result-diff table.result tbody tr").count()) === 2);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Exporter le rapport/ }).click()]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  check("CSV export: header + 13 products (11 in February + 2 removed)", csv.trim().split(/\r?\n/).length === 14, `${csv.trim().split(/\r?\n/).length} lines`);
  check("CSV export marks the hidden increase", /PAT-500.*;oui/.test(csv));

  // 3. other data: 5,000-line generated lists, other column names, CSV vs XLSX
  await page.reload();
  await page.locator('[data-input="old"]').setInputFiles(path.join(tmp, "acme-2026-01.csv"));
  await page.locator('[data-info="old"]').filter({ hasText: "5000 lignes" }).waitFor();
  await page.locator('[data-input="new"]').setInputFiles(path.join(tmp, "acme-2026-02.xlsx"));
  await page.locator('[data-info="new"]').filter({ hasText: "lignes" }).waitFor();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Comparer les deux listes" }).click();
  await page.locator("#result-diff .cards").waitFor();
  const ms = Date.now() - t0;
  const big = await page.locator("#result-diff .card .n").allTextContents();
  check(`5,000 lines: ${expectUp} up incl. ${expectHidden} hidden, 100 removed`, big[0] === String(expectUp) && big[1] === String(expectHidden) && big[4] === "100", big.join(","));
  check("5,000 lines compared in under 3 s (click to result)", ms < 3000, `${ms} ms`);
  check("long tables are paged (300 rows first)", (await page.locator("#result-diff table.result tbody tr").count()) <= 300);

  // 4. errors and edge cases
  await page.locator('[data-input="old"]').setInputFiles(path.join(tmp, "tarif.pdf"));
  check("PDF refused with a clear message", await page.locator("#error-diff", { hasText: "PDF" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.locator('[data-input="old"]').setInputFiles(path.join(tmp, "other-supplier.csv"));
  await page.locator('[data-info="old"]').filter({ hasText: "other-supplier" }).waitFor();
  await page.getByRole("button", { name: "Comparer les deux listes" }).click();
  check("no common product: explained, no fake result", await page.locator("#error-diff", { hasText: "Aucun produit commun" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  // remove the price column from the mapping -> explicit message
  await page.locator(".mapping").first().locator(".mapping-grid select").nth(3).selectOption("-1"); // price column
  await page.getByRole("button", { name: "Comparer les deux listes" }).click();
  check("missing price column: explicit message", await page.locator("#error-diff", { hasText: "colonne du prix" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.screenshot({ path: path.join(SCREENS, "03-diff-error.png") });

  // 5. supplier comparison
  await page.getByRole("tab", { name: "Comparer des fournisseurs" }).click();
  await page.getByRole("button", { name: /trois fournisseurs fictifs/ }).click();
  await page.locator("#mapping-compare .mapping").nth(2).waitFor();
  await page.getByRole("button", { name: "Comparer les fournisseurs" }).click();
  await page.locator("#result-compare table.result").waitFor();
  const flour = (await page.locator("#result-compare tbody tr", { hasText: "5400000000010" }).locator("td.best").textContent()) || "";
  check("cheapest flour per kg is supplier B (7,40 € / 10 kg)", flour.includes("7,40"), flour);
  await page.screenshot({ path: path.join(SCREENS, "04-compare-sample.png"), fullPage: true });
  const visible = await page.locator("main").innerText();
  check("no 'null', 'undefined' or 'NaN' rendered in the page", !/\b(null|undefined|NaN)\b/.test(visible));

  // 6. mobile
  const mobile = await context.newPage();
  mobile.on("pageerror", (e) => errors.push(`pageerror (mobile): ${e.message}`));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${BASE}/index.html`);
  const overflowLanding = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await mobile.screenshot({ path: path.join(SCREENS, "05-landing-mobile.png"), fullPage: true });
  await mobile.goto(`${BASE}/app.html`);
  await mobile.getByRole("tab", { name: /Hausses de prix/ }).click(); // the app remembers the last tab (compare)
  await mobile.getByRole("button", { name: /deux listes d'exemple/ }).click();
  await mobile.locator(".mapping").nth(1).waitFor();
  await mobile.getByRole("button", { name: "Comparer les deux listes" }).click();
  await mobile.locator("#result-diff .cards").waitFor();
  const overflowApp = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await mobile.screenshot({ path: path.join(SCREENS, "06-app-mobile.png"), fullPage: true });
  check("mobile 390 px: no horizontal page scroll (landing, app)", overflowLanding <= 0 && overflowApp <= 0, `${overflowLanding}px / ${overflowApp}px`);

  // 7. privacy: nothing leaves the machine
  const foreign = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith("blob:") && !u.startsWith("data:"));
  check("network: only requests to the local server (files never uploaded)", foreign.length === 0, foreign.slice(0, 3).join(" "));
  check("no JavaScript error or console error", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("test run completed without exception", false, e.message.split("\n")[0]);
  await page.screenshot({ path: path.join(SCREENS, "zz-failure.png") }).catch(() => {});
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(SCREENS, "e2e-result.json"), JSON.stringify({ date: new Date().toISOString(), browser: CHROME, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
