/* ============ מגיה — findings.js: snippets, status writes, progress, the filter window ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ---------------------------------------------------------- snippets */

/* Locate the reviewed word inside its snippet.
 * The scanner builds snippets with ~45 chars of context on each side, so when a
 * word occurs more than once the *central* occurrence is the reviewed one —
 * plain indexOf() would highlight the wrong copy (~1% of findings). We also
 * prefer occurrences that stand as whole words over ones inside a longer word. */
const HEB_WORDCHAR = /[֐-׿‏‎'"׳״]/;
function locateWord(s, w) {
  if (!w) return -1;
  const mid = s.length / 2;
  let best = -1, bestScore = Infinity;
  for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) {
    const leftOk = i === 0 || !HEB_WORDCHAR.test(s[i - 1]);
    const rightOk = i + w.length >= s.length || !HEB_WORDCHAR.test(s[i + w.length]);
    // distance of the occurrence's centre from the snippet's centre
    let score = Math.abs(i + w.length / 2 - mid);
    if (!(leftOk && rightOk)) score += 1000; // whole-word matches win outright
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/* Character-level alignment of the wrong word against its correction.
 * Almost every finding here is a one-letter Hebrew confusion (ז/ח, ו/י, ר/ד,
 * ב/כ …), so showing only "red word → green word" makes the reviewer re-read
 * both words letter by letter. Aligning them lets us mark *just* the letters
 * that differ, which is what the eye should land on.
 *
 * Classic LCS backtrace. Words are short (< 20 chars), so the O(n·m) table is
 * free, and unlike a greedy scan it never mis-pairs a shifted insertion.
 * Returns two arrays of {ch, same} — one per word, in logical (not visual)
 * order; the browser's bidi algorithm handles RTL presentation. */
function diffChars(a, b) {
  a = a == null ? "" : String(a);
  b = b == null ? "" : String(b);
  const n = a.length, m = b.length;
  // Guard: pathological input shouldn't build a huge table.
  if (!n || !m || n * m > 40000) {
    return [[{ ch: a, same: false }], [{ ch: b, same: false }]];
  }
  const L = [];
  for (let i = 0; i <= n; i++) L.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const A = [], B = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { A.push({ ch: a[i], same: true }); B.push({ ch: b[j], same: true }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { A.push({ ch: a[i], same: false }); i++; }
    else { B.push({ ch: b[j], same: false }); j++; }
  }
  while (i < n) { A.push({ ch: a[i], same: false }); i++; }
  while (j < m) { B.push({ ch: b[j], same: false }); j++; }
  return [A, B];
}

/* Collapse a diff array into <span>s, merging runs so the DOM stays small and
 * — more importantly — so adjacent changed letters read as one blob rather
 * than a row of separately-boxed characters. */
function diffSpans(parts, kind) {
  const out = [];
  let buf = "", bufSame = null;
  const flush = () => {
    if (!buf) return;
    if (bufSame) {
      out.push(document.createTextNode(buf));
    } else {
      // A changed run that is pure whitespace would be invisible, so show the
      // open-box glyph instead — that is the whole finding for the 56k
      // missing_space / extra_space rows.
      const blank = /^\s+$/.test(buf);
      out.push(el("span", { class: "dc dc-" + kind + (blank ? " dc-space" : "") },
                  blank ? "␣" : buf));
    }
    buf = "";
  };
  for (const p of parts) {
    if (p.same !== bufSame) { flush(); bufSame = p.same; }
    buf += p.ch;
  }
  flush();
  return out;
}

/* A word rendered with its differing letters marked, against `other`.
 * `kind` only picks the colour ("err" | "fix") — the marked letters always
 * come from `word` itself, which is diffChars' FIRST return value. (Taking the
 * second for "fix" marks the other word's letters: for יותבת→יושבת that
 * highlighted ת in the correction instead of ש.) */
function wordDiffNode(word, other, kind, cls) {
  const parts = diffChars(word, other)[0];
  const b = el("bdi", { class: cls || null });
  b.append(...diffSpans(parts, kind));
  return b;
}

/* `repl` = replacement to show instead of the word (the "after" rendering).
 * `counter` = the other side of the pair, used only to mark differing letters. */
function renderSnippet(snippet, word, repl, counter) {
  const b = el("bdi");
  const s = snippet == null ? "" : String(snippet);
  if (!s) { b.textContent = "—"; return b; }
  const w = word == null ? "" : String(word);
  const i = locateWord(s, w);
  if (i < 0) { b.textContent = s; return b; }
  b.append(s.slice(0, i));
  const shown = repl != null ? repl : w;
  const kind = repl != null ? "fix" : "err";
  const other = counter != null ? counter : (repl != null ? w : "");
  if (other && other !== shown) {
    b.append(wordDiffNode(shown, other, kind, "hl-" + kind));
  } else {
    b.append(el("span", { class: "hl-" + kind }, shown));
  }
  b.append(s.slice(i + w.length));
  return b;
}

/* ---- the focus line: sentence with the swap stacked in place -------------
 * The reviewer's real task is "is this one letter wrong?", so the sentence must
 * stay a single continuous reading line. At the error we open one shared column:
 * the original word sits raised above the baseline, the correction drops below
 * it, both centred on the same horizontal slot. The eye tracks the sentence
 * straight through and takes the swap in without leaving the line — far faster
 * than comparing two separate before/after paragraphs.
 *
 * The two stacked words are width-matched by the grid, so their letters line up
 * vertically and the differing letter shows up as a break in the column. */
function renderFocusLine(row) {
  const s = row.snippet == null ? "" : String(row.snippet);
  const w = row.word == null ? "" : String(row.word);
  const fix = effFix(row) || "";
  const line = el("div", { class: "focus-line" });
  if (!s) {
    line.append(el("bdi", { class: "fl-text" }, w || "—"));
    return line;
  }
  const i = locateWord(s, w);
  if (i < 0 || !w) {
    line.append(el("bdi", { class: "fl-text" }, s));
    return line;
  }
  const before = s.slice(0, i);
  const after = s.slice(i + w.length);
  const [A, B] = diffChars(w, fix);

  const swap = el("span", { class: "fl-swap" + (fix ? "" : " no-fix") });
  const errW = el("bdi", { class: "fl-word fl-err" });
  errW.append(...diffSpans(A, "err"));
  swap.append(errW);
  if (fix) {
    swap.append(el("span", { class: "fl-rule" }));
    const fixW = el("bdi", { class: "fl-word fl-fix" });
    fixW.append(...diffSpans(B, "fix"));
    swap.append(fixW);
  }
  line.append(el("bdi", { class: "fl-text" }, before), swap, el("bdi", { class: "fl-text" }, after));
  return line;
}

/* Shrink the focus line until the sentence fits on a single row.
 * Wrapping would defeat the whole design, and horizontal scrolling would make
 * the reviewer drag the sentence around, so we scale the type down instead —
 * down to a floor where it is still comfortably larger than body text. */
const FL_MAX = 25, FL_MIN = 13;
window.addEventListener("resize", debounce(() => {
  for (const line of $$(".focus-line")) fitFocusLine(line);
}, 120));
function fitFocusLine(line, max) {
  if (!line || !line.isConnected || !line.clientWidth) return;
  let size = max || Number(line.dataset.flMax) || FL_MAX;
  line.style.setProperty("--fl-size", size + "px");
  // scrollWidth > clientWidth means the nowrap line overflows its box
  let guard = 0;
  while (line.scrollWidth > line.clientWidth && size > FL_MIN && guard++ < 40) {
    size -= 1;
    line.style.setProperty("--fl-size", size + "px");
  }
}

/* ---------------------------------------------------------- status writes */
/* Optimistic update with rollback (§6 robustness). */
function localRowsById(ids) {
  const set = new Set(ids);
  const found = [];
  for (const r of S.tableRows) if (set.has(r.id)) found.push(r);
  if (S.cq) for (const r of S.cq.queue.concat(S.cq.skipped)) if (set.has(r.id)) found.push(r);
  for (const r of S.fixRows) if (set.has(r.id)) found.push(r);
  return found;
}

async function setStatus(ids, status, opts) {
  opts = opts || {};
  const rows = localRowsById(ids);
  const snapshot = rows.map(r => [r, effStatus(r), r.custom_suggestion, r.note]);
  // optimistic
  for (const r of rows) {
    r.effective_status = status;
    if (opts.custom_suggestion !== undefined) r.custom_suggestion = opts.custom_suggestion;
    if (opts.note !== undefined) r.note = opts.note;
  }
  repaintStatuses(ids);
  const body = { ids, status };
  if (opts.note !== undefined) body.note = opts.note;
  if (opts.custom_suggestion !== undefined) body.custom_suggestion = opts.custom_suggestion;
  if (opts.scope) body.scope = opts.scope;
  if (opts.expect_status) body.expect_status = opts.expect_status;
  try {
    const resp = await api("/api/status", { method: "POST", body });
    S.sessionActions += ids.length;
    // a no-op write has no server history entry, so no undo step either
    if (writeChanged(resp)) {
      S.lastActions.push({ ids, rows: rows.slice(), snapshot, status });
      if (S.lastActions.length > 60) S.lastActions.shift();
    }
    updateSessionCounter();
    updateProgress();
    if (bookPaneShown()) loadBooks();   // the books column's pending counts moved
    if (resp && resp.warnings) for (const w of resp.warnings) toast(w, "err", 8000);
    return resp;
  } catch (e) {
    for (const [r, st, cs, nt] of snapshot) { r.effective_status = st; r.custom_suggestion = cs; r.note = nt; }
    repaintStatuses(ids);
    // a conflict is not a failure: the server says who decided it meanwhile
    if (e.status === 409 && e.code === "status_conflict") toast(e.message, "warn", 8000);
    else toast("שמירת הסטטוס נכשלה: " + e.message, "err");
    throw e;
  }
}

/* `ids`, when given, are the findings that just changed status. For the
 * fixer we patch just those rows/lines in place rather than rebuilding the
 * whole (possibly huge) worklist and document pane on every click — see
 * patchFixRowById / patchFixDocLineFor. A full rebuild only happens when the
 * current status filter means the change could have moved a row in/out of
 * view, or when no ids are given (bulk/unknown change). */
function repaintStatuses(ids) {
  if (S.view === "table") renderTableRows();   // also redraws the focus pane
  if (S.view !== "fixer") return;
  const editable = !!(S.fixDoc && S.fixDoc.editable);
  if (ids && ids.length && canPatchFixRows()) {
    let ok = true;
    for (const id of ids) {
      if (!patchFixRowById(id, editable)) { ok = false; break; }
      patchFixDocLineFor(id);
    }
    if (ok) {
      syncFixViewSelect();   // keeps the per-status counts in the dropdown honest
      updateFixProgress();
      updateApplyButton();
      return;
    }
  }
  renderFixList(false);
  renderFixDoc();
}

async function doUndo() {
  try {
    const resp = await api("/api/undo", { method: "POST" });
    const last = S.lastActions.pop();
    if (last) {
      for (const [r, st, cs, nt] of last.snapshot) { r.effective_status = st; r.custom_suggestion = cs; r.note = nt; }
      // put the finding back at the head of the card queue
      if (S.view === "cards" && S.cq && last.rows.length === 1) {
        S.cq.restore(last.rows[0]);
        renderCard();
      }
    }
    // the server's word on what each finding is now (an approval brought
    // back onto a changed suggestion returns as pending, not approved)
    for (const e of (resp && resp.entries) || []) {
      if (e.finding_id == null) continue;
      for (const r of localRowsById([e.finding_id])) r.effective_status = e.restored;
    }
    if (S.view === "cards") renderCard();
    let msg = "הפעולה האחרונה בוטלה";
    if (resp && resp.reverted != null) msg += " (" + fmtNum(resp.reverted) + " ממצאים)";
    toast(msg, "ok");
    // The server flags an undo whose correction is already ON DISK. Undoing a
    // status does NOT rewrite the book, and a corrector who is not told that
    // will assume the file went back too — so say it loudly, and in the fixer
    // leave it on screen next to the button that WOULD revert the file.
    if (resp && resp.file_warning) {
      toast(resp.file_warning, "err", 12000);
      if (S.view === "fixer") setFixBanner(resp.file_warning, "err");
    }
    repaintStatuses();
    updateProgress();
    if (S.view === "table") { loadTable(); if (bookPaneShown()) loadBooks(); }   // the books column counts moved back
  } catch (e) {
    toast("הביטול נכשל: " + e.message, "err");
  }
}

/* ---------------------------------------------------------- progress */
const updateProgress = debounce(async function () {
  try {
    const base = filterParams({ statuses: [], page: 1, page_size: 1 });
    const pend = filterParams({ statuses: ["pending"], page: 1, page_size: 1 });
    const [allR, pendR] = await Promise.all([api("/api/findings?" + base), api("/api/findings?" + pend)]);
    const total = totalOf(allR), pending = totalOf(pendR);
    const done = Math.max(0, total - pending);
    S.progDone = done; S.progTotal = total;
    if (S.view === "cards" && typeof renderCardMeta === "function") renderCardMeta();
    $("#progressPill").textContent = "טופלו " + fmtNum(done) + " מתוך " + fmtNum(total);
    $("#progressPill").title = "בסינון הנוכחי (ללא סינון סטטוס)";
  } catch (e) { /* silent */ }
}, 400);

function updateSessionCounter() {
  $("#sessionCounter").textContent = S.sessionActions ? "פעולות במושב זה: " + fmtNum(S.sessionActions) : "";
}

/* ---------------------------------------------------------- sidebar */
function syncFilterControls() {
  const f = S.filters;
  $("#fOrigin").value = f.origin;
  $("#fixOrigin").value = f.origin;
  $("#fVerified").checked = f.verified;
  $("#fMinRank").value = f.min_rank;
  $("#fMinRankVal").value = f.min_rank;
  $("#fSort").value = f.sort + ":" + f.dir;
  $("#globalSearch").value = f.q;
  $$("#fErrtypes input[type=checkbox]").forEach(c => { c.checked = f.errtypes.includes(c.value); });
  $$("#fStatuses input[type=checkbox]").forEach(c => { c.checked = f.statuses.includes(c.value); });
  $$("#fBookList .book-item").forEach(b => {
    b.classList.toggle("selected", b.dataset.key === f.book);
    b.setAttribute("aria-pressed", b.dataset.key === f.book ? "true" : "false");
  });
  $("#fixInclude").checked = S.fixInclude;
  if ($("#fixBook")) $("#fixBook").value = S.fixKey;
  syncModeButtons();
  syncFixViewSelect();
}

function buildSidebar() {
  const m = S.meta;
  // origins
  const sel = $("#fOrigin");
  sel.replaceChildren(el("option", { value: "" }, "כל המאגרים"));
  for (const o of (m.origins || [])) {
    sel.append(el("option", { value: o.name }, (o.hebrew || o.name) + (o.count != null ? " (" + fmtNum(o.count) + ")" : "")));
  }
  // the fixer's own copy of the origin choice
  const fsel = $("#fixOrigin");
  // no counts here and no "no origin" entry: the fixer needs a named origin
  fsel.replaceChildren(el("option", { value: "" }, "כל המאגרים"),
    ...(m.origins || []).filter(o => o.name !== NO_ORIGIN).map(o => el("option", { value: o.name }, o.hebrew || o.name)));
  fsel.value = S.filters.origin;
  // errtypes
  const et = $("#fErrtypes");
  et.replaceChildren();
  for (const e of (m.errtypes || [])) {
    const cnt = e.pending_count != null ? fmtNum(e.pending_count) + " ממתינים" : (e.count != null ? fmtNum(e.count) : "");
    const lb = el("label", { class: "chk-row", title: e.explanation || "", dataset: { key: e.key } },
      el("input", { type: "checkbox", value: e.key }),
      el("span", null, e.hebrew || e.key),
      el("span", { class: "cnt" }, cnt));
    lb.querySelector("input").addEventListener("change", onErrtypeChange);
    et.append(lb);
  }
  // statuses
  const st = $("#fStatuses");
  st.replaceChildren();
  for (const s of statuses()) {
    const lb = el("label", { class: "chk-row", dataset: { key: s.key } },
      el("input", { type: "checkbox", value: s.key }),
      el("span", null, s.icon + " " + s.hebrew),
      el("span", { class: "cnt" }));
    lb.querySelector("input").addEventListener("change", onStatusFilterChange);
    st.append(lb);
  }
  syncFilterControls();
  renderFacetCounts();
  if (filterDialogOpen()) loadFacets();
}

function onErrtypeChange() {
  S.filters.errtypes = $$("#fErrtypes input:checked").map(c => c.value);
  filtersChanged();
}
function onStatusFilterChange() {
  S.filters.statuses = $$("#fStatuses input:checked").map(c => c.value);
  filtersChanged();
}
/* ---- active filters: what is the list narrowed by, one click to undo each ---- */
const DEFAULT_FILTERS = () => ({ origin: "", book: "", errtypes: [], statuses: [], verified: false, min_rank: 0, q: "", sort: "rank", dir: "desc" });

/* Titles of the books seen so far, by key: the chip of a chosen book keeps its
 * name even when the book has no findings under the other filters and so is
 * no longer in the list the server sends. */
const BOOK_NAMES = new Map();
function bookName(key) { return BOOK_NAMES.get(key) || key; }

/* The two "hide" switches narrow the list too, so they are chips like the rest
 * (kind "hide"). They are a standing preference of this browser, which is why
 * "clear filters" leaves them alone and only their own chip turns them off. */
function applyHide(prop, value) {
  S[prop] = !!value;
  const ids = prop === "hideIrr" ? ["#fHideIrr", "#fixHideIrrelevant"] : ["#fHideDb", "#fixHideExportOnly"];
  for (const id of ids) { const box = $(id); if (box) box.checked = S[prop]; }
  try { localStorage.setItem("magiah_" + prop, S[prop] ? "1" : "0"); } catch (e) {}
  renderFixBookOptions();
}

function activeFilterChips() {
  const f = S.filters, chips = [];
  // `clear` runs later, so it reads S.filters then (clearFilters replaces the object)
  const add = (label, clear, kind) => chips.push({ label, clear, kind: kind || "filter" });
  if (f.q) add("חיפוש: " + f.q, () => { S.filters.q = ""; });
  if (f.origin) add("מאגר: " + (originInfo(f.origin).hebrew || f.origin), () => { S.filters.origin = ""; });
  if (f.book) add("ספר: " + bookName(f.book), () => { S.filters.book = ""; });
  for (const k of f.errtypes) add(errtypeInfo(k).hebrew || k, () => { S.filters.errtypes = S.filters.errtypes.filter(x => x !== k); });
  for (const k of f.statuses) add("סטטוס: " + statusInfo(k).hebrew, () => { S.filters.statuses = S.filters.statuses.filter(x => x !== k); });
  if (f.verified) add("מאומתים בלבד", () => { S.filters.verified = false; });
  if (f.min_rank) add("ציון מ־" + fmtRank(f.min_rank), () => { S.filters.min_rank = 0; });
  if (S.hideIrr) add("מוסתר: נתיבי «לא רלוונטי»", () => applyHide("hideIrr", false), "hide");
  if (S.hideDb) add("מוסתר: ספרים לייצוא בלבד", () => applyHide("hideDb", false), "hide");
  return chips;
}

/* "Clear filters": every filter back to its default. The hide switches stay. */
function clearFilters() {
  S.filters = DEFAULT_FILTERS();
  setBookQuery("");
  syncFilterControls();
  loadBooks();
  filtersChanged();
}

function renderActiveFilters() {
  const all = activeFilterChips();
  const n = all.length;
  // the button that opens the filter window carries the number
  const btn = $("#btnSidebar");
  if (btn) {
    $("#filterBtnCount").textContent = n ? fmtNum(n) : "";
    btn.classList.toggle("has-filters", n > 0);
    btn.setAttribute("aria-label", n ? "סינון הממצאים, " + fmtNum(n) + " מסננים פעילים" : "סינון הממצאים");
  }
  const box = $("#activeFilters");
  if (!box) return;
  const chips = (S.view === "table" || S.view === "cards") ? all : [];
  box.hidden = !chips.length;
  // loadBooks() calls this again when the book titles arrive: rebuilding an
  // unchanged row of chips would throw away the keyboard focus on one of them
  const sig = chips.map(c => c.kind + ":" + c.label).join("\n");
  if (box.dataset.sig === sig && box.childElementCount) return;
  box.dataset.sig = sig;
  box.replaceChildren(...chips.map(c => {
    const b = el("button", { type: "button", class: "fchip", "aria-label": "הסר סינון: " + c.label },
      el("span", null, c.label), icon("x"));
    b.addEventListener("click", () => {
      c.clear();
      setBookQuery("");
      syncFilterControls();
      loadBooks();
      filtersChanged();
      // the chip that had focus is gone: keep the keyboard where it was
      ($("#activeFilters .fchip") || $("#btnSidebar")).focus();
    });
    return b;
  }));
  if (chips.some(c => c.kind === "filter") && chips.length > 1) {
    const clr = el("button", { type: "button", class: "fchip-clear", title: "מסיר את המסננים; מתגי ההסתרה נשארים כפי שהם" }, "נקה סינון");
    clr.addEventListener("click", () => { clearFilters(); $("#btnSidebar").focus(); });
    box.append(clr);
  }
}

function filtersChanged() {
  renderActiveFilters();
  S.page = 1;
  S.sel.clear();
  S.cardStale = true;
  writeHash();
  refreshCurrentView();
  updateProgress();
  // the counts are only fetched where somebody reads them
  if (filterDialogOpen()) loadFacets();
  if (filterDialogOpen() || bookPaneShown()) loadBooks();
  renderFacetCounts();
}

/* ---- counts: asked of the server with the list's own parameters ---- */
/* The query the list is built from, minus paging and sorting. /api/facets
 * counts every group under all of these except the group's own filter, so
 * the number beside an entry is what choosing that entry shows. */
function facetQuery() {
  const p = filterParams({});
  for (const k of ["sort", "dir", "page", "page_size"]) p.delete(k);
  return p;
}
S.facets = null;          // the last /api/facets answer ...
S.facetsKey = "";         // ... and the query it answered
S.facetsFailed = false;
let facetSeq = 0;
function facetsFresh() {
  return !!S.facets && S.facetsKey === facetQuery().toString();
}
/* The list's total under the current filters, or null while unknown. */
function facetsTotal() { return facetsFresh() ? S.facets.total : null; }

const loadFacets = debounce(async function () {
  const seq = ++facetSeq, key = facetQuery().toString();
  try {
    const resp = await api("/api/facets?" + key);
    if (seq !== facetSeq) return;
    S.facets = resp; S.facetsKey = key; S.facetsFailed = false;
  } catch (e) {
    if (seq !== facetSeq) return;
    S.facets = null; S.facetsKey = ""; S.facetsFailed = true;
  }
  renderFacetCounts();
  // a card view that is waiting on the total can now say why it is empty
  if (S.view === "cards" && !currentCard()) renderCard();
}, 120);

function renderFacetCounts() {
  const body = $("#filterBody");
  if (!body) return;
  // counts of an older query are not shown while the new ones are on the way
  const fresh = facetsFresh(), f = fresh ? S.facets : null;
  body.setAttribute("aria-busy", fresh ? "false" : "true");
  body.classList.toggle("stale", !fresh);
  const origins = new Map(), errs = new Map(), sts = new Map();
  if (f) {
    for (const o of f.origins) origins.set(o.name, o);
    for (const e of f.errtypes) errs.set(e.key, e);
    for (const x of f.statuses) sts.set(x.key, x.count);
  }
  // origins: the select's own options
  const sel = $("#fOrigin");
  for (const opt of sel.options) {
    if (!opt.value) {
      const sum = f ? f.origins.reduce((a, o) => a + o.count, 0) : null;
      opt.textContent = "כל המאגרים" + (sum != null ? " (" + fmtNum(sum) + ")" : "");
      continue;
    }
    const o = originInfo(opt.value);
    const c = origins.get(opt.value);
    opt.textContent = (o.hebrew || opt.value) + (f ? " (" + fmtNum(c ? c.count : 0) + ")" : "");
  }
  // error types: "pending of count", or just 0
  for (const row of $$("#fErrtypes .chk-row")) {
    const cnt = $(".cnt", row), e = errs.get(row.dataset.key);
    if (!f) { cnt.textContent = ""; cnt.classList.remove("zero"); continue; }
    const n = e ? e.count : 0;
    cnt.textContent = n ? fmtNum(e.pending_count) + " ממתינים מתוך " + fmtNum(n) : "0";
    cnt.classList.toggle("zero", !n);
  }
  for (const row of $$("#fStatuses .chk-row")) {
    const cnt = $(".cnt", row);
    const n = f ? (sts.get(row.dataset.key) || 0) : null;
    cnt.textContent = n == null ? "" : fmtNum(n);
    cnt.classList.toggle("zero", n === 0);
  }
  // the window's summary and the button that closes it
  const res = $("#filterResults"), done = $("#filterDone");
  if (S.facetsFailed) { res.textContent = "הספירות לא נטענו"; done.textContent = "הצג ממצאים"; return; }
  if (!fresh) { res.textContent = "מעדכן…"; return; }
  res.textContent = fmtNum(f.total) + " ממצאים";
  done.textContent = f.total ? "הצג " + fmtNum(f.total) + " ממצאים" : "אין ממצאים";
}

/* ---- the filter window ---- */
function filterDialogOpen() { return $("#sidebar").classList.contains("visible"); }
function openFilterDialog() {
  if (filterDialogOpen()) return;
  $("#sidebar").classList.add("visible");
  $("#filterScrim").classList.add("visible");
  $("#btnSidebar").setAttribute("aria-expanded", "true");
  openLayer($("#sidebar"), "#btnSidebar");
  renderFacetCounts();
  loadFacets();
  loadBooks();
}
function closeFilterDialog() {
  if (!filterDialogOpen()) return;
  $("#sidebar").classList.remove("visible");
  $("#filterScrim").classList.remove("visible");
  $("#btnSidebar").setAttribute("aria-expanded", "false");
  closeLayer($("#sidebar"));
}

/* ---- the list is empty: say so, say why if the hidden books are the reason,
 * and offer the way back ---- */
function emptyFilterState() {
  const hasFilters = activeFilterChips().some(c => c.kind === "filter");
  const hint = el("p", { class: "es-hint" });
  const actions = el("div", { class: "es-actions" });
  const box = el("div", { class: "empty-state", role: "status" },
    icon("inbox", "ic-lg"), el("p", null, "אין ממצאים בסינון הנוכחי"), hint, actions);
  if (hasFilters) {
    const b = el("button", { type: "button", class: "btn primary" }, "נקה סינון");
    b.addEventListener("click", () => { clearFilters(); $("#btnSidebar").focus(); });
    actions.append(b);
  }
  // would the books the hide switches keep out bring results back?
  if (S.hideIrr || S.hideDb) {
    const p = facetQuery();
    p.delete("hide_irr"); p.delete("hide_db");
    api("/api/facets?" + p).then(r => {
      if (!r || !r.total) return;
      hint.textContent = "יש " + fmtNum(r.total) + " ממצאים בספרים שהוסתרו (נתיבי «לא רלוונטי» או ספרים לייצוא בלבד).";
      const show = el("button", { type: "button", class: "btn" }, "הצג גם את המוסתרים");
      show.addEventListener("click", () => {
        applyHide("hideIrr", false); applyHide("hideDb", false);
        loadBooks(); filtersChanged();
        $("#btnSidebar").focus();
      });
      actions.append(show);
    }).catch(() => {});
  }
  return box;
}

/* books list */
let bookSeq = 0;
/* The book list lives in two places that show the same books: the filter
 * window (#fBookList) and, on a wide review screen, the books column
 * (#bpList). One query box value (S.bookQ) feeds both. */
const bookBoxes = () => [$("#fBookList"), $("#bpList")].filter(Boolean);
function setBookQuery(v) {
  S.bookQ = v;
  for (const id of ["#fBookSearch", "#bpSearch"]) { const i = $(id); if (i && i.value !== v) i.value = v; }
}
function renderBookLists(books) {
  for (const box of bookBoxes()) renderBookItems(box, books);
  const n = $("#bpCount");
  if (n) n.textContent = books.length ? fmtNum(books.length) + " ספרים" : "";
}
function renderBookItems(box, books) {
  box.replaceChildren();
  if (box.id === "bpList") {
    // the books column starts with "all books": choosing it clears the book filter
    const all = el("div", { class: "book-item" + (S.filters.book ? "" : " selected"), dataset: { key: "" } },
      el("span", { class: "bname" }, "כל הספרים"));
    const pickAll = () => { if (!S.filters.book) return; S.filters.book = ""; syncFilterControls(); filtersChanged(); };
    all.addEventListener("click", pickAll);
    makeActivatable(all, pickAll, "button");
    all.setAttribute("aria-pressed", S.filters.book ? "false" : "true");
    box.append(all);
  }
  if (!books.length) { box.append(el("div", { class: "empty" }, "לא נמצאו ספרים")); return books; }
  // several books can share a title: filter by the stable key, and show
  // the key next to a title that is not unique
  const titleCount = new Map();
  for (const b of books) titleCount.set(b.source, (titleCount.get(b.source) || 0) + 1);
  for (const b of books.slice(0, 300)) {
    const name = b.name || b.source || String(b);
    const key = b.key || name;
    const label = titleCount.get(b.source) > 1 ? name + " — " + key : name;
    const pending = b.pending_count != null ? b.pending_count : b.pending;
    const cnt = b.count ? (pending != null ? fmtNum(pending) + " ממתינים מתוך " : "") + fmtNum(b.count) : "0";
    const item = el("div", { class: "book-item" + (S.filters.book === key ? " selected" : ""), dataset: { key } },
      el("span", { class: "bname", title: label }, el("bdi", null, label)),
      el("span", { class: "bcount" }, cnt));
    const pick = () => {
      S.filters.book = S.filters.book === key ? "" : key;
      syncFilterControls();
      filtersChanged();
    };
    item.addEventListener("click", pick);
    makeActivatable(item, pick, "button");
    item.setAttribute("aria-pressed", S.filters.book === key ? "true" : "false");
    box.append(item);
  }
  if (books.length > 300) {
    box.append(el("div", { class: "empty" }, "מוצגים 300 הראשונים מתוך " + fmtNum(books.length) + " — צמצם בחיפוש"));
  }
}


/* Returns the books of this very request; null when it failed, undefined when
 * a newer request replaced it. A caller never acts on an older list. */
async function loadBooksNow() {
  const q = (S.bookQ || "").trim();
  // the list's own filters, so a book's count is what choosing it shows
  // (the server leaves the book filter itself out). `q` there is the title
  // search; the free-text search of the list goes as `search`.
  const p = facetQuery();
  p.delete("book_key");
  const free = p.get("q");
  p.delete("q");
  if (free) p.set("search", free);
  if (q) p.set("q", q);
  // a slower answer to an older request must not replace a newer one
  const seq = ++bookSeq;
  try {
    const resp = await api("/api/books?" + p);
    if (seq !== bookSeq) return undefined;
    let books = Array.isArray(resp) ? resp : (resp.books || resp.rows || []);
    for (const b of books) BOOK_NAMES.set(b.key || b.name || b.source, b.source || b.name || b.key);
    // the chosen book stays on the list, with its 0, so it can be unchosen there
    if (S.filters.book && !q && !books.some(b => (b.key || b.name || b.source) === S.filters.book)) {
      books = [{ key: S.filters.book, source: bookName(S.filters.book), count: 0, pending_count: 0 }, ...books];
    }
    S.bookList = books;
    renderActiveFilters();
    renderBookLists(books);
    return books;
  } catch (e) {
    if (seq !== bookSeq) return undefined;
    for (const box of bookBoxes()) box.replaceChildren(el("div", { class: "empty" }, "טעינת הספרים נכשלה: " + e.message));
    const cnt = $("#bpCount"); if (cnt) cnt.textContent = "";
    return null;
  }
}
const loadBooks = debounce(loadBooksNow, 250);
