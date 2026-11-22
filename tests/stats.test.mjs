// Usage statistics: only fixed event names, page paths and campaign tags can leave the browser.
import test from "node:test";
import assert from "node:assert/strict";
import { EVENTS, endpointFor, pagePath, cleanReferrer, campaignQuery, countUrl, shouldCount } from "../web/js/stats.js";
import { GOATCOUNTER, PRO_FORM_URL, PROD_HOSTS } from "../web/js/config.js";

const EP = "https://costdiff.goatcounter.com/count";

test("endpoint only from a plain site code", () => {
  assert.equal(endpointFor("costdiff"), EP);
  assert.equal(endpointFor(""), "");
  assert.equal(endpointFor("evil.com/x"), "");
  assert.equal(endpointFor("a"), "");
});

test("unknown event names (e.g. a file name, a price, an EAN) are never sent", () => {
  for (const bad of ["tarif-janvier.xlsx", "5410000000017", "12,50", "PAT-500", "diff-done-own?x=1"]) {
    assert.equal(countUrl(EP, { path: bad, event: true }), null, bad);
  }
  const u = new URL(countUrl(EP, { path: "export-diff-own", event: true }));
  assert.deepEqual([...u.searchParams.keys()].sort(), ["e", "p", "rnd", "t"]);
  assert.equal(u.searchParams.get("t"), EVENTS["export-diff-own"]);
});

test("page path keeps only known pages, without query or hash", () => {
  assert.equal(pagePath("/costdiff/", "/costdiff/"), "/");
  assert.equal(pagePath("/costdiff/app.html", "/costdiff/"), "/app.html");
  assert.equal(pagePath("/costdiff/app.html?demo=1#x", "/costdiff/"), "/app.html");
  assert.equal(pagePath("/costdiff/samples/fournisseur-janvier.csv", "/costdiff/"), "/autre");
  assert.equal(pagePath("/app.html", "/"), "/app.html");
});

test("referrer: external site only, never its page or query; own site dropped", () => {
  assert.equal(cleanReferrer("https://www.google.com/search?q=tarif+fournisseur", "https://lukasdevahive.github.io"), "https://www.google.com");
  assert.equal(cleanReferrer("https://lukasdevahive.github.io/costdiff/", "https://lukasdevahive.github.io"), "");
  assert.equal(cleanReferrer("", "https://x"), "");
  assert.equal(cleanReferrer("file:///C:/Users/me/tarif.html", "https://x"), "");
});

test("campaign tags only, sanitised", () => {
  assert.equal(campaignQuery("?utm_source=Forum-Resto&utm_campaign=lancement&email=a@b.c&q=secret"), "?utm_campaign=lancement&utm_source=forum-resto");
  assert.equal(campaignQuery("?ref=<script>"), "?ref=script");
  assert.equal(campaignQuery("?demo=1"), "");
});

test("counting only on the public host, never in tests, dev or after opt-out", () => {
  const host = PROD_HOSTS[0];
  assert.equal(shouldCount({ host, webdriver: false, optedOut: false, endpoint: EP }), true);
  assert.equal(shouldCount({ host: "127.0.0.1:8765", webdriver: false, optedOut: false, endpoint: EP }), false);
  assert.equal(shouldCount({ host, webdriver: true, optedOut: false, endpoint: EP }), false);
  assert.equal(shouldCount({ host, webdriver: false, optedOut: true, endpoint: EP }), false);
  assert.equal(shouldCount({ host, webdriver: false, optedOut: false, endpoint: "" }), false);
});

test("configuration values are well formed", () => {
  assert.ok(GOATCOUNTER === "" || endpointFor(GOATCOUNTER));
  assert.ok(PRO_FORM_URL === "" || /^https:\/\/tally\.so\/r\/[A-Za-z0-9]+$/.test(PRO_FORM_URL));
});
