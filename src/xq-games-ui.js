/* 象棋板块 · 名局讲解页面 —— 只依赖同格式的名局数据文件（window.XQ_GAMES，
 * 由几批写手各自 append）、xq-engine.js（window.XQ）与 xq-board.js（window.XQBoard）。
 *
 * 入口（由 xq-app.js 的路由调用，接线由作者统一做）：
 *   window.XQGames.render(host, seg)
 *     seg  —— hash 的分段数组，**不含 'xq' 前缀**
 *             #/xq/games            → seg = ['games']
 *             #/xq/games/xq-g01     → seg = ['games', 'xq-g01']
 *     host —— 容器元素（app.js 里的 #app）
 *
 * 页面：
 *   列表页  按 no 排序，每局一张卡：对局名 + 赛事 + 结果 + 手数 + 一句背景。
 *           库里现在有几局就渲染几局（本页由三批写手共同供数，不假设一定有 9 局）。
 *   详情页  上半是「左棋盘 / 右讲解」两栏（.prob-layout，与围棋练习页同一套布局类）：
 *           左栏棋盘（interactive:false，从标准开局起手）+「下一手 / 上一手 / 从头开始」步进、
 *           进度条与「第 N / 总手数」；右栏是**当前手**的讲解 —— 一手一条，
 *           走一步换一条，不是一坨「全局解说」挂在旁边。
 *           下半是：对局信息卡（赛事 / 日期 / 双方 / 结果 / 背景）→ 关键手列表（点了直接跳到那一手）
 *           → 棋手卡 → 这一局记住什么（takeaway）→ 存疑点（notes，一起显示，不藏）。
 *
 * ⚠ moves 虽已在数据侧由 tools/verify_xq_games.js 校验过（全批逐手比对调研笔记 + 引擎走通），
 *   但页面**不信任**它 ——
 *   每一手仍真交给引擎 play()。万一数据坏了，页面会如实说「这一手走不出来」，不假装走过。
 *
 * 关于样式：本项目不许改 style.css，所以优先复用全站现成的类：
 *   .lesson-head(.crumb/.lede) .part-title .entry-grid .entry(.t/.d/.m) .pill(.wood/.gray)
 *   .card .row .spacer .btn(.ghost/.sm) .small .muted .sub
 *   .prob-layout .prob-board .prob-notes .explain-block .principle
 *   .demo-wrap .board-shell .board-holder .board-bar .board-say
 * 只有进度条是内联样式（.step-dots 是给十几手的小演示用的，156 手会挤成一条线）。
 *
 * 自验钩子：XQGames._state = { page, total, ids, id, pos, prev, next, step, steps,
 *                              moveLabel, noteIdx, liveSig, finalSig, badAt }
 *   纯给 CDP 自验脚本读数用（画布上的棋子没法从 DOM 里数），不影响界面行为。
 */
(function (global) {
  'use strict';

  var RED_CHAR = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' };
  var BLACK_CHAR = { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' };

  var alive = [];          /* 本次渲染挂上的棋盘；重新渲染前统一销毁 */

  var XQGames = {
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

  /* ---------------- 取数与工具 ---------------- */

  function allGames() { return global.XQ_GAMES || []; }

  /* 按 no 排（本页由三批写手供数，谁先谁后不可靠，一律按 no 排） */
  function sortedGames() {
    var l = allGames().slice();
    l.sort(function (a, b) { return (a.no || 0) - (b.no || 0); });
    return l;
  }

  function gameById(list, id) {
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

  function setState(s) { XQGames._state = s; return s; }

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

  /* 把一手棋念出来：「红 车 G3 → E3（吃卒）」—— 走法与吃子都从引擎读，不手写 */
  function moveText(color, from, to, pieceType, capType, checked, mate) {
    var XQ = global.XQ;
    var side = (color === XQ.RED);
    var chars = side ? RED_CHAR : BLACK_CHAR;
    var txt = (side ? '红' : '黑') + ' ' + (chars[pieceType] || '子') +
      ' ' + XQ.toLabel(from) + ' → ' + XQ.toLabel(to);
    if (capType) {
      txt += '（吃' + (side ? '黑' : '红') + (side ? BLACK_CHAR : RED_CHAR)[capType] + '）';
    }
    if (mate) txt += '　—— 杀';
    else if (checked) txt += '　—— 将军';
    return txt;
  }

  /* ---------------- 列表页 ---------------- */

  function renderList(host, list) {
    var html = '';
    html += '<div class="lesson-head">' + crumb('名局讲解') +
      '<h1>名局讲解</h1>' +
      '<p class="lede">收了 ' + list.length + ' 局有据可查的实战名局。每一局都从标准开局起手，' +
      '<b>一手一手</b>往下走：棋盘旁边跟着出这一手的讲解 —— 为什么走这里、针对什么、有什么威胁。' +
      '象棋不像围棋那么慢，一步闲棋就可能丢掉整盘，所以这里不做「只看几个关键点」的取舍，' +
      '全谱每一手都讲，但每条的篇幅跟着这一手的分量走，不凑字数。</p></div>';

    if (!list.length) {
      /* 数据没挂上来（打包漏了 xq-games-*.js 之类）——说清楚，不给空页面 */
      html += '<div class="card"><h3 style="margin-top:0">名局库没加载出来</h3>' +
        '<p style="margin:8px 0 0">页面里找不到 XQ_GAMES —— 大概是打包时漏了 xq-games-a.js。' +
        '这一条请报给作者。</p></div>';
      host.innerHTML = html;
      setState({ page: 'games', total: 0, ids: [] });
      return;
    }

    html += '<div id="xq-gm-list">';
    html += '<div class="part-title">共 ' + list.length + ' 局</div>';
    html += '<div class="entry-grid">';
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      var hook = (g.background && g.background.length) ? g.background[0] : (g.takeaway || '');
      var n = (g.moves || []).length || g.movesTotal || 0;
      html += '<button class="entry" data-game-id="' + esc(g.id) + '"' +
        ' onclick="location.hash=\'#/xq/games/' + esc(g.id) + '\'">' +
        '<div class="t">第 ' + esc(g.no) + ' 局　' + esc(g.title) +
        ' <span class="pill gray">' + esc(g.result) + '</span></div>' +
        '<div class="d">' + esc(g.event) + '　·　' + esc(g.date) + '　·　共 ' + n + ' 手</div>' +
        '<div class="d" style="margin-top:4px">' + esc(hook) + '</div>' +
        '<div class="m">点进去一手一手看，每一步都有讲解 →</div>' +
        '</button>';
    }
    html += '</div></div>';

    html += '<div class="card" style="margin-top:22px">' +
      '<p style="margin:0 0 8px"><b>棋谱不是凭印象抄的，是逐手走通过的。</b>' +
      '每一局都从标准开局起一手一手演算过：任何一手不合法都会当场报错，九局整体也复算过一遍。</p>' +
      '<p class="small muted" style="margin:0">棋盘上的虚圈是这一手的起点，绿圈是落点；' +
      '每一步都在棋盘下方用坐标念出来（列 A–I 自左向右，行 1–10 自下而上，与摆棋页同向）。' +
      '讲解只讲棋理 —— 这页没有引擎评分，所以也不写胜率、不写「AI 认为」这类数字。</p></div>';

    host.innerHTML = html;
    setState({ page: 'games', total: list.length, ids: list.map(function (x) { return x.id; }) });
  }

  /* ---------------- 详情页 ---------------- */

  function renderMissing(host, id, list) {
    var html = '<div class="lesson-head">' + crumb('名局讲解') + '<h1>没有这一局</h1></div>' +
      '<div class="card"><p style="margin:0 0 14px">名局库里找不到「' + esc(id) + '」—— ' +
      '可能是链接写错了，也可能这一局改过 id。库里现在有 ' + list.length + ' 局。</p>' +
      '<button class="btn" onclick="location.hash=\'#/xq/games\'">回名局列表</button></div>';
    host.innerHTML = html;
    setState({ page: 'games-missing', id: id, total: list.length });
  }

  function renderDetail(host, list, id) {
    var XQ = global.XQ;
    var g = gameById(list, id);
    if (!g) return renderMissing(host, id, list);

    var pos = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) pos = i;
    var prev = pos > 0 ? list[pos - 1] : null;
    var next = (pos >= 0 && pos < list.length - 1) ? list[pos + 1] : null;
    var steps = g.moves || [];
    var notes = g.moveNotes || [];

    var html = '';
    html += '<div class="lesson-head">' +
      crumb('<a href="#/xq/games">名局讲解</a> · 第 ' + esc(g.no) + ' 局') +
      '<h1>' + esc(g.title) +
      ' <span class="pill wood">第 ' + esc(g.no) + ' 局</span>' +
      ' <span class="pill gray">共 ' + steps.length + ' 手</span>' +
      ' <span class="pill gray">' + esc(g.result) + '</span></h1>' +
      '<p class="lede">' + esc(g.event) + '　·　' + esc(g.date) + '　·　' +
      '红方 ' + esc(g.red) + '　对　黑方 ' + esc(g.black) + '</p></div>';

    /* ── 左棋盘 + 右讲解（与围棋练习页同一套 .prob-layout） ── */
    html += '<div class="prob-layout"><div class="prob-board">';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += '<div class="board-holder" style="max-width:580px;margin:0 auto">' +
      '<canvas id="xq-gm-canvas"></canvas></div>';
    html += '<div class="board-bar">' +
      '<button class="btn ghost sm" id="xq-gm-prev">← 上一手</button>' +
      '<button class="btn sm" id="xq-gm-next">下一手 →</button>' +
      '<button class="btn ghost sm" id="xq-gm-restart">从头开始</button>' +
      '<span class="spacer"></span>' +
      '<span class="pill wood" id="xq-gm-step">标准开局（红先）</span>' +
      '</div>';
    html += '<div class="board-say" id="xq-gm-say">这是标准开局，红方先行。' +
      '点「下一手」一手一手走，棋盘右边会跟着出这一手的讲解。</div>';
    html += '</div></div>';
    html += '</div><div class="prob-notes">';

    html += '<div class="card">' +
      '<div class="row" style="margin-bottom:8px">' +
      '<span class="pill" id="xq-gm-num">开局</span>' +
      '<span class="small muted" id="xq-gm-count">第 0 / ' + steps.length + ' 手</span>' +
      '</div>' +
      '<div style="height:6px;border-radius:999px;background:var(--line-2);overflow:hidden">' +
      '<div id="xq-gm-bar" style="height:100%;width:0%;background:var(--accent);transition:width .2s"></div>' +
      '</div>' +
      '<div class="explain-block" style="margin:14px 0 0">' +
      '<span class="lbl" id="xq-gm-lbl">这一手在讲什么</span>' +
      '<p id="xq-gm-note" style="margin:8px 0 0;line-height:1.95">点「下一手」开始 —— ' +
      '每一手都会在这里换一条讲解。</p></div>' +
      '<p class="small muted" id="xq-gm-movetext" style="margin:10px 0 0">' +
      '棋盘上的虚圈是这一手的起点，绿圈是落点。</p>' +
      '</div>';

    /* 关键手：就近放在讲解下面，点一下直接跳到那一手 */
    var keys = g.keyMoments || [];
    html += '<div class="card" style="margin-top:14px">' +
      '<div class="row"><span class="small muted">关键手（点了跳到那一手）</span></div>' +
      '<div class="row" id="xq-gm-keys" style="margin-top:8px">';
    if (!keys.length) {
      html += '<span class="small muted">这一局没单列关键手，整条走法都能一步步看。</span>';
    } else {
      for (i = 0; i < keys.length; i++) {
        html += '<button class="btn ghost sm" data-key-n="' + esc(keys[i].n) + '">' +
          '第 ' + esc(keys[i].n) + ' 手 · ' + esc(keys[i].side) + '</button>';
      }
    }
    html += '</div></div>';
    html += '</div></div>';

    /* ── 对局信息 ── */
    html += '<div class="card" style="margin-top:18px">' +
      '<div class="row" style="margin-bottom:10px">' +
      '<span class="pill wood">第 ' + esc(g.no) + ' 局</span>' +
      '<span class="pill">' + esc(g.result) + '</span>' +
      '<span class="pill gray">' + steps.length + ' 手</span>' +
      '<span class="spacer"></span>' +
      '<span class="small muted">第 ' + (pos + 1) + ' / ' + list.length + ' 局</span>' +
      '</div>' +
      '<div class="explain-block" style="margin:0"><span class="lbl">对局信息</span><ol class="small" ' +
      'style="margin:10px 0 0;padding-left:22px;line-height:2">' +
      '<li>赛事：' + esc(g.event) + '</li>' +
      '<li>时间：' + esc(g.date) + '</li>' +
      '<li>红方：' + esc(g.red) + '　黑方：' + esc(g.black) + '</li>' +
      '<li>结果：' + esc(g.result) + '，共 ' + steps.length + ' 手（半回合）</li>' +
      '</ol></div>';
    if (g.background && g.background.length) {
      html += '<div class="explain-block" style="margin:14px 0 0"><span class="lbl">这一局的来路</span>' +
        '<ul class="small" style="margin:10px 0 0;padding-left:22px;line-height:2">';
      for (i = 0; i < g.background.length; i++) html += '<li>' + esc(g.background[i]) + '</li>';
      html += '</ul></div>';
    }
    html += '</div>';

    /* ── 关键手明细 ── */
    if (keys.length) {
      html += '<div class="card" style="margin-top:16px">' +
        '<div class="explain-block" style="margin:0"><span class="lbl">关键手</span>' +
        '<ol class="small" style="margin:10px 0 0;padding-left:22px;line-height:2">';
      for (i = 0; i < keys.length; i++) {
        html += '<li><b>第 ' + esc(keys[i].n) + ' 手（' + esc(keys[i].side) + '）' +
          esc(keys[i].label) + '</b><br>' + esc(keys[i].detail) + '</li>';
      }
      html += '</ol></div></div>';
    }

    /* ── 棋手 ── */
    if (g.players && g.players.length) {
      html += '<div class="card" style="margin-top:16px">' +
        '<div class="explain-block" style="margin:0"><span class="lbl">两位棋手</span>';
      for (i = 0; i < g.players.length; i++) {
        var p = g.players[i];
        html += '<p style="margin:12px 0 0"><b>' + esc(p.name) +
          '（' + esc(p.side) + '方）</b><br>' + esc(p.intro) + '<br>' +
          '<span class="small muted">棋风：' + esc(p.style) + '</span></p>';
      }
      html += '</div></div>';
    }

    /* ── 记住什么 + 存疑点 ── */
    html += '<div class="card" style="margin-top:16px">' +
      '<div class="principle"><b>这一局记住什么：</b>' + esc(g.takeaway || '') + '</div>';
    if (g.notes && g.notes.length) {
      html += '<div class="explain-block" style="margin:14px 0 0">' +
        '<span class="lbl">存疑与出处（一并写在这里，不藏）</span>' +
        '<ul class="small muted" style="margin:10px 0 0;padding-left:22px;line-height:2">';
      for (i = 0; i < g.notes.length; i++) html += '<li>' + esc(g.notes[i]) + '</li>';
      html += '</ul></div>';
    }
    html += '</div>';

    /* ── 上一局 / 下一局 ── */
    html += '<div class="row" style="margin-top:16px">';
    html += prev
      ? '<button class="btn ghost sm" id="xq-gm-prevgame" onclick="location.hash=\'#/xq/games/' + esc(prev.id) + '\'">← 第 ' + esc(prev.no) + ' 局　' + esc(prev.title) + '</button>'
      : '<button class="btn ghost sm" id="xq-gm-prevgame" disabled title="已经是第一局">← 上一局</button>';
    html += next
      ? '<button class="btn ghost sm" id="xq-gm-nextgame" onclick="location.hash=\'#/xq/games/' + esc(next.id) + '\'">第 ' + esc(next.no) + ' 局　' + esc(next.title) + ' →</button>'
      : '<button class="btn ghost sm" id="xq-gm-nextgame" disabled title="已经是最后一局">下一局 →</button>';
    html += '<span class="spacer"></span>' +
      '<button class="btn ghost sm" onclick="location.hash=\'#/xq/games\'">回名局列表</button>';
    html += '</div>';

    host.innerHTML = html;

    /* ---- 逻辑：从标准开局起，每一手都真交给引擎走 ---- */
    var bd = new XQ.Board();
    bd.reset();

    var view = mountBoard(el('xq-gm-canvas'), { side: 'r', interactive: false });
    var sayEl = el('xq-gm-say');
    var noteEl = el('xq-gm-note');
    var numEl = el('xq-gm-num');
    var countEl = el('xq-gm-count');
    var mvEl = el('xq-gm-movetext');
    var stepEl = el('xq-gm-step');
    var barEl = el('xq-gm-bar');
    var nextBtn = el('xq-gm-next');
    var prevBtn = el('xq-gm-prev');
    var restartBtn = el('xq-gm-restart');
    var keyBox = el('xq-gm-keys');

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
      if (XQGames._state && XQGames._state.page === 'games-detail') XQGames._state.liveSig = signature(bd);
    }

    /* 走完 / 撤回之后，把「第几手」、进度条与三个按钮的状态同步一遍 */
    function syncBar() {
      var total = steps.length;
      stepEl.textContent = cur === 0 ? '标准开局（红先）' : '第 ' + cur + ' / ' + total + ' 手';
      numEl.textContent = cur === 0 ? '开局' : ('第 ' + cur + ' 手 · ' + (recs[cur - 1] && recs[cur - 1].color === XQ.RED ? '红' : '黑'));
      countEl.textContent = '第 ' + cur + ' / ' + total + ' 手' +
        (cur >= total ? ' · 已走完' : (badAt >= 0 ? ' · 第 ' + (badAt + 1) + ' 手走不出来' : ''));
      barEl.style.width = (total ? Math.round(cur / total * 100) : 0) + '%';
      nextBtn.disabled = (cur >= total) || (badAt >= 0 && cur > badAt);
      prevBtn.disabled = cur <= 0;
      restartBtn.disabled = cur <= 0;
      /* 关键手按钮：正停在这一手就点亮 */
      if (keyBox) {
        var bs = keyBox.querySelectorAll('button[data-key-n]'), j;
        for (j = 0; j < bs.length; j++) {
          bs[j].className = 'btn ghost sm' + (Number(bs[j].getAttribute('data-key-n')) === cur ? ' on' : '');
        }
      }
      if (XQGames._state && XQGames._state.page === 'games-detail') {
        XQGames._state.step = cur;
        XQGames._state.noteIdx = cur;
      }
    }

    /* 把 bd 重摆回标准开局，再把 steps 的前 n 手走一遍 */
    function goto(n) {
      bd.setup(XQ.START_POSITION);
      recs = [];
      badAt = -1;
      var k, turn = XQ.RED;
      for (k = 0; k < n; k++) {
        var st = steps[k];
        if (!st || !st.from || !st.to) { badAt = k; break; }
        var from = st.from[1] * 9 + st.from[0], to = st.to[1] * 9 + st.to[0];
        if (bd.g[from] !== turn) { badAt = k; break; }
        var piece = bd.t[from];
        var r = bd.play(from, to, turn);
        if (!r.ok) { badAt = k; break; }
        var opp = XQ.other(turn);
        recs.push({
          from: from, to: to, color: turn, type: piece, capType: r.rec.capType,
          checked: bd.isChecked(opp), mate: bd.isMate(opp)
        });
        turn = opp;
      }
      cur = badAt >= 0 ? badAt : n;
      syncPieces();
      if (cur > 0 && recs.length) view.setLastMove(recs[recs.length - 1].from, recs[recs.length - 1].to);
      else view.setLastMove(-1, -1);
      syncBar();
      return cur;
    }

    /* 第 k 手（从 1 数）的走法念白 —— 起点 / 落点 / 吃子 / 将军全部由引擎读出来 */
    function moveLine(k) {
      var rec = recs[k - 1];
      if (!rec) return '';
      return moveText(rec.color, rec.from, rec.to, rec.type, rec.capType, rec.checked, rec.mate);
    }

    function showInitial() {
      numEl.textContent = '开局';
      noteEl.textContent = '这是标准开局，红方先行。点「下一手」一手一手往下走 —— ' +
        '右边这一栏跟着换讲解，一共 ' + steps.length + ' 手。';
      mvEl.textContent = '棋盘上的虚圈是这一手的起点，绿圈是落点。';
      sayEl.textContent = '标准开局。红方先行，点「下一手」开始。';
    }

    function showStep(k) {
      var note = notes[k - 1];
      var line = moveLine(k);
      if (!note) {
        /* 数据缺了这一手的讲解 —— 如实说，不拿上一手的顶替 */
        noteEl.textContent = '（这一手的数据里没有讲解，请报给作者。）';
      } else {
        noteEl.textContent = note;
      }
      mvEl.textContent = line + '　·　第 ' + k + ' / ' + steps.length + ' 手';
      sayEl.textContent = line;
      if (recs[k - 1] && recs[k - 1].mate) sayEl.textContent = line + '　黑方无着。';
    }

    function stepForward() {
      if (cur >= steps.length) { sayEl.textContent = '已经走完了 —— 点「从头开始」可以再看一遍。'; return; }
      var want = cur + 1;
      goto(want);
      if (badAt >= 0) {
        noteEl.textContent = '数据里第 ' + (badAt + 1) + ' 手在当前局面下走不出来（这一手不合法）。' +
          '这一局是坏的，请报给作者 —— 页面宁可停在这里，也不假装走过了。';
        mvEl.textContent = '停在第 ' + (badAt + 1) + ' 手。';
        return;
      }
      showStep(want);
    }

    function stepBack() {
      if (cur <= 0) { showInitial(); return; }
      var want = cur - 1;
      goto(want);
      if (want === 0) showInitial();
      else showStep(want);
    }

    function jump(k) {
      goto(k);
      if (badAt >= 0) return;
      if (k === 0) showInitial(); else showStep(k);
      /* 关键手按钮在棋盘下方，跳完把视野带回棋盘（宽屏棋盘是吸附的，这里只是保险） */
      if (global.scrollTo) { try { global.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { global.scrollTo(0, 0); } }
    }

    nextBtn.onclick = stepForward;
    prevBtn.onclick = stepBack;
    restartBtn.onclick = function () { goto(0); showInitial(); };

    if (keyBox) {
      keyBox.onclick = function (e) {
        var t = e.target || e.srcElement;
        while (t && t !== keyBox && !(t.getAttribute && t.getAttribute('data-key-n'))) t = t.parentNode;
        if (t && t !== keyBox) jump(Number(t.getAttribute('data-key-n')));
      };
    }

    /* 先把整条走法走一遍，把终局盘面指纹与「有没有坏手」记下来（供自验脚本比对），再回到第 0 手 */
    goto(steps.length);
    var finalSig = signature(bd);
    var badAll = badAt;

    var ids = [];
    for (i = 0; i < list.length; i++) ids.push(list[i].id);

    setState({
      page: 'games-detail', id: g.id, total: list.length, ids: ids,
      pos: pos, prev: prev ? prev.id : null, next: next ? next.id : null,
      step: 0, steps: steps.length, noteIdx: 0, side: 'r',
      liveSig: finalSig, finalSig: finalSig, badAt: badAll
    });
    goto(0);
    showInitial();
  }

  /* ---------------- 入口 ---------------- */

  function render(host, seg) {
    killAll();
    host = host || el('app');
    seg = seg || [];
    var list = sortedGames();
    var id = seg[1] ? String(seg[1]) : '';
    if (id) return renderDetail(host, list, id);
    return renderList(host, list);
  }

  global.XQGames = XQGames;

})(typeof window !== 'undefined' ? window : this);
