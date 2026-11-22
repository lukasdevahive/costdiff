// Real-browser proof of what the usage statistics send. The local site is served to Chrome as if it were the public
// host, with a test GoatCounter code; every request to goatcounter.com is intercepted (never sent) and inspected.
// Prerequisite: the server is running (npm start). Usage: node tests/browser/stats-e2e.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cspFor } from "../../scripts/configure.mjs";

const LOCAL = process.env.COSTDIFF_URL || "http://127.0.0.1:8765";
const PUBLIC = "https://lukasdevahive.github.io/costdiff";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CODE = "costdiff-test";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// "own" files with recognisable secrets: none of these strings may appear in any statistics request
const SECRETS = ["fournisseur-secret", "5412345678901", "REF-CONFIDENTIEL", "Jambon Ardenne", "17,35", "17.35", "19,10"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "costdiff-stats-"));
fs.writeFileSync(path.join(tmp, "fournisseur-secret-janvier.csv"), "Référence;EAN;Désignation;Prix\nREF-CONFIDENTIEL;5412345678901;Jambon Ardenne 6 x 1 kg;17,35\nREF-2;5412345678902;Pâté 12 x 200 g;9,80\n");
fs.writeFileSync(path.join(tmp, "fournisseur-secret-fevrier.csv"), "Référence;EAN;Désignation;Prix\nREF-CONFIDENTIEL;5412345678901;Jambon Ardenne 6 x 1 kg;19,10\nREF-2;5412345678902;Pâté 12 x 200 g;9,80\n");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ acceptDownloads: true, locale: "fr-BE" });
await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const sent = [], foreign = [];
await context.route("**/*", async (route) => {
  const url = route.request().url();
  if (url.includes(".goatcounter.com/")) { sent.push(url); await route.fulfill({ status: 200, contentType: "image/gif", body: "" }); return; }
  if (!url.startsWith(PUBLIC)) { if (!url.startsWith("data:") && !url.startsWith("blob:")) foreign.push(url); await route.abort(); return; }
  const local = LOCAL + url.slice(PUBLIC.length).replace(/[?#].*$/, "").replace(/\/$/, "/index.html");
  const r = await fetch(local);
  let body = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get("content-type") || "";
  if (local.endsWith("/js/config.js")) body = Buffer.from(body.toString().replace(/export const GOATCOUNTER = "[^"]*";/, `export const GOATCOUNTER = "${CODE}";`));
  if (type.startsWith("text/html")) body = Buffer.from(body.toString().replace(/content="default-src[^"]*"/, `content="${cspFor(CODE)}"`));
  await route.fulfill({ status: r.status, contentType: type, body });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const events = () => sent.map((u) => new URL(u)).filter((u) => u.searchParams.get("e") === "true").map((u) => u.searchParams.get("p"));
const views = () => sent.map((u) => new URL(u)).filter((u) => u.searchParams.get("e") !== "true").map((u) => u.searchParams.get("p"));
const settle = () => page.waitForTimeout(400);

try {
  await page.goto(`${PUBLIC}/?utm_source=Forum-Test&utm_campaign=lancement&email=x@y.z`);
  await settle();
  check("landing view counted with campaign, without other parameters", views().includes("/") && sent.some((u) => /q=%3Futm_campaign%3Dlancement%26utm_source%3Dforum-test/.test(u)) && !sent.some((u) => u.includes("x%40y")), sent[0]);

  await page.click('a[href="app.html"] >> nth=0');
  await page.waitForURL(/app\.html/);
  await settle();
  check("app opening counted as a page view", views().includes("/app.html"));

  await page.locator('[data-input="old"]').setInputFiles(path.join(tmp, "fournisseur-secret-janvier.csv"));
  await page.locator('[data-input="new"]').setInputFiles(path.join(tmp, "fournisseur-secret-fevrier.csv"));
  await page.locator("#run-diff:not([disabled])").waitFor();
  await page.click("#run-diff");
  await page.waitForSelector("#result-diff .cards");
  const dl = page.waitForEvent("download");
  await page.click("#result-diff button.secondary");
  await dl;
  await settle();
  const ev = events();
  check("own files: 2 'file read', 1 'comparison done', 1 'export'", ev.filter((e) => e === "file-own-ok").length === 2 && ev.includes("diff-done-own") && ev.includes("export-diff-own"), ev.join(","));

  await page.click("#sample-diff");
  // the button is still enabled by the previous files: wait until both samples have replaced them
  await page.locator('[data-info="old"]', { hasText: "fournisseur-janvier.csv" }).waitFor();
  await page.locator('[data-info="new"]', { hasText: "fournisseur-fevrier.xlsx" }).waitFor();
  await page.locator("#run-diff:not([disabled])").waitFor();
  await page.click("#run-diff");
  await settle();
  check("samples counted separately from own files", events().includes("sample-loaded") && events().includes("diff-done-sample"));

  await page.locator('[data-input="old"]').setInputFiles({ name: "fournisseur-secret.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
  await settle();
  check("refused file counted without its name", events().includes("file-own-error"));

  await page.click('a[href="pro.html"]');
  await page.waitForURL(/pro\.html/);
  await settle();
  check("no survey configured: its button, texts and controller placeholder are invisible",
    !(await page.locator("[data-pro-form]").isVisible()) && (await page.locator("[data-form-section]").evaluateAll((ns) => ns.every((n) => n.offsetParent === null))));
  check("click towards the Pro page counted, then the Pro page view", events().includes("pro-page") && views().includes("/pro.html"));

  const leaked = sent.filter((u) => SECRETS.some((s) => decodeURIComponent(u).includes(s)));
  check("no file name, EAN, reference, product name or price in any statistics request", sent.length > 5 && leaked.length === 0, `${sent.length} requêtes inspectées${leaked.length ? " ; fuite : " + leaked[0] : ""}`);
  const params = new Set(sent.flatMap((u) => [...new URL(u).searchParams.keys()]));
  check("only the documented parameters are used (p, t, e, r, q, rnd)", [...params].every((k) => ["p", "t", "e", "r", "q", "rnd"].includes(k)), [...params].join(","));
  check("every request goes to the configured counter only", sent.every((u) => u.startsWith(`https://${CODE}.goatcounter.com/count?`)) && foreign.length === 0, foreign.join(" "));

  // opt-out: #nostats stops counting in this browser
  const before = sent.length;
  await page.goto(`${PUBLIC}/index.html#nostats`);
  await page.reload();
  await page.goto(`${PUBLIC}/app.html`);
  await settle();
  check("#nostats stops all counting in this browser", sent.length === before, `${sent.length - before} requête(s) après #nostats`);
  check("no JavaScript error", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("scenario ran to the end", false, e.message);
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
