// The published site stays consistent: SEO basics, links, sitemap, CSP matching the statistics configuration.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../scripts/check_site.mjs";
import { cspFor } from "../scripts/configure.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("site audit finds no problem", () => {
  assert.deepEqual(audit(), []);
});

test("CSP allows the statistics host only when a code is configured", () => {
  assert.ok(!cspFor("").includes("goatcounter"));
  assert.match(cspFor("costdiff"), /img-src 'self' data: https:\/\/costdiff\.goatcounter\.com; connect-src 'self' https:\/\/costdiff\.goatcounter\.com;/);
  assert.match(cspFor("costdiff"), /script-src 'self';/); // no external script, ever
});

// configure.mjs runs on a copy of web/ (COSTDIFF_WEB): the real site files are never touched by the tests
function onCopy(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costdiff-cfg-"));
  try {
    fs.cpSync(path.join(ROOT, "web"), dir, { recursive: true });
    const run = (...args) => execFileSync(process.execPath, [path.join(ROOT, "scripts", "configure.mjs"), ...args], { env: { ...process.env, COSTDIFF_WEB: dir }, stdio: "pipe" }).toString();
    // every test starts from a site with nothing enabled, whatever the real configuration is
    run("--goatcounter", "none", "--form", "none", "--contact", "none", "--controller", "none");
    return fn(dir, run);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("statistics and the survey are refused until a data controller and a contact are set", () => onCopy((dir, run) => {
  assert.throws(() => run("--form", "https://tally.so/r/abc123"), /renseignez d'abord/);
  assert.throws(() => run("--goatcounter", "costdiff"), /renseignez d'abord/);
  assert.throws(() => run("--goatcounter", "costdiff", "--controller", "Test Exemple"), /renseignez d'abord/);
  assert.match(fs.readFileSync(path.join(dir, "js", "config.js"), "utf8"), /GOATCOUNTER = "";[\s\S]*PRO_FORM_URL = "";/);
  assert.match(fs.readFileSync(path.join(dir, "privacy.html"), "utf8"), /pas encore active/);
}));

test("enabling statistics and the survey updates config, CSP, _headers and the privacy page together", () => onCopy((dir, run) => {
  run("--goatcounter", "costdiff", "--controller", "Test Exemple", "--contact", "contact@example.org", "--form", "https://tally.so/r/abc123");
  assert.match(fs.readFileSync(path.join(dir, "js", "config.js"), "utf8"), /GOATCOUNTER = "costdiff";/);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".html") && !x.startsWith("google"))) assert.ok(fs.readFileSync(path.join(dir, f), "utf8").includes(cspFor("costdiff")), f);
  assert.ok(fs.readFileSync(path.join(dir, "_headers"), "utf8").includes(cspFor("costdiff")));
  const privacy = fs.readFileSync(path.join(dir, "privacy.html"), "utf8");
  assert.match(privacy, /Responsable du traitement : Test Exemple/);
  assert.match(privacy, /mailto:contact@example\.org/);
  assert.match(privacy, /<h2>Mesure d'audience \(GoatCounter\)<\/h2>/);
  assert.match(privacy, /Questionnaire sur la version Pro \(Tally\)/);
  assert.ok(!privacy.includes("pas encore active"));
  assert.match(run("--check"), /conforme à la configuration/);
  run("--goatcounter", "none", "--form", "none"); // switching off restores the "not active" wording
  assert.match(fs.readFileSync(path.join(dir, "privacy.html"), "utf8"), /pas encore active/);
}));

test("moving the public address rewrites canonical URLs, sitemap, robots and counted hosts", () => onCopy((dir, run) => {
  run("--site", "https://costdiff.pages.dev/");
  assert.match(fs.readFileSync(path.join(dir, "index.html"), "utf8"), /<link rel="canonical" href="https:\/\/costdiff\.pages\.dev\/">/);
  assert.match(fs.readFileSync(path.join(dir, "robots.txt"), "utf8"), /Sitemap: https:\/\/costdiff\.pages\.dev\/sitemap\.xml/);
  assert.ok(!fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8").includes("github.io"));
  assert.match(fs.readFileSync(path.join(dir, "js", "config.js"), "utf8"), /PROD_HOSTS = \["lukasdevahive\.github\.io", "costdiff\.pages\.dev"\];/);
  assert.match(fs.readFileSync(path.join(dir, "404.html"), "utf8"), /href="\/css\/style\.css"/);
}));

test("a dedicated contact address is validated and written to the configuration", () => onCopy((dir, run) => {
  assert.throws(() => run("--contact", "pas-une-adresse"), /adresse de contact invalide/);
  assert.throws(() => run("--contact", "contact@example.org"), /renseignez d'abord/); // an e-mail needs a named controller
  run("--contact", "contact@example.org", "--controller", "Test Exemple");
  assert.match(fs.readFileSync(path.join(dir, "privacy.html"), "utf8"), /Dernière mise à jour : \d{1,2} \S+ \d{4}\./);
  assert.match(fs.readFileSync(path.join(dir, "js", "config.js"), "utf8"), /CONTACT_EMAIL = "contact@example\.org";/);
}));
