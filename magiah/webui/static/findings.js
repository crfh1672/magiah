/* ============ מגיה — findings.js: snippets, status writes, progress, sidebar filters ============
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
  if (S.view === "table") renderTableRows();
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
    if (S.view === "table") loadTable();
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
  if (f.min_rank || f.sort !== "rank" || f.dir !== "desc" || !S.hideIrr || S.hideDb) $("#fMore").open = true;
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
  // errtypes
  const et = $("#fErrtypes");
  et.replaceChildren();
  for (const e of (m.errtypes || [])) {
    const cnt = e.pending_count != null ? fmtNum(e.pending_count) + " ממתינים" : (e.count != null ? fmtNum(e.count) : "");
    const lb = el("label", { class: "chk-row", title: e.explanation || "" },
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
    const lb = el("label", { class: "chk-row" },
      el("input", { type: "checkbox", value: s.key }),
      el("span", null, s.icon + " " + s.hebrew));
    lb.querySelector("input").addEventListener("change", onStatusFilterChange);
    st.append(lb);
  }
  syncFilterControls();
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

function activeFilterChips() {
  const f = S.filters, chips = [];
  const add = (label, clear) => chips.push({ label, clear });
  if (f.q) add("חיפוש: " + f.q, () => { f.q = ""; });
  if (f.origin) add("מאגר: " + (originInfo(f.origin).hebrew || f.origin), () => { f.origin = ""; });
  if (f.book) {
    const b = S.bookList.find(x => (x.key || x.name || x.source) === f.book);
    add("ספר: " + (b ? (b.name || b.source) : f.book), () => { f.book = ""; });
  }
  for (const k of f.errtypes) add(errtypeInfo(k).hebrew || k, () => { f.errtypes = f.errtypes.filter(x => x !== k); });
  for (const k of f.statuses) add("סטטוס: " + statusInfo(k).hebrew, () => { f.statuses = f.statuses.filter(x => x !== k); });
  if (f.verified) add("מאומתים בלבד", () => { f.verified = false; });
  if (f.min_rank) add("ציון מ־" + fmtRank(f.min_rank), () => { f.min_rank = 0; });
  return chips;
}

function renderActiveFilters() {
  const box = $("#activeFilters");
  if (!box) return;
  const chips = (S.view === "table" || S.view === "cards") ? activeFilterChips() : [];
  box.hidden = !chips.length;
  box.replaceChildren(...chips.map(c => {
    const b = el("button", { type: "button", class: "fchip", "aria-label": "הסר סינון: " + c.label },
      el("span", null, c.label), icon("x"));
    b.addEventListener("click", () => {
      c.clear();
      $("#fBookSearch").value = "";
      syncFilterControls();
      loadBooks();
      filtersChanged();
    });
    return b;
  }));
  if (chips.length > 1) {
    const all = el("button", { type: "button", class: "fchip-clear" }, "נקה הכל");
    all.addEventListener("click", () => $("#btnClearFilters").click());
    box.append(all);
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
}

/* books list */
const loadBooks = debounce(async function () {
  const q = $("#fBookSearch").value.trim();
  const p = new URLSearchParams();
  if (S.filters.origin) p.set("origin", S.filters.origin);
  if (q) p.set("q", q);
  if (S.hideIrr) p.set("hide_irr", "1");
  if (S.hideDb) p.set("hide_db", "1");
  try {
    const resp = await api("/api/books?" + p);
    const books = Array.isArray(resp) ? resp : (resp.books || resp.rows || []);
    S.bookList = books;
    renderActiveFilters();
    const box = $("#fBookList");
    box.replaceChildren();
    if (!books.length) { box.append(el("div", { class: "empty" }, "לא נמצאו ספרים")); return; }
    // several books can share a title: filter by the stable key, and show
    // the key next to a title that is not unique
    const titleCount = new Map();
    for (const b of books) titleCount.set(b.source, (titleCount.get(b.source) || 0) + 1);
    for (const b of books.slice(0, 300)) {
      const name = b.name || b.source || String(b);
      const key = b.key || name;
      const label = titleCount.get(b.source) > 1 ? name + " — " + key : name;
      const pending = b.pending_count != null ? b.pending_count : b.pending;
      const cnt = (pending != null ? fmtNum(pending) + " ממתינים / " : "") + (b.count != null ? fmtNum(b.count) : "");
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
  } catch (e) {
    $("#fBookList").replaceChildren(el("div", { class: "empty" }, "טעינת הספרים נכשלה: " + e.message));
  }
}, 250);
