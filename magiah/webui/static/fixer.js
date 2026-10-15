/* ============ מגיה — fixer.js: fixer view: document pane, banners, worklist, apply ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ============================================================ fixer view
 * The corrector no longer leaves the tool to fix a book: the book's own .txt
 * is opened here, the findings are highlighted inside the real text, and the
 * approved corrections are written back into the file (after a backup).
 *
 * Every offset shown or sent comes from the SERVER. The browser never computes
 * where a word sits in the file — it can only echo back an anchor the server
 * already verified. That is what keeps a correction from ever landing on an
 * unrelated passage, which is the whole point of this screen.
 */
function fixBookLabel(b) {
  let s = b.title || b.key;
  if (b.folder) s += "  ·  " + b.folder;
  if (!b.editable) s += "  (מסד נתונים — ייצוא בלבד)";
  else if (!b.exists) s += "  (הקובץ חסר)";
  if (b.remaining != null) s += "  — נותרו " + fmtNum(b.remaining);
  return s;
}

async function loadFixerBooks() {
  try {
    const p = new URLSearchParams();
    if (S.filters.origin) p.set("origin", S.filters.origin);
    p.set("statuses", S.fixInclude ? "approved,unsure,pending" : "approved");
    const resp = await api("/api/fixer/books?" + p);
    S.fixBooks = resp.books || [];
  } catch (e) {
    toast("טעינת רשימת הספרים נכשלה: " + e.message, "err");
  }
  renderFixBookOptions();
}

/* A book filed under a "not relevant" folder (both common spellings) is not
 * work for the corrector; nor is a DB book, which can only be exported. */
const IRRELEVANT_RE = /לא[\s_-]*רלו?ונטי/;
function fixBookHidden(b) {
  if (S.hideDb && !b.editable) return true;
  if (S.hideIrr && IRRELEVANT_RE.test([b.path, b.key, b.folder].join("/"))) return true;
  return false;
}

/* The picker is filtered in the browser: the whole list is already here, and
 * a corrector hunting for one book among hundreds should not wait for a round
 * trip on every keystroke. The book currently open always stays listed, so
 * typing can never make the selection silently vanish. */
/* the books the search matches (hidden ones excluded); the open book is only
   ever added to the list on top of this, never counted */
function fixBookHits(q) {
  const books = (S.fixBooks || []).filter(b => !fixBookHidden(b));
  return q
    ? books.filter(b => (b.title || "").indexOf(q) >= 0 ||
                        (b.folder || "").indexOf(q) >= 0)
    : books;
}
function renderFixBookOptions() {
  const sel = $("#fixBook");
  if (!sel) return;
  const q = ($("#fixBookSearch") ? $("#fixBookSearch").value : "").trim();
  const all = S.fixBooks || [];
  const hits = fixBookHits(q);
  // the open book stays listed even when it does not match, so typing can
  // never make the current selection disappear — but it is not counted as a
  // search result, which would be a lie
  const shown = hits.slice();
  if (q && S.fixKey && !shown.some(b => b.key === S.fixKey)) {
    const open = all.find(b => b.key === S.fixKey);
    if (open) shown.push(open);
  }
  if (!q && S.fixKey && !shown.some(b => b.key === S.fixKey)) {
    const open = all.find(b => b.key === S.fixKey);
    if (open) shown.push(open);
  }
  sel.replaceChildren(el("option", { value: "" },
    q ? (hits.length ? "נמצאו " + fmtNum(hits.length) + " ספרים — בחר…"
                     : "לא נמצא ספר התואם לחיפוש")
      : "בחר ספר לתיקון…"));
  for (const b of shown) {
    sel.append(el("option", { value: b.key }, fixBookLabel(b)));
  }
  sel.value = S.fixKey || "";
}

function fixBookInfo(key) {
  return (S.fixBooks || []).find(b => b.key === (key || S.fixKey)) || null;
}

/* the write mode named in the URL, if any */
function hashMode() {
  const v = new URLSearchParams(location.hash.replace(/^#/, "")).get("fm");
  return v === "bracket" ? "bracket" : (v === "replace" ? "replace" : null);
}

async function loadFixDoc() {
  const list = $("#fixList");
  if (!S.fixKey) {
    S.fixDoc = null;
    S.fixRows = [];
    list.replaceChildren(el("div", { class: "fixer-empty" },
      "בחר ספר מהרשימה — הכלי יפתח את קובץ הטקסט עצמו ויסמן בו את המקומות לתיקון."));
    $("#fixDoc").replaceChildren();
    $("#fixDocPath").textContent = "";
    $("#fixDocMeta").textContent = "";
    setFixBanner(null);
    renderFixConflicts();
    updateFixProgress();
    updateApplyButton();
    return;
  }
  list.replaceChildren(el("div", { class: "fixer-empty" }, "טוען את הספר…"));
  const p = new URLSearchParams({
    key: S.fixKey,
    statuses: S.fixInclude ? "approved,unsure,pending" : "approved",
  });
  if (S.filters.origin) p.set("origin", S.filters.origin);
  // resolving an ambiguous occurrence is manual, per-word work; a reload
  // rebuilds the rows from the server, so carry those choices across
  const manual = new Map((S.fixRows || [])
    .filter(r => r.explicit).map(r => [r.id, r.explicit]));
  const requested = S.fixKey;
  try {
    const resp = await api("/api/fixer/doc?" + p);
    // a slow answer for a book that is no longer the open one must not
    // overwrite the rows and document of the current book
    if (requested !== S.fixKey) return;
    S.fixDoc = resp;
    S.fixRows = resp.items || [];
    for (const r of S.fixRows) {
      const e = manual.get(r.id);
      // only re-apply where the server still cannot place it itself; if it
      // now anchors on its own, its answer is the better one
      // ...and only on a line the server still offers for a manual pick
      if (e && r.anchor && !r.anchor.ok && e.lineno === r.lineno &&
          (r.anchor.manual_lines || []).indexOf(e.lineno) >= 0) {
        const line = (resp.lines || []).find(l => l.n === r.lineno);
        const txt = line ? line.text : "";
        r.explicit = e;
        r.anchor = { ok: true, start: e.start, end: e.end,
                     confidence: "manual",
                     needs_vocalization: VOCALIZED_RE.test(txt.slice(e.start, e.end)),
                     spans_markup: txt.slice(e.start, e.end).indexOf("<") >= 0 };
      }
    }
    S.fixLines = new Map((resp.lines || []).map(l => [l.n, l]));
    // an explicit #fm in the URL is a deliberate choice by whoever opened this
    // link, so it outranks the book's stored default
    S.fixMode = hashMode() || resp.default_mode || "replace";
    S.fixModeOverride = new Map();
    // Only APPROVED findings are pre-selected. A finding nobody has judged
    // yet must never be written into a book just because it was on screen —
    // the corrector opts in, per finding or with the quick-pick bar.
    S.fixPicked = new Set(S.fixRows
      .filter(r => canApply(r) && effStatus(r) === "approved")
      .map(r => r.id));
    S.fixDocStale = false;
    S.fixCurId = (S.fixRows[0] || {}).id ?? null;
    S.fixEdits = resp.edits || [];
    syncModeButtons();
    renderFixDoc();
    renderFixList(true);
    updateFixHead();
    renderFixConflicts();
    if (!resp.editable) {
      setFixBanner(resp.message || "ספר זה אינו קובץ טקסט — אפשר לייצא את התיקונים בלבד.", "err");
    } else {
      showBlockedBanner();
    }
  } catch (e) {
    if (requested !== S.fixKey) return;
    S.fixDoc = null;
    S.fixRows = [];
    list.replaceChildren(el("div", { class: "fixer-empty" }, "הטעינה נכשלה: " + e.message));
    setFixBanner(e.message, "err");
    renderFixConflicts();
  }
  updateApplyButton();
}

/* ---- which findings the worklist shows -------------------------------
 * The order is ALWAYS the order of the book (by line number). A corrector
 * works a book front to back, and re-ordering the list would make them lose
 * their place — so "show me the pending ones" narrows the list instead of
 * shuffling it. Whatever is shown stays in reading order.
 */
function fixViewOptions() {
  const counts = new Map();
  for (const r of S.fixRows) {
    const st = effStatus(r);
    counts.set("st:" + st, (counts.get("st:" + st) || 0) + 1);
    const et = r.errtype || "";
    if (et) counts.set("et:" + et, (counts.get("et:" + et) || 0) + 1);
  }
  const opts = [{ key: "", label: "הכל", n: S.fixRows.length }];
  const blocked = S.fixRows.filter(r => r.anchor && !r.anchor.ok).length;
  if (blocked) {
    opts.push({ key: "blocked", label: "⚠ דורשים אישור ידני", n: blocked });
  }
  for (const s of statuses()) {
    const n = counts.get("st:" + s.key) || 0;
    if (n) opts.push({ key: "st:" + s.key, label: s.icon + " " + s.hebrew, n });
  }
  for (const [k, n] of counts) {
    if (!k.startsWith("et:")) continue;
    const et = k.slice(3);
    opts.push({ key: k, label: errtypeInfo(et).hebrew || et, n });
  }
  return opts;
}

function visibleFixRows() {
  const f = S.fixView;
  if (!f) return S.fixRows;
  if (f === "blocked") {
    return S.fixRows.filter(r => r.anchor && !r.anchor.ok);
  }
  if (f.startsWith("st:")) {
    const st = f.slice(3);
    return S.fixRows.filter(r => effStatus(r) === st);
  }
  if (f.startsWith("et:")) {
    const et = f.slice(3);
    return S.fixRows.filter(r => (r.errtype || "") === et);
  }
  return S.fixRows;
}

/* the selected finding, and how to move the selection within the view */
function currentFixRow() {
  const view = visibleFixRows();
  if (S.fixCurId != null) {
    const hit = view.find(r => r.id === S.fixCurId);
    if (hit) return hit;
  }
  return view[0] || null;
}

function moveFixSelection(delta) {
  const view = visibleFixRows();
  if (!view.length) return;
  const cur = currentFixRow();
  const at = Math.max(0, view.findIndex(r => cur && r.id === cur.id));
  const next = view[Math.min(view.length - 1, Math.max(0, at + delta))];
  if (next) selectFixRowById(next.id);
}

/* a row can be written only when the server managed to anchor it */
function canApply(r) {
  // a word split by markup is refused by the server, and one such row would
  // abort the whole batch — so it is never offered or pre-selected
  return !!(r && r.anchor && r.anchor.ok && !r.anchor.spans_markup &&
            (r.correction || effFix(r)) &&
            effStatus(r) !== "fixed" && !needsVocalization(r));
}

/* nikud and teamim as patcher's normalize.has_marks counts them (marks and
 * the vocalized presentation forms) */
const VOCALIZED_RE = /[֑-ׇֽֿׁׂׅ̣ׄ̇͏יִ-ײַשׁ-פֿ]/;

/* The word in the file is vocalized and replace mode would write a plain
 * correction over it (the server's anchor.needs_vocalization, re-checked
 * against the correction and mode chosen here since). */
function needsVocalization(r) {
  if (!(r && r.anchor && r.anchor.ok && r.anchor.needs_vocalization)) return false;
  if (rowMode(r) !== "replace" || effStatus(r) === "fixed") return false;
  return !VOCALIZED_RE.test(r.correction || effFix(r) || "");
}

function rowMode(r) {
  return S.fixModeOverride.get(r.id) || S.fixMode;
}

/* -------------------------------------------------- the document pane */
function renderFixDoc() {
  const box = $("#fixDoc");
  box.replaceChildren();
  if (!S.fixDoc || !S.fixDoc.editable) return;
  const byLine = new Map();
  for (const r of S.fixRows) {
    if (r.lineno == null) continue;
    if (!byLine.has(r.lineno)) byLine.set(r.lineno, []);
    byLine.get(r.lineno).push(r);
  }
  const nums = [...S.fixLines.keys()].sort((a, b) => a - b);
  let prev = null;
  for (const n of nums) {
    // the pane may be windowed around the findings; say so rather than
    // letting the corrector think the book is shorter than it is
    if (prev != null && n > prev + 1) {
      box.append(el("div", { class: "fdoc-gap" },
        "… דילוג על " + fmtNum(n - prev - 1) + " שורות …"));
    }
    prev = n;
    box.append(fixDocLine(n, byLine.get(n) || []));
  }
  if (!nums.length) box.append(el("div", { class: "fixer-empty" }, "הקובץ ריק."));
}

/* Patch the one book line a status change actually touched, instead of
 * rebuilding every line the document pane has loaded. Safe unconditionally:
 * unlike the worklist, the doc pane has no status filter, so a status change
 * never adds/removes/reorders lines — only what's drawn on the one line. */
function patchFixDocLineFor(id) {
  const box = $("#fixDoc");
  const r = S.fixRows.find(x => x.id === id);
  if (!r || r.lineno == null) return false;
  const old = box.querySelector('.fdoc-line[data-n="' + r.lineno + '"]');
  if (!old) return false;
  const rows = S.fixRows.filter(x => x.lineno === r.lineno);
  old.replaceWith(fixDocLine(r.lineno, rows));
  return true;
}

function fixDocLine(n, rows) {
  const info = S.fixLines.get(n);
  const text = info ? info.text : "";
  const cur = currentFixRow();
  const line = el("div", {
    class: "fdoc-line" + (rows.length ? " has-fix" : "") +
      (rows.some(r => effStatus(r) === "fixed") ? " edited" : "") +
      (cur && cur.lineno === n ? " current" : ""),
    dataset: { n: String(n) },
  });
  line.append(el("span", { class: "fdoc-num" }, String(n + 1)));
  const body = el("bdi", { class: "fdoc-text" });

  // anchored highlights, spliced in from RIGHT to LEFT (descending offset) —
  // the same rule the writer uses, so what is shown is what will be written
  const anchored = rows.filter(r => r.anchor && r.anchor.ok)
    .sort((a, b) => b.anchor.start - a.anchor.start);
  let tail = text.length;
  const pieces = [];
  for (const r of anchored) {
    const a = r.anchor;
    if (a.end > tail) continue;                 // overlapping: skip the later
    pieces.unshift(text.slice(a.end, tail));
    pieces.unshift(fixHitNode(r, text.slice(a.start, a.end),
                              cur && cur.id === r.id));
    tail = a.start;
  }
  pieces.unshift(text.slice(0, tail));

  // A row the server refused to place is resolved by pointing at the word,
  // which turns the whole line into clickable tokens. That mode is driven by
  // the SELECTED row, not by whichever blocked row happens to be first:
  // otherwise a second blocked finding on the same line could never be
  // resolved, and the line's other — correctly anchored — marks would lose
  // their previews for as long as any one row on it stayed blocked.
  const pick = rows.find(r => r.anchor && !r.anchor.ok && cur &&
                         r.id === cur.id && Array.isArray(info && info.tokens));
  if (pick && info.tokens.length) {
    body.append(...tokenPickLine(text, info.tokens, pick));
  } else {
    for (const p of pieces) {
      body.append(typeof p === "string" ? document.createTextNode(p) : p);
    }
  }
  line.append(body);
  return line;
}

/* One marked word inside the book text.
 *
 * The corrector's question at every mark is "what goes and what comes?", so
 * the mark answers it in place, using the printer's convention: the original
 * struck through, the correction underlined right after it. Nothing is hidden
 * behind a tooltip — the line reads as the corrected sentence would, with the
 * old word still visible for comparison.
 *
 * In bracket mode the mark shows the literal string that will be written,
 * "(תיקון) [שגיאה]", because there the original stays in the book too.
 */
function fixHitNode(r, rawSlice, isCurrent) {
  const st = effStatus(r);
  const fix = r.correction || effFix(r) || "";
  const a = r.anchor || {};
  const mode = rowMode(r);
  const done = st === "fixed";
  const wrap = el("span", {
    class: "fdoc-hit st-" + st + (isCurrent ? " current" : "") +
      (a.confidence === "weak" ? " weak" : ""),
    dataset: { id: String(r.id) },
    title: statusInfo(st).hebrew + " — " + (r.word || "") + " ⇐ " + (fix || "—"),
  });
  // status marker, so a glance over the page says what was decided where
  wrap.append(el("span", { class: "fdoc-badge" }, statusInfo(st).icon));

  // Nothing is going to be written here, so showing a correction would be a
  // lie: a rejected or ignored finding leaves the book exactly as it is, and
  // an already-applied one is the book as it is. Show the word plainly.
  const keeps = st === "not_error" || st === "ignored";
  if (done || keeps || !fix) {
    wrap.append(el("bdi", { class: "fdoc-word" }, rawSlice));
  } else if (mode === "bracket") {
    wrap.append(el("bdi", { class: "fdoc-bracket" }, "(" + fix + ") [" + rawSlice + "]"));
  } else {
    wrap.append(el("bdi", { class: "fdoc-old" }, rawSlice),
                el("bdi", { class: "fdoc-new" }, fix));
  }
  wrap.addEventListener("click", ev => {
    ev.stopPropagation();
    selectFixRowById(r.id);
  });
  return wrap;
}

/* every token clickable, so an ambiguous finding can be resolved by hand */
function tokenPickLine(text, tokens, row) {
  const out = [];
  let pos = 0;
  for (const [a, b] of tokens) {
    if (a < pos) continue;
    out.push(document.createTextNode(text.slice(pos, a)));
    const t = el("span", { class: "fdoc-tok", title: "לחיצה תסמן שזה המופע לתיקון" },
      text.slice(a, b));
    t.addEventListener("click", ev => {
      ev.stopPropagation();
      resolveOccurrence(row, a, b);
    });
    out.push(t);
    pos = b;
  }
  out.push(document.createTextNode(text.slice(pos)));
  return out;
}

/* The human pointed at a word. `start`/`end` are a token span the SERVER sent
 * with this line, echoed back unchanged — the browser still never measures the
 * file. The server re-verifies the span really is this word before writing
 * (patcher.plan_edit's `explicit` branch), so a stale pick is caught there. */
function resolveOccurrence(row, start, end) {
  const lineText = (S.fixLines.get(row.lineno) || {}).text || "";
  const picked = lineText.slice(start, end);
  row.explicit = { start, end, lineno: row.lineno };
  row.anchor = { ok: true, start, end, confidence: "manual",
                 needs_vocalization: VOCALIZED_RE.test(picked),
                 spans_markup: picked.indexOf("<") >= 0 };
  // Pointing at a word says WHERE, not WHETHER. Arming an undecided finding
  // on a locational click would write into a book something nobody judged.
  if (effStatus(row) === "approved") S.fixPicked.add(row.id);
  toast(effStatus(row) === "approved"
    ? "המופע סומן: «" + picked + "» — התיקון יוחל כאן בלבד"
    : "המופע סומן: «" + picked + "». הממצא עדיין לא אושר — יש לאשר אותו כדי שייכלל בתיקון.",
    "ok", 6000);
  renderFixDoc();
  renderFixList(false);
  updateApplyButton();
  showBlockedBanner();
}

/* Bring the finding into view — the WORD, not the top of its paragraph.
 * Book lines can run for hundreds of characters, so scrolling to the line
 * often left the marked word far below the fold, which is the opposite of
 * the point. Scroll to the mark itself when it exists. */
function scrollDocToLine(n, id) {
  const doc = $("#fixDoc");
  if (!doc) return;
  const line = doc.querySelector(".fdoc-line[data-n='" + n + "']");
  if (!line) return;
  const hit = id != null
    ? line.querySelector(".fdoc-hit[data-id='" + id + "']")
    : line.querySelector(".fdoc-hit");
  (hit || line).scrollIntoView({ block: "center", inline: "center",
                                 behavior: "smooth" });
}

function updateFixHead() {
  const b = fixBookInfo();
  const d = S.fixDoc;
  $("#fixDocPath").textContent = (d && d.book && d.book.path) || (b && b.path) || "";
  if (!d || !d.editable) { $("#fixDocMeta").textContent = ""; return; }
  const bits = [fmtNum(d.line_count) + " שורות", d.encoding];
  if (d.windowed) bits.push("תצוגה מקוצרת סביב הממצאים");
  $("#fixDocMeta").textContent = bits.join(" · ");
}

/* -------------------------------------------------- banners */
/* Result status (UI_SPEC §9f): are the findings on screen the latest scan's?
   It is derived from the output folder, not from this page, so it survives
   a reload and a server restart; it cannot be dismissed — it goes away when a
   scan succeeds. One block per notice, worst first, as /api/meta sends them. */
const RESULT_ICONS = { error: "⚠", warning: "⚠", info: "ℹ" };
const openScanSection = id => () => {
  openScanModal();
  const d = $(id); if (d) d.open = true;
};
const RESULT_ACTIONS = {
  scan: openScanSection("#scanRunSection"),
  book_scan: openScanSection("#bookScanSection"),
  refresh: () => refreshFindings(),
};

function renderResultBanner() {
  const box = $("#resultBanner");
  const rs = S.meta && S.meta.result_status;
  const notices = (rs && rs.notices) || [];
  box.hidden = !notices.length;
  box.replaceChildren(...notices.map(n => {
    const body = el("div", { class: "rb-body" },
      el("div", { class: "rb-title" }, n.title),
      el("div", { class: "rb-text" }, n.text));
    if (n.hint) body.append(el("div", { class: "rb-hint" }, el("b", null, "מה לעשות: "), n.hint));
    if (n.details) body.append(el("details", { class: "rb-details" },
      el("summary", null, "פרטים"), el("div", { class: "rb-reason" }, n.details)));
    const run = RESULT_ACTIONS[n.action];
    return el("div", { class: "rb-notice rb-" + n.level },
      el("div", { class: "rb-icon", "aria-hidden": "true" }, RESULT_ICONS[n.level] || "ℹ"),
      body,
      run && n.action_label ? el("button", { class: "btn rb-action", onclick: run }, n.action_label) : null);
  }));
}

/* Re-read the result status after a scan ends, leaving the page as it is. */
async function reloadResultStatus() {
  try { S.meta = await api("/api/meta"); } catch (e) { return; }
  renderResultBanner();
}

function setFixBanner(node, kind) {
  const bn = $("#fixerBanner");
  if (!node) { bn.hidden = true; bn.replaceChildren(); return; }
  bn.hidden = false;
  bn.className = kind || "";
  bn.replaceChildren(typeof node === "string"
    ? el("div", { class: "bn-text" }, node) : node);
}

function showBlockedBanner() {
  const blocked = S.fixRows.filter(r => r.anchor && !r.anchor.ok &&
                                   effStatus(r) !== "fixed");
  if (!blocked.length) { setFixBanner(null); return; }
  const byCode = new Map();
  for (const r of blocked) {
    const c = r.anchor.code || "";
    if (!byCode.has(c)) byCode.set(c, { message: r.anchor.message, n: 0 });
    byCode.get(c).n++;
  }
  const ul = el("ul");
  for (const [, v] of byCode) {
    ul.append(el("li", null, v.message + " (" + fmtNum(v.n) + ")"));
  }
  // a click is offered only on a line the server identified; promising one
  // for the others (a line_mismatch) sends the corrector looking for nothing
  const pickable = blocked.some(r => (r.anchor.manual_lines || []).length);
  setFixBanner(el("div", { class: "bn-text" },
    el("b", null, fmtNum(blocked.length) + " ממצאים לא יוחלו אוטומטית — "),
    "הכלי לא הצליח לאתר אותם בוודאות בקובץ, ולכן הוא לא ינחש." +
    (pickable ? " בשורות שהכלי זיהה אפשר ללחוץ על המילה הנכונה בטקסט " +
                "כדי לסמן אותה ידנית." : ""),
    ul));
}

/* An earlier write to this book was cut off (a crash, a closed window) and
 * the file changed afterwards, so the tool cannot tell whether that write
 * landed — and it never guesses. The book is named here, with its backup,
 * until the corrector has checked it and says so; only then is the record
 * dismissed (/api/fixer/resolve_conflict). Kept apart from #fixerBanner, which
 * every refusal and reload repaints. */
function renderFixConflicts() {
  const box = $("#fixConflicts");
  if (!box) return;
  const list = (S.fixDoc && S.fixDoc.journal_conflicts) || [];
  box.replaceChildren();
  box.hidden = !list.length;
  if (!list.length) return;
  box.append(el("div", null,
    el("b", null, "⚠ כתיבה קודמת לקובץ הזה נקטעה באמצע, והקובץ השתנה מאז. "),
    "לכן אי אפשר לדעת אם התיקונים שבה נכתבו: הסטטוס שלהם לא עודכן, ואין לה " +
    "שחזור מגיבוי. יש לפתוח את הקובץ ולבדוק אותו מול הגיבוי שנשמר לפני " +
    "הכתיבה, ולתקן ידנית אם צריך. אחרי הבדיקה אפשר להסיר את ההתראה."));
  const ul = el("ul");
  for (const c of list) {
    const words = (c.finding_ids || [])
      .map(id => (S.fixRows.find(r => r.id === id) || {}).word)
      .filter(Boolean);
    ul.append(el("li", null,
      (c.message || "") +
        (words.length ? " (המילים: «" + words.join("», «") + "»)" : ""),
      el("button", { class: "btn", onclick: () => resolveFixConflict(c.jid) },
        "✔ בדקתי — הסר התראה"),
      el("div", { class: "fc-meta" },
        (c.kind === "undo" ? "שחזור מגיבוי" : "החלת תיקונים") +
          (c.ts ? " · " + String(c.ts).replace("T", " ").slice(0, 19) : ""),
        c.backup ? [" · גיבוי: ", el("code", null, c.backup)] : null)));
  }
  box.append(ul);
}

async function resolveFixConflict(jid) {
  if (!confirm("לאשר שבדקת את הקובץ?\nההתראה תוסר, והכלי לא יחזור לבדוק את הכתיבה שנקטעה.")) return;
  try {
    await api("/api/fixer/resolve_conflict", { method: "POST", body: { jid } });
    toast("ההתראה הוסרה", "ok");
    await loadFixDoc();
  } catch (e) {
    toast(e.message, "err", 8000);
  }
}

/* -------------------------------------------------- worklist */
function renderFixList(scroll) {
  const box = $("#fixList");
  box.replaceChildren();
  if (!S.fixKey) {
    box.append(el("div", { class: "fixer-empty" },
      "בחר ספר מהרשימה — הכלי יפתח את קובץ הטקסט עצמו ויסמן בו את המקומות לתיקון."));
    updateFixProgress();
    return;
  }
  if (S.fixDoc && S.fixDoc.editable === false) {
    // a book from the database has no file to write: say so, rather than
    // the "nothing to fix" an empty worklist would otherwise claim
    box.append(el("div", { class: "fixer-empty" }, S.fixDoc.message ||
      "ספר זה מגיע ממסד הנתונים ולא מקובץ טקסט, ולכן אי אפשר לתקן אותו כאן."));
    updateFixProgress();
    return;
  }
  if (!S.fixRows.length) {
    box.append(el("div", { class: "fixer-empty" }, "אין ממצאים לתיקון בספר זה 🎉"));
    updateFixProgress();
    return;
  }
  const editable = !!(S.fixDoc && S.fixDoc.editable);
  // filtered, but never re-ordered: the list always runs down the book
  const view = visibleFixRows();
  syncFixViewSelect();
  if (!view.length) {
    box.append(el("div", { class: "fixer-empty" },
      "אין ממצאים מהסוג שנבחר בספר זה. אפשר לבחור «הכל» כדי לראות את השאר."));
    updateFixProgress();
    updateApplyButton();
    return;
  }
  let lastRef = null;
  view.forEach((r, idx) => {
    const ref = r.ref || "(ללא מראה מקום)";
    if (ref !== lastRef) {
      box.append(el("div", { class: "fix-refgroup" }, el("bdi", null, ref)));
      lastRef = ref;
    }
    box.append(fixRowNode(r, idx, editable));
  });
  updateFixProgress();
  updateApplyButton();
  if (scroll) scrollFixCurrent();
}

/* Patch a single already-rendered row in place instead of rebuilding the
 * whole (possibly huge) worklist. Only safe when the status change cannot
 * have moved the finding in or out of the current filter — callers must
 * check that first (see canPatchFixRows). Falls back to the caller doing a
 * full renderFixList() when the row isn't currently on screen. */
function patchFixRowById(id, editable) {
  const box = $("#fixList");
  const old = box.querySelector('.fix-row[data-id="' + id + '"]');
  if (!old) return false;
  const r = S.fixRows.find(x => x.id === id);
  if (!r) return false;
  const idx = Number(old.dataset.idx);
  const fresh = fixRowNode(r, idx, editable);
  old.replaceWith(fresh);
  return true;
}

/* A plain status/note/suggestion edit never changes which findings exist or
 * their order — it can only change which FILTERED VIEW they belong to (a
 * status filter, or "blocked" if anchoring info also changed). So patching
 * in place is safe exactly when the current view isn't filtered by status,
 * and isn't the "blocked" view (anchor.ok doesn't change here either way,
 * but keep the check for future-proofing). */
function canPatchFixRows() {
  return !S.fixView || S.fixView.startsWith("et:");
}

/* rebuild the view picker, showing how many findings each choice holds */
function syncFixViewSelect() {
  const sel = $("#fixView");
  if (!sel) return;
  const opts = fixViewOptions();
  sel.replaceChildren();
  for (const o of opts) {
    sel.append(el("option", { value: o.key },
      o.label + " (" + fmtNum(o.n) + ")"));
  }
  if (!opts.some(o => o.key === S.fixView)) S.fixView = "";
  sel.value = S.fixView;
}

function fixRowNode(r, idx, editable) {
  const done = effStatus(r) === "fixed";
  const blocked = !!(r.anchor && !r.anchor.ok) && !done;
  const cur = currentFixRow();
  const row = el("div", {
    class: "fix-row" + (cur && cur.id === r.id ? " current" : "") +
      (done ? " done-row" : "") + (blocked ? " row-blocked" : ""),
    dataset: { idx: String(idx), id: String(r.id) },
  });
  const main = el("div", { class: "fix-main" });
  const rfix = r.correction || effFix(r);
  const mode = rowMode(r);
  const st = effStatus(r);
  const sinfo = statusInfo(st);
  // the status of THIS finding, stated rather than implied by row colour
  const chip = el("span", { class: "chip st-" + st, title: "לחיצה לשינוי הסטטוס" },
    (sinfo.icon ? sinfo.icon + " " : "") + sinfo.hebrew);
  chip.addEventListener("click", ev => {
    ev.stopPropagation();
    openStatusMenu(ev.currentTarget, key => fixAct(r, key));
  });
  main.append(el("div", { class: "fix-wordline" },
    chip,
    wordDiffNode(r.word || "", rfix || "", "err", "w-err"),
    el("span", { class: "arr" }, "⇐"),
    rfix ? wordDiffNode(rfix, r.word || "", "fix", "w-fix")
         : el("bdi", { class: "w-fix" }, "—"),
    r.custom_suggestion ? el("span", { class: "et-tag" }, "תיקון ידני") : null,
    mode === "bracket" ? el("span", { class: "fix-mode-tag" }, "סוגריים") : null));
  main.append(el("div", { class: "fix-snip" },
    renderSnippet(r.snippet, r.word, null, rfix)));
  if (r.lineno != null && editable) {
    const loc = el("span", { class: "fix-loc" }, "📍 שורה " + fmtNum(r.lineno + 1));
    loc.addEventListener("click", ev => { ev.stopPropagation(); scrollDocToLine(r.lineno, r.id); });
    main.append(loc);
  }
  if (blocked) main.append(el("div", { class: "fix-warn" }, r.anchor.message || ""));
  else if (r.anchor && r.anchor.confidence === "weak") {
    // the surrounding text does not look like the text the finding was made
    // against — probably fine, but worth a human glance before writing
    main.append(el("div", { class: "fix-warn weak-warn" },
      "⚠ הקטע בקובץ אינו תואם במלואו לקטע שנסרק — כדאי לוודא לפני ההחלה."));
  } else if (r.anchor && r.anchor.confidence === "moved") {
    // the sentence was found on another line than the scan saw it on
    const from = r.anchor.moved_from;
    main.append(el("div", { class: "fix-warn weak-warn" },
      "⚠ השורה זזה מאז הסריקה" +
      (from != null ? " (נסרקה בשורה " + fmtNum(from + 1) + ")" : "") +
      " — הקטע זוהה בשורה " + fmtNum(r.lineno + 1) +
      " לפי ההקשר המלא שלו. כדאי לוודא שזה המקום הנכון לפני ההחלה."));
  }
  if (needsVocalization(r)) {
    // replacing would strip the word's nikud; the server refuses that, and
    // one refusal fails the whole batch — so it is said here, before
    main.append(el("div", { class: "fix-warn" },
      "⚠ המילה בקובץ מנוקדת והתיקון אינו מנוקד — החלפה הייתה מוחקת את הניקוד, " +
      "ולכן לא תיכתב. יש להקליד תיקון מנוקד («✏ תיקון ידני») או לבחור במצב «סוגריים»."));
  }
  if (r.anchor && r.anchor.ok && r.anchor.spans_markup) {
    // replacing takes the tag with the word (fine); bracketing would wrap
    // half of it and mis-nest the markup, so that combination is refused
    main.append(el("div", { class: "fix-warn" },
      "⚠ המילה חצויה בקובץ על ידי תגית עיצוב — תיקון אוטומטי היה שובר אותה. יש לתקן ידנית."));
  }
  row.append(main);

  const side = el("div", { class: "fix-side" });
  // the whole decision set from the cards tab, so a corrector can also settle
  // findings that were never triaged instead of leaving the screen
  const acts = el("div", { class: "fix-acts" });
  const act = (label, title, fn, cls) => {
    const b = el("button", { title: title || label, class: cls || null }, label);
    b.addEventListener("click", ev => { ev.stopPropagation(); fn(); });
    return b;
  };
  acts.append(
    act("✅ אושר", "זו שגיאה — לאשר את התיקון", () => fixAct(r, "approved"), "act-approve"),
    act("❌ לא שגיאה", "המילה תקינה", () => fixAct(r, "not_error"), "act-reject"),
    act("❌ בכל מקום", "המילה תקינה בכל הספרים", () => fixAct(r, "not_error", { scope: "word" })),
    act("✏ תיקון ידני", "הקלדת תיקון משלך", () => toggleFixEdit(row, r)),
    act("❓ בירור", "דרוש בירור", () => fixAct(r, "unsure")),
    act("🚫 התעלם", "התעלם מהממצא", () => fixAct(r, "ignored")),
    act("🔧 תוקן", "סמן כתוקן בלי לכתוב לקובץ", () => fixAct(r, "fixed")));
  side.append(acts);

  if (editable) {
    const seg = el("div", { class: "seg mini" });
    for (const m of [["replace", "החלפה"], ["bracket", "סוגריים"]]) {
      const b = el("button", {
        class: "seg-btn" + (mode === m[0] ? " active" : ""),
        title: m[0] === "bracket" ? "(תיקון) [שגיאה]" : "החלפה מלאה",
      }, m[1]);
      b.addEventListener("click", ev => {
        ev.stopPropagation();
        S.fixModeOverride.set(r.id, m[0]);
        renderFixList(false);
      });
      seg.append(b);
    }
    side.append(seg);

    const pick = el("label", { class: "fix-pick" });
    const cb = el("input", { type: "checkbox" });
    cb.checked = S.fixPicked.has(r.id);
    cb.disabled = !canApply(r);
    cb.addEventListener("click", ev => ev.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) S.fixPicked.add(r.id); else S.fixPicked.delete(r.id);
      updateApplyButton();
    });
    pick.append(cb, el("span", null, done ? "תוקן בקובץ" : "לכלול בהחלה"));
    side.append(pick);
  }
  row.append(side);

  // inline manual-correction box
  const edit = el("div", { class: "fix-edit" },
    el("input", { type: "text", dir: "rtl", value: rfix || "",
                  placeholder: "הקלד את התיקון הנכון…" }),
    el("button", { class: "btn primary" }, "שמור ואשר"));
  const inp = edit.querySelector("input");
  const save = async () => {
    const v = inp.value.trim();
    if (!v) { toast("יש להקליד תיקון תחילה", "err"); return; }
    r.correction = v;
    await fixAct(r, "approved", { custom_suggestion: v });
  };
  edit.querySelector("button").addEventListener("click", ev => { ev.stopPropagation(); save(); });
  inp.addEventListener("keydown", ev => {
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); save(); }
    if (ev.key === "Escape") { ev.preventDefault(); edit.classList.remove("visible"); }
  });
  row.append(edit);

  row.addEventListener("click", ev => {
    if (ev.target.closest("button, input, label, mark")) return;
    selectFixRowById(r.id);
  });
  return row;
}

function toggleFixEdit(row, r) {
  const box = row.querySelector(".fix-edit");
  if (!box) return;
  const open = !box.classList.contains("visible");
  box.classList.toggle("visible", open);
  if (open) { const i = box.querySelector("input"); i.focus(); i.select(); }
}

function selectFixRowById(id) {
  const r = S.fixRows.find(x => x.id === id);
  if (!r) return;
  const prevId = S.fixCurId;
  S.fixCurId = id;
  // Selection only moves the "current" highlight — it never changes which
  // findings exist, their filter/order, or their status, so the previous and
  // new current row/line are the only DOM the change can affect. Patching
  // just those two (instead of rebuilding the whole worklist + doc pane)
  // keeps clicking through a book with many findings snappy.
  const editable = !!(S.fixDoc && S.fixDoc.editable);
  const patched = canPatchFixRows() &&
    (prevId == null || patchFixRowById(prevId, editable)) &&
    patchFixRowById(id, editable);
  if (patched) {
    if (prevId != null) patchFixDocLineFor(prevId);
    patchFixDocLineFor(id);
  } else {
    renderFixList(false);
    renderFixDoc();
  }
  if (r.lineno != null) scrollDocToLine(r.lineno, r.id);
  scrollFixCurrent();
}

/* a status decision from inside the fixer — reuses the shared writer, so the
 * optimistic update, the rollback and Ctrl+Z all behave as everywhere else */
async function fixAct(r, status, opts) {
  // Only an approved finding stays armed. "Needs clarification" in
  // particular is the opposite of "write this now", so leaving it ticked
  // would apply the very thing the corrector just flagged as unresolved.
  // Set this BEFORE setStatus's optimistic repaint, so the row it patches
  // in place (see repaintStatuses/patchFixRowById) draws its checkbox from
  // the up-to-date pick state instead of a stale one.
  const wasPicked = S.fixPicked.has(r.id);
  if (status === "approved") S.fixPicked.add(r.id);
  else S.fixPicked.delete(r.id);
  try {
    await setStatus([r.id], status, opts || {});
  } catch (e) {
    // toast already shown; setStatus's own catch already repainted the row
    // with the rolled-back status, so undo the pick-set change to match.
    if (wasPicked) S.fixPicked.add(r.id); else S.fixPicked.delete(r.id);
    // setStatus repainted the row before the pick was restored: paint again
    repaintStatuses([r.id]);
  }
  updateApplyButton();
}

function scrollFixCurrent() {
  const cur = $("#fixList .fix-row.current");
  if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* Mark this finding fixed and move on to the next one still needing work.
 * Takes the ROW, like every other action here — and advances through the
 * VISIBLE list, so a filtered view does not jump to a finding off screen. */
async function markFixed(r) {
  if (!r || effStatus(r) === "fixed") return;
  // under a status filter the row leaves the visible list once it is fixed,
  // so its position has to be taken before the change
  const at = visibleFixRows().findIndex(x => x.id === r.id);
  await fixAct(r, "fixed");
  if (effStatus(r) !== "fixed") return;           // the save failed: stay put
  const view = visibleFixRows();
  const atAfter = view.findIndex(x => x.id === r.id);
  const next = view.slice(atAfter >= 0 ? atAfter + 1 : Math.max(0, at))
    .find(x => effStatus(x) !== "fixed");
  if (next) selectFixRowById(next.id);
}

function updateFixProgress() {
  // progress is always about the BOOK, never the current filter — otherwise
  // narrowing the view would appear to change how much work is left
  const total = S.fixRows.length;
  const done = S.fixRows.filter(r => effStatus(r) === "fixed").length;
  const pct = total ? Math.round(done * 100 / total) : 0;
  let txt = "";
  if (S.fixKey) {
    txt = "תוקנו " + fmtNum(done) + " מתוך " + fmtNum(total) +
          " בספר זה (" + pct + "%)";
    const shown = visibleFixRows().length;
    if (S.fixView && shown !== total) txt += " · מוצגים " + fmtNum(shown);
  }
  $("#fixProgressText").textContent = txt;
  $("#fixProgressBar").style.width = pct + "%";
}

/* -------------------------------------------------- mode + apply */
function syncModeButtons() {
  $("#fixModeReplace").classList.toggle("active", S.fixMode !== "bracket");
  $("#fixModeBracket").classList.toggle("active", S.fixMode === "bracket");
}

async function setFixMode(mode) {
  S.fixMode = mode;
  syncModeButtons();
  renderFixList(false);
  writeHash();          // keep the URL honest: the mode changes what gets WRITTEN
  if (S.fixKey && S.fixDoc && S.fixDoc.editable) {
    try {
      await api("/api/fixer/mode", { method: "POST", body: { key: S.fixKey, mode } });
    } catch (e) { /* a failed preference is not worth interrupting for */ }
  }
}

function applicableRows() {
  return S.fixRows.filter(r => S.fixPicked.has(r.id) && canApply(r));
}

/* Quick selection.
 *
 * Writing into a book is a decision, so the set of corrections to write is
 * built explicitly. Findings nobody has judged are never pre-selected; these
 * buttons are how a corrector opts a whole group in, without ticking dozens
 * of boxes by hand.
 */
function fixPick(which) {
  if (which === "none") {
    S.fixPicked.clear();
  } else if (which === "approved") {
    S.fixPicked = new Set(S.fixRows
      .filter(r => canApply(r) && effStatus(r) === "approved")
      .map(r => r.id));
  } else if (which === "verified") {
    S.fixPicked = new Set(S.fixRows
      .filter(r => canApply(r) && effStatus(r) === "approved" && r.verified)
      .map(r => r.id));
  } else if (which === "view") {
    // whatever the current filter shows — the corrector can see exactly what
    // they are about to select
    S.fixPicked = new Set(visibleFixRows().filter(canApply).map(r => r.id));
  }
  renderFixList(false);
  renderFixDoc();
  updateApplyButton();
}

function updateFixPickBar() {
  const bar = $("#fixPickBar");
  if (!bar) return;
  const editable = !!(S.fixDoc && S.fixDoc.editable) && S.fixRows.length;
  bar.hidden = !editable;
  if (!editable) return;
  const n = applicableRows().length;
  const avail = S.fixRows.filter(canApply).length;
  const undecided = S.fixRows.filter(
    r => canApply(r) && effStatus(r) !== "approved").length;
  const parts = ["נבחרו " + fmtNum(n) + " מתוך " + fmtNum(avail) +
                 " הניתנים לתיקון"];
  if (undecided) {
    parts.push(fmtNum(undecided) + " טרם הוחלטו — לא ייכנסו אלא אם תבחר בהם");
  }
  $("#fixPickCount").textContent = parts.join(" · ");
}

function updateApplyButton() {
  updateFixPickBar();
  const btn = $("#fixApply");
  const editable = !!(S.fixDoc && S.fixDoc.editable) && !S.fixDocStale;
  const n = applicableRows().length;
  btn.disabled = !editable || !n;
  btn.replaceChildren(icon("check"), n ? " החלה על הקובץ (" + fmtNum(n) + ")" : " החלה על הקובץ");
  const undo = $("#fixUndoFile");
  const last = (S.fixEdits || []).find(e => !e.undone_at);
  undo.hidden = !last;
  if (last) undo.dataset.editId = String(last.id);
}

async function applyFixes() {
  const rows = applicableRows();
  if (!rows.length || !S.fixDoc) return;
  const bracket = rows.filter(r => rowMode(r) === "bracket").length;
  const what = bracket
    ? "מתוכם " + fmtNum(bracket) + " ייכתבו במצב סוגריים «(תיקון) [שגיאה]».\n"
    : "";
  // This is the moment of commitment, and the corrector may have scrolled far
  // from the marks — so name the actual changes here, not just a count.
  const sample = rows.slice(0, 6).map(r => {
    const fix = r.correction || effFix(r) || "";
    return "  שורה " + fmtNum((r.lineno || 0) + 1) + ":  " + r.word + " ⇐ " +
           (rowMode(r) === "bracket" ? "(" + fix + ") [" + r.word + "]" : fix);
  }).join("\n");
  const more = rows.length > 6
    ? "\n  …ועוד " + fmtNum(rows.length - 6) + " תיקונים" : "";
  if (!confirm("להחיל " + fmtNum(rows.length) + " תיקונים על הקובץ?\n\n" +
               sample + more + "\n\n" + what +
               "גיבוי של הקובץ יישמר לפני הכתיבה.")) return;
  const btn = $("#fixApply");
  btn.disabled = true;
  const items = rows.map(r => {
    const it = { id: r.id, mode: rowMode(r) };
    if (r.correction && r.correction !== r.suggestion) it.correction = r.correction;
    if (r.explicit) {
      it.explicit_start = r.explicit.start;
      it.explicit_end = r.explicit.end;
      it.explicit_lineno = r.explicit.lineno;
    }
    return it;
  });
  try {
    const resp = await api("/api/fixer/apply", {
      method: "POST",
      body: { key: S.fixKey, fingerprint: S.fixDoc.fingerprint,
              default_mode: S.fixMode, items, mark_fixed: true },
    });
    S.fixDoc.fingerprint = resp.fingerprint || S.fixDoc.fingerprint;
    for (const l of resp.changed_lines || []) S.fixLines.set(l.n, l);
    for (const a of resp.applied || []) {
      const r = S.fixRows.find(x => x.id === a.id);
      if (r) { r.effective_status = "fixed"; r.applied = true; }
      S.fixPicked.delete(a.id);
    }
    if (resp.db_warning) toast(resp.db_warning, "err", 9000);
    toast(resp.message + " (" + fmtNum((resp.applied || []).length) + " תיקונים)", "ok", 6000);
    // the anchors of everything left now refer to the OLD text, so reload
    await loadFixDoc();
    await loadFixerBooks();
    $("#fixBook").value = S.fixKey;
  } catch (e) {
    handleApplyFailure(e);
  }
  updateApplyButton();
}

/* a refusal is informative, not a dead end: say which findings were refused
 * and why, and offer the reload that makes them applicable again */
function handleApplyFailure(e) {
  const failed = (e.data && e.data.failed) || [];
  if (failed.length) {
    const ul = el("ul");
    for (const f of failed.slice(0, 8)) {
      const r = S.fixRows.find(x => x.id === f.id);
      ul.append(el("li", null, (r ? "«" + (r.word || "") + "» — " : "") + f.message));
      if (r) { r.anchor = { ok: false, code: f.code, message: f.message }; S.fixPicked.delete(r.id); }
    }
    if (failed.length > 8) ul.append(el("li", null, "…ועוד " + fmtNum(failed.length - 8)));
    setFixBanner(el("div", { class: "bn-text" },
      el("b", null, "לא נכתב דבר לקובץ. "),
      "חלק מהתיקונים לא אושרו:", ul), "err");
    renderFixList(false);
    renderFixDoc();
  } else {
    setFixBanner(el("div", { class: "bn-text" }, e.message), "err");
  }
  if (e.code === "file_changed") {
    S.fixDocStale = true;
    const bn = $("#fixerBanner");
    const b = el("button", { class: "btn primary" }, "🔄 טען מחדש");
    b.addEventListener("click", () => loadFixDoc());
    bn.append(b);
  }
  toast(e.message, "err", 8000);
}

async function undoFileEdit() {
  const id = $("#fixUndoFile").dataset.editId;
  if (!id) return;
  if (!confirm("לשחזר את הקובץ מהגיבוי?\nהתיקונים שנכתבו בו יבוטלו, " +
               "והממצאים יחזרו לסטטוס «אושר».")) return;
  try {
    const resp = await api("/api/fixer/undo_file", {
      method: "POST", body: { edit_id: Number(id) } });
    toast(resp.message, "ok", 6000);
    await loadFixDoc();
  } catch (e) {
    toast(e.message, "err", 8000);
  }
}
