/* 玄清棋典 —— 应用逻辑 */
(function () {
  'use strict';

  var E = window.GoEngine;
  var Board = E.Board;
  var BLACK = E.BLACK, WHITE = E.WHITE, EMPTY = E.EMPTY;

  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var gameSwitch = document.getElementById('game-switch');   /* 棋种切换：围棋 / 象棋 / 国际象棋 */
  var headerEl = document.querySelector('header');

  /* 顶栏高度写进 CSS 变量 `--header-h`。
     为什么需要：导航按钮允许换行（窄窗口时「实战自测」「摆棋」几个会掉到第二行），
     顶栏一变高，棋盘 sticky 的偏移量就得跟着走 —— 原来硬编码 76px，换行后会把棋盘顶部遮住。 */
  function syncHeaderH() {
    if (headerEl) {
      document.documentElement.style.setProperty('--header-h', headerEl.offsetHeight + 'px');
    }
  }
  syncHeaderH();
  window.addEventListener('resize', syncHeaderH);

  /* ================= 进度存储 ================= */
  var KEY = 'xuanqing-qidian-v1';
  var store = {
    data: { lessons: {}, problems: {} },
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) {
          var o = JSON.parse(raw);
          if (o && typeof o === 'object') {
            this.data.lessons = o.lessons || {};
            this.data.problems = o.problems || {};
          }
        }
      } catch (e) { /* 忽略 */ }
      return this.data;
    },
    save: function () {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 忽略 */ }
    },
    lessonDone: function (id) { return !!this.data.lessons[id]; },
    markLesson: function (id) { this.data.lessons[id] = 1; this.save(); },
    probState: function (id) { return this.data.problems[id] || 0; },
    markProblem: function (id, ok) { this.data.problems[id] = ok ? 1 : 2; this.save(); },
    reset: function () { this.data = { lessons: {}, problems: {} }; this.save(); }
  };
  store.load();

  /* ================= 工具 ================= */
  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 支持 **粗体** 行内标记；`\n`（反斜杠+n，写在讲解文本里）表示另起一段。
     为什么需要分段：关键手的讲解可以写到 400–600 字，挤成一整段读起来很累。 */
  function md(s) {
    return esc(s)
      .replace(/\\n/g, '</p><p>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  /* ---------- 讲解里的坐标 ↔ 棋盘联动 ----------
     用户反馈：详解里说「白棋下在 C19」，初学者看不出 C19 在哪一格。
     做法：把讲解文本里的 GTP 坐标（A19…T1，字母不含 I）认出来，
     渲染成一个可点的小标签；点一下就把它在棋盘上亮出来。
     坐标互转：x 左→右 0..size-1，y 上→下 0..size-1，(0,0) 是左上角 A19。
     与 engine.js 的 toLabel 互为逆运算。 */
  var GTP_LETTERS = 'ABCDEFGHJKLMNOPQRST';

  function labelToXY(lbl, size) {
    var m = /^([A-HJ-T])(\d{1,2})$/.exec(String(lbl).toUpperCase());
    if (!m) return null;
    var x = GTP_LETTERS.indexOf(m[1]);
    var num = parseInt(m[2], 10);
    if (x < 0 || x >= size || num < 1 || num > size) return null;
    return [x, size - num];
  }

  /* 按出现顺序取出文字里所有坐标：返回 [{lbl,x,y}]，盘外的假坐标自动丢掉 */
  function gtpHits(text, size) {
    var s = String(text == null ? '' : text), out = [];
    var re = /([A-HJ-T])(\d{1,2})/g, m;
    while ((m = re.exec(s))) {
      if (/[A-Za-z]/.test(s.charAt(m.index - 1))) continue;          /* 前面粘着字母，不是坐标 */
      if (/[0-9]/.test(s.charAt(m.index + m[0].length))) continue;   /* 后面还跟着数字，不是坐标 */
      var xy = labelToXY(m[1] + m[2], size);
      if (xy) out.push({ lbl: m[1] + m[2], x: xy[0], y: xy[1] });
    }
    return out;
  }

  /* 把文字里的坐标包成可点标签；其余部分仍走 md()（转义 + 粗体 + 分段）。
     注意先 esc 再替换：坐标只由大写字母和数字组成，转义不会碰坏它。 */
  function linkCoords(text, size) {
    var html = esc(text == null ? '' : text);
    var re = /([A-HJ-T])(\d{1,2})/g;
    html = html.replace(re, function (all, L, num, off, whole) {
      if (/[A-Za-z]/.test(whole.charAt(off - 1))) return all;
      if (/[0-9]/.test(whole.charAt(off + all.length))) return all;
      var xy = labelToXY(L + num, size);
      if (!xy) return all;
      return '<button type="button" class="coord-chip" data-xy="' + xy[0] + ',' + xy[1] + '">' + L + num + '</button>';
    });
    return html.replace(/\\n/g, '</p><p>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  function h(tag, cls, txt) {
    return '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>' + (txt || '') + '</' + tag + '>';
  }

  /* 棋盘容器：路数越多，容器就要越大，否则格子小得看不清子。
     尺寸在 style.css 里按 .sz9 / .sz13 / .sz19 分别定义。 */
  function boardHolder(canvasId, size, extraCls) {
    var sz = size || 19;
    var cls = 'board-holder sz' + sz + (extraCls ? ' ' + extraCls : '');
    return '<div class="' + cls + '"><canvas id="' + canvasId + '"></canvas></div>';
  }

  /* 记录当前页面上挂载的棋盘，切换视图时清掉监听 */
  var mounted = [];
  function mountBoard(canvas, opts) {
    var v = new GoBoardView(canvas, opts);
    if (canvas) canvas.__boardView = v;   /* 挂一份引用，方便测试/调试读棋盘状态 */
    mounted.push(v);
    return v;
  }
  function unmountAll() {
    for (var i = 0; i < mounted.length; i++) {
      if (mounted[i].destroy) mounted[i].destroy();
    }
    mounted = [];
    /* 词典模块（glossary-ui.js）自己管棋盘视图与 window resize 监听，不在上面这个数组里，
       切页时也要一并清掉 —— 否则离开词典页后监听会残留。 */
    if (window.GoGlossary && window.GoGlossary.unmount) {
      try { window.GoGlossary.unmount(); } catch (e) { }
    }
  }

  function reasonText(r) {
    return r === 'suicide' ? '落子后自己一口气都没有，是禁入点'
      : r === 'occupied' ? '这个点已经有子了'
        : r === 'ko' ? '打劫禁着，不能马上提回来'
          : '不能下';
  }

  /* 用引擎算出「下在这一点的实际后果」—— 用于答错时的精准讲解 */
  function analyzeMove(P, pt) {
    var bd = new Board(P.size);
    bd.setup(P.stones);
    var color = P.toMove === 'b' ? BLACK : WHITE;
    var opp = color === BLACK ? WHITE : BLACK;
    var i = bd.idx(pt[0], pt[1]);
    var r = bd.play(i, color);
    if (!r.ok) {
      return { legal: false, reason: r.reason, text: '这个点' + reasonText(r.reason) + '。' };
    }
    var caps = r.captured.length;

    /* 对方所有棋块中气最少的那块 */
    var seen = new Uint8Array(bd.n), minLib = 999, chains = 0, atariChains = 0;
    for (var k = 0; k < bd.n; k++) {
      if (bd.g[k] === opp && !seen[k]) {
        var g = bd.group(k);
        for (var t = 0; t < g.stones.length; t++) seen[g.stones[t]] = 1;
        chains++;
        if (g.libs.length < minLib) minLib = g.libs.length;
        if (g.libs.length === 1) atariChains++;
      }
    }
    var selfGrp = bd.group(i);
    var selfLib = selfGrp ? selfGrp.libs.length : 0;
    bd.undo(r.rec);

    return {
      legal: true, caps: caps, minLib: minLib, chains: chains,
      atariChains: atariChains, selfLib: selfLib, point: pt
    };
  }

  /* 把一次落子的后果写成一句人话 */
  function consequenceText(a) {
    if (!a.legal) return a.text;
    var parts = [];
    if (a.caps > 0) parts.push('提掉了 ' + a.caps + ' 颗子');
    else parts.push('一颗子都没提到');
    if (a.atariChains > 0) parts.push('对方有 ' + a.atariChains + ' 块棋被打了吃（只剩 1 口气）');
    else if (a.minLib < 999) parts.push('对方最少的那块棋还有 ' + a.minLib + ' 口气');
    parts.push('你自己这手棋落下后有 ' + a.selfLib + ' 口气');
    return parts.join('，') + '。';
  }

  /* ================= 返回上一级 =================
     这是**层级**返回，不是历史返回：不管你从哪儿进的这一页，点它永远去
     当前页面的上一级（题目详情 → 题目列表 → 首页）。首页没有上一级，不显示按钮。 */
  var BOARD_NAME = { xq: '象棋', shogi: '将棋', chess: '国际象棋' };

  /* 各板块子页的名字（写进按钮文案：「← 回 入门课」） */
  var SUB_NAME = {
    xq: { lesson: '入门课', rules: '规则速查', mates: '基本杀法', endgame: '残局练习',
      opening: '开局体系', games: '名局讲解', terms: '术语词典', board: '自由摆棋' },
    shogi: { lesson: '入门课', rules: '规则速查', tsume: '诘将棋', tesuji: '手筋', joseki: '定迹',
      games: '名局', terms: '术语词典', selfcheck: '实战自测', board: '自由摆棋' },
    chess: { lesson: '入门课', rules: '规则速查', tactics: '战术题', endgame: '残局', opening: '开局',
      games: '名局', terms: '术语词典', selfcheck: '实战自测', board: '自由摆棋' }
  };

  /* 围棋的顶层页（它们的上一级是首页） */
  var GO_TOP = { lessons: 1, training: 1, history: 1, games: 1, problems: 1,
    glossary: 1, joseki: 1, shapes: 1, board: 1, selfcheck: 1 };

  /* 围棋的详情页 → 它所属的那个列表页 */
  var GO_DETAIL = {
    lesson: ['lessons', '系统课程'],
    tlesson: ['training', '训练方法'],
    hlesson: ['history', '围棋思维史'],
    game: ['games', '名局详解'],
    problem: ['problems', '分级练习'],
    glossary: ['glossary', '术语词典'],
    joseki: ['joseki', '定式库'],
    shape: ['shapes', '死活形图库'],
    selfcheck: ['selfcheck', '实战自测']
  };

  /* 当前路由的上一级；返回 null 表示已经在首页 */
  function parentOf(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (h === '' || h === '/') return null;
    var seg = h.split('/').filter(function (s) { return s !== ''; });
    if (!seg.length) return null;

    /* 象棋 / 将棋 / 国际象棋：#/板块[/子页[/条目]] */
    if (BOARD_NAME[seg[0]]) {
      var b = seg[0];
      if (seg.length === 1) return { hash: '#/', label: '首页' };
      if (seg.length === 2) return { hash: '#/' + b, label: BOARD_NAME[b] };
      return { hash: '#/' + b + '/' + seg[1], label: (SUB_NAME[b] || {})[seg[1]] || BOARD_NAME[b] };
    }

    /* 围棋：#/列表页 → 首页 */
    if (seg.length === 1) return { hash: '#/', label: '首页' };

    /* 围棋：#/详情页 → 对应的列表页 */
    var d = GO_DETAIL[seg[0]];
    if (!d) return { hash: '#/', label: '首页' };
    /* 题目详情优先回到它所在的那一个分类，而不是整个题库 */
    if (seg[0] === 'problem') {
      var want = decodeURIComponent(seg[1] || ''), p = null, i;
      for (i = 0; i < PROBLEMS.length; i++) if (PROBLEMS[i].id === want) p = PROBLEMS[i];
      if (p && p.cat) return { hash: '#/problems/' + encodeURIComponent(p.cat), label: '分级练习' };
    }
    return { hash: '#/' + d[0], label: d[1] };
  }

  /* 各页面标题上方原有的「← 返回XX」文字链接，跟新的胶囊按钮功能重复 —— 统一去掉。
     注意保留「系统课程 ／ 入门篇 ／ 第 3 课」这类**层级信息**（它们不含 ←）。
     在运行时清一次，比去改十个文件里几十处字符串安全得多。 */
  function tidyCrumb() {
    var cs = app.querySelectorAll('.crumb'), i, j;
    for (i = 0; i < cs.length; i++) {
      var box = cs[i];
      if ((box.textContent || '').indexOf('←') < 0) continue;
      var links = box.querySelectorAll('a, button'), hit = false;
      for (j = 0; j < links.length; j++) {
        if ((links[j].textContent || '').indexOf('←') >= 0) {
          links[j].parentNode.removeChild(links[j]);
          hit = true;
        }
      }
      /* 去掉链接后如果只剩分隔符（「·」「／」这些），整块也收掉 */
      var rest = (box.textContent || '').replace(/[\s　·／\/→]/g, '');
      if (!hit || !rest) box.style.display = 'none';
    }
  }

  function mountBack() {
    var old = document.getElementById('back-bar');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var up = parentOf(location.hash);
    if (!up) return;                        /* 首页：没有上一级，不显示 */
    var bar = document.createElement('div');
    bar.id = 'back-bar';
    bar.className = 'back-bar';
    bar.innerHTML = '<a class="btn-back" href="' + up.hash + '">' +
      '<span class="ar">←</span>回' + esc(up.label) + '</a>';
    app.insertBefore(bar, app.firstChild);
  }

  /* ================= 路由 ================= */
  function go(hash) { location.hash = hash; }

  function route() {
    routeInner();
    tidyCrumb();
    mountBack();
    /* 导航换行会让顶栏变高 → 路由切换后重新量一次顶栏高度；
       rAF 再量一次，拿的是重排之后的准确值。 */
    syncHeaderH();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncHeaderH);
  }

  function routeInner() {
    unmountAll();
    var hash = location.hash.replace(/^#\/?/, '');
    var seg = hash.split('/');
    var view = seg[0] || 'home';

    /* 棋盘重的页面放宽容器：两栏排布（棋盘吸附 + 讲解并排）需要横向空间。
       默认 1080px 会让右侧讲解栏只剩三百来像素，中文一行二十来个字，很难读。 */
    app.className = (view === 'problem' || view === 'selfcheck' || view === 'game') ? 'wide' : '';

    /* ---- 棋种切换（围棋 / 象棋 / 国际象棋） ----
       围棋走原有单段路由（#/lessons…），象棋用 `xq` 前缀（#/xq/board…），
       国际象棋用 `chess` 前缀 —— **国际象棋目前只是预留板块**（导航已摆齐，内容留待施工）。
       围棋那套路由与按钮一行没改。 */
    var GAMES = { go: 1, xq: 1, chess: 1, shogi: 1 };
    var game = GAMES[view] ? view : 'go';
    if (gameSwitch) {
      var gbs = gameSwitch.querySelectorAll('button');
      for (var gi = 0; gi < gbs.length; gi++) {
        gbs[gi].classList.toggle('on', gbs[gi].getAttribute('data-game') === game);
      }
    }
    var sets = nav.querySelectorAll('.nav-set');
    for (var si = 0; si < sets.length; si++) {
      sets[si].hidden = sets[si].getAttribute('data-set') !== game;
    }

    var btns = nav.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var v = btns[i].getAttribute('data-view');
      /* 棋种切换按钮用的是 data-game、没有 data-view，**不参与**这个高亮循环 ——
         否则循环会把它们的 `on` 一并清掉，棋种选中态就永远不亮（踩过）。 */
      if (!v) continue;
      /* 多段 hash 的按钮（xq/board、chess/rules…）必须按**整串**匹配；
         而象棋 / 国际象棋页的 view 恒为棋种名，若仍用 `v === view`，
         「首页」会在所有子页都亮（实测踩过）。围棋那套单段路由保持原逻辑。 */
      var on = (v === hash) || (v === view && !GAMES[v]) ||
        (view === 'lesson' && v === 'lessons') ||
        (view === 'hlesson' && v === 'history') ||
        (view === 'game' && v === 'games') ||
        (view === 'problem' && v === 'problems') ||
        (view === 'joseki' && v === 'joseki') ||
        ((view === 'shapes' || view === 'shape') && v === 'shapes') ||
        (view === 'selfcheck' && v === 'selfcheck') ||
        (view === 'tlesson' && v === 'training');
      btns[i].classList.toggle('on', on);
    }

    if (view === 'home') return renderHome();
    if (view === 'lessons') return renderLessons();
    if (view === 'lesson') return renderLesson(seg[1]);
    if (view === 'history') return renderHistory();
    if (view === 'hlesson') return renderHistoryLesson(seg[1]);
    if (view === 'games') return renderGames();
    if (view === 'game') return renderGame(seg[1], seg[2]);
    if (view === 'problems') return renderProblems(seg[1] ? decodeURIComponent(seg[1]) : 'all');
    if (view === 'problem') return renderProblem(seg[1]);
    /* 词典改用独立模块渲染（列表卡片网格 + 详情页四段 + 棋盘图示 + 上下条）——见 glossary-ui.js。
       老实现保留在后面做兜底，两个都在时优先用新模块。 */
    if (view === 'glossary' && window.GoGlossary) return window.GoGlossary.render(app, seg);
    if (view === 'glossary') return renderGlossary(seg[1] ? decodeURIComponent(seg[1]) : '');
    if (view === 'training') return renderTraining();
    if (view === 'tlesson') return renderTrainingLesson(seg[1]);
    if (view === 'joseki') return seg[1] ? renderJosekiDetail(seg[1]) : renderJoseki();
    /* 注意 `shape` 与 `shapes` 都要认：
       列表页的按钮生成的是 `#/shape/<id>`（与 lesson/game/problem 的单数详情一致），
       而路由原先只判 `view === 'shapes'` → 点进去直接落到 renderHome()，表现为「点一下回主页」。
       这是用户报的 bug（每个死活形都点不进去）。两处都要放宽，否则 nav 高亮也会掉。 */
    if (view === 'shapes' || view === 'shape') return seg[1] ? renderShapeDetail(seg[1]) : renderShapes();
    if (view === 'board') return renderFreeBoard();
    if (view === 'selfcheck') return renderSelfCheck(seg[1] || 'review');
    /* 象棋板块：交给 xq-app.js 的入口（独立的一套界面，围棋代码不受影响） */
    if (view === 'xq') return XQApp.render(seg.slice(1), app);
    /* 国际象棋板块 2026-09-29 开工：引擎（自检 20 项）、棋盘、九个页面都已就位，
       交给 chess-app.js 自己分发子页。拿不到就退回旧占位页（打包漏了脚本时不白屏）。 */
    if (view === 'chess') {
      if (window.ChessApp) return window.ChessApp.render(seg, app);
      return renderChessSoon(seg, app);
    }
    /* 将棋板块 2026-09-28 开工：规则引擎、棋盘、摆棋页已就位，
       交给 shogi-app.js 自己分发子页；尚未开工的子页由它给出统一的说明。 */
    if (view === 'shogi') {
      if (window.ShogiApp) return window.ShogiApp.render(seg, app);
      return renderShogiSoon(seg, app);
    }
    renderHome();
  }

  /* 国际象棋板块：2026-09-29 全部完工（引擎 / 棋盘 / 九个页面 + 实战自测三件套）。
     这个说明页只在**打包漏了 chess-app.js** 时才会出现 —— 不要白屏。 */
  var CHESS_TABS = {
    '': ['国际象棋', '整个板块'],
    lesson: ['入门课', '棋盘与棋子走法，以及吃过路兵、王车易位、兵升变这些规则细节，一课配一个盘面。'],
    tactics: ['战术', '牵制、双击、闪击、引离、消除保护 —— 国际象棋的战术分类与象棋不太一样。'],
    endgame: ['残局', '王兵残局、车兵残局这些经典定式，用引擎复算过才收。'],
    opening: ['开局', '意大利、西班牙、西西里……常见开局各讲清「为什么这么走」。'],
    games: ['名局', '经典对局一手一手讲。'],
    terms: ['词典', '国际象棋术语（意大利语源、法语源一大堆），按人话解释。'],
    board: ['摆棋', '一个能真的走子的国际象棋棋盘。'],
    rules: ['规则', '从棋盘摆法到王车易位、吃过路兵、逼和与各种和棋情形。'],
    selfcheck: ['自测', '下一盘看逐手点评、一张常见失误自查表、抽题随机测验。']
  };

  function renderChessSoon(seg, host) {
    var info = CHESS_TABS[seg[1] || ''] || CHESS_TABS[''];
    host.innerHTML = '<h1>' + esc(info[0]) + '</h1>' +
      '<p class="sub">国际象棋板块的脚本没加载出来（src/chess-app.js）。</p>' +
      '<div class="card"><p><b>这不是「还没做」，是打包漏了脚本。</b>' +
      '国际象棋的内容已经全部就位：规则引擎、棋盘、入门课、战术题、残局、开局、名局、词典、' +
      '摆棋、实战自测。正常打包出来的单文件不会走到这一页。</p>' +
      '<p class="small muted" style="margin-bottom:0">这一页本该讲的内容：' + esc(info[1]) + '</p></div>' +
      '<div class="row" style="margin-top:16px">' +
      '<button class="btn" onclick="location.hash=\'#/xq\'">先去看象棋板块</button>' +
      '<button class="btn" onclick="location.hash=\'#/\'">回到围棋</button></div>';
  }

  /* 将棋（日本将棋）板块：**先预留**（用户要求），内容留待后续施工。
     导航按将棋界自己的叫法摆齐 —— 定迹（≈定式）、诘将棋（≈死活题）、手筋，都是将棋的通用词；
     占位说明里也点出将棋与象棋最不一样的那几条规则，免得看着像"象棋换了个名字"。 */
  var SHOGI_TABS = {
    '': ['将棋', '整个板块'],
    lesson: ['入门课', '棋盘只有 9×9，比象棋小一圈，但有几条规则和象棋完全不同 —— 尤其是「持驹」。'],
    joseki: ['定迹', '将棋界的「定式」：双方都认可的开局套路，讲的是这样交换为什么对等。'],
    tsume: ['诘将棋', '将棋最有名的一类题：给一个局面，用连续将军（王手）一路追到把王将杀死，手顺唯一。'],
    tesuji: ['手筋', '局部的好手巧手，常见的是弃掉一枚驹，换全局的主动。'],
    games: ['名局', '经典对局一手一手讲。'],
    terms: ['词典', '王手、寄せ、必至、持驹、升变、打步诘……将棋术语按人话解释。'],
    board: ['摆棋', '一个能真的走子的将棋棋盘（含「持驹」区）。'],
    rules: ['规则', '八种驹的走法与升变（成金 / 成银…）、吃掉对方的驹可以再打回棋盘（持驹）、以及「打步诘」这类禁手。']
  };

  function renderShogiSoon(seg, host) {
    var info = SHOGI_TABS[seg[1] || ''] || SHOGI_TABS[''];
    host.innerHTML = '<h1>' + esc(info[0]) + '</h1>' +
      '<p class="sub">将棋板块<b>已经预留</b>，内容还没有开工。</p>' +
      '<div class="card"><p><b>这一格是故意留空的。</b>' +
      '同一套外壳（棋盘渲染、答题器、讲解系统、单文件打包）已经撑起了围棋与象棋两个板块，' +
      '将棋搬进来时主要换规则层 —— 先把导航与路由留好，施工时不用再改这一层。</p>' +
      '<p class="small muted" style="margin-bottom:0">计划内容：' + esc(info[1]) + '</p></div>' +
      '<div class="row" style="margin-top:16px">' +
      '<button class="btn" onclick="location.hash=\'#/xq\'">先去看象棋</button>' +
      '<button class="btn ghost" onclick="location.hash=\'#/chess\'">国际象棋</button>' +
      '<button class="btn ghost" onclick="location.hash=\'#/\'">回到围棋</button></div>';
  }

  /* 棋种切换按钮用 data-game（没有 data-view），单独挂事件 */
  if (gameSwitch) {
    gameSwitch.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var g = b.getAttribute('data-game');
      go(g === 'go' ? '#/' : '#/' + g);
    });
  }

  nav.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    /* 棋种切换按钮就放在 nav 里面，点击会冒泡到这里；它没有 data-view，
       不排除掉就会执行 go('#/null')（实测踩过）。它由上面那个处理器负责。 */
    if (b.hasAttribute('data-game')) return;
    go('#/' + b.getAttribute('data-view'));
  });

  window.addEventListener('hashchange', function () {
    route();
    window.scrollTo(0, 0);
  });

  /* ================= 首页 ================= */
  function renderHome() {
    /* 词典的真实条数 = GLOSSARY + GLOSSARY_MORE（词典页也是这么合并的）。
       之前首页只算了 GLOSSARY，「94 条」比词典页的 118 条少了 24 条。 */
    var glossaryAll = (window.GLOSSARY || []).concat(window.GLOSSARY_MORE || []);
    var totalLessons = LESSONS.length + HISTORY.length;

    var html = '';
    html += '<section class="hero">';
    html += '<h1>从零开始学围棋</h1>';
    html += '<p class="sub">' + totalLessons + ' 课系统教程，' + PROBLEMS.length +
      ' 道带完整推理的练习，' + GAMES.length + ' 盘名局详解。所有题目的答案都由程序推演验证过，每道错题都会告诉你「为什么错」，而不是只告诉你「对了」。</p>';
    html += '<p class="sub" style="margin-top:10px"><b>不必按顺序学，也不必有进度压力</b> —— 喜欢哪一块就从哪一块开始，随时可以跳回来。</p>';
    html += '</section>';

    html += '<div class="entry-grid">';
    html += entryCard('lessons', '系统课程', '从认棋盘、数气开始，一路讲到死活、布局、官子和打劫。每一课都配可以动手点的棋盘演示。', LESSONS.length + ' 课 · 六个篇章');
    html += entryCard('training', '训练方法', '怎么练才有效 —— 怎么做死活题、什么时候该学定式、输棋之后做什么。讲方法，不堆知识。',
      (typeof TRAINING !== 'undefined' ? TRAINING.length + ' 课' : '构建中'));
    html += entryCard('history', '围棋思维史', '座子时代、秀策流、新布局革命、韩国流、AI 时代 —— 每个时代的人为什么那样下棋，那些下法今天还用不用。', HISTORY.length + ' 课 · 七个时代');
    html += entryCard('games', '名局详解', '从 1739 年当湖十局、1846 年秀策耳赤之局，到 AlphaGo 与李世石、柯洁对申真谞 —— 每盘都有对弈的人、当时的处境、每一手的用意。', GAMES.length + ' 盘');
    html += entryCard('problems', '分级练习', '死活、手筋、官子、中盘选点，外加入门热身。答案全部由程序验算过，每道题都有分步引导和完整推理。', PROBLEMS.length + ' 道题');
    html += entryCard('glossary', '术语词典', '下棋时听到的那些词 —— 气、打吃、枷吃、大场、急所，都用大白话解释清楚。', glossaryAll.length + ' 条');
    html += entryCard('joseki', '定式库', '围棋的常用套路。每个都讲清四件事：什么时代的、当时为什么这么下、现在还用不用、为什么变了。',
      (typeof JOSEKI !== 'undefined' ? JOSEKI.length + ' 个' : '构建中'));
    html += entryCard('shapes', '死活形图库', '标准死活形速查：一眼看懂是死是活、要点在哪、为什么。结论全部由程序验证过。',
      (typeof SHAPES !== 'undefined' && SHAPES.length ? SHAPES.length + ' 个形' : '构建中'));
    html += entryCard('board', '自由摆棋', '给你一张空棋盘。可以自己摆局面、随时看某块棋有几口气、判断是不是真眼、算一算谁的地多。', '动手工具');
    html += entryCard('selfcheck', '实战自测', '摆出你自己下过的一盘棋，电脑用纯规则逐手挑毛病；随机抽十道题考自己；还有一份常见失误清单。不记进度、不排名，做完就清空。', '三个工具');
    html += '</div>';

    html += '<h2>这一版有什么</h2>';
    html += '<div class="card"><ul style="margin:0;padding-left:20px">' +
      '<li><b>系统课程</b>：' + LESSONS.length + ' 课，从认棋盘、数气开始，一路讲到死活、布局、官子和打劫，每课配可以动手点的棋盘演示。</li>' +
      '<li><b>围棋思维史</b>：' + HISTORY.length + ' 课，座子时代 → 秀策流 → 新布局革命 → 韩国流 → AI 时代。</li>' +
      '<li><b>名局详解</b>：' + GAMES.length + ' 盘，每一手都有讲解 —— 对弈的人是谁、当时什么处境、这一手想干什么。</li>' +
      '<li><b>分级练习</b>：' + PROBLEMS.length + ' 道，答案全部由程序验算过，每道题都有分步引导和完整推理，错了会告诉你为什么错。</li>' +
      '<li><b>术语词典</b>：' + glossaryAll.length + ' 条，可用搜索，重点词配棋盘图。</li>' +
      '<li><b>定式库</b>：' + (typeof JOSEKI !== 'undefined' ? JOSEKI.length : 0) +
      ' 个，每个都讲清四件事：什么时代的、当时为什么这么下、现在还用不用、为什么变了。</li>' +
      '<li><b>死活形图库</b>：' + (typeof SHAPES !== 'undefined' ? SHAPES.length : 0) +
      ' 个形，结论全部由程序验证过。</li>' +
      '<li><b>自由摆棋</b>：一张空棋盘，自己摆局面、看某块棋有几口气、判断真眼假眼、算谁的地多。</li>' +
      '<li><b>实战自测</b>：纯规则逐手挑毛病 + 随机抽题 + 常见失误清单。不记进度、不排名，做完就清空。</li>' +
      '</ul></div>';

    html += '<h2>如果想有个路线参考</h2>';
    html += '<p class="sub small muted" style="margin-bottom:14px">这只是很多人觉得顺的一条路，<b>不是必须的</b> —— 从任何一块开始都行，随时可以跳回来。</p>';
    html += '<div class="card path">';
    html += pathStep('1', '先弄懂「气」', '这是围棋唯一的核心概念。后面的吃子、死活、攻防，全都是算气。先做「数气」那几道题，做到不用想就能答出来。', '#/lesson/l2');
    html += pathStep('2', '学会吃子', '从「提子」到「打吃」再到「双打吃」。这三个是你实战中最早用得上的武器。', '#/lesson/l3');
    html += pathStep('3', '动手下一局', '不用怕输。9 路盘，随便下，感受一下棋是怎么连成片、怎么被吃掉的。', '#/board');
    html += pathStep('4', '学死活', '眼、真假眼、两眼活棋。这一块决定了一盘棋里那些大块棋的生死。', '#/lesson/l11');
    html += pathStep('5', '再学布局和官子', '前面都能用了，再来谈「怎么围得更大」「收官怎么不算亏」。', '#/lesson/l16');
    html += '</div>';

    app.innerHTML = html;
  }

  function entryCard(view, t, d, m) {
    return '<button class="entry" onclick="location.hash=\'#/' + view + '\'">' +
      '<div class="t">' + t + '</div>' +
      '<div class="d">' + d + '</div>' +
      '<div class="m">' + m + '</div>' +
      '</button>';
  }

  function pathStep(n, t, d, link) {
    return '<div class="path-step"><div class="path-num">' + n + '</div><div class="path-body">' +
      '<div class="t">' + t + '</div><div class="d">' + d + '</div>' +
      '<div style="margin-top:6px"><button class="btn ghost sm" onclick="location.hash=\'' + link.replace('#', '') + '\'">去看看</button></div>' +
      '</div></div>';
  }

  /* ================= 课程列表 ================= */
  function renderLessons() {
    var html = '<h1>系统课程</h1><p class="sub">一共 ' + LESSONS.length + ' 课，按顺序学效果最好。每一课都有可以动手点的棋盘演示。</p>';
    var parts = [], i;
    for (i = 0; i < LESSONS.length; i++) {
      if (parts.indexOf(LESSONS[i].part) === -1) parts.push(LESSONS[i].part);
    }
    for (var p = 0; p < parts.length; p++) {
      html += '<div class="part-title">' + parts[p] + '</div><div class="lesson-list">';
      for (i = 0; i < LESSONS.length; i++) {
        var L = LESSONS[i];
        if (L.part !== parts[p]) continue;
        html += '<button class="lesson-item' + '' + '" onclick="location.hash=\'#/lesson/' + L.id + '\'">' +
          '<span class="idx">' + (i + 1) + '</span>' +
          '<span class="body"><span class="t">' + esc(L.title) + '</span>' +
          '<span class="d">' + esc(L.lede) + '</span></span>' +
          '<span class="go">→</span></button>';
      }
      html += '</div>';
    }
    app.innerHTML = html;
  }

  /* ================= 课程详情 ================= */
  function renderLesson(id) {
    var idx = -1, i;
    for (i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) idx = i;
    if (idx < 0) return renderLessons();
    var L = LESSONS[idx];

    var html = '';
    html += '<div class="lesson-head">';
    html += '<div class="crumb"><a href="#/lessons">系统课程</a> ／ ' + L.part + ' ／ 第 ' + (idx + 1) + ' 课</div>';
    html += '<h1>' + esc(L.title) + '</h1>';
    html += '<div class="lede">' + esc(L.lede) + '</div>';
    html += '</div>';

    for (i = 0; i < L.sections.length; i++) {
      var s = L.sections[i];
      html += '<div class="sec">' + h('h3', null, esc(s.h));
      for (var j = 0; j < s.p.length; j++) html += '<p>' + esc(s.p[j]) + '</p>';
      html += '</div>';
    }

    if (L.demo) {
      html += '<div class="demo-wrap"><div class="board-shell">';
      html += boardHolder('demo-canvas', L.demo.size);
      html += '<div class="board-bar" id="demo-bar"></div>';
      html += '</div>';
      html += '<div class="board-say" id="demo-say">' +
        (L.demo.kind === 'explore' ? '在棋盘上随便点一点，看看会发生什么。' : '点「下一步」开始演示。') + '</div>';
      html += '</div>';
    }

    if (L.key) {
      html += '<div class="keybox"><div class="t">本课要点</div><ul>';
      for (i = 0; i < L.key.length; i++) html += '<li>' + esc(L.key[i]) + '</li>';
      html += '</ul></div>';
    }

    html += '<div class="lesson-nav">';
    if (idx > 0) html += '<button class="btn ghost" onclick="location.hash=\'#/lesson/' + LESSONS[idx - 1].id + '\'">← 上一课</button>';
    else html += '<span></span>';
    if (idx < LESSONS.length - 1) html += '<button class="btn" onclick="location.hash=\'#/lesson/' + LESSONS[idx + 1].id + '\'">下一课 →</button>';
    html += '</div>';

    app.innerHTML = html;
    store.markLesson(id);

    if (L.demo) mountDemo(L.demo);
  }

  function mountDemo(demo) {
    var canvas = el('demo-canvas');
    var bar = el('demo-bar');
    var say = el('demo-say');
    var view = null;
    var idx = 0;

    if (demo.kind === 'explore') {
      var bd = new Board(demo.size);
      bd.setup(demo.stones || []);
      var color = 'b';
      view = mountBoard(canvas, {
        size: demo.size,
        onPlay: function (x, y) {
          var r = bd.play(bd.idx(x, y), color === 'b' ? BLACK : WHITE);
          if (!r.ok) {
            say.textContent = '这一点不能下：' + reasonText(r.reason) + '。';
            return;
          }
          color = (color === 'b') ? 'w' : 'b';
          view.setStones(GoBoardView.fromEngine(bd));
          view.setLastMove([x, y]);
          var sc = bd.score(0);
          say.textContent = (demo.note || '') + '　现在轮到' + (color === 'b' ? '黑棋' : '白棋') +
            '。目前黑 ' + sc.black + ' 目、白 ' + sc.white + ' 目。';
        }
      });
      view.setStones(GoBoardView.fromEngine(bd));
      bar.innerHTML = '<button class="btn ghost sm" id="demo-reset">清空重来</button>' +
        '<span class="small muted">点棋盘落子，程序会自动判定能不能下</span>';
      el('demo-reset').onclick = function () {
        bd.reset();
        color = 'b';
        view.setStones([]);
        view.setLastMove(null);
        say.textContent = demo.note || '';
      };
      return;
    }

    /* steps 与 question 都是分步演示 */
    var steps = demo.steps || [];
    view = mountBoard(canvas, {
      size: demo.size,
      interactive: false,
      onPlay: function () {}
    });

    function show(i) {
      var s = steps[i];
      view.setStones(s.stones || []);
      view.setMarks(s.marks || []);
      say.textContent = s.t;
      var dots = '';
      for (var k = 0; k < steps.length; k++) dots += '<i class="' + (k === i ? 'on' : '') + '"></i>';
      bar.innerHTML = '<button class="btn ghost sm" id="demo-prev">上一步</button>' +
        '<button class="btn sm" id="demo-next">下一步</button>' +
        '<span class="step-dots">' + dots + '</span>' +
        '<span class="small muted">' + (i + 1) + ' / ' + steps.length + '</span>';
      el('demo-prev').disabled = (i === 0);
      el('demo-next').disabled = (i === steps.length - 1);
      el('demo-prev').onclick = function () { if (i > 0) show(i - 1); };
      el('demo-next').onclick = function () { if (i < steps.length - 1) show(i + 1); };
    }
    show(0);
  }

  /* ================= 练习列表 ================= */
  function renderProblems(filter) {
    var cats = ['all'], i;
    for (i = 0; i < PROBLEMS.length; i++) {
      if (cats.indexOf(PROBLEMS[i].cat) === -1) cats.push(PROBLEMS[i].cat);
    }
    var catName = { all: '全部', '吃子': '吃子', '打吃': '打吃', '双打吃': '双打吃', '禁入点': '禁入点', '眼': '真假眼', '数气': '数气', '胜负': '胜负', '死活': '死活', '手筋': '手筋', '中盘': '中盘', '官子': '官子' };

    var html = '<h1>分级练习</h1>';
    html += '<p class="sub">每道题都有一段完整的推理，答错会告诉你错在哪、错多少。不用怕做错 —— 做错才有收获。</p>';
    html += '<div class="filter-bar">';
    for (i = 0; i < cats.length; i++) {
      html += '<button class="' + (cats[i] === filter ? 'on' : '') + '" onclick="location.hash=\'#/problems/' + cats[i] + '\'">' +
        (catName[cats[i]] || cats[i]) + '</button>';
    }
    html += '</div>';

    var shown = 0;
    html += '<div class="prob-grid">';
    for (i = 0; i < PROBLEMS.length; i++) {
      var P = PROBLEMS[i];
      if (filter !== 'all' && P.cat !== filter) continue;
      shown++;
      var cls = 'prob-item';
      var mark = '';
      html += '<button class="' + cls + '" onclick="location.hash=\'#/problem/' + P.id + '\'">' + mark +
        '<div class="id">' + P.id.toUpperCase() + ' · ' + (catName[P.cat] || P.cat) + '</div>' +
        '<div class="cat">' + esc(P.ask.slice(0, 14)) + (P.ask.length > 14 ? '…' : '') + '</div>' +
        '<div class="ask">' + (P.kind === 'board' ? '在棋盘上点选'
          : P.kind === 'sequence' ? '多步题 · ' + Math.ceil(P.plan.length / 2) + ' 手'
            : '选择答案') + '</div>' +
        '</button>';
    }
    html += '</div>';
    if (!shown) html += '<p class="muted">这个分类下暂时没有题目。</p>';
    app.innerHTML = html;
  }

  /* ================= 单题作答 ================= */
  /* 一道题的作答界面（题干卡 + 棋盘或选项 + 提示 + 反馈 + 按钮条）。
     单题页和「随机测验」共用这一套 —— 答题逻辑只写一遍。

     cfg:
       metaHTML      题干卡上方的 pill 行（可选）
       extraRow      提示按钮那一行里追加的 HTML（可选）
       track         true = 写入 store 进度（单题页）；随机测验传 false
       compact       （**已废弃**）随机测验原本用它精简反馈；2026-09-28 起一律给完整推理，传不传都一样
       retryOnWrong  棋盘题答错时允许重试、不结束（单题页 true）
       footer(ok, picked, revealed)        返回反馈区下方的按钮 HTML
       bindFooter(fb, ok, picked, revealed)  反馈渲染完后绑定按钮事件
       onAnswered(ok, picked, revealed)    作答完成回调一次
  */
  /* 题面说「下边有两块黑棋」却不说清是哪两块时，读者得在棋盘上自己一个个找 ——
     棋盘下边常常一大片黑子，指代就落空了（用户提过这个问题，实例是 ts44）。
     这里把「那两块」自动算出来：在答案点落一手，对方哪些棋块从「≥2 气」掉到「只剩 1 气」，
     就是被这一手同时打吃的目标。只圈被攻击的棋块，不泄露答案点本身。
     题目若自己写了 P.focus（手工指定），以手工的为准。 */
  function autoFocusMarks(P, size) {
    if (P.focus && P.focus.length) {
      return P.focus.map(function (f) { return [f[0], f[1], 'focus']; });
    }
    if (P.kind !== 'board' || !P.answers || !P.answers.length) return [];
    var t = P.check && P.check.type;
    var wantCapture = (t === 'capture' || t === 'multi-capture');
    var wantAtari = (t === 'atari' || t === 'double-atari');
    if (!wantCapture && !wantAtari) return [];
    var out = [];
    try {
      var bd = new E.Board(size);
      bd.setup(P.stones);
      var me = P.toMove === 'w' ? E.WHITE : E.BLACK;
      var foe = me === E.BLACK ? E.WHITE : E.BLACK;
      function foeBlocks(b) {
        var seen = new Uint8Array(b.n), list = [], i;
        for (i = 0; i < b.n; i++) {
          if (b.g[i] === foe && !seen[i]) {
            var g = b.group(i), k;
            for (k = 0; k < g.stones.length; k++) seen[g.stones[k]] = 1;
            list.push({ key: g.stones.join(','), libs: g.libs.length, stones: g.stones });
          }
        }
        return list;
      }
      var before = {};
      if (wantAtari) foeBlocks(bd).forEach(function (g) { before[g.key] = g.libs; });
      var r = bd.play(bd.idx(P.answers[0][0], P.answers[0][1]), me);
      if (!r.ok) return out;

      if (wantCapture) {
        /* 提子题：题面说的「这颗 / 这一串」就是**这一手会被提掉的子**，直接圈它们。
           不设大小上限 —— 题面本来就说「这一串」，圈出来正是要读者看见的那一块。 */
        r.captured.forEach(function (s) {
          out.push([s % size, Math.floor(s / size), 'focus']);
        });
        return out;
      }

      var blocks = [];
      foeBlocks(bd).forEach(function (g) {
        var was = before[g.key];
        if (g.libs === 1 && (was === undefined || was >= 2)) blocks.push(g);
      });
      /* 一整块大棋（>4 颗）不圈：那块本身就显眼，题面通常也会写明「几子的大棋」，
         全圈上反而满盘橙点。真正需要圈的是「两颗、三颗」这种小目标 ——
         指代含糊也正是出在这类地方。 */
      var tooBig = blocks.some(function (g) { return g.stones.length > 4; });
      if (!tooBig) {
        blocks.forEach(function (g) {
          g.stones.forEach(function (s) {
            out.push([s % size, Math.floor(s / size), 'focus']);
          });
        });
      }
    } catch (err) { /* 算不出来就不标，绝不影响作答 */ }
    return out;
  }

  /* ============ 多步题（kind:'sequence'）运行时 · 2026-09-28 ============
   *
   * 用户要求（原话）：
   *   「你搞那种交互式题目嘛，就是用户下了一手后，系统会跟随再下一手，
   *     然后继续考用户的题，这种多步之间的题，你可以在题库里预制的准备好」
   *   「预制好的，如果我落到正确位置，系统才进行预设的落子，
   *     然后继续判断用户是否正确落子继续推进」
   *
   * 模型 = 主线复演：
   *   plan[] 是正解主线（古谱原解）。偶数下标 = 用户走，奇数下标 = 系统走。
   *   用户落对 → 系统立刻自动落 plan 的下一手 → 轮到用户再落。
   *   用户落错 → 停下、说明后果、允许重试；棋盘回到出错前。
   *
   * 为什么不做「按棋理实时算应手」：本题库题源是古谱（元/清/江户），
   *   其目标常是「破眼做不活」而非 solver 的判据（提子/两眼），实测 solver 大量
   *   返回 unknown（见 tools/tsumego_facts.js 的 candidateDiff 注释）。
   *   所以**应手一律预置**，保证「每一步都在古谱的算路里」，不跑偏。
   */
  function mountSequenceProblem(host, P, cfg) {
    cfg = cfg || {};
    var size = P.size || 19;
    var plan = P.plan || [];
    var me = P.toMove === 'w' ? E.WHITE : E.BLACK;
    var foe = me === E.BLACK ? E.WHITE : E.BLACK;
    var bd = new E.Board(size);
    bd.setup(P.stones);
    var recs = [];        /* 已走的每一步的 undo 记录 */
    var ply = 0;          /* 已走完的手数 */
    var done = false;
    var wrongTries = 0;

    /* 逐手讲解在第一步落子前不剧透 —— 只显示「该你了 / 请继续」 */
    var html = '';
    html += '<div class="card">';
    if (cfg.metaHTML) html += '<div class="row" style="margin-bottom:10px">' + cfg.metaHTML + '</div>';
    html += '<p class="q-ask">' + linkCoords(P.ask, size) + '</p>';
    if (P.goal) html += '<p class="small muted" style="margin-top:2px">这道题练的是：' + esc(P.goal) + '</p>';
    html += '</div>';
    html += '<div class="prob-layout"><div class="prob-board">';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += boardHolder('q-canvas', P.size);
    html += '<div class="board-bar"><span class="pill wood">多步题 · ' + (P.toMove === 'w' ? '你执白' : '你执黑') +
      '</span><span class="small muted" id="q-tip">按顺序落子，走对系统会跟着应</span>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn ghost sm" id="q-demo">演示下一步</button>' +
      '<button type="button" class="btn ghost sm" id="q-undo">悔一步</button>' +
      '<button type="button" class="btn ghost sm" id="q-clear-marks">清除标记</button></div>';
    html += '</div></div>';
    /* 步数进度条 */
    html += '<div class="seq-progress" id="q-seqprog"></div>';
    html += '</div><div class="prob-notes">';
    html += '<div id="q-hints"></div><div id="q-feedback"></div>';
    html += '</div></div>';
    host.innerHTML = html;

    var fb = el('q-feedback');
    var tip = el('q-tip');
    var prog = el('q-seqprog');
    /* 2026-09-28 用户要求去掉「战场示意点」。
     *
     * 原设计：开局把 plan 的全部落点都画成灰点（'shape'），理由是「19 路满盘，
     *   读者找不到这道题说的是哪一块」。但实际效果是**把整条正解线标了出来** ——
     *   一道 11 手题就画 11 个灰点，会下棋的人照着排布基本能推出走法，等于给了半张答案；
     *   而且灰点画在交叉点上，尺寸不小，视觉上很像「盘上多出来一堆黑子」。
     * 用户原话：「你题目的棋盘上搞了一堆黑点是啥」→「干脆就去掉」。
     * 现在题面本身已经带坐标标签（如「B16 一路上排到 C4、C5、D4」），定位不再依赖灰点。 */
    var baseMarks = [];
    /* userLastMove → view.lastMove（绿点），**不管这一手是谁下的**，
       永远只有「最新的那一手」带绿点。用户落子后系统延迟 1 秒才应，
       所以绿点会先停在用户那手上、再跳到系统那一手上，先后顺序看得出来。 */
    var userLastMove = null;
    var waiting = false;      /* true = 已落子、正在等系统应手（这期间不接受点击/悔棋） */
    function repaint() {
      view.setStones(GoBoardView.fromEngine(bd));
      view.setMarks(baseMarks);      /* 多步题开局不再预先标任何点 */
      view.setLastMove(userLastMove);
    }
    var view = mountBoard(el('q-canvas'), {
      size: P.size,
      onPlay: function (x, y) { tryPlay(x, y, false); }
    });
    view.canvas.__view = view;   /* 供自动化测试读盘面与几何（与名局页一致） */

    /* 答错时的兜底说明（wrongAt 没有收录这个点时用）。
       2026-09-30：原文案是「这不是本题正解的第一步。再算一遍 —— 想想有没有留下做眼的余地。」
       有两个问题：① 只说「第一步」，但错手可能发生在第 3、5 手；
       ② 「做眼的余地」是死活题的语汇，用在官子/对杀/手筋题上不贴切。
       现在按分类给不同的算路提示，并报出这是第几手。 */
    var HINT_BY_CAT = {
      '死活': '先数清这块棋的气，再看有没有做成两只真眼的余地。',
      '手筋': '想想有没有更巧的一手 —— 手筋题常是「先送后取」。',
      '对杀': '把双方的气各数一遍：先紧哪一边、紧到什么程度，次序最关键。',
      '官子': '算算这一手实际能收多少目，是先后手、还是被对方先手便宜。',
      '中盘': '想想这一手之后，对方最强的应手是什么。',
      '基础': '再看看这块棋的气，和周围有没有己方的接应点。'
    };
    function fallbackHint() {
      var nth = ((ply / 2) | 0) + 1;
      var where = nth <= 1 ? '第一手' : ('第 ' + nth + ' 手');
      return '这不是本题' + where + '的正解。' + (HINT_BY_CAT[P.cat] || '再算一遍，比较一下别的落点。');
    }

    /* 落子主逻辑：用户点击与「演示下一步」共用。
       isDemo=true 表示这一手是系统代走（读者点了演示按钮），
       提示语必须区分开 —— 否则读者会以为是自己下对了。 */
    function tryPlay(x, y, isDemo) {
        if (done) return;
        if (ply >= plan.length) return;
        if (waiting) return;      /* 系统应手的 1 秒内不接受新点击，避免连点错乱 */
        /* 现在该用户走 —— plan 的偶数下标是用户手 */
        var step = plan[ply];
        var i = bd.idx(x, y);
        var r = bd.play(i, me);
        if (!r.ok) {
          if (tip) tip.textContent = '这一点下不了（' + (r.reason === 'occupied' ? '已有子' :
            r.reason === 'suicide' ? '自己送吃' : r.reason === 'ko' ? '打劫禁着' : '不合规则') + '）。';
          return;
        }
        var want = bd.idx(step[0], step[1]);
        if (i === want) {
          recs.push(r.rec); ply++;
          userLastMove = [x, y];        /* 用户这一手 → 绿点 */
          repaint();
          /* 系统走出预设的应手（奇数下标）。
             2026-09-28 用户报：sq47（打劫题，同一格反复落子）里「我下了第一步，
             黑方没有下，而是我下第二步黑方才下」—— 系统其实每手都走了，只是
             瞬间跟上，眼睛分不清谁下了哪。
             用户最终拍板的做法（原话）：
               「去掉那个黄色的点，全用绿色表示最新的点，用户下完之后延迟一秒黑棋再下，
                 这样就有了一个明显的先后顺序」
             即：① 不再用金色 'reply' 标记，一律用**绿点**表示「最新的那一手」；
                 ② 用户落子后**先停 1 秒**（绿点停在用户那一手上），系统再落子
                    （绿点跟着移到系统那一手上）—— 先后顺序一眼看得出。 */
          if (ply < plan.length) {
            var reply = plan[ply];
            var ri = bd.idx(reply[0], reply[1]);
            var replyLbl = E.toLabel(ri, size);
            var foeName = (foe === E.BLACK ? '黑棋' : '白棋');
            if (tip) tip.textContent = isDemo
              ? ('演示：这一手走 ' + E.toLabel(want, size) + '。稍等，看' + foeName + '怎么应。')
              : ('下对了 —— 稍等，看' + foeName + '怎么应。');
            waiting = true;
            window.setTimeout(function () {
              waiting = false;
              if (done) return;
              var rr = bd.play(ri, foe);
              if (rr.ok) {
                recs.push(rr.rec); ply++;
                userLastMove = [reply[0], reply[1]];   /* 绿点移到系统这一手 */
                if (tip) tip.textContent = foeName + '应 ' + replyLbl + '。轮到你了 —— 下一手在哪里？';
                repaint();
                renderProgress();
              }
              if (ply >= plan.length) { seqFinish(true); return; }
            }, 1000);
          } else {
            if (ply >= plan.length) { seqFinish(true); return; }
          }
          return;
        } else {
          bd.undo(r.rec);
          wrongTries++;
          var key = x + ',' + y;
          var why = (P.wrongAt && P.wrongAt[key]) || null;
          if (tip) tip.textContent = '这一点不行。';
          var old = fb.querySelector('.seq-wrong');
          if (old) old.remove();
          fb.insertAdjacentHTML('afterbegin',
            '<div class="feedback no seq-wrong"><div class="head">这一点不行</div>' +
            '<p>' + (why ? linkCoords(why, size) : fallbackHint()) + '</p>' +
            '<p class="small muted">可以点「悔一步」回到上一步，或点「给我提示」。</p></div>');
        }
    }
    repaint();

    function renderProgress() {
      if (!prog) return;
      var n = Math.ceil(plan.length / 2);        /* 用户一共要走几手 */
      var total = plan.length;
      var s = '<span class="small muted">进度 ' + ply + ' / ' + total + ' 手</span>';
      if (plan.length) {
        /* 逐手小圆点：走完的亮，当前的高亮，未走完的灰 */
        s += ' <span class="seq-dots">';
        for (var k = 0; k < total; k++) {
          var cls = k < ply ? 'on' : (k === ply ? 'cur' : '');
          s += '<i class="' + cls + '"></i>';
        }
        s += '</span>';
      }
      prog.innerHTML = s;
    }
    renderProgress();

    function seqFinish(ok) {
      done = true;
      /* 走完了：绿点/金点都不必再留，避免和讲解联动的序号标记混在一起。 */
      baseMarks = []; userLastMove = null; repaint();
      if (cfg.track) store.markProblem(P.id, ok);
      /* 末尾手数说明：把 stepNotes 全部展开（此时已无剧透顾虑） */
      var out = '';
      out += '<div class="feedback ok"><div class="head">' + (ok ? '走完了 —— 这正是古谱的正解' : '这一类变化') + '</div>' +
        '<p>下面把这 ' + plan.length + ' 手拆开讲 —— 每一步在做什么，为什么不能换别的。</p></div>';
      out += '<div class="card" style="margin-top:16px">';
      if (P.stepNotes && P.stepNotes.length) {
        out += '<p class="link-tip small muted">点下面的手数，棋盘上会亮出对应的位置（再点一次取消）。</p>';
        out += '<div class="explain-block"><span class="lbl">逐手讲解</span><ol class="sol-list">';
        for (var k = 0; k < plan.length; k++) {
          var who = (k % 2 === 0) ? '你' : '随手应';    /* 简化：偶数=用户 */
          out += '<li class="sol-row" data-row="' + k + '">' +
            '<span class="sol-n">' + (k + 1) + '</span>' +
            '<span class="sol-t">' + linkCoords(P.stepNotes[k] || '（此处教学文字待补）', size) + '</span></li>';
        }
        out += '</ol></div>';
      }
      /* 完整推理：solution 有两种写法，这里都要支持 ——
       *   ① 数组：每项是一条推理（早期写法）
       *   ② 字符串：一整条带注的路线，如 "R19 →（黑S19）R18 →（黑提R19R18）R18 …"
       *      （打劫这类题用这条写法更紧凑）—— **绝不能当数组逐字符遍历**，
       *      那会把 "R19" 拆成 "R"、"1"、"9" 三个条目（2026-09-28 用户实际看到过，
       *      30 道题全中招，是渲染层没做类型判断的锅）。
       *
       * 但多步题**不再渲染 solution**：stepNotes（逐手讲解，每一手一条）已经把
       * 整条主线逐手讲透了，solution 只是同一条路线的摘要，两段并排显示是重复。
       * 2026-09-28 sq47 实测：stepNotes 7 条详细讲解 + solution 1 条路线摘要，
       * 内容完全重合。所以这里改成：有 stepNotes 就不显示 solution。 */
      var hasStepNotes = !!(P.stepNotes && P.stepNotes.length);
      if (!hasStepNotes && P.solution && P.solution.length) {
        var solItems = Array.isArray(P.solution) ? P.solution : [P.solution];
        out += '<div class="explain-block"><span class="lbl">完整推理</span><ol class="sol-list">';
        for (var s = 0; s < solItems.length; s++) {
          out += '<li class="sol-row" data-row="x' + s + '">' +
            '<span class="sol-n">' + (s + 1) + '</span>' +
            '<span class="sol-t">' + linkCoords(solItems[s], size) + '</span></li>';
        }
        out += '</ol></div>';
      }
      /* 常见错误：traps 也有两种写法 ——
       *   ① 对象 {at, why}：指出「下在哪个点」+ 为什么不行（信息量更大）
       *   ② 字符串：一句整话（早期写法）
       *   渲染层统一处理，不要再写死 .at/.why（否则字符串形态会显示 undefined）。 */
      if (P.traps && P.traps.length) {
        out += '<div class="explain-block"><span class="lbl">常见错误</span>';
        for (var t = 0; t < P.traps.length; t++) {
          var tr = P.traps[t];
          if (tr && typeof tr === 'object' && (tr.at || tr.why)) {
            out += '<div class="trap-item"><b>下在' + linkCoords(tr.at, size) + '：</b>' +
              linkCoords(tr.why, size) + '</div>';
          } else {
            out += '<div class="trap-item">' + linkCoords(String(tr), size) + '</div>';
          }
        }
        out += '</div>';
      }
      if (P.era) out += '<div class="explain-block"><span class="lbl">时代背景</span><p>' + linkCoords(P.era, size) + '</p></div>';
      if (P.principle) out += '<div class="principle"><b>记住这条：</b>' + linkCoords(P.principle, size) + '</div>';
      out += '</div>';
      if (cfg.footer) out += cfg.footer(ok, '');
      fb.innerHTML = out;
      /* 逐手讲解点选 → 棋盘高亮 */
      bindSeqRows();
      if (cfg.bindFooter) cfg.bindFooter(fb, ok, '', false);
      if (cfg.onAnswered) cfg.onAnswered(ok, '', false);
    }

    function bindSeqRows() {
      var rows = fb.querySelectorAll('.sol-row');
      for (var k = 0; k < rows.length; k++) {
        rows[k].addEventListener('click', function () {
          var row = parseInt(this.getAttribute('data-row'), 10);
          var idx = row < plan.length ? row : parseInt(this.getAttribute('data-row').slice(1), 10);
          var all = fb.querySelectorAll('.sol-row');
          for (var q = 0; q < all.length; q++) all[q].classList.remove('active');
          if (idx < plan.length) {
            this.classList.add('active');
            view.setMarks([[plan[idx][0], plan[idx][1], 'point']]);
          }
        });
      }
    }

    /* 悔一步：退回到「轮用户走」的状态（可能一次退两手） */
    var undoBtn = el('q-undo');
    if (undoBtn) undoBtn.addEventListener('click', function () {
      if (done || waiting || !recs.length) return;
      /* 退到 ply 为偶数（用户该走） */
      bd.undo(recs.pop()); ply--;
      if (ply % 2 === 1 && recs.length) { bd.undo(recs.pop()); ply--; }
      /* 退完之后最后一手是用户下的（ply 偶），绿点指着它。
         （系统应手等待中不允许悔棋，所以这里不用管 waiting。） */
      baseMarks = [];
      userLastMove = (ply > 0 && plan[ply - 1]) ? [plan[ply - 1][0], plan[ply - 1][1]] : null;
      repaint();
      renderProgress();
      var old = fb.querySelector('.seq-wrong'); if (old) old.remove();
      if (tip) tip.textContent = '已退回上一步 —— 重新想。';
    });
    /* 演示下一步：系统替读者走当前这一手（正解），对手随即照常应手。
       给「不会做」的读者一条推进的路，同时不揭穿后面几步。 */
    var demoBtn = el('q-demo');
    if (demoBtn) demoBtn.addEventListener('click', function () {
      if (done || waiting) return;
      if (ply >= plan.length) return;
      if (ply % 2 !== 0) return;          /* 只有轮到用户时才能演示 */
      var step = plan[ply];
      tryPlay(step[0], step[1], true);
    });
    var clrBtn = el('q-clear-marks');
    if (clrBtn) clrBtn.addEventListener('click', function () {
      /* 多步题里「清除标记」只清掉绿点高亮，不影响进度与盘面。 */
      baseMarks = []; userLastMove = null;
      repaint();
    });

    /* 提示 / 看详解 两个按钮在共用外壳里，需单独绑定 */
    var hintBtn = el('q-hint');
    var hintBox = el('q-hints');
    if (hintBtn && hintBox) hintBtn.addEventListener('click', function () {
      var steps = P.steps || [];
      if (hintIdx() >= steps.length) return;
      var n = hintIdx();
      hintBox.insertAdjacentHTML('beforeend',
        '<div class="hint-item"><b>提示 ' + (n + 1) + '：</b>' + linkCoords(steps[n], size) + '</div>');
      markHint();
    });
    function hintIdx() { return hintBox ? hintBox.querySelectorAll('.hint-item').length : 0; }
    function markHint() { }
    var showBtn = el('q-show');
    if (showBtn) showBtn.addEventListener('click', function () {
      if (done) return;
      /* 看详解 = 直接把主线走完 + 展开讲解（不算答对） */
      while (ply < plan.length) {
        var step = plan[ply];
        var col = (ply % 2 === 0) ? me : foe;
        var r = bd.play(bd.idx(step[0], step[1]), col);
        if (!r.ok) break;
        recs.push(r.rec); ply++;
      }
      repaint();
      renderProgress();
      seqFinish(false);
    });
  }

  function mountProblemAnswer(host, P, cfg) {
    /* 多步题单独走一条运行时（状态机不同），在此分流 —— 2026-09-28 */
    if (P.kind === 'sequence') return mountSequenceProblem(host, P, cfg);
    cfg = cfg || {};
    var answered = false, hintIdx = 0, view = null;
    /* 选择题专用：choiceView 是它那张只读棋盘；choiceRevealed 保证正解只落一次 */
    var choiceView = null, choiceRevealed = false;
    var size = P.size || 19;
    /* 讲解 ↔ 棋盘联动的状态：
       baseMarks —— 题目本身的标记（答案点、你下错的那一手），由答题流程决定；
       linkMarks —— 讲解里点出来的临时高亮（坐标标签 / 某一整条推理）。
       两者叠加后一起送给棋盘，所以讲解高亮不会盖掉答案点。 */
    var baseMarks = [], linkMarks = [];
    var activeRow = -1;   /* 当前选中的「完整推理」是第几条（0 起，-1 = 没选） */
    var chipSel = [];     /* 当前选中的坐标标签，存 "x,y" */
    var html = '';

    html += '<div class="card">';
    if (cfg.metaHTML) html += '<div class="row" style="margin-bottom:10px">' + cfg.metaHTML + '</div>';
    html += '<p class="q-ask">' + linkCoords(P.ask, size) + '</p>';
    if (P.goal) html += '<p class="small muted" style="margin-top:2px">这道题练的是：' + esc(P.goal) + '</p>';
    html += '</div>';

    /* 棋盘题 / 选择题都用两栏：棋盘（或选项）吸附在左边，提示与讲解在右边。
       以前讲解排在棋盘下面，往下读「完整推理」时棋盘就滚出视野了，
       读者看不到答案点落在哪 —— 这正是用户提的问题。
       2026-09-28 用户报「中盘题（选择题）的棋盘居中了，讲解被挤到下面」：
       因为原先 twoCol 只对 kind:'board' 打开，choice 题落到单列，
       棋盘 + 选项 + 讲解全堆在一列里、且居中。现在 choice 也走两栏，
       棋盘由下面的逻辑插到左栏（.prob-board）里。 */
    /* 两栏结构：
         左栏 .prob-board —— 只放棋盘（choice 题的棋盘稍后由 JS 插入这里）
         右栏 .prob-notes —— 选项/提示按钮/讲解 全在这里
       这样棋盘永远在左边、讲解永远在右边，不会再出现「棋盘居中、讲解掉到下面」。
       （board 题的棋盘 HTML 直接生成；choice 题答题后才插棋盘，见下面 else 分支） */
    html += '<div class="prob-layout"><div class="prob-board">';

    if (P.kind === 'board') {
      html += '<div class="demo-wrap"><div class="board-shell">';
      html += boardHolder('q-canvas', P.size);
      html += '<div class="board-bar"><span class="pill wood">' + (P.toMove === 'w' ? '白棋' : '黑棋') +
        '先行</span><span class="small muted" id="q-tip">点棋盘上你认为正确的那个点</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn ghost sm" id="q-clear-marks">清除标记</button></div>';
      html += '</div></div>';
    }
    /* choice 题：左栏先留空位，棋盘答题后插入（见下方 P.mark/hasStones 分支） */

    html += '</div><div class="prob-notes">';

    if (P.kind !== 'board') {
      html += '<div class="choice-grid" id="q-choices">';
      for (var i = 0; i < P.options.length; i++) {
        html += '<button data-v="' + esc(P.options[i]) + '">' + esc(P.options[i]) + '</button>';
      }
      html += '</div>';
    }

    html += '<div class="row" style="margin-top:16px">';
    html += '<button class="btn ghost" id="q-hint">给我提示</button>';
    html += '<button class="btn ghost" id="q-show">直接看详解</button>';
    if (cfg.extraRow) html += cfg.extraRow;
    html += '</div>';

    html += '<div id="q-hints"></div><div id="q-feedback"></div>';
    html += '</div></div>';

    host.innerHTML = html;

    var hintBox = el('q-hints');
    var fb = el('q-feedback');

    /* ---------- 讲解 ↔ 棋盘联动 ----------
       用事件委托挂在 host 上，所以提示、详解、题干里后渲染出来的标签都能点。
       优先级：坐标标签 > 推理条（标签常常嵌在推理条里面）。 */
    /* 题面如果写了「就是这几颗」，橙色圈会一直画在棋盘上。
       它属于题目本身 —— 不随作答、不随「清除标记」消失，读者随时能看到题面说的是哪几块。 */
    var focusMarks = autoFocusMarks(P, size);

    function paint() { if (view) view.setMarks(baseMarks.concat(linkMarks).concat(focusMarks)); }
    function setBase(m) { baseMarks = m || []; paint(); }

    function syncChips() {
      var all = host.querySelectorAll('.coord-chip'), i;
      for (i = 0; i < all.length; i++) {
        if (chipSel.indexOf(all[i].getAttribute('data-xy')) >= 0) all[i].classList.add('on');
        else all[i].classList.remove('on');
      }
    }
    function syncRows() {
      var rows = host.querySelectorAll('.sol-row'), i;
      for (i = 0; i < rows.length; i++) {
        if (parseInt(rows[i].getAttribute('data-row'), 10) === activeRow) rows[i].classList.add('on');
        else rows[i].classList.remove('on');
      }
    }

    /* 把当前选中状态翻译成棋盘标记 */
    function renderLink() {
      linkMarks = [];
      if (activeRow >= 0 && P.solution && P.solution[activeRow]) {
        var hits = gtpHits(P.solution[activeRow], size), seen = {}, n = 0, i;
        for (i = 0; i < hits.length; i++) {
          var key = hits[i].x + ',' + hits[i].y;
          if (seen[key]) continue;          /* 同一条里重复提到的点，只标一个序号 */
          seen[key] = 1; n++;
          linkMarks.push([hits[i].x, hits[i].y, 'label', String(n)]);
        }
      } else {
        for (var j = 0; j < chipSel.length; j++) {
          var p = chipSel[j].split(',');
          linkMarks.push([parseInt(p[0], 10), parseInt(p[1], 10), 'point']);
        }
      }
      paint();
    }

    /* 点单个坐标标签：亮出这一点，再点一次取消；与「整条高亮」互斥 */
    function clickChip(chip) {
      activeRow = -1;
      var key = chip.getAttribute('data-xy');
      var i = chipSel.indexOf(key);
      if (i >= 0) chipSel.splice(i, 1); else chipSel.push(key);
      syncRows(); syncChips(); renderLink();
    }

    /* 点「完整推理」的一条：整条里出现过的坐标一起亮，按出现顺序标 1、2、3… */
    function clickRow(row) {
      var n = parseInt(row.getAttribute('data-row'), 10);
      activeRow = (activeRow === n) ? -1 : n;
      chipSel = [];
      syncChips(); syncRows(); renderLink();
    }

    /* 清除标记：去掉所有临时高亮，回到题目原局面 + 答案点 */
    function clearMarks() {
      activeRow = -1; chipSel = [];
      if (view) {
        if (answered) {
          view.setStones(P.stones);
          baseMarks = P.answers.map(function (a) { return [a[0], a[1], 'good']; });
        } else {
          baseMarks = [];
        }
      }
      syncRows(); syncChips(); renderLink();
    }

    host.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var chip = e.target.closest('.coord-chip');
      if (chip) { clickChip(chip); return; }
      var row = e.target.closest('.sol-row');
      if (row) clickRow(row);
    });

    function addHint() {
      if (hintIdx >= (P.steps || []).length) {
        hintBox.innerHTML += '<p class="small muted">提示已经全部给完了。如果还是想不出来，可以直接看详解。</p>';
        return;
      }
      if (hintIdx === 0) hintBox.innerHTML = '<div class="hint-list"></div>';
      var list = hintBox.querySelector('.hint-list');
      list.innerHTML += '<div class="hint-item"><span class="n">' + (hintIdx + 1) + '</span><span>' +
        linkCoords(P.steps[hintIdx], size) + '</span></div>';
      syncChips();
      hintIdx++;
    }

    /* 正确答案的文字形态：选择题给选项文字，棋盘题给坐标 */
    function answerLabel() {
      if (P.kind === 'choice') return '「' + P.answers[0] + '」';
      var parts = [];
      for (var k = 0; k < P.answers.length; k++) {
        parts.push(E.toLabel(P.answers[k][1] * P.size + P.answers[k][0], P.size));
      }
      return parts.join(' / ');
    }

    function feedbackHTML(ok, picked, revealed) {
      /* 2026-09-28 用户拍板：**不论答对答错，一律给完整推理** ——
         随机测验原先的「精简反馈」不再使用（`compact` 参数保留，各调用方还在传，
         但它已经不影响反馈内容；`brief` 恒为 false）。 */
      var brief = false;
      var out = '';
      if (ok) {
        out += '<div class="feedback ok"><div class="head">' + (revealed ? '这是正解' : '答对了') + '</div>';
        if (!brief) {
          out += '<p>' + (revealed
            ? '下面是完整的推理过程 —— 自己先想一遍，再对照着看，比直接记住答案有用。'
            : '这个点确实是正解。下面是完整的推理过程 —— 就算答对了也建议读一遍，看看你的想法和标准思路是不是一致。') + '</p>';
        }
        out += '</div>';
      } else {
        out += '<div class="feedback no"><div class="head">再看一遍推理过程</div>' +
          '<p>你选的是「' + esc(picked || '') + '」。答案不是它 —— 读完下面的分析，你应该能说清楚为什么。</p></div>';
      }

      out += '<div class="card" style="margin-top:16px">';
      if (brief) {
        out += '<div class="explain-block"><span class="lbl g">正确答案</span><p>' + answerLabel() + '。</p></div>';
        if (P.principle) out += '<div class="principle" style="margin-bottom:0"><b>记住这条：</b>' + linkCoords(P.principle, size) + '</div>';
      } else {
        if (P.solution) {
          /* 每条推理是一个可点的高亮行：点它，这一条里提到的点会一起在棋盘上亮出来 */
          out += '<p class="link-tip small muted">点下面的坐标标签，或点「完整推理」的任意一条，棋盘上会亮出对应的位置（再点一次取消）。</p>';
          /* solution 兼容字符串/数组两种写法（同多步题分支，见上面的注释） */
          var solItems2 = Array.isArray(P.solution) ? P.solution : [P.solution];
          out += '<div class="explain-block"><span class="lbl">完整推理</span><ol class="sol-list">';
          for (var k = 0; k < solItems2.length; k++) {
            out += '<li class="sol-row" data-row="' + k + '">' +
              '<span class="sol-n">' + (k + 1) + '</span>' +
              '<span class="sol-t">' + linkCoords(solItems2[k], size) + '</span></li>';
          }
          out += '</ol></div>';
        }
        if (P.traps && P.traps.length) {
          /* traps 兼容 {at,why} 与纯字符串两种写法（同多步题分支） */
          out += '<div class="explain-block"><span class="lbl">常见错误</span>';
          for (var t = 0; t < P.traps.length; t++) {
            var tr2 = P.traps[t];
            if (tr2 && typeof tr2 === 'object' && (tr2.at || tr2.why)) {
              out += '<div class="trap-item"><b>下在' + linkCoords(tr2.at, size) + '：</b>' +
                linkCoords(tr2.why, size) + '</div>';
            } else {
              out += '<div class="trap-item">' + linkCoords(String(tr2), size) + '</div>';
            }
          }
          out += '</div>';
        }
        if (P.principle) out += '<div class="principle"><b>记住这条：</b>' + linkCoords(P.principle, size) + '</div>';
      }
      out += '</div>';

      /* 选择题：正解已经落在棋盘上，这里点一句，免得读者以为是「自己那一手」 */
      if (P.kind === 'choice') {
        out += '<p class="small muted" style="margin-top:10px">棋盘上已经把这个正解落下来了 —— 绿点标出的就是那一手。</p>';
      }

      /* 棋盘题答错（或看了详解）：把正解的位置标出来 */
      if (!ok && P.kind === 'board' && view) {
        view.setStones(P.stones);
        setBase(P.answers.map(function (a) { return [a[0], a[1], 'good']; }));
      }

      if (cfg.footer) out += cfg.footer(ok, picked);
      return out;
    }

    function finish(ok, picked, revealed) {
      answered = true;
      /* 「直接看详解」不算答对，不写进度 */
      if (cfg.track && !revealed) store.markProblem(P.id, ok);
      /* 换了一批讲解，上一批的临时高亮作废 */
      linkMarks = []; activeRow = -1; chipSel = [];
      fb.innerHTML = feedbackHTML(ok, picked, revealed);
      syncChips(); syncRows();
      if (cfg.bindFooter) cfg.bindFooter(fb, ok, picked, revealed);
      if (cfg.onAnswered) cfg.onAnswered(ok, picked, revealed);
    }

    if (P.kind === 'board') {
      view = mountBoard(el('q-canvas'), {
        size: P.size,
        onPlay: function (x, y) {
          if (answered) return;
          var lbl = E.toLabel(y * P.size + x, P.size);
          var correct = P.answers.some(function (a) { return a[0] === x && a[1] === y; });
          if (correct) {
            view.setStones(P.stones.concat([[x, y, P.toMove]]));
            setBase([[x, y, 'good']].concat(P.answers.length > 1
              ? P.answers.slice(1).map(function (a) { return [a[0], a[1], 'point']; }) : []));
            finish(true, lbl);
            return;
          }
          var a = analyzeMove(P, [x, y]);
          setBase([[x, y, 'bad']]);
          var tip = el('q-tip');
          if (tip) tip.textContent = '再想想 —— 先看看提示。';
          if (cfg.retryOnWrong) {
            var old = fb.querySelector('.wrong-note');
            if (old) old.remove();
            fb.innerHTML = '<div class="feedback no wrong-note"><div class="head">这一点不行</div>' +
              '<p>' + esc(consequenceText(a)) + '</p>' +
              '<p class="small muted">再试一次，或者点「给我提示」。</p></div>' + fb.innerHTML;
            if (cfg.track) store.markProblem(P.id, false);
            return;
          }
          finish(false, lbl);
        }
      });
      view.setStones(P.stones);
      paint();          /* 先把题目自带的目标圈（P.focus）画出来 */
    } else {
      var choiceBox = el('q-choices');
      choiceBox.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || answered) return;
        var v = b.getAttribute('data-v');
        var correct = (v === P.answers[0]);
        b.classList.add(correct ? 'picked-ok' : 'picked-no');
        var all = choiceBox.querySelectorAll('button');
        for (var k = 0; k < all.length; k++) {
          all[k].disabled = true;
          if (all[k].getAttribute('data-v') === P.answers[0]) all[k].classList.add('picked-ok');
        }
        revealChoiceAnswer();
        finish(correct, v);
      });
      /* 只要有局面就画棋盘 —— 之前只在「有 mark」时才画，
         导致带完整局面（如胜负题）的选择题只能看文字，不直观。
         2026-09-28：两栏化之后，棋盘要插到**左栏**（.prob-board）里，
         而不是插到选项前面 —— 否则棋盘会跟着选项落在右栏，
         又变成「棋盘在右、讲解在下」的错位。
         2026-09-28 二次修订：移除 P.mark 蓝点。
         该字段在 8 道中盘选择题上标的点与正确答案无一相符（偏差 1 格至完全无关），
         含义不明且会误导读者，用户要求移除。棋盘改为只看 stones 决定是否渲染。 */
      var hasStones = !!(P.stones && P.stones.length);
      if (hasStones) {
        var wrap = document.createElement('div');
        wrap.className = 'demo-wrap';
        wrap.innerHTML = '<div class="board-shell">' + boardHolder('q-canvas2', P.size) + '</div>';
        var boardCol = host.querySelector('.prob-board');
        if (boardCol) boardCol.appendChild(wrap);
        else choiceBox.parentNode.insertBefore(wrap, choiceBox);
        var v2 = mountBoard(el('q-canvas2'), { size: P.size, interactive: false });
        v2.setStones(P.stones);
        choiceView = v2;
      }
    }

    /* 选择题的正解，直接在棋盘上落下来。
       2026-09-28 用户提：「选择题都不直观，正确答案应该在棋盘上落子下去展现出来」。
       以前只把选项按钮描个绿框 —— 文字里的坐标到底落在盘子哪儿，得自己一格一格数。
       落子前先用引擎试算过：8 道选择题的正解都是空点、合法、不提子（无自杀手），
       所以直接把这一手追加进盘面即可，不必走完整对局流程。 */
    function revealChoiceAnswer() {
      if (!choiceView || choiceRevealed) return;
      var m = /^([A-HJ-T])(\d{1,2})/.exec(String(P.answers[0] || ''));
      if (!m) return;
      var xy = labelToXY(m[1] + m[2], size);
      if (!xy) return;
      choiceRevealed = true;
      var x = xy[0], y = xy[1];
      choiceView.setStones(P.stones.concat([[x, y, P.toMove]]));
      choiceView.setLastMove([x, y]);      /* 绿点：这一手就是刚下的正解 */
      choiceView.setMarks([[x, y, 'good']]);
    }

    function showAnswer() {
      if (answered) return;
      if (P.kind === 'choice') {
        var all = el('q-choices').querySelectorAll('button');
        for (var k = 0; k < all.length; k++) {
          all[k].disabled = true;
          if (all[k].getAttribute('data-v') === P.answers[0]) all[k].classList.add('picked-ok');
        }
        revealChoiceAnswer();
      } else if (view) {
        setBase(P.answers.map(function (a) { return [a[0], a[1], 'good']; }));
      }
      finish(true, answerLabel(), true);
    }

    el('q-hint').onclick = addHint;
    el('q-show').onclick = showAnswer;
    var clr = el('q-clear-marks');
    if (clr) clr.onclick = clearMarks;
  }

  function renderProblem(id) {
    var idx = -1, i;
    for (i = 0; i < PROBLEMS.length; i++) if (PROBLEMS[i].id === id) idx = i;
    if (idx < 0) return renderProblems('all');
    var P = PROBLEMS[idx];

    app.innerHTML = '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/problems/' +
      P.cat + '">← 返回' + P.cat + '练习</a></div><div id="q-host"></div>';

    var meta = '<span class="pill">' + P.cat + '</span>' +
      '<span class="pill gray">难度 ' + '●'.repeat(P.level) + '</span>' +
      '<span class="pill gray">第 ' + (idx + 1) + ' / ' + PROBLEMS.length + ' 题</span>';

    mountProblemAnswer(el('q-host'), P, {
      metaHTML: meta,
      track: true,
      retryOnWrong: true,
      extraRow: '<span class="spacer"></span>' +
        (idx > 0 ? '<button class="btn ghost sm" onclick="location.hash=\'#/problem/' + PROBLEMS[idx - 1].id + '\'">上一题</button>' : '') +
        (idx < PROBLEMS.length - 1 ? '<button class="btn ghost sm" onclick="location.hash=\'#/problem/' + PROBLEMS[idx + 1].id + '\'">下一题</button>' : ''),
      footer: function () {
        var out = '<div class="row" style="margin-top:16px">';
        if (idx < PROBLEMS.length - 1) out += '<button class="btn" onclick="location.hash=\'#/problem/' + PROBLEMS[idx + 1].id + '\'">下一题 →</button>';
        out += '<button class="btn ghost" onclick="location.hash=\'#/problems/' + P.cat + '\'">返回列表</button>';
        out += '</div>';
        return out;
      }
    });
  }

  /* ================= 词典 ================= */
  function renderGlossary(openterm) {
    var cats = [], i;
    for (i = 0; i < GLOSSARY.length; i++) if (cats.indexOf(GLOSSARY[i].c) === -1) cats.push(GLOSSARY[i].c);

    var html = '<h1>术语词典</h1><p class="sub">下棋时听到的词，这里都讲透 —— 不只是「是什么」，还包括<b>为什么是这样</b>、<b>实战里怎么用</b>、<b>新手最容易搞错哪一点</b>。共 ' + GLOSSARY.length + ' 条，点开看详解。</p>';
    html += '<input class="search-box" id="g-search" placeholder="搜索术语、解释或用途…">';
    html += '<div id="g-list">';

    for (var c = 0; c < cats.length; c++) {
      html += '<div class="part-title" data-cat="' + cats[c] + '">' + cats[c] + '</div><div class="gloss-list">';
      for (i = 0; i < GLOSSARY.length; i++) {
        var g = GLOSSARY[i];
        if (g.c !== cats[c]) continue;
        var isOpen = (openterm && g.t === openterm);
        var body = '<p class="gd">' + md(g.d) + '</p>';
        if (g.w) body += '<div class="gsec"><span class="gk">为什么是这样</span><div class="gv">' + md(g.w) + '</div></div>';
        if (g.u) body += '<div class="gsec"><span class="gk">实战中怎么用</span><div class="gv">' + md(g.u) + '</div></div>';
        if (g.e) body += '<div class="gsec warn"><span class="gk">容易搞错的地方</span><div class="gv">' + md(g.e) + '</div></div>';
        if (g.r && g.r.length) {
          body += '<div class="grel">相关：';
          for (var ri = 0; ri < g.r.length; ri++) {
            body += '<button class="grel-btn" data-goto="' + esc(g.r[ri]) + '">' + esc(g.r[ri]) + '</button>';
          }
          body += '</div>';
        }
        html += '<div class="gloss-item' + (isOpen ? ' open' : '') + '" data-term="' + esc(g.t) + '" data-text="' + esc((g.t + g.d + (g.w || '') + (g.u || '') + (g.e || '')).toLowerCase()) + '">' +
          '<button class="gloss-head"><span class="t">' + esc(g.t) + '</span>' +
          '<span class="gcat">' + esc(g.c) + '</span>' +
          '<span class="arrow">›</span></button>' +
          '<div class="gloss-body">' + body + '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    app.innerHTML = html;

    if (openterm) {
      var target = app.querySelector('.gloss-item[data-term="' + openterm.replace(/"/g, '\\"') + '"]');
      if (target) setTimeout(function () { target.scrollIntoView({ block: 'start' }); }, 60);
    }

    app.addEventListener('click', function (e) {
      var rel = e.target.closest('.grel-btn');
      if (rel) {
        e.stopPropagation();
        location.hash = '#/glossary/' + encodeURIComponent(rel.getAttribute('data-goto'));
        return;
      }
      var head2 = e.target.closest('.gloss-head');
      if (head2) head2.parentElement.classList.toggle('open');
    });

    var search = el('g-search');
    search.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      var items = app.querySelectorAll('.gloss-item');
      for (var k = 0; k < items.length; k++) {
        var hit = !q || items[k].getAttribute('data-text').indexOf(q) !== -1;
        items[k].style.display = hit ? '' : 'none';
        if (q && hit) items[k].classList.add('open');
      }
      var titles = app.querySelectorAll('.part-title');
      for (var t = 0; t < titles.length; t++) {
        var list = titles[t].nextElementSibling;
        var any = false;
        var kids = list.querySelectorAll('.gloss-item');
        for (var m = 0; m < kids.length; m++) if (kids[m].style.display !== 'none') any = true;
        titles[t].style.display = any ? '' : 'none';
        list.style.display = any ? '' : 'none';
      }
    });
  }

  /* ================= 自由摆棋 ================= */
  /* 会话内保留的盘面状态：切换路数时不会把摆好的局面清掉 */
  var freeBoard = { size: 19, stones: [] };

  function freeSizeBtn(n) {
    return '<button class="size-btn' + (freeBoard.size === n ? ' on' : '') +
      '" data-sz="' + n + '">' + n + ' 路</button>';
  }

  function renderFreeBoard(notice) {
    var BS = freeBoard.size;
    var html = '<h1>自由摆棋</h1>';
    html += '<p class="sub">一张真实的棋盘。自己摆局面、试下，程序会实时告诉你：这块棋几口气、这个点能不能下、是不是真眼、现在谁的地多。</p>';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += boardHolder('f-canvas', BS);
    html += '<div class="tool-panel">' +
      '<button id="f-color" class="on">落子：黑</button>' +
      '<button id="f-libs">显示所有棋子的气</button>' +
      '<button id="f-eye">判断真眼假眼</button>' +
      '<button id="f-score">数目</button>' +
      '<button id="f-clear">清空</button>' +
      '</div>';
    html += '<div class="size-bar" id="f-sizes">' +
      '<span class="small muted">棋盘路数：</span>' +
      freeSizeBtn(19) + freeSizeBtn(13) + freeSizeBtn(9) +
      '<span class="small muted" style="margin-left:8px">默认 19 路（正式对局用）</span>' +
      '</div>';
    html += '<div class="info-line" id="f-info">点棋盘落子。再点同一点可以把它拿掉。</div>';
    html += '</div></div>';

    html += '<div class="card" style="margin-top:18px">';
    html += '<h3 style="margin-top:0">这个工具能帮你回答的问题</h3>';
    html += '<ul style="margin:8px 0;padding-left:20px">' +
      '<li><b>这块棋有几口气？</b>摆好局面，点「显示所有棋子的气」，每个棋块的气都会标出来。落子提子后会立刻重算。</li>' +
      '<li><b>这个点能不能下？</b>直接点，不能下会告诉你原因（禁入点 / 打劫 / 有子）。</li>' +
      '<li><b>这个眼是真的还是假的？</b>点「判断真眼假眼」，程序按规则帮你判定。</li>' +
      '<li><b>现在谁的地多？</b>点「数目」，按中国规则数子法算给你看。</li>' +
      '</ul>';
    html += '<p class="small muted" style="margin-bottom:0"><b>为什么要用 19 路？</b>正式对局都是 19 路。小棋盘（9 路）看着清楚，但它没有中腹、边角的空间感也完全不同 —— 只在练习局部死活时才用得上。</p>';
    html += '</div>';

    app.innerHTML = html;

    var bd = new Board(BS);
    var shown = stonesForRender();
    if (shown.length) bd.setup(shown);
    var color = 'b';
    var libsOn = false;
    var info = el('f-info');

    /* 把当前盘面存下来，切换路数时能接着用。
       注意：切到小盘时，原来在小盘范围外的子只是「暂时不显示」，不能丢掉，
       否则切回 19 路就找不回来了。 */
    function syncState() {
      var onBoard = GoBoardView.fromEngine(bd);
      var off = [], i;
      for (i = 0; i < freeBoard.stones.length; i++) {
        var s = freeBoard.stones[i];
        if (s[0] >= BS || s[1] >= BS) off.push(s);
      }
      freeBoard.stones = onBoard.concat(off);
      return off.length;
    }

    /* 当前路数下真正能上盘的子 */
    function stonesForRender() {
      var out = [], i;
      for (i = 0; i < freeBoard.stones.length; i++) {
        var s = freeBoard.stones[i];
        if (s[0] < BS && s[1] < BS) out.push(s);
      }
      return out;
    }

    /* 把当前每块棋的气重画一遍（棋块变了就要重算，否则会显示过期的气） */
    function drawLibs() {
      var marks = [], seen = new Uint8Array(bd.n), i, k, L;
      var chains = 0, totalLibs = 0;
      for (i = 0; i < bd.n; i++) {
        if (bd.g[i] === EMPTY || seen[i]) continue;
        var g = bd.group(i);
        for (k = 0; k < g.stones.length; k++) seen[g.stones[k]] = 1;
        chains++;
        totalLibs += g.libs.length;
        for (L = 0; L < g.libs.length; L++) {
          marks.push([g.libs[L] % BS, (g.libs[L] / BS) | 0, 'lib']);
        }
        /* 每块棋标一个代表子，方便数清盘上有几块棋 */
        marks.push([g.stones[0] % BS, (g.stones[0] / BS) | 0, 'point']);
      }
      view.setMarks(marks);
      return { chains: chains, libs: totalLibs };
    }

    /* 盘面一变就调用：气开着就重算，关着就清空 */
    function afterBoardChange() {
      if (libsOn) {
        var st = drawLibs();
        info.textContent = '盘上共 ' + st.chains + ' 块棋，气加起来 ' + st.libs +
          ' 口。绿色圆圈是气的位置，蓝点是每块棋的代表子。';
      } else {
        view.setMarks([]);
      }
    }

    var view = mountBoard(el('f-canvas'), {
      size: BS,
      onPlay: function (x, y) {
        var i = bd.idx(x, y);
        if (bd.g[i] !== EMPTY) {
          bd.g[i] = EMPTY;
          view.setStones(GoBoardView.fromEngine(bd));
          view.setLastMove(null);
          syncState();
          afterBoardChange();
          info.textContent = '拿掉了 (' + E.toLabel(i, BS) + ') 这颗子。';
          return;
        }
        var r = bd.play(i, color === 'b' ? BLACK : WHITE);
        if (!r.ok) {
          info.textContent = E.toLabel(i, BS) + ' 不能下：' + reasonText(r.reason) + '。';
          return;
        }
        view.setStones(GoBoardView.fromEngine(bd));
        view.setLastMove([x, y]);
        var msg = '下在 ' + E.toLabel(i, BS);
        if (r.captured.length) msg += '，提掉了 ' + r.captured.length + ' 颗子';
        var g = bd.group(i);
        msg += '。这手棋现在有 ' + g.libs.length + ' 口气。';
        syncState();
        afterBoardChange();
        info.textContent = msg;
        color = color === 'b' ? 'w' : 'b';
        el('f-color').textContent = '落子：' + (color === 'b' ? '黑' : '白');
        el('f-color').classList.toggle('on', color === 'b');
      }
    });
    if (notice) {
      info.textContent = notice;
    } else if (shown.length) {
      view.setStones(GoBoardView.fromEngine(bd));
      info.textContent = '已恢复上次摆的局面（盘上 ' + shown.length + ' 颗子）。';
    }

    el('f-color').onclick = function () {
      color = color === 'b' ? 'w' : 'b';
      this.textContent = '落子：' + (color === 'b' ? '黑' : '白');
      this.classList.toggle('on', color === 'b');
    };

    el('f-libs').onclick = function () {
      libsOn = !libsOn;
      this.classList.toggle('on', libsOn);
      this.textContent = libsOn ? '关闭气的显示' : '显示所有棋子的气';
      if (!libsOn) {
        view.setMarks([]);
        info.textContent = '已关闭气的显示。';
        return;
      }
      var st = drawLibs();
      info.textContent = '盘上共 ' + st.chains + ' 块棋，气加起来 ' + st.libs +
        ' 口。绿色圆圈是气的位置，蓝点是每块棋的代表子。落子或提子后会自动更新。';
    };

    el('f-eye').onclick = function () {
      /* 与「显示气」互斥，避免两套标记互相打架 */
      if (libsOn) {
        libsOn = false;
        el('f-libs').classList.remove('on');
        el('f-libs').textContent = '显示所有棋子的气';
      }
      var marks = [], i, n = 0;
      for (i = 0; i < bd.n; i++) {
        if (bd.g[i] !== EMPTY) continue;
        if (bd.isTrueEye(i, BLACK)) { marks.push([i % BS, (i / BS) | 0, 'eye']); n++; }
        else if (bd.isTrueEye(i, WHITE)) { marks.push([i % BS, (i / BS) | 0, 'bad']); n++; }
      }
      view.setMarks(marks);
      info.textContent = n ? '绿色圈 = 黑棋的真眼，红叉 = 白棋的真眼。'
        : '目前盘面上没有完整的真眼。真眼需要周围和斜角都归一方所有。';
    };

    el('f-score').onclick = function () {
      if (libsOn) {
        libsOn = false;
        el('f-libs').classList.remove('on');
        el('f-libs').textContent = '显示所有棋子的气';
      }
      var sc = bd.score(7.5);
      info.textContent = '按中国规则数子法：黑 ' + sc.black + ' 目，白 ' + sc.white +
        ' 目（含贴目 7.5），黑棋' + (sc.diff > 0 ? '领先 ' + sc.diff : '落后 ' + (-sc.diff)) +
        ' 目。注意：只有被单方围住的空点才算地，双方都接触的空点不算。';
    };

    el('f-clear').onclick = function () {
      bd.reset();
      freeBoard.stones = [];
      view.setStones([]);
      view.setMarks([]);
      view.setLastMove(null);
      color = 'b';
      libsOn = false;
      el('f-libs').classList.remove('on');
      el('f-libs').textContent = '显示所有棋子的气';
      el('f-color').textContent = '落子：黑';
      el('f-color').classList.add('on');
      info.textContent = '棋盘已清空。';
    };

    el('f-sizes').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var n = parseInt(b.getAttribute('data-sz'), 10);
      if (!n || n === freeBoard.size) return;
      syncState();
      var hidden = 0, i;
      for (i = 0; i < freeBoard.stones.length; i++) {
        if (freeBoard.stones[i][0] >= n || freeBoard.stones[i][1] >= n) hidden++;
      }
      var on = freeBoard.stones.length - hidden;
      freeBoard.size = n;
      var msg;
      if (n < 19 && hidden) {
        msg = '已切到 ' + n + ' 路：盘上 ' + on + ' 颗子，另有 ' + hidden +
          ' 颗在原棋盘这个范围之外，暂时看不到 —— 切回 19 路就回来。';
      } else if (on) {
        msg = '已切到 ' + n + ' 路，' + on + ' 颗子都在盘上。';
      } else {
        msg = '已切到 ' + n + ' 路。点棋盘落子。';
      }
      renderFreeBoard(msg);
    });
  }

  /* ================= 围棋思维史 ================= */
  function renderHistory() {
    var eras = [], i;
    for (i = 0; i < HISTORY.length; i++) {
      if (eras.indexOf(HISTORY[i].era) === -1) eras.push(HISTORY[i].era);
    }
    var html = '<h1>围棋思维史</h1>';
    html += '<p class="sub">' + HISTORY.length + ' 课，按时代讲清楚：每个时代的人为什么那样下棋，那些下法今天还用不用，以及——为什么变了。</p>';
    for (var e = 0; e < eras.length; e++) {
      html += '<div class="part-title">' + esc(eras[e]) + '</div><div class="lesson-list">';
      for (i = 0; i < HISTORY.length; i++) {
        var L = HISTORY[i];
        if (L.era !== eras[e]) continue;
        html += '<button class="lesson-item' + '' + '" onclick="location.hash=\'#/hlesson/' + L.id + '\'">' +
          '<span class="idx">' + (i + 1) + '</span>' +
          '<span class="body"><span class="t">' + esc(L.title) + '</span>' +
          '<span class="d">' + esc(L.span) + '　' + esc(L.lede) + '</span></span>' +
          '<span class="go">→</span></button>';
      }
      html += '</div>';
    }
    app.innerHTML = html;
  }

  function renderHistoryLesson(id) {
    var idx = -1, i;
    for (i = 0; i < HISTORY.length; i++) if (HISTORY[i].id === id) idx = i;
    if (idx < 0) return renderHistory();
    var L = HISTORY[idx];

    var html = '';
    html += '<div class="lesson-head">';
    html += '<div class="crumb"><a href="#/history">围棋思维史</a> ／ ' + esc(L.era) + '</div>';
    html += '<h1>' + esc(L.title) + '</h1>';
    html += '<div class="lede">' + esc(L.lede) + '</div>';
    html += '<div class="small muted" style="margin-top:6px">' + esc(L.span) + (L.legacy ? '' : '') + '</div>';
    html += '</div>';

    for (i = 0; i < L.sections.length; i++) {
      var s = L.sections[i];
      html += '<div class="sec">' + h('h3', null, esc(s.h));
      for (var j = 0; j < s.p.length; j++) html += '<p>' + md(s.p[j]) + '</p>';
      html += '</div>';
    }

    if (L.demo) {
      html += '<div class="demo-wrap"><div class="board-shell">';
      html += boardHolder('demo-canvas', L.demo.size);
      html += '<div class="board-bar" id="demo-bar"></div>';
      html += '</div>';
      html += '<div class="board-say" id="demo-say">点「下一步」开始演示。</div>';
      html += '</div>';
    }

    if (L.key) {
      html += '<div class="keybox"><div class="t">本课要点</div><ul>';
      for (i = 0; i < L.key.length; i++) html += '<li>' + md(L.key[i]) + '</li>';
      html += '</ul></div>';
    }

    if (L.legacy) {
      html += '<div class="principle" style="border-left-width:4px"><b>今天还用不用？</b><br>' + md(L.legacy) + '</div>';
    }

    html += '<div class="lesson-nav">';
    if (idx > 0) html += '<button class="btn ghost" onclick="location.hash=\'#/hlesson/' + HISTORY[idx - 1].id + '\'">← 上一课</button>';
    else html += '<span></span>';
    if (idx < HISTORY.length - 1) html += '<button class="btn" onclick="location.hash=\'#/hlesson/' + HISTORY[idx + 1].id + '\'">下一课 →</button>';
    html += '</div>';

    app.innerHTML = html;
    store.markLesson(id);
    if (L.demo) mountDemo(L.demo);
  }

  /* ================= 名局详解 ================= */
  var KATA_LETTERS = 'ABCDEFGHJKLMNOPQRST';

  function renderGames() {
    var html = '<h1>名局详解</h1>';
    html += '<p class="sub">不只是棋 —— 还有对弈的人、当时的处境、每一手的用意，以及这盘棋为什么被记住。</p>';
    html += '<div class="entry-grid">';
    for (var i = 0; i < GAMES.length; i++) {
      var g = GAMES[i];
      var sub = g.players.map(function (p) { return p.name; }).join(' vs ');
      html += '<button class="entry" onclick="location.hash=\'#/game/' + g.id + '\'">' +
        '<div class="t">' + esc(g.title) + '</div>' +
        '<div class="d">' + esc(g.subtitle) + '</div>' +
        '<div class="m">' + esc(g.date) + '　' + esc(sub) + '</div></button>';
    }
    html += '</div>';
    app.innerHTML = html;
  }

  /* 由着法序列重建某一手之后的局面
     · 兼容两种走法格式：'Q16'（纯坐标）与 'BQ16'（带颜色前缀，古谱与后加的名局用）
     · 支持 setup（预设棋子，例如中国古谱的「座子制」） */
  function boardAt(moves, n, size, setup) {
    var sz = size || 19;
    var bd = new Board(sz);
    if (setup) {
      var put = function (list, color) {
        for (var k = 0; k < (list || []).length; k++) {
          var pt = list[k];
          if (pt[0] >= 0 && pt[1] >= 0 && pt[0] < sz && pt[1] < sz) {
            bd.play(bd.idx(pt[0], pt[1]), color);
          }
        }
      };
      put(setup.b, BLACK);
      put(setup.w, WHITE);
    }
    for (var i = 0; i < n && i < moves.length; i++) {
      var mv = moves[i];
      var color = (i % 2 === 0) ? BLACK : WHITE;
      /* 带颜色前缀的格式，例如 'BQ16' / 'WD4' */
      if (mv.length >= 3 && (mv[0] === 'B' || mv[0] === 'W') &&
          /[A-HJ-T]/.test(mv[1]) && /^\d+$/.test(mv.slice(2))) {
        color = (mv[0] === 'B') ? BLACK : WHITE;
        mv = mv.slice(1);
      }
      if (mv === 'pass') { bd.pass(color); continue; }
      var x = KATA_LETTERS.indexOf(mv[0]);
      var y = sz - parseInt(mv.slice(1), 10);
      if (x < 0 || y < 0 || x >= sz || y >= sz) continue;
      bd.play(bd.idx(x, y), color);
    }
    return bd;
  }

  function renderGame(id, atMove) {
    var idx = -1, i;
    for (i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) idx = i;
    if (idx < 0) return renderGames();
    var g = GAMES[idx];
    var size = 19;
    var moves = (g.movesSeq || '').split(',').filter(function (s) { return s; });

    var html = '';
    html += '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/games">← 名局详解</a></div>';
    html += '<div class="lesson-head">';
    html += '<h1>' + esc(g.title) + '</h1>';
    html += '<div class="lede">' + esc(g.subtitle) + '</div>';
    html += '<div class="row small muted" style="margin-top:8px;gap:16px">' +
      '<span>' + esc(g.date) + '</span><span>' + esc(g.place) + '</span>' +
      '<span>' + esc(g.event) + '</span><span>' + esc(g.result) + '</span>' +
      (g.rule ? '<span>' + esc(g.rule) + '</span>' : '') +
      (g.movesTotal ? '<span>共 ' + esc(g.movesTotal) + ' 手</span>' : '') + '</div>';
    if (g.extNotes) {
      var nExt = 0;
      for (var ek in g.extNotes) if (g.extNotes[ek]) nExt++;
      html += '<div class="ext-banner">📖 本局附「' + esc(g.extNotesSource || '他人原注') +
        '」—— 共 ' + nExt + ' 条，随逐手回放显示，也可在页面下方「原注全编」里一口气读完。</div>';
    }
    html += '</div>';

    /* 对弈双方 */
    html += '<h2>对弈双方</h2>';
    html += '<div class="entry-grid" style="grid-template-columns:1fr 1fr">';
    for (i = 0; i < g.players.length; i++) {
      var p = g.players[i];
      html += '<div class="card" style="padding:18px 20px">' +
        '<div class="row" style="margin-bottom:6px"><span class="pill">' + esc(p.side) + '方</span>' +
        '<span class="pill gray">' + esc(p.rank) + '</span></div>' +
        '<div style="font-size:17px;font-weight:600">' + esc(p.name) + '</div>' +
        '<div class="small muted" style="margin:2px 0 8px">' + esc(p.flag) + '　' + esc(p.born) + '</div>' +
        '<p class="small" style="margin:6px 0">' + md(p.intro) + '</p>' +
        /* ★ 这两行要判空。原来直接拼 p.style / p.form，
           而 games_kejie.js 那 7 局的 players 没有这两个字段 ——
           页面上就明晃晃地显示「棋风：undefined」「当时状态：undefined」。
           数据缺字段时**宁可整行不显示**，也不要渲染出 undefined。 */
        (p.style ? '<p class="small" style="margin:6px 0"><b>棋风：</b>' + md(p.style) + '</p>' : '') +
        (p.form ? '<p class="small" style="margin:6px 0"><b>当时状态：</b>' + md(p.form) + '</p>' : '') +
        '</div>';
    }
    html += '</div>';

    /* 背景 */
    if (g.background) {
      html += '<h2>对局背景</h2>';
      html += '<div class="card">';
      html += '<p style="font-weight:600;color:var(--accent-2)">' + md(g.background.tldr) + '</p>';
      for (i = 0; i < g.background.paras.length; i++) {
        html += '<p>' + md(g.background.paras[i]) + '</p>';
      }
      html += '</div>';
    }

    /* 分阶段概述：把整盘棋先拉出骨架，再看逐手细节 */
    if (g.phases && g.phases.length) {
      html += '<h2>这盘棋的走向</h2>';
      html += '<div class="card">';
      for (i = 0; i < g.phases.length; i++) {
        var ph = g.phases[i];
        var rng = (ph.range && ph.range.length === 2)
          ? '第 ' + ph.range[0] + ' – ' + ph.range[1] + ' 手' : '';
        html += '<div class="phase-row">' +
          '<div class="phase-name">' + esc(ph.name) + '</div>' +
          '<div class="phase-body"><span class="small muted">' + rng + '</span>' +
          '<p style="margin:4px 0 0">' + md(ph.text) + '</p></div>' +
          '</div>';
      }
      html += '</div>';
    }

    /* 棋盘回放：左图右文，棋盘吸附 */
    html += '<h2>逐手回放</h2>';
    html += '<div class="study-layout">';
    html += '<div class="study-board"><div class="board-shell">';
    html += boardHolder('game-canvas', 19);
    /* 控制条只在骨架里建一次；show() 里只更新状态。
       ★ 原来 show() 每帧都 `bar.innerHTML = …` 重建整条控制条（含 <input type=range>），
       于是用户真实拖动进度条时，第一次 input 就把滑块元素换掉了 —— 拖拽随即中断，
       表现为「进度条只能拖一格」。改成一次绑定 + 更新 value。 */
    html += '<div class="board-bar" id="game-bar">' +
      '<button class="btn ghost sm" id="g-prev">上一步</button>' +
      '<button class="btn sm" id="g-next">下一手</button>' +
      '<button class="btn ghost sm" id="g-play">自动播放</button>' +
      '<input type="range" id="g-range" min="0" max="1" value="0" style="flex:1;min-width:120px">' +
      '<span class="small muted" id="g-count">0 / 0</span></div>';
    html += '<div class="board-say" id="game-say"></div>';
    html += '</div></div>';
    html += '<div class="study-notes" id="game-note"></div>';
    html += '</div>';

    /* 关键手 */
    if (g.keyMoments && g.keyMoments.length) {
      html += '<h2>关键手</h2>';
      for (i = 0; i < g.keyMoments.length; i++) {
        var k = g.keyMoments[i];
        html += '<div class="card" style="margin-bottom:16px">' +
          '<div class="row" style="margin-bottom:8px"><span class="pill wood">第 ' + k.n + ' 手</span>' +
          '<span style="font-weight:600">' + esc(k.label) + '</span></div>' +
          '<p class="small muted">' + esc(k.summary) + '</p>' +
          '<div class="km-board">' +
          '<div class="canvas-wrap"><canvas class="km-canvas" data-n="' + k.n + '"></canvas></div>' +
          '<div class="km-text">';
        for (var j = 0; j < k.detail.length; j++) {
          html += '<p>' + md(k.detail[j]) + '</p>';
        }
        html += '</div></div>' +
          '<button class="btn ghost sm" onclick="jumpTo(' + k.n + ')">在棋盘上跳到这一手</button>' +
          '</div>';
      }
    }

    /* 影响 */
    if (g.impact && g.impact.length) {
      html += '<h2>这盘棋的影响</h2><div class="card">';
      for (i = 0; i < g.impact.length; i++) html += '<p>' + md(g.impact[i]) + '</p>';
      html += '</div>';
    }

    /* 花絮 */
    if (g.anecdotes && g.anecdotes.length) {
      html += '<h2>花絮</h2><div class="card">';
      for (i = 0; i < g.anecdotes.length; i++) {
        html += '<div class="trap-item" style="background:var(--wood-soft);border-left-color:var(--wood)">' +
          md(g.anecdotes[i]) + '</div>';
      }
      html += '</div>';
    }

    /* 原注全编：把别人的逐手批注按顺序排开，读起来像看一本带旁批的棋谱 */
    if (g.extNotes) {
      var ekeys = [];
      for (var e1 in g.extNotes) if (g.extNotes[e1]) ekeys.push(parseInt(e1, 10));
      ekeys.sort(function (a, b) { return a - b; });
      if (ekeys.length) {
        html += '<h2>原注全编</h2>';
        html += '<div class="card"><p class="small muted" style="margin-bottom:10px">' +
          '以下文字出自「' + esc(g.extNotesSource || '他人原注') +
          '」，是外部的批注，我们原样附在这里供对照参看 —— 逐手回放里的讲解是本典自己写的，' +
          '两种看法并不总是一致，并存着看本身就是读古谱的乐趣。</p>';
        html += '<details class="ext-full"><summary>展开全部 ' + ekeys.length + ' 条原注</summary>';
        for (i = 0; i < ekeys.length; i++) {
          html += '<div class="ext-row"><span class="ext-n">' + ekeys[i] + ' 手</span>' +
            '<div class="ext-t">' + md(g.extNotes[String(ekeys[i])]) + '</div></div>';
        }
        html += '</details></div>';
      }
    }

    html += '<div class="lesson-nav">';
    if (idx > 0) html += '<button class="btn ghost" onclick="location.hash=\'#/game/' + GAMES[idx - 1].id + '\'">← 上一盘</button>';
    else html += '<span></span>';
    if (idx < GAMES.length - 1) html += '<button class="btn" onclick="location.hash=\'#/game/' + GAMES[idx + 1].id + '\'">下一盘 →</button>';
    html += '</div>';

    app.innerHTML = html;

    /* --- 棋盘回放控制 --- */
    var cur = 0;
    var view = mountBoard(el('game-canvas'), {
      size: size,
      interactive: false,
      onPlay: function () {}
    });
    view.canvas.__view = view;   /* 挂在 canvas 上，供自动化测试与排查脚本读盘面 */
    var bar = el('game-bar');
    /* 控制条事件只绑定一次（元素不再被 show() 重建） */
    el('g-prev').onclick = function () { stopPlay(); show(cur - 1); };
    el('g-next').onclick = function () { stopPlay(); show(cur + 1); };
    el('g-range').oninput = function () { stopPlay(); show(parseInt(this.value, 10)); };
    el('g-play').onclick = function () { playPause(); };
    var say = el('game-say');
    var noteBox = el('game-note');

    function keyAt(n) {
      if (!g.keyMoments) return null;
      for (var k = 0; k < g.keyMoments.length; k++) if (g.keyMoments[k].n === n) return g.keyMoments[k];
      return null;
    }

    function show(n) {
      cur = Math.max(0, Math.min(n, moves.length));
      var bd = boardAt(moves, cur, size, g.setup);
      view.setStones(GoBoardView.fromEngine(bd));
      if (cur > 0) {
        var last = moves[cur - 1];
        if (last !== 'pass') {
          /* ⚠️ 着手串带颜色前缀（如 'WD14'），必须先剥掉再取字母与行号。
             原来直接拿 last[0] 当列字母：'W' 在 KATA_LETTERS 里找不到 → x=-1，
             parseInt('D14') → NaN，结果最新手标记被画到画布外面、每一步都看不见。 */
          var lmv = last;
          if (lmv.length >= 3 && (lmv[0] === 'B' || lmv[0] === 'W')) lmv = lmv.slice(1);
          var lx = KATA_LETTERS.indexOf(lmv[0]);
          var ly = size - parseInt(lmv.slice(1), 10);
          view.setLastMove((lx >= 0 && ly >= 0 && ly < size) ? [lx, ly] : null);
        } else {
          view.setLastMove(null);
        }
      } else {
        view.setLastMove(null);
      }

      /* 本手颜色：优先取着手串的颜色前缀（古谱与后加名局写作 'BQ16' 这种形式），
         没有前缀时按「首手为黑」推断；让子/座子局（setup 里有黑子）首手是白，
         奇偶要对调 —— 否则让子局每一手的颜色都会标反。
         显示时还要把颜色前缀剥掉，否则会显示成「黑 BP3」这种带前缀的坐标。 */
      var lastRaw = cur > 0 ? moves[cur - 1] : '';
      var lastPlain = lastRaw, lastColor = null;
      if (lastRaw.length >= 3 && (lastRaw[0] === 'B' || lastRaw[0] === 'W') &&
          /[A-HJ-T]/.test(lastRaw[1]) && /^\d+$/.test(lastRaw.slice(2))) {
        lastColor = lastRaw[0];
        lastPlain = lastRaw.slice(1);
      }
      var firstBlack = !(g.setup && g.setup.b && g.setup.b.length);
      var who = lastColor ? (lastColor === 'B' ? '黑' : '白')
                          : (((cur % 2 === 1) === firstBlack) ? '黑' : '白');
      var mvTxt = cur > 0 ? (who + ' ' + lastPlain) : '开局';
      say.textContent = cur === 0 ? '空棋盘。点「下一手」开始，或直接拖动进度。' : ('第 ' + cur + ' 手　' + mvTxt);

      var k = keyAt(cur);
      var note = (g.moveNotes && g.moveNotes[cur]) || '';
      var out = '';
      if (k) {
        out += '<div class="principle" style="margin-top:0"><b>' + esc(k.label) + '</b> —— 这是本局最关键的一手之一，详情见下方「关键手」。</div>';
      }
      if (note) {
        out += '<div class="explain-block" style="margin:10px 0"><span class="lbl g">第 ' + cur + ' 手</span><p>' + md(note) + '</p></div>';
      } else if (cur > 0) {
        out += '<p class="small muted">这一手的讲解正在补充中。（本局的讲解按关键程度分级，越重要的手写得越细）</p>';
      }
      /* 别人对这一手的原注（引用，单独一块，不与我们自己的讲解混在一起） */
      var ext = '';
      if (g.extNotes) ext = g.extNotes[cur] || g.extNotes[String(cur)] || '';
      if (ext) {
        out += '<div class="ext-note"><span class="ext-note-hd">原注 · ' +
          esc(g.extNotesSource || '他人点评') + '</span>' + md(ext) + '</div>';
      }
      noteBox.innerHTML = out;

      /* 只更新状态，不重建元素 —— 重建会把滑块 replace 掉，真实拖动会中断 */
      var rng = el('g-range');
      if (rng) {
        rng.max = moves.length;
        rng.value = cur;
        el('g-count').textContent = cur + ' / ' + moves.length;
        el('g-prev').disabled = (cur === 0);
        el('g-next').disabled = (cur >= moves.length);
      }
    }

    var timer = null;
    function playPause() {
      if (timer) { stopPlay(); return; }
      el('g-play').textContent = '暂停';
      timer = setInterval(function () {
        if (cur >= moves.length) { stopPlay(); return; }
        show(cur + 1);
      }, 700);
    }
    function stopPlay() {
      if (timer) { clearInterval(timer); timer = null; }
      var b = el('g-play');
      if (b) b.textContent = '自动播放';
    }

    window.jumpTo = function (n) {
      stopPlay();
      show(n);
      el('game-canvas').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    /* 关键手的小棋盘：每张图高亮那一手落点的位置 */
    var kms = app.querySelectorAll('.km-canvas');
    for (var ki = 0; ki < kms.length; ki++) {
      (function (cv) {
        var n = parseInt(cv.getAttribute('data-n'), 10);
        var bd = boardAt(moves, n, size, g.setup);
        var kv = mountBoard(cv, { size: size, interactive: false, showLabels: false });
        kv.setStones(GoBoardView.fromEngine(bd));
        if (n > 0 && moves[n - 1] && moves[n - 1] !== 'pass') {
          /* 同样要先剥颜色前缀，否则高亮点会被算成 (-1, NaN)、关键手在缩略图上不亮 */
          var mv = moves[n - 1];
          if (mv.length >= 3 && (mv[0] === 'B' || mv[0] === 'W')) mv = mv.slice(1);
          var mx = KATA_LETTERS.indexOf(mv[0]);
          var my = size - parseInt(mv.slice(1), 10);
          kv.setMarks([[mx, my, 'good']]);
          kv.setLastMove([mx, my]);
        }
      })(kms[ki]);
    }

    show(atMove ? parseInt(atMove, 10) || 0 : 0);
  }

  /* ================= 定式库 ================= */
  /* 每个定式都要回答四个问题：什么时代 / 当时为什么这么下 / 现在还用不用 / 为什么变了 */
  var ERA_ORDER = ['座子时代', '日本古谱时代', '新布局时代', '现代', 'AI 时代'];

  function eraBadge(era) {
    var cls = era === 'AI 时代' ? 'era-ai' : (era === '座子时代' || era === '日本古谱时代' ? 'era-ancient' : 'era-modern');
    return '<span class="pill era ' + cls + '">' + esc(era) + '</span>';
  }

  /* 定式步进器：把 setup + 前 n 手画到棋盘上，并驱动「上一手 / 下一手 / 从头开始 / 进度条」。
     做法照抄名局页 renderGame 的 show(n)/g-prev/g-next/g-range，只是每个定式（主变化）
     与每个变化各自挂一套，互不影响。初始停在第一手之后，让读者能一步步跟着走。 */
  function josekiSteps(canvasId, barId, sayId, setup, moves, size, moveNotes, tag) {
    moves = moves || [];
    var view = mountBoard(el(canvasId), { size: size, interactive: false });
    view.canvas.__view = view;   /* 把棋盘视图挂在 canvas 上，供自动化测试读盘面子数 */
    var bar = el(barId), say = el(sayId);
    var cur = moves.length ? 1 : 0;

    function boardAt(n) {
      var bd = new Board(size);
      if (setup && setup.length) bd.setup(setup);
      for (var k = 0; k < n; k++) {
        var m = moves[k];
        if (!m || m.length < 3) continue;
        bd.play(bd.idx(m[0], m[1]), m[2] === 'b' ? BLACK : WHITE);
      }
      return bd;
    }

    function show(n) {
      cur = Math.max(0, Math.min(n, moves.length));
      var bd = boardAt(cur);
      view.setStones(GoBoardView.fromEngine(bd));
      if (cur > 0) view.setLastMove([moves[cur - 1][0], moves[cur - 1][1]]);
      else view.setLastMove(null);

      var head;
      if (cur > 0) {
        var mv = moves[cur - 1];
        head = '第 ' + cur + ' 手　' + (mv[2] === 'b' ? '黑' : '白') + ' ' +
          E.toLabel(bd.idx(mv[0], mv[1]), size);
      } else {
        head = '起手之前（盘上' + (setup && setup.length ? '已摆好预设的子' : '还是空的') + '）';
      }
      var note = (moveNotes && moveNotes[cur]) || '';
      say.innerHTML = '<div class="jk-step-head">' + esc(head) + '</div>' +
        (note ? '<div class="jk-step-note">' + md(note) + '</div>'
          : '<div class="jk-step-note muted">这一手的说明正在补充中。</div>');

      el(barId + '-prev').disabled = (cur <= 0);
      el(barId + '-next').disabled = (cur >= moves.length);
      el(barId + '-reset').disabled = (cur === 1);
      el(barId + '-range').value = cur;
      el(barId + '-count').textContent = cur + ' / ' + moves.length;
    }

    bar.innerHTML =
      (tag ? '<span class="pill wood">' + esc(tag) + '</span>' : '') +
      '<button class="btn ghost sm" id="' + barId + '-prev">上一手</button>' +
      '<button class="btn sm" id="' + barId + '-next">下一手</button>' +
      '<button class="btn ghost sm" id="' + barId + '-reset">从头开始</button>' +
      '<input type="range" id="' + barId + '-range" min="0" max="' + moves.length + '" value="' + cur + '" style="flex:1;min-width:110px">' +
      '<span class="small muted" id="' + barId + '-count">' + cur + ' / ' + moves.length + '</span>';
    el(barId + '-prev').onclick = function () { show(cur - 1); };
    el(barId + '-next').onclick = function () { show(cur + 1); };
    el(barId + '-reset').onclick = function () { show(1); };
    el(barId + '-range').oninput = function () { show(parseInt(this.value, 10)); };

    show(cur);
    return view;
  }

  function renderJoseki() {
    if (typeof JOSEKI === 'undefined') return renderHome();
    var html = '<h1>定式库</h1>';
    html += '<p class="sub">围棋的「常用套路」。这里的每个定式都会告诉你四件事：' +
      '<b>这是什么时代的</b>、<b>当时为什么这么下</b>、<b>现在还用不用</b>、<b>为什么变了</b>。' +
      '共 ' + JOSEKI.length + ' 个。</p>';

    var eras = [];
    for (var i = 0; i < JOSEKI.length; i++) {
      if (eras.indexOf(JOSEKI[i].era) === -1) eras.push(JOSEKI[i].era);
    }
    eras.sort(function (a, b) {
      var ia = ERA_ORDER.indexOf(a), ib = ERA_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    for (var e = 0; e < eras.length; e++) {
      var era = eras[e];
      html += '<div class="part-title">' + esc(era) + '</div><div class="entry-grid">';
      for (i = 0; i < JOSEKI.length; i++) {
        var j = JOSEKI[i];
        if (j.era !== era) continue;
        var badge = /常用|还在用/.test(j.stillUsed || '') ? '<span class="pill ok">还在用</span>'
          : (/淘汰|不用/.test(j.stillUsed || '') ? '<span class="pill gray">已淘汰</span>' : '');
        html += '<button class="entry" onclick="location.hash=\'#/joseki/' + j.id + '\'">' +
          '<div class="t">' + esc(j.name) + ' ' + badge + '</div>' +
          '<div class="d">' + esc(j.conclusion || j.why || '') .slice(0, 46) + '…</div>' +
          '<div class="m">' + esc(j.years || '') + '　' + esc(j.region || '') + '</div></button>';
      }
      html += '</div>';
    }
    app.innerHTML = html;
  }

  function renderJosekiDetail(id) {
    if (typeof JOSEKI === 'undefined') return renderJoseki();
    var j = null;
    for (var i = 0; i < JOSEKI.length; i++) if (JOSEKI[i].id === id) j = JOSEKI[i];
    if (!j) return renderJoseki();

    var html = '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/joseki">← 定式库</a></div>';
    html += '<div class="lesson-head"><h1>' + esc(j.name) + '</h1>';
    html += '<div class="lede">' + eraBadge(j.era) + ' <span class="small muted">' + esc(j.years || '') +
      '　' + esc(j.region || '') + '</span></div></div>';

    html += '<h2>主变化</h2>';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += boardHolder('jk-canvas', j.size || 19);
    html += '<div class="board-bar" id="jk-bar"></div>';
    html += '<div class="board-say" id="jk-say"></div>';
    html += '</div></div>';

    if (j.why) html += '<div class="card"><h3 style="margin-top:0">当时为什么这么下</h3><p>' + md(j.why) + '</p></div>';
    if (j.stillUsed) {
      html += '<div class="card"><h3 style="margin-top:0">现在还用不用</h3><p>' + md(j.stillUsed) + '</p>';
      if (j.whyChanged) html += '<p>' + md(j.whyChanged) + '</p>';
      html += '</div>';
    }
    if (j.aiView) html += '<div class="card"><h3 style="margin-top:0">AI 怎么看</h3><p>' + md(j.aiView) + '</p></div>';
    if (j.principle) html += '<div class="keybox"><div class="t">可迁移的思路</div><p>' + md(j.principle) + '</p></div>';
    if (j.caution) html += '<div class="trap-item" style="background:var(--wood-soft)">' + md(j.caution) + '</div>';

    var vars = j.variations || [];
    if (vars.length) {
      html += '<h2>主要变化</h2>';
      for (i = 0; i < vars.length; i++) {
        html += '<div class="card"><div style="font-weight:600;margin-bottom:6px">' + esc(vars[i].name || ('变化 ' + (i + 1))) + '</div>';
        html += '<div class="demo-wrap"><div class="board-shell">' +
          boardHolder('jk-var-' + i, j.size || 19) +
          '<div class="board-bar" id="jk-var-bar-' + i + '"></div>' +
          '<div class="board-say" id="jk-var-say-' + i + '"></div>' +
          '</div></div>';
        if (vars[i].note) html += '<p class="small">' + md(vars[i].note) + '</p>';
        html += '</div>';
      }
    }

    html += '<div class="lesson-nav"><button class="btn ghost" onclick="location.hash=\'#/joseki\'">← 回定式库</button><span></span></div>';
    app.innerHTML = html;

    josekiSteps('jk-canvas', 'jk-bar', 'jk-say', j.setup, j.moves, j.size || 19, j.moveNotes, '主变化');
    for (i = 0; i < vars.length; i++) {
      josekiSteps('jk-var-' + i, 'jk-var-bar-' + i, 'jk-var-say-' + i,
        j.setup, vars[i].moves, j.size || 19, vars[i].moveNotes,
        vars[i].name || ('变化 ' + (i + 1)));
    }
  }

  /* ================= 死活形图库 ================= */
  function statusBadge(st) {
    var cls = /活/.test(st) && !/死/.test(st) ? 'ok' : (/劫/.test(st) ? 'wood' : 'gray');
    return '<span class="pill ' + cls + '">' + esc(st) + '</span>';
  }

  function renderShapes() {
    if (typeof SHAPES === 'undefined') return renderHome();
    var html = '<h1>死活形图库</h1>';
    html += '<p class="sub">标准形的速查表 —— <b>一眼看懂是死是活、要点在哪、为什么</b>。' +
      '共 ' + SHAPES.length + ' 个形。结论全部由程序验证过。</p>';

    /* 分组匹配要写精确：「劫死」「劫尽棋亡」里也含「死」字，
       原来用 /死/ 会把它们吸进死形里（它们是劫形）。
       这里「死」组只认「死 / 先手死」，劫类留到劫组。 */
    var groups = [['死', /^(先手死|死)$/], ['活', /^活/], ['劫', /劫/]];
    for (var g = 0; g < groups.length; g++) {
      var list = [];
      for (var i = 0; i < SHAPES.length; i++) if (groups[g][1].test(SHAPES[i].status || '')) list.push(SHAPES[i]);
      if (!list.length) continue;
      html += '<div class="part-title">' + groups[g][0] + '形（' + list.length + '）</div><div class="entry-grid">';
      for (i = 0; i < list.length; i++) {
        var s = list[i];
        html += '<button class="entry" onclick="location.hash=\'#/shape/' + s.id + '\'">' +
          '<div class="t">' + esc(s.name) + ' ' + statusBadge(s.status) + '</div>' +
          '<div class="d">' + esc(s.key || s.conclusion || '').slice(0, 46) + '…</div>' +
          '<div class="m">' + esc(s.region || '') + '</div></button>';
      }
      html += '</div>';
    }
    app.innerHTML = html;
  }

  function renderShapeDetail(id) {
    if (typeof SHAPES === 'undefined') return renderShapes();
    var s = null;
    for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].id === id) s = SHAPES[i];
    if (!s) return renderShapes();

    var bd = new Board(s.size || 19);
    var pts = s.stars || s.stones || [];
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      bd.g[bd.idx(p[0], p[1])] = (p[2] === 'b') ? BLACK : WHITE;
    }
    /* 要点标记：**活形画绿点、死形画蓝点** ——
       必须和下面 board-bar 的图例文案一致（原实现一律画蓝点，
       而活形那行却写着「绿点 = 做活的要点」，读者照文案找绿点会找不到）。 */
    var marks = [];
    var isLive = /^活/.test(s.status || '');
    for (i = 0; i < (s.vital || []).length; i++) {
      marks.push([s.vital[i][0], s.vital[i][1], isLive ? 'good' : 'point']);
    }

    var html = '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/shapes">← 死活形图库</a></div>';
    html += '<div class="lesson-head"><h1>' + esc(s.name) + ' ' + statusBadge(s.status) + '</h1>';
    if (s.conclusion) html += '<div class="lede">' + md(s.conclusion) + '</div>';
    if (s.alias && s.alias.length) html += '<div class="small muted">又叫：' + esc(s.alias.join('、')) + '</div>';
    html += '</div>';

    html += '<div class="demo-wrap"><div class="board-shell">';
    html += boardHolder('sh-canvas', s.size || 19);
    html += '<div class="board-bar"><span class="pill wood">' +
      (isLive ? '绿点 = 做活的要点' : '蓝点 = 杀的要点') + '</span></div>';
    html += '</div></div>';

    if (s.why) html += '<div class="card"><h3 style="margin-top:0">为什么是这个结论</h3><p>' + md(s.why) + '</p></div>';
    if (s.key) html += '<div class="keybox"><div class="t">一句话记住它</div><p>' + md(s.key) + '</p></div>';
    if (s.how && s.how.length) {
      html += '<h2>双方最优走法</h2><div class="card"><p class="small muted">按顺序：' +
        s.how.map(function (m) {
          return (m[2] === 'b' ? '黑' : '白') + E.toLabel(bd.idx(m[0], m[1]), s.size || 19);
        }).join(' → ') + '</p></div>';
    }
    if (s.related && s.related.length) {
      html += '<div class="grel">相关形状：';
      for (i = 0; i < s.related.length; i++) {
        /* related 里存的是**形名**（如「曲三」），要跳转得先换成 id。
           以前这些按钮一律回图库首页 —— 点「相关形状」却看不到那个形状。 */
        var rid = '';
        for (var j = 0; j < SHAPES.length; j++) {
          if (SHAPES[j].name === s.related[i] || (SHAPES[j].alias || []).indexOf(s.related[i]) >= 0) { rid = SHAPES[j].id; break; }
        }
        html += rid
          ? '<button class="grel-btn" onclick="location.hash=\'#/shape/' + rid + '\'">' + esc(s.related[i]) + '</button>'
          : '<button class="grel-btn" disabled title="图库里没有这个形">' + esc(s.related[i]) + '</button>';
      }
      html += '</div>';
    }
    html += '<div class="lesson-nav"><button class="btn ghost" onclick="location.hash=\'#/shapes\'">← 回图库</button><span></span></div>';
    app.innerHTML = html;

    var v = mountBoard(el('sh-canvas'), { size: s.size || 19, interactive: false });
    v.setStones(GoBoardView.fromEngine(bd));
    if (marks.length) v.setMarks(marks);
  }

  /* ================= 训练方法 ================= */
  /* 结构照 lessons（id/part/title/lede/sections/key），但没有棋盘演示 */
  function renderTraining() {
    if (typeof TRAINING === 'undefined') return renderHome();
    var html = '<h1>训练方法</h1><p class="sub">怎么练才有效。' + TRAINING.length +
      ' 课，讲的是方法不是知识 —— 包括怎么做死活题、什么时候该学定式、输棋之后该做什么。</p>';
    var parts = [], i;
    for (i = 0; i < TRAINING.length; i++) {
      if (parts.indexOf(TRAINING[i].part) === -1) parts.push(TRAINING[i].part);
    }
    for (var p = 0; p < parts.length; p++) {
      html += '<div class="part-title">' + esc(parts[p]) + '</div><div class="lesson-list">';
      for (i = 0; i < TRAINING.length; i++) {
        var L = TRAINING[i];
        if (L.part !== parts[p]) continue;
        html += '<button class="lesson-item" onclick="location.hash=\'#/tlesson/' + L.id + '\'">' +
          '<span class="idx">' + (i + 1) + '</span>' +
          '<span class="body"><span class="t">' + esc(L.title) + '</span>' +
          '<span class="d">' + esc(L.lede) + '</span></span>' +
          '<span class="go">→</span></button>';
      }
      html += '</div>';
    }
    app.innerHTML = html;
  }

  function renderTrainingLesson(id) {
    if (typeof TRAINING === 'undefined') return renderTraining();
    var idx = -1, i;
    for (i = 0; i < TRAINING.length; i++) if (TRAINING[i].id === id) idx = i;
    if (idx < 0) return renderTraining();
    var L = TRAINING[idx];

    var html = '';
    html += '<div class="lesson-head">';
    html += '<div class="crumb"><a href="#/training">训练方法</a> ／ ' + esc(L.part) + ' ／ 第 ' + (idx + 1) + ' 课</div>';
    html += '<h1>' + esc(L.title) + '</h1>';
    html += '<div class="lede">' + esc(L.lede) + '</div>';
    html += '</div>';

    for (i = 0; i < (L.sections || []).length; i++) {
      var s = L.sections[i];
      html += '<div class="sec">' + h('h3', null, esc(s.h));
      for (var j = 0; j < s.p.length; j++) html += '<p>' + md(s.p[j]) + '</p>';
      html += '</div>';
    }
    if (L.key && L.key.length) {
      html += '<div class="keybox"><div class="t">本课要点</div><ul>';
      for (i = 0; i < L.key.length; i++) html += '<li>' + md(L.key[i]) + '</li>';
      html += '</ul></div>';
    }
    html += '<div class="lesson-nav">';
    if (idx > 0) html += '<button class="btn ghost" onclick="location.hash=\'#/tlesson/' + TRAINING[idx - 1].id + '\'">← 上一课</button>';
    else html += '<span></span>';
    if (idx < TRAINING.length - 1) html += '<button class="btn" onclick="location.hash=\'#/tlesson/' + TRAINING[idx + 1].id + '\'">下一课 →</button>';
    html += '</div>';

    app.innerHTML = html;
  }

  /* ================= 实战自测 ================= */
  /* 三个工具：对局自评 / 随机测验 / 常见失误自查表。
     一律不写 localStorage、不累计、不显示百分比 —— 用户明确要求不要学习焦虑。
     会话状态都放在模块变量里，刷新即清空。 */

  var SELF_RULES = (typeof SELFCHECK !== 'undefined') ? SELFCHECK : [];

  function selfRule(id) {
    for (var i = 0; i < SELF_RULES.length; i++) if (SELF_RULES[i].id === id) return SELF_RULES[i];
    return null;
  }
  function ruleTone(level) {
    return level === '好棋特征' ? 'good' : (level === '值得注意' ? 'info' : 'bad');
  }
  function packMark(i, size, type) { return [i % size, (i / size) | 0, type]; }
  function lineOfPoint(i, size) {
    var x = i % size, y = (i / size) | 0;
    return Math.min(x, y, size - 1 - x, size - 1 - y) + 1;
  }
  function chainList(bd, color) {
    var seen = new Uint8Array(bd.n), out = [], i, k, g;
    for (i = 0; i < bd.n; i++) {
      if (bd.g[i] === color && !seen[i]) {
        g = bd.group(i);
        for (k = 0; k < g.stones.length; k++) seen[g.stones[k]] = 1;
        out.push(g);
      }
    }
    return out;
  }
  function atariCount(bd, color) {
    var cs = chainList(bd, color), n = 0, i;
    for (i = 0; i < cs.length; i++) if (cs[i].libs.length === 1) n++;
    return n;
  }
  /* 一方「走一步就能把两块棋连起来」的点（移植自 tools/moveinfo.js 的 cutReduction） */
  function connectPoints(bd, color) {
    var before = chainList(bd, color).length, out = [], i, k, ns, same, r;
    for (i = 0; i < bd.n; i++) {
      if (bd.g[i] !== EMPTY) continue;
      ns = bd.nb[i]; same = 0;
      for (k = 0; k < ns.length; k++) if (bd.g[ns[k]] === color) same++;
      if (same < 2) continue;
      r = bd.play(i, color);
      if (!r.ok) continue;
      if (chainList(bd, color).length < before) out.push(i);
      bd.undo(r.rec);
    }
    return out;
  }
  /* 当前可以一手提掉的点：对方只剩 1 气的棋块的最后一口气 */
  function capturePoints(bd, color) {
    var opp = color === BLACK ? WHITE : BLACK;
    var cs = chainList(bd, opp), out = [], i, k;
    for (i = 0; i < cs.length; i++) {
      if (cs[i].libs.length !== 1) continue;
      var p = cs[i].libs[0];
      if (bd.isLegal(p, color) && out.indexOf(p) < 0) out.push(p);
    }
    return out;
  }

  /* 给一手棋打分：只依赖 engine.js 的规则与几何，不联网、不调用 AI。
     返回 [{id, level, tone, text, marks}]；最多「两条问题 + 一条提醒 + 两条好棋」。 */
  function judgeMove(bdPre, i, color, moveNo) {
    var out = [];
    var size = bdPre.size;
    var opp = color === BLACK ? WHITE : BLACK;
    var bdPost = bdPre.copy();
    var r = bdPost.play(i, color);
    if (!r.ok) return out;
    var lastLabel = E.toLabel(i, size);
    var a;

    function add(id, text, marks) {
      var rule = selfRule(id);
      if (!rule) return;
      out.push({ id: id, level: rule.level, tone: ruleTone(rule.level), text: text, marks: marks || [] });
    }
    function has(id) {
      for (var k = 0; k < out.length; k++) if (out[k].id === id) return true;
      return false;
    }

    /* 1. 自己造成打吃（正） */
    var oppAtariPre = atariCount(bdPre, opp), oppAtariPost = atariCount(bdPost, opp);
    if (oppAtariPost > oppAtariPre) {
      var mk1 = [], cs1 = chainList(bdPost, opp);
      for (a = 0; a < cs1.length; a++) if (cs1[a].libs.length === 1) mk1.push(packMark(cs1[a].libs[0], size, 'lib'));
      add('self-atari', '这一手落在 ' + lastLabel + '，对方有 ' + oppAtariPost +
        ' 块棋只剩 1 口气（棋盘上绿圈就是它最后一口气）—— 这叫打吃，对方不接就要被提。', mk1);
    }

    /* 2. 漏应对方的打吃（负） */
    var myPre = chainList(bdPre, color), myAtariPre = 0;
    for (a = 0; a < myPre.length; a++) if (myPre[a].libs.length === 1) myAtariPre++;
    if (myAtariPre) {
      var mk2 = [], cs2 = chainList(bdPost, color), still = 0;
      for (a = 0; a < cs2.length; a++) {
        if (cs2[a].libs.length === 1) { still++; if (mk2.length < 4) mk2.push(packMark(cs2[a].libs[0], size, 'good')); }
      }
      if (still > 0) add('miss-atari', '对方上一手已经打吃了你（你有一块棋只剩 1 口气），你这一手落在 ' +
        lastLabel + '，没有管它。绿点就是那块棋的最后一口气 —— 下一手对方占住这里，你这一整块就被提掉了。', mk2);
    }

    /* 3. 提子机会没提（负） */
    var capsPre = capturePoints(bdPre, color);
    if (capsPre.length && capsPre.indexOf(i) < 0 && !has('miss-atari')) {
      var mk3 = [], names = [];
      for (a = 0; a < capsPre.length && a < 4; a++) {
        mk3.push(packMark(capsPre[a], size, 'good'));
        names.push(E.toLabel(capsPre[a], size));
      }
      add('miss-capture', '盘上 ' + names.join('、') + ' 可以一手提掉对方的棋（绿点），你这一手走了 ' +
        lastLabel + '，把提子放掉了。', mk3);
    }

    /* 4. 自己走入被提（负） */
    var postSelf = bdPost.g[i] === EMPTY ? null : bdPost.group(i);
    if (postSelf && postSelf.libs.length === 1 && r.captured.length === 0) {
      var lib = postSelf.libs[0], canCap = false;
      if (bdPost.isLegal(lib, opp)) {
        var rr = bdPost.play(lib, opp);
        if (rr.ok) { canCap = rr.captured.length > 0; bdPost.undo(rr.rec); }
      }
      if (canCap) add('self-into-capture', '这一手落在 ' + lastLabel +
        ' 之后，你自己的棋只剩 1 口气（红叉是你刚下的子，绿圈是它最后一口气），对方下一手就能把它提掉。',
        [packMark(i, size, 'bad'), packMark(lib, size, 'lib')]);
    }

    /* 5. 填自己的真眼（负） */
    if (bdPre.isTrueEye(i, color)) {
      add('fill-eye', lastLabel + ' 是你自己的真眼，你却把它填上了 —— 等于自己拆掉活棋的根。', [packMark(i, size, 'bad')]);
    }

    /* 6. 一线过早（负，仅前 60 手；贴着对方子的不算） */
    if (moveNo <= 60 && lineOfPoint(i, size) === 1) {
      var nsE = bdPre.nb[i], contact = false;
      for (a = 0; a < nsE.length; a++) if (bdPre.g[nsE[a]] === opp) contact = true;
      if (!contact) add('first-line-early', '这是第 ' + moveNo + ' 手，还在布局阶段，你却下在了最边上的一条线（' +
        lastLabel + '）。一线上几乎围不到地，也帮不上中腹，等于浪费了一手。', [packMark(i, size, 'bad')]);
    }

    /* 7. 自紧气 / 愚形（负）：把相邻的几块棋连起来，整块的气却没有比原来最多那块更多 */
    var nsM = bdPre.nb[i], nbMine = [], marked = new Uint8Array(bdPre.n), groupsAdj = [];
    for (a = 0; a < nsM.length; a++) if (bdPre.g[nsM[a]] === color) nbMine.push(nsM[a]);
    for (a = 0; a < nbMine.length; a++) {
      if (marked[nbMine[a]]) continue;
      var gj = bdPre.group(nbMine[a]), tj;
      for (tj = 0; tj < gj.stones.length; tj++) marked[gj.stones[tj]] = 1;
      groupsAdj.push(gj);
    }
    var postLib = bdPost.group(i).libs.length;
    if (groupsAdj.length >= 2) {
      var bestPre = 0;
      for (a = 0; a < groupsAdj.length; a++) if (groupsAdj[a].libs.length > bestPre) bestPre = groupsAdj[a].libs.length;
      if (postLib <= bestPre) add('self-tighten', '这一手把你自己的 ' + groupsAdj.length +
        ' 块棋连成了一块，但整块棋的气一点没变多（原来最多的一块有 ' + bestPre + ' 口气，连完还是 ' +
        postLib + ' 口气）—— 这就是自紧气。棋不是连上就好，为了连而连，往往把自己越连越重。',
        [packMark(i, size, 'bad')]);
    }

    /* 8. 该接的弱棋没有接（提醒） */
    var myConn = connectPoints(bdPre, color);
    if (myConn.length && myConn.indexOf(i) < 0) {
      var mk8 = [], names8 = [];
      for (a = 0; a < myConn.length; a++) {
        var p8 = myConn[a], ns8 = bdPre.nb[p8], seen8 = {}, gs8 = [], b8;
        for (b8 = 0; b8 < ns8.length; b8++) {
          if (bdPre.g[ns8[b8]] !== color || seen8[ns8[b8]]) continue;
          var gg8 = bdPre.group(ns8[b8]), t8;
          for (t8 = 0; t8 < gg8.stones.length; t8++) seen8[gg8.stones[t8]] = 1;
          gs8.push(gg8);
        }
        if (gs8.length < 2) continue;
        var weak = 0;
        for (b8 = 0; b8 < gs8.length; b8++) if (gs8[b8].libs.length <= 2) weak++;
        if (weak) { mk8.push(packMark(p8, size, 'good')); names8.push(E.toLabel(p8, size)); }
      }
      if (names8.length) add('miss-connect', '你的 ' + names8.join('、') +
        ' 可以把自己两块棋接起来，而且其中一块已经只剩很少的气；这一手你去走了 ' + lastLabel +
        '。对方要是先占住这个点，你的棋就被分断了。', mk8);
    }

    /* 9. 切断对方（正） */
    var cutBefore = connectPoints(bdPre, opp).length;
    var cutAfter = connectPoints(bdPost, opp).length;
    if (cutAfter < cutBefore) add('cut', '这一手落在 ' + lastLabel + '，让对方的棋少了 ' +
      (cutBefore - cutAfter) + ' 个可以互相连接的点（从 ' + cutBefore + ' 个变成 ' + cutAfter +
      ' 个）—— 也就是把对方分断了，两块棋都得各自想办法活。', [packMark(i, size, 'good')]);

    /* 10. 抢到要点（正） */
    var keyDone = false;
    if (capsPre.length === 1 && capsPre[0] === i) {
      add('key-point', '这一手 ' + lastLabel +
        ' 是当前盘面上唯一能一手提子的点，你抢到了 —— 提子的同时站住这个交叉点，是先手便宜。', [packMark(i, size, 'good')]);
      keyDone = true;
    }
    if (!keyDone && myConn.length) {
      var trial = bdPre.copy(), preAtari = atariCount(trial, color), resc = [];
      for (a = 0; a < myConn.length; a++) {
        var rp = myConn[a], rr2 = trial.play(rp, color);
        if (!rr2.ok) continue;
        if (atariCount(trial, color) < preAtari) resc.push(rp);
        trial.undo(rr2.rec);
      }
      if (resc.length === 1 && resc[0] === i) {
        add('key-point', '这一手 ' + lastLabel +
          ' 是当前盘面上唯一能把自己那块被打了吃的棋接回去的点，你抢到了 —— 再慢一手，那块棋就危险了。',
          [packMark(i, size, 'good')]);
      }
    }

    /* 收敛：负面最多两条、提醒一条、正面最多两条；负面排在前面 */
    var negs = [], infos = [], poss = [];
    for (a = 0; a < out.length; a++) {
      if (out[a].tone === 'bad') negs.push(out[a]);
      else if (out[a].tone === 'info') infos.push(out[a]);
      else poss.push(out[a]);
    }
    return negs.slice(0, 2).concat(infos.slice(0, 1), poss.slice(0, 2));
  }

  /* ---------- 工具 A：对局自评 ---------- */
  var selfReview = { first: 'b', moves: [], viewAt: null, openK: null };

  function reviewBoard(upto) {
    var b = new Board(19), k;
    for (k = 0; k < upto; k++) b.play(selfReview.moves[k].i, selfReview.moves[k].color);
    return b;
  }
  function reviewMarks(findings) {
    var out = [], seen = {}, k, m;
    for (k = 0; k < findings.length; k++) {
      for (m = 0; m < findings[k].marks.length; m++) {
        var mk = findings[k].marks[m], key = mk[0] + ',' + mk[1] + ',' + mk[2];
        if (seen[key]) continue;
        seen[key] = 1; out.push(mk);
      }
    }
    return out;
  }
  function sideName(color) { return color === BLACK ? '黑' : '白'; }

  function renderReview() {
    var html = '';
    html += '<div class="card">';
    html += '<p style="margin:0 0 6px"><b>对局自评：</b>把你自己下过的一盘棋，按顺序一子一子摆到棋盘上（黑白交替）。' +
      '每摆一手，程序立刻用纯规则算一遍 —— 打吃、漏应、送死、填眼、切断这些都会写出来。摆错了随时悔棋。</p>';
    html += '<p class="small muted" style="margin:0">它只算「规则和几何」，不会评论大局观（那种判断得靠你自己）。' +
      '另外它不记进度、不上传、关掉就清空。</p>';
    html += '</div>';

    /* 左棋盘（吸附）+ 右点评 —— 与练习页共用同一套布局类（prob-layout）。
       2026-09-28 用户要求：棋盘和点评必须左右分栏，点评放右边；且不得缩小棋盘。
       围棋 19 路棋盘本身 max-width 是 640px，左栏给 660px，所以棋盘尺寸不损失。 */
    html += '<div class="prob-layout"><div class="prob-board">';
    html += '<div class="demo-wrap"><div class="board-shell">';
    html += boardHolder('sc-canvas', 19);
    html += '<div class="tool-panel">' +
      '<button id="sc-first-b" class="' + (selfReview.first === 'b' ? 'on' : '') + '">黑先</button>' +
      '<button id="sc-first-w" class="' + (selfReview.first === 'w' ? 'on' : '') + '">白先</button>' +
      '<button id="sc-undo">悔棋</button>' +
      '<button id="sc-clear">清空</button>' +
      '</div>';
    html += '<div class="info-line" id="sc-info"></div>';
    html += '</div></div>';
    html += '</div><div class="prob-notes">';
    html += '<div id="sc-summary"></div>';
    html += '<h3>逐手点评（点一条，棋盘就回到那一手）</h3>';
    html += '<div class="sc-moves" id="sc-moves"></div>';
    html += '</div></div>';
    el('sc-body').innerHTML = html;

    var info = el('sc-info'), sumBox = el('sc-summary'), listBox = el('sc-moves');

    var view = mountBoard(el('sc-canvas'), {
      size: 19,
      onPlay: function (x, y) { playOne(x, y); }
    });

    function playOne(x, y) {
      var upto = selfReview.moves.length;
      var bd = reviewBoard(upto);
      var i = bd.idx(x, y);
      if (bd.g[i] !== EMPTY) { info.textContent = '这个点已经有子了。'; return; }
      var firstColor = selfReview.first === 'b' ? BLACK : WHITE;
      var color = (upto % 2 === 0) ? firstColor : (firstColor === BLACK ? WHITE : BLACK);
      var trial = bd.copy(), t = trial.play(i, color);
      if (!t.ok) { info.textContent = '这一点不能下：' + reasonText(t.reason) + '。'; return; }
      var findings = judgeMove(bd, i, color, upto + 1);
      selfReview.moves.push({ i: i, color: color, x: x, y: y, findings: findings });
      selfReview.viewAt = null; selfReview.openK = null;
      drawReview('第 ' + (upto + 1) + ' 手 ' + sideName(color) + '（' + E.toLabel(i, 19) + '）：' +
        (findings.length ? findings[0].text : '这一手没有明显问题。'));
    }

    function drawReview(notice) {
      var n = selfReview.moves.length;
      var upto = (selfReview.viewAt == null) ? n : Math.min(selfReview.viewAt, n);
      var disp = reviewBoard(upto);
      view.setStones(GoBoardView.fromEngine(disp));
      if (upto > 0) {
        var m = selfReview.moves[upto - 1];
        view.setMarks(reviewMarks(m.findings));
        view.setLastMove([m.x, m.y]);
      } else {
        view.setMarks([]); view.setLastMove(null);
      }

      if (typeof notice === 'string') info.textContent = notice;
      else if (!n) info.textContent = '在棋盘上点一点，摆第一手（' + (selfReview.first === 'b' ? '黑棋' : '白棋') + '先）。';
      else if (selfReview.viewAt != null) info.textContent = '正在看第 ' + upto + ' 手时的局面。想继续摆，直接点棋盘就行。';
      else info.textContent = '当前第 ' + n + ' 手（' + sideName(selfReview.moves[n - 1].color) + '）。点棋盘继续摆。';

      buildSummary();
      buildList();
    }

    function buildSummary() {
      var n = selfReview.moves.length;
      if (!n) { sumBox.innerHTML = ''; return; }
      var badMoves = 0, goodMoves = 0, counts = {}, k, j;
      for (k = 0; k < n; k++) {
        var fs = selfReview.moves[k].findings, hasBad = false, hasGood = false;
        for (j = 0; j < fs.length; j++) {
          if (fs[j].tone === 'bad') { hasBad = true; counts[fs[j].id] = (counts[fs[j].id] || 0) + 1; }
          else if (fs[j].tone === 'good') hasGood = true;
        }
        if (hasBad) badMoves++;
        if (hasGood) goodMoves++;
      }
      var topId = null, topN = 0, id;
      for (id in counts) if (counts[id] > topN) { topN = counts[id]; topId = id; }
      var rule = topId ? selfRule(topId) : null;
      var txt;
      if (badMoves) {
        txt = '你摆到第 ' + n + ' 手：其中有 ' + badMoves + ' 手可以改进';
        if (rule) txt += '，出现最多的是「' + rule.name + '」，' + topN + ' 手';
        txt += '；另外有 ' + goodMoves + ' 手是好棋。';
      } else {
        txt = '你摆到第 ' + n + ' 手，暂时没有发现明显的问题（规则层面）' + (goodMoves ? '，其中 ' + goodMoves + ' 手是好棋' : '') + '。';
      }
      sumBox.innerHTML = '<div class="card sc-summary">' + esc(txt) + '</div>';
    }

    function moveBodyHTML(findings) {
      if (!findings.length) {
        return '<p class="small muted" style="margin:6px 0 0">这一手程序没有发现明显问题 —— ' +
          '不代表它一定好，只是没踩到「打吃 / 送死 / 填眼 / 切断」这些规则坑。</p>';
      }
      var out = '';
      for (var j = 0; j < findings.length; j++) {
        var f = findings[j], rule = selfRule(f.id);
        out += '<div class="sc-find sc-find-' + f.tone + '">';
        out += '<div class="sc-find-head"><span class="sc-tag ' + f.tone + '">' + f.level + '</span><b>' +
          esc(rule ? rule.name : f.id) + '</b></div>';
        out += '<p class="sc-find-text">' + md(f.text) + '</p>';
        if (rule) {
          out += '<div class="gsec"><span class="gk">为什么会这样</span><div class="gv">' + md(rule.why) + '</div></div>';
          out += '<div class="gsec"><span class="gk">下次怎么办</span><div class="gv">' + md(rule.fix) + '</div></div>';
          out += '<div class="gsec warn"><span class="gk">怎么自己发现</span><div class="gv">' + md(rule.tip) + '</div></div>';
        }
        out += '</div>';
      }
      return out;
    }

    function buildList() {
      var n = selfReview.moves.length;
      if (!n) { listBox.innerHTML = '<p class="small muted">还没有摆棋。摆第一手之后，这里会逐手列出点评。</p>'; return; }
      var html = '', k, j;
      for (k = n; k >= 1; k--) {
        var m = selfReview.moves[k - 1];
        var tags = '', shown = {};
        for (j = 0; j < m.findings.length; j++) {
          if (shown[m.findings[j].level]) continue;
          shown[m.findings[j].level] = 1;
          tags += '<span class="sc-tag ' + m.findings[j].tone + '">' + m.findings[j].level + '</span>';
        }
        if (!tags) tags = '<span class="sc-tag dull">无明显问题</span>';
        var open = (selfReview.openK === k);
        html += '<div class="sc-move' + (open ? ' open' : '') + '" data-k="' + k + '">';
        html += '<button class="sc-move-head">' +
          '<span class="sc-no">第 ' + k + ' 手</span>' +
          '<span class="sc-side ' + (m.color === BLACK ? 'b' : 'w') + '">' + sideName(m.color) + '</span>' +
          tags +
          '<span class="sc-one">' + esc(m.findings.length ? m.findings[0].text : '这一手没有明显问题。') + '</span>' +
          '<span class="sc-arrow">›</span></button>';
        html += '<div class="sc-move-body">' + (open ? moveBodyHTML(m.findings) : '') + '</div>';
        html += '</div>';
      }
      listBox.innerHTML = html;
    }

    listBox.addEventListener('click', function (e) {
      var head = e.target.closest('.sc-move-head');
      if (!head) return;
      var wrap = head.parentElement;
      var k = parseInt(wrap.getAttribute('data-k'), 10);
      if (!k) return;
      selfReview.viewAt = k;
      selfReview.openK = (selfReview.openK === k) ? null : k;
      drawReview();
    });

    el('sc-undo').onclick = function () {
      if (!selfReview.moves.length) { info.textContent = '还没有落子，没什么可悔的。'; return; }
      selfReview.moves.pop();
      selfReview.viewAt = null; selfReview.openK = null;
      drawReview('已悔掉一手，现在停在 ' + selfReview.moves.length + ' 手。');
    };
    el('sc-clear').onclick = function () {
      selfReview.moves = []; selfReview.viewAt = null; selfReview.openK = null;
      drawReview('棋盘已清空，可以重新摆一盘。');
    };
    el('sc-first-b').onclick = function () { setReviewFirst('b'); };
    el('sc-first-w').onclick = function () { setReviewFirst('w'); };

    drawReview();
  }

  function setReviewFirst(c) {
    if (selfReview.first === c && !selfReview.moves.length) return;
    selfReview.first = c;
    selfReview.moves = []; selfReview.viewAt = null; selfReview.openK = null;
    renderSelfCheck('review');
  }

  /* ---------- 工具 B：随机测验 ---------- */
  var quiz = null;

  function pickQuizSet() {
    function byCats(cats) {
      var out = [], i;
      for (i = 0; i < PROBLEMS.length; i++) if (cats.indexOf(PROBLEMS[i].cat) >= 0) out.push(PROBLEMS[i]);
      return out;
    }
    var hard = byCats(['死活', '手筋']);
    var mid = byCats(['中盘', '布局', '官子']);
    var basic = byCats(['吃子', '打吃', '双打吃', '数气', '禁入点', '眼', '胜负']);
    var picked = [], used = {}, i;
    function take(pool, n) {
      var tries = 0;
      while (n > 0 && pool.length && tries < 600) {
        tries++;
        var p = pool[Math.floor(Math.random() * pool.length)];
        if (used[p.id]) continue;
        used[p.id] = 1; picked.push(p); n--;
      }
    }
    take(hard, 5);   // 死活 / 手筋为主
    take(mid, 2);    // 中盘 / 布局 / 官子
    take(basic, 3);  // 基础类少量
    if (picked.length < 10) take(PROBLEMS.slice(), 10 - picked.length);
    for (i = picked.length - 1; i > 0; i--) {   // 打乱顺序
      var j = Math.floor(Math.random() * (i + 1)), tmp = picked[i];
      picked[i] = picked[j]; picked[j] = tmp;
    }
    return picked.slice(0, 10);
  }

  function renderQuiz() {
    if (!quiz) quiz = { list: pickQuizSet(), idx: 0, results: [] };
    var host = el('sc-body');
    if (quiz.idx >= quiz.list.length) return renderQuizScore(host);

    var P = quiz.list[quiz.idx];
    var html = '';
    html += '<div class="card" style="margin-bottom:16px">';
    html += '<p style="margin:0 0 8px"><b>随机测验：</b>电脑从题库里随机抽 10 道题考你（死活、手筋为主，也带几道基础的）。' +
      '做完给你一张本次成绩单 —— 只有这一次的结果，不累计、不排名、不存档。</p>';
    html += '<div class="row"><span class="pill">第 ' + (quiz.idx + 1) + ' / ' + quiz.list.length + ' 题</span>' +
      '<span class="pill gray">' + P.cat + ' · 难度 ' + '●'.repeat(P.level) + '</span>' +
      '<span class="spacer"></span><button class="btn ghost sm" id="qz-new">换一组题</button></div>';
    html += '</div>';
    html += '<div id="q-host"></div>';
    host.innerHTML = html;

    el('qz-new').onclick = function () { quiz = null; renderSelfCheck('quiz'); };

    mountProblemAnswer(el('q-host'), P, {
      track: false,
      compact: true,
      onAnswered: function (ok, picked, revealed) {
        quiz.results.push({
          P: P,
          ok: !!ok && !revealed,
          picked: revealed ? '（看了解析）' : (picked || '—')
        });
      },
      footer: function () {
        return '<div class="row" style="margin-top:16px"><button class="btn" id="qz-next">' +
          (quiz.idx < quiz.list.length - 1 ? '下一题 →' : '看成绩单 →') + '</button></div>';
      },
      bindFooter: function () {
        var btn = el('qz-next');
        if (btn) btn.onclick = function () { quiz.idx++; renderSelfCheck('quiz'); };
      }
    });
  }

  function renderQuizScore(host) {
    var rs = quiz.results, okN = 0, i;
    for (i = 0; i < rs.length; i++) if (rs[i].ok) okN++;

    var html = '';
    html += '<div class="card sc-summary">';
    html += '<div class="sc-score-n">这一组答对 ' + okN + ' / ' + rs.length + ' 题</div>';
    html += '<p class="small muted" style="margin:6px 0 0">这只是这一组题的一次结果，不累计、不存档。' +
      '<b>错的那几道，把原因读一遍，比多对两道有用。</b></p>';
    html += '</div>';
    html += '<div class="row" style="margin:16px 0"><button class="btn" id="qz-again">再来一组</button>' +
      '<button class="btn ghost" onclick="location.hash=\'#/problems\'">去练习页慢慢做</button></div>';
    html += '<div class="sc-score-list">';
    for (i = 0; i < rs.length; i++) {
      var r = rs[i], P = r.P;
      var ans = P.kind === 'choice' ? P.answers[0]
        : P.answers.map(function (a) { return E.toLabel(a[1] * P.size + a[0], P.size); }).join(' / ');
      var reason = P.principle || (P.solution && P.solution[0]) || '';
      html += '<div class="sc-score-item ' + (r.ok ? 'ok' : 'no') + '">';
      html += '<div class="row" style="margin-bottom:4px"><span class="sc-tag ' + (r.ok ? 'good' : 'bad') + '">' +
        (r.ok ? '答对' : '答错') + '</span><b>第 ' + (i + 1) + ' 题 · ' + P.cat + '</b></div>';
      html += '<div class="small muted sc-score-ask">' + esc(P.ask) + '</div>';
      html += '<div class="small" style="margin-top:4px">你的答案：' + esc(r.picked) +
        '　正确答案：<b>' + esc(ans) + '</b></div>';
      if (reason) html += '<div class="small muted" style="margin-top:4px">原因：' + esc(reason) + '</div>';
      html += '<div style="margin-top:6px"><button class="btn ghost sm" data-goto="' + P.id + '">看这道题的完整推理</button></div>';
      html += '</div>';
    }
    html += '</div>';
    host.innerHTML = html;

    el('qz-again').onclick = function () { quiz = null; renderSelfCheck('quiz'); };
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-goto]');
      if (b) location.hash = '#/problem/' + b.getAttribute('data-goto');
    });
  }

  /* ---------- 工具 C：常见失误自查表 ---------- */
  var checklist = {};   /* 只存在这次打开的内存里，刷新即清空 */

  function renderChecklist() {
    var items = [], i;
    for (i = 0; i < SELF_RULES.length; i++) if (SELF_RULES[i].level === '常见错误') items.push(SELF_RULES[i]);
    items.sort(function (a, b) { return (a.p || 99) - (b.p || 99); });

    var html = '';
    html += '<div class="card" style="margin-bottom:18px">';
    html += '<p style="margin:0 0 6px"><b>常见失误自查表：</b>一张下棋前、下完之后都能过一遍的清单。' +
      '哪几条像自己，就勾上；点标题可以展开看「为什么会这样 / 下次怎么办 / 怎么自己发现」。</p>';
    html += '<p class="small muted" style="margin:0">勾选只保存在这次打开里，<b>刷新就清空、不上传、不累计</b>。' +
      '勾完之后下面会告诉你哪几条最值得先改。</p>';
    html += '</div>';
    html += '<div id="sc-check-sum"></div>';
    html += '<div class="sc-checks" id="sc-checks">';
    for (i = 0; i < items.length; i++) {
      var it = items[i], on = !!checklist[it.id];
      html += '<div class="sc-check' + (on ? ' on' : '') + '" data-id="' + it.id + '">';
      html += '<div class="sc-check-head">';
      html += '<button class="sc-tick' + (on ? ' on' : '') + '" data-tick="' + it.id + '" title="勾选">' + (on ? '✓' : '') + '</button>';
      html += '<span class="sc-check-name">' + esc(it.name) + '</span>';
      html += '<span class="sc-tag bad">常见错误</span>';
      html += '<span class="sc-arrow">›</span>';
      html += '</div>';
      html += '<div class="sc-check-body">';
      html += '<div class="gsec"><span class="gk">为什么会这样</span><div class="gv">' + md(it.why) + '</div></div>';
      html += '<div class="gsec"><span class="gk">下次怎么办</span><div class="gv">' + md(it.fix) + '</div></div>';
      html += '<div class="gsec warn"><span class="gk">怎么自己发现</span><div class="gv">' + md(it.tip) + '</div></div>';
      html += '</div></div>';
    }
    html += '</div>';
    el('sc-body').innerHTML = html;

    var listBox = el('sc-checks'), sumBox = el('sc-check-sum');

    function summaryText() {
      var picked = [], i2;
      for (i2 = 0; i2 < items.length; i2++) if (checklist[items[i2].id]) picked.push(items[i2]);
      if (!picked.length) return '还没有勾。看到哪一条像自己，就勾上 —— 勾完这里会排个序。';
      picked.sort(function (a, b) { return (a.p || 99) - (b.p || 99); });
      var top = [], i3;
      for (i3 = 0; i3 < picked.length && i3 < 3; i3++) top.push('「' + picked[i3].name + '」');
      return '你勾出了 ' + picked.length + ' 条。这几条最值得先改：' + top.join('、') + '。';
    }
    function refreshSummary() {
      sumBox.innerHTML = '<div class="card sc-summary">' + esc(summaryText()) + '</div>';
    }
    refreshSummary();

    listBox.addEventListener('click', function (e) {
      var tick = e.target.closest('.sc-tick');
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
      var head = e.target.closest('.sc-check-head');
      if (head) head.parentElement.classList.toggle('open');
    });
  }

  /* ---------- 页面外壳 ---------- */
  function renderSelfCheck(seg) {
    var tab = seg || 'review';
    var html = '<h1>实战自测</h1>';
    html += '<p class="sub">三个工具，都不记进度、不排名、不上传 —— 摆完、做完、看完，关掉就清空，随时可以重来。' +
      '不必按什么顺序用，喜欢哪个先点哪个。</p>';
    html += '<div class="filter-bar">';
    html += '<button class="' + (tab === 'review' ? 'on' : '') + '" onclick="location.hash=\'#/selfcheck/review\'">对局自评</button>';
    html += '<button class="' + (tab === 'quiz' ? 'on' : '') + '" onclick="location.hash=\'#/selfcheck/quiz\'">随机测验</button>';
    html += '<button class="' + (tab === 'checklist' ? 'on' : '') + '" onclick="location.hash=\'#/selfcheck/checklist\'">常见失误自查表</button>';
    html += '</div>';
    html += '<div id="sc-body"></div>';
    app.innerHTML = html;

    if (tab === 'quiz') return renderQuiz();
    if (tab === 'checklist') return renderChecklist();
    return renderReview();
  }

  /* ================= 启动 ================= */
  route();

})();
