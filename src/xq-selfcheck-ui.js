/* 象棋板块 · 实战自测页面 —— 三个工具（学围棋那一套，判据换成象棋的）
 *
 * 入口（接线由作者在 xq-app.js 里做）：
 *   window.XQSelfCheck.render(host, seg)
 *     seg  —— hash 的分段数组，**不含 'xq' 前缀**
 *             #/xq/selfcheck            → seg = ['selfcheck']            （默认「对局自评」）
 *             #/xq/selfcheck/review     → seg = ['selfcheck', 'review']
 *             #/xq/selfcheck/checklist  → seg = ['selfcheck', 'checklist']
 *             #/xq/selfcheck/quiz       → seg = ['selfcheck', 'quiz']
 *     host —— 容器元素（app.js 里的 #app）
 *
 * 依赖（都在 index.html 里，顺序见下）：
 *   window.XQ               xq-engine.js     规则（必须有）
 *   window.XQBoard          xq-board.js      画棋盘（必须有）
 *   window.XQReview         src/xq-review.js  逐手点评引擎（**必须有**）
 *   window.XQ_SELFCHECK     xq-selfcheck.js  常见失误自查表（**必须有**）
 *   window.XQ_PROBLEMS      xq-problems.js  31 道残局（只有「随机测验」需要）
 *
 * ⚠️ 接线时注意：逐手点评引擎在 src/xq-review.js，是**浏览器与 Node 通用**的那个文件，
 *    index.html 必须在 xq-selfcheck-ui.js 之前把它引进来：
 *        &lt;script src="../src/xq-review.js">&lt;/script&gt;
 *        &lt;script src="xq-selfcheck.js">&lt;/script&gt;
 *        &lt;script src="xq-selfcheck-ui.js">&lt;/script&gt;
 *    少一个，页面不会白屏 —— 会明确告诉你缺了什么（不假装能点评）。
 *
 * ── 三个工具 ──────────────────────────────────────────────────
 *   1) 对局自评（核心）：在棋盘上一手一手把自己下过的棋摆出来，**每摆一手立刻给点评** ——
 *      送子 / 漏应 / 错过杀棋 / 放对方成杀 / 兑子亏 / 开局毛病 六类都当面说清，
 *      没问题的手也会给一句中性说明（不沉默）。摆完给一份按类型统计的总结。
 *   2) 常见失误自查表：19 条象棋毛病，一条条对着看，可勾选（只存这次打开，刷新即清空）。
 *   3) 随机测验：从 31 道残局里随机抽 5 题，走一手定对错，最后给一张本次成绩单。
 *
 * ── 说明（诚实过头也好过假装）────────────────────────────────
 *   · 逐手点评只做**规则层**的判断，不评论「大局观」「缓手」「棋形」。算不出来的一律不说。
 *   · 子力判据看的是**一层交换**（我吃 / 他反吃 / 我再吃）。它讲的是「按子力算这笔账」，
 *     不保证算到了后面更大的算路 —— 页面里每一条都按这个口径写。
 *   · 浏览器里没有残局求解器（xq-solver.js 是 Node 工具），所以杀棋判到**一步杀**为止；
 *     更深的杀棋请在命令行跑 `node src/xq-review.js`。这一条会在页面上如实写明。
 *   · 不记进度、不上传、不排名：关掉或刷新就清空，和围棋那三个工具一样。
 */
(function (global) {
  'use strict';

  var alive = [];                     /* 本次渲染挂上的棋盘，重渲染前统一销毁 */
  var session = null;                 /* 对局自评的会话（逐手点评引擎），跨重渲染保留 */

  var XQSelfCheck = {
    render: render,
    _state: { page: 'none', tab: 'review', n: 0, summary: null, quiz: null }
  };

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
      });
  }

  /* 自查表的正文用 **这样** 标重点（xq-selfcheck.js 里就是这么写的）。
     先转义、再换成 <b>，别让 ** 原样露在页面上。 */
  function md(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
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

  function setState(s) { XQSelfCheck._state = s; return s; }

  function rules() { return global.XQ_SELFCHECK || []; }
  function engine() { return global.XQReview; }
  function engineReady() { return !!(engine() && engine().reviewGame && engine().createSession); }

  function checkById(id) {
    var list = rules(), i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function firstCheckByKind(kind) {
    var list = rules(), i;
    for (i = 0; i < list.length; i++) if (list[i].kind === kind) return list[i];
    return null;
  }
  function typeCn(t) { return (global.XQReview && global.XQReview.TYPE_CN && global.XQReview.TYPE_CN[t]) || '子'; }
  function sideName(c) { return c === global.XQ.RED ? '红' : '黑'; }
  function sideCn(c) { return c === global.XQ.RED ? '红方' : '黑方'; }

  function piecesOf(bd) {
    var out = [], i;
    for (i = 0; i < bd.n; i++) {
      if (bd.g[i] === 0) continue;
      out.push([i % 9, (i / 9) | 0, bd.g[i] === global.XQ.RED ? 'r' : 'b', bd.t[i]]);
    }
    return out;
  }

  /* 依赖缺失时的统一说明 —— 不白屏、不装作能用 */
  /* 给读者的「这个工具暂时用不了」卡片 —— **不要暴露内部文件名/变量名**：
     读者是来学棋的，看到 window.XQReview 这种名字只会困惑。
     内部信息留给作者排查，界面上只说清「出了什么、怎么办」。 */
  function missingCard(title) {
    return '<div class="card"><h3 style="margin-top:0">' + esc(title) + '</h3>' +
      '<p style="margin:8px 0 0">这个工具要用的部件没有加载成功。' +
      '通常是打开的文件不完整 —— 请确认用的是完整的「玄清棋典」单文件，或者刷新页面重试一次。</p>' +
      '<p class="small muted" style="margin:8px 0 0">如果反复这样，请把这一条告诉作者。</p></div>';
  }

  /* ======================================================================
   * 一、对局自评（核心）
   * ====================================================================== */

  function reviewTabHTML() {
    var html = '';
    html += '<div class="card" style="margin-bottom:16px">';
    html += '<p style="margin:0 0 8px"><b>对局自评：</b>把你下过的一盘棋（或者正在琢磨的一个变化）' +
      '按顺序摆到棋盘上 —— <b>红先，红黑交替</b>。每摆一手，程序立刻用规则算一遍，' +
      '当场告诉你这一手有没有问题：送子、漏应、错过杀棋、放对方成杀、兑子亏、开局毛病，' +
      '六类都会点出来，并且说清「对方哪一步能吃你、你亏多少、引擎算的替代点在哪儿」。</p>';
    html += '<p class="small muted" style="margin:0">没问题的手也会给一句话（不会沉默）。' +
      '它只算规则与子力，<b>不评论大局观</b>；摆错了随时悔棋，重摆一次就清空。不记进度、不上传。</p>';
    html += '</div>';

    if (!engineReady()) {
      html += missingCard('这一块暂时用不了');
      return html;
    }

    /* 左棋盘（吸附）+ 右点评 —— 与围棋练习页共用 prob-layout。
       2026-09-28 用户要求：棋盘与点评左右分栏，点评放右边，且不缩小棋盘。 */
    html += '<div class="prob-layout"><div class="prob-board">';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += '<div class="board-holder" style="max-width:580px;margin:0 auto">' +
      '<canvas id="xqsc-canvas"></canvas></div>';
    html += '<div class="board-bar">' +
      '<button class="btn ghost sm" id="xqsc-undo">撤销上一手</button>' +
      '<button class="btn ghost sm" id="xqsc-clear">清空重摆</button>' +
      '<button class="btn ghost sm" id="xqsc-flip">翻转棋盘</button>' +
      '<span class="pill wood" id="xqsc-turn">轮到红方</span>' +
      '<span class="small muted" id="xqsc-count"></span>' +
      '</div>';
    html += '<div class="board-say" id="xqsc-say">点红方的棋子选中它（橙圈），蓝点是它能走的格；' +
      '再点目标点落子 —— 落子的同时就会给出这一手的点评。</div>';
    html += '</div></div>';
    html += '</div><div class="prob-notes">';
    html += '<div id="xqsc-now"></div>';
    html += '<div id="xqsc-summary"></div>';
    html += '<h3>逐手点评（点一条展开看理由）</h3>';
    html += '<div class="sc-moves" id="xqsc-moves"></div>';
    html += '</div></div>';
    return html;
  }

  function renderReview(host) {
    host.insertAdjacentHTML('beforeend', reviewTabHTML());
    if (!engineReady()) {
      setState({ page: 'selfcheck', tab: 'review', n: 0, summary: null });
      return;
    }

    var XQ = global.XQ;
    if (!session) session = engine().createSession({});

    var bd = session.board;
    var view = mountBoard(el('xqsc-canvas'), {
      side: 'r', interactive: true, onSelect: onSelect, onMove: onMove
    });
    var sayEl = el('xqsc-say'), turnEl = el('xqsc-turn'), countEl = el('xqsc-count');
    var nowBox = el('xqsc-now'), sumBox = el('xqsc-summary'), listBox = el('xqsc-moves');
    var lastFindings = [], openK = null, side = 'r';

    function sync() {
      view.setPieces(piecesOf(bd));
    }
    function refreshBar() {
      turnEl.textContent = bd.isMate(bd.toMove) ? '棋局结束' : ('轮到' + sideCn(bd.toMove));
      countEl.textContent = '已摆 ' + session.entries().length + ' 条点评 / ' + bd.moves.length + ' 手';
    }
    function refreshLast() {
      if (bd.moves.length) {
        var r = bd.moves[bd.moves.length - 1];
        view.setLastMove(r.from, r.to);
      } else view.setLastMove(-1, -1);
    }

    function onSelect(i) {
      if (i < 0 || bd.g[i] !== bd.toMove) { view.setHints([]); return; }
      var ms = bd.movesFrom(i), out = [], k;
      for (k = 0; k < ms.length; k++) if (bd.isLegal(i, ms[k], bd.toMove)) out.push(ms[k]);
      view.setHints(out);
      if (!out.length) sayEl.textContent = '这个子现在没有能走的地方（也可能走了就会被将军）。';
    }

    function onMove(from, to) {
      var color = bd.g[from];
      if (color !== bd.toMove) {
        sayEl.textContent = '现在轮到' + sideCn(bd.toMove) + '走 —— 先点' + sideCn(bd.toMove) + '的棋子。';
        return false;
      }
      var res = session.push({ from: [from % 9, (from / 9) | 0], to: [to % 9, (to / 9) | 0] });
      if (!res.ok) {
        var f0 = res.findings[0];
        sayEl.textContent = global.XQ.toLabel(from) + ' → ' + global.XQ.toLabel(to) +
          ' 不能这么走：' + (f0 ? f0.why : '这一手不合法');
        return false;
      }
      sync();
      view.setLastMove(from, to);
      /* 把「对方的还手」画成蓝圈：让用户直接看见自己这一步留下了什么 */
      var marks = null, k;
      for (k = 0; k < res.findings.length; k++) if (res.findings[k].marks) marks = res.findings[k].marks;
      view.setHints(marks ? marks.slice(0) : []);
      lastFindings = res.findings;
      openK = null;
      sayEl.textContent = global.XQ.toLabel(from) + ' → ' + global.XQ.toLabel(to) + ' 已落下。';
      render();
      return true;
    }

    /* ---- 当前这一手的点评 ---- */
    function nowHTML() {
      if (!lastFindings.length) {
        return '<div class="feedback" style="background:#faf8f4;border-color:#eae3d7"><div class="head">' +
          '还没有落子</div><p class="small muted" style="margin:0">' +
          '在棋盘上点红方的棋子选中它，再点目标点 —— 落子的同时就会给出这一手的点评。</p></div>';
      }
      var f = lastFindings[0];
      var cls = f.tone === 'bad' ? 'no' : 'ok';
      var html = '<div class="feedback ' + cls + '">';
      html += '<div class="head">第 ' + f.n + ' 手 ' + f.side + ' ' + esc(f.move) + '：' +
        '<span class="sc-tag ' + f.tone + '">' + esc(f.level) + '·' + esc(f.kind) + '</span></div>';
      for (var i = 0; i < lastFindings.length; i++) {
        var e = lastFindings[i], rule = firstCheckByKind(e.kind);
        html += '<p>' + esc(e.why) + '</p>';
        if (e.better) {
          html += '<p><b>引擎给的替代点：</b>' + esc(e.better) + '</p>';
        }
        if (rule) {
          html += '<p class="small muted" style="margin-bottom:0">对症的这一条在自查表里：' +
            '<b>' + esc(rule.title) + '</b> —— 怎么改：' + md(rule.fix) + '</p>';
        }
      }
      html += '</div>';
      return html;
    }

    /* ---- 总结：按问题类型统计 ---- */
    function summaryHTML() {
      var all = session.entries();
      if (!all.length) return '';
      var s = engine().summarize(all);
      var html = '<div class="card sc-summary">';
      var problems = s.problemMoves || 0;
      if (!problems) {
        html += '摆到第 ' + bd.moves.length + ' 手，<b>还没有发现规则层面的问题</b>：' +
          '没有送子、没有漏应、没有给对方杀棋。';
      } else {
        html += '摆到第 ' + bd.moves.length + ' 手：其中有 <b>' + problems + ' 手可以改</b>。';
        html += '<div class="row" style="margin-top:8px">';
        for (var i = 0; i < s.kinds.length; i++) {
          var k = s.kinds[i];
          if (k.kind === '非法着法') continue;
          html += '<span class="pill">' + esc(k.kind) + ' ' + k.n + ' 次</span>';
        }
        html += '</div>';
        /* 出现最多的问题类型 → 指向自查表里对症的那一条 */
        var top = null, j;
        for (j = 0; j < s.kinds.length; j++) if (!top || s.kinds[j].n > top.n) top = s.kinds[j];
        var rule = top ? firstCheckByKind(top.kind) : null;
        if (rule) {
          html += '<p class="small" style="margin:10px 0 0">出现最多的是「<b>' + esc(top.kind) + '</b>」（' +
            top.n + ' 次）—— 先去看自查表里的《' + esc(rule.title) + '》：' + md(rule.fix) + '</p>';
        }
      }
      if (s.worst) {
        html += '<p class="small muted" style="margin:8px 0 0">最要紧的一手：第 ' + s.worst.n + ' 手 ' +
          esc(s.worst.side) + ' ' + esc(s.worst.move) + '（' + esc(s.worst.level) + '·' + esc(s.worst.kind) + '）</p>';
      }
      if (!engine().hasSolver || !engine().hasSolver()) {
        html += '<p class="small muted" style="margin:8px 0 0">本页没有接残局求解器，杀棋只判到<b>一步杀</b>；' +
          '更深的杀棋请在命令行跑 <code>node src/xq-review.js</code>。</p>';
      }
      html += '</div>';
      return html;
    }

    /* ---- 逐手列表 ---- */
    function listHTML() {
      var all = session.entries(), i, j;
      if (!all.length) {
        return '<p class="small muted">还没有摆棋。摆第一手之后，这里会逐手列出点评。</p>';
      }
      var byMove = {}, order = [];
      for (i = 0; i < all.length; i++) {
        if (!byMove[all[i].n]) { byMove[all[i].n] = []; order.push(all[i].n); }
        byMove[all[i].n].push(all[i]);
      }
      order.sort(function (a, b) { return b - a; });
      var html = '';
      for (i = 0; i < order.length; i++) {
        var n = order[i], fs = byMove[n], f0 = fs[0];
        var tags = '', shown = {}, open = (openK === n);
        for (j = 0; j < fs.length; j++) {
          if (shown[fs[j].tone]) continue;
          shown[fs[j].tone] = 1;
          tags += '<span class="sc-tag ' + fs[j].tone + '">' + esc(fs[j].kind) + '</span>';
        }
        html += '<div class="sc-move' + (open ? ' open' : '') + '" data-k="' + n + '">';
        html += '<button class="sc-move-head">' +
          '<span class="sc-no">第 ' + n + ' 手</span>' +
          '<span class="sc-side ' + (f0.side === '黑' ? 'b' : 'w') + '">' + esc(f0.side) + '</span>' +
          tags +
          '<span class="sc-one">' + esc(f0.move + '　' + fs[0].why.slice(0, 46) + (fs[0].why.length > 46 ? '…' : '')) + '</span>' +
          '<span class="sc-arrow">›</span></button>';
        html += '<div class="sc-move-body">';
        if (open) {
          for (j = 0; j < fs.length; j++) {
            var e = fs[j], rule = firstCheckByKind(e.kind);
            html += '<div class="sc-find ' + e.tone + '">';
            html += '<div class="sc-find-head"><span class="sc-tag ' + e.tone + '">' + esc(e.level) + '·' +
              esc(e.kind) + '</span><b>' + esc(e.move) + '</b></div>';
            html += '<p class="sc-find-text">' + esc(e.why) + '</p>';
            if (e.better) html += '<p class="sc-find-text"><b>替代点：</b>' + esc(e.better) + '</p>';
            if (rule) {
              html += '<p class="small muted" style="margin:6px 0 0">自查表《' + esc(rule.title) + '》：' +
                md(rule.fix) + '</p>';
            }
            html += '</div>';
          }
        }
        html += '</div></div>';
      }
      return html;
    }

    function render() {
      nowBox.innerHTML = nowHTML();
      sumBox.innerHTML = summaryHTML();
      listBox.innerHTML = listHTML();
      refreshBar();
      var all = session.entries();
      setState({
        page: 'selfcheck', tab: 'review', n: bd.moves.length,
        lastFindings: lastFindings.slice(), summary: engine().summarize(all)
      });
    }

    listBox.addEventListener('click', function (e) {
      var head = e.target.closest ? e.target.closest('.sc-move-head') : null;
      if (!head) return;
      var k = parseInt(head.parentElement.getAttribute('data-k'), 10);
      if (!k) return;
      openK = (openK === k) ? null : k;
      listBox.innerHTML = listHTML();
    });

    el('xqsc-undo').onclick = function () {
      var p = session.undo();
      if (!p) { sayEl.textContent = '还没摆过棋，没什么可撤的。'; return; }
      sync();
      view.setHints([]);
      refreshLast();
      lastFindings = [];
      openK = null;
      sayEl.textContent = '撤销了第 ' + p.n + ' 手（' + sideCn(p.color) + ' ' + p.label + '），局面回到那一手之前。';
      render();
    };
    el('xqsc-clear').onclick = function () {
      session.reset();
      sync();
      view.clearMarks();
      lastFindings = []; openK = null;
      sayEl.textContent = '棋盘已清空，回到标准开局（红先），可以重新摆一盘。';
      render();
    };
    el('xqsc-flip').onclick = function () {
      side = side === 'r' ? 'b' : 'r';
      view.setSide(side);
      sayEl.textContent = '棋盘翻过来了：现在是' + (side === 'r' ? '红方' : '黑方') + '在下方。';
    };

    sync();
    refreshLast();
    render();
  }

  /* ======================================================================
   * 二、常见失误自查表
   * ====================================================================== */

  var checklist = {};        /* 只存在这次打开的内存里 */

  function renderChecklist(host) {
    var list = rules();
    if (!list.length) {
      host.insertAdjacentHTML('beforeend',
        missingCard('这份清单暂时打不开'));
      setState({ page: 'selfcheck', tab: 'checklist', n: 0, summary: null });
      return;
    }

    var html = '';
    html += '<div class="card" style="margin-bottom:18px">';
    html += '<p style="margin:0 0 8px"><b>常见失误自查表：</b>象棋最容易输棋的 ' + list.length +
      ' 个毛病，一条条对着看。每条都写清了<b>怎么知道自己犯了</b>（现象）、<b>为什么会这样</b>（道理）、' +
      '<b>下次怎么办</b>（做法）。</p>';
    html += '<p class="small muted" style="margin:0">哪几条像自己，就勾上 —— 勾选只存在这次打开里，' +
      '<b>刷新就清空、不上传、不累计</b>。点标题可以展开正文。</p>';
    html += '</div>';
    html += '<div id="xqsc-check-sum"></div>';
    html += '<div class="sc-checks" id="xqsc-checks">';
    for (var i = 0; i < list.length; i++) {
      var c = list[i], on = !!checklist[c.id];
      html += '<div class="sc-check' + (on ? ' on' : '') + '" data-id="' + esc(c.id) + '">';
      html += '<div class="sc-check-head">';
      html += '<button class="sc-tick' + (on ? ' on' : '') + '" data-tick="' + esc(c.id) + '" title="勾选">' +
        (on ? '✓' : '') + '</button>';
      html += '<span class="sc-check-name">' + esc(c.title) + '</span>';
      html += '<span class="sc-tag dull">' + esc(c.kind || '毛病') + '</span>';
      html += '<span class="sc-arrow">›</span></div>';
      html += '<div class="sc-check-body">';
      html += '<p class="small" style="margin:0 0 8px"><b>怎么知道自己犯了：</b>' + md(c.symptom) + '</p>';
      html += '<p class="small" style="margin:0 0 8px"><b>为什么会这样：</b>' + md(c.why) + '</p>';
      html += '<p class="small" style="margin:0 0 8px"><b>下次怎么办：</b>' + md(c.fix) + '</p>';
      if (c.tip) html += '<p class="small muted" style="margin:0">怎么自己发现：' + md(c.tip) + '</p>';
      html += '</div></div>';
    }
    html += '</div>';
    host.insertAdjacentHTML('beforeend', html);

    var listBox = el('xqsc-checks'), sumBox = el('xqsc-check-sum');

    function refreshSummary() {
      var picked = [], i2;
      for (i2 = 0; i2 < list.length; i2++) if (checklist[list[i2].id]) picked.push(list[i2]);
      var txt;
      if (!picked.length) txt = '还没有勾。看到哪一条像自己，就勾上 —— 勾完这里会把最该先改的几条排给你。';
      else {
        var top = picked.slice(0, 3).map(function (x) { return '《' + x.title + '》'; });
        txt = '你勾出了 ' + picked.length + ' 条。这几条最值得先改：' + top.join('、') + '。' +
          '一次只改一两条，改到形成习惯，比一口气记住十条有用。';
      }
      sumBox.innerHTML = '<div class="card sc-summary">' + esc(txt) + '</div>';
    }
    refreshSummary();

    listBox.addEventListener('click', function (e) {
      var tick = e.target.closest ? e.target.closest('.sc-tick') : null;
      if (tick) {
        var id = tick.getAttribute('data-tick');
        if (checklist[id]) delete checklist[id]; else checklist[id] = true;
        var wrap = tick.closest('.sc-check');
        if (wrap) wrap.classList.toggle('on', !!checklist[id]);
        tick.classList.toggle('on', !!checklist[id]);
        tick.textContent = checklist[id] ? '✓' : '';
        refreshSummary();
        return;
      }
      var head = e.target.closest ? e.target.closest('.sc-check-head') : null;
      if (head) head.parentElement.classList.toggle('open');
    });

    setState({ page: 'selfcheck', tab: 'checklist', n: 0, summary: null, checked: Object.keys(checklist).length });
  }

  /* ======================================================================
   * 三、随机测验（从 31 道残局里抽 5 题）
   * ======================================================================
   * 说明：围棋那边的「随机测验」复用的是 app.js 里的 mountProblemAnswer（带提示 / 陷阱 /
   * 多解判定的那一整套）。那个函数是 app.js 闭包里的私有函数，页面里够不着；
   * 象棋的残局页（xq-app.js）也把答题逻辑写在自己的闭包里。
   * 所以这里是一个**精简版**：一题走一手、当场判对错、给完整思路，不重复那套提示系统。 */
  function allProblems() { return global.XQ_PROBLEMS || []; }

  function pick5() {
    var pool = allProblems().slice(), out = [], i, j, tmp;
    for (i = pool.length - 1; i > 0; i--) {      /* 洗牌 */
      j = Math.floor(Math.random() * (i + 1)); tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    for (i = 0; i < pool.length && out.length < 5; i++) out.push(pool[i]);
    return out;
  }

  var quiz = null;      /* { list, idx, results } */

  function quizHTML() {
    if (!quiz) quiz = { list: pick5(), idx: 0, results: [] };
    var list = allProblems();
    var html = '';
    html += '<div class="card" style="margin-bottom:16px">';
    html += '<p style="margin:0 0 8px"><b>随机测验：</b>从 ' + list.length +
      ' 道残局/杀法里随机抽 5 题（全部红先）。每题只要走出<b>正解那一手</b>就算对，' +
      '走错了不会判死 —— 会告诉你为什么不行，局面退回你走之前，可以重试或者直接看答案。' +
      '做完给一张本次成绩单，只有这次的结果，不累计、不排名、不存档。</p>';
    html += '</div>';
    return html;
  }

  function renderQuiz(host) {
    var list = allProblems();
    if (!list.length) {
      host.insertAdjacentHTML('beforeend',
        missingCard('题目暂时调不出来'));
      setState({ page: 'selfcheck', tab: 'quiz', n: 0, summary: null, quiz: null });
      return;
    }
    if (!quiz) quiz = { list: pick5(), idx: 0, results: [] };
    if (quiz.idx >= quiz.list.length) return renderQuizScore(host);

    var P = quiz.list[quiz.idx];
    var html = quizHTML();
    html += '<div class="card" style="margin-bottom:14px">';
    html += '<div class="row">' +
      '<span class="pill">第 ' + (quiz.idx + 1) + ' / ' + quiz.list.length + ' 题</span>' +
      '<span class="pill wood">' + esc(P.cat + ' · ' + P.theme) + '</span>' +
      '<span class="pill gray">' + esc(P.tier || '') + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn ghost sm" id="xqsc-qnew">换一组题</button></div>';
    html += '<p class="q-ask" style="margin-top:12px">' + esc(P.goal) + '</p>';
    html += '<p class="small muted" style="margin:0">点红方的棋子选中，再点目标点 —— 走一手定对错。' +
      '想不出来就先点「给我提示」。</p></div>';
    html += '<div class="prob-layout"><div class="prob-board">';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += '<div class="board-holder" style="max-width:560px;margin:0 auto">' +
      '<canvas id="xqsc-qcanvas"></canvas></div>';
    html += '<div class="board-bar"><span class="pill wood" id="xqsc-qturn">轮到红方</span>' +
      '<span class="small muted" id="xqsc-qtip">点红方的棋子选中，再点目标点走子</span></div>';
    html += '<div class="board-say" id="xqsc-qsay">红方先行。</div>';
    html += '</div></div>';
    html += '<div class="row" style="margin-top:14px">' +
      '<button class="btn ghost" id="xqsc-qhint">给我提示</button>' +
      '<button class="btn ghost" id="xqsc-qshow">直接看答案</button></div>';
    html += '</div><div class="prob-notes"><div id="xqsc-qhints"></div>' +
      '<div id="xqsc-qfb"></div></div></div>';
    host.insertAdjacentHTML('beforeend', html);

    var QXQ = global.XQ;
    var bd = new QXQ.Board();
    bd.setup(P.pieces);
    var ansSet = {}, i;
    for (i = 0; i < (P.answers || []).length; i++) {
      ansSet[bd.idx(P.answers[i].from[0], P.answers[i].from[1]) + '>' +
        bd.idx(P.answers[i].to[0], P.answers[i].to[1])] = 1;
    }
    var tFrom = P.answers && P.answers.length ? bd.idx(P.answers[0].from[0], P.answers[0].from[1]) : -1;
    var tTo = P.answers && P.answers.length ? bd.idx(P.answers[0].to[0], P.answers[0].to[1]) : -1;

    var sayEl = el('xqsc-qsay'), fbBox = el('xqsc-qfb'), hintBox = el('xqsc-qhints');
    var solved = false, hintIdx = 0;

    var view = mountBoard(el('xqsc-qcanvas'), {
      side: 'r', interactive: true, onSelect: qSelect, onMove: qMove
    });

    function qSelect(idx) {
      if (solved || idx < 0 || bd.g[idx] !== bd.toMove) { view.setHints([]); return; }
      var ms = bd.movesFrom(idx), out = [], k;
      for (k = 0; k < ms.length; k++) if (bd.isLegal(idx, ms[k], bd.toMove)) out.push(ms[k]);
      view.setHints(out);
    }

    function solutionHTML() {
      var out = '', k;
      out += '<h3 style="margin-top:0">完整思路</h3><ol style="margin:8px 0;padding-left:20px">';
      for (k = 0; k < (P.solution || []).length; k++) out += '<li>' + esc(P.solution[k]) + '</li>';
      out += '</ol>';
      if (P.traps && P.traps.length) {
        out += '<p style="margin:12px 0 4px"><b>常见错误</b></p>';
        for (k = 0; k < P.traps.length; k++) {
          out += '<p class="small" style="margin:0 0 6px"><b>' + esc(P.traps[k].at) + '</b>：' +
            esc(P.traps[k].why) + '</p>';
        }
      }
      if (P.principle) out += '<p class="small" style="margin:10px 0 0"><b>记住这条：</b>' + esc(P.principle) + '</p>';
      return out;
    }

    function finish(from, to, revealed) {
      solved = true;
      view.setPieces(piecesOf(bd));
      view.setHints([]);
      view.setLastMove(from, to);
      var mv = QXQ.toLabel(from) + '-' + QXQ.toLabel(to);
      quiz.results.push({
        P: P, ok: !revealed,
        mv: revealed ? '（看了解析）' : mv,
        ans: (P.answers || []).map(function (a) {
          return QXQ.toLabel(bd.idx(a.from[0], a.from[1])) + '-' + QXQ.toLabel(bd.idx(a.to[0], a.to[1]));
        }).join(' / ')
      });
      sayEl.textContent = '红方 ' + mv + (revealed ? '：这就是正解。' : '：走对了。');
      hintBox.innerHTML = '';
      fbBox.innerHTML = '<div class="card" style="margin-top:16px">' + solutionHTML() +
        '<div class="row" style="margin-top:14px"><button class="btn" id="xqsc-qnext">' +
        (quiz.idx < quiz.list.length - 1 ? '下一题 →' : '看成绩单 →') + '</button></div></div>';
      var nb = el('xqsc-qnext');
      if (nb) nb.onclick = function () { quiz.idx++; renderSelfCheckTab('quiz'); };
      var st = XQSelfCheck._state;
      st.quiz = { idx: quiz.idx, results: quiz.results.length };
    }

    function qMove(from, to) {
      if (solved) { sayEl.textContent = '这一题已经做完了 —— 点「下一题」接着来。'; return false; }
      var color = bd.g[from];
      if (color !== bd.toMove) { sayEl.textContent = '现在轮到' + sideCn(bd.toMove) + '走。'; return false; }
      var r = bd.play(from, to, color);
      if (!r.ok) {
        sayEl.textContent = QXQ.toLabel(from) + '-' + QXQ.toLabel(to) + ' 不能走（' + r.reason + '）。';
        return false;
      }
      if (ansSet[from + '>' + to]) { finish(from, to, false); return true; }
      /* 走错：不是正解。只说这一手本身的事实（有没有将军），不硬凑「黑方会怎么走」——
         那要算棋，这儿算不出来就不说。局面退回重来。 */
      var gaveCheck = bd.isChecked(bd.toMove);
      bd.undo(r.rec);
      view.setPieces(piecesOf(bd));
      view.setHints([]);
      sayEl.textContent = '「' + QXQ.toLabel(from) + '-' + QXQ.toLabel(to) +
        '」不是正解 —— 局面已退回你走之前，可以换个着法再试。';
      fbBox.innerHTML = '<div class="feedback no"><div class="head">这一手不行</div>' +
        '<p>你走的是「' + esc(QXQ.toLabel(from) + '-' + QXQ.toLabel(to)) + '」。' +
        (gaveCheck ? '这一手确实将军了，但黑方有解 —— 杀棋的<b>次序</b>不对。'
                   : '这一手没有将军，黑方就缓过手来了。') +
        '杀棋讲次序：先封退路，再动手，中间不给对方喘气的机会。</p>' +
        '<p class="small muted" style="margin-bottom:0">想不出来就点「给我提示」，提示一条一条给。</p></div>';
      return false;
    }

    el('xqsc-qnew').onclick = function () { quiz = null; renderSelfCheckTab('quiz'); };
    el('xqsc-qhint').onclick = function () {
      var steps = P.steps || [];
      if (hintIdx >= steps.length) {
        hintBox.innerHTML += '<p class="small muted" style="margin-top:8px">提示给完了。' +
          '还走不出来就点「直接看答案」—— 看过之后回头再摆一遍，才算真学会。</p>';
        return;
      }
      if (hintIdx === 0) hintBox.innerHTML = '<div class="hint-list"></div>';
      hintBox.querySelector('.hint-list').innerHTML +=
        '<div class="hint-item"><span class="n">' + (hintIdx + 1) + '</span><span>' +
        esc(steps[hintIdx]) + '</span></div>';
      hintIdx++;
      sayEl.textContent = '提示已给到第 ' + hintIdx + ' 条，在右边。';
    };
    el('xqsc-qshow').onclick = function () {
      if (solved) { sayEl.textContent = '这一题已经做完了。'; return; }
      var r = bd.play(tFrom, tTo, bd.toMove);
      if (!r.ok) { sayEl.textContent = '题库记录的正解在当前局面下走不出来（可能是题库有误），请报给作者。'; return; }
      finish(tFrom, tTo, true);
    };

    view.setPieces(piecesOf(bd));
    setState({ page: 'selfcheck', tab: 'quiz', n: 0, summary: null, quiz: { idx: quiz.idx, results: quiz.results.length } });
  }

  function renderQuizScore(host) {
    var rs = quiz.results, okN = 0, i;
    for (i = 0; i < rs.length; i++) if (rs[i].ok) okN++;
    var html = quizHTML();
    html += '<div class="card sc-summary"><div class="sc-score-n">这一组做对 ' + okN + ' / ' +
      rs.length + ' 题</div>' +
      '<p class="small muted" style="margin:6px 0 0">这只是这一组题的一次结果，不累计、不存档。' +
      '<b>错的那几道，把原因读一遍，比多对两道有用。</b></p></div>';
    html += '<div class="row" style="margin:16px 0"><button class="btn" id="xqsc-qagain">再来一组</button></div>';
    html += '<div class="sc-score-list">';
    for (i = 0; i < rs.length; i++) {
      var r = rs[i], P = r.P;
      html += '<div class="sc-score-item ' + (r.ok ? 'ok' : 'no') + '">';
      html += '<div class="row" style="margin-bottom:4px"><span class="sc-tag ' + (r.ok ? 'good' : 'bad') + '">' +
        (r.ok ? '答对' : '答错') + '</span><b>第 ' + (i + 1) + ' 题 · ' + esc(P.id + ' ' + P.theme) + '</b></div>';
      html += '<div class="small muted sc-score-ask">' + esc(P.goal) + '</div>';
      html += '<div class="small" style="margin-top:4px">你走的：' + esc(r.mv) +
        '　正解：<b>' + esc(r.ans) + '</b></div>';
      if (P.principle) html += '<div class="small muted" style="margin-top:4px">原因：' + esc(P.principle) + '</div>';
      html += '</div>';
    }
    html += '</div>';
    host.insertAdjacentHTML('beforeend', html);
    el('xqsc-qagain').onclick = function () { quiz = null; renderSelfCheckTab('quiz'); };
    setState({ page: 'selfcheck', tab: 'quiz', n: 0, summary: null, quiz: { done: true, ok: okN, total: rs.length } });
  }

  /* ======================================================================
   * 页面外壳：三个工具一个壳，用按钮切换（同时认 hash，方便直链）
   * ====================================================================== */

  var TAB_NAMES = { review: '对局自评', checklist: '常见失误自查表', quiz: '随机测验' };

  function renderSelfCheckTab(tab) {
    killAll();
    var host = el('xqsc-body');
    if (!host) return;
    host.innerHTML = '';
    if (tab === 'checklist') return renderChecklist(host);
    if (tab === 'quiz') return renderQuiz(host);
    return renderReview(host);
  }

  function render(host, seg) {
    killAll();
    seg = seg || [];
    host = host || el('app');
    var tab = seg[1];
    if (!TAB_NAMES[tab]) tab = 'review';

    var html = '';
    html += '<div class="lesson-head"><div class="crumb"><a href="#/xq">象棋</a> · 实战自测</div>' +
      '<h1>实战自测</h1>' +
      '<p class="lede">三个工具，判据全部由程序算出来（规则引擎 + 子力交换），不靠感觉、不联网、' +
      '不记进度、不排名、不上传。摆完、看完，关掉就清空，随时可以重来。</p></div>';

    html += '<div class="filter-bar">';
    for (var k in TAB_NAMES) {
      if (!Object.prototype.hasOwnProperty.call(TAB_NAMES, k)) continue;
      html += '<button class="' + (tab === k ? 'on' : '') + '" data-tab="' + k + '">' + TAB_NAMES[k] + '</button>';
    }
    html += '</div>';
    html += '<div id="xqsc-body"></div>';
    host.innerHTML = html;

    var bar = host.querySelector('.filter-bar');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (!b) return;
      var t = b.getAttribute('data-tab');
      if (t === tab) return;
      tab = t;
      var bs = bar.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-tab') === t);
      renderSelfCheckTab(t);
    });

    renderSelfCheckTab(tab);
    setState({ page: 'selfcheck', tab: tab, n: session ? session.board.moves.length : 0, summary: null });
  }

  global.XQSelfCheck = XQSelfCheck;

})(typeof window !== 'undefined' ? window : this);
