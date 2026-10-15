/* ============ מגיה — drawer.js: finding drawer ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ---------------------------------------------------------- drawer */
/* bumped on every open and close, so a response for an earlier opening can
   never replace what the drawer shows now */
let DRAWER_SEQ = 0;

async function openDrawer(id) {
  const seq = ++DRAWER_SEQ;
  $("#drawer").classList.add("visible");
  $("#drawerScrim").classList.add("visible");
  openLayer($("#drawer"), "#viewtabs button.active");
  const body = $("#drawerBody");
  body.replaceChildren(el("div", { class: "loading-row" }, "טוען…"));
  await loadDrawer(id, seq, true);
}

/* fetch the finding and its history, then draw them — unless the drawer has
   been closed or reopened on another finding in the meantime */
async function loadDrawer(id, seq, showErrors) {
  let resp;
  try {
    resp = await api("/api/finding/" + id);
  } catch (e) {
    if (seq !== DRAWER_SEQ) return;
    if (showErrors) {
      $("#drawerBody").replaceChildren(el("div", { class: "loading-row" }, "הטעינה נכשלה: " + e.message));
      toast(e.message, "err");
    }
    return;
  }
  if (seq !== DRAWER_SEQ) return;
  const r = resp.finding || resp.row || resp;
  const history = resp.history || r.history || [];
  // keep local caches in sync if this row is on screen
  const local = localRowsById([r.id])[0];
  if (local) { r.effective_status = effStatus(r) || effStatus(local); }
  renderDrawer(r, history);
}

/* after a change made from the drawer: draw it at once, then refetch so the
   history shows the action that was just recorded */
function drawerChanged(r, history) {
  renderDrawer(r, history);
  loadDrawer(r.id, DRAWER_SEQ, false);
}

// Each candidate correction with the evidence behind it: the detector's, and
// the reading of the aligned verse (works / independent sources / alignment).
function altList(word, alts) {
  const box = el("div", { class: "alt-list" });
  for (const a of alts) {
    if (!a || typeof a !== "object") continue;
    const by = a.by === "tanach" ? "נוסח המקרא" : "הגלאי";
    const parts = [];
    if (a.by === "tanach") {
      if (a.ref) parts.push(a.ref);
      if (a.works != null) parts.push("ספרים: " + a.works);
      if (a.independent_sources != null) parts.push("מקורות בלתי תלויים: " + a.independent_sources);
      if (a.occurrences != null) parts.push("מהדורות: " + a.occurrences);
      if (a.aligned_tokens != null) parts.push("מילים מיושרות: " + a.aligned_tokens);
    } else if (a.agrees_with_tanach) {
      parts.push("זהה לנוסח המקרא");
    }
    box.append(el("div", null,
      el("bdi", null, (word || "") + " ← " + (a.suggestion || "—")),
      " (" + by + ")", parts.length ? " · " + parts.join(" · ") : ""));
  }
  return box;
}

// Hebrew label of a Tanach evidence kind / reason code (from /api/meta);
// anything unknown — a user's own note included — is shown as-is.
function evLabel(code) {
  const m = (S.meta && S.meta.evidence_labels) || {};
  return (typeof code === "string" && m[code]) || code;
}

// An independent source of the Tanach evidence ("host:<site>" or
// "source:<Otzaria source>") in Hebrew.
function tanachSourceLabel(g) {
  if (typeof g !== "string") return String(g);
  if (g.startsWith("host:")) return "אתר " + g.slice(5);
  if (g.startsWith("source:")) {
    const name = g.slice(7);
    return "מאגר " + (originInfo(name).hebrew || name);
  }
  return g;
}

// One edition of a Tanach book, as the evidence names it
// ({edition, book_id, version_id}): where its text is in the database.
function editionRefText(e) {
  if (!e || typeof e !== "object") return String(e);
  const where = e.version_id != null ? "גרסה " + e.version_id
    : "טקסט ראשי של ספר " + (e.book_id != null ? e.book_id : "");
  return (e.edition || "") + " (" + where + ")";
}

const CTX_SCOPE_HE = { book: "בתוך הספר בלבד", corpus: "בכל המאגר" };

// The lines of readable Hebrew the drawer shows for one key of a finding's
// `extra`: never raw JSON, English keys or bare "host:" codes.
function extraLines(k, v) {
  if (v == null || v === "") return [];
  if (typeof v === "boolean") return [v ? "כן" : "לא"];
  if (k === "evidence_kind" || k === "reason") return [String(evLabel(v))];
  if (k === "source" || k === "minority_source") return [tanachSourceLabel(v)];
  if (k === "ctx_scope") return [CTX_SCOPE_HE[v] || String(v)];
  const list = (x) => (Array.isArray(x) ? x : [x]).map(String).join(", ");
  if (k === "witnesses" && Array.isArray(v))
    return v.map((w) => (w && typeof w === "object")
      ? tanachSourceLabel(w.source) + ": " + list(w.editions || [])
      : String(w));
  if (k === "readings" && typeof v === "object" && !Array.isArray(v))
    // {reading: [editions]} (one source), or {reading: {source: [editions]}}
    return Object.entries(v).map(([reading, by]) => "«" + reading + "» — " +
      ((by && typeof by === "object" && !Array.isArray(by))
        ? Object.entries(by).map(([g, eds]) =>
            tanachSourceLabel(g) + " (" + list(eds) + ")").join("; ")
        : list(by)));
  if (k === "word_editions" && Array.isArray(v)) return v.map(editionRefText);
  const labels = (S.meta && S.meta.extra_labels) || {};
  const flat = (x) => (x && typeof x === "object")
    ? (Array.isArray(x) ? x.map(flat).join(", ")
      : Object.entries(x).map(([kk, vv]) =>
          (labels[kk] || kk) + ": " + flat(vv)).join("; "))
    : String(x);
  if (Array.isArray(v)) return v.length ? [v.map(flat).join(", ")] : [];
  if (typeof v === "object") return Object.entries(v).map(([kk, vv]) =>
    (labels[kk] || kk) + ": " + flat(vv));
  return [String(v)];
}

function renderDrawer(r, history) {
  const body = $("#drawerBody");
  body.replaceChildren();
  const dfix = effFix(r);
  // word line — letter-diffed like everywhere else
  body.append(el("div", { class: "d-word-line" },
    wordDiffNode(r.word || "—", dfix || "", "err", "w-err"),
    el("span", { class: "arr" }, "⇐"),
    dfix ? wordDiffNode(dfix, r.word || "", "fix", "w-fix") : el("bdi", { class: "w-fix" }, "—")));
  // the swap shown in place, then the two full readings for careful checking
  const sec = el("div", { class: "d-section" }, el("h4", null, "קטע מהטקסט — התיקון במקומו"));
  const dfocus = renderFocusLine(r);
  dfocus.dataset.flMax = "19"; // the drawer is narrow
  sec.append(dfocus);
  requestAnimationFrame(() => fitFocusLine(dfocus));
  sec.append(el("div", { class: "d-snippet", style: "margin-top:8px" }, renderSnippet(r.snippet, r.word, null, dfix)));
  if (dfix) sec.append(el("div", { class: "d-snippet", style: "margin-top:6px;border-color:var(--green)" }, renderSnippet(r.snippet, r.word, dfix)));
  body.append(sec);
  // status buttons
  const stSec = el("div", { class: "d-section" }, el("h4", null, "סטטוס"));
  const acts = el("div", { class: "d-actions" });
  for (const s of statuses()) {
    const cur = effStatus(r) === s.key;
    const b = el("button", { class: cur ? "btn primary" : "btn" }, s.icon + " " + s.hebrew);
    b.addEventListener("click", async () => {
      try {
        await setStatus([r.id], s.key);
        r.effective_status = s.key;
        drawerChanged(r, history);
      } catch (e) {}
    });
    acts.append(b);
  }
  stSec.append(acts);
  body.append(stSec);
  // custom correction
  const fixSec = el("div", { class: "d-section" }, el("h4", null, "תיקון ידני (גובר על ההצעה)"));
  const fixIn = el("input", { type: "text", value: r.custom_suggestion || "", placeholder: "הקלד תיקון משלך…" });
  const fixBtn = el("button", { class: "btn primary", style: "margin-top:6px" }, "✅ שמור תיקון ואשר");
  fixBtn.addEventListener("click", async () => {
    const v = fixIn.value.trim();
    if (!v) { toast("יש להקליד תיקון תחילה", "err"); return; }
    try {
      await setStatus([r.id], "approved", { custom_suggestion: v });
      r.custom_suggestion = v; r.effective_status = "approved";
      toast("התיקון נשמר והממצא אושר", "ok");
      drawerChanged(r, history);
    } catch (e) {}
  });
  fixSec.append(fixIn, fixBtn);
  body.append(fixSec);
  // note
  const noteSec = el("div", { class: "d-section" }, el("h4", null, "הערה"));
  const noteIn = el("textarea", { rows: "2", placeholder: "הערה חופשית…" });
  noteIn.value = r.note || "";
  const noteBtn = el("button", { class: "btn", style: "margin-top:6px" }, "💾 שמירת הערה");
  noteBtn.addEventListener("click", async () => {
    try {
      await setStatus([r.id], effStatus(r), { note: noteIn.value });
      r.note = noteIn.value;   // a later re-render must show what was just saved
      toast("ההערה נשמרה", "ok");
    } catch (e) {}
  });
  noteSec.append(noteIn, noteBtn);
  body.append(noteSec);
  // fields
  const fSec = el("div", { class: "d-section" }, el("h4", null, "כל הפרטים"));
  const dl = el("dl", { class: "d-fields" });
  const addField = (key, valNode) => {
    if (valNode == null || valNode === "") return;
    const info = colInfo(key);
    const dt = el("dt", { title: info.explanation || "" }, info.hebrew);
    dl.append(dt, el("dd", null, valNode));
  };
  addField("errtype", errtypeInfo(r.errtype).hebrew);
  addField("origin", originInfo(r.origin).hebrew || r.origin);
  if (r.source) addField("source", el("bdi", null, r.source));
  if (r.ref) addField("ref", el("bdi", null, r.ref));
  const pfu = parseFileUnit(r.unit);
  if (pfu) addField("unit", fileUnitNode(pfu));
  else addField("unit", r.unit != null ? String(r.unit) : "");
  addField("rank", fmtRank(r.rank));
  addField("score", fmtRank(r.score));
  addField("ctx_hits", r.ctx_hits != null ? String(r.ctx_hits) : "");
  addField("sugg_local", r.sugg_local != null ? String(r.sugg_local) : "");
  addField("book_repeat", r.book_repeat != null ? String(r.book_repeat) : "");
  addField("verified", r.verified ? "כן ✓" : "לא");
  // family-specific extra JSON
  let extra = r.extra;
  if (typeof extra === "string" && extra) { try { extra = JSON.parse(extra); } catch (e) { extra = null; } }
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      if (k === "alternatives") {
        // null: the evidence names no alternative to the detector's suggestion
        if (Array.isArray(v) && v.length)
          dl.append(el("dt", null, "הצעות חלופיות"), el("dd", null, altList(r.word, v)));
        continue;
      }
      const lines = extraLines(k, v);
      if (!lines.length) continue;
      const kl = ((S.meta && S.meta.extra_labels) || {})[k];
      dl.append(el("dt", null, kl || ("פרטים: " + k)),
        el("dd", null, lines.length === 1 ? el("bdi", null, lines[0])
          : lines.map((t) => el("div", null, el("bdi", null, t)))));
    }
  }
  fSec.append(dl);
  body.append(fSec);
  // history
  const hSec = el("div", { class: "d-section d-history" }, el("h4", null, "היסטוריית הממצא"));
  if (!history.length) hSec.append(el("div", { class: "h-item" }, "אין פעולות קודמות על ממצא זה"));
  for (const h of history) {
    const from = h.old_status ? statusInfo(h.old_status).hebrew : "—";
    const to = h.new_status ? statusInfo(h.new_status).hebrew : "—";
    hSec.append(el("div", { class: "h-item" },
      el("time", null, h.ts || ""), " · ", from + " ← " + to, h.note ? " · " + evLabel(h.note) : ""));
  }
  body.append(hSec);
}

function closeDrawer() {
  DRAWER_SEQ++;
  $("#drawer").classList.remove("visible");
  $("#drawerScrim").classList.remove("visible");
  closeLayer($("#drawer"));
}
