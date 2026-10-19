/* ============ מגיה — cards.js: card view ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ---------------------------------------------------------- card view */
/* The queue logic lives in cardqueue.js (keyset paging, skip pile, in-flight
 * guard, server-side completion); this is only its wiring to the API. */
function cardQueue() {
  if (!S.cq) {
    S.cq = new CardQueue({
      fetchPage: (cursor, recheck) => {
        const p = filterParams({ page: 1, page_size: 50, statuses: recheck ? remainingStatuses() : S.filters.statuses });
        p.set("cursor", cursor || "");
        if (S.filters.sort === "random") p.set("seed", String(S.cardSeed));
        return api("/api/findings?" + p);
      },
      countRemaining: async () =>
        totalOf(await api("/api/findings?" + filterParams({ statuses: remainingStatuses(), page: 1, page_size: 1 }))),
      // the cards a rule may just have decided, as they stand now
      // in batches: one request is capped at 500 rows, and a word with more
      // cached findings would come back truncated — settle() reads a missing
      // id as "left the filter" and would drop cards that are still open
      fetchRows: async (ids, recheck) => {
        const BATCH = 200;
        const batches = [];
        for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
        // a few at a time: a large word group means many batches
        const pages = [];
        for (let i = 0; i < batches.length; i += 4) {
          const group = await Promise.all(batches.slice(i, i + 4).map(chunk => {
            const p = filterParams({ page: 1, page_size: BATCH, statuses: recheck ? remainingStatuses() : S.filters.statuses });
            p.set("ids", chunk.join(","));
            return api("/api/findings?" + p);
          }));
          pages.push(...group);
        }
        return { rows: pages.flatMap(pg => (pg && pg.rows) || []) };
      },
      save: (row, status, opts) => setStatus([row.id], status, Object.assign({ expect_status: effStatus(row) }, opts)),
    });
  }
  return S.cq;
}
/* What still counts as open work in the card view: the statuses being
 * reviewed, or the undecided ones when the filter does not narrow by status. */
function remainingStatuses() {
  return S.filters.statuses.length ? S.filters.statuses : ["pending"];
}

async function ensureCardQueue() {
  const q = cardQueue();
  try {
    await q.fill();
  } catch (e) {
    toast("טעינת הכרטיסים נכשלה: " + e.message, "err");
  }
  if (S.view === "cards") renderCard();
}

function resetCardQueue() {
  cardQueue().reset();
  S.cardSeed = Math.floor(Math.random() * 2147483647);
  S.cardStale = false;
  S.cardFixOpen = false;
  renderCard();
  ensureCardQueue();
}

function currentCard() { return S.cq ? S.cq.head() : null; }

/* the line over the card: where the queue stands, and the keyboard help */
function renderCardMeta() {
  const q = cardQueue();
  const total = S.progTotal || 0, done = S.progDone || 0;
  const pct = total ? Math.round(done * 100 / total) : 0;
  const r = currentCard();
  $("#cardMeta").replaceChildren(...[
    el("span", null, "בתור: " + fmtNum(q.queue.length) + (q.exhausted ? "" : "+") + (r && r.source ? " · " : ""),
      r && r.source ? el("bdi", null, r.source) : null),
    total ? el("div", { class: "pbar cm-bar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100",
      "aria-label": "התקדמות בסינון הנוכחי" }, el("div", { style: "width:" + pct + "%" })) : null,
    q.skipped.length ? el("span", { title: "יוצגו שוב בסוף התור" }, "נדחו לאחר כך: " + fmtNum(q.skipped.length)) : null,
    shortcutsMenu()].filter(Boolean));
}

/* a sentence with the word marked, or replaced by its fix */
function cardSentence(r, kind, fix) {
  const s = r.snippet == null ? "" : String(r.snippet), w = r.word || "";
  const i = s && w ? locateWord(s, w) : -1;
  const bdi = el("bdi");
  const mark = kind === "bad" ? el("span", { class: "bad" }, w) : el("span", { class: "good" }, fix || w);
  if (i < 0) { bdi.append(s || "", s ? " " : "", mark); }
  else bdi.append(s.slice(0, i), mark, s.slice(i + w.length));
  return el("div", { class: "cl " + (kind === "bad" ? "b" : "g") }, bdi);
}

function renderCard() {
  const box = $("#cardBox");
  const r = currentCard();
  const q = cardQueue();
  renderCardMeta();
  box.replaceChildren();
  if (!r) {
    // nothing matches the filters at all: say so and offer the way back
    if (facetsTotal() === 0) { box.append(emptyFilterState()); return; }
    // "done" only on the server's word — never because the local list ran out
    const st = q.state();
    const msg = st === "done" ? "אין עוד ממצאים בסינון הנוכחי — כל הכבוד!"
      : st === "remaining" ? "עברת על כל הכרטיסים, אך בסינון הנוכחי נותרו עוד " + fmtNum(q.remaining)
        + " ממצאים פתוחים (ייתכן שעודכנו בחלון אחר). רענון הסינון יציג אותם."
      : "טוען ממצאים…";
    box.append(el("div", { class: "card-done" },
      el("div", { class: "big " + (st === "done" ? "ok" : st === "remaining" ? "warn" : "") },
        icon(st === "done" ? "check-circle" : st === "remaining" ? "alert" : "clock", "ic-lg")), msg));
    return;
  }
  const info = errtypeInfo(r.errtype);
  const fix = effFix(r);

  // what kind of error, where it is
  box.append(el("div", { class: "cd-chips" },
    el("span", { class: "ch", title: info.explanation || "" }, info.hebrew),
    r.verified ? el("span", { class: "ch on" }, "מאומת") : null,
    el("span", { class: "cd-where" }, el("bdi", null, [r.source, r.ref].filter(Boolean).join(" · ")))));

  // the sentence as it is, and as it would be
  box.append(cardSentence(r, "bad", fix), cardSentence(r, "good", fix || r.word));
  const cp = el("button", { class: "pair-copy", title: "העתקת התיקון", "aria-label": "העתקת התיקון" }, icon("copy"));
  cp.addEventListener("click", () => copyText(fix || r.word || ""));
  box.lastChild.append(cp);

  // the numbers the verdict rests on
  const tile = (label, v) => el("div", { class: "mt" }, el("span", null, label), el("b", null, v));
  box.append(el("div", { class: "mg" },
    tile("ציון", fmtRank(r.rank)),
    tile("אימות הקשר", r.ctx_hits != null ? fmtNum(r.ctx_hits) : "—"),
    tile("חזרות בספר", r.book_repeat != null ? fmtNum(r.book_repeat) : "—")));

  /* Decisions — same eight actions and same keys as always, but ranked by how
   * often they are actually used. In triage ~90% of cards end in one of the
   * first two, so those get large, colour-coded primary buttons; the rest stay
   * one click away on a quieter secondary row. Nothing is hidden. */
  const mkBtn = (label, kbd, fn, cls, ico) => {
    const b = el("button", { class: cls || null },
      ico ? icon(ico) : null,
      el("span", { class: "lbl" }, label), kbd ? el("kbd", null, kbd) : null);
    b.addEventListener("click", fn);
    return b;
  };
  box.append(el("div", { class: "card-actions primary-row" },
    mkBtn("אשר תיקון", "י", () => cardAct("approved"), "act-approve", "check-circle"),
    mkBtn("לא שגיאה", "נ", () => cardAct("not_error"), "act-reject", "x-circle"),
    mkBtn("דרוש בירור", "ב", () => cardAct("unsure"), "act-unsure", "help")));
  // the rest, quieter: the same actions and shortcuts as ever
  const item = (label, kbd, fn, ico) => {
    const b = el("button", { type: "button" }, icon(ico), el("span", null, label), kbd ? el("kbd", null, kbd) : null);
    b.addEventListener("click", fn);
    return b;
  };
  box.append(el("div", { class: "card-actions second-row" },
    mkBtn("הקלדת תיקון", "ת", () => toggleCardFix(true), "sm"),
    mkBtn("בכל מקום", "ד", () => cardAct("not_error", { scope: "word" }), "sm"),
    mkBtn("התעלם", "ע", () => cardAct("ignored"), "sm"),
    mkBtn("דלג", "רווח", () => cardSkip(), "sm"),
    el("details", { class: "menu-wrap card-more" },
      el("summary", { class: "btn sm" }, "עוד", icon("more")),
      el("div", { class: "menu" },
        el("div", { class: "menu-title" }, "לא שגיאה…"),
        // narrower than "everywhere": the word may still be wrong elsewhere
        item("תקין בספר זה", "", () => cardAct("not_error", { scope: "book" }), "x-circle"),
        item("ההצעה שגויה", "", () => cardAct("not_error", { scope: "replacement" }), "x-circle"),
        el("div", { class: "sep" }),
        item("תוקן בספר", "ק", () => cardAct("fixed"), "wrench")))));
  const fixRow = el("div", { id: "cardFixRow", class: S.cardFixOpen ? "visible" : "" },
    el("input", { id: "cardFixInput", type: "text", placeholder: "הקלד את התיקון הנכון ולחץ Enter…", dir: "rtl" }),
    el("button", { class: "btn primary" }, "שמור ואשר"));
  fixRow.querySelector("button").addEventListener("click", submitCardFix);
  fixRow.querySelector("input").addEventListener("keydown", ev => {
    if (ev.key === "Enter") { ev.preventDefault(); submitCardFix(); }
    if (ev.key === "Escape") { ev.preventDefault(); toggleCardFix(false); }
    ev.stopPropagation();
  });
  box.append(fixRow);
  if (S.cardFixOpen) setTimeout(() => { const i = $("#cardFixInput"); if (i) { i.value = effFix(r); i.focus(); i.select(); } }, 0);
}

/* Keyboard shortcuts, kept one click away instead of a sentence on every card. */
const CARD_SHORTCUTS = [
  ["י", "אושר — זו שגיאה"], ["נ", "לא שגיאה (מופע זה)"], ["ד", "לא שגיאה בכל מקום"],
  ["ת", "תיקון ידני"], ["ע", "התעלם"], ["ב", "דרוש בירור"], ["ק", "תוקן בספר"],
  ["רווח", "דלג"], ["Ctrl+Z", "ביטול הפעולה האחרונה"],
];
function shortcutsMenu() {
  return el("details", { class: "menu-wrap" },
    el("summary", { class: "btn sm" }, icon("help"), "קיצורי מקלדת"),
    el("div", { class: "menu sc-menu" },
      CARD_SHORTCUTS.map(([k, label]) => el("div", { class: "sc-row" }, el("kbd", null, k), el("span", null, label)))));
}

function toggleCardFix(open) {
  S.cardFixOpen = open;
  const row = $("#cardFixRow");
  if (row) row.classList.toggle("visible", open);
  if (open) { const i = $("#cardFixInput"); if (i) { i.focus(); i.select(); } }
}
async function submitCardFix() {
  const r = currentCard();
  const i = $("#cardFixInput");
  if (!r || !i) return;
  const v = i.value.trim();
  if (!v) { toast("יש להקליד תיקון תחילה", "err"); return; }
  S.cardFixOpen = false;
  await cardAct("approved", { custom_suggestion: v });
}
async function cardAct(status, opts) {
  const q = cardQueue();
  const r = q.head();
  if (!r) return;
  try {
    const res = await q.act(status, opts || {});
    if (res && res.ignored) return;        // a decision on this card is already in flight
    S.cardFixOpen = false;
    renderCard();
    ensureCardQueue();
  } catch (e) {
    // stays on card; setStatus already showed the toast. On 409 the server
    // says what the finding is now, so the card shows the real state.
    const cur = e && e.status === 409 && e.data && e.data.current;
    if (cur && cur[String(r.id)]) { r.effective_status = cur[String(r.id)]; renderCard(); }
  }
}
/* Skip for later: the card moves to a separate pile that returns after the
 * rest of the queue; it is not a decision and not counted as done. */
function cardSkip() {
  if (!cardQueue().skip()) return;
  S.cardFixOpen = false;
  renderCard();
  ensureCardQueue();
}
