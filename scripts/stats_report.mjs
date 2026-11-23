// CostDiff funnel from GoatCounter: visitors, app openings, own-file comparisons, exports, Pro interest, sources.
// Usage (PowerShell):  $env:GOATCOUNTER_TOKEN = "<API key from GoatCounter → API>"; node scripts/stats_report.mjs [days=7]
// The key is read from the environment only; it is never written to disk or printed.
import { GOATCOUNTER } from "../web/js/config.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const days = Number(process.argv[2] || 7);
const token = process.env.GOATCOUNTER_TOKEN;

const API = `https://${GOATCOUNTER}.goatcounter.com/api/v0`;
const hour = (d) => { d.setUTCMinutes(0, 0, 0); return d.toISOString().replace(/\.\d{3}Z$/, "Z"); };
const end = new Date(), start = new Date(end.getTime() - days * 86400e3);
const range = `start=${hour(start)}&end=${hour(new Date(end.getTime() + 3600e3))}`;

async function get(pathAndQuery) {
  const r = await fetch(`${API}${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`GoatCounter ${pathAndQuery.split("?")[0]} : HTTP ${r.status}`);
  return r.json();
}

/** Visitors per path (GoatCounter "count" = visitors, deduplicated per session), all pages and events. */
export function funnel(hits) {
  const n = (...paths) => hits.filter((h) => paths.includes(h.path)).reduce((a, h) => a + h.count, 0);
  return [
    ["Visiteurs de la présentation", n("/", "/index.html")],
    ["Ouvertures de l'outil", n("/app.html")],
    ["Fichiers personnels lus", n("file-own-ok")],
    ["Fichiers personnels refusés", n("file-own-error")],
    ["Comparaisons terminées sur fichiers personnels", n("diff-done-own", "compare-done-own")],
    ["Rapports exportés (fichiers personnels)", n("export-diff-own", "export-compare-own")],
    ["Essais avec les exemples", n("sample-loaded")],
    ["Clics vers la page Pro", n("pro-page")],
    ["Clics vers le questionnaire Pro", n("pro-form")],
    ["Clics sur l'adresse de contact ou les issues GitHub (sans motif)", n("contact-click")],
    ["Contacts : renseignements", n("contact-question")],
    ["Contacts : problème", n("contact-bug")],
    ["Contacts : suggestion", n("contact-idea")],
    ["Contacts : intérêt Pro", n("contact-pro")],
    ["Contacts : démonstration", n("contact-demo")],
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!GOATCOUNTER) { console.error("Statistiques non configurées (web/js/config.js : GOATCOUNTER vide)."); process.exit(2); }
  if (!token) { console.error("Définissez GOATCOUNTER_TOKEN (clé API GoatCounter, lecture seule suffit)."); process.exit(2); }
  try {
    let hits = [], exclude = [];
    for (let page = 0; page < 10; page++) { // paginated by excluding the paths already received
      const r = await get(`/stats/hits?${range}&limit=100${exclude.length ? `&exclude_paths=${exclude.join(",")}` : ""}`);
      hits = hits.concat(r.hits || []);
      exclude = hits.map((h) => h.path_id);
      if (!r.more) break;
    }
    console.log(`CostDiff, ${days} derniers jours (source : GoatCounter, visiteurs uniques par session ; visites de développement exclues)\n`);
    for (const [label, value] of funnel(hits)) console.log(`${String(value).padStart(6)}  ${label}`);
    for (const [title, page] of [["Sources de trafic", "toprefs"], ["Campagnes (liens étiquetés)", "campaigns"]]) {
      try {
        const r = await get(`/stats/${page}?${range}&limit=10`);
        console.log(`\n${title} :`);
        if (!r.stats?.length) console.log("       (aucune)");
        for (const s of r.stats || []) console.log(`${String(s.count).padStart(6)}  ${s.name || "(accès direct ou inconnu)"}`);
      } catch (e) { console.log(`\n${title} : indisponible (${e.message})`); }
    }
    console.log("\nAméliorations demandées : voir les réponses du questionnaire Tally et les issues GitHub.");
  } catch (e) {
    console.error(`Rapport impossible : ${e.message}`);
    process.exit(1);
  }
}
