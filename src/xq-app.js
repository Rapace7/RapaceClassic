/* 象棋板块的页面与路由 —— 只依赖 xq-engine.js（规则）与 xq-board.js（绘制）
 *
 * 入口（由 app.js 的路由调用）：
 *   window.XQApp.render(seg, host)
 *     seg  —— hash 的分段数组，**不含 'xq' 前缀**
 *             #/xq                 → seg = []
 *             #/xq/board           → seg = ['board']
 *             #/xq/rules           → seg = ['rules']
 *             #/xq/endgame         → seg = ['endgame']
 *             #/xq/endgame/<题号>  → seg = ['endgame', 'xq-e008']
 *     host —— 容器元素（app.js 里的 #app）
 *
 * 页面：
 *   #/xq         象棋首页（入口卡片；未做的入口点了给提示，不做死链）
 *   #/xq/board   自由摆棋：标准开局 + 真走子（XQ.Board 校验）+ 悔棋 / 重开 / 翻转棋盘
 *   #/xq/rules   规则速查：七种棋子走法 + 小棋盘演示（蹩马腿 / 塞象眼 / 炮隔子 / 兵过河 / 将帅照面）
 *   #/xq/endgame        残局练习列表：题库 31 题按 tier（入门 / 进阶 / 高级）分三组
 *   #/xq/endgame/<id>   残局单题页：摆好局面让用户走一手，与题库正解比对后再给完整思路
 *
 * 题库在 xq-problems.js（window.XQ_PROBLEMS）。**坑**：answers 里存的是坐标
 *   `{from:[x,y], to:[x,y]}`，而棋盘回调给的是引擎下标 —— 两边一律换成 bd.idx(x, y) 再比。
 *
 * 关于样式：本项目不许改 style.css，所以这里优先复用全站现成的类
 *   （.card .entry .entry-grid .pill .btn .row .small .muted .sub .lesson-head .part-title
 *     .demo-wrap .board-shell .board-bar .board-holder .board-say
 *     .prob-layout .prob-board .prob-notes .feedback .explain-block .sol-list .sol-row
 *     .trap-item .principle .hint-list .hint-item），
 *   只有「建设中」的浮动提示必须临时加，才用内联样式。
 *
 * 自验钩子：XQApp._state 保存当前页面的 { page, bd, view, demos, id, solved }。
 *   纯粹给 CDP 自验脚本读局面用（画布上的棋子没法从 DOM 里数），不影响界面行为。
 */
(function (global) {
  'use strict';

  var alive = [];          /* 本次渲染挂上的棋盘，重新渲染前统一销毁（否则 resize 监听会越积越多） */

  var XQApp = {
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

  function mountBoard(canvas, opts) {
    var v = global.XQBoard.mount(canvas, opts);
    alive.push(v);
    return v;
  }

  function killAll() {
    var i;
    for (i = 0; i < alive.length; i++) { try { alive[i].destroy(); } catch (e) { } }
    alive = [];
    var t = document.querySelectorAll('.xq-toast');
    for (i = 0; i < t.length; i++) if (t[i].parentNode) t[i].parentNode.removeChild(t[i]);
  }

  function setState(s) { XQApp._state = s; return s; }

  function sideName(c) { return c === global.XQ.RED ? '红方' : '黑方'; }

  /* ---------------- 入口 ---------------- */

  /* 象棋板块里「导航已经摆出、内容还没做」的入口。
     导航是按「象棋该有的样子」一次摆齐的（对标围棋那 11 个），
     没做的必须给明确提示 —— 点了不能没反应，更不能悄悄回到首页。 */
  /* 象棋板块的导航入口现在**全部有内容**了（首页 / 入门 / 杀法 / 残局 / 开局 / 名局 / 词典 / 摆棋 / 规则）。
     这里留空，将来加新入口再往里放。 */
  var SOON_TABS = {};

  function renderSoon(host, name, desc) {
    host.innerHTML = '<h1>' + esc(name) + '</h1>' +
      '<p class="sub">' + esc(desc) + '</p>' +
      '<div class="card"><p><b>这一块还在建设中。</b>象棋板块目前能用的是' +
      '「残局练习」（31 道题，全部由求解器验证过）、「自由摆棋」和「规则速查」。</p>' +
      '<p class="small muted" style="margin-bottom:0">内容会陆续补上，导航里的入口会一个个变实。</p></div>' +
      '<div class="row" style="margin-top:16px">' +
      '<button class="btn" onclick="location.hash=\'#/xq/endgame\'">去残局练习</button>' +
      '<button class="btn ghost" onclick="location.hash=\'#/xq/board\'">去自由摆棋</button>' +
      '<button class="btn ghost" onclick="location.hash=\'#/xq/rules\'">看规则速查</button></div>';
    setState({ page: name });
  }

  function render(seg, host) {
    killAll();
    seg = seg || [];
    host = host || el('app');
    setState({ page: 'home' });
    var tab = seg[0] || '';
    if (tab === 'board') return renderBoard(host);
    if (tab === 'rules') return renderRules(host);
    if (tab === 'endgame') return seg[1] ? renderEndgameDetail(host, seg[1]) : renderEndgameList(host);
    /* 术语 / 入门课 / 杀法：渲染函数由各自的 ui 文件挂到 window 上（接线时接好）。
       ⚠️ 必须排在 `SOON_TABS` 那行**之前** —— 否则会被「建设中」先截住。 */
    if (tab === 'terms' && window.XQTerms) return window.XQTerms.render(host, seg);
    if (tab === 'lesson' && window.XQLessons) return window.XQLessons.render(host, seg);
    if (tab === 'mates' && window.XQMates) return window.XQMates.render(host, seg);
    if (tab === 'opening' && window.XQOpening) return window.XQOpening.render(host, seg);
    if (tab === 'games' && window.XQGames) return window.XQGames.render(host, seg);
    if (tab === 'selfcheck' && window.XQSelfCheck) return window.XQSelfCheck.render(host, seg);
    if (SOON_TABS[tab]) return renderSoon(host, SOON_TABS[tab][0], SOON_TABS[tab][1]);
    return renderHome(host);
  }

  /* ---------------- 首页 ---------------- */

  function entryCard(t, d, hash, pill) {
    return '<button class="entry" onclick="location.hash=\'' + hash + '\'">' +
      '<div class="t">' + esc(t) + (pill ? ' <span class="pill">' + esc(pill) + '</span>' : '') + '</div>' +
      '<div class="d">' + d + '</div>' +
      '<div class="m">点进去看看 →</div></button>';
  }

  function entrySoon(t, d, what) {
    return '<button class="entry" data-soon="' + esc(what) + '">' +
      '<div class="t">' + esc(t) + ' <span class="pill gray">建设中</span></div>' +
      '<div class="d">' + d + '</div>' +
      '<div class="m">还没做 —— 点了会告诉你，不会没反应</div></button>';
  }

  function bindSoon(host) {
    if (host._xqSoon) host.removeEventListener('click', host._xqSoon);
    function on(ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-soon]') : null;
      if (!b) return;
      toast(b.getAttribute('data-soon') + '还在建设中 —— 先玩「自由摆棋」，或者看看「规则速查」。');
    }
    host._xqSoon = on;
    host.addEventListener('click', on);
  }

  function toast(msg) {
    var old = document.querySelector('.xq-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.className = 'xq-toast';
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:36px;transform:translateX(-50%);' +
      'background:#3c332a;color:#fdfaf5;padding:10px 22px;border-radius:999px;font-size:13.5px;' +
      'box-shadow:0 10px 26px -10px rgba(0,0,0,.45);z-index:200;opacity:0;' +
      'transition:opacity .22s ease;max-width:88vw;text-align:center';
    document.body.appendChild(d);
    if (global.requestAnimationFrame) global.requestAnimationFrame(function () { d.style.opacity = '1'; });
    else d.style.opacity = '1';
    global.setTimeout(function () {
      d.style.opacity = '0';
      global.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 280);
    }, 2100);
  }

  function renderHome(host) {
    setState({ page: 'home' });
    var html = '';
    html += '<div class="hero"><h1>象棋</h1>';
    html += '<p class="sub">「玄清棋典」的中国象棋板块。规则引擎（七种棋子走法、将帅照面、送将、将军、将死与困毙）' +
      '由程序实现并自检；内容按「先认棋盘、再上手、最后读名局」的顺序排 —— 从哪一块进去都行，不必按顺序。</p></div>';

    html += '<div class="entry-grid">';
    html += entryCard('入门课',
      '15 课：从认棋盘、七种棋子怎么走，讲到将军与应将、将死与困毙，再到开局要领和四种基本战术。每课配一张盘面。',
      '#/xq/lesson', '15 课');
    html += entryCard('规则速查',
      '七种棋子各配一张小棋盘演示：蹩马腿、塞象眼、炮隔子、兵过河、将帅照面 —— 象棋最容易讲不清的几处，看图就懂。',
      '#/xq/rules', '可看');
    html += entryCard('基本杀法',
      '22 个固定杀形：马后炮、卧槽马、双车错、铁门栓……每个形都能一步步演示，主变化由求解器算出，不是人编的。',
      '#/xq/mates', '22 形');
    html += entryCard('残局练习',
      '残局与杀法练习：两步杀、三步杀练杀法，四步杀练残局；<b>题面会标明是红先还是黑先</b>。走错了会告诉你为什么错、局面退回重走；走对了再把整条思路摊开。',
      '#/xq/endgame', '31 题');
    html += entryCard('开局体系',
      '19 种常见开局：中炮对屏风马、仙人指路、飞相局……每种都一步步演示，并讲清「为什么这么走」。',
      '#/xq/opening', '19 种');
    html += entryCard('名局讲解',
      '9 盘经典对局（胡荣华、杨官璘、许银川、王天一…）共 910 手，<b>每一手都有讲解</b>，配棋盘一步步放。',
      '#/xq/games', '9 局');
    html += entryCard('术语词典',
      '74 条象棋术语，分基础 / 战术 / 开局 / 残局 / 规则五组。一句话讲清「是什么、怎么用」，可直接搜索。',
      '#/xq/terms', '74 条');
    html += entryCard('自由摆棋',
      '标准开局已经摆好，红先。点自己的棋子选中，再点目标点走子；走不了会告诉你为什么。可以悔棋、重开、翻转棋盘。',
      '#/xq/board', '可玩');
    html += entrySoon('人机对弈', '跟程序下完一整盘棋。', '人机对弈');
    html += '</div>';

    html += '<h2>这一版有什么</h2>';
    html += '<div class="card">' +
      '<ul style="margin:0;padding-left:20px">' +
      '<li><b>入门课</b>：15 课 —— 认棋盘 → 走子规则 → 攻防入门 → 开局要领 → 基本战术，每课配盘面。</li>' +
      '<li><b>规则速查</b>：七种棋子 + 将帅照面，各一张小棋盘，蓝点就是那个子能去的位置。</li>' +
      '<li><b>基本杀法</b>：22 个形，每个形的主变化由求解器求出，不是人写死的。</li>' +
      '<li><b>残局练习</b>：31 道题（杀法 16 + 残局 15），按难度分入门 / 进阶 / 高级三组。' +
      '答案与「错在哪」都由求解器算过 —— 走错不是判死，是让你读一段为什么。</li>' +
      '<li><b>开局体系</b>：19 种开局，每一种的走法都逐手过了规则引擎。</li>' +
      '<li><b>名局讲解</b>：9 局共 910 手逐手讲解；棋谱取自公开棋谱库并逐手走通验证，' +
      '元数据有争议的地方（年份、赛事）都在页面上如实标注。</li>' +
      '<li><b>术语词典</b>：74 条，可搜索。</li>' +
      '<li><b>自由摆棋</b>：在真棋盘上走子，每一步都过规则引擎，非法着法会给理由（不能这样走 / 不能送将 / 不能吃将）。</li>' +
      '<li class="muted">还没有：人机对弈、完整记谱（炮二平五那套）、长将长捉判负、和棋规则。' +
      '这几项引擎侧本来就标注为「未实现」，界面不会假装有。</li>' +
      '</ul></div>';

    host.innerHTML = html;
    bindSoon(host);
  }

  /* ---------------- 自由摆棋 ---------------- */

  function piecesOf(bd) {
    var out = [], i;
    for (i = 0; i < bd.n; i++) {
      if (bd.g[i] === 0) continue;
      out.push([i % 9, (i / 9) | 0, bd.g[i] === global.XQ.RED ? 'r' : 'b', bd.t[i]]);
    }
    return out;
  }

  function rejectText(reason) {
    if (reason === 'nopiece') return '那个位置上没有你的棋子。';
    if (reason === 'shape') return '这个棋子不能这样走 —— 具体走法可以看「规则速查」。';
    if (reason === 'self-check') return '不能这么走：走完你的将/帅会被将军（送将）。';
    if (reason === 'capture-king') return '不能吃将/帅 —— 棋局只能以将死结束。';
    if (reason === 'same') return '原地不动不算走子。';
    if (reason === 'out') return '点到棋盘外面了。';
    return '这手棋不合法。';
  }

  function renderBoard(host) {
    var XQ = global.XQ;
    var html = '';
    html += '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/xq">象棋</a> · 自由摆棋</div>' +
      '<h1>自由摆棋</h1>' +
      '<p class="lede">标准开局已经摆好，红先。点一下自己的棋子把它<b>选中</b>（橙圈），蓝点就是它能走的位置；' +
      '再点目标点即可走子。走不了会告诉你原因。</p></div>';

    html += '<div class="demo-wrap"><div class="board-shell">';
    html += '<div class="board-holder" style="max-width:580px;margin:0 auto">' +
      '<canvas id="xq-canvas"></canvas></div>';
    html += '<div class="board-bar">' +
      '<button class="btn ghost sm" id="xq-undo">悔棋</button>' +
      '<button class="btn ghost sm" id="xq-reset">重开</button>' +
      '<button class="btn ghost sm" id="xq-flip">翻转棋盘</button>' +
      '<span class="pill wood" id="xq-turn">轮到红方</span>' +
      '<span class="small muted" id="xq-count"></span>' +
      '</div>';
    html += '<div class="board-say" id="xq-say">点一个自己的棋子选中它，盘面上的蓝点是可以走的位置。</div>';
    html += '</div></div>';

    host.innerHTML = html;

    var bd = new XQ.Board();
    bd.reset();
    var say = el('xq-say');
    var turn = el('xq-turn');
    var count = el('xq-count');
    var side = 'r';

    var view = mountBoard(el('xq-canvas'), {
      side: side,
      interactive: true,
      onSelect: onSelect,
      onMove: onMove
    });
    setState({ page: 'board', bd: bd, view: view });

    function syncPieces() { view.setPieces(piecesOf(bd)); }

    function refreshBar() {
      turn.textContent = '轮到' + sideName(bd.toMove);
      var n = 0, i;
      for (i = 0; i < bd.n; i++) if (bd.g[i] !== 0) n++;
      count.textContent = '盘上 ' + n + ' 子（红 ' + bd.moves.length + ' 手已走）';
    }

    function refreshLast() {
      if (bd.moves.length) {
        var r = bd.moves[bd.moves.length - 1];
        view.setLastMove(r.from, r.to);
      } else {
        view.setLastMove(-1, -1);
      }
    }

    /* 选中某个子 → 把它全部合法着法算出来当提示点 */
    function onSelect(i) {
      if (i < 0 || bd.g[i] !== bd.toMove) { view.setHints([]); return; }
      var ms = bd.movesFrom(i), out = [], k;
      for (k = 0; k < ms.length; k++) if (bd.isLegal(i, ms[k], bd.toMove)) out.push(ms[k]);
      view.setHints(out);
      if (!out.length) {
        say.textContent = '这个子现在没有可以走的地方（也可能是走了就会被将军）。';
      }
    }

    function onMove(from, to) {
      var color = bd.g[from];
      if (color !== bd.toMove) {
        say.textContent = '现在轮到' + sideName(bd.toMove) + '走 —— 先点' + sideName(bd.toMove) + '的棋子。';
        return false;
      }
      var r = bd.play(from, to, color);
      if (!r.ok) {
        say.textContent = XQ.toLabel(from) + ' → ' + XQ.toLabel(to) + ' 不能走：' + rejectText(r.reason);
        return false;
      }
      syncPieces();
      view.setLastMove(from, to);
      view.setHints([]);

      var msg = sideName(color) + ' ' + XQ.toLabel(from) + ' → ' + XQ.toLabel(to);
      if (r.captured.length) msg += '，吃掉了对方的' + XQ.typeName(r.rec.capType);
      msg += '。';

      var opp = bd.toMove;
      if (bd.isMate(opp)) {
        msg += ' ' + sideName(opp) + (bd.isChecked(opp) ? '被将死' : '无子可动（困毙）') +
          '，' + sideName(color) + '胜。';
      } else if (bd.isChecked(opp)) {
        msg += ' 将军！';
      }
      say.textContent = msg;
      refreshBar();
      return true;
    }

    el('xq-undo').onclick = function () {
      if (!bd.moves.length) { say.textContent = '还没有走过子。'; return; }
      var rec = bd.moves[bd.moves.length - 1];
      bd.undo(rec);
      syncPieces();
      view.clearMarks();
      refreshLast();
      say.textContent = '悔棋：撤回了 ' + sideName(rec.color) + ' 的 ' +
        XQ.toLabel(rec.from) + ' → ' + XQ.toLabel(rec.to) + '。现在轮到' + sideName(bd.toMove) + '。';
      refreshBar();
    };

    el('xq-reset').onclick = function () {
      bd.reset();
      syncPieces();
      view.clearMarks();
      say.textContent = '重开了：回到标准开局，红先。';
      refreshBar();
    };

    el('xq-flip').onclick = function () {
      side = side === 'r' ? 'b' : 'r';
      view.setSide(side);
      say.textContent = '棋盘翻过来了：现在是' + (side === 'r' ? '红方' : '黑方') + '在下方。';
    };

    syncPieces();
    refreshLast();
    refreshBar();
  }

  /* ---------------- 规则速查 ---------------- */

  /* 每种棋子一张小棋盘。pos 与 XQ.Board.setup 同格式；
     picks 是「要演示的子」（会画橙圈，并画出它全部合法着法）；
     ask 是自验脚本要断言的要点（in 必须出现，out 必须不出现）。 */
  var RULES = [
    {
      key: 'R', title: '车 —— 直来直去，不能穿子',
      text: '车走直线：横、竖都可以，步数不限，但<b>路上不能有别的子</b>。碰到第一个子就得停 —— ' +
        '是敌子就吃掉它，是己子就只能停在它前面。盘面上这辆红车往左被自己的兵挡住，' +
        '往上走到黑卒那一格就把它吃掉。',
      pos: [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 5, 'r', 'R'], [4, 2, 'b', 'P'], [1, 5, 'r', 'P']],
      picks: [[4, 5]]
    },
    {
      key: 'N', title: '马 —— 走「日」字，小心蹩马腿',
      text: '马走「日」字：先直一格、再斜一格，一共八个方向。但<b>如果直着那一格有子，这个方向就走不了</b>，' +
        '叫「蹩马腿」。盘面上马腿（它正上方那格）被黑卒占着，所以上面两个方向都被蹩住，' +
        '只剩六个方向能走。',
      pos: [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 5, 'r', 'N'], [4, 4, 'b', 'P']],
      picks: [[4, 5]],
      ask: { in: [[5, 7], [3, 7], [6, 6], [2, 6]], out: [[5, 3], [3, 3]] }
    },
    {
      key: 'B', title: '相（象）—— 走「田」字，塞象眼',
      text: '相走「田」字：四个斜角各走两格。但<b>田字正中间那一格有子，这个方向就过不去</b>，叫「塞象眼」；' +
        '另外相/象<b>不能过河</b>，只在自己这半边走。盘面上右下角那个象眼被黑卒塞住，所以那条线不能走。',
      pos: [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 7, 'r', 'B'], [5, 6, 'b', 'P']],
      picks: [[4, 7]],
      ask: { in: [[2, 5], [2, 9], [6, 9]], out: [[6, 5]] }
    },
    {
      key: 'A', title: '仕（士）—— 九宫里斜走一格',
      text: '仕只能在<b>九宫</b>里活动（棋盘上画了斜线的那 3×3 格），而且只能<b>斜着走一格</b>，' +
        '不能直走。九宫就是将/帅的贴身护卫范围。',
      pos: [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 8, 'r', 'A']],
      picks: [[4, 8]],
      ask: { in: [[3, 9], [5, 9]], out: [[5, 8], [4, 7]] }
    },
    {
      key: 'K', title: '帅（将）—— 九宫里直走一格',
      text: '帅/将也只在九宫里活动，每次<b>直着走一格</b>（不能斜走），不能出宫。' +
        '另外有一条特殊规则：两方的将/帅<b>不能在同一条竖线上直接照面</b>，中间必须有子隔着 —— ' +
        '盘面上那个红兵就正好挡在这条线上。下一张图专门讲「照面」。',
      pos: [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [3, 5, 'r', 'P']],
      picks: [[4, 9]],
      ask: { in: [[4, 8], [3, 9], [5, 9]], out: [[2, 9], [4, 6]] }
    },
    {
      key: 'C', title: '炮 —— 走法同车，吃子要隔一个',
      text: '炮走路和车一样：直线任意格、不能穿子。但<b>吃子时必须隔一个子</b>（那个子叫「炮架」），' +
        '隔两个或紧挨着都吃不到。盘面上红炮往上走：空格能落脚，碰到自己的兵是炮架，' +
        '再往上第一个黑车就能吃掉 —— 中间那两个空格反而落不了子。',
      pos: [[3, 9, 'r', 'K'], [4, 0, 'b', 'K'], [4, 7, 'r', 'C'], [4, 5, 'r', 'P'], [4, 2, 'b', 'R']],
      picks: [[4, 7]],
      ask: { in: [[4, 6], [4, 2]], out: [[4, 5], [4, 4], [4, 3]] }
    },
    {
      key: 'P', title: '兵（卒）—— 过河才能横着走',
      text: '兵/卒每次走一格：没过河<b>只能往前走</b>，过了河才能<b>左右横走</b>，但永远不能后退。' +
        '盘面上右边那个兵还在自己这边，只能往前；左边那个兵已经过了河，除了往前还能左右走。',
      pos: [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [2, 3, 'r', 'P'], [6, 6, 'r', 'P']],
      picks: [[2, 3], [6, 6]],
      ask: { in: [[2, 2], [1, 3], [3, 3], [6, 5]], out: [[2, 4], [5, 6], [7, 6]] }
    },
    {
      key: 'FACE', title: '将帅照面 —— 中间必须有子',
      text: '两方的将/帅不能在同一条竖线上<b>直接照面</b>。盘面上红车正好夹在中间那条线上挡着，' +
        '所以它<b>只能沿着这条竖线上下走</b>：一旦横着让开，两个将/帅就照面了，这手棋违法。' +
        '看蓝点全落在中间这一条竖线上，就明白「照面」是怎么回事了。',
      pos: [[4, 9, 'r', 'K'], [4, 0, 'b', 'K'], [4, 5, 'r', 'R']],
      picks: [[4, 5]],
      ask: { sameCol: 4, count: 7, out: [[3, 5], [5, 5], [0, 5]] }
    }
  ];

  function idxOf(x, y) { return y * 9 + x; }

  function renderRules(host) {
    var XQ = global.XQ;
    var html = '';
    html += '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/xq">象棋</a> · 规则速查</div>' +
      '<h1>规则速查</h1>' +
      '<p class="lede">七种棋子怎么走，加上最容易含糊的「将帅照面」，每种一张小棋盘。' +
      '每张图里<b>橙圈</b>是要讲的棋子，<b>蓝点</b>是它能走到的位置 —— 光看文字记不住的，看图就清楚了。</p></div>';

    html += '<div class="part-title">棋子走法</div>';
    for (var i = 0; i < RULES.length; i++) {
      var d = RULES[i];
      if (i === RULES.length - 1) html += '<div class="part-title">特别规则</div>';
      html += '<div class="card" style="margin-bottom:16px;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">';
      html += '<div class="board-holder" style="flex:0 1 236px;max-width:256px">' +
        '<canvas id="xq-rule-' + d.key + '"></canvas></div>';
      html += '<div style="flex:2 1 320px;min-width:250px">';
      html += '<h3 style="margin-top:0">' + d.title + '</h3>';
      html += '<p style="margin:10px 0 0;line-height:1.9">' + d.text + '</p>';
      html += '<p class="small muted" style="margin:10px 0 0">橙圈 = 要讲的棋子；蓝点 = 它能走的位置；蓝圈 = 可以吃掉的子。</p>';
      html += '</div></div>';
    }

    html += '<div class="card" style="margin-top:6px"><h3 style="margin-top:0">再往下就一句话</h3>' +
      '<p style="margin:8px 0 0">目标只有一个：<b>把对方的将/帅将死</b>（对方被将军又怎么走都被将）。' +
      '中国象棋里，一方无子可动（困毙）同样算输 —— 这点和围棋不一样。' +
      '不允许「把将吃掉」，胜负只能由将死或困毙产生。</p></div>';

    host.innerHTML = html;

    var demos = [];
    for (var k = 0; k < RULES.length; k++) {
      var dm = RULES[k];
      var bd = new XQ.Board();
      bd.setup(dm.pos);
      /* 规则速查里的小演示盘只有 256px 宽，**关掉盘边坐标** ——
         那么小的盘再挤上 A–I / 1–10，字会糊成一团（坐标是给大棋盘对照用的）。 */
      var view = mountBoard(el('xq-rule-' + dm.key), { side: 'r', interactive: false, showLabels: false });
      var hints = [], j, m;
      for (j = 0; j < dm.picks.length; j++) {
        var from = idxOf(dm.picks[j][0], dm.picks[j][1]);
        var ms = bd.movesFrom(from);
        for (m = 0; m < ms.length; m++) {
          if (bd.isLegal(from, ms[m], XQ.RED) && hints.indexOf(ms[m]) < 0) hints.push(ms[m]);
        }
      }
      view.setPieces(dm.pos.map(function (p) { return [p[0], p[1], p[2], p[3]]; }));
      view.setSelection(idxOf(dm.picks[0][0], dm.picks[0][1]));
      view.setHints(hints);
      demos.push({ key: dm.key, title: dm.title, hints: hints, picks: dm.picks });
    }
    setState({ page: 'rules', demos: demos });
  }

  /* ---------------- 残局练习 ---------------- */

  /* 题库：xq-problems.js（原创那批）+ xq-problems2.js（从真实大师对局提取的那批）。
     两批都有红先和黑先 —— 先手方看每道题的 toMove，不要假设是红先。
     两级页面：
       #/xq/endgame        列表页 —— 按 tier 分三组，每题一张卡，点进单题页
       #/xq/endgame/<id>   单题页 —— 摆好 pieces，用户走一手，与 answers[0] 比对
     判定要点：answers 存的是**坐标**，棋盘回调给的是引擎下标，两边都要过 bd.idx(x, y)。 */

  var TIER_ORDER = ['入门', '进阶', '高级'];

  function allProblems() { return global.XQ_PROBLEMS || []; }

  function problemById(id) {
    var list = allProblems(), i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function problemPos(id) {
    var list = allProblems(), i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  /* 难度点：● 重复 level 次（与围棋练习页的写法一致） */
  function dots(n) {
    var s = '', i;
    for (i = 0; i < (n || 0); i++) s += '●';
    return s;
  }

  /* 陷阱条目形如 `at: 'H5-I3（马走到 I3）'` —— 开头永远是「起点-终点」两个坐标名 */
  var TRAP_RE = /^([A-I][0-9]+)-([A-I][0-9]+)/;

  function trapWhy(p, la, lb) {
    var traps = p.traps || [], i, m;
    for (i = 0; i < traps.length; i++) {
      m = TRAP_RE.exec(traps[i].at || '');
      if (m && m[1] === la && m[2] === lb) return traps[i].why;
    }
    return null;
  }

  function endgameCrumb(id) {
    return '<div class="crumb"><a href="#/xq">象棋</a> · ' +
      (id ? '<a href="#/xq/endgame">残局练习</a> · ' + esc(id) : '残局练习') + '</div>';
  }

  function renderEndgameList(host) {
    var list = allProblems(), i, j;
    var html = '';
    html += '<div class="lesson-head">' + endgameCrumb('') +
      '<h1>残局练习</h1>' +
      '<p class="lede">' + list.length + ' 道残局与杀法（红先或黑先，题目里标了）。走的每一手都过规则引擎：' +
      '<b>走错了不判死</b> —— 只会告诉你这一手为什么不行，然后把局面退回你走之前，让你重走；' +
      '走对了再把整条思路和常见错着一起摊开。</p></div>';

    if (!list.length) {
      /* 题库没挂上来（打包漏了 xq-problems.js 之类）——说清楚，别给一个空页面 */
      html += '<div class="card"><h3 style="margin-top:0">题库没加载出来</h3>' +
        '<p style="margin:8px 0 0">页面里找不到 XQ_PROBLEMS —— 大概是打包时漏了 xq-problems.js。' +
        '这一条请报给作者。</p></div>';
      host.innerHTML = html;
      setState({ page: 'endgame-list', total: 0 });
      return;
    }

    /* 分组：按题库里出现过的 tier 走，顺序按 TIER_ORDER 排（以后加新 tier 也不会漏） */
    var tiers = [];
    for (i = 0; i < list.length; i++) if (tiers.indexOf(list[i].tier) < 0) tiers.push(list[i].tier);
    tiers.sort(function (a, b) {
      var ia = TIER_ORDER.indexOf(a), ib = TIER_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    for (i = 0; i < tiers.length; i++) {
      var t = tiers[i], n = 0;
      for (j = 0; j < list.length; j++) if (list[j].tier === t) n++;
      html += '<div class="part-title">' + esc(t) + ' · ' + n + ' 题</div>';
      html += '<div class="entry-grid">';
      for (j = 0; j < list.length; j++) {
        var p = list[j];
        if (p.tier !== t) continue;
        html += '<button class="entry" onclick="location.hash=\'#/xq/endgame/' + esc(p.id) + '\'">' +
          '<div class="t">' + esc(p.id) + ' <span class="pill">' + esc(p.cat + ' · ' + p.theme) + '</span></div>' +
          '<div class="d">' + esc(p.goal) + '</div>' +
          '<div class="m">' + dots(p.level) + ' ' + esc(p.tier) +
          (p.check && p.check.depth ? ' · ' + p.check.depth + ' 个半回合内取胜' : '') +
          ' · 点进去做题 →</div></button>';
      }
      html += '</div>';
    }

    html += '<div class="card" style="margin-top:22px">' +
      '<p style="margin:0"><b>「半回合」怎么算：</b>自己走一手算 1，双方各走一手算 2。' +
      '所以卡片上的「1 个半回合」是一步杀，「3」是两步杀（红走、黑应、红杀）、「5」是三步杀、' +
      '「7」是四步杀。● 是难度档，与入门 / 进阶 / 高级是一回事。</p></div>';

    host.innerHTML = html;
    setState({ page: 'endgame-list', total: list.length });
  }

  function renderEndgameMissing(host, id) {
    host.innerHTML = '<div class="lesson-head">' + endgameCrumb('') +
      '<h1>没有这道题</h1></div>' +
      '<div class="card"><p style="margin:0 0 14px">题库里找不到「' + esc(id) + '」这道题 —— ' +
      '可能是链接写错了，也可能题目改过名。</p>' +
      '<button class="btn" onclick="location.hash=\'#/xq/endgame\'">回残局练习列表</button></div>';
    setState({ page: 'endgame-missing', id: id });
  }

  function renderEndgameDetail(host, id) {
    var XQ = global.XQ;
    var p = problemById(id);
    if (!p) return renderEndgameMissing(host, id);

    var list = allProblems();
    var pos = problemPos(id);
    var prev = pos > 0 ? list[pos - 1] : null;
    var next = (pos >= 0 && pos < list.length - 1) ? list[pos + 1] : null;
    var html = '', i;

    if (!p.answers || !p.answers.length) {
      /* 题库结构不对（没有正解就没法判对错）——如实说，不假装能练 */
      renderEndgameMissing(host, id);
      return;
    }

    html += '<div class="lesson-head">' + endgameCrumb(p.id) +
      '<h1>' + esc(p.id) + ' · ' + esc(p.theme) + '</h1></div>';

    /* 顶部信息卡：题号 / 类别·主题 / 难度·等级 / 轮到谁 / 这一题练什么 */
    html += '<div class="card" style="margin-bottom:16px">';
    html += '<div class="row" style="margin-bottom:10px">' +
      '<span class="pill wood">' + esc(p.id) + '</span>' +
      '<span class="pill">' + esc(p.cat + ' · ' + p.theme) + '</span>' +
      '<span class="pill gray">' + esc(p.tier) + ' · ' + dots(p.level) + '</span>' +
      '<span class="pill gray">' + (p.toMove === 'r' ? '红先' : '黑先') + '</span>' +
      '<span class="spacer"></span>' +
      '<span class="small muted">第 ' + (pos + 1) + ' / ' + list.length + ' 题</span></div>';
    html += '<p class="q-ask">' + esc(p.goal) + '</p>';
    html += '<p class="small muted" style="margin:0">' +
      '能直接将军的着法往往不止一手，能赢的只有一手。想不出来就点「给我提示」，提示一条一条给。' +
      '目标是把黑方的将/帅<b>将死</b>（或困毙），不是把将吃掉。</p>';
    html += '</div>';

    /* 左棋盘（吸附）+ 右提示与反馈 —— 与围棋练习页同一套布局类 */
    html += '<div class="prob-layout"><div class="prob-board">';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += '<div class="board-holder" style="max-width:580px;margin:0 auto">' +
      '<canvas id="xq-eg-canvas"></canvas></div>';
    html += '<div class="board-bar">' +
      '<span class="pill wood" id="xq-eg-turn">轮到' + sideName(p.toMove || 'r') + '</span>' +
      '<span class="small muted" id="xq-eg-tip">点红方棋子选中，再点目标点走子</span></div>';
    html += '<div class="board-say" id="xq-eg-say">红方先行。点红方的棋子选中它（橙圈），' +
      '蓝点就是它能走的格；再点目标点走子。</div>';
    html += '</div></div>';
    html += '<div class="row" style="margin-top:16px">' +
      '<button class="btn ghost" id="xq-eg-hint">给我提示</button>' +
      '<button class="btn ghost" id="xq-eg-show">直接看答案</button></div>';

    /* 逐步演示控制条（默认藏起来）。
       做题时会嫌它占地方，但「看答案」之后要能一手一手地看，
       所以放在棋盘正下方 —— 长讲解会把页面撑得很长，塞到底部就找不着了。 */
    html += '<div class="row" id="xq-eg-demo" style="margin-top:10px;display:none">' +
      '<button class="btn ghost sm" id="xq-dm-first">从头开始</button>' +
      '<button class="btn ghost sm" id="xq-dm-prev">← 上一步</button>' +
      '<button class="btn ghost sm" id="xq-dm-next">下一步 →</button>' +
      '<button class="btn ghost sm" id="xq-dm-all">走到底</button>' +
      '<span class="pill wood" id="xq-dm-count">第 0 / 0 手</span></div>';

    /* 上下题就放在棋盘下面（长讲解会把页面撑得很长，放到最底下就找不着了）。
       到头的一侧置灰，不留死链。 */
    html += '<div class="row" style="margin-top:14px">';
    html += prev
      ? '<button class="btn ghost sm" id="xq-eg-prev">← 上一题 ' + esc(prev.id) + '</button>'
      : '<button class="btn ghost sm" disabled title="已经是第一题">← 上一题</button>';
    html += next
      ? '<button class="btn ghost sm" id="xq-eg-next">下一题 ' + esc(next.id) + ' →</button>'
      : '<button class="btn ghost sm" disabled title="已经是最后一题">下一题 →</button>';
    html += '<span class="spacer"></span>' +
      '<button class="btn ghost sm" onclick="location.hash=\'#/xq/endgame\'">题目列表</button>';
    html += '</div>';

    html += '</div><div class="prob-notes">';
    html += '<div id="xq-eg-hints"></div>';
    html += '<div id="xq-eg-feedback"><p class="small muted" style="margin-top:0">' +
      '这一题的正解只有一手。想好了就在左边棋盘上走：走错了不会判死，只会告诉你这一手为什么不行，' +
      '再把局面退回你走之前。实在想不出来，先点「给我提示」。</p></div>';
    html += '</div></div>';

    host.innerHTML = html;

    var bd = new XQ.Board();
    bd.setup(p.pieces);
    var tFrom = bd.idx(p.answers[0].from[0], p.answers[0].from[1]);
    var tTo = bd.idx(p.answers[0].to[0], p.answers[0].to[1]);
    var ansSet = {};
    for (i = 0; i < p.answers.length; i++) {
      ansSet[bd.idx(p.answers[i].from[0], p.answers[i].from[1]) + '>' +
        bd.idx(p.answers[i].to[0], p.answers[i].to[1])] = 1;
    }

    var sayEl = el('xq-eg-say');
    var turnEl = el('xq-eg-turn');
    var tipEl = el('xq-eg-tip');
    var hintBox = el('xq-eg-hints');
    var fb = el('xq-eg-feedback');

    var solved = false, hintIdx = 0, wrongN = 0;

    /* 逐步演示：主变手顺由 tools/make_xq_mainline.js 用求解器算好，
       存在 src/xq-mainline.js（那条链路由 tools/verify_xq_mainline.js 复核过：
       每一手合法、红黑交替、终局真的是将死）。
       这里只负责"摆出来"，不做任何棋理判断。 */
    var line = (global.XQ_MAINLINE || {})[p.id] || [];
    var demoOn = false, demoPly = 0;

    var view = mountBoard(el('xq-eg-canvas'), {
      side: p.toMove === 'b' ? 'b' : 'r',
      interactive: true,
      onSelect: onSelect,
      onMove: onMove
    });
    setState({ page: 'endgame', id: p.id, bd: bd, view: view, solved: false });

    function sync() { view.setPieces(piecesOf(bd)); }

    /* ---------------- 逐步演示 ---------------- */

    /* 跳到「走完 n 手」的局面。
       实现方式是**从头重摆再重放**，而不是在现有局面上 undo ——
       来回前后跳时不用维护撤销栈，也不会因为顺序错乱把场面搞脏。
       31 道题的主变最长 7 手，重放的代价可以忽略。 */
    function applyLine(n) {
      n = Math.max(0, Math.min(line.length, n));
      bd.setup(p.pieces);
      var bad = false, k;
      for (k = 0; k < n; k++) {
        var m = line[k];
        var f = bd.idx(m.f[0], m.f[1]), t = bd.idx(m.t[0], m.t[1]);
        var r = bd.play(f, t, bd.g[f]);
        if (!r.ok) { bad = true; break; }
      }
      demoPly = bad ? 0 : n;
      sync();
      view.setHints([]);
      if (demoPly > 0) {
        var last = line[demoPly - 1];
        view.setLastMove(bd.idx(last.f[0], last.f[1]), bd.idx(last.t[0], last.t[1]));
      } else {
        view.setLastMove(-1, -1);
      }
      updateDemoUI();
      setTurn();
      if (bad) {
        fb.innerHTML = '<div class="feedback no"><div class="head">手顺走不出来</div>' +
          '<p>主变数据在推进到第 ' + (k + 1) + ' 手时被引擎拒了（' + esc(r.reason) +
          '）。这是数据问题，请报给作者。</p></div>';
      }
      return !bad;
    }

    function updateDemoUI() {
      var cnt = el('xq-dm-count');
      if (!cnt) return;
      cnt.textContent = '第 ' + demoPly + ' / ' + line.length + ' 手';
      el('xq-dm-prev').disabled = demoPly <= 0;
      el('xq-dm-next').disabled = demoPly >= line.length;
      el('xq-dm-all').disabled = demoPly >= line.length;
      el('xq-dm-first').disabled = demoPly <= 0;

      if (demoPly === 0) {
        sayEl.textContent = '这是题目的原始局面。点「下一步」一手一手往下看。';
        tipEl.textContent = '逐步演示 · 还没开始';
      } else {
        var m = line[demoPly - 1];
        sayEl.textContent = (m.c === 'r' ? '红方' : '黑方') + ' 走 ' + m.lb +
          (demoPly >= line.length ? ' —— 将死，整条杀法走完。' : '');
        tipEl.textContent = '第 ' + demoPly + ' / ' + line.length + ' 手';
      }
    }

    function enterDemo() {
      if (!line.length) {
        sayEl.textContent = '这道题没有存主变手顺（数据缺失），请报给作者。';
        return false;
      }
      solved = true;
      XQApp._state.solved = true;
      demoOn = true;
      el('xq-eg-demo').style.display = '';
      el('xq-eg-show').disabled = true;
      el('xq-eg-hint').disabled = true;
      applyLine(1);
      setTurn();
      return true;
    }

    function bindDemo() {
      el('xq-dm-first').onclick = function () { applyLine(0); };
      el('xq-dm-prev').onclick = function () { applyLine(demoPly - 1); };
      el('xq-dm-next').onclick = function () { applyLine(demoPly + 1); };
      el('xq-dm-all').onclick = function () { applyLine(line.length); };
    }
    bindDemo();

    function setTurn() {
      /* 演示模式下轮次是跟着手顺走的，显示「轮到黑方」反而让人以为还能落子 */
      turnEl.textContent = demoOn ? '演示中' : (solved ? '已做对' : '轮到' + sideName(bd.toMove));
    }

    function onSelect(i) {
      if (solved) { view.setHints([]); return; }
      if (i < 0 || bd.g[i] !== bd.toMove) { view.setHints([]); return; }
      var ms = bd.movesFrom(i), out = [], k;
      for (k = 0; k < ms.length; k++) if (bd.isLegal(i, ms[k], bd.toMove)) out.push(ms[k]);
      view.setHints(out);
      if (!out.length) sayEl.textContent = '这个子现在没有可以走的地方（也可能走了就会被将军）。';
    }

    /* 走错时的「为什么」：先用题库里同一步的 traps.why（求解器算的），
       对不上就现场用引擎复算一步 —— 把黑方的应着举出来。 */
    function wrongWhy(from, to) {
      var la = XQ.toLabel(from), lb = XQ.toLabel(to);
      var t = trapWhy(p, la, lb);
      if (t) return t;
      var opp = bd.toMove;                                 /* 这一手走完，轮到黑方 */
      var ms = bd.legalMoves(opp), pick = null, k;
      if (!ms.length) {
        return '这一手之后黑方无子可动 —— 但题库记录的正解不是它，可能是题库有误，请报给作者。';
      }
      for (k = 0; k < ms.length; k++) {                    /* 优先举「将/帅让开」的应着 */
        if (bd.t[ms[k].from] === 'K') { pick = ms[k]; break; }
      }
      if (!pick) pick = ms[0];
      var reply = '「' + XQ.toLabel(pick.from) + '-' + XQ.toLabel(pick.to) + '」';
      if (bd.isChecked(opp)) {
        return '这一手确实将军了，但黑方有应着：黑方可以走 ' + reply + ' 应住，红方的先手就断了。' +
          '杀棋要先封住黑将的退路，再动手。';
      }
      return '这一手<b>没有将军</b> —— 轮到黑方，黑方缓过手来了（例如可以先走 ' + reply + '）。' +
        '杀棋的次序是先封退路、再动手，中间不能给黑方喘气的机会。';
    }

    function solutionHTML() {
      var out = '', k;
      out += '<div class="explain-block"><span class="lbl">完整思路</span><ol class="sol-list">';
      for (k = 0; k < (p.solution || []).length; k++) {
        out += '<li class="sol-row" data-row="' + k + '">' +
          '<span class="sol-n">' + (k + 1) + '</span>' +
          '<span class="sol-t">' + esc(p.solution[k]) + '</span></li>';
      }
      out += '</ol></div>';
      if (p.traps && p.traps.length) {
        out += '<div class="explain-block"><span class="lbl">常见错误</span>';
        for (k = 0; k < p.traps.length; k++) {
          out += '<div class="trap-item"><b>' + esc(p.traps[k].at) + '</b>：' + esc(p.traps[k].why) + '</div>';
        }
        out += '</div>';
      }
      if (p.principle) out += '<div class="principle"><b>记住这条：</b>' + esc(p.principle) + '</div>';
      return out;
    }

    function feedbackHTML(from, to, revealed) {
      var mv = esc(XQ.toLabel(from) + '-' + XQ.toLabel(to));
      var out = '';
      out += '<div class="feedback ok"><div class="head">' + (revealed ? '这是正解' : '就是这一手') + '</div>';
      out += '<p>' + (revealed
        ? '已经把正解「' + mv + '」替你走出来了 —— 棋盘上就是走完之后的局面。'
        : '你走的「' + mv + '」就是这一题的正解。') +
        (line.length > 1
          ? '<b>棋盘底下多了「上一步 / 下一步 / 走到底」，可以一手一手把整条杀法看完（共 ' +
            line.length + ' 手）。</b>'
          : '') +
        '下面是这道题的完整思路，以及几种常见的错着 —— 就算走对了也建议读一遍，' +
        '看看自己的推理和它是不是同一套。</p></div>';
      out += '<div class="card" style="margin-top:16px">' + solutionHTML() + '</div>';
      out += '<div class="row" style="margin-top:16px">';
      if (next) {
        out += '<button class="btn" id="xq-eg-next2">下一题 ' + esc(next.id) + ' →</button>';
      } else {
        out += '<button class="btn" id="xq-eg-next2">这一组做完了，回题目列表</button>';
      }
      out += '</div>';
      return out;
    }

    function bindFooter() {
      var b = el('xq-eg-next2');
      if (!b) return;
      b.onclick = function () {
        location.hash = next ? ('#/xq/endgame/' + next.id) : '#/xq/endgame';
      };
    }

    /* 走对了（或看了答案）：把这一手走出来、摊开完整思路，
       同时**打开逐步演示**并停在第 1 手 —— 之后可以一手一手往下看。
       （原来的实现只走到第一手就没了，多手杀法看不到后面几步。） */
    function finish(from, to, revealed) {
      solved = true;
      XQApp._state.solved = true;
      hintBox.innerHTML = '';
      if (line.length) {
        demoOn = true;
        el('xq-eg-demo').style.display = '';
        el('xq-eg-show').disabled = true;
        el('xq-eg-hint').disabled = true;
        applyLine(1);
      } else {
        /* 没存主变（数据缺失）：退回原来的行为，至少把正解这一手走出来 */
        sync();
        view.setLastMove(from, to);
        view.setHints([]);
      }
      setTurn();
      var mv = XQ.toLabel(from) + '-' + XQ.toLabel(to);
      sayEl.textContent = '红方 ' + mv + '：' + (revealed ? '这就是正解。' : '走对了。') +
        (line.length > 1
          ? '下面可以用棋盘底下的「下一步」一手一手看完整条杀法（一共 ' + line.length + ' 手）。'
          : '');
      tipEl.textContent = revealed ? '这一手是题库记录的正解' : '你找到了正解';
      fb.innerHTML = feedbackHTML(from, to, revealed);
      bindFooter();
    }

    function onMove(from, to) {
      if (solved) {
        sayEl.textContent = demoOn
          ? '现在是演示模式 —— 用棋盘底下的「上一步 / 下一步」看整条杀法。'
          : '这一题已经做完了 —— 点「下一题」接着练，或者回列表另挑一题。';
        return false;
      }
      var color = bd.g[from];
      if (color !== bd.toMove) {
        sayEl.textContent = '现在轮到' + sideName(bd.toMove) + '走 —— 先点红方的棋子。';
        return false;
      }
      var r = bd.play(from, to, color);
      if (!r.ok) {
        sayEl.textContent = XQ.toLabel(from) + '-' + XQ.toLabel(to) + ' 不能走：' + rejectText(r.reason);
        return false;
      }
      var la = XQ.toLabel(from), lb = XQ.toLabel(to);

      if (ansSet[from + '>' + to]) { finish(from, to, false); return true; }

      /* 走错：先按「走完之后」的局面把黑方的应着算出来，再把这一手撤回去。
         返回 false 让棋盘保留选中与蓝点，用户可以直接改点别处重试。 */
      wrongN++;
      var why = wrongWhy(from, to);
      bd.undo(r.rec);
      sync();
      sayEl.textContent = '「' + la + '-' + lb + '」不是正解。局面已经退回你走之前 —— 可以换个着法再试。';
      fb.innerHTML = '<div class="feedback no"><div class="head">这一手不行' +
        (wrongN > 1 ? '（第 ' + wrongN + ' 次）' : '') + '</div>' +
        '<p>你走的是「' + esc(la + '-' + lb) + '」。' + why + '</p>' +
        '<p class="small muted">局面已经回到你走之前，可以换个着法再试；想不出来就点「给我提示」，' +
        '提示会一条一条给，不会一次把答案说完。</p></div>';
      return false;
    }

    el('xq-eg-hint').onclick = function () {
      var steps = p.steps || [];
      if (hintIdx >= steps.length) {
        hintBox.innerHTML += '<p class="small muted" style="margin-top:10px">提示已经全部给完了。' +
          '还走不出来就点「直接看答案」—— 看过答案之后回头把局面再摆一遍，才算真学会。</p>';
        return;
      }
      if (hintIdx === 0) hintBox.innerHTML = '<div class="hint-list"></div>';
      hintBox.querySelector('.hint-list').innerHTML +=
        '<div class="hint-item"><span class="n">' + (hintIdx + 1) + '</span>' +
        '<span>' + esc(steps[hintIdx]) + '</span></div>';
      hintIdx++;
      sayEl.textContent = '提示已给到第 ' + hintIdx + ' 条，在右边。一条一条看，别急着走子。';
    };

    el('xq-eg-show').onclick = function () {
      if (solved) { sayEl.textContent = '这一题已经做完了。'; return; }
      var r = bd.play(tFrom, tTo, bd.toMove);
      if (!r.ok) {
        sayEl.textContent = '题库记录的正解在当前局面下走不出来（可能是题库有误），请报给作者。';
        return;
      }
      finish(tFrom, tTo, true);
    };

    if (prev) el('xq-eg-prev').onclick = function () { location.hash = '#/xq/endgame/' + prev.id; };
    if (next) el('xq-eg-next').onclick = function () { location.hash = '#/xq/endgame/' + next.id; };

    sync();
    setTurn();
  }

  global.XQApp = XQApp;

})(typeof window !== 'undefined' ? window : this);
