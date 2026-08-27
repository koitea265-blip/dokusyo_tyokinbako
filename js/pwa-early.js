/*!
 * どくしょ ちょきんばこ — インストールの合図を いちばん先に うけとる
 *
 * Chrome は条件がそろうと、ページの読み込みの ごく早い段階で
 * beforeinstallprompt を1回だけ出す。アプリ本体（js/app.js）は
 * 画面の HTML より後ろで読むため、そこで待っていると
 * 通信のおそい端末で合図を取りこぼし、「インストール」ボタンが
 * 出なくなることがあった。
 *
 * そこで、このファイルだけを <head> のいちばん上で読み、
 * 受け取ったイベントを window に ためておく。
 * アプリ本体は起動時に window.__deferredInstallPrompt を見るか、
 * pwa-installable / pwa-installed を待てばよい。
 */
(function () {
  'use strict';

  window.__deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__deferredInstallPrompt = e;
    window.dispatchEvent(new Event('pwa-installable'));
  });

  window.addEventListener('appinstalled', function () {
    window.__deferredInstallPrompt = null;
    window.dispatchEvent(new Event('pwa-installed'));
  });

  /* Web フォントは自己ホストしているので、ここでは何も読み込まない。
     CSS 側の font-display:swap により、読み込み中も文字は消えない。 */

  /* ほかのサイトに iframe で はめこまれていないか みはる。
     CSP の frame-ancestors は <meta> では効かず、GitHub Pages は
     X-Frame-Options ヘッダーを足せないため、ここで自分で見る。
     はめこまれていたら、いちばん外の窓を このアプリに つけかえる
     （クリックジャッキング対策）。 */
  try {
    if (window.top !== window.self) window.top.location = window.self.location;
  } catch (e) {
    /* 別オリジンから はめこまれていて 参照できない場合は、
       せめて 中身を 出さない。 */
    document.documentElement.style.display = 'none';
  }
})();
