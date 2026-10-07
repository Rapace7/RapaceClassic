/* 象棋板块 · 基本杀法图库页面 —— 只依赖 xq-mates.js（window.XQ_MATES）、
 * xq-engine.js（window.XQ）与 xq-board.js（window.XQBoard）。
 *
 * 入口（由 xq-app.js 的路由调用，接线由作者统一做）：
 *   window.XQMates.render(host, seg)
 *     seg  —— hash 的分段数组，**不含 'xq' 前缀**
 *             #/xq/mates            → seg = ['mates']
 *             #/xq/mates/<id>       → seg = ['mates', 'xq-m01']
 *     host —— 容器元素（app.js 里的 #app）
 *
 * 页面：
 *   列表页  按 cat（基本杀法 / 组合杀法 / 实用残局杀）分三组，每个形一张卡：
 *           名称 + 一句话形状特征 + 「几手成杀」。
 *   详情页  一张不接点击的棋盘（interactive:false，只演示）+ 「下一手 / 上一手 / 从头开始」
 *           步进；每走一手，棋盘下方把这一手念出来，最后一手明确写出「将死」还是「困毙」。
 *           下面依次是 def（形状）/ why（为什么能杀）/ key（怎么记），
 *           最后一排「相关杀法」按钮直接跳到另一个形。
 *
 * ⚠ steps 是数据里死的，但页面**不信任**它 —— 每一手都真交给引擎 play() 走。
 *   万一数据坏了（某一手不合法），页面会如实说「这一手走不出来」，而不是假装走过了。
 *
 * 关于样式：本项目不许改 style.css，所以优先复用全站现成的类：
 *   .lesson-head(.crumb/.lede) .part-title .entry-grid .entry(.t/.d/.m) .pill(.wood/.gray)
 *   .card .row .spacer .btn(.ghost/.sm) .q-ask .small .muted .sub
 *   .demo-wrap .board-shell .board-holder .board-bar .board-say
 *   .step-dots(.on) .explain-block .principle
 *
 * 自验钩子：XQMates._state = { page, total, byCat, id, step, steps, result, side, relIds }
 *   纯粹给 CDP 自验脚本读数用（画布上的棋子没法从 DOM 里数），不影响界面行为。
 */
(function (global) {
  'use strict';

  var CAT_ORDER = ['基本杀法', '组合杀法', '实用残局杀'];
  var RED_CHAR = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' };
  var BLACK_CHAR = { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' };

  var alive = [];          /* 本次渲染挂上的棋盘；重新渲染前统一销毁 */

  var XQMates = {
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

  function allMates() { return global.XQ_MATES || []; }

  function mateById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* related 里存的是「杀法名」，按 name → alias 的顺序找 */
  function mateByName(list, name) {
    var i, k;
    for (i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    for (i = 0; i < list.length; i++) {
      var al = list[i].alias || [];
      for (k = 0; k < al.length; k++) if (al[k] === name) return list[i];
    }
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

  function setState(s) { XQMates._state = s; return s; }

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

  /* ---------------- 列表页 ---------------- */

  function renderList(host, list) {
    var html = '';
    html += '<div class="lesson-head">' + crumb('基本杀法图库') +
      '<h1>基本杀法图库</h1>' +
      '<p class="lede">收了 ' + list.length + ' 个象棋杀形，分三组：' +
      '<b>基本杀法</b>（马后炮、卧槽马、双车错、铁门栓这类一步成杀的定式）、' +
      '<b>组合杀法</b>（车兵、马兵、车炮几子配合的冷着）、' +
      '<b>实用残局杀</b>（单车、车马、车炮收官取胜的门道）。' +
      '每个形都配一张棋盘与一条主变化，点进去可以一手一手看它是怎么走成的。</p></div>';

    if (!list.length) {
      /* 数据没挂上来（打包漏了 xq-mates.js 之类）——说清楚，不给空页面 */
      html += '<div class="card"><h3 style="margin-top:0">杀法库没加载出来</h3>' +
        '<p style="margin:8px 0 0">页面里找不到 XQ_MATES —— 大概是打包时漏了 xq-mates.js。' +
        '这一条请报给作者。</p></div>';
      host.innerHTML = html;
      setState({ page: 'mates', total: 0, byCat: {} });
      return;
    }

    var groups = groupByCat(list), byCat = {}, i, k;
    html += '<div id="xq-mt-list">';
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      byCat[g.cat] = g.items.length;
      html += '<div class="part-title" data-cat="' + esc(g.cat) + '">' + esc(g.cat) + ' · ' + g.items.length + ' 个形</div>';
      html += '<div class="entry-grid" data-cat="' + esc(g.cat) + '">';
      for (k = 0; k < g.items.length; k++) {
        var m = g.items[k];
        var alias = (m.alias && m.alias.length)
          ? '<span class="small muted" style="font-weight:400">（又叫 ' + esc(m.alias[0]) + '）</span>' : '';
        html += '<button class="entry" data-mate-id="' + esc(m.id) + '"' +
          ' onclick="location.hash=\'#/xq/mates/' + esc(m.id) + '\'">' +
          '<div class="t">' + esc(m.name) + ' <span class="pill">' + esc(m.cat) + '</span></div>' +
          '<div class="d">' + esc(m.def) + ' ' + alias + '</div>' +
          '<div class="m">' + (m.steps || []).length + ' 手成杀 · 点进去看棋盘演示 →</div>' +
          '</button>';
      }
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="card" style="margin-top:22px">' +
      '<p style="margin:0 0 8px"><b>每个形的主变化都是算出来的，不是抄书的。</b>' +
      '盘面先交给求解器搜一条最短取胜线，再由规则引擎逐手复算：每一手都合法、走完黑方确实被将死或困毙。' +
      '工具的源码在 <code>tools/verify_xq_mates.js</code>，跑 <code>node tools/verify_xq_mates.js</code> 会逐条重算。</p>' +
      '<p class="small muted" style="margin:0">中国象棋里<b>困毙</b>（无子可动但没被将）同样算负，' +
      '所以有几形是困毙取胜；棋盘下方会明确写出是哪一种，不含糊。</p></div>';

    host.innerHTML = html;
    setState({ page: 'mates', total: list.length, byCat: byCat });
  }

  /* ---------------- 详情页 ---------------- */

  function renderMissing(host, id, list) {
    var html = '<div class="lesson-head">' + crumb('基本杀法图库') + '<h1>没有这个形</h1></div>' +
      '<div class="card"><p style="margin:0 0 14px">杀法库里找不到「' + esc(id) + '」这个形 —— ' +
      '可能是链接写错了，也可能这个形改过 id。库里现在有 ' + list.length + ' 个形。</p>' +
      '<button class="btn" onclick="location.hash=\'#/xq/mates\'">回杀法图库</button></div>';
    host.innerHTML = html;
    setState({ page: 'mates-missing', id: id, total: list.length });
  }

  /* 把一手棋念出来：「红车 A9-E9（吃士）将军」 */
  function moveText(bd, from, to, color) {
    var t = bd.t[to];                                  /* 走完之后的棋子类型 */
    var chars = (color === 'r' || color === 1) ? RED_CHAR : BLACK_CHAR;
    var s = chars[t] || '子';
    return s + ' ' + global.XQ.toLabel(from) + '-' + global.XQ.toLabel(to);
  }

  function renderDetail(host, list, id) {
    var XQ = global.XQ;
    var m = mateById(list, id);
    if (!m) return renderMissing(host, id, list);

    var pos = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) pos = i;
    var prev = pos > 0 ? list[pos - 1] : null;
    var next = pos < list.length - 1 ? list[pos + 1] : null;
    var steps = m.steps || [];

    var html = '';
    html += '<div class="lesson-head">' +
      crumb('<a href="#/xq/mates">基本杀法图库</a> · ' + esc(m.name)) +
      '<h1>' + esc(m.name) + ' <span class="pill wood">' + esc(m.cat) + '</span>' +
      ((m.alias && m.alias.length) ? ' <span class="pill gray">又叫 ' + esc(m.alias.join(' / ')) + '</span>' : '') +
      '</h1>' +
      '<p class="lede">' + esc(m.def) + '</p></div>';

    /* 棋盘 + 步进 */
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += '<div class="board-holder" style="max-width:580px;margin:0 auto">' +
      '<canvas id="xq-mt-canvas"></canvas></div>';
    html += '<div class="board-bar">' +
      '<button class="btn ghost sm" id="xq-mt-prev">← 上一手</button>' +
      '<button class="btn sm" id="xq-mt-next">下一手 →</button>' +
      '<button class="btn ghost sm" id="xq-mt-restart">从头开始</button>' +
      '<span class="spacer"></span>' +
      '<span class="pill wood" id="xq-mt-step">开局（红先）</span>' +
      '</div>';
    html += '<div class="board-say" id="xq-mt-say">红方先行。点「下一手」一手一手看下去 —— ' +
      '棋盘上的虚圈是这一手的起点，绿圈是落点。</div>';
    html += '</div></div>';

    /* 步进点：一格一手，当前手是高亮的那一段 */
    html += '<div class="row" style="margin:-6px 0 4px 4px">' +
      '<span class="step-dots" id="xq-mt-dots">' +
      '<i data-k="0" class="on"></i>' +
      (function () { var s = ''; for (var k = 0; k < steps.length; k++) s += '<i data-k="' + (k + 1) + '"></i>'; return s; })() +
      '</span>' +
      '<span class="small muted" id="xq-mt-count">共 ' + steps.length + ' 手</span></div>';

    /* 为什么能杀 */
    html += '<div class="card" style="margin-top:18px">' +
      '<div class="explain-block"><span class="lbl">为什么这样就能杀</span>' +
      '<p style="margin:8px 0 0;line-height:1.95">' + esc(m.why) + '</p></div>' +
      '<div class="principle" style="margin-top:14px"><b>记住这句：</b>' + esc(m.key) + '</div>' +
      '</div>';

    /* 相关杀法 + 上下形 */
    var rels = m.related || [];
    html += '<div class="card" style="margin-top:16px"><div class="row">' +
      '<span class="small muted">相关杀法</span>';
    if (!rels.length) {
      html += '<span class="small muted">（这个形暂时没挂相关的形）</span>';
    } else {
      for (i = 0; i < rels.length; i++) {
        var r = mateByName(list, rels[i]);
        if (r) {
          html += '<button class="btn ghost sm" data-rel="' + esc(rels[i]) + '" data-rel-id="' + esc(r.id) + '"' +
            ' onclick="location.hash=\'#/xq/mates/' + esc(r.id) + '\'">' + esc(rels[i]) + ' →</button>';
        } else {
          html += '<button class="btn ghost sm" disabled title="库里还没收这个形">' + esc(rels[i]) + '</button>';
        }
      }
    }
    html += '</div></div>';

    html += '<div class="row" style="margin-top:16px">';
    html += prev
      ? '<button class="btn ghost sm" onclick="location.hash=\'#/xq/mates/' + esc(prev.id) + '\'">← ' + esc(prev.name) + '</button>'
      : '<button class="btn ghost sm" disabled title="已经是第一个形">← 上一个</button>';
    html += next
      ? '<button class="btn ghost sm" onclick="location.hash=\'#/xq/mates/' + esc(next.id) + '\'">' + esc(next.name) + ' →</button>'
      : '<button class="btn ghost sm" disabled title="已经是最后一个形">下一个 →</button>';
    html += '<span class="spacer"></span>' +
      '<button class="btn ghost sm" onclick="location.hash=\'#/xq/mates\'">回图库列表</button>';
    html += '</div>';

    host.innerHTML = html;

    /* ---- 逻辑：每一手都真交给引擎走 ---- */
    var bd = new XQ.Board();
    bd.setup(m.pieces);
    var initial = [];
    (m.pieces || []).forEach(function (p) { initial.push([p[0], p[1], p[2], p[3]]); });

    var view = mountBoard(el('xq-mt-canvas'), { side: 'r', interactive: false });
    var sayEl = el('xq-mt-say');
    var stepEl = el('xq-mt-step');
    var dots = el('xq-mt-dots').querySelectorAll('i');
    var nextBtn = el('xq-mt-next');
    var prevBtn = el('xq-mt-prev');
    var restartBtn = el('xq-mt-restart');

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
    }

    function highlight(k) {
      var j;
      for (j = 0; j < dots.length; j++) {
        if (Number(dots[j].getAttribute('data-k')) === k) dots[j].className = 'on';
        else dots[j].className = '';
      }
    }

    /* 走完 / 撤回之后，把「第几手」与三个按钮的状态同步一遍。
       顺便把当前步数写回 _state —— CDP 自验脚本就靠这个数棋盘走到了哪一手。 */
    function syncBar() {
      highlight(cur);
      var total = steps.length;
      stepEl.textContent = cur === 0 ? '开局（红先）' : '第 ' + cur + ' / ' + total + ' 手';
      el('xq-mt-count').textContent = '共 ' + total + ' 手' +
        (cur >= total ? ' · 已走完' : (badAt >= 0 ? ' · 第 ' + (badAt + 1) + ' 手走不出来' : ''));
      nextBtn.disabled = (cur >= total) || (badAt >= 0 && cur > badAt);
      prevBtn.disabled = cur <= 0;
      restartBtn.disabled = cur <= 0;
      if (XQMates._state && XQMates._state.page === 'mates-detail') XQMates._state.step = cur;
    }

    /* 把 bd 重摆回初始局面，再把 steps 的前 n 手走一遍 */
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
      var who = rec.color === XQ.RED ? '红方' : '黑方';
      var txt = '第 ' + k + ' 手　' + who + ' ' + XQ.toLabel(from) + ' → ' + XQ.toLabel(to);
      if (rec && rec.capType) txt += '（吃掉' + (rec.color === XQ.RED ? '黑' : '红') + '方' +
        (rec.color === XQ.RED ? BLACK_CHAR : RED_CHAR)[rec.capType] + '）';
      var opp = XQ.other(rec.color);
      if (bd.isMate(opp)) {
        txt += '　—— ' + (bd.isChecked(opp) ? '将死' : '困毙') + '！';
      } else if (bd.isChecked(opp)) {
        txt += '　—— 将军';
      }
      return txt;
    }

    function sayInitial() {
      sayEl.textContent = '这是开局局面，红方先行。点「下一手」开始 —— 主变化一共 ' + steps.length +
        ' 手，都是求解器算出来的最短取胜线。';
    }

    function stepForward() {
      if (cur >= steps.length) { sayEl.textContent = '已经走完了 —— 点「从头开始」可以再看一遍。'; return; }
      var want = cur + 1;
      goto(want);
      if (badAt >= 0) {
        sayEl.textContent = '数据里第 ' + (badAt + 1) + ' 手在当前局面下走不出来（这一手不合法）。' +
          '这个形是坏的，请报给作者 —— 页面宁可停在这里，也不假装走过了。';
        return;
      }
      var txt = explain(want);
      if (want === steps.length) {
        var opp = XQ.other(recs[want - 1].color);
        txt += '　黑方无着，' + (bd.isChecked(opp) ? '被将死' : '无子可动（困毙）') + '—— 红方胜。';
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

    /* 终局到底是「将死」还是「困毙」：真走一遍最后一段读出来（给自验脚本用） */
    var result = '';
    if (steps.length) {
      goto(steps.length);
      result = badAt >= 0 ? '走不出来'
        : (bd.isMate(XQ.BLACK) ? (bd.isChecked(XQ.BLACK) ? '将死' : '困毙') : '未杀成');
    }

    var relIds = [];
    for (i = 0; i < (m.related || []).length; i++) {
      var rr = mateByName(list, m.related[i]);
      if (rr) relIds.push(rr.id);
    }

    setState({
      page: 'mates-detail', id: m.id, total: list.length, step: 0, steps: steps.length,
      result: result, side: 'r', relIds: relIds
    });
    goto(0);
    sayInitial();
  }

  /* ---------------- 入口 ---------------- */

  function render(host, seg) {
    killAll();
    host = host || el('app');
    seg = seg || [];
    var list = allMates();
    var id = seg[1] ? String(seg[1]) : '';
    if (id) return renderDetail(host, list, id);
    return renderList(host, list);
  }

  global.XQMates = XQMates;

})(typeof window !== 'undefined' ? window : this);
