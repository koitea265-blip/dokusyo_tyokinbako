#!/usr/bin/env node
/*!
 * どくしょ ちょきんばこ — 実機（Chromium）での検査
 *
 *   npm run test:browser
 *
 * scripts/check-project.mjs（静的な検査）では見られないことを、
 * 実際にブラウザで描画して確かめる。
 *
 *   1. 320〜1920px で 横スクロールが出ないか
 *   2. 全画面を回って console エラーと CSP 違反が0件か
 *   3. 指で押せる はんいが 44px 以上か（::after で広げた ぶんも数える）
 *   4. 文字のコントラスト（実際に描画された色と、重なりを解決した地の色で計算）
 *   5. 印刷シートが A4 で組み立てられるか
 *   6. maskable アイコンの絵が 中央80%（セーフゾーン）に収まっているか
 *   7. サーバーを本当に止めても アプリが起動するか  ← いちばん大事
 *   8. manifest の id/scope/start_url が公開の置き場所から始まる絶対パスか
 *
 * 7 は、以前「Content-Encoding を落とさずにキャッシュしていたせいで
 * 圏外だと まっ白なエラー画面になる」不具合があったところ。
 * sw.js を触ったときに 同じことが起きていないか、ここで捕まえる。
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const log = (...a) => console.log(...a);
const check = (cond, label, detail = '') => {
  log(`${cond ? '✅' : '❌'} ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) problems.push(label + (detail ? ' — ' + detail : ''));
  return cond;
};

/* 検査のあいだに使う ダミーの記録。実在の本だが個人情報は含まない。
 *
 * 日付は かならず「実行した日」を基準にする。
 * 「よんだ本の リスト」は 既定で “この月” だけを出すので、
 * 固定の日付にすると 月が変わったとたんに 1冊も出なくなり、
 * 本の行・★・かんそう を まったく検査しないまま ✅ になってしまう。 */
const TODAY = Date.now();
const SAMPLE = [
  { id: 'a', title: 'ぐりとぐら', author: 'なかがわりえこ', pages: 28, price: 990, rating: 5,
    memo: 'たまごの ケーキが おいしそうだった', isbn: '', timestamp: TODAY - 2 * 86400000 },
  { id: 'b', title: 'モモ', author: 'ミヒャエル・エンデ', pages: 400, price: 880, rating: 3,
    memo: '', isbn: '', timestamp: TODAY }
];
const LOGS_KEY = 'reading_record_main_v1_logs';

/* Playwright が持っている Chromium が無い環境（この開発コンテナなど）でも
   動くよう、置いてある実体があれば それを使う。 */
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;

const server = await startServer(ROOT);
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

async function newPage(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[error] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => errs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`));
  return { page, errs };
}
const seed = (page) => page.evaluate(
  ([key, data]) => localStorage.setItem(key, JSON.stringify(data)), [LOGS_KEY, SAMPLE]);

/* ============================================================
   1. はば別に 横スクロールが出ないか
   ============================================================ */
for (const [w, h, label] of [
  [320, 568, '320x568（設計下限）'], [375, 667, '375（iPhone SE）'],
  [810, 1080, '810（iPad）'], [1366, 768, '1366（Chromebook）'], [1920, 1080, '1920（教員PC）']
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const { page } = await newPage(ctx);
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await seed(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: window.innerWidth
  }));
  check(r.doc <= r.win + 1, `${label} で横スクロールが出ない`, `scrollWidth=${r.doc} / innerWidth=${r.win}`);
  await ctx.close();
}

/* ============================================================
   2. 全画面を回って console エラー・CSP 違反が0件か
   ============================================================ */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const { page, errs } = await newPage(ctx);
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await seed(page);
  await page.reload({ waitUntil: 'networkidle' });

  const goTab = async (tab) => {
    for (let k = 0; k < 4; k++) {
      if (await page.$(`.nav-tab[data-tab="${tab}"]:visible`)) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await page.click(`.nav-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(300);
  };

  for (const tab of ['home', 'list', 'stamp', 'data']) await goTab(tab);

  // 「きろく」の下の階層をひととおり開く
  await goTab('data');
  const subs = (await page.$$('[data-screen="tab-data"] .menu-item[data-act="go"]')).length;
  for (let i = 0; i < subs; i++) {
    await goTab('data');
    const list = await page.$$('[data-screen="tab-data"] .menu-item[data-act="go"]');
    await list[i].click();
    await page.waitForTimeout(350);
  }
  // 本のくわしく
  await goTab('list');
  await page.locator('.screen.is-active .book-item').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(350);

  const refused = errs.filter((e) => /Refused to|Content Security Policy/i.test(e));
  check(refused.length === 0, 'CSP 違反（Refused to …）が0件', refused.slice(0, 3).join(' / '));
  check(errs.length === 0, 'console エラーが0件', errs.slice(0, 3).join(' / '));
  await ctx.close();
}

/* ============================================================
   2.5 ダミーの記録が 画面に出ているか
   ------------------------------------------------------------
   ここが 0件だと、以下の検査（タップ領域・コントラスト）が
   本の行・★・かんそう を 素通りしたまま ✅ になってしまう。
   検査そのものが 空振りしていないことを 先に確かめる。
   ============================================================ */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const { page } = await newPage(ctx);
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await seed(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.nav-tab[data-tab="list"]');
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => ({
    books: document.querySelectorAll('.screen.is-active .book-item').length,
    stars: document.querySelectorAll('.screen.is-active .star').length
  }));
  check(n.books === SAMPLE.length && n.stars > 0,
    '検査用の記録が リストに出ている（検査が空振りしていない）', JSON.stringify(n));
  await ctx.close();
}

/* ============================================================
   3. 指で押せる はんいが 44px 以上か
   ============================================================ */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const { page } = await newPage(ctx);
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await seed(page);
  await page.reload({ waitUntil: 'networkidle' });

  const small = [];
  for (const tab of ['home', 'list', 'stamp', 'data']) {
    await page.click(`.nav-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(300);
    const found = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.screen.is-active button, .app-header button, .app-nav button')
        .forEach((b) => {
          if (!b.offsetParent) return;
          const r = b.getBoundingClientRect();
          if (r.height === 0) return;
          // 見た目は小さいままで ::after だけを広げている箇所があるので、
          // 疑似要素の大きさも 押せる はんい として数える。
          const af = getComputedStyle(b, '::after');
          const h = Math.max(r.height, parseFloat(af.height) || 0);
          const w = Math.max(r.width, parseFloat(af.width) || 0);
          if (h < 43.5 || w < 43.5) {
            out.push(`${(b.className || b.tagName)} ${Math.round(w)}x${Math.round(h)}`);
          }
        });
      return out;
    });
    found.forEach((f) => small.push(`${tab}: ${f}`));
  }
  check(small.length === 0, '押せる要素がすべて 44px 以上', small.slice(0, 5).join(' / '));
  await ctx.close();
}

/* ============================================================
   4. 文字のコントラスト
   ------------------------------------------------------------
   Chromebook の液晶は 視野角もコントラストも弱く、うすい灰色は
   ななめから見ると ほとんど読めない。ここは 実際に描画された文字色と、
   重なりを解決した 実際の地の色から 計算する。
   プレースホルダは疑似要素、からっぽの表示は記録0件のときだけ出るので、
   ふつうに要素を走査するだけでは 見つけられない。
   ============================================================ */
{
  const MEASURE = () => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => { const m = s.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
    const over = (f, b) => { const a = f[3] ?? 1; return [0, 1, 2].map((i) => f[i] * a + b[i] * (1 - a)); };
    const ratio = (f, b) => { const l1 = lum(f), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
    const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const bgOf = (el) => {
      let cur = el, acc = null;
      while (cur) {
        const c = parse(getComputedStyle(cur).backgroundColor);
        if (c && (c[3] ?? 1) > 0) { acc = acc ? over(acc, c) : c; if ((c[3] ?? 1) === 1) return acc.slice(0, 3); }
        cur = cur.parentElement;
      }
      return (acc || [255, 255, 255]).slice(0, 3);
    };
    const out = [];
    const push = (label, colorStr, el, px, bold) => {
      const fg = parse(colorStr); if (!fg) return;
      const bg = bgOf(el); const c = over(fg, bg); const r = ratio(c, bg);
      const large = (bold && px >= 18.66) || px >= 24;
      const need = large ? 3 : 4.5;
      if (r < need) out.push({ label, fg: hex(c), bg: hex(bg), px: Math.round(px), ratio: +r.toFixed(2), need });
    };
    // ふつうの文字
    document.querySelectorAll('.screen.is-active *, .app-header *, .app-nav *').forEach((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
      const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('').trim();
      if (!t) return;
      const cs = getComputedStyle(el);
      push(`「${t.slice(0, 14)}」`, cs.color, el, parseFloat(cs.fontSize), parseInt(cs.fontWeight, 10) >= 700);
    });
    // プレースホルダ（疑似要素なので getComputedStyle の第2引数で取る）
    document.querySelectorAll('.screen.is-active input.input, .screen.is-active textarea.input').forEach((el) => {
      if (!el.offsetParent || !el.placeholder) return;
      const ph = getComputedStyle(el, '::placeholder'), cs = getComputedStyle(el);
      push(`プレースホルダ「${el.placeholder.slice(0, 12)}」`, ph.color, el,
        parseFloat(ph.fontSize || cs.fontSize), parseInt(ph.fontWeight || cs.fontWeight, 10) >= 700);
    });
    // からっぽの表示
    document.querySelectorAll('.screen.is-active .empty-state').forEach((el) => {
      if (!el.offsetParent) return;
      const cs = getComputedStyle(el);
      push(`からっぽ「${el.innerText.trim().slice(0, 12)}」`, cs.color, el,
        parseFloat(cs.fontSize), parseInt(cs.fontWeight, 10) >= 700);
    });
    return out;
  };

  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const { page } = await newPage(ctx);
  const bad = [];

  // 記録あり／記録なし の両方を見る（からっぽの表示は 0件のときだけ出る）
  for (const withData of [true, false]) {
    await page.goto(server.url, { waitUntil: 'networkidle' });
    if (withData) await seed(page);
    else await page.evaluate((k) => localStorage.setItem(k, '[]'), LOGS_KEY);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    for (const tab of ['home', 'list', 'stamp', 'data']) {
      await page.click(`.nav-tab[data-tab="${tab}"]`);
      await page.waitForTimeout(350);
      (await page.evaluate(MEASURE)).forEach((x) => bad.push(x));
    }
  }
  const uniq = [...new Map(bad.map((b) => [b.label + b.fg + b.bg, b])).values()];
  check(uniq.length === 0, '文字のコントラストがすべて足りている',
    uniq.slice(0, 5).map((b) => `${b.ratio}(要${b.need}) ${b.fg} on ${b.bg} ${b.label}`).join(' / '));
  await ctx.close();
}

/* ============================================================
   5. 印刷シート
   ============================================================ */
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const { page } = await newPage(ctx);
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await seed(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(250);
  const sheet = await page.evaluate(() => ({
    display: getComputedStyle(document.getElementById('print-sheet')).display,
    rows: document.querySelectorAll('#print-sheet tbody tr').length,
    app: getComputedStyle(document.querySelector('.app')).display
  }));
  check(sheet.display === 'block' && sheet.rows === SAMPLE.length && sheet.app === 'none',
    '印刷シートが組み立てられ、画面用の要素は出ない',
    `display=${sheet.display} 行数=${sheet.rows} .app=${sheet.app}`);
  await ctx.close();
}

/* ============================================================
   6. maskable アイコンの セーフゾーン
   ------------------------------------------------------------
   Android は アイコンを まる／すみまる／しずく など 好きな形に
   切りぬく。安全なのは 中央80%の「まる」の中だけ。

   ここを 四角（上下左右10%を除いた 正方形）で 見てはいけない。
   正方形の かど は まるの外に はみ出しているので、検査がゆるくなり、
   実際には 欠けるアイコンでも 通ってしまう。
   （はじめ 四角で書いてしまい、修正前のアイコンが 通ってしまった）
   絵の いちばん外側の点が 中心から どれだけ離れているかで 見る。

   PNG の中身は ブラウザの canvas で読む（依存パッケージを増やさない）。
   ============================================================ */
{
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 } });
  const { page } = await newPage(ctx);
  await page.goto(server.url, { waitUntil: 'networkidle' });

  for (const file of ['icons/icon-maskable-512.png', 'icons/icon-maskable-192.png']) {
    const r = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const c = cv.getContext('2d', { willReadFrequently: true });
      c.drawImage(img, 0, 0);
      const { data } = c.getImageData(0, 0, cv.width, cv.height);
      // かどの色を「地の色」とみなし、そこから はっきり違う画素を「絵」とする
      const bg = [data[0], data[1], data[2]];
      const cx = cv.width / 2, cy = cv.height / 2;
      let maxR = 0;
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (data[i + 3] < 16) continue;                       // 透明は地とみなす
          const diff = Math.abs(data[i] - bg[0]) + Math.abs(data[i+1] - bg[1]) + Math.abs(data[i+2] - bg[2]);
          if (diff < 24) continue;                              // 地の色とほぼ同じ
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d > maxR) maxR = d;
        }
      }
      return { size: cv.width, maxR: Math.round(maxR) };
    }, file);

    const limit = r.size * 0.4;                                 // 中央80%の まる の 半径
    check(r.maxR <= limit + 1, `${file} の絵が中央80%のまるに収まっている`,
      `絵の外端 ${r.maxR}px / 許容 ${Math.round(limit)}px`);
  }
  await ctx.close();
}

/* ============================================================
   6. サーバーを本当に止めても アプリが起動するか
   ------------------------------------------------------------
   ブラウザの「オフライン疑似」は ページ遷移を Service Worker より
   手前で止めてしまうため、キャッシュから返せているかを確かめられない。
   ここでは 本当に サーバーを落とす。
   ============================================================ */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const { page } = await newPage(ctx);
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  await server.stop();                      // ← 圏外と同じ状態にする

  const p2 = await ctx.newPage();
  await p2.goto(server.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p2.waitForTimeout(1200);
  const shown = await p2.evaluate(() => ({
    title: document.querySelector('#app-title')?.innerText?.trim() || null,
    screen: document.querySelector('.screen.is-active')?.getAttribute('aria-label') || null
  })).catch(() => ({}));
  check(!!shown.title, 'サーバーを止めてもアプリが起動する', JSON.stringify(shown));
  await ctx.close();
}

/* ============================================================
   7. manifest
   ============================================================ */
{
  const { readFile } = await import('node:fs/promises');
  const mf = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const cfg = JSON.parse(await readFile(join(ROOT, 'quality.config.json'), 'utf8'));
  /* 公開の置き場所。専用ドメインの直下なら "/"、共有オリジンなら "/リポジトリ名/"。
     ここが公開URLとずれていると、開いているページが scope の外になり、
     manifest ごと無視されて PWA として起動しなくなる。 */
  const base = cfg.basePath || ('/' + cfg.repoName + '/');
  const okAbs = ['id', 'scope', 'start_url'].every((k) => String(mf[k] || '').startsWith(base));
  check(okAbs, `manifest の id/scope/start_url が ${base} から始まる絶対パス`,
    `${mf.id} / ${mf.scope} / ${mf.start_url}`);
}

await browser.close();
await server.stop().catch(() => {});

log('');
if (problems.length) {
  log(`❌ ${problems.length}件 失敗`);
  process.exit(1);
}
log('✅ すべて通った');
