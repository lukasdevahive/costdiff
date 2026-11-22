// CostDiff UI. Everything runs in the browser: files are read with FileReader APIs and never sent anywhere.
import { loadTable, listMapping, LoadError } from "./load.js";
import { buildList, diffLists, compareSuppliers, InputError } from "./engine.js";
import { toCSV } from "./csv.js";
import { parsePrice } from "./numbers.js";
import { formatPack } from "./pack.js";

const $ = (s, root = document) => root.querySelector(s);
const PAGE = 300;
const ROLE_LABELS = { sku: "Référence", ean: "EAN / code-barres", name: "Désignation", price: "Prix", pack: "Conditionnement" };
const money = new Intl.NumberFormat("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pctFmt = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

const state = { diff: { old: null, new: null }, compare: [] };

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

function showError(where, err) {
  const box = $(`#error-${where}`);
  if (!err) { box.hidden = true; box.textContent = ""; return; }
  const expected = err instanceof LoadError || err instanceof InputError;
  box.textContent = expected ? err.message : "Erreur inattendue pendant le calcul. Rechargez la page ; si elle se répète, le fichier a une forme que CostDiff ne gère pas encore.";
  box.hidden = false;
  if (!expected) console.error(err); // a bug: keep it visible to developers
}

async function fromFile(file) {
  return loadTable(file.name, await file.arrayBuffer());
}

async function fromSample(name) {
  const r = await fetch(`samples/${encodeURIComponent(name)}`);
  if (!r.ok) throw new InputError(`Exemple introuvable (${r.status}).`);
  return loadTable(name, await r.arrayBuffer());
}

// ---------- mapping editor ------------------------------------------------------------------
function mappingEditor(table, onChange, { title, removable, onRemove } = {}) {
  const box = el("div", { class: "mapping" });
  const head = el("div", { class: "mapping-head" },
    el("strong", {}, title || table.name),
    el("span", { class: "muted" }, ` ${table.data.length} lignes${table.sheet ? ` · feuille « ${table.sheet} »` : ""} · en-têtes ligne ${table.headerLine}`),
    removable ? el("button", { class: "link danger", onclick: onRemove, "aria-label": `Retirer ${table.name}` }, "retirer") : null);
  const grid = el("div", { class: "mapping-grid" });
  for (const role of Object.keys(ROLE_LABELS)) {
    const id = `m-${Math.random().toString(36).slice(2)}`;
    const sel = el("select", { id, onchange: () => { table.mapping[role] = Number(sel.value); onChange(); } },
      el("option", { value: "-1" }, "— aucune —"),
      table.headers.map((h, i) => el("option", { value: String(i), selected: table.mapping[role] === i }, h)));
    grid.append(el("label", { for: id }, ROLE_LABELS[role], sel));
  }
  const preview = el("table", { class: "preview" },
    el("thead", {}, el("tr", {}, table.headers.map((h) => el("th", {}, h)))),
    el("tbody", {}, table.data.slice(0, 3).map((r) => el("tr", {}, table.headers.map((_, i) => el("td", {}, String(r[i] ?? "")))))));
  box.append(head, grid, el("details", {}, el("summary", {}, "Aperçu des premières lignes"), el("div", { class: "scroll" }, preview)));
  return box;
}

// ---------- tab 1: price changes ------------------------------------------------------------
function renderDiffMappings() {
  const box = $("#mapping-diff");
  box.replaceChildren();
  for (const slot of ["old", "new"]) {
    const t = state.diff[slot];
    $(`[data-info="${slot}"]`).textContent = t ? `${t.name} · ${t.data.length} lignes` : "Aucun fichier";
    if (t) box.append(mappingEditor(t, () => {}, { title: `${slot === "old" ? "Ancienne" : "Nouvelle"} liste : ${t.name}` }));
  }
  $("#run-diff").disabled = !(state.diff.old && state.diff.new);
}

async function setDiff(slot, loader) {
  showError("diff", null);
  try {
    state.diff[slot] = await loader();
  } catch (e) {
    state.diff[slot] = null;
    showError("diff", e);
  }
  $("#result-diff").replaceChildren();
  renderDiffMappings();
}

function keyRoleFor(a, b) {
  // same identifier on both sides: prefer the supplier reference, else EAN
  if (a.mapping.sku >= 0 && b.mapping.sku >= 0) return "sku";
  if (a.mapping.ean >= 0 && b.mapping.ean >= 0) return "ean";
  return "sku";
}

function runDiff() {
  showError("diff", null);
  const { old: a, new: b } = state.diff;
  try {
    const role = keyRoleFor(a, b);
    const build = (t, decimalHint) => buildList(t.data, { ...listMapping(t, { ...t.mapping, keyRole: role }), decimalHint }, t.name);
    let oldL = build(a), newL = build(b);
    // a price column with only ambiguous values ("1.250") takes the separator of the other list from the same supplier
    if (oldL.stats.decimalSource === "défaut" && newL.stats.decimalSource === "colonne") oldL = build(a, newL.stats.decimal);
    if (newL.stats.decimalSource === "défaut" && oldL.stats.decimalSource === "colonne") newL = build(b, oldL.stats.decimal);
    if (!oldL.items.size || !newL.items.size) throw new InputError("Aucun produit lisible dans l'une des listes : vérifiez les colonnes référence et prix.");
    const threshold = Math.max(0, Number($("#threshold").value) || 0);
    const res = diffLists(oldL, newL, { threshold });
    const matched = res.changes.filter((c) => !["new", "removed"].includes(c.status)).length;
    if (matched === 0) throw new InputError(`Aucun produit commun trouvé en rapprochant par ${role === "ean" ? "EAN" : "référence"}. Vérifiez que la même colonne identifiant est choisie dans les deux listes.`);
    renderDiffResult(res, [...decimalNotes([[a.name, oldL], [b.name, newL]]), ...oldL.issues, ...newL.issues], role);
  } catch (e) { showError("diff", e); }
}

const STATUS = {
  up: ["Hausse", "up"], down: ["Baisse", "down"], same: ["Inchangé", "same"], new: ["Nouveau", "new"], removed: ["Retiré", "removed"],
};

function renderDiffResult({ changes, summary }, issues, role) {
  const out = $("#result-diff");
  const cards = el("div", { class: "cards" },
    card(summary.up, "hausses", "up", summary.avgUpPct !== null ? `moyenne ${pctFmt.format(summary.avgUpPct)} %` : ""),
    card(summary.hidden, "hausses cachées", "hidden", "même prix, paquet plus petit"),
    card(summary.down, "baisses", "down"),
    card(summary.new, "nouveaux", "new"),
    card(summary.removed, "retirés", "removed"),
    card(summary.same, "inchangés", "same"));
  let filter = summary.up ? "up" : "all";
  const chips = el("div", { class: "chips", role: "group", "aria-label": "Filtrer" });
  const tableBox = el("div", { class: "scroll" });
  const draw = () => {
    chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === filter)));
    const rows = changes.filter((c) => filter === "all" || (filter === "hidden" ? c.hidden : c.status === filter));
    tableBox.replaceChildren(diffTable(rows));
  };
  for (const [f, label] of [["all", "Tout"], ["up", "Hausses"], ["hidden", "Cachées"], ["down", "Baisses"], ["new", "Nouveaux"], ["removed", "Retirés"], ["same", "Inchangés"]]) {
    chips.append(el("button", { "data-f": f, onclick: () => { filter = f; draw(); } }, label));
  }
  const exportBtn = el("button", { class: "secondary", onclick: () => download("costdiff-variations.csv", diffCSV(changes)) }, "Exporter le rapport (CSV)");
  out.replaceChildren(...[
    el("h2", {}, "Résultat"),
    el("p", { class: "muted" }, `Rapprochement par ${role === "ean" ? "EAN" : "référence"} · ${changes.length} produits · variation calculée au kilo, au litre ou à la pièce quand le conditionnement change.`),
    cards, issuesBox(issues), el("div", { class: "toolbar" }, chips, exportBtn), tableBox].filter(Boolean)); // issuesBox() is null when nothing was rejected
  draw();
  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

function card(n, label, kind, sub = "") {
  return el("div", { class: `card ${kind}` }, el("div", { class: "n" }, String(n)), el("div", {}, label), sub ? el("div", { class: "sub" }, sub) : null);
}

function paged(rows, renderRow, head) {
  const tbody = el("tbody");
  let shown = 0;
  const more = el("button", { class: "link" });
  const step = () => {
    rows.slice(shown, shown + PAGE).forEach((r) => tbody.append(renderRow(r)));
    shown = Math.min(rows.length, shown + PAGE);
    more.hidden = shown >= rows.length;
    more.textContent = `Afficher ${Math.min(PAGE, rows.length - shown)} lignes de plus (${rows.length - shown} restantes)`;
  };
  more.addEventListener("click", step);
  step();
  const t = el("table", { class: "result" }, el("thead", {}, el("tr", {}, head.map((h) => el("th", {}, h)))), tbody);
  if (!rows.length) tbody.append(el("tr", {}, el("td", { colspan: String(head.length), class: "muted" }, "Aucune ligne dans ce filtre.")));
  return el("div", {}, t, more);
}

function diffTable(rows) {
  return paged(rows, (c) => {
    const [label, cls] = STATUS[c.status];
    const pct = c.effectivePct;
    return el("tr", { class: c.hidden ? "row-hidden" : "" },
      el("td", {}, el("span", { class: `badge ${cls}` }, c.hidden ? "Hausse cachée" : label)),
      el("td", { class: "mono" }, c.key),
      el("td", {}, c.name || ""),
      el("td", { class: "num" }, c.oldPrice !== undefined ? money.format(c.oldPrice) : ""),
      el("td", { class: "num" }, c.newPrice !== undefined ? money.format(c.newPrice) : ""),
      el("td", { class: `num ${pct > 0 ? "pos" : pct < 0 ? "neg" : ""}` }, pct === null || pct === undefined ? "" : `${pctFmt.format(pct)} %`),
      el("td", {}, packCell(c)));
  }, ["Statut", "Référence", "Désignation", "Ancien prix", "Nouveau prix", "Variation", "Conditionnement"]);
}

/** Prices like "1.250" can mean 1250 or 1,25: say which reading was used instead of hiding the guess. */
function decimalNotes(named) {
  return named.filter(([, l]) => l.stats.ambiguous > 0).map(([file, l]) => ({
    file, type: "decimal",
    detail: `${l.stats.ambiguous} prix ambigu(s), par exemple « ${l.stats.ambiguousExample} » lu ${money.format(parsePrice(l.stats.ambiguousExample, l.stats.decimal))}, `
      + `avec « ${l.stats.decimal} » comme séparateur décimal (${{ colonne: "déduit du reste de la colonne", "autre fichier": "repris de l'autre liste", défaut: "choix par défaut" }[l.stats.decimalSource]}) : vérifiez-les`,
  }));
}

function packCell(c) {
  if (c.packCheck) return el("span", { class: "warn", title: "Conditionnement lu dans la désignation, qui a changé : à vérifier" }, `à vérifier : ${formatPack(c.oldPack)} → ${formatPack(c.newPack)}`);
  if (c.packChanged) return el("span", { class: "warn" }, `${formatPack(c.oldPack)} → ${formatPack(c.newPack)}`);
  return formatPack(c.newPack || c.oldPack);
}

function issuesBox(issues) {
  if (!issues.length) return null;
  const labels = { duplicate: "doublon", "bad-price": "prix illisible", "missing-key": "sans référence", decimal: "séparateur décimal" };
  return el("details", { class: "issues", open: issues.some((i) => i.type === "decimal") },
    el("summary", {}, `${issues.length} point(s) à vérifier (lignes écartées, lectures supposées)`),
    el("ul", {}, issues.slice(0, 200).map((i) => el("li", {}, `${i.file}${i.line ? ` · ligne ${i.line}` : ""}${i.key ? ` · ${i.key}` : ""} : ${labels[i.type] || i.type} — ${i.detail}`))),
    issues.length > 200 ? el("p", { class: "muted" }, `… et ${issues.length - 200} autres.`) : null);
}

function diffCSV(changes) {
  const fmt = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
  const rows = [["statut", "reference", "designation", "ancien_prix", "nouveau_prix", "variation_prix_pct", "variation_unitaire_pct", "ancien_conditionnement", "nouveau_conditionnement", "hausse_cachee", "conditionnement_a_verifier"]];
  for (const c of changes) rows.push([STATUS[c.status][0], c.key, c.name, fmt(c.oldPrice), fmt(c.newPrice), fmt(c.pct), fmt(c.unitPct), formatPack(c.oldPack), formatPack(c.newPack), c.hidden ? "oui" : "", c.packCheck ? "oui" : ""]);
  return toCSV(rows, ";");
}

function download(name, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- tab 2: compare suppliers --------------------------------------------------------
function renderCompareMappings() {
  const box = $("#mapping-compare");
  box.replaceChildren();
  state.compare.forEach((t, i) => box.append(mappingEditor(t, () => {}, {
    removable: true, onRemove: () => { state.compare.splice(i, 1); $("#result-compare").replaceChildren(); renderCompareMappings(); },
  })));
  $("#info-compare").textContent = state.compare.length ? `${state.compare.length} fournisseur(s)` : "Aucun fichier";
  $("#run-compare").disabled = state.compare.length < 2;
}

async function addCompare(loaders) {
  showError("compare", null);
  for (const load of loaders) {
    if (state.compare.length >= 6) { showError("compare", new InputError("6 fournisseurs au maximum par comparaison.")); break; }
    try { state.compare.push(await load()); } catch (e) { showError("compare", e); }
  }
  $("#result-compare").replaceChildren();
  renderCompareMappings();
}

function runCompare() {
  showError("compare", null);
  try {
    const role = $("#key-compare").value;
    // suppliers often all send "tarif.xlsx": number duplicate names so columns and winners stay distinct
    const taken = new Set();
    const label = (t) => {
      const base = t.name.replace(/\.(xlsx|csv|txt|tsv)$/i, "");
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} (${n})`; // never reuse a label, even "tarif (2)"
      taken.add(name);
      return name;
    };
    const build = (t, lbl, decimalHint) => buildList(t.data, { ...listMapping(t, { ...t.mapping, keyRole: role }), decimalHint }, lbl);
    const lists = state.compare.map((t) => {
      if ((role === "ean" ? t.mapping.ean : t.mapping.sku) < 0) throw new InputError(`« ${t.name} » : choisissez sa colonne ${role === "ean" ? "EAN" : "référence"}.`);
      const lbl = label(t);
      return { label: lbl, table: t, list: build(t, lbl) };
    });
    // undecided price columns ("1.250" only) take the separator most used by the other suppliers
    const votes = lists.filter((l) => l.list.stats.decimalSource === "colonne").map((l) => l.list.stats.decimal);
    if (votes.length) {
      const hint = votes.filter((d) => d === ",").length >= votes.length / 2 ? "," : ".";
      for (const l of lists) if (l.list.stats.decimalSource === "défaut") l.list = build(l.table, l.label, hint);
    }
    const res = compareSuppliers(lists);
    if (!res.summary.comparable) throw new InputError(`Aucun produit présent chez au moins deux fournisseurs en rapprochant par ${role === "ean" ? "EAN" : "référence"}. Les références des fournisseurs diffèrent souvent : essayez l'EAN.`);
    renderCompareResult(res, lists, [...decimalNotes(lists.map((l) => [l.label, l.list])), ...lists.flatMap((l) => l.list.issues)]);
  } catch (e) { showError("compare", e); }
}

function renderCompareResult({ rows, summary }, lists, issues) {
  const out = $("#result-compare");
  const cards = el("div", { class: "cards" },
    card(summary.comparable, "produits comparables", "up", "présents chez 2 fournisseurs ou plus"),
    card(summary.onlyOne, "chez un seul", "same"),
    ...Object.entries(summary.wins).map(([s, n]) => card(n, `meilleur prix : ${s}`, "down")));
  let onlyComparable = true;
  const tableBox = el("div", { class: "scroll" });
  const head = ["Référence / EAN", "Désignation", ...lists.map((l) => l.label), "Base", "Écart"];
  const draw = () => {
    const shown = rows.filter((r) => !onlyComparable || r.count > 1);
    tableBox.replaceChildren(paged(shown, (r) => el("tr", {},
      el("td", { class: "mono" }, r.key), el("td", {}, r.name),
      r.offers.map((o, i) => {
        if (!o) return el("td", { class: "muted" }, "—");
        const best = r.count > 1 && lists[i].label === r.best;
        return el("td", { class: `num ${best ? "best" : ""}` },
          money.format(o.price),
          o.pack ? el("div", { class: "sub" }, `${formatPack(o.pack)}${r.perUnit ? ` · ${money.format(o.unitPrice)} /${o.pack.unit}` : ""}`) : null);
      }),
      el("td", {}, r.basis), el("td", { class: "num" }, r.spreadPct === null ? "" : `${pctFmt.format(r.spreadPct)} %`)), head));
  };
  const toggle = el("label", { class: "inline" }, el("input", { type: "checkbox", checked: true, onchange: (e) => { onlyComparable = e.target.checked; draw(); } }), " seulement les produits comparables");
  const exportBtn = el("button", { class: "secondary", onclick: () => download("costdiff-fournisseurs.csv", compareCSV(rows, lists)) }, "Exporter (CSV)");
  out.replaceChildren(...[el("h2", {}, "Résultat"),
    el("p", { class: "muted" }, "Le meilleur prix est en vert. La comparaison se fait au kilo, au litre ou à la pièce quand chaque offre a un conditionnement dans la même unité ; sinon, prix par ligne (à vérifier)."),
    cards, issuesBox(issues), el("div", { class: "toolbar" }, toggle, exportBtn), tableBox].filter(Boolean)); // issuesBox() is null when nothing was rejected
  draw();
  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

function compareCSV(rows, lists) {
  const fmt = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
  const head = ["cle", "designation", ...lists.flatMap((l) => [`${l.label}_prix`, `${l.label}_conditionnement`]), "base", "meilleur", "ecart_pct"];
  const body = rows.map((r) => [r.key, r.name, ...r.offers.flatMap((o) => (o ? [fmt(o.price), formatPack(o.pack)] : ["", ""])), r.basis, r.count > 1 ? r.best : "", fmt(r.spreadPct)]);
  return toCSV([head, ...body], ";");
}

// ---------- wiring --------------------------------------------------------------------------
function selectTab(which) {
  for (const t of ["diff", "compare"]) {
    $(`#tab-${t}`).setAttribute("aria-selected", String(t === which));
    $(`#panel-${t}`).hidden = t !== which;
  }
  try { localStorage.setItem("costdiff-tab", which); } catch { /* private mode */ }
}

$("#tab-diff").addEventListener("click", () => selectTab("diff"));
$("#tab-compare").addEventListener("click", () => selectTab("compare"));
document.querySelectorAll("[data-input]").forEach((inp) => inp.addEventListener("change", () => {
  const f = inp.files[0];
  if (f) setDiff(inp.dataset.input, () => fromFile(f));
  inp.value = "";
}));
$("#sample-diff").addEventListener("click", async () => {
  await setDiff("old", () => fromSample("fournisseur-janvier.csv"));
  await setDiff("new", () => fromSample("fournisseur-fevrier.xlsx"));
});
$("#run-diff").addEventListener("click", runDiff);
$("#input-compare").addEventListener("change", (e) => {
  const files = [...e.target.files];
  addCompare(files.map((f) => () => fromFile(f)));
  e.target.value = "";
});
$("#sample-compare").addEventListener("click", () => {
  state.compare = [];
  addCompare(["supplier-a.csv", "supplier-b.csv", "supplier-c.xlsx"].map((n) => () => fromSample(n)));
});
$("#run-compare").addEventListener("click", runCompare);
// drag and drop onto the drop zones
document.querySelectorAll(".drop").forEach((zone) => {
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("over");
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (zone.dataset.slot) setDiff(zone.dataset.slot, () => fromFile(files[0]));
    else addCompare(files.map((f) => () => fromFile(f)));
  });
});

try { if (localStorage.getItem("costdiff-tab") === "compare") selectTab("compare"); } catch { /* private mode */ }
// link from the landing page: open the price-change tool with the fictitious samples already loaded
if (new URLSearchParams(location.search).get("demo") === "1") { selectTab("diff"); $("#sample-diff").click(); }
