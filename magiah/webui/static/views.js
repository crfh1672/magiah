/* ============ מגיה — views.js: stats view, help view, file-based units ============
 * Classic script: shares the global scope with the other files (load order is
 * set in index.html; core.js comes first, main.js last and calls init()). */
"use strict";

/* ---------------------------------------------------------- stats view */
const KNOWN_STATUS_KEYS = ["pending", "approved", "fixed", "not_error", "unsure", "ignored"];

function normalizeMatrix(data) {
  /* Accepts: [{origin/errtype/book/name/label, statuses:{k:n}}] | [{...flat status keys...}]
     | [{label, status, count}] triplets | {label:{status:count}}. Returns [{label, counts}]. */
  const out = new Map();
  const get = label => {
    if (!out.has(label)) out.set(label, { label, counts: {} });
    return out.get(label);
  };
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item == null) continue;
      const label = item.hebrew || item.errtype || item.book || item.source || item.name || item.label || item.key || item.origin || "";
      const e = get(String(label));
      if (item.statuses && typeof item.statuses === "object") {
        Object.assign(e.counts, item.statuses);
      } else if (item.status != null && item.count != null) {
        e.counts[item.status] = (e.counts[item.status] || 0) + item.count;
      } else {
        for (const k of KNOWN_STATUS_KEYS) if (typeof item[k] === "number") e.counts[k] = item[k];
        if (typeof item.total === "number") e.total = item.total;
      }
      if (typeof item.total === "number") e.total = item.total;
    }
  } else if (data && typeof data === "object") {
    for (const [label, v] of Object.entries(data)) {
      const e = get(label);
      if (v && typeof v === "object") Object.assign(e.counts, v);
    }
  }
  return [...out.values()];
}

function matrixTable(entries, firstColTitle, labelFn) {
  const stList = statuses();
  const table = el("table", { class: "stats" });
  const hr = el("tr", null, el("th", null, firstColTitle));
  for (const s of stList) hr.append(el("th", { title: s.hebrew }, s.icon + " " + s.hebrew));
  hr.append(el("th", { class: "rowtotal" }, "סה״כ"));
  table.append(el("thead", null, hr));
  const tb = el("tbody");
  for (const e of entries) {
    const tr = el("tr", null, el("td", null, el("bdi", null, labelFn ? labelFn(e.label) : e.label)));
    let sum = 0;
    for (const s of stList) {
      const n = e.counts[s.key] || 0;
      sum += n;
      tr.append(el("td", { class: "num" + (n ? "" : " zero") }, n ? fmtNum(n) : "·"));
    }
    tr.append(el("td", { class: "num rowtotal" }, fmtNum(e.total != null ? e.total : sum)));
    tb.append(tr);
  }
  table.append(tb);
  return el("div", { class: "stats-table-wrap" }, table);
}

async function loadStats() {
  const body = $("#statsBody");
  body.replaceChildren(el("div", null, "טוען…"));
  let st;
  try {
    st = await api("/api/stats");
  } catch (e) {
    body.replaceChildren(el("div", null, "טעינת הסטטיסטיקה נכשלה: " + e.message));
    toast(e.message, "err");
    return;
  }
  body.replaceChildren();
  const origins = normalizeMatrix(st.origins || st.by_origin || st.origin_status || []);
  const errts = normalizeMatrix(st.errtypes || st.by_errtype || st.errtype_status || []);
  const books = normalizeMatrix(st.books || st.by_book || st.per_book || []);
  // decisions by who made them: an agent's approval is never shown as a human one
  const actors = normalizeMatrix(st.by_actor || {});
  const ACTOR_HE = { human: "אדם", agent: "סוכן", unknown: "לא ידוע (לפני תיעוד)" };
  if (origins.length) {
    body.append(el("h3", null, "לפי מאגר"));
    body.append(matrixTable(origins, colInfo("origin").hebrew, l => originInfo(l).hebrew || l));
  }
  if (errts.length) {
    body.append(el("h3", null, "לפי סוג שגיאה"));
    body.append(matrixTable(errts, colInfo("errtype").hebrew, l => errtypeInfo(l).hebrew || l));
  }
  if (books.length) {
    body.append(el("h3", null, "התקדמות לפי ספר"));
    const bars = el("div", { class: "bookbars" });
    for (const b of books) {
      const total = b.total != null ? b.total : Object.values(b.counts).reduce((a, n) => a + n, 0);
      const pending = b.counts.pending || 0;
      const done = Math.max(0, total - pending);
      const pct = total ? Math.round(done * 100 / total) : 0;
      bars.append(el("div", { class: "bookbar" },
        el("span", { class: "bb-name", title: b.label }, el("bdi", null, b.label)),
        el("div", { class: "pbar" }, el("div", { style: "width:" + pct + "%" })),
        el("span", { class: "bb-nums" }, fmtNum(done) + " / " + fmtNum(total) + " (" + pct + "%)")));
    }
    body.append(bars);
  }
  if (actors.length) {
    body.append(el("h3", null, "לפי מקבל ההחלטה"));
    body.append(matrixTable(actors, "הוחלט ע״י", l => ACTOR_HE[l] || l));
  }
  if (!origins.length && !errts.length && !books.length) {
    body.append(el("div", null, "אין נתוני סטטיסטיקה להצגה."));
  }
}

/* ---------------------------------------------------------- help view */
function renderHelp() {
  const body = $("#helpBody");
  body.replaceChildren();
  const m = S.meta || {};
  // workflow (hardcoded UI chrome)
  body.append(el("div", { class: "help-block" },
    el("h3", null, "🚀 סדר עבודה מומלץ"),
    el("ol", null,
      el("li", null, "התחילו עם המסנן «מאומתים בלבד» — אלו הממצאים בעלי הוודאות הגבוהה ביותר."),
      el("li", null, "מיינו לפי ציון (מהגבוה לנמוך) — ממצאים עם ציון גבוה הם כמעט תמיד שגיאות אמיתיות."),
      el("li", null, "עבדו במצב כרטיסים עם קיצורי המקלדת לסקירה מהירה, או בטבלה לפעולות מרוכזות."),
      el("li", null, "לאחר אישור השגיאות — עברו ל«מצב מתקן» כדי לתקן ספר־ספר, לפי סדר הופעה בספר."),
      el("li", null, "בסיום — ייצאו ל־Excel (למסירה) או ל־to_send (לצינור העבודה הישן)."))));
  // shortcuts
  const kbd = (k) => el("kbd", null, k);
  const shTable = el("table", null,
    el("tr", null, el("th", null, "מקש"), el("th", null, "פעולה"), el("th", null, "תצוגה")),
    el("tr", null, el("td", null, kbd("י")), el("td", null, "אושר — זו שגיאה"), el("td", null, "כרטיסים")),
    el("tr", null, el("td", null, kbd("נ")), el("td", null, "לא שגיאה (מופע זה בלבד)"), el("td", null, "כרטיסים")),
    el("tr", null, el("td", null, kbd("ד")), el("td", null, "לא שגיאה — בכל מקום שבו מופיעה המילה"), el("td", null, "כרטיסים")),
    el("tr", null, el("td", null, kbd("ת")), el("td", null, "הקלדת תיקון ידני (Enter לשמירה)"), el("td", null, "כרטיסים")),
    el("tr", null, el("td", null, kbd("ע")), el("td", null, "התעלם"), el("td", null, "כרטיסים")),
    el("tr", null, el("td", null, kbd("ב")), el("td", null, "דרוש בירור"), el("td", null, "כרטיסים")),
    el("tr", null, el("td", null, kbd("ק")), el("td", null, "תוקן בספר"), el("td", null, "כרטיסים / מצב מתקן")),
    el("tr", null, el("td", null, kbd("רווח")), el("td", null, "דילוג לממצא הבא (ללא החלטה)"), el("td", null, "כרטיסים")),
    el("tr", null, el("td", null, kbd("Enter")), el("td", null, "סימון «תוקן» ומעבר לבא"), el("td", null, "מצב מתקן")),
    el("tr", null, el("td", null, kbd("↑")), el("td", null, "מעבר בין הממצאים ברשימה"), el("td", null, "מצב מתקן")),
    el("tr", null, el("td", null, kbd("1")), el("td", null, "סטטוסים 1‑6: אושר / לא שגיאה / בירור / התעלם / תוקן / טרם נבדק"), el("td", null, "מצב מתקן")),
    el("tr", null, el("td", null, kbd("ס")), el("td", null, "החלפת מצב הכתיבה של התיקון הנוכחי (החלפה ⇄ סוגריים)"), el("td", null, "מצב מתקן")),
    el("tr", null, el("td", null, kbd("פ")), el("td", null, "סימון / ביטול סימון התיקון להחלה"), el("td", null, "מצב מתקן")),
    el("tr", null, el("td", null, kbd("Home / End")), el("td", null, "מעבר לממצא הראשון / האחרון ברשימה"), el("td", null, "מצב מתקן")),
    el("tr", null, el("td", null, kbd("Ctrl+S")), el("td", null, "החלת התיקונים המסומנים על הקובץ"), el("td", null, "מצב מתקן")),
    el("tr", null, el("td", null, kbd("Ctrl+Z")), el("td", null, "ביטול הפעולה האחרונה"), el("td", null, "בכל מקום")),
    el("tr", null, el("td", null, kbd("Esc")), el("td", null, "סגירת חלונית / תפריט"), el("td", null, "בכל מקום")));
  body.append(el("div", { class: "help-block" }, el("h3", null, "⌨ קיצורי מקלדת"), shTable));
  // fixer mode — the file-writing screen needs its own explanation, above all
  // because there are two different "undo"s and they do different things
  body.append(el("div", { class: "help-block" },
    el("h3", null, "🛠 מצב מתקן — תיקון בתוך הקובץ"),
    el("p", null, "בוחרים ספר, והכלי פותח את קובץ הטקסט עצמו ומסמן בו את " +
      "המקומות לתיקון. אין צורך לפתוח את הספר בעורך חיצוני."),
    el("ul", null,
      el("li", null, el("b", null, "רשימת הספרים: "),
        "מזוהים לפי הקובץ, לא לפי השם. לכן שני ספרים בשם «פרק א» בתיקיות " +
        "שונות מופיעים בנפרד, ולצד כל אחד מוצגת התיקייה שלו."),
      el("li", null, el("b", null, "הסימון בטקסט: "),
        "כל מילה מסומנת מראה גם ", el("b", null, "מה ירד"),
        " (המילה המקורית, מחוקה בקו) וגם ", el("b", null, "מה יהיה"),
        " (התיקון, בקו תחתון ירוק) — כך רואים בדיוק מה ייכתב, בלי לרחף עם " +
        "העכבר. לצד כל סימון מופיע גם סמל הסטטוס שלו."),
      el("li", null, el("b", null, "הצגה לפי סוג: "),
        "התיבה שבסרגל מציגה רק ממצאים מסטטוס או מסוג מסוים (למשל רק «טרם " +
        "נבדק», או רק אלה שדורשים אישור ידני). ",
        el("b", null, "הסדר תמיד נשאר לפי מספר השורה בספר"),
        " — הסינון מצמצם את הרשימה ולא מערבב אותה, כדי לא לאבד את המקום."),
      el("li", null, el("b", null, "אופן הכתיבה: "),
        "«החלפה» — המילה השגויה מוחלפת בתיקון. «סוגריים» — נכתב " +
        "«(תיקון) [שגיאה]», כלומר התיקון בסוגריים עגולים ואחריו המילה " +
        "המקורית במרובעים. אפשר לקבוע ברירת מחדל לספר (בסרגל העליון) " +
        "ולדרוס אותה לכל תיקון בנפרד (הכפתורים בשורת התיקון)."),
      el("li", null, el("b", null, "כל פעולות הסקירה זמינות כאן: "),
        "אפשר גם לאשר, לדחות, להקליד תיקון ידני או לסמן «דרוש בירור» — " +
        "כך אפשר לטפל גם בממצאים שטרם נבדקו בלי לצאת מהמסך."),
      el("li", null, el("b", null, "מה נכנס לתיקון: "),
        el("b", null, "ממצא שטרם הוחלט לגביו לעולם אינו נכנס אוטומטית"),
        " — רק ממצאים ב«אושר» מסומנים מראש. בסרגל הבחירה אפשר לבחור במכה " +
        "אחת «רק מאושרים», «מאושרים ומאומתים», או «הנראים כעת»."),
      el("li", null, el("b", null, "גיבוי אוטומטי: "),
        "לפני כל כתיבה נשמר עותק מלא של הקובץ. שום דבר בקובץ אינו משתנה " +
        "מלבד המילים שתוקנו."),
      el("li", null, el("b", null, "אם הספר השתנה מאז הסריקה: "),
        "אין צורך בסריקה חדשה — הקובץ נקרא מהדיסק בכל פתיחה. אם שורות זזו, " +
        "הכלי מאתר את המילה במקומה החדש, אך ורק כשהוא מזהה בוודאות שזה " +
        "אותו קטע ממש — בספרות הזו נוסחאות חוזרות בפסוקים מקבילים, ודמיון " +
        "לבדו אינו מספיק. מילה שכבר תוקנה ידנית תסומן באדום ולא תיגע."),
      el("li", null, el("b", null, "ממצאים שלא יוחלו אוטומטית: "),
        "אם הכלי אינו יכול לקבוע בוודאות היכן המילה נמצאת (למשל כשהיא " +
        "מופיעה כמה פעמים באותה שורה, או שהקובץ השתנה מאז הסריקה) — הוא " +
        "לא ינחש. הממצא יסומן באדום, ואפשר ללחוץ על המילה הנכונה בטקסט " +
        "כדי לסמן אותה ידנית.")),
    el("p", null, el("b", null, "שימו לב — שני סוגי ביטול: ")),
    el("ul", null,
      el("li", null, el("b", null, "Ctrl+Z / «ביטול» "),
        "מבטל את ההחלטה (הסטטוס) בלבד — ", el("b", null, "הקובץ עצמו לא משתנה"), "."),
      el("li", null, el("b", null, "«↩ שחזור מגיבוי» "),
        "מחזיר את הקובץ עצמו למצבו לפני התיקון, ומחזיר את הממצאים " +
        "לסטטוס «אושר»."))));
  // statuses (labels from API; usage guidance is chrome)
  const stGuide = {
    pending: "מצב ההתחלה של כל ממצא — טרם התקבלה החלטה.",
    approved: "אישרתם שזו שגיאת דפוס אמיתית. ייכלל בייצוא התיקונים.",
    fixed: "השגיאה כבר תוקנה בפועל בספר עצמו. נכלל בייצוא ומסומן בעמודה נפרדת.",
    not_error: "המילה תקינה — אינה שגיאה. משמש גם ללימוד הסורק (רשימה לבנה).",
    unsure: "דרושה בדיקה נוספת — למשל התייעצות או השוואה למקור.",
    ignored: "לא רלוונטי לטיפול — לא שגיאה ולא נדרש בירור.",
  };
  const stTable = el("table", null, el("tr", null, el("th", null, "סטטוס"), el("th", null, "מתי להשתמש")));
  for (const s of statuses()) {
    stTable.append(el("tr", null, el("td", null, s.icon + " " + s.hebrew), el("td", null, stGuide[s.key] || "")));
  }
  body.append(el("div", { class: "help-block" }, el("h3", null, "🏷 הסטטוסים"), stTable));
  // error types from meta
  const etTable = el("table", null, el("tr", null, el("th", null, "סוג שגיאה"), el("th", null, "הסבר")));
  for (const e of (m.errtypes || [])) {
    etTable.append(el("tr", null, el("td", null, e.hebrew || e.key), el("td", null, e.explanation || "")));
  }
  body.append(el("div", { class: "help-block" }, el("h3", null, "🔤 סוגי השגיאות"), etTable));
  // columns from meta
  const colTable = el("table", null, el("tr", null, el("th", null, "עמודה"), el("th", null, "הסבר")));
  for (const c of (m.columns || [])) {
    colTable.append(el("tr", null, el("td", null, c.hebrew || c.key), el("td", null, c.explanation || "")));
  }
  body.append(el("div", { class: "help-block" }, el("h3", null, "📊 העמודות"), colTable));
  // exports (hardcoded chrome)
  body.append(el("div", { class: "help-block" },
    el("h3", null, "⬇ מה מייצא כל כפתור?"),
    el("ul", null,
      el("li", null, el("b", null, "Excel — למאגר הנוכחי / כל המאגרים: "),
        "חוברת Excel אחת לכל מאגר (שגיאות_<שם המאגר>.xlsx) עם גיליון סיכום, גיליון «כל השגיאות — לפי ספר», וגיליון נפרד לכל סוג שגיאה. כל הגיליונות מימין לשמאל עם כותרות בעברית."),
      el("li", null, el("b", null, "ייצוא תיקונים ל־to_send: "),
        "קבצי CSV בפורמט הישן (approved_fixes_all.csv + קובץ לכל מאגר) הכוללים את כל הממצאים שאושרו או תוקנו — תיקון ידני גובר על ההצעה. בנוסף rejected_words.txt עם המילים שסומנו «לא שגיאה»."))));
  // scan lifecycle (chrome)
  body.append(el("div", { class: "help-block" },
    el("h3", null, "⚙ ניהול סריקה"),
    el("ul", null,
      el("li", null, el("b", null, "רענן מסריקה חדשה: "), "לאחר הרצה מחודשת של הסורק — טוען את הממצאים העדכניים. החלטות על ממצאים שעדיין קיימים נשמרות."),
      el("li", null, el("b", null, "ייבוא החלטות ישנות: "), "ייבוא ההחלטות מהכלי הישן (decisions.db) — פעולה מפורשת בלבד, לא אוטומטית."),
      el("li", null, el("b", null, "אפס החלטות: "), "ניקוי כל הסטטוסים בממשק זה; גיבוי נשמר אוטומטית וניתן לשחזור."),
      el("li", null, el("b", null, "אפס הכל: "), "בנוסף מוחק את decisions.db כדי שסריקות הבאות לא יושפעו מהחלטות ניסיוניות."))));
}

/* ------------------------------------------------ file-based units (§9c) */
/* Two prefixes carry a path + line number:
     file:<repo-relpath>:<lineno>   — a book inside the library repo
     local:<absolute-path>:<lineno> — a .txt scanned from anywhere on disk
   The absolute form already IS the full path, so it must not be joined onto
   the repo root. Both split from the RIGHT: a Windows path contains ':'. */
function parseFileUnit(unit) {
  if (typeof unit !== "string") return null;
  let abs = false, body;
  if (unit.indexOf("file:") === 0) body = unit.slice(5);
  else if (unit.indexOf("local:") === 0) { body = unit.slice(6); abs = true; }
  else return null;
  const i = body.lastIndexOf(":");
  if (i < 1) return null;
  const ln = body.slice(i + 1);
  if (!/^\d+$/.test(ln)) return null;
  return { rel: body.slice(0, i), lineno: parseInt(ln, 10), abs: abs };
}

/* Windows paths (a drive letter or a backslash) keep backslashes; anything
   else, such as an absolute POSIX path, keeps its slashes as they are */
const isWinPath = p => /^[A-Za-z]:|\\/.test(p || "");
function fileUnitFullPath(rel, abs) {
  if (abs) return isWinPath(rel) ? rel.replace(/\//g, "\\") : rel;   // already absolute
  const root = SCAN.cfg && SCAN.cfg.corpus && SCAN.cfg.corpus.library_dir;
  if (!root) return isWinPath(rel) ? rel.replace(/\//g, "\\") : rel;
  const sep = isWinPath(root) ? "\\" : "/";
  return root.replace(/[\\\/]+$/, "") + sep + rel.replace(/[\\\/]/g, sep);
}

async function copyFilePath(rel, abs) {
  if (!abs && !SCAN.cfg) { try { await loadScanConfig(); } catch (e) {} }
  copyText(fileUnitFullPath(rel, abs));
}

/* path + 1-based line number + copy button, for findings scanned from files */
function fileUnitNode(pf) {
  const btn = el("button", { class: "copy-path", title: "העתקת נתיב הקובץ המלא" }, "📋 נתיב");
  btn.addEventListener("click", ev => { ev.stopPropagation(); copyFilePath(pf.rel, pf.abs); });
  return el("span", { class: "file-unit" },
    el("bdi", { class: "file-path", title: pf.rel }, pf.rel),
    el("span", { class: "file-line" }, " · שורה " + fmtNum(pf.lineno + 1)),
    btn);
}
