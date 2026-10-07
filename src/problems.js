/* 题库 —— 全部由引擎验证答案正确性（见 verify_problems.js）
   kind: 'board'    = 在棋盘上点选位置（单步题）
         'choice'   = 选择选项
         'sequence' = 多步题（见下）

   ============ 单步题（kind:'board' / 'choice'）============
   每道题的教学结构：
     goal        这题练什么
     steps       答题前的分步引导（点「提示」逐条揭示，不直接给答案）
     solution    完整推理链（答完后展开）
     traps       常见错误走法及后果
     principle   可迁移到别的局面的通用道理
     era         时代背景（来源年代 / AI 时代的评价）

   check.type（供自动验证）:
     capture / atari / double-atari / legal / illegal / eye / count / score 等

   ============ 多步题（kind:'sequence'）· 2026-09-28 新增 ============
   用户要求（原话）：
     「你搞那种交互式题目嘛，就是用户下了一手后，系统会跟随再下一手，
       然后继续考用户的题，这种多步之间的题，你可以在题库里预制的准备好」
     「预制好的，如果我落到正确位置，系统才进行预设的落子，
       然后继续判断用户是否正确落子继续推进」

   交互模型 = **主线复演**：
     · 题里内置一条正解主线 plan（古谱原解），按 [谁走, 落点] 交替排列。
     · 用户轮到自己时落一手；落对 → 系统立刻走出 plan 里的下一手（自动）；
       落错 → 立刻停下，提示这手不行 + 说明后果，让用户再想（或看详解）。
     · 一直推进到 plan 走完 = 通关。

   字段：
     kind: 'sequence'
     toMove    用户执什么颜色（'b' / 'w'）
     plan      正解主线，数组，每项 [x, y]（仅落点；先后手由 toMove 与次序推出）
               —— 偶数下标 = 用户走，奇数下标 = 系统走
     stepNotes 与 plan 等长的逐步讲解：stepNotes[k] = 「第 k 手为什么这么走」
     wrongAt   {'x,y': '这手为什么不行'}  常见错手 → 后果（手写，非生成）
     result    'kill' | 'live' | 'capture' ...  这题最终的胜负形态（用于措辞）
     ★ 与单步题共用：ask / goal / steps / solution / traps / principle / era /
       src（溯源）/ stones / size

   ★ 2026-09-28 重写说明：
     旧题库 374 题（11 个文件）已整体归档到 archive/problems_v1_20260928/ ——
     用户实测「随机抽题基本都是没啥意义的题」。
     按「方案 A」重建：题目来源可溯源（经典死活题库 SGF / 真实对局切片），
     **每题的讲解由人逐题手写**，程序只做事实核算（tools/tsumego_facts.js）。
     归档的旧题**不删除**，保留在 archive/ 下备查。
*/
(function (global) {
  'use strict';

  var PROBLEMS = [
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = PROBLEMS;
  else global.PROBLEMS = PROBLEMS;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
