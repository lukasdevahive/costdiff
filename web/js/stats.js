// Privacy-first usage statistics (GoatCounter /count endpoint, no cookie, no external script).
// Only a fixed list of event names can be sent: file names, prices, EANs, references and any other file content
// cannot reach this module's output, because nothing outside EVENTS is accepted.
import { GOATCOUNTER, PROD_HOSTS } from "./config.js";

export const EVENTS = Object.freeze({
  "file-own-ok": "Fichier personnel lu",
  "file-own-error": "Fichier personnel refusé",
  "sample-loaded": "Exemples chargés",
  "diff-done-own": "Variations calculées (fichiers personnels)",
  "diff-done-sample": "Variations calculées (exemples)",
  "compare-done-own": "Fournisseurs comparés (fichiers personnels)",
  "compare-done-sample": "Fournisseurs comparés (exemples)",
  "export-diff-own": "Rapport variations exporté (fichiers personnels)",
  "export-diff-sample": "Rapport variations exporté (exemples)",
  "export-compare-own": "Comparaison exportée (fichiers personnels)",
  "export-compare-sample": "Comparaison exportée (exemples)",
  "pro-page": "Clic vers la page Pro",
  "pro-form": "Clic vers le questionnaire Pro",
  "contact-click": "Clic sur le contact",
});

const PAGES = new Set(["/", "/index.html", "/app.html", "/privacy.html", "/pro.html", "/404.html"]);
const OPT_OUT_KEY = "costdiff-nostats";

/** "costdiff" -> "https://costdiff.goatcounter.com/count"; anything else -> "" (off). */
export function endpointFor(code) {
  return /^[a-z0-9][a-z0-9-]{1,48}$/.test(code || "") ? `https://${code}.goatcounter.com/count` : "";
}

/** Page path relative to the site root, without query or hash ("/costdiff/app.html?demo=1" -> "/app.html"). */
export function pagePath(pathname, base) {
  let p = String(pathname || "/");
  if (base && p.startsWith(base)) p = p.slice(base.length - 1);
  p = p.split(/[?#]/)[0] || "/";
  return PAGES.has(p) ? p : "/autre";
}

/** Only the referring site (origin), never its page path or query (which can hold search terms, thread ids...). */
export function cleanReferrer(ref, ownOrigin) {
  try {
    const u = new URL(ref);
    if (!/^https?:$/.test(u.protocol) || u.origin === ownOrigin) return "";
    return u.origin.slice(0, 200);
  } catch { return ""; }
}

/** Campaign parameters only (utm_campaign / utm_source / ref ...), values reduced to [a-z0-9._-]. */
export function campaignQuery(search) {
  const inp = new URLSearchParams(search || "");
  const out = new URLSearchParams();
  for (const k of ["utm_campaign", "campaign", "utm_source", "ref", "src", "source"]) {
    const v = (inp.get(k) || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
    if (v) out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

/** Build the /count URL for a page view or a known event; null when the event is not in EVENTS. */
export function countUrl(endpoint, { path, title, referrer = "", query = "", event = false }) {
  if (!endpoint) return null;
  if (event && !Object.hasOwn(EVENTS, path)) return null;
  const p = new URLSearchParams({ p: path, t: event ? EVENTS[path] : String(title || "").slice(0, 100) });
  if (event) p.set("e", "true");
  if (referrer) p.set("r", referrer);
  if (query) p.set("q", query);
  p.set("rnd", Math.random().toString(36).slice(2, 8));
  return `${endpoint}?${p}`;
}

/** Statistics are sent only on the public host, by a real browser, unless this browser opted out. */
export function shouldCount({ host, webdriver, optedOut, endpoint }) {
  return Boolean(endpoint) && PROD_HOSTS.includes(host) && !webdriver && !optedOut;
}

// ---------- browser side ----------------------------------------------------------------------
const inBrowser = typeof window !== "undefined" && typeof document !== "undefined";
const BASE = inBrowser ? new URL("../", import.meta.url).pathname : "/"; // site root, e.g. "/costdiff/"

// a #nostats / #stats typed into an already open page applies without reloading
if (inBrowser) addEventListener("hashchange", () => { active = active && !optedOut(); });

function optedOut() {
  try {
    // #nostats / #stats toggles this browser out of / back into the statistics (for the owner's own visits)
    if (location.hash === "#nostats") localStorage.setItem(OPT_OUT_KEY, "1");
    if (location.hash === "#stats") localStorage.removeItem(OPT_OUT_KEY);
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch { return false; }
}

const ENDPOINT = endpointFor(GOATCOUNTER);
let active = inBrowser && shouldCount({ host: location.host, webdriver: navigator.webdriver, optedOut: optedOut(), endpoint: ENDPOINT });

function send(url) {
  if (!url) return;
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
  } catch { /* fall back to an image request */ }
  new Image().src = url;
}

/** One page view: path, page title, external referrer and campaign tags. Nothing else. */
export function pageview() {
  if (!active) return;
  send(countUrl(ENDPOINT, {
    path: pagePath(location.pathname, BASE), title: document.title,
    referrer: cleanReferrer(document.referrer, location.origin), query: campaignQuery(location.search),
  }));
}

/** One named event from EVENTS (unknown names are dropped). */
export function track(name) {
  if (!active) return;
  send(countUrl(ENDPOINT, { path: name, event: true }));
}

/** Pages without their own script: count the view and the clicks on [data-stat] links. */
export function wirePage() {
  pageview();
  document.querySelectorAll("[data-stat]").forEach((a) => a.addEventListener("click", () => track(a.dataset.stat)));
}
