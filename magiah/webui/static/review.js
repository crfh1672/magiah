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
  return true;
}

let lastFa = null;   // the pane button the keyboard was last on
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
    box.replaceChildren(el("h2", null, "הממצא הנבחר"),
      el("div", { class: "fp-empty" }, S.focusBusy ? "טוען ממצאים…" : S.tableRows.length ? "בחרו ממצא בתור" : "אין ממצאים להצגה"));
    return;
  }
  const idx = S.tableRows.indexOf(r), n = S.tableRows.length;
  const st = effStatus(r), fix = effFix(r);

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

  const pair = el("div", { class: "fp-pair", dir: "rtl" },
    wordDiffNode(r.word || "", fix, "err", "w-err"));
  if (fix) pair.append(el("span", { class: "fp-arrow", "aria-hidden": "true" }, "←"),
    wordDiffNode(fix, r.word || "", "fix", "w-fix"));

  const snippet = el("div", { class: "fp-snippet" }, renderSnippet(r.snippet, r.word, null, fix));

  const info = statusInfo(st);
  const meta = el("dl", { class: "fp-meta" },
    el("dt", null, "סטטוס"), el("dd", null, el("span", { class: "chip st-" + st }, (info.icon ? info.icon + " " : "") + info.hebrew)),
    el("dt", null, "סוג שגיאה"), el("dd", null, errtypeInfo(r.errtype).hebrew || r.errtype || ""),
    el("dt", null, "ציון"), el("dd", null, fmtRank(r.rank), r.verified ? el("span", { class: "vbadge" }, "מאומת") : null),
    el("dt", null, "ספר"), el("dd", null, el("bdi", null, r.source || "")),
    el("dt", null, "מראה מקום"), el("dd", null, el("bdi", null, r.ref || "")));

  const acts = el("div", { class: "fp-actions", role: "group", "aria-label": "החלטה על הממצא" });
  for (const s of statuses()) {
    if (s.key === "pending") continue;
    const b = el("button", { type: "button", class: "btn", dataset: { fa: "st-" + s.key }, "aria-pressed": String(st === s.key) },
      (s.icon ? s.icon + " " : "") + s.hebrew);
    b.addEventListener("click", async () => {
      const id = r.id;
      try { await setStatus([id], s.key); } catch (e) { return; }   // the toast is shown
      // on to the next finding, the keyboard staying on the same button
      if (S.focusId === id) await stepFocus(1);
    });
    acts.append(b);
  }
  const more = el("button", { type: "button", class: "btn", dataset: { fa: "detail" }, "aria-haspopup": "dialog" },
    "פרטים: ראיות, הערות והיסטוריה");
  more.addEventListener("click", () => openDrawer(r.id));

  box.replaceChildren(el("h2", null, "הממצא הנבחר"), nav, pair, snippet, meta, acts, more);
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
