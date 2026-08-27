/*!
 * どくしょ ちょきんばこ — アプリ本体
 *
 * もとは index.html の中に <script> で じか書きしていたものを、
 * CSP（Content-Security-Policy）で 'unsafe-inline' を使わずに済むよう
 * 外部ファイルへ切り出した。中身のロジックは変えていない。
 */
(function () {
'use strict';

/* ============================================================
   0. 定数
   ============================================================ */
var APP_ID      = 'reading-books';   // 学習ログの appId（仕様書 §3.1）
var APP_VERSION = '2.6.0';

/* このアプリ専用の保存キー。
   `study.records.v1`（共通の学習ログ）は【ここに含めない】。
   仕様書 §1.2 により、アプリのリセット処理で消してはならない。 */
var KEYS = {
  logs:  'reading_record_main_v1_logs',
  goals: 'reading_record_main_v1_goals',
  meta:  'reading_record_main_v1_meta'
};

/* 月ごとの スタンプの えがら（ページ先頭の <symbol id="i-m…"> を さす） */
var MONTH_STAMPS = {
  1:'i-m1',  2:'i-m2',  3:'i-m3',  4:'i-m4',  5:'i-m5',  6:'i-m6',
  7:'i-m7',  8:'i-m8',  9:'i-m9', 10:'i-m10',11:'i-m11',12:'i-m12'
};

/** アイコン1個ぶんの HTML。name は ページ先頭の <symbol> の id */
function ic(name, cls) {
  return '<svg class="' + (cls || 'ic') + '" aria-hidden="true" focusable="false">' +
         '<use href="#' + name + '"></use></svg>';
}

var $  = function (sel, root) { return (root || document).querySelector(sel); };
var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toInt(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtNum(n) { return Number(n || 0).toLocaleString('ja-JP'); }
var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
   1. 保存（このアプリのデータ）
   ============================================================ */
function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    var v = JSON.parse(raw);
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) {
    console.warn('[store] read failed', key, e);
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[store] write failed', key, e);
    toast('ほぞんできませんでした。きかいの あきが たりないかも');
    return false;
  }
}

/** 日付表示（記録は timestamp を正とし、表示だけをここで作る） */
function fmtDate(d) { return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }

/** 古い形式の date 文字列（"2026/7/28"）を Date に戻す */
function parseLegacyDate(s) {
  if (!s) return null;
  var m = String(s).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  var d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/** 読み込んだ記録を正規化する（古いデータもここで救う） */
function normalizeLog(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  var title = String(raw.title == null ? '' : raw.title).trim();
  if (!title) return null;

  var ts = Number(raw.timestamp);
  if (!isFinite(ts) || ts <= 0) {
    var legacy = parseLegacyDate(raw.date);
    ts = legacy ? legacy.getTime() : Date.now();
  }
  var d = new Date(ts);
  var isbn = String(raw.isbn == null ? '' : raw.isbn).replace(/[^0-9X]/gi, '');

  return {
    id:     String(raw.id == null || raw.id === '' ? (ts + '-' + index) : raw.id),
    title:  title.slice(0, 120),
    author: (String(raw.author == null ? '' : raw.author).trim() || 'ふめい').slice(0, 80),
    pages:  clamp(toInt(raw.pages), 0, 20000),
    price:  clamp(toInt(raw.price), 0, 1000000),
    rating: clamp(toInt(raw.rating), 0, 5),
    memo:   String(raw.memo == null ? '' : raw.memo).slice(0, 200),
    isbn:   /^\d{13}$/.test(isbn) ? isbn : '',
    timestamp: ts,
    date:   fmtDate(d)
  };
}

var logs  = [];
var goals = {};
var meta  = {};

function loadAll() {
  var rawLogs = readJSON(KEYS.logs, []);
  if (!Array.isArray(rawLogs)) rawLogs = [];
  logs = [];
  for (var i = 0; i < rawLogs.length; i++) {
    var n = normalizeLog(rawLogs[i], i);
    if (n) logs.push(n);
  }
  sortLogs();

  var g = readJSON(KEYS.goals, {});
  goals = (g && typeof g === 'object' && !Array.isArray(g)) ? g : {};

  var m = readJSON(KEYS.meta, {});
  meta = (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  if (!meta.celebrated || typeof meta.celebrated !== 'object') meta.celebrated = {};
  if (typeof meta.sound !== 'boolean') meta.sound = true;
}
function sortLogs() { logs.sort(function (a, b) { return b.timestamp - a.timestamp; }); }
function saveLogs()  { sortLogs(); return writeJSON(KEYS.logs, logs); }
function saveGoals() { return writeJSON(KEYS.goals, goals); }
function saveMeta()  { return writeJSON(KEYS.meta, meta); }

function monthKey(y, m) { return y + '-' + m; }
function goalOf(y, m) { return clamp(toInt(goals[monthKey(y, m)]) || 10, 1, 99); }
function logsIn(y, m) {
  return logs.filter(function (l) {
    var d = new Date(l.timestamp);
    return d.getFullYear() === y && (m == null || d.getMonth() + 1 === m);
  });
}
function sumOf(list, field) {
  return list.reduce(function (s, b) { return s + (b[field] || 0); }, 0);
}

/* ============================================================
   2. あそびの演出（音・紙ふぶき・トースト）
   ============================================================ */
var audioCtx = null;
function tone(freq, at, dur, type) {
  var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = type || 'sawtooth';
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.07, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(at); osc.stop(at + dur);
}
function ensureAudio() {
  if (!meta.sound) return false;
  try {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return true;
  } catch (e) { return false; }
}
function playFanfare() {
  if (!ensureAudio()) return;
  try {
    var t = audioCtx.currentTime;
    tone(392.00, t, 0.15); tone(523.25, t + 0.15, 0.15);
    tone(659.25, t + 0.30, 0.15); tone(783.99, t + 0.45, 0.15);
    tone(1046.50, t + 0.60, 0.6); tone(523.25, t + 0.60, 0.6);
  } catch (e) {}
}
function playBeep() {
  if (!ensureAudio()) return;
  try { tone(1320, audioCtx.currentTime, 0.12, 'square'); } catch (e) {}
}

var toastTimer = 0;
function toast(msg) {
  var el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
}

/** 紙ふぶき（外部ライブラリなし） */
function confetti() {
  if (reduceMotion) return;
  var cv = $('#fx'), ctx = cv.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = cv.width = Math.floor(innerWidth * dpr);
  var H = cv.height = Math.floor(innerHeight * dpr);
  cv.style.display = 'block';
  // アイコンと おなじ 色みの 紙ふぶき（きん・あい・あおみどり・みどり）
  var colors = ['#D9AE58', '#E9C36C', '#1F4C72', '#2E7D8C', '#4A7C59', '#F3F0E9', '#FFFFFF'];
  var parts = [], i;
  for (i = 0; i < 130; i++) {
    parts.push({
      x: W * (0.2 + Math.random() * 0.6),
      y: H * (0.45 + Math.random() * 0.1),
      vx: (Math.random() - 0.5) * 15 * dpr,
      vy: (-9 - Math.random() * 12) * dpr,
      s: (5 + Math.random() * 7) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      c: colors[(Math.random() * colors.length) | 0]
    });
  }
  var start = performance.now();
  function frame(now) {
    var t = now - start;
    ctx.clearRect(0, 0, W, H);
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      p.vy += 0.42 * dpr; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.992;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - t / 2600);
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; }
  }
  requestAnimationFrame(frame);
}

function celebrate(icon, text, sub) {
  var el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = '<div class="box">' + ic(icon, 'ic big') + '<b>' + esc(text) + '</b>' +
    (sub ? '<p class="muted tiny mt-2">' + esc(sub) + '</p>' : '') + '</div>';
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 2400);
}

/* ============================================================
   3. ダイアログ（window.confirm を使わない）
   ============================================================ */
var dialogResolve = null;
function dialogOpen() { return !!$('#dialog-root').firstChild; }
function closeDialog(value) {
  var root = $('#dialog-root');
  root.innerHTML = '';
  if (dialogResolve) { var r = dialogResolve; dialogResolve = null; r(value); }
}
/** opts: {icon,title,body,buttons:[{label,value,cls}]} → Promise<value> */
function showDialog(opts) {
  closeDialog(null);
  return new Promise(function (resolve) {
    dialogResolve = resolve;
    var root = $('#dialog-root');
    var btns = (opts.buttons || [{ label: 'OK', value: true, cls: 'btn-primary' }]).map(function (b, i) {
      return '<button class="btn ' + (b.cls || '') + '" data-dlg="' + i + '">' + esc(b.label) + '</button>';
    }).join('');
    root.innerHTML =
      '<div class="dialog-back" data-dlg-back="1">' +
        '<div class="dialog' + (opts.danger ? ' danger' : '') + '" role="dialog" aria-modal="true">' +
          (opts.icon ? ic(opts.icon, 'ic dlg-icon') : '') +
          '<h3>' + esc(opts.title || '') + '</h3>' +
          (opts.body ? '<p>' + String(opts.body) + '</p>' : '') +
          '<div class="dlg-btns">' + btns + '</div>' +
        '</div>' +
      '</div>';
    var list = opts.buttons || [{ value: true }];
    $$('[data-dlg]', root).forEach(function (b) {
      b.addEventListener('click', function () { closeDialog(list[+b.getAttribute('data-dlg')].value); });
    });
    var back = $('[data-dlg-back]', root);
    back.addEventListener('click', function (e) { if (e.target === back) closeDialog(null); });

    /* Tab キーで うしろの画面へ フォーカスが 逃げないように、
       ダイアログの中だけを ぐるぐる まわす。
       （閉じるのは Esc。§11 の keydown ハンドラが うけもつ） */
    back.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var items = $$('.btn', root);
      if (!items.length) return;
      var firstItem = items[0], lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) { e.preventDefault(); lastItem.focus(); }
      else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); firstItem.focus(); }
    });

    var first = $('.btn', root); if (first) first.focus();
  });
}
function confirmDialog(title, body, okLabel, danger) {
  return showDialog({
    icon: danger ? 'i-alert' : 'i-help',
    title: title, body: body, danger: !!danger,
    buttons: [
      { label: 'やめる', value: false, cls: '' },
      { label: okLabel || 'いいよ', value: true, cls: danger ? 'btn-danger' : 'btn-primary' }
    ]
  });
}

/* ============================================================
   4. 学習ログ study.v1
   ------------------------------------------------------------
   保存側 : StudyLog.saveStudyRecord（studyLog.js／全アプリ共通・不変）
   組立側 : このセクション
   読出側 : §5（読み出し専用。書き込み・削除は行わない）
   ============================================================ */

/** 操作していた時間の計測（仕様書 §2.8 の参照実装） */
var ActiveTime = (function () {
  var total = 0, mark = Date.now(), idle = false;
  var tick = function () {
    if (!idle && !document.hidden) total += Date.now() - mark;
    mark = Date.now();
  };
  var wake = function () { tick(); idle = false; };
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);
  ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function (ev) {
    document.addEventListener(ev, wake, { passive: true });
  });
  setInterval(function () { tick(); idle = true; }, 60000);   // 60秒 むそうさで とめる
  return { value: function () { tick(); return total; } };
})();

/** 表示名から不変IDを作る（乱数・時刻を混ぜない決定的ハッシュ：djb2） */
function djb2(str) {
  var h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function normalizeTitle(t) {
  return String(t || '').trim().toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}
/** 単元＝読んだ本そのもの。ISBN があれば改訂されても不変の ID になる（仕様書 §2.5） */
function unitForBook(book) {
  if (book.isbn) return { id: 'book-' + book.isbn, title: book.title, preset: false };
  return { id: 'custom-' + djb2(normalizeTitle(book.title)), title: book.title, preset: false };
}

/**
 * かんそうを ext に のせるための ととのえ（仕様書 §2.11 / §4）。
 * 児童が じぶんの ことばで 書いた 本の かんそうは、先生が「みんなの本だな」で
 * おすすめとして つかいます。ただし ext に 入れられるのは
 * 児童を 見わけられない ないようだけなので、つぎを かならず とおします。
 *
 * - 改行・タブは 1つの スペースに つぶす（表・CSV に そのまま のせられるように）
 * - 200文字で 切る（入力欄の 上限と そろえる。ext 全体 8KB のうち ごく一部）
 * - 空文字は のせない（ext を むだに ふくらませない）
 */
function sanitizeMemo(memo) {
  var text = String(memo == null ? '' : memo).replace(/[\s　]+/g, ' ').trim();
  return text ? text.slice(0, 200) : null;
}

var Study = {
  session: null,

  /** mode: 'scan'（カメラ）/ 'isbn'（ばんごう検索）/ 'manual'（手入力） */
  begin: function (mode) {
    // 記録中に やりかたを かえたときは、あとから えらんだ ほうを のこす
    if (this.session) { this.session.mode = mode; return; }
    this.session = {
      mode: mode,
      startedAt: new Date(),
      startMs: Date.now(),
      startActive: ActiveTime.value(),
      lookup: 'none'
    };
  },
  markLookup: function (kind) { if (this.session) this.session.lookup = kind; },

  /* 1冊も記録していない中断は保存しない（仕様書 §5.4 中断レコードの3原則） */
  cancel: function () { this.session = null; },

  complete: function (book) {
    var s = this.session;
    this.session = null;
    if (!s) return null;
    if (typeof StudyLog === 'undefined' || typeof StudyLog.saveStudyRecord !== 'function') return null;

    var endMs = Date.now();
    var elapsedMs = Math.max(0, endMs - s.startMs);
    var activeMs = Math.min(Math.max(0, ActiveTime.value() - s.startActive), elapsedMs); // §2.8 クランプ
    var unit = unitForBook(book);
    var d = new Date(book.timestamp);
    var y = d.getFullYear(), m = d.getMonth() + 1;
    var monthLogs = logsIn(y, m);
    var goal = goalOf(y, m);

    return StudyLog.saveStudyRecord({
      appId: APP_ID,
      appVersion: APP_VERSION,
      kind: 'session',
      mode: s.mode,
      unit: unit,
      /* ISBN で見つけた本＝実在の書誌、手入力＝児童が作った単元 */
      source: book.isbn ? 'course' : 'custom',
      multiplayer: false,
      /* 読書の記録は正誤判定ではなく児童の自己申告（仕様書 §2.9） */
      grading: 'selfReport',
      startedAt: s.startedAt.toISOString(),
      endedAt: new Date(endMs).toISOString(),
      elapsedMs: elapsedMs,
      activeMs: activeMs,
      timeBasis: 'app',
      status: 'completed',
      summary: { count: 1, attempted: 1, firstTryCorrect: 1, correct: 1 },
      items: [{ q: unit.id, ok: true, firstTry: true, tries: 1, ms: elapsedMs }],
      ext: {
        pages: book.pages,
        priceYen: book.price,
        rating: book.rating,
        isbn: book.isbn || null,
        // かんそうは 書いたときだけ のせる。★の たかい かんそうは
        // 先生の 画面で「みんなの本だな」の おすすめとして つかわれます
        memo: sanitizeMemo(book.memo),
        lookup: s.lookup,                 // 'auto' 自動取得 / 'manual' 手入力 / 'none'
        monthKey: y + '-' + pad2(m),
        monthlyBooks: monthLogs.length,
        monthlyGoal: goal,
        goalAchieved: monthLogs.length >= goal,
        totalBooks: logs.length,
        totalPages: sumOf(logs, 'pages')
      }
    });
  }
};

/* ============================================================
   5. 学習ログの読み出し（読み出し専用・仕様書 §5.5）
   ============================================================ */
function loadStudyRecords(appId) {
  try {
    var raw = localStorage.getItem('study.records.v1');
    if (!raw) return [];
    var log = JSON.parse(raw);
    if (!Array.isArray(log)) return [];
    return log.filter(function (r) {
      return r && r.schema === 'study.v1' && r.appId === appId;
    }).reverse();
  } catch (e) {
    return [];
  }
}

/* ============================================================
   6. がめんの ゆきき（かいそう構造・履歴・スワイプ）
   ============================================================ */
var TABS = ['home', 'list', 'stamp', 'data'];
var SCREENS = {
  'tab-home':  { tab: 'home',  icon: 'i-book',       title: 'どくしょ ちょきんばこ', render: renderHome },
  'tab-list':  { tab: 'list',  icon: 'i-library',    title: 'よんだ本の リスト',     render: renderList },
  'tab-stamp': { tab: 'stamp', icon: 'i-stamp',      title: 'スタンプちょう',        render: renderStamp },
  'tab-data':  { tab: 'data',  icon: 'i-archive',    title: 'きろく と せってい',    render: renderData },
  'scan':      { tab: 'home',  icon: 'i-camera',     title: 'カメラで よみとる', back: 'ホームに もどる',
                 render: onScanShow, hide: onScanHide },
  'entry':     { tab: 'home',  icon: 'i-book-check', title: '本を きろくする',   back: 'もどる', render: renderEntry, hide: onEntryHide },
  'detail':    { tab: 'list',  icon: 'i-search',     title: '本の くわしく',     back: 'リストに もどる', render: renderDetail },
  'stats':     { tab: 'data',  icon: 'i-chart',      title: 'どくしょの ふりかえり', back: 'もどる', render: renderStats },
  'backup':    { tab: 'data',  icon: 'i-save',       title: 'データを のこす',   back: 'もどる', render: function () {} },
  'help':      { tab: 'data',  icon: 'i-guide',      title: 'つかいかた',        back: 'もどる', render: function () {} },
  'reset':     { tab: 'data',  icon: 'i-trash',      title: 'ぜんぶ けす',       back: 'もどる', render: function () {} }
};

var navStack = [{ tab: 'home' }];
var navIndex = 0;
var activeKey = null;
var scrollMemo = {};
var lastPopAt = 0;

function entryKey(e) { return e.screen ? e.screen : 'tab-' + e.tab; }
function currentTab() { var e = navStack[navIndex]; return (SCREENS[entryKey(e)] || {}).tab || 'home'; }
function screenEl(key) { return $('.screen[data-screen="' + key + '"]'); }

function navInit() {
  /* 履歴の いちばん下に「みはり(guard)」を1つ おいておく。
     これが あるおかげで、いちばん上のがめんで「もどる」を しても
     アプリの外へ出ない＝アプリが かってに おわらない。 */
  try {
    history.replaceState({ app: 1, guard: 1 }, '');
    history.pushState({ app: 1, i: 0 }, '');
  } catch (e) {}
  window.addEventListener('popstate', onPopState);
  paint(null);
}

function navPush(entry) {
  navStack = navStack.slice(0, navIndex + 1);
  navStack.push(entry);
  navIndex = navStack.length - 1;
  try { history.pushState({ app: 1, i: navIndex }, ''); } catch (e) {}
  paint('fwd');
}

function navTab(tab) {
  if (TABS.indexOf(tab) < 0) return;
  var cur = navStack[navIndex];
  if (!cur.screen && cur.tab === tab) { paint(null); return; }
  navPush({ tab: tab });
}

function navGo(screen, params) {
  if (!SCREENS[screen]) return;
  navPush({ tab: currentTab(), screen: screen, params: params || {} });
}

/** 「もどる」。履歴を1つ戻すだけにして、動きの出どころを1本にする */
function goBack() {
  if (dialogOpen()) { closeDialog(null); return; }
  if (Date.now() - lastPopAt < 350) return;      // 端末のジェスチャーとの二重発火よけ
  if (navIndex > 0) { history.back(); return; }
  // 最初のがめん：アプリを おわらせない
  if (currentTab() !== 'home') { navTab('home'); return; }
  toast('ここが さいしょの がめんだよ');
}

function onPopState(e) {
  lastPopAt = Date.now();

  // ダイアログが ひらいていたら、まず それを とじる（がめんは うごかさない）
  if (dialogOpen()) {
    closeDialog(null);
    try { history.pushState({ app: 1, i: navIndex }, ''); } catch (err) {}
    return;
  }

  var s = e.state;
  if (!s || s.app !== 1 || typeof s.i !== 'number') {
    /* みはり(guard)や、アプリの外の履歴に とどいた（＝このままだと アプリが おわる）。
       同じ位置を 積み直して、その場に とどまる。 */
    try { history.pushState({ app: 1, i: navIndex }, ''); } catch (err) {}
    if (navIndex > 0) { navIndex = 0; paint('back'); }
    else toast('ここが さいしょの がめんだよ');
    return;
  }

  var i = clamp(s.i, 0, navStack.length - 1);
  if (i !== s.i) { try { history.replaceState({ app: 1, i: i }, ''); } catch (err) {} }
  if (i === navIndex) return;
  var dir = i < navIndex ? 'back' : 'fwd';
  navIndex = i;
  paint(dir);
}

function paint(direction) {
  var entry = navStack[navIndex];
  var key = entryKey(entry);
  var def = SCREENS[key] || SCREENS['tab-home'];

  if (activeKey && activeKey !== key) {
    var prevEl = screenEl(activeKey);
    if (prevEl) { scrollMemo[activeKey] = prevEl.scrollTop; prevEl.classList.remove('is-active'); }
    var prevDef = SCREENS[activeKey];
    if (prevDef && prevDef.hide) { try { prevDef.hide(key); } catch (e) { console.warn(e); } }
  }
  activeKey = key;

  var el = screenEl(key);
  if (!el) return;
  el.classList.add('is-active');
  try { def.render(entry.params || {}); } catch (e) { console.error('[render]', key, e); }

  if (direction && !reduceMotion) {
    el.classList.remove('anim-fwd', 'anim-back');
    void el.offsetWidth;
    el.classList.add(direction === 'back' ? 'anim-back' : 'anim-fwd');
  }
  el.scrollTop = (direction === 'back' && scrollMemo[key]) ? scrollMemo[key] : 0;

  // ヘッダー・下のナビ
  $('#app-title').innerHTML = ic(def.icon || 'i-book') + '<span class="t">' + esc(def.title) + '</span>';
  var isRoot = !entry.screen;
  var back = $('#hdr-back');
  back.hidden = isRoot && navIndex === 0;
  $('#hdr-help').hidden = !isRoot;
  var nav = $('#app-nav');
  nav.setAttribute('data-mode', isRoot ? 'tabs' : 'back');
  $('#nav-back-label').textContent = def.back || 'まえの がめんに もどる';
  var tab = def.tab;
  $$('.nav-tab').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-tab') === tab);
  });

  /* 画面が かわったことを 読み上げソフトに つたえる。
     見た目では タイトルが かわったと分かるが、目で見ていない児童には
     何も おきていないように 感じられるため。 */
  var live = $('#screen-live');
  if (live) live.textContent = def.title;
}

/* ---- 画面の左右のはしから まんなかへの スワイプで もどる ----
   目印の見た目・きょり・はばは Qalc（GIGA山の他のアプリ）と そろえてある。 */
(function setupEdgeSwipe() {
  var EDGE_WIDTH = 32;      // 画面のはしから何pxまでを「はしっこ」とみなすか
  var TRIGGER_DIST = 72;    // 中央へ何px動かしたら「戻る」とみなすか
  var OFF_AXIS_LIMIT = 48;  // たてにこれ以上ぶれたらスワイプではないとみなす
  var start = null;
  var hintEl = null;

  // 横スクロールする場所（グラフなど）から始まったスワイプは、戻るあつかいにしない
  function startsInHorizontalScroller(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (n.dataset && n.dataset.backSwipeIgnore !== undefined) return true;
      if (n.scrollWidth - n.clientWidth > 4) {
        var ox = window.getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
    }
    return false;
  }

  function reset() {
    if (hintEl) {
      hintEl.style.transition = 'opacity .18s, transform .18s';
      hintEl.style.opacity = '0';
      hintEl.style.transform = 'translateX(0)';
      hintEl.classList.remove('ready');
    }
    hintEl = null; start = null;
  }

  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { reset(); return; }
    var t = e.touches[0];
    var w = window.innerWidth;
    var side = t.clientX <= EDGE_WIDTH ? 'left' : (t.clientX >= w - EDGE_WIDTH ? 'right' : null);
    if (!side) return;
    if (e.target && e.target.nodeType === 1 && startsInHorizontalScroller(e.target)) return;
    start = { x: t.clientX, y: t.clientY, side: side, locked: false };
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!start || e.touches.length !== 1) return;
    var t = e.touches[0];
    var toCenter = start.side === 'left' ? (t.clientX - start.x) : (start.x - t.clientX);
    var offAxis = Math.abs(t.clientY - start.y);

    // たてにぶれた・逆向きに動いた場合は、スワイプではなかったものとしてやめる
    if (toCenter < -8 || (offAxis > OFF_AXIS_LIMIT && offAxis > toCenter)) { reset(); return; }

    if (!start.locked) {
      if (toCenter < 8) return;
      start.locked = true;
      hintEl = start.side === 'left' ? $('#edge-left') : $('#edge-right');
      hintEl.style.transition = 'background-color .15s, color .15s';
    }
    // 端末じたいの スワイプ（ブラウザの戻る）を おさえる
    if (e.cancelable) e.preventDefault();

    var p = clamp(toCenter / TRIGGER_DIST, 0, 1);
    var offset = p * 28;
    hintEl.style.opacity = String(0.35 + p * 0.65);
    hintEl.style.transform = 'translateX(' + (start.side === 'left' ? offset : -offset) + 'px)';
    hintEl.classList.toggle('ready', p >= 1);
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (!start || !start.locked) { reset(); return; }
    var t = e.changedTouches && e.changedTouches[0];
    var toCenter = t ? (start.side === 'left' ? (t.clientX - start.x) : (start.x - t.clientX)) : 0;
    var offAxis = t ? Math.abs(t.clientY - start.y) : 0;
    reset();
    if (toCenter >= TRIGGER_DIST && offAxis <= OFF_AXIS_LIMIT) goBack();
  }, { passive: true });

  /* 端末が ジェスチャーを もっていった場合は touchcancel が くる。
     このとき「もどる」を おこなうと、ブラウザの戻ると 二重に なるため なにもしない。 */
  document.addEventListener('touchcancel', function () { reset(); }, { passive: true });
})();

/* ============================================================
   7. がめんごとの えがきかた
   ============================================================ */
var selectedYear = new Date().getFullYear();
var selectedMonth = new Date().getMonth() + 1;
var listRange = 'month';
var listQuery = '';

/* size は 'md'（30px）か 'lg'（34px）。CSP で style="..." を禁じたので、
   大きさは css/style.css の .stars-md / .stars-lg で つける。 */
function starsHTML(rating, id, size) {
  var out = '<div class="stars' + (size ? ' stars-' + size : '') + '">';
  for (var i = 1; i <= 5; i++) {
    out += '<button class="star' + (i <= rating ? ' on' : '') + '" data-act="rate" data-id="' + esc(id) +
           '" data-star="' + i + '" aria-label="ほし' + i + '">' + ic('i-star', 'ic solid') + '</button>';
  }
  return out + '</div>';
}

function bookItemHTML(b) {
  var d = new Date(b.timestamp);
  return '<button class="book-item" data-act="detail" data-id="' + esc(b.id) + '">' +
    '<span class="book-main">' +
      '<span class="book-top">' +
        '<span class="chip">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
        '<span class="book-title">' + esc(b.title) + '</span>' +
      '</span>' +
      '<span class="book-sub">' +
        '<span class="book-author">' + esc(b.author) + '</span>' +
        '<span class="book-figs">' + fmtNum(b.pages) + 'p / ' + fmtNum(b.price) + '円</span>' +
      '</span>' +
    '</span>' +
    '<span class="book-side">' +
      '<span class="stars" aria-hidden="true">' +
        [0, 1, 2, 3, 4].map(function (i) {
          return '<span class="star' + (i < b.rating ? ' on' : '') + '">' + ic('i-star', 'ic solid') + '</span>';
        }).join('') +
      '</span>' +
      '<span class="menu-arrow"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-chevron-right"></use></svg></span>' +
    '</span>' +
  '</button>';
}

function emptyState(msg) {
  return '<div class="empty-state">' + ic('i-library', 'ic big') + esc(msg) + '</div>';
}

/* ---------- ホーム ---------- */
function renderHome() {
  $('#stat-books').textContent = fmtNum(logs.length);
  $('#stat-pages').textContent = fmtNum(sumOf(logs, 'pages'));
  $('#stat-price').textContent = fmtNum(sumOf(logs, 'price'));

  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1;
  var monthLogs = logsIn(y, m);
  var goal = goalOf(y, m);
  var pct = clamp(Math.round(monthLogs.length / goal * 100), 0, 100);

  $('#home-month-title').textContent = m + '月の ようす';
  $('#home-month-chip').textContent = monthLogs.length + ' / ' + goal + ' さつ';
  var bar = $('#home-progress');
  bar.style.width = pct + '%';
  bar.classList.toggle('gold', monthLogs.length >= goal);
  $('#home-month-msg').textContent = monthLogs.length >= goal
    ? 'もくひょう たっせい！ すごい！'
    : 'あと ' + (goal - monthLogs.length) + 'さつで もくひょう たっせい！';

  var recent = logs.slice(0, 3);
  $('#recent-list').innerHTML = recent.length
    ? recent.map(bookItemHTML).join('')
    : '<div class="empty-state pad-22">' + ic('i-book', 'ic big') + 'まだ きろくが ありません</div>';
}

/* ---------- リスト ---------- */
function fillYearMonth() {
  var years = {};
  years[new Date().getFullYear()] = true;
  years[selectedYear] = true;
  logs.forEach(function (l) { years[new Date(l.timestamp).getFullYear()] = true; });
  var list = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
  if (list.indexOf(new Date().getFullYear() + 1) < 0) list.unshift(new Date().getFullYear() + 1);

  ['#year-select', '#year-select-2'].forEach(function (sel) {
    var el = $(sel); if (!el) return;
    el.innerHTML = list.map(function (y) {
      return '<option value="' + y + '"' + (y === selectedYear ? ' selected' : '') + '>' + y + '年</option>';
    }).join('');
  });
  ['#month-select', '#month-select-2'].forEach(function (sel) {
    var el = $(sel); if (!el) return;
    var out = '';
    for (var i = 1; i <= 12; i++) {
      out += '<option value="' + i + '"' + (i === selectedMonth ? ' selected' : '') + '>' + i + '月</option>';
    }
    el.innerHTML = out;
  });
}

function filteredLogs() {
  var list;
  if (listRange === 'all') list = logs.slice();
  else if (listRange === 'year') list = logsIn(selectedYear, null);
  else list = logsIn(selectedYear, selectedMonth);

  var q = listQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(function (b) {
      return (b.title + ' ' + b.author).toLowerCase().indexOf(q) >= 0;
    });
  }
  return list;
}

function renderList() {
  fillYearMonth();
  $$('#range-seg button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-range') === listRange);
  });
  var disabled = listRange === 'all';
  $('#year-select').disabled = disabled;
  $('#month-select').disabled = disabled || listRange === 'year';

  var list = filteredLogs();
  $('#list-count').textContent = fmtNum(list.length) + ' さつ';
  $('#list-pages').textContent = fmtNum(sumOf(list, 'pages')) + ' ページ';
  $('#list-price').textContent = fmtNum(sumOf(list, 'price')) + ' えん';
  if ($('#list-search').value !== listQuery) $('#list-search').value = listQuery;

  $('#book-list').innerHTML = list.length
    ? list.map(bookItemHTML).join('')
    : emptyState(listQuery ? 'みつかりませんでした' : 'この きかんの きろくは ありません');
}

/* ---------- スタンプ ---------- */
function renderStamp() {
  fillYearMonth();
  var count = logsIn(selectedYear, selectedMonth).length;
  var goal = goalOf(selectedYear, selectedMonth);

  $('#goal-input').value = goal;
  $('#stamp-title').textContent = selectedYear + '年 ' + selectedMonth + '月の スタンプ';
  $('#stamp-count').textContent = count + ' / ' + goal;

  var pct = clamp(Math.round(count / goal * 100), 0, 100);
  var bar = $('#stamp-progress');
  bar.style.width = pct + '%';
  bar.classList.toggle('gold', count >= goal);
  $('#stamp-marks').innerHTML = '<span>0</span><span>' + Math.ceil(goal / 2) + '</span><span>' + goal + '</span>';

  var cells = Math.max(goal, count, 12);
  cells = Math.ceil(cells / 6) * 6;
  var icon = ic(MONTH_STAMPS[selectedMonth] || 'i-stamp');
  var html = '';
  for (var i = 0; i < cells; i++) {
    html += '<div class="stamp-cell' + (i < count ? ' filled' : '') + '">' + (i < count ? icon : '') + '</div>';
  }
  $('#stamp-grid').innerHTML = html;
  $('#stamp-msg').textContent = count >= goal
    ? 'もくひょう たっせい！ よく がんばったね'
    : 'あと ' + (goal - count) + 'さつ！';
}

/* ---------- きろく・せってい ---------- */
function renderData() {
  var on = !!meta.sound;
  $('#sound-emoji').innerHTML = ic(on ? 'i-bell' : 'i-bell-off');
  $('#sound-state').textContent = on ? 'ならす' : 'ならさない';
  $('#sound-mark').textContent = on ? 'オン' : 'オフ';

  var records = loadStudyRecords(APP_ID);
  $('#about-text').innerHTML =
    'バージョン ' + esc(APP_VERSION) + '<br>' +
    'がくしゅうログ ' + esc('study.v1') +
    '（このアプリの きろく ' + records.length + '件）<br>' +
    'きろくは この きかいの なかだけに ほぞんされ、インターネットへ おくることは ありません。';
}

/* ---------- 本のくわしく ---------- */
function findLog(id) {
  for (var i = 0; i < logs.length; i++) if (logs[i].id === String(id)) return logs[i];
  return null;
}
function renderDetail(params) {
  var b = findLog(params.id);
  var box = $('#detail-body');
  if (!b) { box.innerHTML = emptyState('この きろくは ありません'); return; }
  var d = new Date(b.timestamp);
  box.innerHTML =
    '<section class="card">' +
      '<div class="card-head"><span class="chip">' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + '</span></div>' +
      '<h2 class="fs-20">' + esc(b.title) + '</h2>' +
      '<p class="muted mt-1">' + esc(b.author) + '</p>' +
      '<div class="kpis mt-6">' +
        '<div class="kpi"><b>' + fmtNum(b.pages) + '</b><span>ページ</span></div>' +
        '<div class="kpi"><b>' + fmtNum(b.price) + '</b><span>えん</span></div>' +
        (b.isbn ? '<div class="kpi"><b class="fs-13">' + esc(b.isbn) + '</b><span>ISBN</span></div>' : '') +
      '</div>' +
    '</section>' +
    '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">' + ic('i-star', 'ic solid') + 'おもしろさ</h2></div>' +
      starsHTML(b.rating, b.id, 'lg') +
    '</section>' +
    '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">' + ic('i-pen') + 'かんそう</h2></div>' +
      '<textarea class="input" id="detail-memo" maxlength="200" placeholder="おもしろかった ところ など">' + esc(b.memo) + '</textarea>' +
      '<button class="btn btn-blue block mt-4" data-act="save-memo" data-id="' + esc(b.id) + '">かんそうを ほぞん</button>' +
    '</section>' +
    '<button class="btn btn-danger block" data-act="delete" data-id="' + esc(b.id) + '">' +
      ic('i-x') + 'この きろくを けす</button>';
}

/* ---------- ふりかえり ---------- */
function renderStats() {
  var box = $('#stats-body');
  var records = loadStudyRecords(APP_ID);

  // 学習ログから「アプリで きろくに つかった時間」を集める（読み出し専用）
  var activeMs = 0;
  records.forEach(function (r) { activeMs += Number(r.activeMs || 0); });

  var totalBooks = logs.length;
  var totalPages = sumOf(logs, 'pages');
  var totalPrice = sumOf(logs, 'price');
  var avgPages = totalBooks ? Math.round(totalPages / totalBooks) : 0;

  // 直近12か月
  var now = new Date();
  var months = [], i;
  for (i = 11; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var y = d.getFullYear(), m = d.getMonth() + 1;
    months.push({ y: y, m: m, n: logsIn(y, m).length });
  }
  var maxN = months.reduce(function (a, x) { return Math.max(a, x.n); }, 0) || 1;
  var best = months.reduce(function (a, x) { return x.n > a.n ? x : a; }, months[0]);

  // つづけている月数
  var streak = 0;
  for (i = months.length - 1; i >= 0; i--) { if (months[i].n > 0) streak++; else break; }

  var bars = months.map(function (x) {
    var h = Math.round(x.n / maxN * 100);
    var isNow = x.y === now.getFullYear() && x.m === now.getMonth() + 1;
    return '<div class="bar-col">' +
      '<span class="bar-val">' + (x.n || '') + '</span>' +
      '<div class="bar' + (x.n ? (isNow ? ' now' : '') : ' zero') + '" data-h="' + Math.max(h, x.n ? 8 : 2) + '"></div>' +
      '<span class="bar-cap">' + x.m + '</span></div>';
  }).join('');

  box.innerHTML =
    '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">' + ic('i-coin') + 'いままでの ごうけい</h2></div>' +
      '<div class="kpis">' +
        '<div class="kpi"><b>' + fmtNum(totalBooks) + '</b><span>さつ</span></div>' +
        '<div class="kpi"><b>' + fmtNum(totalPages) + '</b><span>ページ</span></div>' +
        '<div class="kpi"><b>' + fmtNum(totalPrice) + '</b><span>えん</span></div>' +
        '<div class="kpi"><b>' + fmtNum(avgPages) + '</b><span>1さつの へいきん ページ</span></div>' +
      '</div>' +
    '</section>' +
    '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">' + ic('i-calendar') + 'つきごとの さっすう（12か月）</h2></div>' +
      '<div class="bars">' + bars + '</div>' +
      '<p class="muted tiny center mt-3">' +
        (best && best.n ? 'いちばん よんだ月：' + best.y + '年' + best.m + '月（' + best.n + 'さつ）' : 'これから きろくして いこう！') +
      '</p>' +
    '</section>' +
    '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">' + ic('i-flame') + 'つづけて いる ようす</h2></div>' +
      '<div class="kpis">' +
        '<div class="kpi"><b>' + streak + '</b><span>れんぞく した 月</span></div>' +
        '<div class="kpi"><b>' + records.length + '</b><span>がくしゅうログの けんすう</span></div>' +
        '<div class="kpi"><b>' + Math.round(activeMs / 60000) + '</b><span>きろくに つかった 分</span></div>' +
      '</div>' +
      '<p class="muted tiny mt-5">' +
        'がくしゅうログ（study.v1）は この きかいの なかだけに たまります。' +
      '</p>' +
    '</section>';

  /* 棒グラフの 高さは 月ごとに 変わるので クラスでは あらわせない。
     HTML には data-h（％）だけを のせておき、置いたあとに
     element.style で のばす。
     style="..." を HTML に じか書きすると CSP（style-src 'self'）に
     ひっかかるが、element.style の書きかえは CSSOM の操作なので通る。 */
  $$('.bar[data-h]', box).forEach(function (el) {
    el.style.height = el.getAttribute('data-h') + '%';
  });
}

/* ============================================================
   8. 本を きろくする（ISBN 検索・入力）
   ============================================================ */
var entryState = { isbn: '', title: '', author: '', pages: '', price: '', rating: 0, memo: '' };

function resetEntry(isbn) {
  entryState = { isbn: isbn || '', title: '', author: '', pages: '', price: '', rating: 0, memo: '' };
}

function renderEntry() {
  $('#entry-isbn').value = entryState.isbn;
  $('#entry-title').value = entryState.title;
  $('#entry-author').value = entryState.author;
  $('#entry-pages').value = entryState.pages;
  $('#entry-price').value = entryState.price;
  $('#entry-memo').value = entryState.memo;
  $('#entry-stars').innerHTML = starsHTML(entryState.rating, '__entry__', 'md');
  ['#entry-title', '#entry-pages', '#entry-price'].forEach(function (s) { $(s).classList.remove('error'); });

  // えらんでいる年月が「いま」と ちがうときは、どの月に きろくされるか しらせる
  var now = new Date();
  var note = $('#entry-month-note');
  var other = !(selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1);
  note.hidden = !other;
  if (other) {
    note.innerHTML = '<span class="chip gold">この きろくは ' + selectedYear + '年' + selectedMonth + '月に なります</span>';
  }
}

function onEntryHide() {
  // 1冊も きろく せずに はなれた → 学習ログは のこさない（仕様書 §5.4）
  Study.cancel();
  $('#lookup-result').innerHTML = '';
}

/* ---- ISBN の たしかめ ---- */
function ean13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  var sum = 0;
  for (var i = 0; i < 12; i++) sum += (+code[i]) * (i % 2 ? 3 : 1);
  return ((10 - (sum % 10)) % 10) === +code[12];
}
function isbn10to13(s) {
  var core = s.replace(/[^0-9X]/gi, '');
  if (core.length !== 10) return '';
  var base = '978' + core.slice(0, 9);
  var sum = 0;
  for (var i = 0; i < 12; i++) sum += (+base[i]) * (i % 2 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}
function toIsbn13(input) {
  var s = String(input || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13) return ean13Valid(s) ? s : '';
  if (s.length === 10) return isbn10to13(s);
  return '';
}

/* ---- 書誌データの とりよせ ---- */
function fetchWithTimeout(url, ms) {
  var ctrl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 8000);
  return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
    .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('http ' + r.status); return r; })
    .catch(function (e) { clearTimeout(timer); throw e; });
}
function toHalfWidth(s) {
  return String(s || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}
function extractNum(v) {
  var n = parseInt(toHalfWidth(v).replace(/[^0-9]/g, ''), 10);
  return isFinite(n) ? n : 0;
}
/** 説明文などから「◯◯ページ」を ひろう（あてにならないので さいごの手だん） */
function scanPageNums(text) {
  if (!text) return [];
  var t = toHalfWidth(text);
  var re = /(\d{1,4})\s*(?:p\b|ページ|頁|ｐ)|(?:ページ数|全)\s*[:：]?\s*(\d{1,4})/gi;
  var out = [], m;
  while ((m = re.exec(t)) !== null) {
    var n = parseInt(m[1] || m[2], 10);
    if (isFinite(n) && n >= 8 && n <= 5000) out.push(n);
  }
  return out;
}
function cleanAuthor(s) {
  if (!s) return '';
  var c = String(s)
    .replace(/(\d{4}\s*-\s*\d{4}|\d{4}\s*-\s*|\s*-\s*\d{4})/g, '')
    .replace(/[著編訳]|監修|ほか|イラスト|作絵|文\/|絵\//g, '')
    .replace(/[／,，、．.\[\]()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  var parts = [];
  c.split(' ').forEach(function (p) { if (p && parts.indexOf(p) < 0) parts.push(p); });
  // 「山田太郎 山田」のように 片方が もう片方に ふくまれる ものを へらす
  parts = parts.filter(function (x) {
    return !parts.some(function (o) { return o !== x && o.indexOf(x) >= 0; });
  });
  return parts.join(' ').trim();
}

/**
 * 3つの API から しらべる。
 * ページ数・ねだんは「たしかな出どころ」を 先に つかい、説明文からの ひろい読みは
 * ほかに 何も なかった ときだけ つかう（大きい数を むやみに ひろわない）。
 */
function lookupBook(isbn13) {
  var res = { title: '', author: '', pages: 0, price: 0, found: false };
  var pagesAuth = [], pagesScan = [], prices = [];

  var pGoogle = fetchWithTimeout('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn13, 8000)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.items || !data.items.length) return;
      var v = data.items[0], info = v.volumeInfo || {};
      res.found = true;
      if (!res.title && info.title) res.title = info.title + (info.subtitle ? ' ' + info.subtitle : '');
      if (!res.author && info.authors) res.author = cleanAuthor(info.authors.join(' '));
      if (info.pageCount) pagesAuth.push(toInt(info.pageCount));
      if (v.saleInfo && v.saleInfo.listPrice && v.saleInfo.listPrice.amount) {
        prices.push({ n: extractNum(v.saleInfo.listPrice.amount), rank: 2 });
      }
      if (info.description) pagesScan = pagesScan.concat(scanPageNums(info.description));
    })['catch'](function () {});

  var pOpenBD = fetchWithTimeout('https://api.openbd.jp/v1/get?isbn=' + isbn13, 8000)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data[0]) return;
      var rec = data[0], sum = rec.summary || {}, onix = rec.onix || {};
      res.found = true;
      if (sum.title) res.title = sum.title + (sum.volume ? ' ' + sum.volume : '');
      if (sum.author) res.author = cleanAuthor(sum.author);
      try {
        var ext = onix.DescriptiveDetail && onix.DescriptiveDetail.Extent;
        if (Array.isArray(ext)) {
          ext.forEach(function (e) {
            // ページを あらわす ExtentType だけを ひろう
            if (['00', '05', '06', '07', '08', '11'].indexOf(String(e.ExtentType)) >= 0) {
              var n = extractNum(e.ExtentValue);
              if (n > 0) pagesAuth.push(n);
            }
          });
        }
      } catch (e) {}
      try {
        var ps = onix.ProductSupply && onix.ProductSupply.SupplyDetail && onix.ProductSupply.SupplyDetail.Price;
        if (Array.isArray(ps)) {
          ps.forEach(function (p) {
            var n = extractNum(p.PriceAmount);
            if (n > 0) prices.push({ n: n, rank: 1 });
          });
        }
      } catch (e) {}
    })['catch'](function () {});

  // 国立国会図書館（CORS が とおらない かんきょうも あるため、だめでも だまって すすむ）
  var pNDL = fetchWithTimeout('https://ndlsearch.ndl.go.jp/api/opensearch?isbn=' + isbn13, 8000)
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      var doc = new DOMParser().parseFromString(txt, 'text/xml');
      var item = doc.querySelector('item') || doc.getElementsByTagName('item')[0];
      if (!item) return;
      res.found = true;
      var get = function (tag) {
        var el = item.getElementsByTagName(tag)[0] ||
                 item.getElementsByTagName('dc:' + tag)[0] ||
                 item.getElementsByTagName('dcterms:' + tag)[0];
        return el ? el.textContent : '';
      };
      if (!res.title) res.title = get('title');
      if (!res.author) res.author = cleanAuthor(get('creator'));
      var extent = get('extent');
      if (extent) pagesAuth = pagesAuth.concat(scanPageNums(extent));
      var desc = get('description');
      if (desc) pagesScan = pagesScan.concat(scanPageNums(desc));
      var price = get('price');
      if (price) { var n = extractNum(price); if (n > 0) prices.push({ n: n, rank: 3 }); }
    })['catch'](function () {});

  var all = Promise.all([pGoogle, pOpenBD, pNDL].map(function (p) {
    return p.then(function () { return null; }, function () { return null; });
  }));

  /* 3つの API を まちつづけると、1つが おそいだけで 子どもを ながく またせる。
     ・ひつような ものが そろったら すぐ すすむ
     ・そろわなくても 6びょうで うちきる                         */
  var waited = new Promise(function (resolve) {
    var timer = setInterval(function () {
      if (res.title && pagesAuth.length && prices.length) { clearInterval(timer); resolve(); }
    }, 120);
    var stop = function () { clearInterval(timer); resolve(); };
    all.then(stop, stop);
    setTimeout(stop, 6000);
  });

  return waited.then(function () {
    var auth = pagesAuth.filter(function (n) { return n > 0 && n <= 20000; });
    var scan = pagesScan.filter(function (n) { return n > 0 && n <= 5000; });
    var picked = auth.length ? auth : scan;
    picked.sort(function (a, b) { return b - a; });
    res.pages = picked.length ? picked[0] : 0;

    prices.sort(function (a, b) { return a.rank - b.rank; });
    res.price = prices.length ? prices[0].n : 0;

    res.title = String(res.title || '').trim().slice(0, 120);
    res.author = String(res.author || '').trim().slice(0, 80);
    return res;
  });
}

var lookingUp = false;
function doLookup(rawIsbn, auto) {
  var isbn = toIsbn13(rawIsbn);
  var box = $('#lookup-result');
  if (!isbn) {
    box.innerHTML = '<p class="tiny txt-danger">978で はじまる 13けたの すうじを いれてね</p>';
    $('#entry-isbn').classList.add('error');
    return Promise.resolve();
  }
  $('#entry-isbn').classList.remove('error');
  entryState.isbn = isbn;
  $('#entry-isbn').value = isbn;

  if (lookingUp) return Promise.resolve();
  lookingUp = true;
  box.innerHTML = '<p class="tiny muted">' + ic('i-search') + ' しらべています…</p>';

  return lookupBook(isbn).then(function (r) {
    lookingUp = false;
    if (!r.title) {
      box.innerHTML = '<p class="tiny txt-danger">みつかりませんでした。' +
        '下の らんに じぶんで かいて きろく できます。</p>';
      Study.markLookup('manual');
      return;
    }
    entryState.title  = r.title;
    entryState.author = r.author || 'ふめい';
    if (r.pages) entryState.pages = String(r.pages);
    if (r.price) entryState.price = String(r.price);
    renderEntry();
    Study.markLookup('auto');

    var missing = [];
    if (!r.pages) missing.push('ページ');
    if (!r.price) missing.push('ねだん');
    box.innerHTML =
      '<div class="card card-found">' +
        '<span class="chip blue">みつけた！</span>' +
        '<p class="fs-14 mt-2">' + esc(r.title) + '</p>' +
        (missing.length
          ? '<p class="tiny txt-danger mt-1">※ ' + esc(missing.join('と')) +
            ' が わからなかったよ。本を みて かいてね</p>'
          : '') +
      '</div>';
    if (!r.pages) $('#entry-pages').classList.add('error');
    if (!r.price) $('#entry-price').classList.add('error');
    if (auto) playBeep();
  })['catch'](function () {
    lookingUp = false;
    box.innerHTML = '<p class="tiny txt-danger">インターネットに つながらなかったので、' +
      'じぶんで かいて きろくしてね</p>';
    Study.markLookup('manual');
  });
}

function saveBook() {
  var title  = $('#entry-title').value.trim();
  var author = $('#entry-author').value.trim();
  var pages  = $('#entry-pages').value.trim();
  var price  = $('#entry-price').value.trim();
  var memo   = $('#entry-memo').value.trim();

  ['#entry-title', '#entry-pages'].forEach(function (s) { $(s).classList.remove('error'); });
  if (!title) {
    $('#entry-title').classList.add('error'); $('#entry-title').focus();
    toast('本の なまえを いれてね'); return;
  }
  if (!pages || toInt(pages) <= 0) {
    $('#entry-pages').classList.add('error'); $('#entry-pages').focus();
    toast('ページすうを いれてね'); return;
  }

  var isbn = toIsbn13(entryState.isbn);
  var dup = logs.filter(function (b) {
    return (isbn && b.isbn === isbn) || normalizeTitle(b.title) === normalizeTitle(title);
  })[0];

  var proceed = dup
    ? confirmDialog('おなじ本が あります',
        '「' + esc(dup.title) + '」は ' + esc(dup.date) + ' に きろく されているよ。<br>それでも きろく しますか？',
        'きろくする')
    : Promise.resolve(true);

  proceed.then(function (ok) {
    if (!ok) return;
    var when = recordDate();
    var book = {
      id: String(Date.now()) + '-' + Math.floor(Math.random() * 1000),
      title: title.slice(0, 120),
      author: (author || 'ふめい').slice(0, 80),
      pages: clamp(toInt(pages), 0, 20000),
      price: clamp(toInt(price), 0, 1000000),
      rating: clamp(toInt(entryState.rating), 0, 5),
      memo: memo.slice(0, 200),
      isbn: isbn,
      timestamp: when.getTime(),
      date: fmtDate(when)
    };
    logs.unshift(book);
    saveLogs();

    /* 学習ログ study.v1 を のこす（保存のみ。外部送信はしない） */
    Study.complete(book);

    var y = when.getFullYear(), m = when.getMonth() + 1;
    var count = logsIn(y, m).length;
    var goal = goalOf(y, m);
    var key = monthKey(y, m);
    var firstTime = count >= goal && !meta.celebrated[key];

    resetEntry('');
    // 記録がおわったので、ホームまで もどす
    backToRoot();

    if (firstTime) {
      meta.celebrated[key] = true;
      saveMeta();
      confetti();
      playFanfare();
      celebrate('i-trophy', 'もくひょう たっせい！', m + '月に ' + count + 'さつ よんだよ');
    } else {
      playFanfare();
      celebrate('i-book-check', 'きろく したよ！', title.length > 16 ? title.slice(0, 16) + '…' : title);
    }
  });
}

/** きろくの日づけ。えらんでいる月が「いま」でないときは、その月の日に そろえる */
function recordDate() {
  var now = new Date();
  if (selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1) return now;
  var lastDay = new Date(selectedYear, selectedMonth, 0).getDate();  // その月の さいごの日
  return new Date(selectedYear, selectedMonth - 1, Math.min(now.getDate(), lastDay), 12, 0, 0);
}

/** かいそうの いちばん上（ルート）へ もどす */
function backToRoot() {
  var steps = navIndex;
  if (steps > 0) { history.go(-steps); }
  else paint(null);
}

/* ============================================================
   9. カメラ（バーコード）
   ============================================================ */
var Scanner = {
  active: false, busy: false,
  stream: null, video: null, detector: null, raf: 0,
  usingQuagga: false, track: null, torchOn: false,

  start: function () {
    var self = this;
    if (this.active) return;
    this.active = true; this.busy = false;
    setIdle('カメラの じゅんびを しています…');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIdle('この きかいでは カメラが つかえません。「ばんごうで いれる」を つかってね');
      return;
    }
    this.detectorReady().then(function (det) {
      if (!self.active) return;
      if (det) return self.startNative(det);
      return self.startQuagga();
    })['catch'](function (err) {
      console.warn('[scan]', err);
      self.fail(err);
    });
  },

  detectorReady: function () {
    if (!('BarcodeDetector' in window)) return Promise.resolve(null);
    return window.BarcodeDetector.getSupportedFormats()
      .then(function (fmts) {
        return fmts.indexOf('ean_13') >= 0 ? new window.BarcodeDetector({ formats: ['ean_13'] }) : null;
      })['catch'](function () { return null; });
  },

  startNative: function (det) {
    var self = this;
    this.detector = det;
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      if (!self.active) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      self.stream = stream;
      self.track = stream.getVideoTracks()[0] || null;
      var v = document.createElement('video');
      v.setAttribute('playsinline', '');            // iOS で 全画面に ならないように
      v.setAttribute('muted', '');
      v.playsInline = true; v.muted = true; v.autoplay = true;
      v.srcObject = stream;
      $('#scan-stage').insertBefore(v, $('#scan-stage').firstChild);
      self.video = v;
      return v.play();
    }).then(function () {
      if (!self.active) return;
      self.ready();
      var loop = function () {
        if (!self.active || !self.video) return;
        self.raf = requestAnimationFrame(loop);
        if (self.busy || self.video.readyState < 2) return;
        self.busy = true;
        self.detector.detect(self.video).then(function (codes) {
          self.busy = false;
          if (codes && codes.length) self.onCode(codes[0].rawValue);
        })['catch'](function () { self.busy = false; });
      };
      self.raf = requestAnimationFrame(loop);
    });
  },

  startQuagga: function () {
    var self = this;
    return loadScript('vendor/quagga.min.js').then(function () {
      if (!self.active) return;
      if (typeof Quagga === 'undefined') throw new Error('quagga missing');
      self.usingQuagga = true;
      return new Promise(function (resolve, reject) {
        Quagga.init({
          inputStream: {
            name: 'Live', type: 'LiveStream',
            target: $('#scan-stage'),
            constraints: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            area: { top: '22%', bottom: '22%', left: '6%', right: '6%' }
          },
          decoder: { readers: ['ean_reader'] },
          /* numOfWorkers は 0（はたらき手を つかわず、本体と同じ場所で よみとる）。
             QuaggaJS は はたらき手を blob: の URL から 作るので、
             CSP の worker-src 'self'（と そのもとの default-src 'self'）に はじかれる。
             はじかれると init の しらせが 返ってこず、カメラの画面が
             「カメラの じゅんびを しています…」から すすまなくなる。
             ここを 通るのは BarcodeDetector を もたない きかい
             （iPad・iPhone の Safari など）なので、そこで カメラが
             ひらかなくなる。CSP を ゆるめる かわりに、はたらき手を つかわない。 */
          frequency: 10, numOfWorkers: 0,
          locator: { patchSize: 'medium', halfSample: true }
        }, function (err) {
          if (err) { reject(err); return; }
          if (!self.active) { try { Quagga.stop(); } catch (e) {} resolve(); return; }
          Quagga.start();
          Quagga.onDetected(self.quaggaHandler);
          self.ready();
          resolve();
        });
      });
    });
  },

  quaggaHandler: function (data) {
    if (data && data.codeResult) Scanner.onCode(data.codeResult.code);
  },

  ready: function () {
    $('#scan-idle').hidden = true;
    $('#scan-frame').hidden = false;
    $('#scan-hint').hidden = false;
    // ライトが つかえるか
    try {
      if (this.track && this.track.getCapabilities) {
        var caps = this.track.getCapabilities();
        if (caps && caps.torch) $('#torch-btn').hidden = false;
      }
    } catch (e) {}
  },

  fail: function (err) {
    var name = (err && err.name) || '';
    var msg = 'カメラが つかえませんでした。「ばんごうで いれる」を つかってね';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      msg = 'カメラを つかう きょかが ありません。ブラウザの せっていから きょかしてね';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      msg = 'カメラが みつかりませんでした。「ばんごうで いれる」を つかってね';
    }
    setIdle(msg);
    this.stopMedia();
  },

  onCode: function (code) {
    if (!this.active || this.busy === 'done') return;
    code = String(code || '').replace(/[^0-9]/g, '');
    if (code.length !== 13) return;
    if (/^19[12]/.test(code)) {                       // 日本の本の「ねだん」バーコード
      toast('それは ねだんの バーコードだよ。上の 978 の ほうを よんでね');
      return;
    }
    if (!/^97[89]/.test(code) || !ean13Valid(code)) return;

    this.busy = 'done';
    playBeep();
    $('#scan-ok').classList.add('show');
    var self = this;
    setTimeout(function () {
      $('#scan-ok').classList.remove('show');
      self.stop();
      resetEntry(code);
      navGo('entry', {});
      doLookup(code, true);
    }, 260);
  },

  toggleTorch: function () {
    if (!this.track || !this.track.applyConstraints) return;
    var self = this;
    this.torchOn = !this.torchOn;
    this.track.applyConstraints({ advanced: [{ torch: this.torchOn }] })['catch'](function () {
      self.torchOn = false;
      toast('ライトが つかえません');
    });
  },

  stopMedia: function () {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (this.usingQuagga && typeof Quagga !== 'undefined') {
      try { Quagga.offDetected(this.quaggaHandler); } catch (e) {}
      try { Quagga.stop(); } catch (e) {}
    }
    this.usingQuagga = false;
    if (this.stream) {
      try { this.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      this.stream = null;
    }
    this.track = null; this.torchOn = false;
    if (this.video) { try { this.video.srcObject = null; this.video.remove(); } catch (e) {} this.video = null; }
    // Quagga が おいていった映像・キャンバスを かたづける
    $$('#scan-stage video, #scan-stage canvas').forEach(function (el) { el.remove(); });
  },

  stop: function () {
    this.active = false; this.busy = false;
    this.stopMedia();
    $('#scan-idle').hidden = false;
    $('#scan-frame').hidden = true;
    $('#scan-hint').hidden = true;
    $('#torch-btn').hidden = true;
    $('#scan-ok').classList.remove('show');
  }
};

function setIdle(msg) {
  $('#scan-idle').hidden = false;
  $('#scan-idle-msg').textContent = msg;
}
function onScanShow() {
  Study.begin('scan');
  Scanner.start();
}
function onScanHide(nextKey) {
  Scanner.stop();
  // 「本を きろくする」へ すすむ ときは 記録セッションを つづける。
  // それ以外（ホームへ もどる など）は、1冊も きろく していないので やめる。
  if (nextKey !== 'entry') Study.cancel();
}

var loadedScripts = {};
function loadScript(src) {
  if (loadedScripts[src]) return loadedScripts[src];
  loadedScripts[src] = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = function () { resolve(); };
    s.onerror = function () { loadedScripts[src] = null; reject(new Error('load failed: ' + src)); };
    document.head.appendChild(s);
  });
  return loadedScripts[src];
}

/* ============================================================
   10. データの もちだし・とりこみ
   ============================================================ */
function exportData() {
  if (!logs.length) { toast('きろくが ありません'); return; }
  try {
    var payload = {
      app: 'reading-books', version: APP_VERSION, exportedAt: new Date().toISOString(),
      logs: logs, goals: goals, meta: { celebrated: meta.celebrated }
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    /* ファイル名は 半角英数にする。
       すべて日本語の名前だと、ブラウザによっては「download」（拡張子なし）に
       なってしまい、あとで よみこめなく なるため。 */
    a.download = 'dokusho-chokinbako_' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('ファイルに ほぞんしました');
  } catch (e) {
    toast('ほぞんに しっぱいしました');
  }
}

function importData(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (ev) {
    var data;
    try { data = JSON.parse(ev.target.result); }
    catch (e) { toast('よみこめない ファイルでした'); return; }

    if (!data || !Array.isArray(data.logs)) { toast('データの かたちが ちがいます'); return; }
    var incoming = [];
    for (var i = 0; i < data.logs.length; i++) {
      var n = normalizeLog(data.logs[i], i);
      if (n) incoming.push(n);
    }
    if (!incoming.length) { toast('きろくが 入っていません'); return; }

    showDialog({
      icon: 'i-folder',
      title: incoming.length + 'さつ ぶんの きろくが あります',
      body: 'いまの きろくは ' + logs.length + 'さつです。<br>どちらに しますか？',
      buttons: [
        { label: 'やめる', value: 'cancel' },
        { label: 'くわえる', value: 'merge', cls: 'btn-blue' },
        { label: 'いれかえる', value: 'replace', cls: 'btn-danger' }
      ]
    }).then(function (choice) {
      if (choice === 'merge') {
        var seen = {};
        logs.forEach(function (b) { seen[b.id] = true; });
        var added = 0;
        incoming.forEach(function (b) {
          if (!seen[b.id]) { logs.push(b); seen[b.id] = true; added++; }
        });
        Object.keys(data.goals || {}).forEach(function (k) {
          if (goals[k] === undefined) goals[k] = data.goals[k];
        });
        saveLogs(); saveGoals();
        toast(added + 'さつ くわえました');
        paint(null);
      } else if (choice === 'replace') {
        confirmDialog('ぜんぶ いれかえます',
          'いまの きろく ' + logs.length + 'さつは きえます。よろしいですか？',
          'いれかえる', true).then(function (ok) {
          if (!ok) return;
          logs = incoming;
          goals = (data.goals && typeof data.goals === 'object' && !Array.isArray(data.goals)) ? data.goals : {};
          if (data.meta && data.meta.celebrated) meta.celebrated = data.meta.celebrated;
          saveLogs(); saveGoals(); saveMeta();
          toast('ふくげん しました');
          paint(null);
        });
      }
    });
  };
  reader.onerror = function () { toast('よみこみに しっぱいしました'); };
  reader.readAsText(file);
}

/* ---------- 紙に いんさつする ----------
   画面をそのまま出すのではなく、印刷専用のシートを組み立てて出す。
   こうしておくと、どの画面を見ているときに いんさつしても
   かならず同じ「よんだ本の きろく」が A4 たてで出る。
   なまえの らんは わざと 空にしてある（このアプリは氏名を持たない）。 */
function buildPrintSheet() {
  var sheet = $('#print-sheet');
  if (!sheet) return;

  var rows = logs.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });  // 古い順
  var head =
    '<div class="pr-head">' +
      '<h1>どくしょ ちょきんばこ</h1>' +
      '<p class="pr-sub">よんだ本の きろく　／　いんさつした日：' + esc(fmtDate(new Date())) + '</p>' +
    '</div>' +
    '<div class="pr-name"><span>なまえ</span><span class="pr-line"></span>' +
    '<span>クラス</span><span class="pr-line pr-line-short"></span></div>';

  if (!rows.length) {
    sheet.innerHTML = head + '<p class="pr-empty">まだ きろくが ありません。</p>';
    return;
  }

  var totalPages = 0, totalPrice = 0;
  var body = '';
  rows.forEach(function (b, i) {
    totalPages += b.pages;
    totalPrice += b.price;
    body +=
      '<tr>' +
        '<td class="mid">' + (i + 1) + '</td>' +
        '<td class="mid">' + esc(b.date) + '</td>' +
        '<td>' + esc(b.title) + (b.memo ? '<br><span class="pr-memo">' + esc(b.memo) + '</span>' : '') + '</td>' +
        '<td>' + esc(b.author) + '</td>' +
        '<td class="num">' + (b.pages ? b.pages : '') + '</td>' +
        '<td class="num">' + (b.price ? b.price : '') + '</td>' +
        '<td class="mid">' + (b.rating ? '★'.repeat(b.rating) : '') + '</td>' +
      '</tr>';
  });

  sheet.innerHTML = head +
    '<div class="pr-total">' +
      '<span>ぜんぶで <b>' + rows.length + '</b> さつ</span>' +
      '<span>ごうけい <b>' + totalPages + '</b> ページ</span>' +
      '<span>ごうけい <b>' + totalPrice + '</b> えん</span>' +
    '</div>' +
    '<table class="pr-table"><thead><tr>' +
      '<th>#</th><th>よんだ日</th><th>本の なまえ／かんそう</th><th>かいた人</th>' +
      '<th>ページ</th><th>ねだん</th><th>ほし</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>' +
    '<p class="pr-foot">© 2026 どくしょ ちょきんばこ　GIGA山</p>';
}

/* ブラウザの メニューや Ctrl+P から いんさつしたときも、
   かならず 最新の きろくが 出るようにしておく。 */
window.addEventListener('beforeprint', buildPrintSheet);

function doPrint() {
  buildPrintSheet();
  if (!logs.length) { toast('きろくが ありません'); return; }
  /* シートを組み立てた あと 1フレーム おいてから 印刷を ひらく。
     組み立てた直後だと、ブラウザによっては 空のまま プレビューになる。 */
  requestAnimationFrame(function () { window.print(); });
}

function copyForSpreadsheet() {
  if (!logs.length) { toast('きろくが ありません'); return; }
  var rows = logs.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });   // 古い順
  var tsv = '日付\tタイトル\tかいた人\tおもしろさ\tページ数\tごうけいページ\tきんがく\tごうけいきんがく\tかんそう\n';
  var sp = 0, sy = 0;
  rows.forEach(function (b) {
    sp += b.pages; sy += b.price;
    tsv += [b.date, b.title, b.author, '★'.repeat(b.rating), b.pages, sp, b.price, sy,
            b.memo.replace(/[\t\r\n]+/g, ' ')].join('\t') + '\n';
  });

  var done = function () { toast('ひょうに はりつけられる かたちで コピーしました'); };
  var fail = function () { toast('コピーできませんでした'); };

  if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    navigator.clipboard.writeText(tsv).then(done, function () { legacyCopy(tsv) ? done() : fail(); });
  } else {
    legacyCopy(tsv) ? done() : fail();
  }
}
function legacyCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    var ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function resetAll() {
  confirmDialog('ほんとうに ぜんぶ けしますか？',
    'よんだ本の きろく・もくひょう・スタンプが ぜんぶ きえます。<br>もとには もどせません。',
    'ぜんぶ けす', true).then(function (ok) {
    if (!ok) return;
    /* 消すのは このアプリの キーだけ。
       localStorage.clear() は つかわない（ほかの学習アプリの データを こわすため）。
       共通の学習ログ `study.records.v1` も 消さない（仕様書 §1.2）。 */
    try {
      localStorage.removeItem(KEYS.logs);
      localStorage.removeItem(KEYS.goals);
      localStorage.removeItem(KEYS.meta);
    } catch (e) {}
    logs = []; goals = {};
    meta = { celebrated: {}, sound: meta.sound };
    saveMeta();
    toast('きろくを ぜんぶ けしました');
    navTab('home');
  });
}

/* ============================================================
   11. そうさ（クリック・入力）
   ============================================================ */
function onAction(act, el) {
  switch (act) {
    case 'tab':     navTab(el.getAttribute('data-tab')); break;
    case 'go':      navGo(el.getAttribute('data-screen'), {}); break;
    case 'back':    goBack(); break;

    case 'entry': {
      var mode = el.getAttribute('data-mode') || 'manual';
      Study.begin(mode);
      resetEntry('');
      navGo('entry', {});
      if (mode === 'manual') setTimeout(function () { $('#entry-title').focus(); }, 260);
      else setTimeout(function () { $('#entry-isbn').focus(); }, 260);
      break;
    }
    case 'lookup':  doLookup($('#entry-isbn').value, false); break;
    case 'save':    saveBook(); break;

    case 'detail':  navGo('detail', { id: el.getAttribute('data-id') }); break;

    case 'rate': {
      var id = el.getAttribute('data-id');
      var star = toInt(el.getAttribute('data-star'));
      if (id === '__entry__') {
        entryState.rating = (entryState.rating === star) ? 0 : star;
        $('#entry-stars').innerHTML = starsHTML(entryState.rating, '__entry__', 'md');
      } else {
        var b = findLog(id);
        if (b) {
          b.rating = (b.rating === star) ? 0 : star;
          saveLogs();
          paint(null);
        }
      }
      break;
    }

    case 'save-memo': {
      var bm = findLog(el.getAttribute('data-id'));
      if (bm) { bm.memo = $('#detail-memo').value.trim().slice(0, 200); saveLogs(); toast('かんそうを ほぞんしました'); }
      break;
    }

    case 'delete': {
      var did = el.getAttribute('data-id');
      var bd = findLog(did);
      if (!bd) return;
      confirmDialog('この きろくを けしますか？', '「' + esc(bd.title) + '」を けします。', 'けす', true)
        .then(function (ok) {
          if (!ok) return;
          logs = logs.filter(function (x) { return x.id !== did; });
          saveLogs();
          toast('けしました');
          goBack();
        });
      break;
    }

    case 'range':
      listRange = el.getAttribute('data-range');
      renderList();
      break;

    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
    case 'copy':   copyForSpreadsheet(); break;
    case 'print':  doPrint(); break;
    case 'reset':  resetAll(); break;
    case 'torch':  Scanner.toggleTorch(); break;

    case 'toggle-sound':
      meta.sound = !meta.sound;
      saveMeta(); renderData();
      if (meta.sound) playBeep();
      toast(meta.sound ? 'おとを ならします' : 'おとを ならしません');
      break;

    case 'install': doInstall(); break;
  }
}

document.addEventListener('click', function (ev) {
  var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!el) return;
  ev.preventDefault();
  onAction(el.getAttribute('data-act'), el);
});

$('#hdr-back').addEventListener('click', goBack);

/* 入力の うけとり */
function bindEntryInput(sel, key) {
  var el = $(sel);
  el.addEventListener('input', function () {
    entryState[key] = el.value;
    el.classList.remove('error');
  });
}
bindEntryInput('#entry-isbn', 'isbn');
bindEntryInput('#entry-title', 'title');
bindEntryInput('#entry-author', 'author');
bindEntryInput('#entry-pages', 'pages');
bindEntryInput('#entry-price', 'price');
bindEntryInput('#entry-memo', 'memo');

$('#entry-isbn').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); doLookup($('#entry-isbn').value, false); }
});

['#year-select', '#year-select-2'].forEach(function (sel) {
  $(sel).addEventListener('change', function () {
    selectedYear = toInt(this.value) || selectedYear;
    paint(null);
  });
});
['#month-select', '#month-select-2'].forEach(function (sel) {
  $(sel).addEventListener('change', function () {
    selectedMonth = clamp(toInt(this.value) || selectedMonth, 1, 12);
    paint(null);
  });
});
$('#goal-input').addEventListener('change', function () {
  var v = clamp(toInt(this.value) || 10, 1, 99);
  this.value = v;
  goals[monthKey(selectedYear, selectedMonth)] = v;
  saveGoals();
  renderStamp();
});
var searchTimer = 0;
$('#list-search').addEventListener('input', function () {
  var v = this.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () { listQuery = v; renderList(); }, 180);
});
$('#import-file').addEventListener('change', function () {
  var f = this.files && this.files[0];
  this.value = '';
  importData(f);
});

/* キーボードでも もどれるように（PC・そとづけキーボード） */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  var t = e.target;
  var typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  if (typing && !dialogOpen()) { t.blur(); return; }
  goBack();
});

/* ============================================================
   12. PWA（インストール・オフライン）
   ============================================================ */
/* インストールの合図（beforeinstallprompt）は js/pwa-early.js が
   <head> のいちばん上で うけとって ためている。
   このファイルは 画面の HTML より後ろで読まれるため、ここで待っていると
   通信のおそい端末で 合図を取りこぼしていた。
   すでに来ていれば window.__deferredInstallPrompt に入っており、
   これから来るぶんは pwa-installable で とどく。 */
var deferredPrompt = window.__deferredInstallPrompt || null;

function showInstallRow(show) {
  var row = $('#install-row');
  if (row) row.hidden = !show;
}
window.addEventListener('pwa-installable', function () {
  deferredPrompt = window.__deferredInstallPrompt;
  showInstallRow(true);
});
window.addEventListener('pwa-installed', function () {
  deferredPrompt = null;
  showInstallRow(false);
  toast('インストール できました！');
});

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
         window.navigator.standalone === true;
}
function doInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
    return;
  }
  showDialog({
    icon: 'i-install',
    title: 'アプリとして つかう',
    body: isIOS()
      ? 'Safari の 下（または 右上）の <b>「共有」ボタン ' + ic('i-share') +
        '</b> を おして、<br><b>「ホーム画面に追加」</b> を えらんでね。'
      : 'ブラウザの メニュー（⋮）から <b>「アプリをインストール」</b> または <b>「ホーム画面に追加」</b> を えらんでね。',
    buttons: [{ label: 'わかった', value: true, cls: 'btn-primary' }]
  });
}

/** あたらしい版が とどいたことを、児童にも わかる ことばで しらせる。
 *  「さいしんに する」を おしたときだけ よみこみ直す。 */
function showUpdateBar(waitingSW) {
  if ($('#update-bar')) return;                 // 2回 出さない
  var bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar no-print';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  bar.innerHTML =
    '<span class="update-text">あたらしい バージョンが あります</span>' +
    '<button class="btn btn-sm btn-primary" id="update-now">さいしんに する</button>' +
    '<button class="btn btn-sm" id="update-later" aria-label="あとで">あとで</button>';
  document.body.appendChild(bar);

  $('#update-now').addEventListener('click', function () {
    waitingSW.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  });
  $('#update-later').addEventListener('click', function () { bar.remove(); });
}

if ('serviceWorker' in navigator) {
  /* ⚠️ load を まつだけでは たりない。
     この app.js が おそく よみこまれたり、もどるボタンで ページが
     よみがえったり すると、load は もう おわって いる。
     その ときは listener が 二度と よばれず、Service Worker が
     しずかに 登録されない（エラーも 出ない）。
     オフラインで ひらけない・更新の おしらせが 出ない、という形で
     あとから 気づくことに なる。
     だから「もう おわって いるか」を 見て わける。 */
  function bootServiceWorker() {
    /* はじめて ひらいたときは Service Worker が あとから うけもつ（claim）ため
       controllerchange が おきる。ここで よみこみ直すと、入力中の ないようが
       きえてしまう。よみこみ直すのは「まえから うけもたれていた＝更新」のときだけ。 */
    var wasControlled = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      /* あたらしい版が ととのったら、だまって いれかえずに 児童にたずねる。
         かんそうを 入力している とちゅうに かってに よみこみ直すと、
         書いた ものが きえてしまうため。 */
      reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBar(sw);
          }
        });
      });
    })['catch'](function (err) { console.warn('[sw] register failed', err); });

    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloaded || !wasControlled) return;
      reloaded = true;
      location.reload();
    });
  }

  if (document.readyState === 'complete') bootServiceWorker();
  else window.addEventListener('load', bootServiceWorker);
}

/* ============================================================
   13. はじまり
   ============================================================ */
window.addEventListener('pagehide', function () {
  /* タブが すてられても こまらないように、ここで しまつを する。
     1冊も きろくして いない とちゅうの セッションは、仕様書 §5.4 により のこさない。 */
  Study.cancel();
  Scanner.stop();
});
document.addEventListener('visibilitychange', function () {
  if (document.hidden && Scanner.active) Scanner.stop();
});

/* ソフトキーボードが出たときに 画面が つぶれないようにする。
   window.innerHeight は キーボードが出ても変わらないが、
   visualViewport は「いま ほんとうに見えている高さ」に ちぢむ。
   その値を CSS 変数 --vvh に流しこみ、css/style.css の .app が
   max-height として つかう。 */
(function syncVisualViewport() {
  var vv = window.visualViewport;
  if (!vv) return;
  var sync = function () {
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
})();

function boot() {
  loadAll();
  fillYearMonth();
  navInit();

  /* すでに インストールの合図が 来ていれば ボタンを出す
     （js/pwa-early.js が <head> でうけとって ためている） */
  if (deferredPrompt && !isStandalone()) showInstallRow(true);

  /* iOS(Safari)には beforeinstallprompt が ないので、案内を じぶんで出す。
     Chrome では beforeinstallprompt が とどいた ときに 出す。 */
  if (isIOS() && !isStandalone()) {
    var row = $('#install-row'); if (row) row.hidden = false;
  }

  // ホームがめんの ショートカットから ひらいたとき
  try {
    var p = new URLSearchParams(location.search).get('screen');
    if (p === 'scan') navGo('scan', {});
    else if (p && TABS.indexOf(p) >= 0) navTab(p);
    if (p) history.replaceState({ app: 1, i: navIndex }, '', location.pathname);
  } catch (e) {}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
