/* 将棋板块应用层 —— 路由分发、首页、摆棋页
 *
 * 分工与象棋板块一致：
 *   shogi-engine.js  规则（走法、升变、持驹、禁手、王手／诘）
 *   shogi-board.js   画法（九乘九格盘、五角形驹、上下持驹台）
 *   shogi-app.js     把两者接起来 + 组织页面 ← 本文件
 *
 * 页面清单（与 index.html 的导航一一对应）：
 *   ''       首页
 *   lesson   入门课      （P1，施工中）
 *   rules    规则        （P1，施工中）
 *   tsume    诘将棋      （P2，施工中）
 *   tesuji   手筋        （P2，施工中）
 *   joseki   定迹        （P3，施工中）
 *   games    名局        （P3，施工中）
 *   terms    词典        （P3，施工中）
 *   board    摆棋        ← 本轮已完成，可以真的下一盘
 */
(function (global) {
  'use strict';

  var S = global.SHOGI, SB = global.ShogiBoard;

  var TABS = {
    '': ['将棋', '整个板块'],
    lesson: ['入门课', '棋盘九乘九，从摆驹到第一盘。重点讲清「持驹」——那是将棋与象棋差得最远的一条。'],
    rules: ['规则', '八种驹的走法与升变、吃掉对方的驹可以再打回盘上、以及二步／打步诘这类禁手。'],
    tsume: ['诘将棋', '将棋最有名的一类题：连续将军一路追到把王诘死，手顺唯一。'],
    tesuji: ['手筋', '局部的好手巧手，常见的是弃掉一枚驹，换全局的主动。'],
    joseki: ['定迹', '将棋界的「定式」：双方都认可的开局套路，讲的是这样交换为什么对等。'],
    games: ['名局', '经典对局一手一手讲。'],
    terms: ['词典', '王手、寄せ、必至、持驹、升变、打步诘……将棋术语按人话解释。'],
    selfcheck: ['自测', '对局自评、常见失误自查表、随机测验 —— 与围棋象棋的自测同一套三件套。'],
    board: ['摆棋', '一个能真的走子的将棋棋盘（含持驹台）。']
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /* 词典正文里的 **重点** 要变成粗体 —— 先转义再替换，顺序不能反（否则 <b> 也会被转义） */
  function md(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  function el(id) { return document.getElementById(id); }
  function go(hash) { location.hash = hash; }

  function render(seg, host) {
    var sub = seg[1] || '';
    if (sub === '') return renderHome(host);
    if (sub === 'board') return renderPlay(host);
    if (sub === 'lesson') return renderLesson(seg, host);
    if (sub === 'rules') return renderRules(host);
    if (sub === 'terms') return renderTerms(seg, host);
    if (sub === 'tsume') return renderTsume(seg, host);
    if (sub === 'tesuji') return renderTesuji(seg, host);
    if (sub === 'joseki') return renderJoseki(seg, host);
    if (sub === 'games') return renderGames(seg, host);
    if (sub === 'selfcheck') return renderSelfCheck(seg, host);
    return renderSoon(sub, host);
  }

  /* ========================== 实战自测 ==========================
     三个 tab 与围棋、象棋的自测对齐：
       对局自评        —— 下一盘，边走边点评（复用摆棋的交互）
       常见失误自查表  —— 将棋真会输棋的那些毛病
       随机测验        —— 从诘将棋题库随机抽题，独立走完才算解出 */
  var SC_TABS = { review: '对局自评', checklist: '常见失误自查表', quiz: '随机测验' };

  function renderSelfCheck(seg, host) {
    var tab = seg[2];
    if (!SC_TABS[tab]) tab = 'review';
    var html = '<h1>实战自测</h1>' +
      '<p class="sub">三样东西：下一盘看点评、照着一张表查毛病、抽题测验。</p>' +
      '<div class="row" id="sc-tabs" style="margin-bottom:16px">';
    Object.keys(SC_TABS).forEach(function (k) {
      html += '<button class="btn' + (tab === k ? '' : ' ghost') + ' sm" data-tab="' + k + '">' +
        SC_TABS[k] + '</button>';
    });
    html += '</div><div id="sc-body"></div>';
    host.innerHTML = html;
    el('sc-tabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (!b) return;
      location.hash = '#/shogi/selfcheck/' + b.getAttribute('data-tab');
    });
    var body = el('sc-body');
    if (tab === 'checklist') return renderChecklist(body);
    if (tab === 'quiz') return renderQuiz(body);
    return renderPlay(body, {
      title: null,
      sub: '下一盘试试。每走一手，右边就给出点评 —— 只评规则层算得清的：' +
        '这枚驹有没有人保、是不是被盯着、有没有把王的门打开。',
      review: true
    });
  }

  function renderChecklist(host) {
    var data = (window.ShogiSelfCheck && window.ShogiSelfCheck.CHECKS) || [];
    var html = '<p class="sub">将棋里真会输棋的那些毛病，' + data.length +
      ' 条。每条都写清「怎么发现自己犯了」和「下次怎么做」。</p>';
    var KINDS = ['送驹', '驹形', '手番', '王的安全', '持驹', '禁手'];
    KINDS.forEach(function (k) {
      var items = data.filter(function (c) { return c.kind === k; });
      if (!items.length) return;
      html += '<h2 style="margin-top:24px">' + k + ' <span class="small muted">' +
        items.length + ' 条</span></h2>';
      items.forEach(function (c) {
        html += '<div class="card" style="margin-bottom:12px">' +
          '<h3 style="margin:0 0 8px">' + esc(c.title) + '</h3>' +
          '<div class="explain-block"><span class="lbl">怎么发现自己犯了</span><p>' + md(c.symptom) + '</p></div>' +
          '<div class="explain-block"><span class="lbl">为什么会这样</span><p>' + md(c.why) + '</p></div>' +
          '<div class="explain-block"><span class="lbl">下次怎么做</span><p>' + md(c.fix) + '</p></div>' +
          '<p class="small muted" style="margin:0">自查时问自己：' + md(c.tip) + '</p></div>';
      });
    });
    host.innerHTML = html;
  }

  /* ---------- 随机测验：从诘将棋题库抽五道，独立走完才计分 ---------- */
  function renderQuiz(host) {
    var all = tsumeList();
    if (!all.length) {
      host.innerHTML = '<p class="sub">题库还是空的，先去做诘将棋那边。</p>';
      return;
    }
    var pool = all.slice(), i, j, t;
    for (i = pool.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    quizStep(host, pool.slice(0, Math.min(5, pool.length)), 0, [], 0);
  }

  function quizStep(host, picked, idx, log, score) {
    if (idx >= picked.length) {
      var html = '<div class="card"><h3 style="margin-top:0">这一轮做完了</h3>' +
        '<p>共 ' + picked.length + ' 道，其中 <b>' + score + ' 道是你自己一步步走出来的</b>，' +
        '其余是看了答案。</p><ul class="sol-list" style="list-style:none;padding-left:0">';
      log.forEach(function (x, k) {
        html += '<li class="sol-row"><span class="sol-n">' + (k + 1) + '</span>' +
          '<span class="sol-t">' + esc(x.id) + ' · ' + x.hands + ' 手诘 · ' +
          (x.self ? '自己走出来的' : '看了答案') + '</span></li>';
      });
      html += '</ul><div class="row" style="margin-top:14px">' +
        '<button class="btn" onclick="location.reload()">再来一轮</button>' +
        '<button class="btn ghost" onclick="location.hash=\'#/shogi/tsume\'">去诘将棋列表</button></div></div>';
      host.innerHTML = html;
      return;
    }
    var q = picked[idx];
    var header = '<div class="row" style="margin-bottom:10px;align-items:center">' +
      '<span class="pill wood">第 ' + (idx + 1) + ' / ' + picked.length + ' 题</span>' +
      '<span class="small muted">自己走到底才算解出；点「看答案」看完整手顺，但这一题不计分。</span>' +
      '</div>';
    var answered = false;                 /* 「重来」会再走一遍，别重复计分 */
    renderTsumeOne(q, [q], host, {
      headless: true,
      header: header,
      onDone: function (used) {
        if (answered) return;
        answered = true;
        log.push({ id: q.id, hands: q.hands, self: !used });
        var add = used ? 0 : 1;
        var btn = el('sh-quiz-next');
        if (btn) {
          btn.disabled = false;
          btn.textContent = (idx + 1 < picked.length)
            ? ('下一题（' + (idx + 1) + '/' + picked.length + ' 已完成）') : '看结果';
          btn.onclick = function () { quizStep(host, picked, idx + 1, log, score + add); };
        }
      },
      footer: '<button class="btn" id="sh-quiz-next" disabled>下一题</button>' +
        '<button class="btn ghost sm" id="sh-quiz-exit" ' +
        'onclick="location.hash=\'#/shogi/selfcheck/checklist\'">先不做了</button>'
    });
  }

  /* ==================== 名局 ====================
     棋谱来自 GSDB（GPL v2），由 tools/make-shogi-games.js 抓取并生成逐手说明；
     tools/verify_shogi_games.js 会重新逐手走一遍复核。
     每手的说明**只写引擎算得出来的事实**（吃子／升变／王手／诘），不写评价与胜率。 */
  function renderGames(seg, host) {
    var list = (global.SHOGI_GAMES || []);
    if (seg[2]) {
      var one = null, k2;
      for (k2 = 0; k2 < list.length; k2++) if (list[k2].id === seg[2]) one = list[k2];
      if (one) return renderGameOne(one, list, host);
    }
    if (!list.length) {
      host.innerHTML = '<h1>名局</h1><p class="sub">题库还没生成（跑 tools/make-shogi-games.js）。</p>';
      return;
    }
    var html = '<h1>名局</h1>' +
      '<p class="sub">职业对局的完整手顺，一手一手回放。棋谱取自 <b>GSDB</b>' +
      '（GNU Shogi Database，GPL v2），每一局都经规则引擎<b>逐手复算过</b>才收进来。</p>' +
      '<div class="card"><p class="small muted" style="margin:0">' +
      '⚠️ 每手的说明是<b>引擎算出来的事实</b> —— 走到哪、吃了什么、有没有升变、是不是王手。' +
      '<b>这里没有胜率，也没有「这一手很妙」之类的评价</b>：那种判断要靠棋力，本站算不出来，' +
      '宁可不写也不编。想看门道就顺着关键手慢慢走。</p></div>';
    list.forEach(function (g) {
      html += '<div class="card" style="margin-top:14px">' +
        '<h3 style="margin:0 0 4px">' + esc(g.sente) + ' 先 × ' + esc(g.gote) + ' 后</h3>' +
        '<p class="small muted" style="margin:0 0 10px">' + esc(g.event) +
        (g.date ? '（' + esc(g.date) + '）' : '') + ' · ' + esc(g.result) +
        ' · 共 ' + g.hands + ' 手' + (g.endedByMate ? ' · 终局 ' + esc(g.endedByMate) : '') +
        '</p>' +
        '<button class="btn sm" onclick="location.hash=\'#/shogi/games/' + g.id + '\'">逐手回放</button>' +
        '</div>';
    });
    host.innerHTML = html;
  }

  function renderGameOne(g, list, host) {
    var board = new S.Board();
    board.reset();
    var ply = 0, view = null, idx = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].id === g.id) idx = i;
    var lastKey = -1;
    for (i = 0; i < g.moves.length; i++) if (g.moves[i].k) lastKey = i;

    host.innerHTML =
      '<div class="crumb small muted" style="margin-bottom:10px">' +
      '<a href="#/shogi/games">← 返回名局列表</a></div>' +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div id="shogi-holder" style="width:100%">' +
      '<canvas id="shogi-canvas" style="display:block;width:100%"></canvas></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="gm-first">从头开始</button>' +
      '<button class="btn ghost sm" id="gm-prev">上一步</button>' +
      '<button class="btn sm" id="gm-next">下一步</button>' +
      '<button class="btn ghost sm" id="gm-key">跳到关键手</button>' +
      '<span class="pill wood" id="gm-progress"></span>' +
      '</div></div>' +
      '<div class="prob-notes">' +
      '<div class="card"><h3 style="margin:0 0 6px">' + esc(g.sente) + ' 先 × ' +
      esc(g.gote) + ' 后</h3>' +
      '<p class="small muted" style="margin:0">' + esc(g.event) +
      (g.date ? '（' + esc(g.date) + '）' : '') + ' · ' + esc(g.result) +
      ' · 共 ' + g.hands + ' 手</p>' +
      '<p class="small muted" style="margin:6px 0 0">出处：' + esc(g.source) + '</p></div>' +
      '<div id="gm-note"></div>' +
      '<div class="card" style="margin-top:12px"><h3 style="margin-top:0">手顺' +
      '<span class="small muted">（点一条就跳到那里；标红的是关键手）</span></h3>' +
      '<div id="gm-list" style="max-height:300px;overflow:auto"></div></div>' +
      '<div class="row" style="margin-top:16px">' +
      (idx > 0 ? '<button class="btn ghost sm" onclick="location.hash=\'#/shogi/games/' +
        list[idx - 1].id + '\'">上一局</button>' : '') +
      (idx < list.length - 1 ? '<button class="btn sm" onclick="location.hash=\'#/shogi/games/' +
        list[idx + 1].id + '\'">下一局</button>' : '') +
      '</div></div></div>';

    view = SB.mount(el('shogi-canvas'), { interactive: false });

    function sync() {
      var l = [], k;
      for (k = 0; k < S.N; k++) {
        if (!board.g[k]) continue;
        var p = board.xy(k);
        l.push([p.x, p.y, board.g[k] === S.SENTE ? 's' : 'g', board.t[k], board.p[k]]);
      }
      view.setList(l);
      view.setHand(board.hand);
      var rec = board.moves.length ? board.moves[board.moves.length - 1] : null;
      if (rec) view.setLastMove(rec.from === undefined ? -1 : rec.from, rec.to);
      else view.setLastMove(-1, -1);

      /* CSS 里的 list-style:none 只对 .explain-block 里的 .sol-list 生效，
         这里的列表在普通卡片里，得自己带上 —— 不带的话 ol 会自己吐出「1. 2. …」
         和条目里本来就有的序号重成「1. 1▲７六歩」 */
      var fix = ' style="list-style:none;padding-left:0"';
      var pr = el('gm-progress');
      if (pr) pr.textContent = '第 ' + ply + ' / ' + g.moves.length + ' 手';
      if (el('gm-prev')) el('gm-prev').disabled = (ply <= 0);
      if (el('gm-next')) el('gm-next').disabled = (ply >= g.moves.length);
      if (el('gm-first')) el('gm-first').disabled = (ply <= 0);
      if (el('gm-key')) el('gm-key').disabled = (ply > lastKey);

      var nb = el('gm-note');
      if (nb) {
        if (!ply) {
          nb.innerHTML = '<p class="small muted">点「下一步」开始回放。' +
            '绿圈是这一手的落点、虚圈是起点；标红的记号是关键手。</p>';
        } else {
          var m = g.moves[ply - 1];
          nb.innerHTML = '<div class="card"><h3 style="margin:0 0 6px">第 ' + ply + ' 手　' +
            esc(m.n) + '</h3><p style="margin:0">' + md(m.d) + '</p></div>';
        }
      }
      var box = el('gm-list');
      if (box) {
        var h = '<ol class="sol-list"' + fix + '>';
        g.moves.forEach(function (m, k3) {
          var cur = (k3 + 1 === ply);
          h += '<li class="sol-row" data-ply="' + (k3 + 1) + '" style="cursor:pointer' +
            (cur ? ';background:#f6efe3' : '') + '">' +
            '<span class="sol-n">' + (k3 + 1) + '</span>' +
            '<span class="sol-t" style="' + (m.k ? 'color:#a8231b;' : '') +
            (k3 + 1 <= ply ? '' : 'opacity:.45;') + '">' + esc(m.n) + '</span></li>';
        });
        box.innerHTML = h + '</ol>';
        var lis = box.querySelectorAll('li'), z;
        for (z = 0; z < lis.length; z++) {
          lis[z].onclick = function () { gotoPly(parseInt(this.getAttribute('data-ply'), 10)); };
        }
      }
    }

    function step(d) {
      if (d > 0) {
        if (ply >= g.moves.length) return;
        var m = g.moves[ply], side = (ply % 2 === 0) ? S.SENTE : S.GOTE;
        var to = board.idx(m.t[0], m.t[1]);
        var r = m.drop ? board.drop(m.drop, to, side)
          : board.play(board.idx(m.f[0], m.f[1]), to, side, !!m.p);
        if (!r.ok) return;
        ply++;
      } else {
        if (ply <= 0) return;
        var rec = board.moves.pop();
        if (rec) board.undo(rec);
        ply--;
      }
    }
    function gotoPly(target) {
      target = Math.max(0, Math.min(g.moves.length, target));
      while (ply < target) step(1);
      while (ply > target) step(-1);
      sync();
    }

    el('gm-first').onclick = function () { gotoPly(0); };
    el('gm-prev').onclick = function () { gotoPly(ply - 1); };
    el('gm-next').onclick = function () { gotoPly(ply + 1); };
    el('gm-key').onclick = function () {
      var z;
      for (z = ply; z < g.moves.length; z++) if (g.moves[z].k) { gotoPly(z + 1); return; }
      gotoPly(g.moves.length);
    };

    sync();
  }

  /* ==================== 定迹（开局次序） ====================
     数据在 src/shogi-joseki.js，每条手顺都由 tools/verify_shogi_joseki.js
     从标准初形逐手验算过。这里只是「放录像」：棋盘不可点，用按钮步进。 */
  function renderJoseki(seg, host) {
    var list = (global.SHOGI_JOSEKI || []);
    if (seg[2]) {
      var one = null, k;
      for (k = 0; k < list.length; k++) if (list[k].id === seg[2]) one = list[k];
      if (one) return renderJosekiOne(one, list, host);
    }
    if (!list.length) {
      host.innerHTML = '<h1>定迹</h1><p class="sub">数据还没写（src/shogi-joseki.js）。</p>';
      return;
    }
    var html = '<h1>定迹 · 开局次序</h1>' +
      '<p class="sub">将棋的「定迹」严格说是一<b>棵树</b> —— 对手每一手不同，后面的最优次序就跟着变。' +
      '这里给的是<b>几条基本展开</b>：先手怎么把驹一台台调出来、后手怎么应、每一步的道理。' +
      '每条都从标准初形出发，由规则引擎<b>逐手验算过合法性</b>。</p>' +
      '<div class="card"><p class="small muted" style="margin:0">' +
      '⚠️ 要点先说在前面：这是「一条」示例次序，<b>不是「唯一正确答案」</b>。' +
      '实战里对手不按这里的应手走，你就该跟着变 —— <b>学的是次序感，不是背手顺</b>。</p></div>';
    var groups = {};
    list.forEach(function (j) { (groups[j.cat] = groups[j.cat] || []).push(j); });
    Object.keys(groups).forEach(function (cat) {
      html += '<h2 style="margin-top:24px">' + esc(cat) + '</h2>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap">';
      groups[cat].forEach(function (j) {
        html += '<button class="btn ghost" onclick="location.hash=\'#/shogi/joseki/' + j.id + '\'">' +
          esc(j.name) + '</button>';
      });
      html += '</div>';
    });
    host.innerHTML = html;
  }

  function renderJosekiOne(j, list, host) {
    var board = new S.Board();
    board.reset();
    var ply = 0, view = null, idx = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].id === j.id) idx = i;

    host.innerHTML =
      '<div class="crumb small muted" style="margin-bottom:10px">' +
      '<a href="#/shogi/joseki">← 返回定迹列表</a></div>' +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div id="shogi-holder" style="width:100%">' +
      '<canvas id="shogi-canvas" style="display:block;width:100%"></canvas></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="js-first">从头开始</button>' +
      '<button class="btn ghost sm" id="js-prev">上一步</button>' +
      '<button class="btn sm" id="js-next">下一步</button>' +
      '<span class="pill wood" id="js-progress"></span>' +
      '</div></div>' +
      '<div class="prob-notes">' +
      '<div class="card"><h3 style="margin:0 0 6px">' + esc(j.name) + '</h3>' +
      '<p class="small muted" style="margin:0">' + esc(j.idea) + '</p></div>' +
      '<div id="js-note"></div>' +
      '<div class="card" style="margin-top:12px"><h3 style="margin-top:0">要点</h3>' +
      '<ul class="sol-list" style="list-style:none;padding-left:0">' +
      (j.points || []).map(function (p) {
        return '<li class="sol-row"><span class="sol-t">' + md(p) + '</span></li>';
      }).join('') + '</ul></div>' +
      '<div class="row" style="margin-top:16px">' +
      (idx > 0 ? '<button class="btn ghost sm" onclick="location.hash=\'#/shogi/joseki/' +
        list[idx - 1].id + '\'">上一条</button>' : '') +
      (idx < list.length - 1 ? '<button class="btn sm" onclick="location.hash=\'#/shogi/joseki/' +
        list[idx + 1].id + '\'">下一条</button>' : '') +
      '</div></div></div>';

    view = SB.mount(el('shogi-canvas'), { interactive: false });

    function sync() {
      var l = [], k;
      for (k = 0; k < S.N; k++) {
        if (!board.g[k]) continue;
        var p = board.xy(k);
        l.push([p.x, p.y, board.g[k] === S.SENTE ? 's' : 'g', board.t[k], board.p[k]]);
      }
      view.setList(l);
      view.setHand(board.hand);
      var rec = board.moves.length ? board.moves[board.moves.length - 1] : null;
      if (rec) view.setLastMove(rec.from === undefined ? -1 : rec.from, rec.to);
      else view.setLastMove(-1, -1);
      var pr = el('js-progress');
      if (pr) pr.textContent = '第 ' + ply + ' / ' + j.moves.length + ' 手';
      var nb = el('js-note');
      if (nb) {
        nb.innerHTML = ply
          ? ('<div class="card"><h3 style="margin:0 0 6px">' + (ply % 2 === 1 ? '▲ ' : '△ ') +
            '第 ' + ply + ' 手</h3><p style="margin:0">' + md(j.notes[ply - 1]) + '</p></div>')
          : '<p class="small muted">点「下一步」，一手一手看。棋盘上绿圈是这一手的落点、虚圈是起点。</p>';
      }
      if (el('js-prev')) el('js-prev').disabled = (ply <= 0);
      if (el('js-next')) el('js-next').disabled = (ply >= j.moves.length);
      if (el('js-first')) el('js-first').disabled = (ply <= 0);
    }

    function step(d) {
      if (d > 0) {
        if (ply >= j.moves.length) return;
        var m = j.moves[ply], side = (ply % 2 === 0) ? S.SENTE : S.GOTE;
        var r = board.play(board.idx(m.f[0], m.f[1]), board.idx(m.t[0], m.t[1]), side, !!m.p);
        if (!r.ok) return;
        ply++;
      } else {
        if (ply <= 0) return;
        var rec = board.moves.pop();
        if (rec) board.undo(rec);
        ply--;
      }
      sync();
    }

    el('js-first').onclick = function () { while (ply > 0) step(-1); };
    el('js-prev').onclick = function () { step(-1); };
    el('js-next').onclick = function () { step(1); };

    sync();
  }

  /* ==================== 手筋（次の一手） ====================
     题库由 tools/next-gen.js 生成、tools/verify_shogi_next.js 复核。
     每道题带机器证明：正解唯一；走对之后，对方**每一种**应法都挡不住先手吃到子。
     这里只负责呈现：判定「走对没有」就是拿用户那一手跟 q.answer 比。 */
  function renderTesuji(seg, host) {
    var list = (global.SHOGI_NEXT || []);
    if (seg[2]) {
      var q = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === seg[2]) q = list[i];
      if (q) return renderTesujiOne(q, list, host);
    }
    if (!list.length) {
      host.innerHTML = '<h1>手筋</h1><p class="sub">题库还没生成（跑 tools/next-gen.js）。</p>';
      return;
    }
    var html = '<h1>手筋 · 次の一手</h1>' +
      '<p class="sub">给一个局面，问<b>下一手该走哪里</b>。这不是背定式，是要你看出这一手的用意。' +
      '本库共 ' + list.length + ' 道，全部由引擎算过：<b>正解唯一</b>，而且走对之后' +
      '<b>对方无论怎么应，你都能吃到子</b>。</p>' +
      '<div class="card"><p class="small muted" style="margin:0">怎么答：点自己的驹 → 蓝点是它能去的地方 → ' +
      '点目标落子；点下面的持驹台可以把吃到的驹打回盘上。<b>走错会当场告诉你</b>，想不出来可以点「看答案」。</p></div>' +
      '<h2 style="margin-top:24px">全部 ' + list.length + ' 题</h2>' +
      '<div class="row" style="gap:10px;flex-wrap:wrap">';
    list.forEach(function (q, k) {
      html += '<button class="btn ghost" onclick="location.hash=\'#/shogi/tesuji/' + q.id + '\'">' +
        '第 ' + (k + 1) + ' 题</button>';
    });
    html += '</div>';
    host.innerHTML = html;
  }

  function renderTesujiOne(q, list, host) {
    var board = new S.Board();
    board.setup(q.stones, q.hand, 's');
    var sel = -1, selHand = null, hintTo = [];
    var view = null, done = false, usedAnswer = false;
    var idx = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].id === q.id) idx = i;
    /* 正解统一成「用户走法」的字段名（f/t/p），才好在 tryPlay 里直接比 */
    var ANS = q.answer.drop
      ? { drop: q.answer.drop, to: q.answer.to }
      : { f: q.answer.from, t: q.answer.to, p: q.answer.promote ? 1 : 0 };

    host.innerHTML =
      '<div class="crumb small muted" style="margin-bottom:10px">' +
      '<a href="#/shogi/tesuji">← 返回手筋列表</a></div>' +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div id="shogi-holder" style="width:100%">' +
      '<canvas id="shogi-canvas" style="display:block;width:100%"></canvas></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="tj-undo">重来</button>' +
      '<span class="pill wood" id="tj-progress">先手走，找出最好的一手</span>' +
      '</div></div>' +
      '<div class="prob-notes">' +
      '<div class="card"><h3 style="margin:0 0 6px">第 ' + (idx + 1) + ' 题</h3>' +
      '<p class="small muted" style="margin:0">先手走。找出<b>最好的一手</b> —— ' +
      '走对它，对方怎么应都要掉东西。</p></div>' +
      '<div id="tj-status"></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="tj-show">看答案</button>' +
      '</div>' +
      '<div id="tj-explain"></div>' +
      '<div class="row" style="margin-top:16px">' +
      (idx > 0 ? '<button class="btn ghost sm" onclick="location.hash=\'#/shogi/tesuji/' +
        list[idx - 1].id + '\'">上一题</button>' : '') +
      (idx < list.length - 1 ? '<button class="btn sm" onclick="location.hash=\'#/shogi/tesuji/' +
        list[idx + 1].id + '\'">下一题</button>' : '') +
      '</div></div></div>';

    view = SB.mount(el('shogi-canvas'), { onTap: onTap, onTapHand: onTapHand });

    function sync() {
      var l = [], k;
      for (k = 0; k < S.N; k++) {
        if (!board.g[k]) continue;
        var p = board.xy(k);
        l.push([p.x, p.y, board.g[k] === S.SENTE ? 's' : 'g', board.t[k], board.p[k]]);
      }
      view.setList(l);
      view.setHand(board.hand);
      view.setSelection(sel);
      view.setHints(hintTo);
      var last = board.moves.length ? board.moves[board.moves.length - 1] : null;
      if (last) view.setLastMove(last.from === undefined ? -1 : last.from, last.to);
      else view.setLastMove(-1, -1);
    }
    function status(html) { el('tj-status').innerHTML = html; }
    function no(head, body) {
      return '<div class="feedback no"><div class="head">' + head + '</div><p>' + body + '</p></div>';
    }
    function clearPick() { sel = -1; selHand = null; hintTo = []; }

    function computeHints() {
      var out = [], k, ms, r;
      if (sel >= 0) {
        ms = board.movesFrom(sel);
        for (k = 0; k < ms.length; k++) out.push({ to: ms[k], cap: board.g[ms[k]] !== S.EMPTY });
      } else if (selHand) {
        for (k = 0; k < S.N; k++) {
          if (board.g[k] !== S.EMPTY) continue;
          r = board.drop(selHand.type, k, board.toMove);
          if (r.ok) { board.undo(r.rec); out.push({ to: k, cap: false }); }
        }
      }
      return out;
    }

    function onTap(k) {
      if (done) return;
      var i2;
      if (sel >= 0 || selHand) {
        for (i2 = 0; i2 < hintTo.length; i2++) {
          if (hintTo[i2].to !== k) continue;
          if (selHand) { tryPlay({ drop: selHand.type, to: k }); return; }
          if (board.promoVariants(sel, k, board.toMove).length > 1) { askPromote(sel, k); return; }
          tryPlay({ f: sel, t: k, p: 0 });
          return;
        }
      }
      if (board.g[k] === board.toMove) {
        sel = k; selHand = null; hintTo = computeHints();
      } else clearPick();
      sync();
    }

    function onTapHand(color, type) {
      if (done) return;
      if (color !== board.toMove) {
        status(no('这一手不行', '那是' + S.colorName(color) + '的持驹，现在轮不到它用。'));
        return;
      }
      if (selHand && selHand.type === type) { clearPick(); sync(); return; }
      selHand = { color: color, type: type };
      sel = -1;
      hintTo = computeHints();
      sync();
    }

    function askPromote(from, to) {
      var box = el('tj-status');
      box.innerHTML = '<div class="card"><p>这一手进阵地了，要不要升变？</p>' +
        '<div class="row"><button class="btn sm" id="tj-p-yes">成</button>' +
        '<button class="btn ghost sm" id="tj-p-no">不成</button></div></div>';
      el('tj-p-yes').onclick = function () { tryPlay({ f: from, t: to, p: 1 }); };
      el('tj-p-no').onclick = function () { tryPlay({ f: from, t: to, p: 0 }); };
    }

    function same(a, b) {
      if (!!b.drop !== !!a.drop) return false;
      if (a.drop) return a.drop === b.drop && a.to === b.to;
      return a.f === b.f && a.t === b.t && (!!a.p === !!b.p);
    }

    function tryPlay(user) {
      if (!same(user, ANS)) {
        status(no('这一手不对', '再想想 —— 好手常常不是最显眼的那一手。' +
          '注意：不一定是吃子，也可能是一手逼着对方应的地方。'));
        clearPick(); sync();
        return;
      }
      var r = user.drop ? board.drop(user.drop, user.to, S.SENTE)
        : board.play(user.f, user.t, S.SENTE, !!user.p);
      if (!r.ok) { status(no('走不通', esc(r.reason))); return; }
      done = true;
      clearPick();
      sync();
      finish();
    }

    function finish() {
      el('tj-progress').textContent = '正解 ' + q.note;
      status('<div class="feedback ok"><div class="head">就是这一手</div>' +
        '<p>' + (usedAnswer ? '（你看了答案）' : '自己找出来了 —— 这一手就是把局面打开的那一下。') + '</p></div>');
      el('tj-explain').innerHTML = explainHTML();
    }

    function explainHTML() {
      var gain = S.pieceName(q.gain, false);
      var out = '<div class="explain-block"><span class="lbl">为什么是这一手</span><p>' +
        '这一手 <b>' + esc(q.note) + '</b> ' +
        (q.check ? '是<b>王手</b> —— 对方必须立刻应，没有别的选择。'
          : '是<b>打驹</b>，本身不是王手。') +
        '引擎把对方的 <b>' + q.replyCount + ' 种应法</b>全都算过：' +
        '逃王也好、拿子来挡也好、干脆不理去走别处也好，你下一手都能吃到 <b>' + gain + '</b>。</p></div>';
      out += '<div class="explain-block"><span class="lbl">对方怎么应都一样</span>' +
        '<ol class="sol-list">';
      (q.replies || []).forEach(function (r, k) {
        out += '<li class="sol-row"><span class="sol-n">' + (k + 1) + '</span>' +
          '<span class="sol-t">' + esc(r.note) + '　→　你吃 ' + esc(r.gain) + '</span></li>';
      });
      out += '</ol><p class="small muted" style="margin:8px 0 0">这是其中几种；' +
        '对方全部 ' + q.replyCount + ' 种应法都逃不掉。</p></div>';
      out += '<div class="explain-block"><span class="lbl">这一手的价值</span><p>' +
        '走这一手<b>之前</b>，你吃不到 ' + gain + ' 这么大的子 —— 是它把局面打开的。' +
        '这就是手筋和「随手吃子」的区别：吃子是结果，<b>制造这个结果的那一手</b>才是手筋。</p></div>';
      return out;
    }

    el('tj-undo').onclick = function () {
      board.setup(q.stones, q.hand, 's');
      done = false; usedAnswer = false;
      clearPick();
      status('');
      el('tj-explain').innerHTML = '';
      el('tj-progress').textContent = '先手走，找出最好的一手';
      var l = el('tj-status'); if (l) l.innerHTML = '';
      sync();
    };
    el('tj-show').onclick = function () {
      usedAnswer = true;
      var a = q.answer;
      if (a.drop) board.drop(a.drop, a.to, S.SENTE);
      else board.play(a.from, a.to, S.SENTE, !!a.promote);
      done = true;
      clearPick();
      sync();
      finish();
    };

    sync();
  }

  /* ========================== 诘将棋 ========================== */
  function tsumeList() {
    return (window.ShogiTsume && window.ShogiTsume.TSUME) || [];
  }

  function renderTsume(seg, host) {
    var list = tsumeList();
    var id = seg[2];
    if (id) {
      var q = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === id) q = list[i];
      if (q) return renderTsumeOne(q, list, host);
    }
    /* 列表页 */
    var html = '<h1>诘将棋</h1>' +
      '<p class="sub">给一个局面，用<b>连续王手</b>一路追到把王诘死 —— 这是将棋最有名的一类题，' +
      '答案唯一，可以精确验证。本库共 ' + list.length + ' 道，全部由求解器判过：手顺唯一、更短的解不存在。</p>' +
      '<div class="card"><p class="small muted" style="margin:0">怎么答：点自己的驹 → 蓝点是它' +
      '能去的地方 → 点目标落子。走对了对方会自己应；走错了会当场告诉你。<b>每一手都必须是王手</b>。</p></div>';
    var groups = {};
    list.forEach(function (q) { (groups[q.hands] = groups[q.hands] || []).push(q); });
    Object.keys(groups).sort(function (a, b) { return a - b; }).forEach(function (h) {
      html += '<h2 style="margin-top:24px">' + h + ' 手诘 <span class="small muted">' +
        groups[h].length + ' 道</span></h2><div class="row" style="gap:10px;flex-wrap:wrap">';
      groups[h].forEach(function (q, k) {
        html += '<button class="btn ghost" onclick="location.hash=\'#/shogi/tsume/' + q.id + '\'">' +
          '第 ' + (k + 1) + ' 题</button>';
      });
      html += '</div>';
    });
    host.innerHTML = html;
  }

  /* opts：
       onDone(usedAnswer) —— 走完/看完时回调（随机测验拿它计分）
       header / footer      —— 顶部、底部附加内容（测验里用来放「第几题」「下一题」） */
  function renderTsumeOne(q, list, host, opts) {
    opts = opts || {};
    var board = new S.Board();
    board.setup(q.stones, q.hand, 's');
    var ply = 0;              /* 已经走对几手 */
    var sel = -1, selHand = null, hintTo = [];
    var view = null, busy = false, done = false, usedAnswer = false;
    var demo = false;              /* 是否处于「看答案」的逐步演示模式 */
    var idx = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].id === q.id) idx = i;

    host.innerHTML = (opts.header || '') +
      (opts.headless ? '' :
        '<div class="crumb small muted" style="margin-bottom:10px">' +
        '<a href="#/shogi/tsume">← 返回诘将棋列表</a></div>') +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div id="shogi-holder" style="width:100%">' +
      '<canvas id="shogi-canvas" style="display:block;width:100%"></canvas></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="ts-undo">重来</button>' +
      '<span class="pill wood" id="ts-progress">第 1 手 / 共 ' + q.hands + ' 手</span>' +
      '</div></div>' +
      '<div class="prob-notes">' +
      '<div class="card"><h3 style="margin:0 0 6px">' + q.hands + ' 手诘</h3>' +
      '<p class="small muted" style="margin:0">先手先。用连续王手把后手的王诘死 —— ' +
      '每一步都要王手，中途不能松。</p></div>' +
      '<div id="ts-status"></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="ts-hint">给我提示</button>' +
      '<button class="btn ghost sm" id="ts-show">看答案</button>' +
      '</div>' +
      /* 看答案 = 进入**逐步演示**，一手一手看（不是一口气推演完 ——
         那样既看不清每一步，也没法停下来琢磨） */
      '<div class="row" id="ts-demo" style="margin-top:10px;display:none">' +
      '<button class="btn ghost sm" id="ts-prev">上一步</button>' +
      '<button class="btn sm" id="ts-next">下一步</button>' +
      '<button class="btn ghost sm" id="ts-all">走到底</button>' +
      '<span class="pill wood" id="ts-demo-count"></span>' +
      '</div>' +
      '<div id="ts-tip"></div>' +
      '<div class="explain-block"><span class="lbl">正解手顺</span><div id="ts-line">' +
      '<p class="small muted">走对了才会一行行显示出来。</p></div></div>' +
      '<div class="row" style="margin-top:16px">' +
      (opts.footer || (
        (idx > 0 ? '<button class="btn ghost sm" onclick="location.hash=\'#/shogi/tsume/' + list[idx - 1].id + '\'">上一题</button>' : '') +
        (idx < list.length - 1 ? '<button class="btn sm" onclick="location.hash=\'#/shogi/tsume/' + list[idx + 1].id + '\'">下一题</button>' : '')
      )) + '</div></div></div>';

    view = SB.mount(el('shogi-canvas'), { onTap: onTap, onTapHand: onTapHand });

    function sync() {
      var l = [], k;
      for (k = 0; k < S.N; k++) {
        if (!board.g[k]) continue;
        var p = board.xy(k);
        l.push([p.x, p.y, board.g[k] === S.SENTE ? 's' : 'g', board.t[k], board.p[k]]);
      }
      view.setList(l);
      view.setHand(board.hand);
      view.setSelection(sel);
      view.setHints(hintTo);
      var last = board.moves.length ? board.moves[board.moves.length - 1] : null;
      if (last) view.setLastMove(last.from === undefined ? -1 : last.from, last.to);
      else view.setLastMove(-1, -1);
      var pr = el('ts-progress');
      if (pr) {
        /* 演示模式下改用「已走几手」的口径 —— 否则控制条说「第 3 / 5 手」、
           底部说「第 4 手 / 共 5 手」，两个数字并排着看，谁都以为哪里错了 */
        pr.textContent = done ? '诘み！'
          : (demo ? ('第 ' + ply + ' / ' + q.moves.length + ' 手')
            : ('第 ' + (ply + 1) + ' 手 / 共 ' + q.hands + ' 手'));
      }
      renderLine();
    }

    function renderLine() {
      var box = el('ts-line');
      if (!box) return;
      var shown = 0;
      for (var k = 0; k < q.moves.length; k++) if (k < ply) shown++;
      if (!shown) { box.innerHTML = '<p class="small muted">走对了才会一行行显示出来。</p>'; return; }
      var out = '<ol class="sol-list">';
      for (var j = 0; j < shown; j++) {
        out += '<li class="sol-row"><span class="sol-n">' + (j + 1) + '</span>' +
          '<span class="sol-t">' + esc(q.solution[j]) + '</span></li>';
      }
      box.innerHTML = out + '</ol>';
    }

    function status(html) { el('ts-status').innerHTML = html; }

    function movesOf(k) { return board.movesFrom(k); }
    function computeHints() {
      var out = [], k, ms, r;
      if (sel >= 0) {
        ms = movesOf(sel);
        for (k = 0; k < ms.length; k++) out.push({ to: ms[k], cap: board.g[ms[k]] !== S.EMPTY });
      } else if (selHand) {
        for (k = 0; k < S.N; k++) {
          if (board.g[k] !== S.EMPTY) continue;
          r = board.drop(selHand.type, k, board.toMove);
          if (r.ok) { board.undo(r.rec); out.push({ to: k, cap: false }); }
        }
      }
      return out;
    }
    function clearPick() { sel = -1; selHand = null; hintTo = []; }

    function expect() { return q.moves[ply]; }

    function onTap(k) {
      if (busy || done || demo) return;
      var m, i2;
      if (sel >= 0 || selHand) {
        for (i2 = 0; i2 < hintTo.length; i2++) {
          if (hintTo[i2].to !== k) continue;
          if (selHand) { tryPlay({ drop: selHand.type, to: k }); return; }
          /* 能升变时问一句 —— 升与不升是两个局面 */
          if (ply < q.moves.length && !expect().drop &&
              board.promoVariants(sel, k, board.toMove).length > 1) {
            askPromote(sel, k);
            return;
          }
          tryPlay({ f: sel, t: k, p: 0 });
          return;
        }
      }
      if (board.g[k] === board.toMove) {
        sel = k; selHand = null; hintTo = computeHints();
      } else clearPick();
      sync();
    }

    function onTapHand(color, type) {
      if (busy || done || demo) return;
      if (color !== board.toMove) return;
      if (selHand && selHand.type === type) { clearPick(); sync(); return; }
      selHand = { color: color, type: type };
      sel = -1;
      hintTo = computeHints();
      sync();
    }

    function askPromote(from, to) {
      var box = el('ts-tip');
      box.innerHTML = '<div class="card"><p>这一手进阵地了，要不要升变？</p>' +
        '<div class="row"><button class="btn sm" id="ts-promo-yes">成</button>' +
        '<button class="btn ghost sm" id="ts-promo-no">不成</button></div></div>';
      el('ts-promo-yes').onclick = function () { box.innerHTML = ''; tryPlay({ f: from, t: to, p: 1 }); };
      el('ts-promo-no').onclick = function () { box.innerHTML = ''; tryPlay({ f: from, t: to, p: 0 }); };
    }

    function same(a, b) {
      if (!!b.drop !== !!a.drop) return false;
      if (a.drop) return a.drop === b.drop && a.to === b.to;
      return a.f === b.f && a.t === b.t;
    }

    /* 用户走一手：与正解比对 */
    function tryPlay(user) {
      var exp = expect();
      if (!same(user, exp)) {
        status('<div class="feedback no"><div class="head">这一手不对</div>' +
          '<p>诘将棋的答案唯一 —— 必须是<b>王手</b>，而且必须是对的那一手。' +
          '点「给我提示」可以看一眼方向。</p></div>');
        clearPick(); sync();
        return;
      }
      var color = board.toMove;
      var r = user.drop ? board.drop(user.drop, user.to, color)
        : board.play(user.f, user.t, color, !!user.p);
      if (!r.ok) { status('<div class="feedback no"><div class="head">走不通</div><p>' + esc(r.reason) + '</p></div>'); return; }
      ply++;
      clearPick();
      status('');
      sync();
      if (ply >= q.moves.length) finishNow();
      else if (q.moves[ply].s === 'g') setTimeout(replyOf, 620);   /* 轮到对方，自动应 */
      else status('<div class="feedback ok"><div class="head">对</div><p>继续 —— 下一手还是王手。</p></div>');
    }

    function replyOf() {
      var m = q.moves[ply], color = board.toMove, r;
      if (m.s !== 'g') return;
      r = m.drop ? board.drop(m.drop, m.to, color) : board.play(m.f, m.t, color, !!m.p);
      if (!r.ok) return;
      ply++;
      sync();
      if (ply >= q.moves.length) finishNow();
      else status('<div class="feedback ok"><div class="head">对方这么应</div><p>接着追。</p></div>');
    }

    function finishNow() {
      done = true;
      status('<div class="feedback ok"><div class="head">诘み —— 杀掉了</div>' +
        '<p>整条手顺都是王手，对方一步都没能喘气。这就是诘将棋的写法：' +
        '先用驹把王的逃路收掉，再一步步紧。</p></div>');
      sync();
      if (opts.onDone) opts.onDone(usedAnswer);
    }

    el('ts-undo').onclick = function () {
      board.setup(q.stones, q.hand, 's');
      ply = 0; done = false; busy = false; usedAnswer = false; demo = false;
      clearPick();
      el('ts-tip').innerHTML = '';
      status('');
      if (el('ts-demo')) el('ts-demo').style.display = 'none';
      if (el('ts-show')) el('ts-show').disabled = false;
      sync();
    };
    el('ts-hint').onclick = function () {
      el('ts-tip').innerHTML = '<div class="card"><p>' + md(q.hint) + '</p></div>';
    };

    /* ---- 「看答案」= 逐步演示 ----
       一手一手走，随时可以停下来琢磨、也可以退回去重看。
       （早先是一口气把整条手顺推演完 —— 看不清每一步，也没法停。） */
    function updateDemo() {
      var c = el('ts-demo-count');
      if (c) c.textContent = '第 ' + ply + ' / ' + q.moves.length + ' 手';
      if (el('ts-prev')) el('ts-prev').disabled = (ply <= 0);
      if (el('ts-next')) el('ts-next').disabled = (ply >= q.moves.length);
      if (el('ts-all')) el('ts-all').disabled = (ply >= q.moves.length);
    }

    function demoStep(dir) {
      if (dir > 0) {
        if (ply >= q.moves.length) return;
        var m = q.moves[ply], color = board.toMove;
        var r = m.drop ? board.drop(m.drop, m.to, color) : board.play(m.f, m.t, color, !!m.p);
        if (!r.ok) {
          status('<div class="feedback no"><div class="head">走不通</div>' +
            '<p>题库记录的这一手在当前局面下走不出来（题库可能有误）。</p></div>');
          return;
        }
        ply++;
      } else {
        if (ply <= 0) return;
        var rec = board.moves.pop();
        if (rec) board.undo(rec);
        ply--;
        done = false;
      }
      clearPick();
      /* ⚠️ 先把 done 定下来再 sync —— sync 里按 done 决定进度文案
         （写反了会显示成「第 4 手 / 共 3 手」这种超出去的数） */
      if (ply >= q.moves.length) done = true;
      sync();
      updateDemo();
      if (ply >= q.moves.length) {
        status('<div class="feedback ok"><div class="head">诘み —— 杀掉了</div>' +
          '<p>整条手顺都是王手，对方一步都没能喘气。可以点「上一步」退回去再走一遍。</p></div>');
        if (opts.onDone) opts.onDone(usedAnswer);
      } else if (ply > 0) {
        status('<div class="feedback ok"><div class="head">第 ' + ply + ' 手：' +
          esc(q.solution[ply - 1] || '') + '</div>' +
          '<p>点「下一步」看对方怎么应。</p></div>');
      }
    }

    el('ts-show').onclick = function () {
      demo = true;
      usedAnswer = true;            /* 测验里记成「看过答案」，不算独立解出 */
      el('ts-show').disabled = true;
      el('ts-demo').style.display = '';
      clearPick();
      sync();
      /* 先走一手，让用户立刻看到有反应 */
      demoStep(1);
    };
    el('ts-prev').onclick = function () { demoStep(-1); };
    el('ts-next').onclick = function () { demoStep(1); };
    el('ts-all').onclick = function () {
      var guard = 0;
      while (ply < q.moves.length && guard++ < 200) {
        var m = q.moves[ply], color = board.toMove;
        var r = m.drop ? board.drop(m.drop, m.to, color) : board.play(m.f, m.t, color, !!m.p);
        if (!r.ok) break;
        ply++;
      }
      clearPick();
      if (ply >= q.moves.length) done = true;      /* 同上：先定 done 再 sync */
      sync();
      updateDemo();
      if (ply >= q.moves.length) {
        status('<div class="feedback ok"><div class="head">诘み —— 杀掉了</div>' +
          '<p>可以点「上一步」退回去，一手一手再看一遍。</p></div>');
        if (opts.onDone) opts.onDone(usedAnswer);
      }
    };

    updateDemo();
    sync();
  }

  /* ============================ 入门课 ============================ */
  function renderLesson(seg, host) {
    var data = (window.ShogiLessons && window.ShogiLessons.LESSONS) || [];
    var id = seg[2], cur = null, i;
    for (i = 0; i < data.length; i++) if (data[i].id === id) cur = data[i];
    if (cur) {
      var k = 0;
      for (i = 0; i < data.length; i++) if (data[i].id === cur.id) k = i;
      /* 与围棋、象棋、国际象棋的课程详情页同一种版式：
         面包屑 → 标题 → 简介 → 正文（.sec）→ 要点框 → 上一课／下一课。
         标题里原本自带「一 · 」序号，面包屑已经写了第几课，这里去掉免得重复。 */
      var title = String(cur.t).replace(/^[一二三四五六七八九十]+\s*·\s*/, '');
      var html = '<div class="lesson-head">' +
        '<div class="crumb"><a href="#/shogi/lesson">入门课</a> ／ 第 ' + (k + 1) +
        ' 课 · 共 ' + data.length + ' 课</div>' +
        '<h1>' + esc(title) + '</h1>' +
        '<p class="lede">' + esc(cur.s) + '</p></div>';
      html += '<div class="sec">';
      cur.p.forEach(function (par) { html += '<p>' + md(par) + '</p>'; });
      html += '</div>';
      html += '<div class="keybox"><div class="t">这一课就记一句</div><p>' + md(cur.key) + '</p></div>';
      html += '<div class="lesson-nav">' +
        (k > 0 ? '<button class="btn ghost" onclick="location.hash=\'#/shogi/lesson/' + data[k - 1].id + '\'">← 上一课</button>'
               : '<span></span>') +
        (k < data.length - 1 ? '<button class="btn" onclick="location.hash=\'#/shogi/lesson/' + data[k + 1].id + '\'">下一课 →</button>'
                             : '') +
        '</div>';
      host.innerHTML = html;
      return;
    }
    /* 与围棋、象棋、国际象棋的课程列表同一种版式：
       一行一课（序号 + 标题 + 一句话简介 + 箭头），整行可点。 */
    var out = '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/shogi">将棋</a> · 入门课</div>' +
      '<h1>入门课</h1>' +
      '<p class="lede">一共 <b>' + data.length + '</b> 课，从「棋盘长什么样」讲到「终盘怎么收」。' +
      '每课只讲清一件事 —— 与其把规则条款列一遍，不如把新手第一盘会卡住的点逐个拆开。</p></div>';
    out += '<div class="lesson-list">';
    data.forEach(function (l, idx) {
      /* 数据里的标题自带「一 · 」这类序号，列表左侧已经有序号了，这里去掉免得重复 */
      var title = String(l.t).replace(/^[一二三四五六七八九十]+\s*·\s*/, '');
      out += '<button class="lesson-item" onclick="location.hash=\'#/shogi/lesson/' + l.id + '\'">' +
        '<span class="idx">' + (idx + 1) + '</span>' +
        '<span class="body"><span class="t">' + esc(title) + '</span>' +
        '<span class="d">' + esc(l.s) + '</span></span>' +
        '<span class="go">→</span></button>';
    });
    out += '</div>';
    host.innerHTML = out;
  }

  /* ====================== 图解：用引擎现算走法 ======================
     规则页上每一张「这枚驹能走到哪」的小图，走法点都不是手写死的 ——
     现调 movesFrom() 算出来。规则改了图就跟着变，不会出现「图与引擎不一致」。 */
  var FIG_JOBS = [];
  function moveFig(type, pro, caption, opt) {
    opt = opt || {};
    FIG_JOBS.push({ id: 'sh-fig-' + FIG_JOBS.length, type: type, pro: !!pro, opt: opt });
    var id = 'sh-fig-' + (FIG_JOBS.length - 1);
    var w = opt.w || 280;   /* 小盘太窄的话格子只有二十来像素，蓝点会细得看不见 */
    return '<figure class="shogi-figbox" style="width:' + w + 'px">' +
      '<div class="shogi-fig"><canvas id="' + id + '"></canvas></div>' +
      '<figcaption>' + caption + '</figcaption></figure>';
  }
  function mountFigs() {
    FIG_JOBS.forEach(function (f) {
      var c = document.getElementById(f.id);
      if (!c) return;
      var v = SB.mount(c, { interactive: false, showLabels: true });
      if (f.opt.initial) {            /* 初形：整盘摆出来，不画走法点 */
        var bd0 = new S.Board();
        bd0.reset();
        var all = [];
        for (var i = 0; i < S.N; i++) {
          if (!bd0.g[i]) continue;
          var p = bd0.xy(i);
          all.push([p.x, p.y, bd0.g[i] === S.SENTE ? 's' : 'g', bd0.t[i], bd0.p[i]]);
        }
        v.setList(all);
        return;
      }
      var at = f.opt.at || [4, 4];
      var bd = new S.Board();
      bd.setup([[at[0], at[1], 's', f.type, f.pro ? 1 : 0]]);
      v.setList([[at[0], at[1], 's', f.type, f.pro ? 1 : 0]]);
      v.setHints(bd.movesFrom(bd.idx(at[0], at[1])).map(function (i) {
        return { to: i, cap: false };
      }));
      v.setSelection(bd.idx(at[0], at[1]));
    });
    FIG_JOBS = [];
  }

  /* ============================ 规则 ============================ */
  function renderRules(host) {
    var html = '<h1>规则</h1>' +
      '<p class="sub">将棋的规则不多，但有三条是别的棋种没有的：持驹、升变、打步诘。' +
      '下面每张图的走法点都是<b>用引擎现场算的</b>，不是画的示意图。</p>';

    /* 一、棋盘与摆驹 */
    html += '<div class="card"><h3 style="margin-top:0">一 · 棋盘与摆驹</h3>' +
      '<p>九列九行、81 个格子，棋子放在<b>格子里</b>（不是交叉点上）。' +
      '读坐标时记住方向：<b>列从右往左数 1–9，行从上往下数一–九</b> —— ' +
      '所以棋盘右上角是「１一」，左下角是「９九」。' +
      '每张图边上都标了这套号，可以直接对着数。</p>' +
      '<div class="shogi-figrow">' + moveFig('K', 0, '初形（平手）。注意飞与角是<b>交叉</b>摆的：先手 ８八 角・２八 飞，后手 ８二 飞・２二 角 —— <b>你的角正对着对方的飞</b>',
        { initial: true, w: 360 }) + '</div>' +
      '<p class="small muted" style="margin-bottom:0">初形双方各 20 枚驹，先手有 30 种走法可选。' +
      '这一格只画了先手王的位置 —— 完整的初形去「摆棋」页看，那边是能真的走子的。</p></div>';

    /* 二、八种驹 */
    html += '<div class="card"><h3 style="margin-top:0">二 · 八种驹怎么走</h3>' +
      '<p class="small muted">蓝点是这枚驹能去的地方（以先手为准，后手上下镜像）。' +
      '橙圈是它现在站的位置。</p>' +
      '<div class="shogi-figrow">' +
      moveFig('K', 0, '<b>王将</b>：周围八格都能走，一次一格') +
      moveFig('R', 0, '<b>飞车</b>：横竖任意步，不能穿过别的驹') +
      moveFig('B', 0, '<b>角行</b>：斜线任意步，同样不能穿驹') +
      moveFig('G', 0, '<b>金将</b>：六个方向（缺两个斜后）—— 不后退斜着走') +
      moveFig('S', 0, '<b>银将</b>：五个方向（前、斜前、斜后）—— <b>不能横走、也不能直退</b>') +
      moveFig('N', 0, '<b>桂马</b>：只跳前两格的左右两侧，<b>跳过中间那格</b>，中间有驹也照样跳') +
      moveFig('L', 0, '<b>香车</b>：只往前，任意步') +
      moveFig('P', 0, '<b>步兵</b>：只往前一格') +
      '</div></div>';

    /* 三、升变 */
    html += '<div class="card"><h3 style="margin-top:0">三 · 升变</h3>' +
      '<p>走进对方最靠外的<b>三段</b>（先手是七～九行里的上三段）之后，驹可以翻面「成」。' +
      '金将和王将不能升变。升变后的走法只有四种情况，记住就行：</p>' +
      '<div class="shogi-figrow">' +
      moveFig('R', 1, '<b>龙王</b> ＝ 飞车（横竖任意步）＋ 斜走一格') +
      moveFig('B', 1, '<b>龙马</b> ＝ 角行（斜线任意步）＋ 直走一格') +
      moveFig('S', 1, '<b>成银</b> ＝ 走法和金将一样（银桂香步升变后<b>全都</b>按金走）') +
      moveFig('P', 1, '<b>と金</b> ＝ 也是金将的走法。步兵成金，价值翻好几倍') +
      '</div>' +
      '<p><b>能升、不能升、必须升</b>，三种情况要分清：</p>' +
      '<ul>' +
      '<li><b>能升</b>：起点或终点有一端在敌阵内，都可以选择升（也可以选择「不成」）。</li>' +
      '<li><b>不能升</b>：起点和终点都在敌阵外 —— 想升也升不了。</li>' +
      '<li><b>必须升</b>：走完之后这枚驹再也走不动了。具体是<b>步、香走到最外一段</b>，<b>桂走到最外两段</b> —— 不升就等于这枚驹报废，所以规则强制升变。</li>' +
      '</ul></div>';

    /* 四、持驹与打驹 */
    html += '<div class="card"><h3 style="margin-top:0">四 · 持驹：吃掉的驹归自己</h3>' +
      '<p>吃掉对方一枚驹，<b>这枚驹立刻归你所有</b>，随时可以打回盘上任意一个空点。' +
      '这一条是把将棋和所有其他棋种分开的地方：</p>' +
      '<ul>' +
      '<li>吃子不只是「得利」，还等于给自己<b>多一份机动力</b> —— 手里攥着一枚金，随时能打到对方王边上。</li>' +
      '<li>吃到的<b>升变子会还原成原形</b>：吃掉「と金」，你手里拿到的是「步兵」。</li>' +
      '<li>中盘时「双方手里各攥着几枚驹」往往比盘面更能决定胜负。</li>' +
      '</ul>' +
      '<p style="margin-bottom:0"><b>打驹的禁手比走驹还多四条</b>：</p>' +
      '<ul>' +
      '<li><b>二步</b>：同一列不能有自己两枚步兵（「と金」不算步，不占名额）。</li>' +
      '<li><b>打步诘</b>：不许用「打上来的步」一步将死对方 —— 同样一手用盘上已有的步走过去将死，则是好棋。</li>' +
      '<li><b>无处可放</b>：步、香不能打到最外一段，桂不能打到最外两段（打下去它就走不动了）。</li>' +
      '<li><b>不能送将</b>：打完之后自己的王不能被将军。</li>' +
      '</ul></div>';

    /* 五、怎么算赢 */
    html += '<div class="card"><h3 style="margin-top:0">五 · 怎么算赢</h3>' +
      '<div class="explain-block"><span class="lbl">王手</span>' +
      '<p>下一手能吃掉对方的王。被王手的一方只有三条路：<b>王挪走、吃掉攻击的驹、垫一枚驹挡住</b>。' +
      '注意不能靠「回手将对方」来化解 —— 自家王没救出来之前，别的都免谈。</p></div>' +
      '<div class="explain-block"><span class="lbl">詰み</span>' +
      '<p>被王手、而且三条路全走不通 —— 输了。<b>将棋的胜负只有这一种结束方式</b>，' +
      '没有围棋那种「赢一目半目」，也没有国际象棋的逼和。</p></div>' +
      '<div class="explain-block"><span class="lbl">必至</span>' +
      '<p>还没将死，但下一手一定杀得成，对方怎么防都防不住。实战里多数棋局不是算到最后一步，' +
      '而是做出必至之后对方就投了。</p></div>' +
      '<div class="explain-block"><span class="lbl">两种罕见结局</span>' +
      '<p><b>千日手</b>：同一个局面（盘面＋持驹＋轮走方三项全同）重复四次，作废重下。<br>' +
      '<b>持将棋</b>：双方的王都跑进对方阵地、谁也杀不了谁，按点数判 —— 飞角各 5 点、其余各 1 点，满 24 点的一方赢。</p></div>' +
      '</div>';

    host.innerHTML = html;
    mountFigs();
  }

  /* ============================ 词典 ============================ */
  /* ==================== 词典 ====================
     版式与围棋词典（glossary-ui.js）、国际象棋词典对齐：
       列表 = 搜索框 + 分类卡片网格；详情 = 四段正文 + 棋盘图 + 相关术语 + 上下条 */
  var TERM_CSS =
    '.ct-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px;}' +
    '@media(max-width:1000px){.ct-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}' +
    '@media(max-width:620px){.ct-grid{grid-template-columns:1fr;}}' +
    '.ct-card{text-align:left;border:1px solid var(--line,#e2ded4);background:var(--card,#fffdf8);' +
    'border-radius:12px;padding:13px 15px;cursor:pointer;display:block;width:100%;' +
    'font:inherit;color:inherit;transition:border-color .15s,transform .15s;}' +
    '.ct-card:hover{border-color:var(--accent,#8a6a3a);transform:translateY(-1px);}' +
    '.ct-card .n{font-weight:600;font-size:15px;margin-bottom:4px;}' +
    '.ct-card .d{font-size:12.5px;line-height:1.6;opacity:.82;display:-webkit-box;' +
    '-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}' +
    '.ct-card .m{font-size:11.5px;opacity:.55;margin-top:7px;}' +
    '.ct-card .m .has-fig{color:var(--accent,#8a6a3a);opacity:1;}';

  function plain(s, n) {
    var t = String(s || '').replace(/\*\*/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function terms() { return (global.ShogiTerms && global.ShogiTerms.TERMS) || []; }

  function renderTerms(seg, host) {
    var data = terms();
    if (!data.length) { host.innerHTML = '<h1>词典</h1><p class="sub">数据没加载出来。</p>'; return; }
    var name = seg[2] ? decodeURIComponent(seg[2]) : '';
    if (name) return renderTermOne(name, data, host);

    var CATS = ['基础', '战术', '布局', '其他'];
    var figN = 0, i;
    for (i = 0; i < data.length; i++) if (data[i].fig && data[i].fig.list) figN++;

    var html = '<h1>词典</h1>' +
      '<p class="sub">将棋术语 <b>' + data.length + '</b> 条，按 <b>' + CATS.length + '</b> 类铺开，' +
      '其中 <b>' + figN + '</b> 条配了棋盘图。术语名沿用将棋界自己的写法（詰み、寄せ、矢倉…），' +
      '解释一律大白话 —— 每条讲四件事：<b>是什么</b>、<b>为什么要紧</b>、<b>怎么用</b>、<b>容易搞错哪一点</b>。</p>' +
      '<input class="search-box" id="sh-search" autocomplete="off" ' +
      'placeholder="搜术语、解释或用途…（例如：王手、金、矢仓）">';

    CATS.forEach(function (cat) {
      var items = data.filter(function (x) { return x.c === cat; });
      if (!items.length) return;
      html += '<section class="ct-cat" data-cat="' + esc(cat) + '">' +
        '<h2 style="margin-top:24px">' + esc(cat) +
        ' <span class="small muted" style="font-weight:400">' + items.length + ' 条</span></h2>' +
        '<div class="ct-grid">';
      items.forEach(function (x) {
        var text = (x.t + ' ' + (x.c || '') + ' ' + (x.d || '') + ' ' + (x.w || '') + ' ' +
          (x.u || '') + ' ' + (x.e || '')).toLowerCase();
        html += '<button class="ct-card" data-term="' + esc(x.t) + '" data-text="' + esc(text) + '">' +
          '<div class="n">' + esc(x.t) + '</div>' +
          '<div class="d">' + esc(plain(x.d, 46)) + '</div>' +
          '<div class="m">' + ((x.fig && x.fig.list) ? '<span class="has-fig">▦ 带棋盘图</span> · ' : '') +
          '看详解 →</div></button>';
      });
      html += '</div></section>';
    });
    html += '<div id="sh-empty" style="display:none" class="card"><p style="margin:0">' +
      '没有找到匹配的术语，换个说法试试（比如「玉」「银」「诘」）。</p></div>';

    host.innerHTML = '<style>' + TERM_CSS + '</style>' + html;
    host.querySelectorAll('.ct-card').forEach(function (b) {
      b.onclick = function () { location.hash = '#/shogi/terms/' + encodeURIComponent(b.getAttribute('data-term')); };
    });
    var search = el('sh-search');
    if (search) {
      search.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase(), anyHit = 0;
        host.querySelectorAll('.ct-card').forEach(function (c) {
          var hit = !q || c.getAttribute('data-text').indexOf(q) !== -1;
          c.style.display = hit ? '' : 'none';
          if (hit) anyHit++;
        });
        host.querySelectorAll('.ct-cat').forEach(function (sec) {
          var vis = 0;
          sec.querySelectorAll('.ct-card').forEach(function (c) { if (c.style.display !== 'none') vis++; });
          sec.style.display = vis ? '' : 'none';
        });
        var empty = el('sh-empty');
        if (empty) empty.style.display = anyHit ? 'none' : '';
      });
    }
  }

  function renderTermOne(name, data, host) {
    var t = null, idx = -1, i, j;
    for (i = 0; i < data.length; i++) if (data[i].t === name) { t = data[i]; idx = i; }
    if (!t) {
      host.innerHTML = '<div class="card"><p>词典里没有「' + esc(name) + '」。</p>' +
        '<button class="btn" onclick="location.hash=\'#/shogi/terms\'">回词典</button></div>';
      return;
    }
    var figBox = '';
    if (t.fig && t.fig.list) {
      figBox = '<div class="card" style="margin-top:14px"><h3 style="margin-top:0">看个例子</h3>' +
        '<div id="sh-term-holder" style="max-width:440px;width:100%">' +
        '<canvas id="sh-term-fig" style="display:block;width:100%"></canvas></div>' +
        (t.fig.cap ? '<p style="margin-top:10px">' + md(t.fig.cap) + '</p>' : '') + '</div>';
    }
    var have = {};
    data.forEach(function (y) { have[y.t] = 1; });
    var relBox = '';
    if (t.r && t.r.length) {
      var links = '';
      t.r.forEach(function (n) {
        if (have[n]) links += '<button class="btn ghost sm" data-goto="' + esc(n) + '">' + esc(n) + '</button>';
        else links += '<span class="small muted" style="margin-right:8px">' + esc(n) + '（词典里还没有）</span>';
      });
      relBox = '<div class="card" style="margin-top:14px"><h3 style="margin-top:0">相关术语</h3>' +
        '<div class="row" style="flex-wrap:wrap">' + links + '</div></div>';
    }
    var prev = idx > 0 ? data[idx - 1] : null;
    var next = idx < data.length - 1 ? data[idx + 1] : null;

    host.innerHTML =
      '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/shogi/terms">← 回词典</a></div>' +
      '<h1>' + esc(t.t) + '</h1>' +
      '<p class="sub">' + esc(t.c) + ' · 第 ' + (idx + 1) + ' / ' + data.length + ' 条</p>' +
      '<div class="card">' +
      '<div class="explain-block"><span class="lbl">是什么</span><p>' + md(t.d) + '</p></div>' +
      (t.w ? '<div class="explain-block"><span class="lbl">为什么要紧</span><p>' + md(t.w) + '</p></div>' : '') +
      (t.u ? '<div class="explain-block"><span class="lbl">怎么用</span><p>' + md(t.u) + '</p></div>' : '') +
      (t.e ? '<div class="explain-block"><span class="lbl">容易搞错</span><p>' + md(t.e) + '</p></div>' : '') +
      '</div>' + figBox + relBox +
      '<div class="row" style="margin-top:16px">' +
      (prev ? '<button class="btn ghost sm" data-goto="' + esc(prev.t) + '">← ' + esc(prev.t) + '</button>' : '') +
      (next ? '<button class="btn sm" data-goto="' + esc(next.t) + '">' + esc(next.t) + ' →</button>' : '') +
      '</div>';

    host.querySelectorAll('[data-goto]').forEach(function (b) {
      b.onclick = function () {
        location.hash = '#/shogi/terms/' + encodeURIComponent(b.getAttribute('data-goto'));
      };
    });
    if (t.fig && t.fig.list) {
      var c = el('sh-term-fig');
      if (c) {
        var v = SB.mount(c, { interactive: false });
        /* ★ shogi-board 的 list 每项是**数组** [x,y,color,type,pro]（内部按 s[0]/s[1] 取值），
           不是对象。数据文件里本来就是数组，直接用，别再包一层。 */
        v.setList(t.fig.list);
        if (t.fig.marks) v.setHints(t.fig.marks.map(function (p) { return p[1] * 9 + p[0]; }));
      }
    }
  }

  /* ============================ 首页 ============================ */
  /* ---------------- 首页 ---------------- */

  /* 入口卡片：与围棋、象棋、国际象棋三个板块用同一种版式
     （首页 = 标题 + 栏目卡片网格 + 「这一版有什么」要点列表）。 */
  function entryCard(t, d, hash, pill) {
    return '<button class="entry" onclick="location.hash=\'' + hash + '\'">' +
      '<div class="t">' + esc(t) + (pill ? ' <span class="pill">' + esc(pill) + '</span>' : '') + '</div>' +
      '<div class="d">' + d + '</div>' +
      '<div class="m">点进去看看 →</div></button>';
  }

  function renderHome(host) {
    var lessons = (window.ShogiLessons && window.ShogiLessons.LESSONS) || [];
    var termsAll = (window.ShogiTerms && window.ShogiTerms.TERMS) || [];
    var tsumeAll = (window.ShogiTsume && window.ShogiTsume.TSUME) || [];
    var nextAll = global.SHOGI_NEXT || [];
    var josekiAll = global.SHOGI_JOSEKI || [];
    var gamesAll = global.SHOGI_GAMES || [];
    var checks = (window.ShogiSelfCheck && window.ShogiSelfCheck.CHECKS) || [];

    var html = '';
    html += '<div class="hero"><h1>将棋</h1>';
    html += '<p class="sub">日本将棋。棋盘只有九乘九，比象棋还小一圈，但它有三条规则是别的棋种都没有的 —— ' +
      '<b>持驹、升变、打步诘</b>。本板块的走法、禁手、王手与诘全部由规则引擎实现并自检；' +
      '两套题库先用求解器算出正解、再用独立的校验脚本复核 —— 不是手写答案。</p></div>';

    html += '<div class="entry-grid">';
    html += entryCard('入门课',
      '从摆驹、八种驹怎么走，讲到升变与持驹 —— 重点讲清「吃掉对方的驹可以打回盘上」这条，那是将棋与象棋差得最远的地方。',
      '#/shogi/lesson', lessons.length + ' 课');
    html += entryCard('规则速查',
      '八种驹的走法、升变的三种情形、二步与打步诘为什么是禁手 —— <b>图解是引擎按规则现算的</b>，不是画的示意图。',
      '#/shogi/rules', '可看');
    html += entryCard('诘将棋',
      '用连续王手一路追到把王诘死，手顺唯一。每道题都自带「正解唯一」的机器证明。',
      '#/shogi/tsume', tsumeAll.length + ' 题');
    html += entryCard('手筋',
      '「次の一手」：找出唯一的好手 —— 走对它，对方怎么应都要掉子。',
      '#/shogi/tesuji', nextAll.length + ' 题');
    html += entryCard('定迹',
      '将棋界的「定式」：相居飞车、角交换、四间飞车、向飞车。每条都从标准初形出发、由引擎逐手验算过合法性，可以一手一手步进着看。',
      '#/shogi/joseki', josekiAll.length + ' 条');
    html += entryCard('名局',
      '职业对局的完整手顺（名人戦 · 谷川浩司 × 羽生善治 等），可以一手一手回放。每手说明是引擎算出来的事实。',
      '#/shogi/games', gamesAll.length + ' 局');
    html += entryCard('术语词典',
      '王手、寄せ、必至、持驹、升变、打步诘……将棋术语按人话解释，可直接搜索。',
      '#/shogi/terms', termsAll.length + ' 条');
    html += entryCard('实战自测',
      '走一手评一手（判送驹、孤驹、王的安全）；一份常见失误自查表；还有随机抽题考自己。不记进度、不排名。',
      '#/shogi/selfcheck', '三个工具');
    html += entryCard('自由摆棋',
      '一张真的将棋盘，含上下两条持驹台。走子、升变、打驹都按规则来，走不了会告诉你为什么。',
      '#/shogi/board', '动手工具');
    html += '</div>';

    html += '<h2>这一版有什么</h2>';
    html += '<div class="card"><ul style="margin:0;padding-left:20px">' +
      '<li><b>入门课</b>：' + lessons.length + ' 课 —— 摆驹 → 八种驹的走法 → 升变 → 持驹，每课配盘面。</li>' +
      '<li><b>规则速查</b>：八种驹各一张小盘，蓝点就是那枚驹能去的位置，全部由引擎现算。</li>' +
      '<li><b>诘将棋</b>：' + tsumeAll.length + ' 道，手顺唯一。先用求解器生成、再用独立的校验脚本复核，不是手写答案。</li>' +
      '<li><b>手筋</b>：' + nextAll.length + ' 道「次の一手」—— 走对唯一好手，对方怎么应都要掉子。</li>' +
      '<li><b>定迹</b>：' + josekiAll.length + ' 条基本开局次序，每条都从标准初形出发、由引擎逐手验算过合法性。</li>' +
      '<li><b>名局</b>：' + gamesAll.length + ' 局职业对局的完整手顺。每手说明是引擎算出来的事实' +
      '（走到哪、吃了什么、有没有升变、是不是王手），<b>没有胜率、也没有评价</b> —— ' +
      '那种判断要靠棋力，算不出来就宁可不写。</li>' +
      '<li><b>术语词典</b>：' + termsAll.length + ' 条，可搜索。</li>' +
      '<li><b>实战自测</b>：对局自评 + ' + checks.length + ' 条常见失误自查表 + 随机测验。</li>' +
      '<li><b>自由摆棋</b>：在真棋盘上走子，每一步都过规则引擎，含持棋台。</li>' +
      '</ul></div>';

    html += '<h2>将棋与象棋差得最远的三件事</h2>';
    html += '<div class="card">' +
      '<div class="explain-block"><span class="lbl">一 · 持驹</span>' +
      '<p>吃掉对方一枚驹，这枚驹就<b>归你所有</b>，随时可以打回盘上任意一个空点。' +
      '所以将棋里吃子不只是得利，还会让对方多出一份攻击力量 —— ' +
      '中盘「双方手里各攥着几枚驹」往往比盘面上的子更能决定胜负。</p></div>' +
      '<div class="explain-block"><span class="lbl">二 · 升变</span>' +
      '<p>驹走进对方阵地（最靠外的三段）后可以「成」：飞变龙、角变马、银桂香步一律变金。' +
      '升变只在进入／离开／身处敌阵时可以选，是可选而非强制 —— ' +
      '但步香走到最外一段、桂走到最外两段，<b>必须</b>升变（否则这枚驹就再也走不动了）。</p></div>' +
      '<div class="explain-block"><span class="lbl">三 · 打步诘</span>' +
      '<p>用「打上来的步」一步把对方将死，是<b>禁手</b>。' +
      '同样的一手若改用盘上已有的步走过去，则是好棋。' +
      '这条让将棋的终盘算路多出一个所有其他棋种都没有的岔口。</p></div>' +
      '</div>';

    host.innerHTML = html;
  }

  function renderSoon(sub, host) {
    var info = TABS[sub] || TABS[''];
    host.innerHTML =
      '<h1>' + esc(info[0]) + '</h1>' +
      '<p class="sub">这一格还没开工。</p>' +
      '<div class="card"><p>计划内容：' + esc(info[1]) + '</p>' +
      '<p class="small muted" style="margin-bottom:0">' +
      '规则引擎和棋盘已经就位，写题目与讲解时可以直接调引擎验算，不用手推。</p></div>' +
      '<div class="row" style="margin-top:16px">' +
      '<button class="btn" onclick="location.hash=\'#/shogi/board\'">先去摆棋</button>' +
      '<button class="btn ghost" onclick="location.hash=\'#/shogi\'">回将棋首页</button></div>';
  }

  /* ============================ 摆棋 ============================
     这个函数同时被「摆棋」和「实战自测 → 对局自评」两处调用：
     传 opts.review 就多挂一个点评面板，走一手评一手；不传就是纯粹的摆棋。 */
  function renderPlay(host, opts) {
    opts = opts || {};
    var board = new S.Board();
    board.reset();

    var sel = -1;            /* 选中的盘上驹（引擎下标） */
    var selHand = null;      /* 选中的持驹 { color, type } */
    var hintTo = [];         /* [{to, cap}] */
    var notes = [];          /* 记谱文本 */
    var pending = null;      /* 待确认升变的一手 { from, to } */
    var view = null;

    var plySinceDrop = 0;      /* 连着几手没打过驹 —— 对局自评用来提醒「持驹闲置」 */

    host.innerHTML =
      (opts.title === null ? '' : '<h1>' + esc(opts.title || '摆棋') + '</h1>') +
      '<p class="sub">' + (opts.sub ||
        '点自己的驹 → 蓝点是它能去的地方 → 点目标落子。' +
        '点下面的持驹台可以把吃到的驹打回盘上。') + '</p>' +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div id="shogi-holder" style="width:100%">' +
      '<canvas id="shogi-canvas" style="display:block;width:100%"></canvas></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="sh-undo">悔一手</button>' +
      '<button class="btn ghost sm" id="sh-reset">重新开始</button>' +
      '<span class="pill wood" id="sh-turn">先手走</span>' +
      '</div></div>' +
      '<div class="prob-notes">' +
      '<div id="sh-promo" style="display:none"></div>' +
      '<div id="sh-status"></div>' +
      (opts.review ? '<div id="sh-review"></div>' : '') +
      '<div class="explain-block"><span class="lbl">着手记录</span>' +
      '<div class="sc-moves" id="sh-notes"><p class="small muted">还没有走棋。</p></div></div>' +
      '</div></div>';

    view = SB.mount(el('shogi-canvas'), { onTap: onTap, onTapHand: onTapHand });

    /* 把引擎局面推给棋盘 */
    function sync() {
      var list = [], i;
      for (i = 0; i < S.N; i++) {
        if (!board.g[i]) continue;
        var p = board.xy(i);
        list.push([p.x, p.y, board.g[i] === S.SENTE ? 's' : 'g', board.t[i], board.p[i]]);
      }
      view.setList(list);
      view.setHand(board.hand);
      view.setSelection(sel);
      view.setHints(hintTo);
      var rec = board.moves.length ? board.moves[board.moves.length - 1] : null;
      if (rec) view.setLastMove(rec.from === undefined ? -1 : rec.from, rec.to);
      else view.setLastMove(-1, -1);
      renderStatus();
      renderNotes();
      var t = el('sh-turn');
      if (t) t.textContent = S.colorName(board.toMove) + '走';
    }

    function renderStatus() {
      var box = el('sh-status');
      if (!box) return;
      /* 刚才那一手不合法时，先把原因说出来 —— 否则用户会觉得「点了没反应」。
         （这条本来是 flash() 直接写进去的，但紧跟着的 sync() 会把状态栏重写一遍，
          提示当场被冲掉。改成这里统一渲染，顺序才靠得住。） */
      if (lastError) {
        box.innerHTML = '<div class="feedback no"><div class="head">' + esc(lastErrorTitle) +
          '</div><p>' + esc(lastError) + '</p></div>';
        lastError = ''; lastErrorTitle = '这一手不行';
        return;
      }
      /* ⚠️ 要判断的是**当前该走的一方**（board.toMove），不是对手。
         写成对手的话，会出现「对方正被王手、页面却说轮到你随便走」这种误导 ——
         摆棋页上真踩过：升变之后对方明明必须应将，界面却毫无提示。 */
      var mover = board.toMove;
      var out = '';
      if (board.isMate(mover)) {
        out = '<div class="feedback ok"><div class="head">' +
          (board.isChecked(mover) ? '诘み —— ' : '无着可走 —— ') +
          S.colorName(S.other(mover)) + '胜</div><p>点「重新开始」再来一盘。</p></div>';
      } else if (board.isChecked(mover)) {
        out = '<div class="feedback no"><div class="head">王手！</div>' +
          '<p>' + S.colorName(mover) + '的王被将军了，这一手必须应将 —— ' +
          '把王挪走、吃掉攻击的那枚驹、或者垫一枚驹（手里的持驹也能垫）。</p></div>';
      } else {
        out = '<p class="small muted">轮到' + S.colorName(mover) +
          '。想不出走哪儿，可以先把手里的大驹打出去试试。</p>';
      }
      box.innerHTML = out;
    }

    function renderNotes() {
      var box = el('sh-notes');
      if (!box) return;
      if (!notes.length) { box.innerHTML = '<p class="small muted">还没有走棋。</p>'; return; }
      var out = '<ol class="sol-list">';
      for (var i = 0; i < notes.length; i++) {
        out += '<li class="sol-row"><span class="sol-n">' + (i + 1) + '</span>' +
          '<span class="sol-t">' + esc(notes[i]) + '</span></li>';
      }
      box.innerHTML = out + '</ol>';
    }

    /* 已选中的驹 / 持驹 能去哪些点 */
    function computeHints() {
      var out = [], i, ms, r;
      if (sel >= 0) {
        ms = board.movesFrom(sel);
        for (i = 0; i < ms.length; i++) out.push({ to: ms[i], cap: board.g[ms[i]] !== S.EMPTY });
      } else if (selHand) {
        for (i = 0; i < S.N; i++) {
          if (board.g[i] !== S.EMPTY) continue;
          r = board.drop(selHand.type, i, board.toMove);
          if (r.ok) { board.undo(r.rec); out.push({ to: i, cap: false }); }
        }
      }
      return out;
    }

    function reasonText(r) {
      var m = {
        'nifu': '二步 —— 同一列不能有两个自己的步。',
        'uchifuzume': '打步诘 —— 用「打上来的步」一步将死是禁手。',
        'nowhere': '这枚驹不能放在这里 —— 放下去它就再也走不动了。',
        'self-check': '这手走完自己的王会被将，不合法。',
        'no-promote': '这手不能升变 —— 起点和终点都不在对方的阵地上。',
        'capture-king': '王的输赢由「诘」判定，不能直接把王吃掉。',
        'no-hand': '手里没有这枚驹。',
        'occupied': '那个点上有驹。'
      };
      return m[r] || ('这一手不合法（' + r + '）。');
    }

    /* 不合法的一手：只记下原因，交给 renderStatus 去显示（那里不会紧接着被覆盖） */
    var lastError = '', lastErrorTitle = '这一手不行';
    /* 提示先只记下来，由 renderStatus() 统一渲染 ——
       早先 flash() 直接写状态栏，而紧跟其后的 sync() 会把状态栏重写一遍，
       提示当场被冲掉，用户看到的就是「点了没反应」。 */
    function flash(msg, title) { lastError = msg; lastErrorTitle = title || '这一手不行'; }

    function clearPick() { sel = -1; selHand = null; hintTo = []; }

    function onTap(i) {
      if (pending) return;
      if (board.isMate(board.toMove)) return;    /* 该走的一方已经无着 = 棋局结束 */
      /* 已经选中东西：先看这一格是不是落点 */
      if (sel >= 0 || selHand) {
        for (var k = 0; k < hintTo.length; k++) {
          if (hintTo[k].to !== i) continue;
          if (selHand) { doDrop(selHand.type, i); return; }
          var vs = board.promoVariants(sel, i, board.toMove);
          if (vs.length > 1) { askPromote(sel, i); return; }
          doMove(sel, i, vs[0]);
          return;
        }
      }
      /* 不是落点 → 选中己方的驹，或者取消 */
      if (board.g[i] === board.toMove) {
        sel = i; selHand = null; hintTo = computeHints();
      } else {
        clearPick();
      }
      sync();
    }

    function onTapHand(color, type) {
      if (pending) return;
      /* ⚠️ 这里必须跟一句 sync()：flash() 只是记下提示，要等 sync() 里的
         renderStatus() 才画出来。漏了 sync() 就等于「点了没反应」。 */
      if (color !== board.toMove) {
        flash('那是' + S.colorName(color) + '的持驹，现在轮不到它用。');
        sync();
        return;
      }
      if (selHand && selHand.type === type) { clearPick(); sync(); return; }
      selHand = { color: color, type: type };
      sel = -1;
      hintTo = computeHints();
      /* 选中了却一处也放不下 —— 别让用户对着「什么都没发生」发愣。
         最常碰到的就是步：同一列只要有自己一枚没升变的步（升过的「と金」不算），
         整列就都不能打（二步），而开局时每一列都有自己的步。 */
      if (!hintTo.length) {
        var why = (type === 'P')
          ? '同一列只要有自己一枚步就不能再打（二步），也不能打到最后一段。现在这两条都挡着。'
          : '盘上没有它能站住的地方 —— 打下去就再也走不动的位置是不许放的。';
        flash('手里的「' + S.pieceName(type, false) + '」暂时无处可放：' + why, '这枚驹现在放不下');
      }
      sync();
    }

    /* 可升变时先问一句 —— 升不升是天差地别的两个局面，不能替用户决定 */
    function askPromote(from, to) {
      pending = { from: from, to: to };
      var box = el('sh-promo');
      box.style.display = '';
      box.innerHTML = '<div class="card"><p>这一手走到 <b>' + S.toLabel(to) +
        '</b>，进阵地了 —— 要不要升变？</p><div class="row">' +
        '<button class="btn sm" id="sh-do-promote">成（升变）</button>' +
        '<button class="btn ghost sm" id="sh-do-plain">不成</button></div></div>';
      el('sh-do-promote').onclick = function () { closePromote(); doMove(from, to, true); };
      el('sh-do-plain').onclick = function () { closePromote(); doMove(from, to, false); };
    }
    function closePromote() {
      pending = null;
      var box = el('sh-promo');
      if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    }

    function noteOf(fromType, to, promote, isDrop, wasPro) {
      var mover = S.other(board.toMove);          /* play 之后才调用，所以取反 */
      /* wasPro = 走之前有没有升变：龙走一步仍记「龍」、と金仍记「と」 */
      var glyph = S.glyph(fromType, !!wasPro);
      return (mover === S.SENTE ? '▲' : '△') + S.toLabel(to) + glyph +
        (promote ? '成' : '') + (isDrop ? '打' : '');
    }

    function afterMove(mover, rec) {
      if (opts.onMove) opts.onMove(board, rec, mover);
      if (!opts.review) return;
      var R = window.ShogiReview;
      if (!R) return;
      var items = R.reviewMove(board, rec, mover), k;
      for (k = 0; k < items.length; k++) pushReview(items[k]);
      var hand = 0;
      S.HAND_ORDER.forEach(function (t) { hand += board.handCount(mover, t); });
      var idle = R.handIdle(plySinceDrop, hand);
      if (idle) pushReview(idle);
    }

    function doMove(from, to, promote) {
      var fromType = board.t[from];
      var wasPro = board.p[from] === 1;
      var mover = board.toMove;
      var r = board.play(from, to, mover, promote);
      if (!r.ok) { flash(reasonText(r.reason)); sync(); return; }
      notes.push(noteOf(fromType, to, promote, false, wasPro));
      plySinceDrop++;
      clearPick(); sync();
      afterMove(mover, r.rec);
    }

    function doDrop(type, to) {
      var mover = board.toMove;
      var r = board.drop(type, to, mover);
      if (!r.ok) { flash(reasonText(r.reason)); sync(); return; }
      notes.push(noteOf(type, to, false, true));
      plySinceDrop = 0;
      clearPick(); sync();
      afterMove(mover, r.rec);
    }

    /* ---- 对局自评：把点评累积到右侧 ---- */
    var reviewItems = [];
    function pushReview(it) {
      reviewItems.push({ label: notes[notes.length - 1] || '', item: it });
      renderReview();
    }
    function renderReview() {
      var box = el('sh-review');
      if (!box) return;
      if (!reviewItems.length) {
        box.innerHTML = '<div class="card"><p class="small muted" style="margin:0">' +
          '边走边看 —— 一手走完就在这里给出点评。只评规则层能算清的东西：' +
          '这枚驹有没有人保、是不是被盯着、有没有把王的门打开。</p></div>';
        return;
      }
      var out = '<div class="card"><h3 style="margin:0 0 8px">逐手点评</h3>';
      reviewItems.forEach(function (x, i) {
        var it = x.item;
        out += '<div class="trap-item"><b>' + esc(x.label) + '</b> ' +
          '<span class="pill ' + (it.level === 'high' ? 'wood' : 'gray') + '">' + esc(it.kind) + '</span><br>' +
          md(it.text) + '</div>';
      });
      out += '</div>';
      box.innerHTML = out;
    }
    if (opts.review) renderReview();

    el('sh-undo').onclick = function () {
      closePromote();
      var rec = board.moves.pop();
      if (!rec) return;
      board.undo(rec);
      notes.pop();
      if (reviewItems.length) { reviewItems.pop(); renderReview(); }
      plySinceDrop = 0;
      clearPick(); sync();
    };
    el('sh-reset').onclick = function () {
      closePromote();
      board.reset();
      notes = [];
      reviewItems = [];
      plySinceDrop = 0;
      clearPick(); sync();
      if (opts.review) renderReview();
    };

    sync();
  }

  global.ShogiApp = { render: render, TABS: TABS };
})(typeof window !== 'undefined' ? window : this);
