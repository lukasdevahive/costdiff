// Static site audit before publishing: every page has a title, description, canonical URL and CSP;
// internal links and assets exist; sitemap and robots.txt list the indexable pages; configuration and CSP agree.
// Usage: node scripts/check_site.mjs   (exit 1 on any problem). Also run by the unit tests.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, cspFor } from "./configure.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");

export function audit() {
  const problems = [];
  const cfg = readConfig();
  const SITE = cfg.site;
  const pages = fs.readdirSync(WEB).filter((f) => f.endsWith(".html") && !/^google[0-9a-f]+\.html$/.test(f));
  const sitemap = fs.readFileSync(path.join(WEB, "sitemap.xml"), "utf8");
  const robots = fs.readFileSync(path.join(WEB, "robots.txt"), "utf8");
  if (!robots.includes(`Sitemap: ${SITE}sitemap.xml`) || /Disallow:\s*\/\s*$/m.test(robots)) problems.push("robots.txt : sitemap absent ou site bloqué");
  const inSitemap = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(WEB, page), "utf8");
    const noindex = /<meta name="robots" content="noindex">/.test(html);
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    const desc = (html.match(/<meta name="description" content="([^"]*)">/) || [])[1] || "";
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
    const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/) || [])[1];
    const url = page === "index.html" ? SITE : SITE + page;
    if (!title || title.length > 90) problems.push(`${page} : titre absent ou trop long (${title.length})`);
    if (csp !== cspFor(cfg.goatcounter)) problems.push(`${page} : CSP différente de la configuration`);
    if (!/<html lang="fr">/.test(html)) problems.push(`${page} : langue absente`);
    if (!noindex) {
      if (desc.length < 50 || desc.length > 200) problems.push(`${page} : description absente ou de longueur anormale (${desc.length})`);
      if (canonical !== url) problems.push(`${page} : canonical ${canonical} au lieu de ${url}`);
      if (!inSitemap.includes(url)) problems.push(`${page} : absente du sitemap`);
    } else if (inSitemap.includes(url)) problems.push(`${page} : noindex mais présente dans le sitemap`);
    // internal links and assets (relative only; /costdiff/ absolute links are mapped to the web folder)
    for (const m of html.matchAll(/(?:href|src)="([^"#]+)(#[^"]*)?"/g)) {
      const ref = m[1];
      if (/^(https?:|mailto:|data:)/.test(ref)) continue;
      const root = new URL(SITE).pathname;
      const rel = ref.startsWith(root) ? ref.slice(root.length) : ref.replace(/^\.\//, "");
      const target = path.join(WEB, rel.split("?")[0] || "index.html");
      const file = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, "index.html") : target;
      if (!fs.existsSync(file)) problems.push(`${page} : lien cassé ${ref}`);
    }
  }
  for (const url of inSitemap) {
    const page = url === SITE ? "index.html" : url.slice(SITE.length);
    if (!pages.includes(page)) problems.push(`sitemap : ${url} n'existe pas`);
  }
  // every indexable page is reachable from the presentation page in at most two clicks
  const linksOf = (p) => [...fs.readFileSync(path.join(WEB, p), "utf8").matchAll(/href="([a-z0-9-]+\.html)/g)].map((m) => m[1]);
  const reach = new Set(["index.html", ...linksOf("index.html")]);
  for (const p of [...reach]) if (fs.existsSync(path.join(WEB, p))) linksOf(p).forEach((q) => reach.add(q));
  for (const url of inSitemap) {
    const page = url === SITE ? "index.html" : url.slice(SITE.length);
    if (!reach.has(page)) problems.push(`${page} : pas de lien interne depuis la présentation`);
  }
  if ((cfg.goatcounter || cfg.form) && !(cfg.controller && cfg.contact)) problems.push("mesure ou questionnaire actif sans responsable du traitement ni contact");
  for (const f of fs.readdirSync(WEB).filter((x) => /^google[0-9a-f]+\.html$/.test(x))) {
    if (fs.readFileSync(path.join(WEB, f), "utf8").trim() !== `google-site-verification: ${f}`) problems.push(`${f} : fichier de vérification Google mal formé`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = audit();
  for (const p of problems) console.log(`PROBLÈME  ${p}`);
  console.log(problems.length ? `${problems.length} problème(s)` : "site OK : titres, descriptions, canonical, sitemap, robots, liens, CSP");
  process.exit(problems.length ? 1 : 0);
}
