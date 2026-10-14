/* ============ מגיה — core.js (vanilla JS, RTL Hebrew SPA, zero deps) ============
 * All server data is rendered via textContent / createElement — never innerHTML
 * with raw data (XSS-safe). All user-facing text is Hebrew.
 */
"use strict";

/* ---------------------------------------------------------------- helpers */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  // a tooltip nobody can reach by keyboard is no tooltip
  if (attrs && attrs.dataset && attrs.dataset.tip && !/^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(n.tagName)) n.tabIndex = 0;
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

/* Make a non-button element usable from the keyboard: focusable, optional
 * role, Enter / Space activate it. */
function makeActivatable(node, fn, role) {
  node.tabIndex = 0;
  if (role) node.setAttribute("role", role);
  node.addEventListener("keydown", ev => {
    if (ev.target !== node) return;
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fn(ev); }
  });
  return node;
}

/* ---- dialogs (drawer, scan modal): focus moves in, Tab stays inside, focus
 * goes back to whatever opened the dialog ---- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
const LAYERS = [];
/* Is this element really on screen? A closed <details> hides its content
 * without always clearing offsetParent, so check the ancestors too (a
 * <summary> itself stays visible). */
function isShown(e) {
  if (!e || e.offsetParent === null) return false;
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (p.tagName === "DETAILS" && !p.open && !(e.tagName === "SUMMARY" && e.parentElement === p)) return false;
  }
  return true;
}
function openLayer(node, fallbackSel) {
  if (LAYERS.some(l => l.node === node)) return;
  LAYERS.push({ node, opener: document.activeElement, fallbackSel });
  requestAnimationFrame(() => {
    const first = [...node.querySelectorAll(FOCUSABLE)].find(isShown);
    if (first) first.focus();
  });
}
function closeLayer(node) {
  const i = LAYERS.findIndex(l => l.node === node);
  if (i < 0) return;
  const [l] = LAYERS.splice(i, 1);
  // the opener may be gone or hidden (a closed menu item): use the fallback
  let back = l.opener;
  if (!back || !document.contains(back) || !isShown(back)) back = l.fallbackSel ? $(l.fallbackSel) : null;
  if (back && back.focus) back.focus();
}
document.addEventListener("keydown", ev => {
  if (ev.key !== "Tab" || !LAYERS.length) return;
  const node = LAYERS[LAYERS.length - 1].node;
  const items = [...node.querySelectorAll(FOCUSABLE)].filter(isShown);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (!node.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
  else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});

/* An icon from the sprite in index.html (<symbol id="i-NAME">). Coloured by
 * currentColor; decorative, so hidden from screen readers. */
const SVG_NS = "http://www.w3.org/2000/svg";
function icon(name, cls) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ic" + (cls ? " " + cls : ""));
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return "";
  return Number(n).toLocaleString("he-IL");
}
function fmtRank(n) {
  if (n == null || n === "" || isNaN(n)) return "";
  return (Math.round(Number(n) * 100) / 100).toString();
}

function toast(msg, type, ms) {
  const box = $("#toasts");
  const t = el("div", { class: "toast " + (type || "") }, msg);
  box.append(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, ms || 4000);
}

async function api(path, opts) {
  opts = opts || {};
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error("אין תקשורת עם השרת — ודא שהשרת פועל");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    const msg = data && data.error ? data.error : "שגיאת שרת (HTTP " + res.status + ")";
    const err = new Error(msg);
    // the fixer refuses with a machine code and a per-finding failure list;
    // callers need both to explain WHY nothing was written
    err.status = res.status;
    err.code = data && data.code;
    err.data = data;
    throw err;
  }
  return data;
}

/* clipboard with fallback */
function copyText(text) {
  const done = () => toast("הועתק: " + text, "ok", 1600);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => copyFallback(text, done));
  } else copyFallback(text, done);
}
function copyFallback(text, done) {
  const ta = el("textarea", { style: "position:fixed;opacity:0" }, text);
  document.body.append(ta);
  ta.select();
  try { document.execCommand("copy"); done(); }
  catch (e) { toast("ההעתקה נכשלה", "err"); }
  ta.remove();
}

/* ------------------------------------------------------------ constants */
/* Fallbacks only — real labels come from /api/meta (§4-§5). */
const FALLBACK_STATUSES = [
  { key: "pending", hebrew: "טרם נבדק", icon: "⬜" },
  { key: "approved", hebrew: "אושר — זו שגיאה", icon: "✅" },
  { key: "fixed", hebrew: "תוקן בספר", icon: "🔧" },
  { key: "not_error", hebrew: "לא שגיאה", icon: "❌" },
  { key: "unsure", hebrew: "דרוש בירור", icon: "❓" },
  { key: "ignored", hebrew: "התעלם", icon: "🚫" },
];
const STATUS_ICONS = { pending: "⬜", approved: "✅", fixed: "🔧", not_error: "❌", unsure: "❓", ignored: "🚫" };

/* ------------------------------------------------------------ state */
const S = {
  meta: null,
  view: "table",
  // view-wide: hide books whose path says "לא רלוונטי", and DB books that
  // can only be exported (remembered per browser, not in the URL)
  hideIrr: true,
  hideDb: true,
  // table presentation, remembered per browser
  density: "comfortable",     // comfortable | compact
  hiddenCols: new Set(),      // column keys the reviewer turned off
  filters: { origin: "", book: "", errtypes: [], statuses: [], verified: false, min_rank: 0, q: "", sort: "rank", dir: "desc" },
  page: 1,
  pageSize: 50,
  tableRows: [],
  tableTotal: 0,
  sel: new Set(),
  sessionActions: 0,
  // cards
  cq: null,                 // CardQueue (cardqueue.js), created on first use
  cardSeed: 0,              // fixed per queue so a 'random' cursor is stable
  cardStale: true,
  cardFixOpen: false,
  // fixer — keyed on the FILE (fixKey), never on the book title: one title can
  // belong to many different files in the corpus
  fixKey: "",
  fixBooks: [],
  fixDoc: null,             // /api/fixer/doc response (lines + fingerprint)
  fixLines: new Map(),      // lineno -> {n, text, tokens?}
  fixInclude: false,
  fixRows: [],
  fixCurId: null,           // the selected finding, by id — survives filtering
  fixView: "",              // "" | blocked | st:<status> | et:<errtype>
  fixMode: "replace",       // per-book default
  fixModeOverride: new Map(),  // finding id -> mode (session only)
  fixPicked: new Set(),     // findings selected for the next apply
  fixEdits: [],             // file_edits log for this book
  fixDocStale: false,       // set when the server says the file changed
  // misc
  lastActions: [],           // local stack for card-restore on undo
  hashLock: false,
  bookList: [],
};

/* metadata accessors */
function statuses() {
  const raw = (S.meta && S.meta.statuses) || FALLBACK_STATUSES;
  return raw.map(s => {
    if (typeof s === "string") {
      const f = FALLBACK_STATUSES.find(x => x.key === s);
      return f || { key: s, hebrew: s, icon: "" };
    }
    return { key: s.key, hebrew: s.hebrew || s.name || s.key, icon: s.icon || STATUS_ICONS[s.key] || "" };
  });
}
function statusInfo(key) {
  return statuses().find(s => s.key === key) || { key, hebrew: key, icon: "" };
}
function colInfo(key) {
  const c = ((S.meta && S.meta.columns) || []).find(x => x.key === key);
  return c || { key, hebrew: key, explanation: "" };
}
function errtypeInfo(key) {
  const e = ((S.meta && S.meta.errtypes) || []).find(x => x.key === key);
  return e || { key, hebrew: key, explanation: "" };
}
function originInfo(name) {
  const o = ((S.meta && S.meta.origins) || []).find(x => x.name === name);
  return o || { name, hebrew: name };
}
function effStatus(row) {
  return row.effective_status || row.status || "pending";
}
function effFix(row) {
  return row.custom_suggestion || row.suggestion || "";
}

/* ---------------------------------------------------------- URL hash */
function writeHash() {
  const f = S.filters, p = new URLSearchParams();
  p.set("v", S.view);
  if (f.origin) p.set("o", f.origin);
  if (f.book) p.set("b", f.book);
  if (f.errtypes.length) p.set("e", f.errtypes.join(","));
  if (f.statuses.length) p.set("s", f.statuses.join(","));
  if (f.verified) p.set("vf", "1");
  if (f.min_rank) p.set("mr", String(f.min_rank));
  if (f.q) p.set("q", f.q);
  if (f.sort !== "rank" || f.dir !== "desc") p.set("sort", f.sort + ":" + f.dir);
  if (S.page > 1) p.set("p", String(S.page));
  if (S.fixKey) p.set("fk", S.fixKey);
  if (S.fixInclude) p.set("fi", "1");
  // written whenever a book is open, so that reloading a link cannot flip the
  // mode back to the book's stored default behind the corrector's back
  if (S.fixKey) p.set("fm", S.fixMode);
  if (S.fixView) p.set("fv", S.fixView);
  S.hashLock = true;
  location.hash = p.toString();
  setTimeout(() => { S.hashLock = false; }, 0);
}
function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  const f = S.filters;
  S.view = p.get("v") || "table";
  f.origin = p.get("o") || "";
  f.book = p.get("b") || "";
  f.errtypes = (p.get("e") || "").split(",").filter(Boolean);
  f.statuses = (p.get("s") || "").split(",").filter(Boolean);
  f.verified = p.get("vf") === "1";
  f.min_rank = parseFloat(p.get("mr") || "0") || 0;
  f.q = p.get("q") || "";
  const so = (p.get("sort") || "rank:desc").split(":");
  f.sort = so[0] || "rank";
  f.dir = so[1] || "desc";
  S.page = parseInt(p.get("p") || "1", 10) || 1;
  S.fixKey = p.get("fk") || "";
  S.fixInclude = p.get("fi") === "1";
  S.fixMode = p.get("fm") === "bracket" ? "bracket" : "replace";
  S.fixView = p.get("fv") || "";
}
window.addEventListener("hashchange", () => {
  if (S.hashLock) return;
  readHash();
  syncFilterControls();
  showView(S.view, true); // showView triggers refreshCurrentView
});

/* build query params from current filters */
function filterParams(overrides) {
  const f = S.filters, p = new URLSearchParams();
  const o = overrides || {};
  const val = (k, d) => (k in o ? o[k] : d);
  const origin = val("origin", f.origin), book = val("book", f.book);
  const errtypes = val("errtypes", f.errtypes), sts = val("statuses", f.statuses);
  if (origin) p.set("origin", origin);
  // `book` holds the book's stable key (doc), never its display title
  if (book) p.set("book_key", book);
  if (errtypes && errtypes.length) p.set("errtype", errtypes.join(","));
  if (sts && sts.length) p.set("status", sts.join(","));
  if (val("verified", f.verified)) p.set("verified", "1");
  if (S.hideIrr) p.set("hide_irr", "1");
  if (S.hideDb) p.set("hide_db", "1");
  const mr = val("min_rank", f.min_rank);
  if (mr) p.set("min_rank", String(mr));
  const q = val("q", f.q);
  if (q) p.set("q", q);
  p.set("sort", val("sort", f.sort));
  p.set("dir", val("dir", f.dir));
  p.set("page", String(val("page", S.page)));
  p.set("page_size", String(val("page_size", S.pageSize)));
  return p;
}

/* tolerate several server response shapes */
function rowsOf(resp) {
  if (Array.isArray(resp)) return resp;
  return resp.rows || resp.findings || resp.results || resp.items || [];
}
function totalOf(resp) {
  if (Array.isArray(resp)) return resp.length;
  const t = resp.total != null ? resp.total : resp.count;
  return t != null ? t : rowsOf(resp).length;
}
