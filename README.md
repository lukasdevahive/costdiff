# CostDiff

Compare supplier price lists (Excel .xlsx or CSV) **in the browser**. Version 0.1.0, free trial version.

**Try it online:** https://lukasdevahive.github.io/costdiff/ (the interface is in French). Bugs, questions, ideas: [issues](https://github.com/lukasdevahive/costdiff/issues). Please do not post real price lists in issues: they are public.

Source code is visible for transparency and audit; no licence is granted for reuse (all rights reserved).

## Two tools

1. **A supplier's price changes**
   - Inputs: old list and new list from the same supplier.
   - Results: increases, decreases, new items, removed items.
   - **Hidden increases**: same price for a smaller pack. Example: 12 × 500 g becomes 10 × 500 g, which is +20 % per kg.
   - Report exportable to CSV.
2. **Compare 2 to 6 suppliers**
   - Matching by EAN or by product reference.
   - The cheapest is highlighted, per kg, per litre or per piece when pack sizes allow it.

Files are never sent anywhere. Everything is computed in the visitor's browser. The browser test confirms that only the page's own files are requested.

## Getting started (Windows, Node 18+)

```
cd products\costdiff
npm install          # installs playwright-core, used only by the browser test
npm start            # http://127.0.0.1:8765/
```

Then open http://127.0.0.1:8765/ (presentation page) or http://127.0.0.1:8765/app.html (the tool). The sample-file links load **fictitious** suppliers from `web/samples/` (see `web/samples/README.txt`).

## Tests

```
npm test               # 17 unit tests (Node, no browser)
npm start              # in another terminal
npm run test:browser   # 20 checks in the installed Google Chrome (playwright-core), screenshots in docs/screens/
```

## Structure

| Path | Contents |
|---|---|
| `web/` | The whole product (static HTML, CSS, JS modules, no framework, no runtime dependency) |
| `web/js/numbers.js` | Prices "1.234,56 €" / "1,234.56", decimal separator detected per column |
| `web/js/csv.js` | CSV read/write: separator detection, quotes, BOM; export neutralises Excel formulas |
| `web/js/xlsx.js` | Minimal .xlsx reader with no library (zip + XML through `DecompressionStream`) |
| `web/js/columns.js` | Detects the header row under a title block; recognises columns in FR / NL / EN / DE |
| `web/js/pack.js` | Pack sizes: "12 x 500 g", "6x1L", "carton de 24", "4 x 6 x 33 cl" |
| `web/js/engine.js` | Price changes, comparison between suppliers, rows set aside (duplicates, unreadable prices) |
| `web/js/app.js` | Interface |
| `scripts/serve.mjs` | Local static server (127.0.0.1 only, security headers) |
| `scripts/make_samples.mjs` | Generates the fictitious samples |
| `tests/` | Unit tests and the Chrome test |
| `docs/` | Product choice, commercial proposal, screenshots |

## Known limits (v0.1.0)

- **Unsupported formats:**
  - PDF and old `.xls`: refused with a clear message;
  - dates are not interpreted;
  - only the first sheet of a workbook is read.
- **Matching:** exact key match (reference or EAN). Fuzzy matching on the description is not offered, on purpose: it would produce false matches.
- **Pack sizes:** recognised with common patterns. An unrecognised pack size gives no unit price; the comparison then falls back to the row price and says so ("par ligne").
- **No account, no memory between visits:** no history and no saved column mapping. These are the planned Pro features, not built.
- **Ambiguous prices:** a value like "1.250" can mean 1,250 or 1.25. The column's separator is deduced from its other values. If any ambiguous value is present, the reading used is shown under "points à vérifier"; there is no manual switch yet.
- **Pack size taken from the product name:** if it jumps by more than ×2 between two lists, it is marked "à vérifier" and not counted as a hidden increase.
- **CSV line numbers:** after a quoted field that contains a line break, the reported line numbers are off by 1.
- **Tested in Chrome only** (Windows desktop, plus a 390 px viewport). Firefox, Safari and real phones are not tested.
- **Real-world testing:**
  - the samples and the 5,000-row test files are generated;
  - the product has not yet been tried on a real supplier price list.
