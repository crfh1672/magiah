/* ============ מגיה — table.js: table view ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ---------------------------------------------------------- table view */
const TABLE_COLS = [
  { key: "word", sortable: true },
  { key: "suggestion" },
  { key: "rank", sortable: true },
  { key: "verified" },
  { key: "errtype" },
  { key: "source", sortable: true },
  { key: "ref" },
  { key: "snippet" },
  { key: "status" },
];

/* The word and its suggestion are what the table is for: they cannot be hidden. */
const LOCKED_COLS = new Set(["word", "suggestion"]);
const visibleCols = () => TABLE_COLS.filter(c => !S.hiddenCols.has(c.key));

function loadTablePrefs() {
  try {
    const d = localStorage.getItem("magiah_density");
    if (d === "compact" || d === "comfortable") S.density = d;
    const h = JSON.parse(localStorage.getItem("magiah_hidden_cols") || "[]");
    if (Array.isArray(h)) S.hiddenCols = new Set(h.filter(k => TABLE_COLS.some(c => c.key === k) && !LOCKED_COLS.has(k)));
  } catch (e) {}
}
function saveTablePrefs() {
  try {
    localStorage.setItem("magiah_density", S.density);
    localStorage.setItem("magiah_hidden_cols", JSON.stringify([...S.hiddenCols]));
  } catch (e) {}
}
function applyDensity() {
  $("#tblWrap").classList.toggle("compact", S.density === "compact");
  $$("#densitySeg .seg-btn").forEach(b => {
    const on = b.dataset.density === S.density;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function renderColsMenu() {
  const box = $("#colsMenuBody");
  box.replaceChildren(...TABLE_COLS.map(c => {
    const cb = el("input", { type: "checkbox" });
    cb.checked = !S.hiddenCols.has(c.key);
    cb.disabled = LOCKED_COLS.has(c.key);
    cb.addEventListener("change", () => {
      if (cb.checked) S.hiddenCols.delete(c.key); else S.hiddenCols.add(c.key);
      saveTablePrefs();
      renderTableHead();
      renderTableRows();
    });
    return el("label", { class: "chk-row" }, cb, el("span", null, colInfo(c.key).hebrew || c.key));
  }));
}
function bindTableTools() {
  loadTablePrefs();
  $$("#densitySeg .seg-btn").forEach(b => b.addEventListener("click", () => {
    S.density = b.dataset.density;
    saveTablePrefs();
    applyDensity();
  }));
  applyDensity();
}

function renderTableHead() {
  const tr = el("tr");
  const all = el("input", { type: "checkbox", title: "בחירת כל העמוד", "aria-label": "בחירת כל העמוד" });
  all.addEventListener("change", () => {
    if (all.checked) S.tableRows.forEach(r => S.sel.add(r.id));
    else S.tableRows.forEach(r => S.sel.delete(r.id));
    renderTableRows(); updateBulkBar();
  });
  tr.append(el("th", null, all));
  for (const c of visibleCols()) {
    const info = colInfo(c.key);
    const th = el("th", { class: c.sortable ? "sortable" : "" }, info.hebrew);
    if (info.explanation) th.append(el("span", { class: "info-i", dataset: { tip: info.explanation } }, "ⓘ"));
    if (c.sortable) {
      if (S.filters.sort === c.key) th.append(el("span", { class: "arrow" }, S.filters.dir === "desc" ? " ▼" : " ▲"));
      th.addEventListener("click", () => {
        if (S.filters.sort === c.key) S.filters.dir = S.filters.dir === "desc" ? "asc" : "desc";
        else { S.filters.sort = c.key; S.filters.dir = c.key === "rank" ? "desc" : "asc"; }
        syncFilterControls();
        filtersChanged();
      });
    }
    tr.append(th);
  }
  $("#tblHead").replaceChildren(tr);
}

function statusChip(row) {
  const st = effStatus(row);
  const info = statusInfo(st);
  const chip = el("button", { type: "button", class: "chip st-" + st, title: "לחיצה לשינוי סטטוס", "aria-haspopup": "menu" }, (info.icon ? info.icon + " " : "") + info.hebrew);
  chip.addEventListener("click", ev => {
    ev.stopPropagation();
    openStatusMenu(ev.currentTarget, sKey => setStatus([row.id], sKey).catch(() => {}));
  });
  return chip;
}

function renderTableRows() {
  const tb = $("#tblBody");
  tb.replaceChildren();
  const cols = visibleCols();
  if (!S.tableRows.length) {
    tb.append(el("tr", null, el("td", { class: "empty-row", colspan: String(cols.length + 1) }, emptyFilterState())));
    return;
  }
  for (const r of S.tableRows) {
    const tr = el("tr", { class: S.sel.has(r.id) ? "selrow" : "" });
    const cb = el("input", { type: "checkbox", "aria-label": "בחירת שורה" });
    cb.checked = S.sel.has(r.id);
    cb.addEventListener("click", ev => {
      ev.stopPropagation();
      if (cb.checked) S.sel.add(r.id); else S.sel.delete(r.id);
      tr.classList.toggle("selrow", cb.checked);
      updateBulkBar();
    });
    tr.append(el("td", null, cb));
    // one cell per column; letter-level diff on the word pair, so scanning the
    // table shows *what* changed
    const cell = {
      word: () => el("td", null, wordDiffNode(r.word || "", effFix(r), "err", "w-err")),
      suggestion: () => el("td", null, effFix(r)
        ? wordDiffNode(effFix(r), r.word || "", "fix", "w-fix")
        : el("bdi", { class: "w-fix" }, "")),
      rank: () => el("td", { class: "num" }, fmtRank(r.rank)),
      verified: () => el("td", null, r.verified ? el("span", { class: "vbadge" }, "מאומת") : ""),
      errtype: () => el("td", null, el("span", { class: "et-tag", title: errtypeInfo(r.errtype).explanation || "" }, errtypeInfo(r.errtype).hebrew)),
      source: () => el("td", { class: "bookcell", title: r.source || "" }, el("bdi", null, r.source || "")),
      ref: () => el("td", { class: "refcell", title: r.ref || "" }, el("bdi", null, r.ref || "")),
      snippet: () => el("td", { class: "snip" }, renderSnippet(r.snippet, r.word, null, effFix(r))),
      status: () => el("td", null, statusChip(r)),
    };
    for (const c of cols) tr.append(cell[c.key]());
    tr.addEventListener("click", () => openDrawer(r.id));
    makeActivatable(tr, () => openDrawer(r.id));
    tr.setAttribute("aria-haspopup", "dialog");
    tb.append(tr);
  }
}

let tableSeq = 0;
async function loadTable() {
  const tb = $("#tblBody");
  tb.replaceChildren(el("tr", null, el("td", { class: "loading-row", colspan: String(TABLE_COLS.length + 1) }, "טוען ממצאים…")));
  renderTableHead();
  // two quick filter changes send two requests; only the last one may draw
  const seq = ++tableSeq;
  try {
    const resp = await api("/api/findings?" + filterParams());
    if (seq !== tableSeq) return;
    S.tableRows = rowsOf(resp);
    S.tableTotal = totalOf(resp);
    renderTableRows();
    renderPager();
    updateBulkBar();
  } catch (e) {
    if (seq !== tableSeq) return;
    tb.replaceChildren(el("tr", null, el("td", { class: "empty-row", colspan: String(TABLE_COLS.length + 1) }, "הטעינה נכשלה: " + e.message)));
    toast(e.message, "err");
  }
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(S.tableTotal / S.pageSize));
  if (S.page > pages) S.page = pages;
  const go = p => { S.page = p; writeHash(); loadTable(); };
  const mk = (label, p, dis) => {
    const b = el("button", null, label);
    b.disabled = !!dis;
    b.addEventListener("click", () => go(p));
    return b;
  };
  const sizeSel = el("select", { title: "שורות בעמוד" });
  for (const n of [25, 50, 100, 200, 500]) sizeSel.append(el("option", { value: String(n) }, String(n) + " בעמוד"));
  sizeSel.value = String(S.pageSize);
  sizeSel.addEventListener("change", () => { S.pageSize = parseInt(sizeSel.value, 10); S.page = 1; loadTable(); });
  $("#pager").replaceChildren(
    mk("« ראשון", 1, S.page <= 1),
    mk("‹ הקודם", S.page - 1, S.page <= 1),
    el("span", { class: "pinfo" }, "עמוד " + fmtNum(S.page) + " מתוך " + fmtNum(pages)),
    mk("הבא ›", S.page + 1, S.page >= pages),
    mk("אחרון »", pages, S.page >= pages),
    sizeSel,
    el("span", { class: "total" }, "סה״כ " + fmtNum(S.tableTotal) + " ממצאים"),
  );
}

/* bulk bar */
function updateBulkBar() {
  const bar = $("#bulkBar");
  bar.classList.toggle("visible", S.sel.size > 0);
  bar.querySelector(".bulk-count").textContent = "נבחרו " + fmtNum(S.sel.size) + " ממצאים";
  const act = bar.querySelector(".bulk-actions");
  if (!act.childElementCount) {
    for (const s of statuses()) {
      if (s.key === "pending") continue;
      const b = el("button", { class: "stbtn" }, s.icon + " " + s.hebrew);
      b.addEventListener("click", async () => {
        const scope = $("#bulkWordScope").checked ? "word" : "occurrence";
        try {
          await setStatus([...S.sel], s.key, { scope });
          toast("עודכנו " + fmtNum(S.sel.size) + " ממצאים ל: " + s.hebrew, "ok");
          S.sel.clear();
          updateBulkBar();
          loadTable();
        } catch (e) { /* toast already shown */ }
      });
      act.append(b);
    }
  }
}

/* floating status menu */
function openStatusMenu(anchor, onPick) {
  const menu = $("#stMenu");
  menu.replaceChildren();
  for (const s of statuses()) {
    const b = el("button", null, s.icon + " " + s.hebrew);
    b.addEventListener("click", () => { closeStatusMenu(); onPick(s.key); });
    menu.append(b);
  }
  menu.setAttribute("role", "menu");
  menu._anchor = anchor;
  const r = anchor.getBoundingClientRect();
  menu.style.display = "block";
  const mw = 180;
  menu.style.top = Math.min(window.innerHeight - 250, r.bottom + 4) + "px";
  menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left)) + "px";
  for (const b of menu.children) b.setAttribute("role", "menuitem");
  if (menu.firstElementChild) menu.firstElementChild.focus();
  setTimeout(() => document.addEventListener("click", closeStatusMenu, { once: true }), 0);
}
function closeStatusMenu() {
  const menu = $("#stMenu");
  const wasOpen = menu.style.display === "block";
  menu.style.display = "none";
  const a = menu._anchor;
  menu._anchor = null;
  if (wasOpen && a && document.contains(a) && menu.contains(document.activeElement)) a.focus();
}
$("#stMenu").addEventListener("keydown", ev => {
  const items = [...$("#stMenu").children];
  const i = items.indexOf(document.activeElement);
  if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (ev.key === "Escape") { ev.preventDefault(); closeStatusMenu(); }
  else if (ev.key === "Tab") {
    // dismiss, then continue from the chip that opened the menu: the menu
    // is not in the page's tab order, so the browser could not do it itself
    const anchor = $("#stMenu")._anchor;
    const order = () => [...document.querySelectorAll(FOCUSABLE)].filter(e => isShown(e) && !$("#stMenu").contains(e));
    closeStatusMenu();
    const list = order(), at = list.indexOf(anchor);
    const next = at < 0 ? null : list[at + (ev.shiftKey ? -1 : 1)];
    if (next) { ev.preventDefault(); next.focus(); }
  }
});
