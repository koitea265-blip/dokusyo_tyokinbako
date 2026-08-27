/*!
 * studyLog.js — 学習ログ共通スキーマ `study.v1` 保存モジュール
 *
 *   ロジック版 : 1.1                （仕様書 §5.1.2 の参照実装と同一）
 *   配布形態   : グローバル（IIFE） （仕様書 §5.1.1）
 *   仕様書     : 学習ログ共通スキーマ仕様書 study.v1 / 1.9
 *
 * このファイルは GIGA山 学習アプリ群で共通・不変の層である。
 * ロジック本体を各アプリで書き換えてはならない。改訂したら全アプリへ配り直すこと。
 *
 * 保存のみを行い、外部送信は一切行わない。
 * 保存先キー `study.records.v1` は複数アプリ共通の学習ログであり、
 * このアプリ専用のキーではない。リセット処理やクリーンアップの対象に含めないこと。
 */
(function (global) {
  'use strict';

  var STUDY_LOG_KEY = 'study.records.v1';
  var STUDY_LOG_MAX = 500;
  var STUDY_ITEMS_MAX = 200;

  var uuid = function () {
    return global.crypto && global.crypto.randomUUID
      ? global.crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  };

  var sanitizeWrong = function (v) {
    return typeof v === 'string' && v.length <= 12 && !/[<>{}\\]/.test(v) ? v : null;
  };

  function saveStudyRecord(rec) {
    try {
      // 必須項目の検証
      if (!rec || !rec.appId || !rec.unit || !rec.unit.id) return null;
      if (typeof rec.elapsedMs !== 'number' || rec.elapsedMs < 0) return null;
      if (!rec.summary || typeof rec.summary.count !== 'number') return null;

      var items = Array.isArray(rec.items)
        ? rec.items.slice(0, STUDY_ITEMS_MAX).map(function (it) {
            var out = {};
            for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) out[k] = it[k];
            out.wrong = Array.isArray(it.wrong)
              ? it.wrong.map(sanitizeWrong).filter(Boolean)
              : undefined;
            return out;
          })
        : undefined;

      var entry = {
        schema: 'study.v1',
        id: uuid(),
        kind: 'session',
        source: 'course',
        multiplayer: false,
        grading: 'objective',
        status: 'completed',
        timeBasis: 'app'
      };
      for (var key in rec) if (Object.prototype.hasOwnProperty.call(rec, key)) entry[key] = rec[key];
      entry.items = items;
      entry.elapsedMs = Math.round(rec.elapsedMs);

      // 保存済みログの読み出し。
      // 中身が壊れている（JSON として読めない／配列でない）場合は空からやり直す。
      // ここで外側の catch に流すと、一度壊れた端末は以降ずっと1件も保存できなくなる。
      var raw = localStorage.getItem(STUDY_LOG_KEY);
      var log = [];
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) log = parsed;
        } catch (e) { /* 壊れていた → 空からやり直す */ }
      }

      log.push(entry);
      if (log.length > STUDY_LOG_MAX) log.splice(0, log.length - STUDY_LOG_MAX);
      localStorage.setItem(STUDY_LOG_KEY, JSON.stringify(log));
      return entry.id;
    } catch (e) {
      // 保存失敗はアプリの動作を妨げない
      console.warn('[studyLog] save failed', e);
      return null;
    }
  }

  global.StudyLog = {
    LOGIC_VERSION: '1.1',
    KEY: STUDY_LOG_KEY,
    MAX_RECORDS: STUDY_LOG_MAX,
    MAX_ITEMS: STUDY_ITEMS_MAX,
    saveStudyRecord: saveStudyRecord
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
