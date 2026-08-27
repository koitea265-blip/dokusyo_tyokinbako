/*
 * どくしょ ちょきんばこ — Service Worker
 *
 * 【重要】activate では自アプリ以外のキャッシュを削除しない。
 *   （学習ログ共通スキーマ仕様書 study.v1 §1.2 禁止事項）
 *   いまは reading-books.giga-school.com の専用ドメインだが、
 *   共有オリジン（gigayama.github.io）へ戻す・持っていく場合にそなえて、
 *   CACHE_PREFIX で始まるキャッシュだけを掃除する作法は変えない。
 *
 * また Service Worker は localStorage を操作しない。
 * `study.records.v1` を含む学習データに一切触れない。
 */

const CACHE_PREFIX = 'reading-books-';
// APP_VERSION は tools/build-sw.mjs が先読み対象の中身から自動生成する。手で書き換えない。
const APP_VERSION = 'vad0a2e0e'; /* __APP_VERSION__ */
const CACHE_STATIC = CACHE_PREFIX + 'static-' + APP_VERSION;
const CACHE_RUNTIME = CACHE_PREFIX + 'runtime-v1';

/* アプリシェル。オフラインでも起動できるように必ず先読みする。
 *
 * fonts/ の woff2（244ファイル・4.6MB）は、ここには入れない。
 * unicode-range ごとに分かれていて、画面に出た文字のぶんだけ読まれる。
 * 一度読まれたものは下の staleWhileRevalidate がキャッシュするので、
 * 2回目からはオフラインでも同じ字体で出る。
 * 全部先読みすると 校内Wi-Fi で 40人ぶんの 4.6MB が一斉に流れてしまう。
 */
const PRECACHE_URLS = [
  './',
  './index.html',
  './offline.html',
  './css/style.css',
  './css/offline.css',
  './js/pwa-early.js',
  './js/app.js',
  './js/offline.js',
  './studyLog.js',
  './records-export.html',
  './js/records-export.js',
  './js/records-hub-client.js',
  './manifest.json',
  './vendor/quagga.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-64.png'
];

/* 書誌データの取得はキャッシュしない（毎回ネットワークへ通す） */
const BYPASS_HOSTS = [
  'api.openbd.jp',
  'www.googleapis.com',
  'ndlsearch.ndl.go.jp'
];

/* Web フォントは stale-while-revalidate で持っておく */
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/**
 * キャッシュに しまう前に 返事を 作りなおす。
 *
 * 【なぜ必要か】
 * サーバー（GitHub Pages も含む）は HTML や JS を gzip / brotli で
 * 縮めて送ってくる。fetch はそれを もどしてから 中身をくれるが、
 * 「縮めてあります（Content-Encoding）」という ふだ だけは 返事に
 * のこったままになる。
 * その返事を そのまま Cache API に しまい、あとで オフライン時に
 * ページとして 返すと、ブラウザは ふだ を信じて もういちど
 * ほどこうとして 失敗し、まっ白な エラー画面になる。
 * （このアプリが「オフラインにすると 起動しない」原因は これだった）
 *
 * そこで、中身は そのまま・ふだ だけ はずして しまい直す。
 */
async function stripEncodingHeaders(res) {
  const headers = new Headers();
  res.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'content-encoding' || k === 'content-length' ||
        k === 'transfer-encoding' || k === 'content-disposition') return;
    headers.append(key, value);
  });
  const body = await res.clone().arrayBuffer();
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: headers
  });
}

/** 保存できる返事だけを キャッシュに しまう（失敗しても アプリは止めない） */
async function cacheSafely(cache, key, res) {
  try {
    if (!res || !res.ok || res.type === 'opaque') return;
    await cache.put(key, await stripEncodingHeaders(res));
  } catch (err) {
    console.warn('[sw] cache put skipped', key, err);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      // 1本でも失敗すると addAll 全体が落ちるため、個別に入れる
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (!res || !res.ok) throw new Error('status ' + (res && res.status));
            await cache.put(url, await stripEncodingHeaders(res));
          } catch (err) {
            console.warn('[sw] precache skipped', url, err);
          }
        })
      );
      // ここでは skipWaiting しない。児童が読んでいる最中に画面が突然
      // 入れ替わるのを避けるため、切り替えは画面側の「さいしんに する」から
      // SKIP_WAITING メッセージが届いたときだけ行う（下の message を参照）。
      // 以前はここで待たずに切り替えていたため、message 側の受け口も
      // 画面側の更新の案内も、一度も使われない死にコードになっていた。
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          // 自アプリのキャッシュだけを対象にする（他アプリのキャッシュには触れない）
          if (!key.startsWith(CACHE_PREFIX)) return undefined;
          if (key === CACHE_STATIC || key === CACHE_RUNTIME) return undefined;
          return caches.delete(key);
        })
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source && event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});

/** ネットワークへ取りにいく。指定の秒数で あきらめる。
 *
 *  fetch(request, { signal }) のように init を付けて呼ぶと、
 *  ページ遷移(navigate)のリクエストは仕様上 same-origin モードに
 *  作りかえられてしまう。ここでは request をそのまま渡し、
 *  待ち時間の打ち切りは Promise.race で行う。 */
function fetchWithTimeout(request, timeoutMs) {
  const net = fetch(request);
  if (!timeoutMs) return net;
  return Promise.race([
    net,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);
}

/** キャッシュしてある アプリ本体（なければ オフライン案内）を返す */
async function appShellFallback() {
  /* caches.match には 相対パスの「文字列」を渡す。
   *
   * cache.match(request) のように Request を渡すと、サーバーが返す
   * Vary: Accept-Encoding のせいで、先読みしたときと ページ遷移のときで
   * Accept-Encoding が ちがうと 一致しない ことがある。
   * それが原因で「オフラインにすると まったく起動しない」状態になっていた。 */
  return (
    (await caches.match('./index.html')) ||
    (await caches.match('./')) ||
    // アプリ本体すら取れないとき。アプリと同じ配色の案内ページを出す
    (await caches.match('./offline.html')) ||
    new Response('<h1>オフラインです</h1>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 503
    })
  );
}

/** キャッシュ優先＋裏で更新 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      // opaque（別ドメインの返事）は 中身を読めないので そのまま入れる
      if (res && res.type === 'opaque') cache.put(request, res.clone()).catch(() => {});
      else cacheSafely(cache, request, res);
      return res;
    })
    .catch(() => undefined);
  return cached || network || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (BYPASS_HOSTS.includes(url.hostname)) return; // 書誌 API は素通し

  // ページ遷移：ネットワーク優先。落ちたらキャッシュのアプリシェルを返す
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        // ① 先読み（navigation preload）の ぶんが 使えれば それを使う。
        //    圏外だと「中身のない、失敗した返事」が返ってくることがあり、
        //    それを そのまま画面に返すと ページが まっ白になる。
        //    ちゃんと ok なときだけ 使う。
        try {
          const preload = await event.preloadResponse;
          if (preload && preload.ok) {
            const cache = await caches.open(CACHE_STATIC);
            cacheSafely(cache, './index.html', preload);
            return preload;
          }
        } catch (err) { /* 圏外。②へ */ }

        // ② ネットワークへ（校内Wi-Fiが混んでいても 4秒で あきらめる）
        try {
          const res = await fetchWithTimeout(request, 4000);
          if (res && res.ok) {
            const cache = await caches.open(CACHE_STATIC);
            cacheSafely(cache, './index.html', res);
            return res;
          }
          // 404 などは そのまま見せる（サーバーは生きている）
          if (res && res.status < 500) return res;
        } catch (err) { /* 圏外・時間ぎれ。③へ */ }

        // ③ キャッシュしてある アプリ本体
        return appShellFallback();
      })()
    );
    return;
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, CACHE_RUNTIME));
    return;
  }

  // 同一オリジンの静的ファイル：キャッシュ優先＋裏で更新
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, CACHE_STATIC));
  }
});
