/* 象棋板块 · 入门课页面 —— 只依赖 xq-lessons.js（window.XQ_LESSONS）与 xq-board.js（window.XQBoard）
 *
 * 入口（由 xq-app.js 的路由调用，接线由作者统一做）：
 *   window.XQLessons.render(host, seg)
 *     seg  —— hash 的分段数组，**不含 'xq' 前缀**
 *             #/xq/lesson           → seg = ['lesson']        → 列表页
 *             #/xq/lesson/<课号>     → seg = ['lesson','xq-l03'] → 详情页
 *     host —— 容器元素（app.js 里的 #app）
 *
 * 列表页：按 part 分组，每组一个 .part-title + 一个 .lesson-list，每课一个 .lesson-item 按钮。
 * 详情页：标题 + lede → 盘面演示（静态，interactive:false，不接收点击）→ 各小节 → 上一课/下一课。
 *   到头的那一侧渲染成 <button disabled>（.btn:disabled 有 opacity:.38 的置灰样式），
 *   既不是死链、也点不动。
 *
 * 关于样式：本项目不许改 style.css，只复用全站现成的类：
 *   .lesson-head(.crumb/.lede) .part-title .lesson-list .lesson-item(.idx/.body/.t/.d/.go)
 *   .sec(.h3/p) .demo-wrap .board-shell .board-holder .board-say .btn(.ghost/:disabled) .lesson-nav
 *
 * 自验钩子：XQLessons._state = { page, total, byPart, id, index, hasDemo, pieces, marks, prev, next }
 *   纯给 CDP 自验脚本读，页面逻辑不依赖它。
 */
(function (global) {
  'use strict';

  /* 分组显示顺序：与 xq-lessons.js 里的 XQ_LESSON_PARTS 一致；数据里出现的新分组排在最后 */
  var PART_ORDER = ['认棋盘', '走子规则', '攻防入门', '开局要领', '基本战术'];

  /* 本模块挂出去的棋盘 view。重渲染前统一 destroy —— 否则每翻一课都会多留一个 resize 监听 */
  var alive = [];

  var XQLessons = {
    render: render,
    _state: { page: 'none' }
  };

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
      });
  }

  /* 正文里的 **粗体** → <b>，其余一律转义。数据里都是成对的 **，奇数段即加粗段。 */
  function rich(s) {
    var parts = String(s === null || s === undefined ? '' : s).split('**');
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      out += (i % 2 === 1) ? '<b>' + esc(parts[i]) + '</b>' : esc(parts[i]);
    }
    return out;
  }

  function killBoards() {
    for (var i = 0; i < alive.length; i++) { try { alive[i].destroy(); } catch (e) { } }
    alive = [];
  }

  function allLessons() { return global.XQ_LESSONS || []; }

  /* 按 part 分组，顺序按 PART_ORDER；数据里出现过的分组一个都不落 */
  function groupByPart(list) {
    var parts = [], i, k;
    for (i = 0; i < list.length; i++) if (parts.indexOf(list[i].part) < 0) parts.push(list[i].part);
    parts.sort(function (a, b) {
      var ia = PART_ORDER.indexOf(a), ib = PART_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var groups = [];
    for (i = 0; i < parts.length; i++) {
      var items = [];
      for (k = 0; k < list.length; k++) if (list[k].part === parts[i]) items.push(list[k]);
      groups.push({ part: parts[i], items: items });
    }
    return groups;
  }

  /* 每课在整份数据里的序号（1 起），列表与详情共用 —— 这样两边编号一致 */
  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  function countByPart(list) {
    var by = {};
    for (var i = 0; i < list.length; i++) by[list[i].part] = (by[list[i].part] || 0) + 1;
    return by;
  }

  /* ---------------- 列表页 ---------------- */

  function renderList(host, list, groups, byPart) {
    var html = '';
    html += '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/xq">象棋</a> · 入门课</div>' +
      '<h1>入门课</h1>' +
      '<p class="lede">一共 <b>' + list.length + '</b> 课，分五组：认棋盘、走子规则、攻防入门、开局要领、基本战术。' +
      '每课都配一张静态盘面图，图上标的蓝点就是这一课要讲的位置。' +
      '按顺序读效果最好 —— 前面的规则是后面战术的底子。</p></div>';

    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      html += '<div class="part-title" data-part="' + esc(grp.part) + '">' +
        esc(grp.part) + ' · ' + grp.items.length + ' 课</div>';
      html += '<div class="lesson-list" data-part="' + esc(grp.part) + '">';
      for (var i = 0; i < grp.items.length; i++) {
        var L = grp.items[i];
        var no = indexOf(list, L.id) + 1;
        html += '<button class="lesson-item" data-id="' + esc(L.id) + '" data-part="' + esc(L.part) + '"' +
          ' onclick="location.hash=\'#/xq/lesson/' + esc(L.id) + '\'">' +
          '<span class="idx">' + no + '</span>' +
          '<span class="body"><span class="t">' + esc(L.title) + '</span>' +
          '<span class="d">' + esc(L.lede) + '</span></span>' +
          '<span class="go">→</span></button>';
      }
      html += '</div>';
    }

    host.innerHTML = html;

    XQLessons._state = {
      page: 'list',
      total: list.length,
      byPart: byPart,
      groups: groups.length,
      id: null, index: -1, hasDemo: false, pieces: 0, marks: 0, prev: false, next: false
    };
  }

  /* ---------------- 详情页 ---------------- */

  function renderDetail(host, list, groups, byPart, idx) {
    var L = list[idx];
    var html = '';

    html += '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/xq/lesson">入门课</a> ／ ' + esc(L.part) + ' ／ 第 ' + (idx + 1) + ' 课</div>' +
      '<h1>' + esc(L.title) + '</h1>' +
      '<p class="lede">' + esc(L.lede) + '</p></div>';

    /* 盘面演示：静态图，不接点击。盘边默认带 A–I / 1–10 坐标，正文里说 B3、E5 时好对照。 */
    if (L.demo) {
      html += '<div class="demo-wrap"><div class="board-shell">' +
        '<div class="board-holder" style="max-width:430px;margin:0 auto">' +
        '<canvas id="xq-lesson-canvas"></canvas></div>' +
        '<div class="board-say">' + rich(L.demo.caption) + '</div>' +
        '</div></div>';
    }

    for (var i = 0; i < (L.sections || []).length; i++) {
      var s = L.sections[i];
      var ps = Array.isArray(s.p) ? s.p : [s.p];
      html += '<div class="sec"><h3>' + esc(s.h) + '</h3>';
      for (var j = 0; j < ps.length; j++) html += '<p>' + rich(ps[j]) + '</p>';
      html += '</div>';
    }

    /* 上一课 / 下一课：到头的一侧是 disabled 的按钮（置灰、点不动），不是空链接 */
    var hasPrev = idx > 0, hasNext = idx < list.length - 1;
    html += '<div class="lesson-nav">';
    html += '<button class="btn ghost" id="xq-lesson-prev"' +
      (hasPrev ? ' onclick="location.hash=\'#/xq/lesson/' + esc(list[idx - 1].id) + '\'"' : ' disabled') +
      '>← 上一课</button>';
    html += '<button class="btn" id="xq-lesson-next"' +
      (hasNext ? ' onclick="location.hash=\'#/xq/lesson/' + esc(list[idx + 1].id) + '\'"' : ' disabled') +
      '>下一课 →</button>';
    html += '</div>';

    host.innerHTML = html;

    /* 棋盘：数据里的 [x, y, color, type] 与 xq-board 的 setPieces 完全一致；
       marks 转成引擎下标后交给 setHints（空点画蓝点、有子的点画蓝圈）。 */
    var view = null, markN = 0;
    var canvas = el('xq-lesson-canvas');
    if (canvas && global.XQBoard && L.demo) {
      view = global.XQBoard.mount(canvas, { interactive: false, side: 'r', showLabels: true });
      alive.push(view);
      view.setPieces(L.demo.pieces);
      var marks = (L.demo.marks || []).map(function (m) { return m[1] * 9 + m[0]; });
      markN = marks.length;
      if (markN) view.setHints(marks);
    }

    XQLessons._state = {
      page: 'lesson',
      total: list.length,
      byPart: byPart,
      groups: groups.length,
      id: L.id,
      index: idx,
      hasDemo: !!L.demo,
      pieces: L.demo ? (L.demo.pieces || []).length : 0,
      marks: markN,
      prev: hasPrev,
      next: hasNext
    };
  }

  /* ---------------- 入口 ---------------- */

  function render(host, seg) {
    killBoards();

    host = host || el('app');
    seg = seg || [];

    /* 容错：seg 可能是 ['lesson', id]，也可能带上 'xq' 前缀 */
    var parts = seg.slice(0);
    while (parts.length && parts[0] === 'xq') parts.shift();
    if (parts[0] !== 'lesson') parts.unshift('lesson');
    var raw = parts[1] || '';
    var id = '';
    if (raw) { try { id = decodeURIComponent(String(raw)); } catch (e) { id = String(raw); } }

    var list = allLessons();
    if (!list.length) {
      /* 数据没挂上来（打包时漏了 xq-lessons.js 之类）—— 说清楚，不给空页面 */
      host.innerHTML = '<div class="lesson-head">' +
        '<div class="crumb"><a href="#/xq">象棋</a> · 入门课</div>' +
        '<h1>入门课</h1></div>' +
        '<div class="card"><h3 style="margin-top:0">课程没加载出来</h3>' +
        '<p>页面里找不到 XQ_LESSONS —— 大概是打包时漏了 xq-lessons.js。这一条请报给作者。</p>' +
        '<p class="small muted" style="margin-bottom:0">可以先去看' +
        '<a href="#/xq/rules">规则速查</a>或<a href="#/xq/endgame">残局练习</a>。</p></div>';
      XQLessons._state = {
        page: 'empty', total: 0, byPart: {}, groups: 0,
        id: null, index: -1, hasDemo: false, pieces: 0, marks: 0, prev: false, next: false
      };
      return;
    }

    var groups = groupByPart(list);
    var byPart = countByPart(list);

    if (!id) return renderList(host, list, groups, byPart);

    var idx = indexOf(list, id);
    /* 课号不认识（手打 hash、旧链接）→ 回列表页，不停在空白页 */
    if (idx < 0) return renderList(host, list, groups, byPart);

    return renderDetail(host, list, groups, byPart, idx);
  }

  global.XQLessons = XQLessons;

})(typeof window !== 'undefined' ? window : this);
