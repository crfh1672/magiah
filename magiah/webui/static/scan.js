/* ============ מגיה — scan.js: scan screen, run scan, single-book scan ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ---------------------------------------------------------- scan view */
/* scan management is a screen of its own (it used to be a modal) */
function openScanModal() { showView("scan"); }
function loadScanView() {
  loadBackups();
  loadScanConfig().catch(e => toast("טעינת הגדרות הסריקה נכשלה: " + e.message, "err"));
  syncScanStatusOnce();
}

async function loadBackups() {
  const box = $("#backupsList");
  box.replaceChildren(el("div", null, "טוען…"));
  try {
    const resp = await api("/api/backups");
    const list = Array.isArray(resp) ? resp : (resp.backups || resp.files || []);
    box.replaceChildren();
    if (!list.length) { box.append(el("div", { style: "color:var(--faint)" }, "אין גיבויים עדיין")); return; }
    for (const item of list) {
      const file = typeof item === "string" ? item : (item.file || item.name || item.path || "");
      const extraTxt = typeof item === "object" && item.ts ? " · " + item.ts : "";
      const btn = el("button", { class: "btn" }, "↩ שחזר");
      btn.addEventListener("click", async () => {
        if (!confirm("לשחזר את הגיבוי?\n" + file + "\n\nההחלטות הנוכחיות יוחלפו בתוכן הגיבוי (התאמה לפי זהות הממצא).")) return;
        try {
          const r = await api("/api/restore", { method: "POST", body: { file } });
          toast(hebrewResult(r, "הגיבוי שוחזר בהצלחה"), "ok", 6000);
          afterDataChanged();
        } catch (e) { toast("השחזור נכשל: " + e.message, "err"); }
      });
      box.append(el("div", { class: "bk-item" }, el("code", null, file + extraTxt), btn));
    }
  } catch (e) {
    box.replaceChildren(el("div", null, "טעינת הגיבויים נכשלה: " + e.message));
  }
}

function hebrewResult(resp, fallback) {
  if (!resp) return fallback;
  if (resp.message) return resp.message;
  const parts = [];
  if (resp.added != null) parts.push("נוספו " + fmtNum(resp.added));
  if (resp.removed != null) parts.push("הוסרו " + fmtNum(resp.removed));
  if (resp.kept != null) parts.push("נשמרו " + fmtNum(resp.kept) + " החלטות");
  if (resp.migrated != null) parts.push("יובאו " + fmtNum(resp.migrated) + " החלטות");
  if (resp.restored != null) parts.push("שוחזרו " + fmtNum(resp.restored) + " החלטות");
  if (resp.backup) parts.push("גיבוי נשמר: " + resp.backup);
  return parts.length ? parts.join(", ") : fallback;
}

async function refreshFindings() {
  if (!confirm("לרענן את הממצאים מהסריקה הנוכחית (report.db)?\n\nהחלטות על ממצאים שעדיין קיימים — יישמרו. ממצאים שנעלמו — יוסרו. ממצאים חדשים יתווספו כ«טרם נבדק».")) return;
  try {
    toast("מרענן מסריקה חדשה — נא להמתין…");
    refreshToast(await api("/api/refresh", { method: "POST", body: {} }));
    afterDataChanged();
  } catch (e) { toast("הרענון נכשל: " + e.message, "err"); }
}

/* /api/refresh says whether what it loaded is the latest scan's results:
   reloading the previous scan's results after a failed scan is no success. */
function refreshToast(r) {
  if (r && r.stale) toast(r.message, "warn", 15000);
  else toast(hebrewResult(r, "הרענון הושלם"), "ok", 8000);
}

function bindScanModal() {
  $("#btnScan").addEventListener("click", openScanModal);
  bindScanRun();
  bindBookScan();
  $("#scanRefresh").addEventListener("click", refreshFindings);
  $("#scanImportLegacy").addEventListener("click", async () => {
    if (!confirm("לייבא את ההחלטות מהכלי הישן (decisions.db)?\n\nהחלטות accept יהפכו ל«אושר», reject ל«לא שגיאה» (כולל חוקי «בכל מקום»), ignore ל«התעלם». ההחלטות ישויכו לממצאים לפי מילה ומזהה שורה.")) return;
    try {
      const r = await api("/api/import_legacy", { method: "POST", body: {} });
      toast("הייבוא הושלם: " + hebrewResult(r, "בוצע"), "ok", 7000);
      afterDataChanged();
    } catch (e) { toast("הייבוא נכשל: " + e.message, "err"); }
  });
  armDanger("Statuses", "אפס", async () => {
    const r = await api("/api/reset", { method: "POST", body: { scope: "statuses" } });
    toast("האיפוס הושלם. " + (r && r.backup ? "גיבוי נשמר: " + r.backup : hebrewResult(r, "")), "ok", 8000);
    afterDataChanged();
  });
  armDanger("All", "אפס הכל", async () => {
    const r = await api("/api/reset", { method: "POST", body: { scope: "all" } });
    toast("האיפוס המלא הושלם. " + (r && r.backup ? "גיבוי נשמר: " + r.backup : hebrewResult(r, "")), "ok", 8000);
    afterDataChanged();
  });
}

/* danger zone: the button only opens a confirm row; the destructive call is
   enabled once the person types the confirmation word */
function armDanger(key, word, run) {
  const btn = $("#scanReset" + key), box = $("#dz" + key), inp = $("#dz" + key + "Input"), go = $("#dz" + key + "Go");
  const close = () => { box.hidden = true; btn.setAttribute("aria-expanded", "false"); inp.value = ""; go.disabled = true; };
  btn.addEventListener("click", () => {
    box.hidden = !box.hidden;
    btn.setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) inp.focus();
  });
  inp.addEventListener("input", () => { go.disabled = inp.value.trim() !== word; });
  inp.addEventListener("keydown", ev => { if (ev.key === "Enter" && !go.disabled) go.click(); });
  box.querySelector("[data-dz-cancel]").addEventListener("click", () => { close(); btn.focus(); });
  go.addEventListener("click", async () => {
    if (inp.value.trim() !== word) return;
    go.disabled = true;
    try { await run(); close(); }
    catch (e) { toast("האיפוס נכשל: " + e.message, "err"); go.disabled = inp.value.trim() !== word; }
  });
}

/* ------------------------------------------------ §9d — run scan from UI */
const SCAN = { cfg: null, pollTimer: null, lastState: "idle", statusSeq: 0 };

/* fallback Hebrew stage names — real ones come from /api/scan/config */
const STAGE_HEBREW = {
  lexicon: "בניית מילון",
  calibrate: "כיול",
  detect: "איתור",
  locate: "מיקום",
  report: "דוחות",
};

function fmtElapsed(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const mm = Math.floor(s / 60), ss = s % 60;
  return String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
}

async function loadScanConfig(force) {
  if (SCAN.cfg && !force) return SCAN.cfg;
  SCAN.cfg = await api("/api/scan/config");
  renderScanForm();
  return SCAN.cfg;
}

function scanMode() {
  const r = $("#scanModes input:checked");
  return r ? r.value : "hybrid";
}

function updateScanPathRows() {
  const m = scanMode();
  $("#scanLibRow").style.display = (m === "sqlite") ? "none" : "";
  $("#scanDbRow").style.display = (m === "library") ? "none" : "";
}

function renderScanForm() {
  const cfg = SCAN.cfg;
  if (!cfg) return;
  // corpus mode radios
  const modes = $("#scanModes");
  modes.replaceChildren();
  for (const m of (cfg.corpus_modes || [])) {
    const rb = el("input", { type: "radio", name: "scanMode", value: m.key });
    rb.checked = (cfg.corpus && cfg.corpus.mode) === m.key;
    rb.addEventListener("change", updateScanPathRows);
    modes.append(el("label", { class: "chk-row" }, rb,
      el("span", null, m.hebrew, el("span", { class: "mode-desc" }, m.explanation || ""))));
  }
  if (!$("#scanModes input:checked")) {
    const first = $("#scanModes input");
    if (first) first.checked = true;
  }
  $("#scanLibDir").value = (cfg.corpus && cfg.corpus.library_dir) || "";
  $("#scanDbPath").value = (cfg.corpus && cfg.corpus.db_path) || "";
  updateScanPathRows();
  // stages
  const stBox = $("#scanStages");
  stBox.replaceChildren();
  for (const s of (cfg.stages || [])) {
    const cb = el("input", { type: "checkbox", value: s.key });
    // calibrate needs a previous scan's report.db, so it is off by default
    cb.checked = s.default !== false;
    stBox.append(el("label", { class: "chk-row", title: s.explanation || "" }, cb, el("span", null, s.hebrew)));
  }
  // advanced config fields
  const fBox = $("#scanFields");
  fBox.replaceChildren();
  for (const f of (cfg.fields || [])) {
    const row = el("div", { class: "scan-field", dataset: { key: f.key, ftype: f.type } });
    row.append(el("span", { class: "sf-label" }, f.hebrew));
    if (f.type === "list") {
      const ta = el("textarea", { placeholder: "נתיב קובץ בכל שורה…" });
      ta.value = Array.isArray(f.value) ? f.value.join("\n") : "";
      row.append(el("span"), ta);
    } else {
      const inp = el("input", { type: "number", step: f.type === "float" ? "any" : "1" });
      inp.value = f.value != null ? String(f.value) : "";
      row.append(inp);
    }
    const defTxt = Array.isArray(f.default) ? (f.default.length ? f.default.join(", ") : "ללא") : String(f.default);
    row.append(el("span", { class: "sf-exp" }, (f.explanation || "") + " (ברירת מחדל: " + defTxt + ")"));
    fBox.append(row);
  }
}

function collectScanRequest() {
  const stages = $$("#scanStages input:checked").map(c => c.value);
  const config = {};
  for (const row of $$("#scanFields .scan-field")) {
    const key = row.dataset.key, type = row.dataset.ftype;
    if (type === "list") {
      const ta = row.querySelector("textarea");
      config[key] = ta.value.split("\n").map(s => s.trim()).filter(Boolean);
    } else {
      const v = row.querySelector("input").value.trim();
      if (v !== "") config[key] = type === "float" ? parseFloat(v) : parseInt(v, 10);
    }
  }
  return {
    stages,
    config,
    corpus: {
      mode: scanMode(),
      library_dir: $("#scanLibDir").value.trim(),
      db_path: $("#scanDbPath").value.trim(),
    },
  };
}

/* allow_unread is per run and never saved (Config.PER_RUN). The field sits in
   the collapsed advanced section, so a value left in it is named in the start
   confirmation and cleared once a run has taken it — a later scan never
   inherits it unseen. */
function allowUnreadNote(req) {
  const n = req.config.allow_unread || 0;
  const tpl = SCAN.cfg && SCAN.cfg.allow_unread_confirm;
  return n > 0 && tpl ? "\n\n" + tpl.replace("{n}", fmtNum(n)) : "";
}
function clearAllowUnread() {
  const inp = $('#scanFields .scan-field[data-key="allow_unread"] input');
  if (inp) inp.value = "0";
}

function stageHebrew(key) {
  const s = ((SCAN.cfg && SCAN.cfg.stages) || []).find(x => x.key === key);
  return s ? s.hebrew : (STAGE_HEBREW[key] || key);
}

function renderScanProgress(st) {
  const wrap = $("#scanProgress");
  const running = st.state === "running";
  const known = ["running", "done", "failed", "cancelled"].includes(st.state);
  // show the block whenever a scan is running or has produced a result
  wrap.hidden = !known;
  if (!known) return;

  const total = (st.total_stages != null ? st.total_stages : (st.stages || []).length) || 0;
  const idx = (st.stage_index != null && st.stage_index >= 0) ? st.stage_index : 0;
  const stageKey = st.stage || (st.stages || [])[idx] || "";

  // stage line: "שלב X מתוך Y: <name>"
  const stageLine = $("#scanStageLine");
  if (running && st.is_book) {
    // one indivisible stage — there is no "stage i of n" to report
    stageLine.textContent = "סורק ספר בודד מול המילון הקיים…";
  } else if (running && stageKey && total) {
    stageLine.textContent = "שלב " + fmtNum(idx + 1) + " מתוך " + fmtNum(total) + ": " + stageHebrew(stageKey);
  } else if (st.state === "done") {
    stageLine.textContent = "כל השלבים הושלמו ✓";
  } else if (st.state === "failed") {
    stageLine.textContent = "הסריקה נעצרה עקב שגיאה";
  } else if (st.state === "cancelled") {
    stageLine.textContent = "הסריקה בוטלה";
  } else {
    stageLine.textContent = "";
  }

  // percent (0/NaN -> 0), bar fill + color
  let pct = Number(st.percent);
  if (isNaN(pct) || pct < 0) pct = 0;
  if (st.state === "done") pct = 100;
  pct = Math.min(100, Math.round(pct * 10) / 10);
  const bar = $("#scanBar");
  const cd = Number(st.chunk_done) || 0, ctot = Number(st.chunk_total) || 0;
  // A book scan reports no chunks, so there is no honest percentage to show:
  // use an indeterminate (animated) bar rather than a bar frozen at 0%.
  const indet = running && st.is_book && ctot === 0;
  bar.classList.toggle("indet", indet);
  // a book scan that failed/was cancelled has no meaningful percentage; let
  // the bar stay full and turn red instead of visibly draining to 0%
  const bookEnded = st.is_book && !running && st.state !== "idle";
  bar.style.width = (indet || bookEnded) ? "100%" : pct + "%";
  bar.classList.toggle("done", st.state === "done");
  bar.classList.toggle("err", st.state === "failed" || st.state === "cancelled");

  // chunk text (only when a chunk total is known)
  $("#scanChunkText").textContent = (running && ctot > 0)
    ? "נתח " + fmtNum(cd) + " מתוך " + fmtNum(ctot)
    : "";
  $("#scanPctText").textContent = (indet || bookEnded) ? "" : pct + "%";
  $("#scanElapsed").textContent = "זמן שחלף: " + fmtElapsed(st.elapsed);

  // lexicon-is-longest note — only during the lexicon stage
  $("#scanLexiconNote").hidden = !(running && stageKey === "lexicon");
}

function renderScanStatus(st) {
  const panel = $("#scanStatusPanel");
  const line = $("#scanStateLine");
  const running = st.state === "running";
  panel.hidden = st.state === "idle" && !(st.log_tail || []).length;
  let txt = st.hebrew_state || st.state;
  if (st.started_at) txt += " · התחילה: " + st.started_at;
  // the backend's precise Hebrew reason is far more useful than "נכשלה"
  if (st.state === "failed" && st.error) txt += " — " + st.error;
  line.textContent = txt;
  line.className = running ? "run" : (st.state === "done" ? "ok" : (st.state === "idle" ? "" : "err"));
  renderScanProgress(st);
  const log = $("#scanLog");
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.textContent = (st.log_tail || []).join("\n");
  if (atBottom) log.scrollTop = log.scrollHeight;
  $("#scanStart").hidden = running;
  $("#scanCancel").hidden = !running;
  // a book scan merges its findings itself, so there is nothing to refresh
  $("#scanRefreshAfter").hidden = st.state !== "done" || !!st.is_book;
  if (running) startScanPolling();
  else stopScanPolling();
  if (SCAN.lastState === "running" && !running) {
    if (st.state === "done" && st.is_book) {
      const r = (st.book && st.book.result) || {};
      const name = (st.book && st.book.title) || "הספר";
      // `added` is every merged row; `findings` counts only the error family
      toast("סריקת «" + name + "» הושלמה: " + fmtNum(r.added || 0) +
            " ממצאים" +
            (r.replaced ? " (הוחלפו " + fmtNum(r.replaced) + " קודמים)" : "") +
            (r.preserved ? ", " + fmtNum(r.preserved) + " החלטות נשמרו" : ""),
            "ok", 9000);
      // the findings are already merged — reload the views, but leave the
      // panel open so the user can read the log and scan another book
      reloadAfterBookScan();
    }
    else if (st.state === "done") toast("הסריקה הושלמה — אפשר לרענן את הממצאים", "ok", 8000);
    else if (st.state === "failed") toast("הסריקה נכשלה: " + (st.error || "ראו את יומן הריצה"), "err", 10000);
    else if (st.state === "cancelled") toast("הסריקה בוטלה", "", 5000);
    // the scan's run record is final before its status turns, so the banner
    // can show this outcome now (a finished book scan reloaded it above)
    if (!(st.state === "done" && st.is_book)) reloadResultStatus();
  }
  SCAN.lastState = st.state;
}

/* The poller and syncScanStatusOnce race: a slow "running" response can land
   after a newer "done" one and reset SCAN.lastState, which re-fires the
   completion branch (duplicate toast + a second full reload). Drop any
   response older than the newest one already rendered. */
async function fetchScanStatus() {
  const seq = ++SCAN.statusSeq;
  let st;
  try { st = await api("/api/scan/status"); }
  catch (e) { return; }
  if (seq !== SCAN.statusSeq) return;
  renderScanStatus(st);
}

async function syncScanStatusOnce() { await fetchScanStatus(); }

function startScanPolling() {
  if (SCAN.pollTimer) return;
  SCAN.pollTimer = setInterval(fetchScanStatus, 2000);
}
function stopScanPolling() {
  if (SCAN.pollTimer) { clearInterval(SCAN.pollTimer); SCAN.pollTimer = null; }
}

function bindScanRun() {
  $("#scanStart").addEventListener("click", async () => {
    const req = collectScanRequest();
    if (!req.stages.length) { toast("יש לבחור לפחות שלב אחד להרצה", "err"); return; }
    if (!confirm("להתחיל סריקה חדשה?\n\nשלבים: " + req.stages.map(stageHebrew).join(", ") + "\nהסריקה עשויה להימשך זמן רב; אפשר לעקוב אחרי ההתקדמות ביומן." + allowUnreadNote(req))) return;
    try {
      const r = await api("/api/scan/start", { method: "POST", body: req });
      SCAN.statusSeq++;     // a status read still in flight predates this start
      clearAllowUnread();
      toast((r && r.message) || "הסריקה הופעלה", "ok");
      $("#scanRunSection").setAttribute("open", "");
      renderScanStatus((r && r.status) || { state: "running", log_tail: [] });
    } catch (e) {
      toast("הפעלת הסריקה נכשלה: " + e.message, "err", 8000);
    }
  });
  $("#scanCancel").addEventListener("click", async () => {
    if (!confirm("לבטל את הסריקה הרצה?")) return;
    try {
      const r = await api("/api/scan/cancel", { method: "POST", body: {} });
      toast((r && r.message) || "בקשת הביטול נשלחה", "ok");
      syncScanStatusOnce();
    } catch (e) { toast("הביטול נכשל: " + e.message, "err"); }
  });
  $("#scanRefreshAfter").addEventListener("click", async () => {
    try {
      toast("מרענן ממצאים מהסריקה החדשה — נא להמתין…");
      refreshToast(await api("/api/refresh", { method: "POST", body: {} }));
      $("#scanRefreshAfter").hidden = true;
      afterDataChanged();
    } catch (e) { toast("הרענון נכשל: " + e.message, "err", 8000); }
  });
}

/* -------------------------------------------- single-book scan (fast path) */
const BS = { source: "db", chosen: null, seq: 0 };

function bsSource() {
  const r = $("#bsSources input:checked");
  return r ? r.value : "db";
}

function bsUpdateRows() {
  const isFile = bsSource() === "file";
  $("#bsPickRow").hidden = isFile;
  $("#bsFileRow").hidden = !isFile;
}

function bsSetChosen(book) {
  BS.chosen = book;
  const box = $("#bsChosen");
  if (!book) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(
    "📖 ייסרק: " + book.title,
    book.origin ? el("span", { class: "bs-org" }, "  · " + book.origin) : null,
    book.path ? el("span", { class: "bs-path" }, book.path) : null
  );
}

async function bsSearch() {
  // bump FIRST: an early return must still invalidate any in-flight request,
  // or a response for a query the user already cleared repaints the list
  const seq = ++BS.seq;
  const src = bsSource();
  if (src === "file") return;
  const q = $("#bsSearch").value.trim();
  const box = $("#bsResults");
  if (!q) { box.replaceChildren(el("div", { class: "empty" }, "הקלד כדי לחפש ספר…")); return; }
  box.replaceChildren(el("div", { class: "empty" }, "מחפש…"));
  // search the corpus the scan will actually use — the paths in the full-scan
  // panel above, not whatever run_config.json happens to hold
  const corpus = collectScanRequest().corpus || {};
  let data;
  try {
    data = await api("/api/scan/books?source=" + encodeURIComponent(src) +
                     "&q=" + encodeURIComponent(q) + "&limit=100" +
                     "&library_dir=" + encodeURIComponent(corpus.library_dir || "") +
                     "&db_path=" + encodeURIComponent(corpus.db_path || ""));
  } catch (e) {
    if (seq === BS.seq) box.replaceChildren(el("div", { class: "empty" }, "החיפוש נכשל: " + e.message));
    return;
  }
  if (seq !== BS.seq) return;
  const books = (data && data.books) || [];
  if (!books.length) { box.replaceChildren(el("div", { class: "empty" }, "לא נמצאו ספרים מתאימים")); return; }
  box.replaceChildren(...books.map(b => {
    // several library books can share a filename (three different ספר רשות),
    // so show the folder that tells them apart
    const dir = b.path ? b.path.replace(/\/[^/]*$/, "") : "";
    const row = el("div", { class: "bs-item", title: b.path || b.title },
      el("span", { class: "bs-ttl" }, b.title,
        dir ? el("span", { class: "bs-path" }, dir) : null),
      el("span", { class: "bs-org" }, b.origin || ""));
    const choose = () => {
      $$("#bsResults .bs-item").forEach(x => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
      row.classList.add("on");
      row.setAttribute("aria-pressed", "true");
      bsSetChosen(b);
    };
    row.addEventListener("click", choose);
    makeActivatable(row, choose, "button");
    row.setAttribute("aria-pressed", "false");
    return row;
  }));
}

function bindBookScan() {
  $$("#bsSources input").forEach(r => r.addEventListener("change", () => {
    bsUpdateRows();
    bsSetChosen(null);
    $("#bsResults").replaceChildren(el("div", { class: "empty" }, "הקלד כדי לחפש ספר…"));
    bsSearch();
  }));
  $("#bsSearch").addEventListener("input", debounce(bsSearch, 300));
  // the book list comes from the corpus named in the full-scan panel; when
  // that changes, the chosen book may no longer exist there, or may be a
  // different book under the same id — drop it and search again
  const corpusChanged = () => {
    if (!BS.chosen && !$("#bsSearch").value.trim()) return;
    bsSetChosen(null);
    bsSearch();
  };
  ["#scanLibDir", "#scanDbPath"].forEach(sel => $(sel).addEventListener("change", corpusChanged));
  $("#scanModes").addEventListener("change", corpusChanged);
  bsUpdateRows();

  $("#bsStart").addEventListener("click", async () => {
    const src = bsSource();
    let key = null, label = "";
    if (src === "file") {
      key = $("#bsFilePath").value.trim();
      label = key;
      if (!key) { toast("יש להזין נתיב לקובץ", "err"); return; }
    } else {
      if (!BS.chosen) { toast("יש לבחור ספר מהרשימה", "err"); return; }
      key = BS.chosen.key;
      label = BS.chosen.title;
    }
    const verify = $("#bsVerifyCtx").checked;
    const req = collectScanRequest();
    if (!confirm("לסרוק את «" + label + "»?\n\n" +
                 "הסריקה מתבססת על המילון הקיים ואורכת שניות." +
                 (verify ? "\n\n⚠ סימנת «אימות הקשר מול כל המאגר» — הסריקה " +
                           "תימשך כ־10 דקות במקום שניות." : "") +
                 "\n\nממצאים קודמים של ספר זה יוחלפו; ההחלטות שלך עליהם יישמרו." +
                 allowUnreadNote(req))) return;
    try {
      // the book source is chosen apart from the full scan's corpus mode, but
      // the server derives the paths it uses from that mode: "library" has no
      // database and "sqlite" no library folder. "hybrid" carries both.
      const corpus = Object.assign({}, req.corpus);
      if ((src === "db" && corpus.mode === "library") ||
          (src === "library" && corpus.mode === "sqlite")) corpus.mode = "hybrid";
      const r = await api("/api/scan/book", {
        method: "POST",
        body: { source: src, book: key, verify_ctx: verify,
                config: req.config, corpus },
      });
      SCAN.statusSeq++;     // a status read still in flight predates this start
      clearAllowUnread();
      toast((r && r.message) || "סריקת הספר הופעלה", "ok");
      $("#scanRunSection").setAttribute("open", "");
      renderScanStatus((r && r.status) || { state: "running", log_tail: [] });
    } catch (e) {
      toast("הפעלת סריקת הספר נכשלה: " + e.message, "err", 9000);
    }
  });
}

/* Same refresh as afterDataChanged, minus closing the modal: a book scan is
   short and usually repeated for the next book, so the panel stays open. */
async function reloadAfterBookScan() {
  S.lastActions = [];
  S.sel.clear();
  S.cardStale = true;
  try { S.meta = await api("/api/meta"); buildSidebar(); } catch (e) {}
  renderResultBanner();
  loadBooks();
  refreshCurrentView();
  updateProgress();
}

async function afterDataChanged() {
  // the scan screen is a regular view now; there is no modal to close
  S.lastActions = [];
  S.sel.clear();
  S.cardStale = true;
  try { S.meta = await api("/api/meta"); buildSidebar(); } catch (e) {}
  renderResultBanner();
  loadBooks();
  refreshCurrentView();
  updateProgress();
}
