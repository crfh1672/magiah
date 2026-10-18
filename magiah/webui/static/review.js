/* ============ מגיה — review.js: the review station's three zones ============
 * Books | queue | focus. The queue is the table in table.js (paged, so only a
 * page of rows is ever built). This file draws the focus pane beside it and
 * decides what a click on a row means. Classic script: shares the global scope. */
"use strict";

/* Below this width the side zones are not drawn: books are chosen in the
 * filter window and a row opens the drawer, exactly as before. */
const WIDE_REVIEW = window.matchMedia("(min-width: 1360px)");
const reviewWide = () => WIDE_REVIEW.matches;
const bookPaneShown = () => reviewWide() && S.view === "table";

function focusedRow() {
  return S.focusId == null ? null : (S.tableRows.find(r => r.id === S.focusId) || null);
}

/* what a click / Enter on a queue row does */
function rowActivate(id) {
  if (reviewWide()) focusRow(id);
  else openDrawer(id);
}

function focusRow(id) {
  S.focusId = id;
  markFocusRow();
  renderFocusPane();
}

function markFocusRow() {
  for (const tr of $$("#tblBody tr[data-id]")) {
    const on = tr.dataset.id === String(S.focusId);
    tr.classList.toggle("focusrow", on);
    if (on) tr.setAttribute("aria-current", "true"); else tr.removeAttribute("aria-current");
  }
}

/* keep the focus on a row that is still there; otherwise the first one */
function ensureFocus() {
  if (!reviewWide()) return;
  if (!focusedRow()) {
    const rows = S.tableRows;
    S.focusId = rows.length ? rows[S.focusLast ? rows.length - 1 : 0].id : null;
  }
  S.focusLast = false;
  markFocusRow();
  renderFocusPane();
}

/* Up / Down in the queue move the focus pane along, and the keyboard with it */
function rowArrowKeys(ev, tr) {
  if (!reviewWide() || ev.target !== tr) return;
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
  const next = ev.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
  if (!next || !next.dataset.id) return;
  ev.preventDefault();
  next.focus();
  focusRow(Number(next.dataset.id));
}

const lastPage = () => Math.max(1, Math.ceil(S.tableTotal / S.pageSize));

/* One finding on; past the end of the page, onto the next page (or back onto
 * the previous one's last row). Resolves true when the focus moved. */
async function stepFocus(delta) {
  const r = focusedRow();
  if (!r) return false;
  const next = S.tableRows[S.tableRows.indexOf(r) + delta];
  if (next) {
    focusRow(next.id);
    const tr = $('#tblBody tr[data-id="' + next.id + '"]');
    if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: "nearest" });
    return true;
  }
  const page = S.page + delta;
  if (page < 1 || page > lastPage()) return false;
  S.page = page;
  S.focusId = null;
  S.focusLast = delta < 0;
  writeHash();
  await loadTable();
  // a decision under a status filter takes its row out of the list, so the
  // total that sent us here may have shrunk by one and the page be empty:
  // settle on the last page that exists now
  if (!S.tableRows.length && S.tableTotal > 0) {
    S.page = lastPage();
    S.focusLast = false;
    writeHash();
    await loadTable();
  }
  return true;
}

let lastFa = null;   // the pane button the keyboard was last on
let moreOpen = false;   // the "more actions" disclosure keeps its state across redraws

/* decide on one finding, then on to the next; the keyboard stays on the same button */
async function focusDecide(id, status) {
  try { await setStatus([id], status); } catch (e) { return; }   // the toast is shown
  if (S.focusId === id) await stepFocus(1);
}
/* the Hebrew keys of the cards view work on the focused finding too */
const FOCUS_KEYS = { approved: "approve", not_error: "reject", unsure: "unsure", ignored: "ignore", fixed: "fixedBook" };
function focusKeyDecide(ev) {
  if (!bookPaneShown() || !S.focusId) return false;
  for (const [status, action] of Object.entries(FOCUS_KEYS)) {
    if (keyIs(ev, action)) { ev.preventDefault(); focusDecide(S.focusId, status); return true; }
  }
  return false;
}

/* the sentence with the swap in place: the wrong word struck out, the fix after it */
function swapSentence(snippet, word, fix) {
  const s = snippet == null ? "" : String(snippet), w = word || "";
  const i = s && w ? locateWord(s, w) : -1;
  if (i < 0 || !fix || fix === w) {
    if (i < 0 && w) {   // the sentence does not hold the word: still show the word and its fix
      const fb = el("bdi");
      fb.append(s || "—", " ", el("span", { class: "bad" }, w));
      if (fix && fix !== w) fb.append(" ", el("span", { class: "good" }, fix));
      return fb;
    }
    return renderSnippet(snippet, word, null, fix);
  }
  const b = el("bdi");
  b.append(s.slice(0, i), el("span", { class: "bad" }, w), " ", el("span", { class: "good" }, fix), s.slice(i + w.length));
  return b;
}

function renderFocusPane() {
  const box = $("#focusPane");
  if (!box || !reviewWide()) return;
  // a button the keyboard was on keeps it across the redraw
  const on = box.contains(document.activeElement) && document.activeElement.dataset
    ? document.activeElement.dataset.fa : null;
  if (on) lastFa = on;
  // after a page change the pane is redrawn from nothing: keyboard focus that
  // fell to the page is put back on the button it was on
  const had = on || (document.activeElement === document.body ? lastFa : null);
  const r = S.focusBusy ? null : focusedRow();
  if (!r) {
    box.replaceChildren(el("h2", { class: "sr-only" }, "הממצא הנבחר"),
      el("div", { class: "fp-empty" }, S.focusBusy ? "טוען ממצאים…" : S.tableRows.length ? "בחרו ממצא בתור" : "אין ממצאים להצגה"));
    return;
  }
  const idx = S.tableRows.indexOf(r), n = S.tableRows.length;
  const st = effStatus(r), fix = effFix(r);

  // what kind of error, and whether it is verified
  const chips = el("div", { class: "fp-chips" },
    el("span", { class: "ch", title: errtypeInfo(r.errtype).explanation || "" }, errtypeInfo(r.errtype).hebrew || r.errtype || ""));
  if (r.verified) chips.append(el("span", { class: "ch on" }, "מאומת"));
  const where = el("div", { class: "fp-where" }, el("bdi", null, [r.source, r.ref].filter(Boolean).join(" · ")),
    r.rank != null ? el("span", { class: "fp-rank" }, " · ציון " + fmtRank(r.rank)) : null);
  const snippet = el("div", { class: "fp-snippet" }, swapSentence(r.snippet, r.word, fix));

  // the decision: three big buttons with their keys; the rest one step further
  const decide = (s, primary) => {
    const key = HEB_KEYS[FOCUS_KEYS[s.key]][0];
    const b = el("button", {
      type: "button", class: "fp-act" + (s.key === "approved" ? " ok" : ""), dataset: { fa: "st-" + s.key },
      "aria-pressed": String(st === s.key), "aria-keyshortcuts": HEB_KEYS[FOCUS_KEYS[s.key]][1].replace("Key", ""),
    }, (s.icon ? s.icon + " " : "") + s.hebrew, el("kbd", { class: "kbd", "aria-hidden": "true" }, key));
    b.addEventListener("click", () => focusDecide(r.id, s.key));
    return b;
  };
  const all = statuses().filter(s => s.key !== "pending");
  const main = all.filter(s => ["approved", "not_error", "unsure"].includes(s.key));
  const rest = all.filter(s => !main.includes(s));
  const acts = el("div", { class: "fp-actions", role: "group", "aria-label": "החלטה על הממצא" }, ...main.map(s => decide(s)));

  const more = el("details", { class: "fp-more" }, el("summary", { dataset: { fa: "more" } }, "עוד פעולות…"));
  more.open = moreOpen || (had && had !== "more" && !main.some(s => "st-" + s.key === had) && had !== "prev" && had !== "next");
  more.addEventListener("toggle", () => { moreOpen = more.open; });
  const moreBody = el("div", { class: "fp-more-body" }, ...rest.map(s => decide(s)));
  const detail = el("button", { type: "button", class: "fp-act", dataset: { fa: "detail" }, "aria-haspopup": "dialog" },
    "פרטים: ראיות, הערות והיסטוריה");
  detail.addEventListener("click", () => openDrawer(r.id));
  moreBody.append(detail);
  more.append(moreBody);

  const navBtn = (fa, label, delta, dis) => {
    const b = el("button", { type: "button", class: "btn sm", dataset: { fa } }, label);
    b.disabled = dis;
    b.addEventListener("click", () => { stepFocus(delta); });
    return b;
  };
  const nav = el("div", { class: "fp-nav" },
    navBtn("prev", "‹ הקודם", -1, idx <= 0 && S.page <= 1),
    el("span", { class: "fp-pos" }, "ממצא " + fmtNum(idx + 1) + " מתוך " + fmtNum(n) + " בעמוד"),
    navBtn("next", "הבא ›", 1, idx >= n - 1 && S.page >= lastPage()));

  box.replaceChildren(el("h2", { class: "sr-only" }, "הממצא הנבחר"), chips, where, snippet, acts, more, nav);
  if (had) {
    const again = box.querySelector('[data-fa="' + had + '"]');
    if (again && !again.disabled) again.focus();
  }
}

/* crossing the width breakpoint: the side zones appear or go away */
WIDE_REVIEW.addEventListener("change", () => {
  if (S.view !== "table") return;
  // a row advertises a popup only where it opens one (the drawer, on a narrow screen)
  for (const tr of $$("#tblBody tr[data-id]")) {
    if (reviewWide()) tr.removeAttribute("aria-haspopup"); else tr.setAttribute("aria-haspopup", "dialog");
  }
  if (reviewWide()) { loadBooks(); ensureFocus(); }
});
