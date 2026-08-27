#!/usr/bin/env node
/*!
 * GIGA Standard v4 — 品質ゲート
 *
 * `npm run check`（または `node scripts/check-project.mjs`）で走る。
 * 依存パッケージはゼロ。Node 18 以上があれば動く。
 *
 * 何を見るか
 *   A. 法務・配布       LICENSE / .gitignore / dependabot / 手引き
 *   B. セキュリティ     CSP・秘密情報の直書き・localStorage.clear()
 *   D. 表示             dvh / safe-area / clamp / 印刷 / reduced-motion
 *   E. PWA              manifest の絶対パス・アイコン・SW の作法・APP_VERSION
 *   F. 性能             1ファイルの大きさ・初回に読む JS の量・画像の重さ
 *
 * 検査を ゆるめる のではなく、事情があるものは quality.config.json の
 * securityExceptions / notApplicable に理由を書いて明示的に許可する。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));

const results = [];
const ok    = (id, label, detail = '') => results.push({ id, label, detail, level: 'ok' });
const warn  = (id, label, detail = '') => results.push({ id, label, detail, level: 'warn' });
const fail  = (id, label, detail = '') => results.push({ id, label, detail, level: 'fail' });
const skip  = (id, label, detail = '') => results.push({ id, label, detail, level: 'skip' });

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has  = (p) => existsSync(join(ROOT, p));
const size = (p) => statSync(join(ROOT, p)).size;
const kb   = (n) => (n / 1024).toFixed(1) + 'KB';

const allowed = new Set((cfg.securityExceptions || []).map((e) => e.rule));
const skipped = new Set((cfg.notApplicable || []).map((e) => e.check));

/** リポジトリの中のファイルを あつめる（node_modules・.git・fonts は のぞく） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.assets-original', 'fonts'].includes(name.name)) continue;
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((p) => relative(ROOT, p));

/* 自分たちが書いたコードだけを 中身の検査の対象にする。
   ・scripts/ … この検査スクリプト自身。禁止パターンの正規表現を持っているので
                そのまま数えると いつも自分に ひっかかる
   ・vendor/  … 同梱の第三者ライブラリ（QuaggaJS）。書きかえない前提のもの
   大きさの検査（F4）は vendor も含めて見るので、別のリストを使う。 */
const isOurs = (f) => !f.startsWith('scripts' + sep) && !f.startsWith('vendor' + sep);
const codeLike = (f) => /\.(js|mjs|jsx|gs|html|css)$/.test(f);
const sources = files.filter((f) => codeLike(f) && isOurs(f));
const sourcesAll = files.filter(codeLike);

/** 行コメント・ブロックコメントを のぞいた 中身を返す。
 *  「localStorage.clear() は つかわない」のような 注意書きの日本語コメントを
 *  違反として数えてしまわないため。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n');
}

/* ============================================================
   A. 法務・配布
   ============================================================ */
for (const f of cfg.requiredFiles) {
  has(f) ? ok('A', `${f} がある`) : fail('A', `${f} がない`);
}

/* ============================================================
   B. セキュリティ
   ============================================================ */
const html = read(cfg.entry);

// B1 CSP
const cspMatch = html.match(/http-equiv=["']Content-Security-Policy["'][^>]*content=["']([\s\S]*?)["']\s*>/i);
if (!cspMatch) {
  fail('B1', 'CSP が入っていない');
} else {
  const csp = cspMatch[1].replace(/\s+/g, ' ').trim();
  const dir = (name) => {
    const m = csp.match(new RegExp(name + '\\s+([^;]+)'));
    return m ? m[1].trim().split(/\s+/) : null;
  };

  const connect = dir('connect-src') || [];
  const extras = connect.filter((v) => v !== "'self'" && !cfg.connectSrcAllowed.includes(v));
  if (connect.some((v) => v.includes('*'))) fail('B1', 'connect-src にワイルドカードがある', connect.join(' '));
  else if (extras.length) fail('B1', 'connect-src に想定外の宛先がある', extras.join(' '));
  else ok('B1', 'connect-src が最小', connect.join(' '));

  const script = dir('script-src') || [];
  if (script.includes("'unsafe-inline'")) fail('B1', "script-src に 'unsafe-inline' がある");
  else if (script.includes("'unsafe-eval'")) fail('B1', "script-src に 'unsafe-eval' がある");
  else ok('B1', "script-src が厳格", script.join(' '));

  const style = dir('style-src') || [];
  if (style.includes("'unsafe-inline'")) {
    allowed.has('csp-style-src-unsafe-inline')
      ? skip('B1', "style-src の 'unsafe-inline' は理由つきで許可済み")
      : fail('B1', "style-src に 'unsafe-inline' がある");
  } else ok('B1', 'style-src が厳格');

  if (!/frame-ancestors/.test(csp)) {
    allowed.has('csp-meta-frame-ancestors-missing')
      ? skip('B1', 'frame-ancestors 不在は理由つきで許可済み')
      : warn('B1', 'frame-ancestors がない');
  } else ok('B1', 'frame-ancestors がある');

  for (const d of ['default-src', 'object-src', 'base-uri']) {
    dir(d) ? ok('B1', `${d} がある`) : warn('B1', `${d} がない`);
  }
}

// B2 秘密情報・外部CDN
const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API キーらしき文字列'],
  [/AKIA[0-9A-Z]{16}/, 'AWS アクセスキーらしき文字列'],
  [/\b1[A-Za-z0-9_-]{43}\b/, 'スプレッドシートIDらしき文字列'],
  [/[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'メールアドレス']
];
let secretHits = 0;
for (const f of sources) {
  const text = read(f);
  text.split('\n').forEach((line, i) => {
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(line)) { fail('B2', `${label}（値は出しません）`, `${f}:${i + 1}`); secretHits++; }
    }
  });
}
if (!secretHits) ok('B2', '秘密情報の直書きなし');

const cdnHits = [];
for (const f of sources) {
  const text = read(f);
  const m = text.match(/https:\/\/(cdn|unpkg|jsdelivr|cdnjs|ajax\.googleapis|fonts\.googleapis|fonts\.gstatic)[^\s"')]*/g);
  if (m) cdnHits.push(`${f}: ${m[0]}`);
}
cdnHits.length ? fail('B2', '外部 CDN を参照している（A型は自己ホスト）', cdnHits.join(' / '))
               : ok('B2', '外部 CDN 依存なし');

// B3 localStorage.clear()
const clearHits = sources.filter((f) => /localStorage\s*\.\s*clear\s*\(/.test(stripComments(read(f))));
clearHits.length ? fail('B3', 'localStorage.clear() を使っている', clearHits.join(' '))
                 : ok('B3', 'localStorage.clear() を使っていない');

// B4 postMessage(..., '*')
const pmHits = sources.filter((f) => /postMessage\s*\([^)]*,\s*['"]\*['"]/.test(stripComments(read(f))));
pmHits.length ? fail('B4', "postMessage の宛先が '*'", pmHits.join(' '))
              : ok('B4', "postMessage の宛先が '*' でない");

/* ============================================================
   D. 表示
   ============================================================ */
const css = sources.filter((f) => f.endsWith('.css')).map((f) => read(f)).join('\n');
const allStyle = css + html;

/^[\s\S]*viewport-fit=cover/.test(html) ? ok('D1', 'viewport に viewport-fit=cover')
                                        : fail('D1', 'viewport-fit=cover がない');

if (/100vh/.test(allStyle) && !/100dvh/.test(allStyle)) fail('D2', '100vh を dvh なしで使っている');
else if (/100dvh/.test(allStyle)) ok('D2', '100dvh を使っている');
else warn('D2', '高さ指定に vh/dvh が見あたらない');

/safe-area-inset/.test(allStyle) ? ok('D3', 'safe-area-inset を適用') : fail('D3', 'safe-area-inset がない');

/* D8 コントラスト。
   css/style.css の :root からトークンの値を読んで、
   実際に「文字として」使う組み合わせだけを計算する。
   Chromebook の液晶は視野角もコントラストも弱いので、
   うすい灰色は ななめから見るとほとんど読めない。 */
if (cfg.contrast) {
  const tokens = {};
  for (const m of allStyle.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    if (!(m[1] in tokens)) tokens[m[1]] = m[2];
  }
  const rgbOf = (h) => {
    h = h.replace('#', '');
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => {
    const l1 = lum(rgbOf(a)), l2 = lum(rgbOf(b));
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };

  const min = cfg.contrast.minRatio ?? 4.5;
  let worstName = null, worstVal = Infinity;
  let missing = 0;

  for (const fgName of cfg.contrast.textTokens || []) {
    for (const bgName of cfg.contrast.backgrounds || []) {
      const fg = tokens[fgName], bg = tokens[bgName];
      if (!fg || !bg) { missing++; continue; }
      const r = ratio(fg, bg);
      if (r < min) fail('D8', `${fgName} を ${bgName} にのせると読めない`, `${fg} on ${bg} = ${r.toFixed(2)}:1（要 ${min}）`);
      if (r < worstVal) { worstVal = r; worstName = `${fgName} on ${bgName}`; }
    }
  }
  for (const p of cfg.contrast.pairs || []) {
    const fg = tokens[p.fg], bg = tokens[p.bg];
    if (!fg || !bg) { missing++; continue; }
    const r = ratio(fg, bg);
    const need = p.min ?? min;
    if (r < need) fail('D8', `${p.note || p.fg + ' on ' + p.bg} が読めない`, `${fg} on ${bg} = ${r.toFixed(2)}:1（要 ${need}）`);
    if (r < worstVal) { worstVal = r; worstName = p.note || `${p.fg} on ${p.bg}`; }
  }

  if (missing) warn('D8', `トークンを ${missing} 組ぶん 見つけられなかった`, 'quality.config.json の名前を確かめてください');

  // まとめの1行。足りていない組み合わせが1つでもあるときに ✅ を出すと
  // 「いちばん きびしいところが 2.11 なのに合格」に見えてしまうので、
  // そのときは この行を出さない（上に ❌ が並んでいる）。
  const anyContrastFail = results.some((r) => r.id === 'D8' && r.level === 'fail');
  if (worstName && !anyContrastFail) {
    ok('D8', 'コントラスト（いちばん きびしい組み合わせ）', `${worstName} = ${worstVal.toFixed(2)}:1`);
  }
}
/clamp\(/.test(allStyle) ? ok('D4', 'clamp() による fluid type') : fail('D4', 'clamp() を使っていない');

// D5 Canvas の DPR 補正
const canvasFiles = sources.filter((f) => /getContext\(\s*['"]2d['"]\s*\)/.test(read(f)));
if (!canvasFiles.length) skip('D5', 'Canvas を使っていない');
else {
  const bad = canvasFiles.filter((f) => !/devicePixelRatio/.test(read(f)));
  bad.length ? fail('D5', 'Canvas に devicePixelRatio 補正がない', bad.join(' '))
             : ok('D5', 'Canvas に devicePixelRatio 補正がある');
  const capped = canvasFiles.some((f) => /Math\.min\([^)]*devicePixelRatio[^)]*\)|Math\.min\(\s*window\.devicePixelRatio[^)]*\)/.test(read(f)));
  capped ? ok('D5', 'dpr の上限をつけている') : warn('D5', 'dpr に上限（2）をつけていない');
}

/@media\s+print/.test(allStyle) ? ok('D12', '印刷 CSS がある') : fail('D12', '印刷 CSS がない');
/prefers-reduced-motion/.test(allStyle) ? ok('D10', 'prefers-reduced-motion 対応') : fail('D10', 'prefers-reduced-motion がない');
/forced-colors/.test(allStyle) ? ok('D8', 'ハイコントラスト対応') : warn('D8', 'forced-colors 対応がない');
/touch-action/.test(allStyle) ? ok('D9', 'touch-action を指定') : fail('D9', 'touch-action がない');

if (skipped.has('presentation-mode')) skip('D11', '提示モードは対象外');
else if (/\.presentation/.test(allStyle)) ok('D11', '提示モードがある');
else warn('D11', '提示モードがない');

/* ============================================================
   E. PWA
   ============================================================ */
const mf = JSON.parse(read(cfg.manifest));
/* 公開の置き場所。専用ドメインの直下なら "/"、
   gigayama.github.io のような共有オリジンなら "/リポジトリ名/"。 */
const wantPrefix = cfg.basePath || ('/' + cfg.repoName + '/');
for (const key of ['id', 'scope', 'start_url']) {
  const v = String(mf[key] || '');
  v.startsWith(wantPrefix) ? ok('E1', `manifest.${key} が絶対パス`, v)
                           : fail('E1', `manifest.${key} が ${wantPrefix} から始まる絶対パスでない`, v || '(未設定)');
}
const purposes = (mf.icons || []).map((i) => `${i.sizes}:${i.purpose || 'any'}`);
for (const need of ['192x192:any', '512x512:any', '192x192:maskable', '512x512:maskable']) {
  purposes.includes(need) ? ok('E2', `アイコン ${need}`) : fail('E2', `アイコン ${need} がない`);
}
/apple-touch-icon/.test(html) ? ok('E2', 'apple-touch-icon がある') : fail('E2', 'apple-touch-icon がない');

// E3 beforeinstallprompt を head の最上部で
const scriptTags = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)];
const earlyIdx = html.indexOf('<script');
const headEnd = html.indexOf('</head>');
const earlyFile = scriptTags.length ? scriptTags[0][1] : null;
if (earlyFile && has(earlyFile) && /beforeinstallprompt/.test(read(earlyFile)) && earlyIdx < headEnd) {
  ok('E3', 'beforeinstallprompt を head 最上部で捕捉', earlyFile);
} else if (/beforeinstallprompt/.test(html) && earlyIdx < headEnd) {
  ok('E3', 'beforeinstallprompt を head で捕捉');
} else {
  fail('E3', 'beforeinstallprompt を head 最上部で捕捉していない');
}

// E5-E7 sw.js の作法
const sw = read(cfg.serviceWorker);
if (/caches\.keys\(\)/.test(sw)) {
  /startsWith\(\s*CACHE_PREFIX|key\.startsWith\(/.test(sw)
    ? ok('E5', 'sw が自アプリ接頭辞のキャッシュのみ削除')
    : fail('E5', 'sw が全キャッシュを削除している（他アプリを壊す）');
} else ok('E5', 'sw がキャッシュ全削除をしていない');

sw.split('\n').some((l) => /localStorage/.test(l) && !/^\s*[*/]/.test(l))
  ? fail('E6', 'sw が localStorage に触れている')
  : ok('E6', 'sw が localStorage に触れていない');

/Content-Encoding|content-encoding/.test(sw)
  ? ok('E6', 'sw がキャッシュ前に Content-Encoding を落としている')
  : warn('E6', 'sw が Content-Encoding を落としていない（圏外で起動しなくなる原因）');

/あたらしい|新しいバージョン|SKIP_WAITING/.test(sources.map(read).join('\n'))
  ? ok('E7', '更新通知のしくみがある')
  : fail('E7', '更新通知がない');

// E9 sw.js の版が自動生成されている
// かつては sw.js と js/app.js の APP_VERSION 一致を見ていたが、手書きの版は
// 2026-08-21 に全リポジトリで同時に上げ忘れる事故を起こした。いまは
// tools/build-sw.mjs が先読み対象の中身から版を作る（CI の --check がずれを止める）。
// js/app.js の APP_VERSION は児童向け表示とエクスポートの記録用で、別物として残る。
const swVersionLine = read('sw.js').match(/const APP_VERSION = '([^']*)'; \/\* __APP_VERSION__ \*\//);
if (has('tools/build-sw.mjs') && swVersionLine
    && swVersionLine[1] !== 'v0' && swVersionLine[1] !== 'dev') {
  ok('E9', 'SW の版が自動生成の形', swVersionLine[1]);
} else {
  fail('E9', 'sw.js の版が自動生成の形（__APP_VERSION__ の目印つき・tools/build-sw.mjs あり）になっていない');
}

/* ============================================================
   F. 性能
   ============================================================ */
const L = cfg.sizeLimits;
for (const f of files.filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))) {
  const n = size(f);
  let limit = L.imageBytes;
  if (/icon-512|icon-maskable-512/.test(f)) limit = L.iconMaskableBytes;
  else if (/favicon/.test(f)) limit = L.faviconBytes;
  n > limit ? fail('F3', `${f} が大きい`, `${kb(n)} > ${kb(limit)}`)
            : ok('F3', `${f}`, kb(n));
}

for (const f of sourcesAll) {
  const n = size(f);
  const lines = read(f).split('\n').length;
  if (n > L.sourceFileBytes) fail('F4', `${f} が 400KB を超えている`, kb(n));
  else if (lines > L.sourceFileLines) fail('F4', `${f} が 5,000行を超えている`, lines + '行');
}
ok('F4', '1ファイルの大きさは上限内');

// 初回に読む JS の合計
const firstLoad = scriptTags.map((m) => m[1]).filter((p) => has(p));
const firstLoadBytes = firstLoad.reduce((a, p) => a + size(p), 0);
firstLoadBytes > L.firstLoadScriptBytes
  ? fail('F3', '初回に読む JS が 300KB を超えている', kb(firstLoadBytes))
  : ok('F3', '初回に読む JS', `${kb(firstLoadBytes)}（${firstLoad.join(', ')}）`);

/* ============================================================
   結果
   ============================================================ */
const icon = { ok: '✅', warn: '⚠️ ', fail: '❌', skip: '－' };
const order = ['fail', 'warn', 'skip', 'ok'];
const fails = results.filter((r) => r.level === 'fail');
const warns = results.filter((r) => r.level === 'warn');

console.log(`\nGIGA Standard v4 品質ゲート — ${cfg.appName}\n`);
for (const level of order) {
  const rows = results.filter((r) => r.level === level);
  if (!rows.length) continue;
  for (const r of rows) {
    console.log(`${icon[r.level]} [${r.id}] ${r.label}${r.detail ? '  — ' + r.detail : ''}`);
  }
  console.log('');
}
console.log(`合計 ${results.length}件： ❌ ${fails.length} ／ ⚠️ ${warns.length} ／ － ${results.filter(r=>r.level==='skip').length} ／ ✅ ${results.filter(r=>r.level==='ok').length}`);

if (fails.length) {
  console.log('\n❌ があります。検査をゆるめるのではなく、直すか、');
  console.log('   quality.config.json の securityExceptions に理由を書いて明示的に許可してください。');
  process.exit(1);
}
console.log('\n合格');
