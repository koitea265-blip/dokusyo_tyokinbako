/*!
 * offline.html の「もういちど ためす」ボタン。
 * CSP で onclick のじか書きを禁じているので、外部ファイルから付ける。
 */
(function () {
  'use strict';

  var btn = document.getElementById('retry');
  if (btn) {
    btn.addEventListener('click', function () {
      // アプリのトップへ もどす。つながっていれば そのまま起動する。
      location.replace('./');
    });
  }

  // つながった しゅんかんに じどうで もどる
  window.addEventListener('online', function () { location.replace('./'); });
})();
