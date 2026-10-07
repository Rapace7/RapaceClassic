/* 象棋板块 · 开局体系页面 —— 只依赖 xq-opening.js（window.XQ_OPENINGS）、
 * xq-engine.js（window.XQ）与 xq-board.js（window.XQBoard）。
 *
 * 入口（由 xq-app.js 的路由调用，接线由作者统一做）：
 *   window.XQOpening.render(host, seg)
 *     seg  —— hash 的分段数组，**不含 'xq' 前缀**
 *             #/xq/opening            → seg = ['opening']
 *             #/xq/opening/<id>       → seg = ['opening', 'xq-o01']
 *     host —— 容器元素（app.js 里的 #app）
 *
 * 页面：
 *   列表页  按 cat（炮类 / 马类 / 兵类 / 相类 / 其他）分组，每个开局一张卡：
 *           名称 + 一句话主旨 + 难度。
 *   详情页  一张不接点击的棋盘（interactive:false，只演示）+「下一手 / 上一手 / 从头开始」
 *           步进：从标准开局红先走起，每走一手在棋盘上高亮该手的起点（虚圈）与落点（绿圈），
 *           并在棋盘下方用 XQ.toLabel 把这一手念出来（如「红：H3 → E3」）。
 *           下面依次是 idea（主旨）/ points（为什么这么走）/ varies（常见变化），
 *           最后一排「上一局 / 下一局」按列表顺序跳，到头就置灰（不给死链）。
 *
 * ⚠ moves 虽已在数据侧由 tmpwork/_opening_lint.js 校验过，但页面**不信任**它 ——
 *   每一手仍真交给引擎 play()。万一数据坏了，页面会如实说「这一手走不出来」，不假装走过。
 *
 * 关于样式：本项目不许改 style.css，所以优先复用全站现成的类：
 *   .lesson-head(.crumb/.lede) .part-title .entry-grid .entry(.t/.d/.m) .pill(.wood/.gray)
 *   .card .row .spacer .btn(.ghost/.sm) .explain-block .principle .small .muted
 *   .demo-wrap .board-shell .board-holder .board-bar .board-say .step-dots(.on)
 *
 * 自验钩子：XQOpening._state = { page, total, byCat, id, step, steps, listIds, pos, prev, next, side, liveSig }
 *   纯给 CDP 自验脚本读数用（画布上的棋子没法从 DOM 里数），不影响界面行为。
 */
(function (global) {
  'use strict';

  var CAT_ORDER = ['炮类', '马类', '兵类', '相类', '其他'];
  var RED_CHAR = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' };
  var BLACK_CHAR = { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' };
  var LEVEL = { 1: '入门', 2: '进阶', 3: '高级' };

  var alive = [];          /* 本次渲染挂上的棋盘；重新渲染前统一销毁 */

  var XQOpening = {
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

  function allOpenings() { return global.XQ_OPENINGS || []; }

  function openingById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function mountBoard(canvas, opts) {
    var v = global.XQBoard.mount(canvas, opts);
    alive.push(v);
    return v;
  }

  function killAll() {
    for (var i = 0; i < alive.length; i++) { try { alive[i].destroy(); } catch (e) { } }
    alive = [];
  }

  function setState(s) { XQOpening._state = s; return s; }

  function levelName(n) { return LEVEL[n] || ('难度 ' + n); }

  /* ---------------- 小工具 ---------------- */

  function groupByCat(list) {
    var cats = [], i, k;
    for (i = 0; i < list.length; i++) if (cats.indexOf(list[i].cat) < 0) cats.push(list[i].cat);
    cats.sort(function (a, b) {
      var ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var groups = [];
    for (i = 0; i < cats.length; i++) {
      var items = [];
      for (k = 0; k < list.length; k++) if (list[k].cat === cats[i]) items.push(list[k]);
      groups.push({ cat: cats[i], items: items });
    }
    return groups;
  }

  function crumb(inner) {
    return '<div class="crumb"><a href="#/xq">象棋</a> · ' + inner + '</div>';
  }

  /* 盘面指纹：把所有子的 [x,y,color,type] 排序拼起来。
     自验脚本把「页面上真实摆着的盘面」与「引擎按数据独立重算的盘面」各算一次来比对。 */
  function signature(bd) {
    var XQ = global.XQ, out = [], i;
    for (i = 0; i < bd.n; i++) {
      if (bd.g[i] === 0) continue;
      out.push(i % 9 + ',' + ((i / 9) | 0) + ',' + (bd.g[i] === XQ.RED ? 'r' : 'b') + ',' + bd.t[i]);
    }
    out.sort();
    return out.join('|');
  }

  /* ---------------- 列表页 ---------------- */

  function renderList(host, list) {
    var html = '';
    html += '<div class="lesson-head">' + crumb('开局体系') +
      '<h1>开局体系</h1>' +
      '<p class="lede">收了 ' + list.length + ' 种常见开局，分四组：' +
      '<b>炮类</b>（中炮对屏风马、反宫马、顺炮、列炮、五七炮这些「先亮炮」的路子）、' +
      '<b>马类</b>（盘头马、起马局、边马局）、' +
      '<b>兵类</b>（仙人指路、两头蛇）、' +
      '<b>相类</b>（飞相局）。' +
      '每种都从标准开局红先走起，点进去可以一手一手看它是怎么摆成的，' +
      '每一步都报出走的哪个点（比如「红：H3 → E3」）。</p></div>';

    if (!list.length) {
      /* 数据没挂上来（打包漏了 xq-opening.js 之类）——说清楚，不给空页面 */
      html += '<div class="card"><h3 style="margin-top:0">开局库没加载出来</h3>' +
        '<p style="margin:8px 0 0">页面里找不到 XQ_OPENINGS —— 大概是打包时漏了 xq-opening.js。' +
        '这一条请报给作者。</p></div>';
      host.innerHTML = html;
      setState({ page: 'opening', total: 0, byCat: {} });
      return;
    }

    var groups = groupByCat(list), byCat = {}, i, k;
    html += '<div id="xq-op-list">';
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      byCat[g.cat] = g.items.length;
      html += '<div class="part-title" data-cat="' + esc(g.cat) + '">' + esc(g.cat) + ' · ' + g.items.length + ' 种</div>';
      html += '<div class="entry-grid" data-cat="' + esc(g.cat) + '">';
      for (k = 0; k < g.items.length; k++) {
        var o = g.items[k];
        var alias = (o.alias && o.alias.length)
          ? '<span class="small muted" style="font-weight:400">（又叫 ' + esc(o.alias[0]) + '）</span>' : '';
        html += '<button class="entry" data-opening-id="' + esc(o.id) + '"' +
          ' onclick="location.hash=\'#/xq/opening/' + esc(o.id) + '\'">' +
          '<div class="t">' + esc(o.name) + ' <span class="pill">' + esc(o.cat) + '</span>' +
          ' <span class="pill gray">' + esc(levelName(o.level)) + '</span></div>' +
          '<div class="d">' + esc(o.idea) + ' ' + alias + '</div>' +
          '<div class="m">' + (o.moves || []).length + ' 手演示 · 点进去一步步看 →</div>' +
          '</button>';
      }
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="card" style="margin-top:22px">' +
      '<p style="margin:0 0 8px"><b>每条走法都由规则引擎逐手复算过，不是凭印象编的。</b>' +
      '校验脚本在 <code>tmpwork/_opening_lint.js</code>，跑 <code>node tmpwork/_opening_lint.js</code> ' +
      '会把每个开局的每一手重新走一遍，断言全部合法、红先、红黑交替正确。</p>' +
      '<p class="small muted" style="margin:0">棋盘上的虚圈是这一手的起点，绿圈是落点；' +
      '每一步都在棋盘下方用坐标念出来（列 A–I 自左向右，行 1–10 自下而上，与摆棋页同向）。</p></div>';

    host.innerHTML = html;
    setState({ page: 'opening', total: list.length, byCat: byCat });
  }

  /* ---------------- 详情页 ---------------- */

  function renderMissing(host, id, list) {
    var html = '<div class="lesson-head">' + crumb('开局体系') + '<h1>没有这个开局</h1></div>' +
      '<div class="card"><p style="margin:0 0 14px">开局库里找不到「' + esc(id) + '」—— ' +
      '可能是链接写错了，也可能这个开局改过 id。库里现在有 ' + list.length + ' 种开局。</p>' +
      '<button class="btn" onclick="location.hash=\'#/xq/opening\'">回开局列表</button></div>';
    host.innerHTML = html;
    setState({ page: 'opening-missing', id: id, total: list.length });
  }

  /* 把一手棋念出来：「红：H3 → E3（吃卒）」 */
  function moveText(bd, from, to, color) {
    var XQ = global.XQ;
    var t = bd.t[to];                                  /* 走完之后的棋子类型 */
    var chars = (color === XQ.RED) ? RED_CHAR : BLACK_CHAR;
    var s = chars[t] || '子';
    return (color === XQ.RED ? '红' : '黑') + '：' + XQ.toLabel(from) + ' → ' + XQ.toLabel(to) +
      '（' + s + '）';
  }

  function renderDetail(host, list, id) {
    var XQ = global.XQ;
    var o = openingById(list, id);
    if (!o) return renderMissing(host, id, list);

    var pos = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) pos = i;
    var prev = pos > 0 ? list[pos - 1] : null;
    var next = pos < list.length - 1 ? list[pos + 1] : null;
    var steps = o.moves || [];

    var html = '';
    html += '<div class="lesson-head">' +
      crumb('<a href="#/xq/opening">开局体系</a> · ' + esc(o.name)) +
      '<h1>' + esc(o.name) +
      ' <span class="pill wood">' + esc(o.cat) + '</span>' +
      ' <span class="pill gray">' + esc(levelName(o.level)) + '</span>' +
      ((o.alias && o.alias.length) ? ' <span class="pill gray">又叫 ' + esc(o.alias.join(' / ')) + '</span>' : '') +
      '</h1>' +
      '<p class="lede">' + esc(o.idea) + '</p></div>';

    /* 棋盘 + 步进 */
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += '<div class="board-holder" style="max-width:580px;margin:0 auto">' +
      '<canvas id="xq-op-canvas"></canvas></div>';
    html += '<div class="board-bar">' +
      '<button class="btn ghost sm" id="xq-op-prev">← 上一手</button>' +
      '<button class="btn sm" id="xq-op-next">下一手 →</button>' +
      '<button class="btn ghost sm" id="xq-op-restart">从头开始</button>' +
      '<span class="spacer"></span>' +
      '<span class="pill wood" id="xq-op-step">标准开局（红先）</span>' +
      '</div>';
    html += '<div class="board-say" id="xq-op-say">红方先行。点「下一手」一手一手看下去 —— ' +
      '棋盘上的虚圈是这一手的起点，绿圈是落点。</div>';
    html += '</div></div>';

    /* 步进点：一格一手，当前手是高亮的那一段 */
    html += '<div class="row" style="margin:-6px 0 4px 4px">' +
      '<span class="step-dots" id="xq-op-dots">' +
      '<i data-k="0" class="on"></i>' +
      (function () { var s = '', k; for (k = 0; k < steps.length; k++) s += '<i data-k="' + (k + 1) + '"></i>'; return s; })() +
      '</span>' +
      '<span class="small muted" id="xq-op-count">共 ' + steps.length + ' 手</span></div>';

    /* 为什么这么走 */
    html += '<div class="card" style="margin-top:18px">' +
      '<div class="explain-block"><span class="lbl">为什么这么走</span>' +
      (function () {
        var s = '<ol class="small" style="margin:10px 0 0;padding-left:22px;line-height:2">';
        for (var k = 0; k < (o.points || []).length; k++) s += '<li>' + esc(o.points[k]) + '</li>';
        return s + '</ol>';
      })() +
      '</div></div>';

    /* 常见变化 */
    html += '<div class="card" style="margin-top:16px">' +
      '<div class="explain-block"><span class="lbl">常见变化</span>' +
      (function () {
        var s = '<ul class="small" style="margin:10px 0 0;padding-left:22px;line-height:2">';
        for (var k = 0; k < (o.varies || []).length; k++) s += '<li>' + esc(o.varies[k]) + '</li>';
        return s + '</ul>';
      })() +
      '</div></div>';

    /* 上一局 / 下一局 */
    html += '<div class="row" style="margin-top:16px">';
    html += prev
      ? '<button class="btn ghost sm" onclick="location.hash=\'#/xq/opening/' + esc(prev.id) + '\'">← ' + esc(prev.name) + '</button>'
      : '<button class="btn ghost sm" disabled title="已经是第一个开局">← 上一局</button>';
    html += next
      ? '<button class="btn ghost sm" onclick="location.hash=\'#/xq/opening/' + esc(next.id) + '\'">' + esc(next.name) + ' →</button>'
      : '<button class="btn ghost sm" disabled title="已经是最后一个开局">下一局 →</button>';
    html += '<span class="spacer"></span>' +
      '<button class="btn ghost sm" onclick="location.hash=\'#/xq/opening\'">回开局列表</button>';
    html += '</div>';

    host.innerHTML = html;

    /* ---- 逻辑：从标准开局起，每一手都真交给引擎走 ---- */
    var bd = new XQ.Board();
    bd.reset();
    var initial = XQ.START_POSITION;

    var view = mountBoard(el('xq-op-canvas'), { side: 'r', interactive: false });
    var sayEl = el('xq-op-say');
    var stepEl = el('xq-op-step');
    var dots = el('xq-op-dots').querySelectorAll('i');
    var nextBtn = el('xq-op-next');
    var prevBtn = el('xq-op-prev');
    var restartBtn = el('xq-op-restart');

    var cur = 0;            /* 当前已经走了几手 */
    var badAt = -1;         /* 第几手走不出来（数据坏了才会出现），-1 表示没坏 */
    var recs = [];

    function syncPieces() {
      var out = [], k;
      for (k = 0; k < bd.n; k++) {
        if (bd.g[k] === 0) continue;
        out.push([k % 9, (k / 9) | 0, bd.g[k] === XQ.RED ? 'r' : 'b', bd.t[k]]);
      }
      view.setPieces(out);
      /* 把当前摆着的盘面指纹写回 _state —— CDP 自验脚本就靠它跟引擎独立重算的盘面比对 */
      if (XQOpening._state && XQOpening._state.page === 'opening-detail') XQOpening._state.liveSig = signature(bd);
    }

    function highlight(k) {
      var j;
      for (j = 0; j < dots.length; j++) {
        if (Number(dots[j].getAttribute('data-k')) === k) dots[j].className = 'on';
        else dots[j].className = '';
      }
    }

    /* 走完 / 撤回之后，把「第几手」与三个按钮的状态同步一遍 */
    function syncBar() {
      highlight(cur);
      var total = steps.length;
      stepEl.textContent = cur === 0 ? '标准开局（红先）' : '第 ' + cur + ' / ' + total + ' 手';
      el('xq-op-count').textContent = '共 ' + total + ' 手' +
        (cur >= total ? ' · 已走完' : (badAt >= 0 ? ' · 第 ' + (badAt + 1) + ' 手走不出来' : ''));
      nextBtn.disabled = (cur >= total) || (badAt >= 0 && cur > badAt);
      prevBtn.disabled = cur <= 0;
      restartBtn.disabled = cur <= 0;
      if (XQOpening._state && XQOpening._state.page === 'opening-detail') XQOpening._state.step = cur;
    }

    /* 把 bd 重摆回标准开局，再把 steps 的前 n 手走一遍 */
    function goto(n) {
      bd.setup(initial);
      recs = [];
      badAt = -1;
      var k, turn = XQ.RED;
      for (k = 0; k < n; k++) {
        var st = steps[k];
        if (!st || !st.from || !st.to) { badAt = k; break; }
        var from = st.from[1] * 9 + st.from[0], to = st.to[1] * 9 + st.to[0];
        if (bd.g[from] !== turn) { badAt = k; break; }
        var r = bd.play(from, to, turn);
        if (!r.ok) { badAt = k; break; }
        recs.push({ from: from, to: to, color: turn, type: bd.t[to], capType: r.rec.capType });
        turn = XQ.other(turn);
      }
      cur = badAt >= 0 ? badAt : n;
      syncPieces();
      if (cur > 0 && recs.length) view.setLastMove(recs[recs.length - 1].from, recs[recs.length - 1].to);
      else view.setLastMove(-1, -1);
      syncBar();
      return cur;
    }

    function explain(k) {
      var st = steps[k - 1];
      var from = st.from[1] * 9 + st.from[0], to = st.to[1] * 9 + st.to[0];
      var rec = recs[k - 1];
      var txt = '第 ' + k + ' 手　' + moveText(bd, from, to, rec.color);
      if (rec && rec.capType) {
        txt += '，吃掉' + (rec.color === XQ.RED ? '黑' : '红') + '方' +
          (rec.color === XQ.RED ? BLACK_CHAR : RED_CHAR)[rec.capType];
      }
      var opp = XQ.other(rec.color);
      if (bd.isChecked(opp)) txt += '　—— 将军';
      return txt;
    }

    function sayInitial() {
      sayEl.textContent = '这是标准开局，红方先行。点「下一手」开始 —— 本开局一共 ' + steps.length +
        ' 手，走完就停在「' + o.name + '」的典型阵型上。';
    }

    function stepForward() {
      if (cur >= steps.length) { sayEl.textContent = '已经走完了 —— 点「从头开始」可以再看一遍。'; return; }
      var want = cur + 1;
      goto(want);
      if (badAt >= 0) {
        sayEl.textContent = '数据里第 ' + (badAt + 1) + ' 手在当前局面下走不出来（这一手不合法）。' +
          '这个开局是坏的，请报给作者 —— 页面宁可停在这里，也不假装走过了。';
        return;
      }
      var txt = explain(want);
      if (want === steps.length) {
        var opp = XQ.other(recs[want - 1].color);
        txt += '　黑方轮到走，局面停在「' + o.name + '」的典型形上。' +
          (bd.isChecked(opp) ? '（顺带一提：黑方现在被将军。）' : '');
      }
      sayEl.textContent = txt;
    }

    function stepBack() {
      if (cur <= 0) { sayInitial(); return; }
      var want = cur - 1;
      goto(want);
      if (want === 0) sayInitial();
      else sayEl.textContent = explain(want) + '（已退回这一手之后）';
    }

    nextBtn.onclick = stepForward;
    prevBtn.onclick = stepBack;
    restartBtn.onclick = function () {
      goto(0);
      sayInitial();
    };

    /* 走完全程，把终局盘面指纹记下来，供自验脚本比对 */
    goto(steps.length);
    var finalSig = signature(bd);
    var badAll = badAt;

    var listIds = [];
    for (i = 0; i < list.length; i++) listIds.push(list[i].id);

    setState({
      page: 'opening-detail', id: o.id, total: list.length, step: 0, steps: steps.length,
      pos: pos, prev: prev ? prev.id : null, next: next ? next.id : null,
      side: 'r', listIds: listIds, liveSig: finalSig, finalSig: finalSig, badAt: badAll
    });
    goto(0);
    sayInitial();
  }

  /* ---------------- 入口 ---------------- */

  function render(host, seg) {
    killAll();
    host = host || el('app');
    seg = seg || [];
    var list = allOpenings();
    var id = seg[1] ? String(seg[1]) : '';
    if (id) return renderDetail(host, list, id);
    return renderList(host, list);
  }

  global.XQOpening = XQOpening;

})(typeof window !== 'undefined' ? window : this);
