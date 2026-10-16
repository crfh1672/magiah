// node filter_chips_harness.js APP_JS CASES_JSON
// Runs the filter window's own logic (findings.js / core.js) on each case
// {op, state, ...} and prints the results as JSON:
//   chips : the active-filter chips (label, kind) and their number N
//   clear : the state after removing chip number `index`
//   query : facetQuery() and whether the last /api/facets answer is current
"use strict";
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const data = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

// the source text of one top-level function / const of the app
function grab(name) {
  let i = src.indexOf("function " + name + "(");
  if (i < 0) {
    i = src.indexOf("const " + name + " =");
    if (i < 0) throw new Error("missing " + name);
    return src.slice(i, src.indexOf(";", i) + 1);
  }
  let depth = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error("unbalanced " + name);
}

const code = [
  // what the browser and the other scripts provide
  "const boxes = {};",
  "const $ = sel => boxes[sel] || (boxes[sel] = { checked: false });",
  "const localStorage = { setItem() {} };",
  "function renderFixBookOptions() {}",
  "const S = Object.assign({ view: 'table', page: 1, pageSize: 50, hideIrr: false, hideDb: false }, c.state);",
  "S.filters = Object.assign({ origin: '', book: '', errtypes: [], statuses: [], verified: false, min_rank: 0, q: '', sort: 'rank', dir: 'desc' }, c.state.filters || {});",
  ...["FALLBACK_STATUSES", "STATUS_ICONS", "statuses", "statusInfo", "errtypeInfo",
      "originInfo", "fmtRank", "fmtNum", "filterParams", "BOOK_NAMES", "bookName",
      "applyHide", "activeFilterChips", "facetQuery", "facetsFresh", "facetsTotal"].map(grab),
  "for (const [k, v] of Object.entries(c.bookNames || {})) BOOK_NAMES.set(k, v);",
  "if (c.facets) { S.facets = c.facets; S.facetsKey = c.facetsKey; }",
  "const snap = () => ({ filters: S.filters, hideIrr: S.hideIrr, hideDb: S.hideDb });",
  "if (c.op === 'chips') { const ch = activeFilterChips(); return { n: ch.length, chips: ch.map(x => ({ label: x.label, kind: x.kind })) }; }",
  "if (c.op === 'clear') { activeFilterChips()[c.index].clear(); return snap(); }",
  "if (c.op === 'query') return { query: facetQuery().toString(), fresh: facetsFresh(), total: facetsTotal() };",
  "throw new Error('op ' + c.op);",
].join("\n");
const run = new Function("c", code);
process.stdout.write(JSON.stringify(data.cases.map((c) => run(c))));
