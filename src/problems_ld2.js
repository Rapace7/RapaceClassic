/* 死活题（第二版）
 *
 * ★ 2026-09-28 旧题库归档说明：
 *   本文件此前的全部题目已整体归档到 archive/problems_v1_20260928/。
 *   用户实测「随机抽题基本都是没啥意义的题」，故整体重写。
 *   按「方案 A」重建：题目来源可溯源，**每题讲解由人逐题手写**
 *   （程序只做事实核算，见 tools/tsumego_facts.js）。
 *
 * 新题在此加入。
 *
 * 本文件现在只做一件事：把新题 push 进 PROBLEMS。暂无内容。
 */
(function (global) {
  'use strict';
  var PROBLEMS = (typeof module !== 'undefined' && module.exports)
    ? (function () { try { return require('./problems.js'); } catch (e) { return null; } })()
    : global.PROBLEMS;
  if (!PROBLEMS) return;

  // 新题在此处加入（每题必须经 tools/tsumego_facts.js 核算事实 + 人工手写讲解）

  if (typeof module !== 'undefined' && module.exports) module.exports = PROBLEMS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
