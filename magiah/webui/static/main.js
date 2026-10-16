/* ============ מגיה — main.js: exports, view switching, keyboard, tooltips, theme, init ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ---------------------------------------------------------- exports */
function bindExports() {
  $("#expXlsxCurrent").addEventListener("click", async () => {
    closeExportMenu();
    if (!S.filters.origin) { toast("בחרו מאגר בסינון תחילה, או השתמשו ב«כל המאגרים»", "err"); return; }
    await runExport("/api/export/xlsx", { origin: S.filters.origin }, "ייצוא Excel למאגר " + (originInfo(S.filters.origin).hebrew || S.filters.origin));
  });
  $("#expXlsxAll").addEventListener("click", async () => {
    closeExportMenu();
    await runExport("/api/export/xlsx", {}, "ייצוא Excel לכל המאגרים");
  });
  $("#expFixes").addEventListener("click", async () => {
    closeExportMenu();
    await runExport("/api/export/fixes", {}, "ייצוא תיקונים ל־to_send");
  });
}
function closeExportMenu() { $$("details.menu-wrap").forEach(d => d.removeAttribute("open")); }

async function runExport(path, body, label) {
  toast(label + " — מתבצע, נא להמתין…");
  try {
    const r = await api(path, { method: "POST", body });
    let msg = label + " הושלם.";
    if (r) {
      if (Array.isArray(r.files) && r.files.length) {
        msg += " נכתבו " + fmtNum(r.files.length) + " קבצים.";
      } else if (Array.isArray(r.paths) && r.paths.length) {
        msg += " נכתבו " + fmtNum(r.paths.length) + " קבצים.";
      }
      if (r.rows != null) msg += " " + fmtNum(r.rows) + " שורות.";
      if (r.approved != null) msg += " " + fmtNum(r.approved) + " תיקונים מאושרים.";
      if (r.rejected != null) msg += " " + fmtNum(r.rejected) + " מילים דחויות.";
      if (r.message) msg = r.message;
    }
    toast(msg, "ok", 8000);
  } catch (e) {
    toast(label + " נכשל: " + e.message, "err", 8000);
  }
}

/* ---------------------------------------------------------- views */
function showView(v, skipHash) {
  S.view = v;
  $$("#viewtabs button[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  $("#btnHelp").classList.toggle("active", v === "help");
  $("#btnScan").classList.toggle("active", v === "scan");
  $$("section.view").forEach(s => s.classList.toggle("visible", s.id === "view-" + v));
  if (!skipHash) writeHash();
  renderActiveFilters();
  refreshCurrentView();
}

function refreshCurrentView() {
  switch (S.view) {
    case "table": loadTable(); break;
    case "cards": loadFacets(); if (S.cardStale) resetCardQueue(); else { renderCard(); ensureCardQueue(); } break;
    case "fixer": loadFixerBooks().then(loadFixDoc); break;
    case "stats": loadStats(); break;
    case "help": renderHelp(); break;
    case "scan": loadScanView(); break;
  }
}

/* ---------------------------------------------------------- keyboard */
const HEB_KEYS = {
  // Hebrew char / physical code → action
  approve: ["י", "KeyH"],
  reject: ["נ", "KeyB"],
  rejectAll: ["ד", "KeyS"],
  fixTyped: ["ת", "Comma"],
  ignore: ["ע", "KeyG"],
  unsure: ["ב", "KeyC"],
  fixedBook: ["ק", "KeyE"],
};
function keyIs(ev, action) {
  const [heb, code] = HEB_KEYS[action];
  return ev.key === heb || ev.code === code;
}

document.addEventListener("keydown", ev => {
  // Ctrl+Z anywhere — except while typing, where it undoes the text edit
  if (!isTextField(ev.target) && (ev.ctrlKey || ev.metaKey) && (ev.code === "KeyZ" || ev.key === "z" || ev.key === "Z")) {
    ev.preventDefault();
    doUndo();
    return;
  }
  if (ev.key === "Escape") {
    closeDrawer(); closeStatusMenu(); closeExportMenu(); closeFilterDialog();
    if (S.cardFixOpen) toggleCardFix(false);
    return;
  }
  const t = ev.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  if ($("#drawer").classList.contains("visible") || filterDialogOpen()) return;
  // Space on a focused button / summary / link belongs to that control
  if ((ev.code === "Space" || ev.key === " ") && isControl(t)) return;

  if (S.view === "cards") {
    if (keyIs(ev, "approve")) { ev.preventDefault(); cardAct("approved"); }
    else if (keyIs(ev, "reject")) { ev.preventDefault(); cardAct("not_error"); }
    else if (keyIs(ev, "rejectAll")) { ev.preventDefault(); cardAct("not_error", { scope: "word" }); }
    else if (keyIs(ev, "fixTyped")) { ev.preventDefault(); toggleCardFix(true); }
    else if (keyIs(ev, "ignore")) { ev.preventDefault(); cardAct("ignored"); }
    else if (keyIs(ev, "unsure")) { ev.preventDefault(); cardAct("unsure"); }
    else if (keyIs(ev, "fixedBook")) { ev.preventDefault(); cardAct("fixed"); }
    else if (ev.code === "Space" || ev.key === " ") { ev.preventDefault(); cardSkip(); }
  } else if (S.view === "fixer") {
    const cur = currentFixRow();
    if ((ev.ctrlKey || ev.metaKey) && (ev.code === "KeyS" || ev.key === "s")) {
      ev.preventDefault();                       // beats the browser's Save
      applyFixes();
    } else if ((ev.key === "Enter" && !isControl(t)) || keyIs(ev, "fixedBook")) {
      // Enter on a focused button (Apply, a mode toggle…) activates it
      ev.preventDefault(); if (cur) markFixed(cur);
    } else if (ev.code === "ArrowDown") {
      ev.preventDefault(); moveFixSelection(1);
    } else if (ev.code === "ArrowUp") {
      ev.preventDefault(); moveFixSelection(-1);
    } else if (ev.code === "Home") {
      ev.preventDefault(); { const v = visibleFixRows(); if (v.length) selectFixRowById(v[0].id); }
    } else if (ev.code === "End") {
      ev.preventDefault(); { const v = visibleFixRows(); if (v.length) selectFixRowById(v[v.length - 1].id); }
    } else if (ev.key === "ס" || ev.code === "KeyX") {
      // toggle THIS correction between plain replace and (תיקון) [שגיאה]
      if (cur) {
        ev.preventDefault();
        S.fixModeOverride.set(cur.id, rowMode(cur) === "bracket" ? "replace" : "bracket");
        renderFixList(false);
      }
    } else if (ev.key === "פ" || ev.code === "KeyP") {
      if (cur && canApply(cur)) {
        ev.preventDefault();
        if (S.fixPicked.has(cur.id)) S.fixPicked.delete(cur.id);
        else S.fixPicked.add(cur.id);
        renderFixList(false);
      }
    } else if (ev.key >= "1" && ev.key <= "6" && !ev.ctrlKey && !ev.altKey) {
      const st = ["approved", "not_error", "unsure", "ignored", "fixed", "pending"][+ev.key - 1];
      if (cur && st) { ev.preventDefault(); fixAct(cur, st); }
    }
  }
});

/* ---------------------------------------------------------- tooltips */
function showTip(t) {
  const tip = $("#tooltip");
  if (!t) { tip.style.display = "none"; return; }
  tip.textContent = t.dataset.tip;
  tip.style.display = "block";
  const r = t.getBoundingClientRect();
  const tw = Math.min(290, tip.offsetWidth);
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
  let y = r.bottom + 7;
  if (y + tip.offsetHeight > window.innerHeight - 8) y = r.top - tip.offsetHeight - 7;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
const tipTarget = ev => ev.target.closest && ev.target.closest("[data-tip]");
document.addEventListener("mouseover", ev => showTip(tipTarget(ev)));
document.addEventListener("focusin", ev => showTip(tipTarget(ev)));
document.addEventListener("focusout", () => showTip(null));

/* ---------------------------------------------------------- theme */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("#btnTheme").replaceChildren(icon(t === "dark" ? "sun" : "moon"), t === "dark" ? " מצב בהיר" : " מצב כהה");
  try { localStorage.setItem("magiah_theme", t); } catch (e) {}
}
function initTheme() {
  let t = null;
  try { t = localStorage.getItem("magiah_theme"); } catch (e) {}
  if (!t) t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  applyTheme(t);
  $("#btnTheme").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
}

/* ---------------------------------------------------------- init */
function bindControls() {
  $("#fOrigin").addEventListener("change", () => {
    S.filters.origin = $("#fOrigin").value;
    S.filters.book = "";
    loadBooks();
    filtersChanged();
  });
  $("#fBookSearch").addEventListener("input", loadBooks);
  $("#fVerified").addEventListener("change", () => { S.filters.verified = $("#fVerified").checked; filtersChanged(); });
  const mrSync = v => {
    S.filters.min_rank = parseFloat(v) || 0;
    $("#fMinRank").value = S.filters.min_rank;
    $("#fMinRankVal").value = S.filters.min_rank;
  };
  $("#fMinRank").addEventListener("input", () => { mrSync($("#fMinRank").value); });
  $("#fMinRank").addEventListener("change", () => { filtersChanged(); });
  $("#fMinRankVal").addEventListener("change", () => { mrSync($("#fMinRankVal").value); filtersChanged(); });
  $("#fSort").addEventListener("change", () => {
    const [s, d] = $("#fSort").value.split(":");
    S.filters.sort = s; S.filters.dir = d || "desc";
    filtersChanged();
  });
  $("#btnClearFilters").addEventListener("click", clearFilters);
  $("#globalSearch").addEventListener("input", debounce(() => {
    S.filters.q = $("#globalSearch").value.trim();
    filtersChanged();
  }, 350));
  $("#btnUndo").addEventListener("click", doUndo);
  $$("#topbar [data-goview]").forEach(b => b.addEventListener("click", () => showView(b.dataset.goview)));
  $$("#viewtabs button[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerScrim").addEventListener("click", closeDrawer);
  $("#bulkClear").addEventListener("click", () => { S.sel.clear(); renderTableRows(); updateBulkBar(); });
  $("#btnSidebar").addEventListener("click", () => (filterDialogOpen() ? closeFilterDialog() : openFilterDialog()));
  $("#filterScrim").addEventListener("click", closeFilterDialog);
  $("#filterClose").addEventListener("click", closeFilterDialog);
  $("#filterDone").addEventListener("click", closeFilterDialog);
  $("#fixBook").addEventListener("change", () => { S.fixKey = $("#fixBook").value; writeHash(); loadFixDoc(); });
  $("#fixInclude").addEventListener("change", () => {
    S.fixInclude = $("#fixInclude").checked;
    writeHash();
    loadFixerBooks().then(loadFixDoc);
  });
  for (const b of $$("#fixPickBar .fp-btn")) {
    b.addEventListener("click", () => fixPick(b.dataset.pick));
  }
  // the same two switches sit in the filter window and in the fixer bar
  for (const [prop, ids] of [["hideIrr", ["#fHideIrr", "#fixHideIrrelevant"]],
                             ["hideDb", ["#fHideDb", "#fixHideExportOnly"]]]) {
    try { const v = localStorage.getItem("magiah_" + prop); if (v !== null) S[prop] = v === "1"; } catch (e) {}
    for (const id of ids) {
      const box = $(id);
      box.checked = S[prop];
      box.addEventListener("change", () => {
        applyHide(prop, box.checked);
        loadBooks();
        filtersChanged();
      });
    }
  }
  $("#fixBookSearch").addEventListener("input", debounce(renderFixBookOptions, 120));
  $("#fixBookSearch").addEventListener("keydown", ev => {
    // Enter on a single match opens it, so searching never needs the mouse
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const sel = $("#fixBook");
    // count real matches only: the open book is kept in the list even when it
    // does not match, which must not stop a single match from being chosen
    const opts = fixBookHits($("#fixBookSearch").value.trim());
    if (opts.length === 1) {
      sel.value = opts[0].key;
      S.fixKey = sel.value;
      writeHash();
      loadFixDoc();
    }
  });
  $("#fixView").addEventListener("change", () => {
    S.fixView = $("#fixView").value;
    writeHash();
    renderFixList(true);
    renderFixDoc();
  });
  $("#fixModeReplace").addEventListener("click", () => setFixMode("replace"));
  $("#fixModeBracket").addEventListener("click", () => setFixMode("bracket"));
  $("#fixApply").addEventListener("click", applyFixes);
  $("#fixUndoFile").addEventListener("click", undoFileEdit);
  // dropdown menus close on an outside click, and after an item is chosen
  document.addEventListener("click", ev => {
    for (const d of $$("details.menu-wrap[open]")) {
      if (!d.contains(ev.target) || ev.target.closest(".menu button")) d.removeAttribute("open");
    }
  });
  bindExports();
  bindScanModal();
}

async function init() {
  initTheme();
  readHash();
  bindControls();
  try {
    S.meta = await api("/api/meta");
  } catch (e) {
    toast("טעינת הנתונים מהשרת נכשלה: " + e.message, "err", 10000);
    S.meta = { origins: [], errtypes: [], statuses: FALLBACK_STATUSES, columns: [] };
  }
  buildSidebar();
  bindTableTools();
  renderColsMenu();
  renderResultBanner();
  loadBooks();
  showView(S.view, true);
  updateProgress();
  updateSessionCounter();
  syncScanStatusOnce();   // resume live scan status if a scan is running
  if (S.meta && S.meta.no_scan) showNoScanScreen();
}

/* No findings yet: invite the user to run a scan instead of showing an
   empty table. Dismissing it leaves the normal (empty) UI behind. */
function showNoScanScreen() {
  if ($("#noScan")) return;
  const box = el("div", { id: "noScan", class: "no-scan" },
    el("div", { class: "no-scan-card" },
      el("h2", null, "עדיין אין סריקה בתיקייה הזו"),
      el("p", null,
        "הממשק מציג ממצאים מסריקה קיימת, ובתיקייה שנבחרה עדיין אין קובץ " +
        "report.db. אפשר להריץ סריקה עכשיו — בסיומה הממצאים ייטענו לממשק " +
        "ללא צורך בהפעלה מחדש."),
      el("div", { class: "no-scan-actions" },
        el("button", { class: "ns-btn ns-primary", onclick: () => {
          hideNoScanScreen(); openScanModal();
          const d = $("#scanRunSection"); if (d) d.open = true;
        } }, el("bdi", null, "▶"), " הרצת סריקה חדשה"),
        el("button", { class: "ns-btn", onclick: hideNoScanScreen },
          "סגירה"))));
  document.body.appendChild(box);
}
function hideNoScanScreen() {
  const b = $("#noScan"); if (b) b.remove();
}

init();
