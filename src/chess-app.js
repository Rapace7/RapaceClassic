/* 国际象棋板块 —— 路由 + 各个页面的渲染
 *
 * 结构与其他三个棋种一致：
 *   src/chess-engine.js   规则引擎（自检 20 项）
 *   src/chess-board.js    棋盘渲染
 *   src/chess-app.js      本文件：路由与页面
 *   src/chess-terms.js    词典数据
 *   src/chess-lessons.js  入门课数据
 *   src/chess-openings.js 开局数据（手顺由引擎逐手验算）
 *   src/chess-endgame.js  残局知识数据
 *   src/chess-mates.js    战术题（由 tools/gen_chess_mates.js 用引擎生成）
 *   src/chess-games.js    名局（手顺由引擎逐手验算）
 *
 * 页面里所有「手顺」都必须是引擎能走通的 —— 这一点由 tools/audit_chess.js 兜底。
 */
'use strict';

var ChessApp = (function () {

  var CH = (typeof window !== 'undefined' ? window.CHESS : null) ||
    (typeof globalThis !== 'undefined' ? globalThis.CHESS : null);
  var CB = (typeof window !== 'undefined' ? window.ChessBoard : null) ||
    (typeof globalThis !== 'undefined' ? globalThis.ChessBoard : null);

  function $(id) { return document.getElementById(id); }
  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 行内 `**粗体**` 与换行 —— 数据文件里统一用这个写法 */
  function md(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  }

  function data(name) {
    var g = (typeof window !== 'undefined') ? window : globalThis;
    return g[name] || [];
  }

  /* ======================= 小工具：局面与走法 ======================= */

  /* 从数据里的 pieces 摆一个局面 */
  function setup(cfg, toMove, castling) {
    var bd = new CH.Board();
    bd.setup(cfg, toMove || 'w', castling === undefined ? '' : castling);
    return bd;
  }

  function viewPieces(bd) {
    var out = [];
    for (var i = 0; i < CH.N; i++) {
      if (!bd.g[i]) continue;
      out.push([i % 8, (i / 8) | 0, CH.colorChar(bd.g[i]), bd.t[i]]);
    }
    return out;
  }

  /* 手顺数据的解析：**直接用引擎那一份**（CHESS.Board.prototype.parseMove）。
     页面和校验器共用同一个解析器，才不会出现「校验说能走、页面走不通」。 */
  function parseMove(str, bd) {
    return bd.parseMove(str);
  }

  /* 走一手，返回引擎的 {ok, rec}；不合法返回 null */
  function playMove(bd, m) {
    if (!m) return null;
    if (m.castle) {
      var ms = bd.legalMoves(bd.toMove).filter(function (x) { return x.castle === m.castle; });
      if (!ms.length) return null;
      var r0 = bd.play(ms[0].from, ms[0].to, bd.toMove, null, ms[0].castle);
      return r0.ok ? r0 : null;
    }
    var r = bd.play(m.from, m.to, bd.toMove, m.promo || null, null);
    return r.ok ? r : null;
  }

  /* 把一个手顺数组走一遍。走不通就停并返回原因。 */
  function walkLine(bd, line, cb) {
    for (var i = 0; i < line.length; i++) {
      var m = parseMove(line[i], bd);
      if (!m) return { ok: false, at: i, why: '认不出这一步：' + line[i] };
      var m2 = playMove(bd, m);
      if (!m2) return { ok: false, at: i, why: '第 ' + (i + 1) + ' 步走不通：' + line[i] };
      if (cb) cb(i, m2);
    }
    return { ok: true };
  }

  /* ======================= 页面：首页 ======================= */

  /* ---------------- 首页 ---------------- */

  /* 入口卡片：与围棋、象棋、将棋三个板块用同一种版式
     （首页 = 标题 + 栏目卡片网格 + 「这一版有什么」要点列表）。 */
  function entryCard(t, d, hash, pill) {
    return '<button class="entry" onclick="location.hash=\'' + hash + '\'">' +
      '<div class="t">' + esc(t) + (pill ? ' <span class="pill">' + esc(pill) + '</span>' : '') + '</div>' +
      '<div class="d">' + d + '</div>' +
      '<div class="m">点进去看看 →</div></button>';
  }

  function renderHome(host) {
    var terms = data('CHESS_TERMS').length;
    var mates = data('CHESS_MATES').length;
    var games = data('CHESS_GAMES').length;
    var lessons = data('CHESS_LESSONS').length;
    var openings = data('CHESS_OPENINGS').length;
    var endgames = data('CHESS_ENDGAME').length;
    var checks = data('CHESS_SELFCHECK').length;

    var html = '';
    html += '<div class="hero"><h1>国际象棋</h1>';
    html += '<p class="sub">从棋子怎么走开始，到开局、战术、残局、名局。' +
      '<b>所有手顺都由规则引擎逐手验算过</b> —— 走不通的棋谱不会出现在这里。' +
      '棋盘可以直接下，规则页的走法图解是引擎现场算出来的，不是画的示意图。</p></div>';

    html += '<div class="entry-grid">';
    html += entryCard('入门课',
      '从认棋盘到第一盘棋：棋子价值、三条特殊规则、将杀与逼和、开局三原则，以及怎么把优势换成赢棋。',
      '#/chess/lesson', lessons + ' 课');
    html += entryCard('规则速查',
      '六种棋子各怎么走、兵怎么升变、王车易位有什么条件、什么算将杀、什么算逼和 —— <b>每一张图解都是引擎按规则现算的</b>。',
      '#/chess/rules', '可看');
    html += entryCard('战术题',
      '一步杀、两步杀，全部由引擎验证过：<b>正解唯一，走完真的是将杀</b>。',
      '#/chess/tactics', mates + ' 道');
    html += entryCard('残局',
      '几种<b>有确定结论</b>的基本残局：单后杀单王、单车杀单王、兵升变 —— 每种都用引擎把着法走通过。',
      '#/chess/endgame', endgames + ' 类');
    html += entryCard('开局',
      '几条最基本的开局思路（占中心、出子、保王），以及几条教科书级手顺。每条手顺都逐手验算过合法性。',
      '#/chess/opening', openings + ' 条');
    html += entryCard('名局',
      '历史上的名局，可以一手一手回放。手顺全部由引擎逐手验算过 —— 棋谱只要抄错一个字母，引擎立刻会走出来不合法。',
      '#/chess/games', games + ' 局');
    html += entryCard('术语词典',
      '从「牵制」「闪击」到「吃过路兵」「逼和」，用人话讲，重点词配棋盘图，可直接搜索。',
      '#/chess/terms', terms + ' 条');
    html += entryCard('实战自测',
      '把你下过的一盘棋逐手点评；一张常见失误自查表；以及从战术题库里随机抽题考自己。不记进度、不排名。',
      '#/chess/selfcheck', '三个工具');
    html += entryCard('自由摆棋',
      '标准开局已经摆好，白先。点自己的棋子选中，再点目标点走子；走不了会告诉你为什么。可以悔棋、重开、翻转棋盘。',
      '#/chess/board', '动手工具');
    html += '</div>';

    html += '<h2>这一版有什么</h2>';
    html += '<div class="card"><ul style="margin:0;padding-left:20px">' +
      '<li><b>入门课</b>：' + lessons + ' 课 —— 认棋盘 → 棋子怎么走 → 三条特殊规则 → 将杀与逼和 → 开局三原则 → 把优势换成赢棋。</li>' +
      '<li><b>规则速查</b>：六种棋子各一张小盘，蓝点就是这枚棋子在这一格能走到的地方，全部由引擎现算。</li>' +
      '<li><b>战术题</b>：' + mates + ' 道（一步杀、两步杀），正解唯一、走完真的将杀，全部由引擎验证。</li>' +
      '<li><b>残局</b>：' + endgames + ' 种有确定结论的基本残局，每种都用引擎把着法走通过。</li>' +
      '<li><b>开局</b>：' + openings + ' 条手顺，逐手验算过合法性，附引擎给的判断。</li>' +
      '<li><b>名局</b>：' + games + ' 局，棋谱逐手验算过 —— 只要有一步不合法，引擎立刻会发现。</li>' +
      '<li><b>术语词典</b>：' + terms + ' 条，可搜索，重点词配棋盘图。</li>' +
      '<li><b>实战自测</b>：逐手点评（只讲规则层算得清的：白丢一个子、放掉一个杀着、王门被打开）+ ' +
      checks + ' 条常见失误自查表 + 随机抽题。不记进度、不排名。</li>' +
      '<li><b>自由摆棋</b>：标准开局摆好，在真棋盘上走子，每一步都过规则引擎，非法着法会给理由。</li>' +
      '</ul></div>';

    host.innerHTML = html;
  }

  /* ======================= 页面：规则 ======================= */

  /* 规则页的图解：把一枚棋子摆在一个位置上，用引擎算出它能走到哪，逐格标蓝点。
     这是**现场算的**，不是画的示意图 —— 示意图会画错，算出来的不会。
     RULE_FIGS 里每条对应一张小盘 + 一句说明文字。 */
  var RULE_FIGS = [
    { id: 'fig-P', type: 'P', at: [3, 4], name: '兵 Pawn', text: '往前走一格；**第一步**可以走两格；吃子只能斜着吃。走到底线必须升变。' },
    { id: 'fig-N', type: 'N', at: [3, 3], name: '马 Knight', text: '走「日」字（两格直 + 一格横）。**唯一能跳过其他棋子的棋子。**' },
    { id: 'fig-B', type: 'B', at: [3, 3], name: '象 Bishop', text: '斜着走任意格，不能拐弯、不能跳过子。**只能在一种颜色的格子上走。**' },
    { id: 'fig-R', type: 'R', at: [3, 3], name: '车 Rook', text: '直着走任意格，不能跳过子。**角落里最强、开局时最弱。**' },
    { id: 'fig-Q', type: 'Q', at: [3, 3], name: '后 Queen', text: '直走斜走都行，任意格 —— **棋盘上最强的棋子**（车 + 象）。' },
    { id: 'fig-K', type: 'K', at: [4, 4], name: '王 King', text: '四周一格。**它不能被吃**：任何让自己王会被吃的走法都不合法。' }
  ];

  function renderRules(host) {
    host.innerHTML =
      '<div class="lesson-head"><h1>规则</h1>' +
      '<p class="lede">下面每一张图都把棋子摆在一个位置上，<b>蓝点是用规则引擎现场算出来的</b> —— ' +
      '不是画的示意图。算出来的图不会画错，示意图会。</p></div>' +

      '<div class="card"><h3 style="margin-top:0">一、六种棋子怎么走</h3>' +
      '<div class="shogi-figrow" id="chess-figs">' +
      /* ★ 图必须在这里生成出来（只放个空容器页面就是空的 —— 踩过）。
         每张图 = 一个小盘 canvas + 一段说明。 */
      RULE_FIGS.map(function (f) {
        return '<figure class="shogi-figbox">' +
          '<div style="width:260px"><canvas id="' + f.id + '"></canvas></div>' +
          '<figcaption><b>' + esc(f.name) + '</b>　' + md(f.text) + '</figcaption></figure>';
      }).join('') +
      '</div></div>' +

      '<div class="card"><h3 style="margin-top:0">二、几条不那么显然的规则</h3>' +
      '<div class="explain-block"><span class="lbl">兵的第一步</span>' +
      '<p>每个兵<b>只有在自己起步的那一格</b>才能一次走两格（白兵在第二行、黑兵在第七行）。' +
      '走两格的时候，中间那一格必须空着。而且对手在下一手可以用「吃过路兵」把它吃掉。</p></div>' +

      '<div class="explain-block"><span class="lbl">吃过路兵</span>' +
      '<p>对方刚把一个兵从起步位置一口气走了两格、正好落在你兵的旁边时，' +
      '你可以用你的兵<b>斜着吃掉它</b>，落点是它「路过」的那一格。' +
      '这条规则<b>只在这一手有效</b>，过了就没了。</p></div>' +

      '<div class="explain-block"><span class="lbl">王车易位</span>' +
      '<p>王往车的方向走两格，车跳到王的另一边。一次走两个子，是<b>唯一一次同时动两个子</b>的走法。' +
      '三个条件缺一不可：① 王和车都没动过；② 王和车之间（长易位还包括最边上那格）都空着；' +
      '③ <b>王现在没被将、要经过的格子和落点都不能被对方攻击</b>。</p></div>' +

      '<div class="explain-block"><span class="lbl">升变</span>' +
      '<p>兵走到对方底线时，<b>必须变成</b>后、车、象、马中的一个（可以变成后，也可以变成别的）。' +
      '所以理论上你可以同时有几个后。</p></div>' +

      '<div class="explain-block"><span class="lbl">将杀 与 逼和</span>' +
      '<p><b>将杀</b>：王被将军，而且没有任何办法解开 —— 这就是赢。<br>' +
      '<b>逼和</b>：王没被将军，但轮到走的一方<b>一步也走不了</b> —— 这是<b>和棋</b>，' +
      '不是输。这是「优势方被拖平」最常见的方式。</p></div>' +

      '<div class="explain-block"><span class="lbl">子力价值</span>' +
      '<p>兵 1、马 3、象 3、车 5、后 9。这是个粗略的换算尺，' +
      '用处是<b>判断交换划不划算</b>（一车换三个兵要看局面，但一马换一车肯定是亏的）。' +
      '王不参与换算 —— 它不能被吃。</p></div>' +
      '</div>';

    mountFigs();
  }

  function mountFigs() {
    RULE_FIGS.forEach(function (f) {
      var c = $(f.id);
      if (!c) return;
      var bd = new CH.Board();
      var pieces = [[4, 0, 'b', 'K'], [4, 7, 'w', 'K'], [f.at[0], f.at[1], 'w', f.type]];
      bd.setup(pieces, 'w', '');
      var v = CB.mount(c, { size: 280, interactive: false });
      v.setPosition(viewPieces(bd));
      v.setSelection(bd.idx(f.at[0], f.at[1]));
      /* 提示点 = 引擎算出来的合法落点 */
      var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(f.at[0], f.at[1]); });
      var seen = {}, tos = [];
      ms.forEach(function (m) { if (!seen[m.to]) { seen[m.to] = 1; tos.push(m.to); } });
      v.setHints(tos);
    });
  }

  /* ======================= 页面：摆棋 ======================= */

  function renderBoard(host) {
    var bd = new CH.Board();
    bd.reset();
    var sel = -1, hints = [], promo = null, log = [];
    var flip = false;

    host.innerHTML =
      '<h1>摆棋</h1>' +
      '<p class="sub">点自己的棋子选中它（橙框），蓝点就是它能走的格子；再点目标格落子。' +
      '兵走到底线时会弹窗让你选升变成什么。可以悔棋、重开、翻转棋盘。</p>' +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div id="ch-holder" style="width:100%">' +
      '<canvas id="ch-canvas"></canvas></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="ch-undo">悔一步</button>' +
      '<button class="btn ghost sm" id="ch-reset">重新开始</button>' +
      '<button class="btn ghost sm" id="ch-flip">翻转棋盘</button>' +
      '<span class="pill wood" id="ch-turn">白方走</span>' +
      '</div></div>' +
      '<div class="prob-notes">' +
      '<div id="ch-promo" style="display:none"></div>' +
      '<div id="ch-status"></div>' +
      '<div class="explain-block"><span class="lbl">着法记录</span>' +
      '<div class="sc-moves" id="ch-log"><p class="small muted">还没有走棋。</p></div></div>' +
      '</div></div>';

    var view = CB.mount($('ch-canvas'), { onTap: onTap });

    function sync() {
      view.setPosition(viewPieces(bd));
      view.setSelection(sel);
      view.setHints(hints.map(function (m) { return m.to; }));
      if (bd.moves.length) {
        var r = bd.moves[bd.moves.length - 1];
        view.setLastMove(r.from, r.to);
      } else view.setLastMove(-1, -1);
      view.setCheck(bd.isChecked(bd.toMove) ? bd.findKing(bd.toMove) : -1);
      $('ch-turn').textContent = CH.colorName(bd.toMove) + '走';
      renderStatus();
    }

    function renderStatus() {
      var box = $('ch-status');
      if (!box) return;
      var foe = CH.other(bd.toMove);
      if (bd.isMate(bd.toMove)) {
        box.innerHTML = '<div class="feedback no"><div class="head">将杀！' + CH.colorName(foe) + '胜</div>' +
          '<p>轮到你走 —— 但你的王被将军，而且一步也解不开。点「重新开始」再来一盘。</p></div>';
      } else if (bd.isStalemate(bd.toMove)) {
        box.innerHTML = '<div class="feedback ok"><div class="head">逼和 —— 和棋</div>' +
          '<p>你的王没被将军，但一步也走不了。按规则这是<b>和棋</b>，不是输。</p></div>';
      } else if (bd.isChecked(bd.toMove)) {
        box.innerHTML = '<div class="feedback no"><div class="head">将军！</div>' +
          '<p>' + CH.colorName(bd.toMove) + '的王正在被将军，这一手必须解开（走王、吃子、或挡在中间）。</p></div>';
      } else {
        box.innerHTML = '<p class="small muted">轮到' + CH.colorName(bd.toMove) +
          '。开局三原则：占中心、出子、保王。</p>';
      }
    }

    function renderLog() {
      var box = $('ch-log');
      if (!box) return;
      if (!log.length) { box.innerHTML = '<p class="small muted">还没有走棋。</p>'; return; }
      var out = '', i;
      for (i = 0; i < log.length; i += 2) {
        var n = (i / 2 | 0) + 1;
        out += '<div class="sol-row"><span class="sol-n">' + n + '.</span>' +
          '<span class="sol-t">' + esc(log[i] || '') +
          (log[i + 1] ? '　' + esc(log[i + 1]) : '') + '</span></div>';
      }
      box.innerHTML = out;
    }

    /* 把一手走法写成记法（简版：起点-落点，吃子用 x，升变加 =X，易位写 O-O）。
       ★ 只用 r.rec 里的信息 —— 早先这里还读了一个 m 参数，而调用处传的是 null，
         结果每一次落子都抛「Cannot read properties of null」。 */
    function note(r) {
      var rec = r.rec;
      if (rec.castle) return rec.castle === 'K' ? 'O-O' : 'O-O-O';
      return CH.toLabelI(rec.from) + (rec.capI >= 0 || rec.epCapI >= 0 ? 'x' : '-') +
        CH.toLabelI(rec.to) + (rec.promo ? '=' + rec.promo : '');
    }

    function doMove(from, to, promote) {
      var r = bd.play(from, to, bd.toMove, promote || null, null);
      if (!r.ok) { flash('这一手不合法。'); return false; }
      log.push(note(r));
      sel = -1; hints = [];
      renderLog(); sync();
      return true;
    }

    function flash(msg) {
      var box = $('ch-status');
      if (box) box.innerHTML = '<div class="feedback no"><div class="head">走不了</div><p>' + esc(msg) + '</p></div>';
    }

    function onTap(i) {
      if (promo) return;
      if (bd.isMate(bd.toMove) || bd.isStalemate(bd.toMove)) return;
      if (sel < 0) {
        if (bd.g[i] !== bd.toMove) { flash('这一格不是你的棋子。先点' + CH.colorName(bd.toMove) + '的棋子。'); return; }
        sel = i;
        hints = bd.legalMoves(bd.toMove).filter(function (m) { return m.from === i; });
        sync();
        return;
      }
      if (i === sel) { sel = -1; hints = []; sync(); return; }
      if (bd.g[i] === bd.toMove) {
        sel = i;
        hints = bd.legalMoves(bd.toMove).filter(function (m) { return m.from === i; });
        sync();
        return;
      }
      var cands = hints.filter(function (m) { return m.to === i; });
      if (!cands.length) { flash('这枚棋子走不到那一格。'); return; }
      /* 升变有四种选择，让用户挑 */
      if (cands.length > 1 && cands[0].promo) { askPromo(sel, i); return; }
      doMove(sel, i, cands[0].promo);
    }

    function askPromo(from, to) {
      promo = { from: from, to: to };
      var box = $('ch-promo');
      box.style.display = '';
      box.innerHTML = '<div class="card"><h3 style="margin-top:0">选择升变</h3>' +
        '<p class="small muted">兵走到了底线，必须变成下面四种之一。</p>' +
        '<div class="row">' +
        ['Q', 'R', 'B', 'N'].map(function (t) {
          return '<button class="btn ghost sm" data-p="' + t + '">' + CH.pieceName(t, bd.toMove) + ' ' +
            '<span style="font-family:serif">' + CH.SAN[t] + '</span></button>';
        }).join('') +
        '</div></div>';
      box.querySelectorAll('button').forEach(function (b) {
        b.onclick = function () {
          var t = b.getAttribute('data-p');
          box.style.display = 'none';
          doMove(promo.from, promo.to, t);
          promo = null;
        };
      });
    }

    $('ch-undo').onclick = function () {
      var rec = bd.moves.pop();
      if (!rec) return;
      bd.undo(rec);
      log.pop();
      sel = -1; hints = [];
      renderLog(); sync();
    };
    $('ch-reset').onclick = function () {
      bd.reset(); log = []; sel = -1; hints = [];
      renderLog(); sync();
    };
    $('ch-flip').onclick = function () { flip = !flip; view.setFlip(flip); };

    sync();
  }

  /* ======================= 页面：词典 =======================
     版式与围棋词典（glossary-ui.js）对齐：
       列表 = 搜索框 + 按分类的卡片网格（名称 + 释义前三行 + 有无配图）
       详情 = 是什么 / 为什么要紧 / 怎么用 / 容易搞错 四段 + 棋盘图
              + 相关术语（可点）+ 上一条 / 下一条 */

  var TERM_CSS =
    '.ct-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px;}' +
    '@media(max-width:1000px){.ct-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}' +
    '@media(max-width:620px){.ct-grid{grid-template-columns:1fr;}}' +
    '.ct-card{text-align:left;border:1px solid var(--line,#e2ded4);background:var(--card,#fffdf8);' +
    'border-radius:12px;padding:13px 15px;cursor:pointer;display:block;width:100%;' +
    'font:inherit;color:inherit;transition:border-color .15s,transform .15s;}' +
    '.ct-card:hover{border-color:var(--accent,#8a6a3a);transform:translateY(-1px);}' +
    '.ct-card .n{font-weight:600;font-size:15px;margin-bottom:4px;}' +
    '.ct-card .n .en{font-weight:400;font-size:12px;opacity:.6;margin-left:6px;}' +
    '.ct-card .d{font-size:12.5px;line-height:1.6;opacity:.82;display:-webkit-box;' +
    '-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}' +
    '.ct-card .m{font-size:11.5px;opacity:.55;margin-top:7px;}' +
    '.ct-card .m .has-fig{color:var(--accent,#8a6a3a);opacity:1;}' +
    '.ct-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px;}';

  /* 释义去掉标记符号、截断，供卡片显示 */
  function plain(s, n) {
    var t = String(s || '').replace(/\*\*/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function renderTerms(host, key) {
    var list = data('CHESS_TERMS');
    if (!list.length) { host.innerHTML = '<div class="card"><p>词典数据没加载出来。</p></div>'; return; }

    if (key) return renderTermOne(host, decodeURIComponent(key), list);

    var figN = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].fig && list[i].fig.pieces) figN++;
    var cats = [];
    list.forEach(function (x) { if (cats.indexOf(x.cat) < 0) cats.push(x.cat); });

    var html = '<h1>词典</h1>' +
      '<p class="sub">国际象棋术语 <b>' + list.length + '</b> 条，按 <b>' + cats.length + '</b> 类铺开，' +
      '其中 <b>' + figN + '</b> 条配了棋盘图。每条都讲四件事：<b>是什么</b>、<b>为什么要紧</b>、' +
      '<b>怎么用</b>、<b>容易搞错哪一点</b>。点卡片进整页详解。</p>' +
      '<input class="search-box" id="ct-search" autocomplete="off" ' +
      'placeholder="搜术语、解释或用途…（例如：牵制、易位、叠兵）">';

    cats.forEach(function (cat) {
      var items = list.filter(function (x) { return x.cat === cat; });
      html += '<section class="ct-cat" data-cat="' + esc(cat) + '">' +
        '<h2 class="ct-row" style="margin-top:24px">' + esc(cat) +
        ' <span class="small muted" style="font-weight:400">' + items.length + ' 条</span></h2>' +
        '<div class="ct-grid">';
      items.forEach(function (x) {
        var text = (x.t + ' ' + (x.en || '') + ' ' + x.cat + ' ' + (x.d || '') + ' ' +
          (x.w || '') + ' ' + (x.u || '') + ' ' + (x.e || '')).toLowerCase();
        html += '<button class="ct-card" data-term="' + esc(x.t) + '" data-text="' + esc(text) + '">' +
          '<div class="n">' + esc(x.t) + (x.en ? '<span class="en">' + esc(x.en) + '</span>' : '') + '</div>' +
          '<div class="d">' + esc(plain(x.d, 46)) + '</div>' +
          '<div class="m">' + ((x.fig && x.fig.pieces) ? '<span class="has-fig">▦ 带棋盘图</span> · ' : '') +
          '看详解 →</div></button>';
      });
      html += '</div></section>';
    });
    html += '<div id="ct-empty" style="display:none" class="card"><p style="margin:0">' +
      '没有找到匹配的术语，换个说法试试（比如「王」「兵」「弃子」）。</p></div>';

    host.innerHTML = '<style>' + TERM_CSS + '</style>' + html;

    host.querySelectorAll('.ct-card').forEach(function (b) {
      b.onclick = function () { location.hash = '#/chess/terms/' + encodeURIComponent(b.getAttribute('data-term')); };
    });
    var search = $('ct-search');
    if (search) {
      search.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase();
        var anyHit = 0;
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
        var empty = $('ct-empty');
        if (empty) empty.style.display = anyHit ? 'none' : '';
      });
    }
  }

  /* 详情页 */
  function renderTermOne(host, name, list) {
    var t = null, idx = -1, i;
    for (i = 0; i < list.length; i++) if (list[i].t === name) { t = list[i]; idx = i; }
    if (!t) {
      host.innerHTML = '<div class="card"><p>词典里没有「' + esc(name) + '」。</p>' +
        '<button class="btn" onclick="location.hash=\'#/chess/terms\'">回词典</button></div>';
      return;
    }
    var figBox = '';
    if (t.fig && t.fig.pieces) {
      figBox = '<div class="card" style="margin-top:14px"><h3 style="margin-top:0">看个例子</h3>' +
        '<div style="max-width:420px"><canvas id="ch-term-fig"></canvas></div>' +
        (t.fig.cap ? '<p style="margin-top:10px">' + md(t.fig.cap) + '</p>' : '') + '</div>';
    }
    /* 相关术语：只在词典里真有这一条时才做成链接 —— 否则点了会落到「没这一条」 */
    var relBox = '';
    if (t.r && t.r.length) {
      var have = {}, links = '';
      list.forEach(function (y) { have[y.t] = 1; });
      t.r.forEach(function (n) {
        if (have[n]) links += '<button class="btn ghost sm" data-goto="' + esc(n) + '">' + esc(n) + '</button>';
        else links += '<span class="small muted">' + esc(n) + '（词典里还没有）</span>';
      });
      relBox = '<div class="card" style="margin-top:14px"><h3 style="margin-top:0">相关术语</h3>' +
        '<div class="row" style="flex-wrap:wrap">' + links + '</div></div>';
    }
    var prev = idx > 0 ? list[idx - 1] : null;
    var next = idx < list.length - 1 ? list[idx + 1] : null;

    host.innerHTML =
      '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/chess/terms">← 回词典</a></div>' +
      '<h1>' + esc(t.t) + (t.en ? ' <span class="small muted">' + esc(t.en) + '</span>' : '') + '</h1>' +
      '<p class="sub">' + esc(t.cat) + ' · 第 ' + (idx + 1) + ' / ' + list.length + ' 条</p>' +
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
        location.hash = '#/chess/terms/' + encodeURIComponent(b.getAttribute('data-goto'));
      };
    });
    if (t.fig && t.fig.pieces) {
      var c = $('ch-term-fig');
      if (c) {
        var bd = setup(t.fig.pieces, t.fig.toMove || 'w', t.fig.castling || '');
        var v = CB.mount(c, { size: 400, interactive: false });
        v.setPosition(viewPieces(bd));
        if (t.fig.marks) v.setHints(t.fig.marks.map(function (p) { return p[1] * 8 + p[0]; }));
      }
    }
  }

  /* ======================= 页面：入门课 ======================= */

  function renderLesson(host, id) {
    var list = data('CHESS_LESSONS');
    if (!list.length) { host.innerHTML = '<div class="card"><p>入门课数据没加载出来。</p></div>'; return; }
    if (id) {
      var L = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === id) L = list[i];
      if (!L) { host.innerHTML = '<div class="card"><p>没有这一课。</p></div>'; return; }
      /* 与围棋、象棋、将棋的课程详情页同一种版式：
         面包屑 → 标题 → 简介 → 正文小节（.sec）→ 上一课／下一课 */
      var idx = list.indexOf(L);
      var html = '<div class="lesson-head">' +
        '<div class="crumb"><a href="#/chess/lesson">入门课</a> ／ 第 ' + (idx + 1) +
        ' 课 · 共 ' + list.length + ' 课</div>' +
        '<h1>' + esc(L.title) + '</h1>' +
        '<p class="lede">' + esc(L.tldr) + '</p></div>';
      L.secs.forEach(function (s) {
        html += '<div class="sec"><h3>' + esc(s.h) + '</h3>';
        s.ps.forEach(function (p) { html += '<p>' + md(p) + '</p>'; });
        if (s.demo) {
          html += '<div style="max-width:380px;margin:12px 0"><canvas id="ch-les-fig"></canvas></div>';
        }
        html += '</div>';
      });
      /* 有演示局面的，画在第一处 */
      var demo = null;
      L.secs.forEach(function (s) { if (s.demo && !demo) demo = s.demo; });
      html += '<div class="lesson-nav">' +
        (idx > 0 ? '<button class="btn ghost" onclick="location.hash=\'#/chess/lesson/' + list[idx - 1].id + '\'">← 上一课</button>'
                 : '<span></span>') +
        (idx < list.length - 1 ? '<button class="btn" onclick="location.hash=\'#/chess/lesson/' + list[idx + 1].id + '\'">下一课 →</button>'
                               : '') +
        '</div>';
      host.innerHTML = html;
      if (demo) {
        var c = $('ch-les-fig');
        if (c) {
          var bd = setup(demo.pieces, demo.toMove || 'w', demo.castling || '');
          var v = CB.mount(c, { size: 360, interactive: false });
          v.setPosition(viewPieces(bd));
          if (demo.highlight) v.setHints(demo.highlight.map(function (p) { return p[1] * 8 + p[0]; }));
        }
      }
      return;
    }
    /* 与围棋、象棋、将棋的课程列表同一种版式：
       一行一课（序号 + 标题 + 一句话简介 + 箭头），整行可点。 */
    var h = '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/chess">国际象棋</a> · 入门课</div>' +
      '<h1>入门课</h1>' +
      '<p class="lede">一共 <b>' + list.length + '</b> 课，从认棋盘到第一盘棋：棋子怎么走、三条特殊规则、' +
      '将杀与逼和、开局三原则，以及怎么把优势变成赢棋。</p></div>';
    h += '<div class="lesson-list">';
    list.forEach(function (L, i) {
      h += '<button class="lesson-item" onclick="location.hash=\'#/chess/lesson/' + L.id + '\'">' +
        '<span class="idx">' + (i + 1) + '</span>' +
        '<span class="body"><span class="t">' + esc(L.title) + '</span>' +
        '<span class="d">' + esc(L.tldr) + '</span></span>' +
        '<span class="go">→</span></button>';
    });
    h += '</div>';
    host.innerHTML = h;
  }

  /* ======================= 页面：战术题 ======================= */

  function renderTactics(host, id) {
    var list = data('CHESS_MATES');
    if (!list.length) {
      host.innerHTML = '<div class="card"><p>战术题数据没加载出来。' +
        '（它由 tools/gen_chess_mates.js 用引擎生成 —— 跑一次生成器，再重新打包。）</p></div>';
      return;
    }
    if (id) return renderTacticsOne(host, id, list);

    var byN = {};
    list.forEach(function (q) { (byN[q.n] = byN[q.n] || []).push(q); });
    var html = '<h1>战术</h1><p class="sub">' + list.length + ' 道杀棋题，全部由引擎验证：' +
      '<b>正解唯一</b>（别的走法都杀不掉）、走完真的将杀。</p>';
    Object.keys(byN).sort().forEach(function (n) {
      html += '<div class="card"><h3 style="margin-top:0">' + n + ' 步杀（' + byN[n].length + ' 题）</h3>' +
        '<div class="row" style="flex-wrap:wrap">';
      byN[n].forEach(function (q) {
        html += '<button class="btn ghost sm" onclick="location.hash=\'#/chess/tactics/' + q.id + '\'">' +
          esc(q.id) + '</button>';
      });
      html += '</div></div>';
    });
    host.innerHTML = html;
  }

  function renderTacticsOne(host, id, list) {
    var q = null, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) q = list[i];
    if (!q) { host.innerHTML = '<div class="card"><p>没有这道题。</p></div>'; return; }

    var bd = setup(q.pieces, q.toMove, q.castling || '');
    var line = q.line.slice();          /* 主变（代数记法） */
    var ply = 0, sel = -1, hints = [], done = false, usedAnswer = false;
    var seen = null;

    host.innerHTML =
      '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/chess/tactics">← 回战术列表</a></div>' +
      '<h1>' + esc(q.id) + ' · ' + q.n + ' 步杀</h1>' +
      '<p class="sub">' + esc(q.ask) + '</p>' +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div style="width:100%"><canvas id="ch-t-canvas"></canvas></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn ghost sm" id="ch-t-undo">重来</button>' +
      '<button class="btn ghost sm" id="ch-t-hint">给我提示</button>' +
      '<button class="btn ghost sm" id="ch-t-show">看答案</button>' +
      '<span class="pill wood" id="ch-t-progress"></span>' +
      '</div></div>' +
      '<div class="prob-notes">' +
      '<div id="ch-t-status"></div>' +
      '<div id="ch-t-tip"></div>' +
      '<div class="explain-block"><span class="lbl">讲解</span>' +
      '<div class="sc-moves" id="ch-t-notes"><p class="small muted">走对了才会展开。</p></div></div>' +
      '</div></div>';

    var view = CB.mount($('ch-t-canvas'), { onTap: onTap });

    function sync() {
      view.setPosition(viewPieces(bd));
      view.setSelection(sel);
      view.setHints(hints.map(function (m) { return m.to; }));
      view.setCheck(bd.isChecked(bd.toMove) ? bd.findKing(bd.toMove) : -1);
      $('ch-t-progress').textContent = done ? '杀！' : ('第 ' + (ply + 1) + ' / ' + line.length + ' 步');
    }

    function status(html) { $('ch-t-status').innerHTML = html || ''; }

    /* 走完一步之后，如果轮到对方，自动走对方的应手 */
    function reply() {
      ply++;
      if (ply >= line.length) { finish(); return; }
      sync();
      setTimeout(function () {
        var m = parseMove(line[ply], bd);
        if (!m) { finish('（主变解析失败：' + line[ply] + '）'); return; }
        if (playMove(bd, m)) ply++;
        if (ply >= line.length) finish(); else sync();
      }, 320);
    }

    function finish(msg) {
      done = true; sync();
      status('<div class="feedback ' + (msg ? 'no' : 'ok') + '"><div class="head">' +
        (msg ? '出了点问题' : '将杀 —— 杀掉了') + '</div><p>' +
        (msg || '整条手顺走完了。') + '</p></div>');
      $('ch-t-notes').innerHTML = '<div class="sol-row"><span class="sol-n">手顺</span>' +
        '<span class="sol-t">' + esc(line.join(' ')) + '</span></div>' +
        (q.why ? '<div class="sol-row"><span class="sol-n">为什么</span><span class="sol-t">' + md(q.why) + '</span></div>' : '');
      if (q.onDone) q.onDone(usedAnswer);
    }

    function onTap(i) {
      if (done) return;
      if (sel < 0) {
        if (bd.g[i] !== bd.toMove) { status('<p class="small muted">先点自己的棋子。</p>'); return; }
        sel = i;
        hints = bd.legalMoves(bd.toMove).filter(function (m) { return m.from === i; });
        sync(); return;
      }
      if (i === sel) { sel = -1; hints = []; sync(); return; }
      var cands = hints.filter(function (m) { return m.to === i; });
      if (!cands.length) { status('<p class="small muted">这一格走不到。</p>'); return; }
      /* 对一下是不是正解 */
      var want = parseMove(line[ply], bd);
      var ok = want && want.to === i && (want.from === sel || (want.castle && cands[0].castle === want.castle));
      if (!ok) {
        status('<div class="feedback no"><div class="head">不是这一手</div>' +
          '<p>再想想 —— 这一手之后对方有办法逃掉。局面给你退回去了。</p></div>');
        sel = -1; hints = []; sync(); return;
      }
      var r = bd.play(sel, i, bd.toMove, cands[0].promo || null, null);
      if (!r.ok) { status('<p class="small muted">这一手不合法。</p>'); return; }
      sel = -1; hints = [];
      status('<div class="feedback ok"><div class="head">对</div><p>看对方怎么应。</p></div>');
      reply();
    }

    $('ch-t-undo').onclick = function () {
      bd = setup(q.pieces, q.toMove, q.castling || '');
      ply = 0; sel = -1; hints = []; done = false; usedAnswer = false;
      status(''); $('ch-t-tip').innerHTML = ''; $('ch-t-notes').innerHTML = '<p class="small muted">走对了才会展开。</p>';
      sync();
    };
    $('ch-t-hint').onclick = function () {
      var want = parseMove(line[ply], bd);
      $('ch-t-tip').innerHTML = want ? '<div class="card"><p>提示：这一手是从 <b>' +
        esc(CH.toLabelI(want.from)) + '</b> 出发的。</p></div>' : '';
    };
    $('ch-t-show').onclick = function () {
      usedAnswer = true;
      if (done) return;
      var m = parseMove(line[ply], bd);
      if (!m) return;
      var r = playMove(bd, m);
      if (!r) return;
      /* ★ 走完这一手必须把 ply 推上去。
         不推的话 step() 会再走一遍同一手 —— 而那时已经轮到对方，
         这一手走不动、ply 原地不动 → setTimeout 无限循环，页面直接卡死。
         （一步杀题必现，因为 step() 第一句就满足「已经走完」的条件。） */
      ply++;
      status('<div class="feedback ok"><div class="head">这是正解</div><p>下面是完整手顺。</p></div>');
      var guard = 0;
      var step = function () {
        if (ply >= line.length || ++guard > 40) { finish(); return; }
        var mm = parseMove(line[ply], bd);
        if (!mm || !playMove(bd, mm)) { finish('（主变第 ' + (ply + 1) + ' 手走不通：' + line[ply] + '）'); return; }
        ply++;
        sync();
        if (ply >= line.length) finish(); else setTimeout(step, 300);
      };
      if (ply >= line.length) finish(); else step();
    };

    sync();
  }

  /* ======================= 页面：残局 ======================= */

  function renderEndgame(host, id) {
    var list = data('CHESS_ENDGAME');
    if (!list.length) { host.innerHTML = '<div class="card"><p>残局数据没加载出来。</p></div>'; return; }
    if (id) {
      var E = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === id) E = list[i];
      if (!E) { host.innerHTML = '<div class="card"><p>没有这一条。</p></div>'; return; }
      host.innerHTML =
        '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/chess/endgame">← 回残局</a></div>' +
        '<h1>' + esc(E.title) + '</h1><p class="sub">' + esc(E.concl) + '</p>' +
        '<div class="prob-layout">' +
        '<div class="prob-board"><div style="width:100%"><canvas id="ch-e-canvas"></canvas></div>' +
        '<div class="row" style="margin-top:10px">' +
        '<button class="btn ghost sm" id="ch-e-prev">上一步</button>' +
        '<button class="btn ghost sm" id="ch-e-next">下一步</button>' +
        '<button class="btn ghost sm" id="ch-e-first">从头开始</button>' +
        '<span class="pill wood" id="ch-e-prog"></span>' +
        '</div></div>' +
        '<div class="prob-notes">' +
        '<div class="card"><div class="explain-block"><span class="lbl">为什么</span><p>' + md(E.why) + '</p></div></div>' +
        '<div class="explain-block"><span class="lbl">着法</span>' +
        '<div class="sc-moves" id="ch-e-notes"></div></div>' +
        '</div></div>';
      return bindEndgame(E);
    }
    var h = '<h1>残局</h1><p class="sub">' + list.length +
      ' 种有确定结论的基本残局 —— 每种都可以一手一手步进着看。' +
      '手顺全部由引擎走通过。</p>';
    list.forEach(function (E) {
      h += '<div class="card" style="cursor:pointer" onclick="location.hash=\'#/chess/endgame/' + E.id + '\'">' +
        '<h3 style="margin-top:0">' + esc(E.title) + '</h3>' +
        '<p class="small muted" style="margin:0">' + esc(E.concl) + '</p></div>';
    });
    host.innerHTML = h;
  }

  function bindEndgame(E) {
    var bd = setup(E.pieces, E.toMove || 'w', E.castling || '');
    var start = viewPieces(bd);
    var plies = [], cur = 0;
    /* 先把整条手顺走一遍并记下每一步，才能前后步进 */
    var r = walkLine(bd, E.line, function (i, r2) {
      plies.push({ rec: r2.rec, label: E.line[i], fen: viewPieces(bd) });
    });
    if (!r.ok) {
      $('ch-e-notes').innerHTML = '<p class="small muted">手顺有问题：' + esc(r.why) + '</p>';
    }
    var view = CB.mount($('ch-e-canvas'), { size: 420, interactive: false });

    function show(n) {
      cur = Math.max(0, Math.min(plies.length, n));
      if (cur === 0) view.setPosition(start);
      else view.setPosition(plies[cur - 1].fen);
      view.setSelection(-1);
      view.setLastMove(-1, -1);
      view.setCheck(bd.isChecked(CH.WHITE) ? -1 : -1);
      $('ch-e-prog').textContent = cur + ' / ' + plies.length;
      var html = '';
      for (var i = 0; i < plies.length; i++) {
        html += '<div class="sol-row" style="cursor:pointer' + (i + 1 === cur ? ';font-weight:600' : '') +
          '" data-n="' + (i + 1) + '"><span class="sol-n">' + (i + 1) + '.</span>' +
          '<span class="sol-t">' + esc(plies[i].label) + '</span></div>';
      }
      $('ch-e-notes').innerHTML = html;
      $('ch-e-notes').querySelectorAll('.sol-row').forEach(function (row) {
        row.onclick = function () { show(parseInt(row.getAttribute('data-n'), 10)); };
      });
    }
    $('ch-e-prev').onclick = function () { show(cur - 1); };
    $('ch-e-next').onclick = function () { show(cur + 1); };
    $('ch-e-first').onclick = function () { show(0); };
    show(0);
  }

  /* ======================= 页面：开局 ======================= */

  function renderOpening(host, id) {
    var list = data('CHESS_OPENINGS');
    if (!list.length) { host.innerHTML = '<div class="card"><p>开局数据没加载出来。</p></div>'; return; }
    if (id) {
      var O = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === id) O = list[i];
      if (!O) { host.innerHTML = '<div class="card"><p>没有这一条。</p></div>'; return; }
      host.innerHTML =
        '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/chess/opening">← 回开局</a></div>' +
        '<h1>' + esc(O.name) + '</h1><p class="sub">' + esc(O.tldr) + '</p>' +
        '<div class="prob-layout">' +
        '<div class="prob-board"><div style="width:100%"><canvas id="ch-o-canvas"></canvas></div>' +
        '<div class="row" style="margin-top:10px">' +
        '<button class="btn ghost sm" id="ch-o-prev">上一步</button>' +
        '<button class="btn ghost sm" id="ch-o-next">下一步</button>' +
        '<button class="btn ghost sm" id="ch-o-first">从头开始</button>' +
        '<span class="pill wood" id="ch-o-prog"></span>' +
        '</div></div>' +
        '<div class="prob-notes">' +
        '<div class="card"><div class="explain-block"><span class="lbl">思路</span><p>' + md(O.idea) + '</p></div></div>' +
        '<div class="explain-block"><span class="lbl">着法</span>' +
        '<div class="sc-moves" id="ch-o-notes"></div></div>' +
        '<div id="ch-o-hits"></div>' +
        '</div></div>';
      return bindOpening(O);
    }
    var h = '<h1>开局</h1><p class="sub">' + list.length +
      ' 条基本开局。手顺都<b>逐手验算过合法性</b>，每一步下面都标了落点的中文名字。' +
      '开局不是背的 —— 但先认识几条最常出现的，下起来会踏实很多。</p>';
    list.forEach(function (O) {
      h += '<div class="card" style="cursor:pointer" onclick="location.hash=\'#/chess/opening/' + O.id + '\'">' +
        '<h3 style="margin-top:0">' + esc(O.name) + '</h3>' +
        '<p class="small muted" style="margin:0">' + esc(O.tldr) + '</p></div>';
    });
    host.innerHTML = h;
  }

  function bindOpening(O) {
    var bd = setup(O.pieces || CH.START_POSITION, O.toMove || 'w', O.castling || 'KQkq');
    var start = viewPieces(bd);
    var plies = [];
    var r = walkLine(bd, O.line, function (i, r2) {
      plies.push({ label: O.line[i], fen: viewPieces(bd) });
    });
    var view = CB.mount($('ch-o-canvas'), { size: 420, interactive: false });

    function show(n) {
      var cur = Math.max(0, Math.min(plies.length, n));
      view.setPosition(cur === 0 ? start : plies[cur - 1].fen);
      $('ch-o-prog').textContent = cur + ' / ' + plies.length;
      var html = '';
      for (var i = 0; i < plies.length; i++) {
        html += '<div class="sol-row" style="cursor:pointer' + (i + 1 === cur ? ';font-weight:600' : '') +
          '" data-n="' + (i + 1) + '"><span class="sol-n">' + (i + 1) + '.</span>' +
          '<span class="sol-t">' + esc(plies[i].label) + '</span></div>';
      }
      $('ch-o-notes').innerHTML = html;
      $('ch-o-notes').querySelectorAll('.sol-row').forEach(function (row) {
        row.onclick = function () { show(parseInt(row.getAttribute('data-n'), 10)); };
      });
    }
    if (!r.ok) {
      $('ch-o-notes').innerHTML = '<p class="small muted">手顺有问题：' + esc(r.why) + '</p>';
      $('ch-o-hits').innerHTML = '<div class="card"><p class="small muted">这条手顺引擎走不通，已跳过。</p></div>';
    } else if (O.points && O.points.length) {
      $('ch-o-hits').innerHTML = '<div class="card"><h3 style="margin-top:0">这条开局想说什么</h3>' +
        '<ul class="sol-list" style="list-style:none;padding-left:0">' +
        O.points.map(function (p) { return '<li style="margin:6px 0">· ' + md(p) + '</li>'; }).join('') +
        '</ul></div>';
    }
    var n0 = 0;
    $('ch-o-prev').onclick = function () { show(n0 - 1); n0 = Math.max(0, n0 - 1); };
    $('ch-o-next').onclick = function () { show(n0 + 1); n0 = Math.min(plies.length, n0 + 1); };
    $('ch-o-first').onclick = function () { show(0); n0 = 0; };
    show(0);
  }

  /* ======================= 页面：名局 ======================= */

  function renderGames(host, id) {
    var list = data('CHESS_GAMES');
    if (!list.length) { host.innerHTML = '<div class="card"><p>名局数据没加载出来。</p></div>'; return; }
    if (id) {
      var G = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === id) G = list[i];
      if (!G) { host.innerHTML = '<div class="card"><p>没有这一局。</p></div>'; return; }
      host.innerHTML =
        '<div class="crumb small muted" style="margin-bottom:10px"><a href="#/chess/games">← 回名局</a></div>' +
        '<h1>' + esc(G.title) + '</h1><p class="sub">' + esc(G.date) + ' · ' + esc(G.event) + '</p>' +
        '<div class="card"><div class="explain-block"><span class="lbl">背景</span><p>' + md(G.bg) + '</p></div>' +
        '<div class="explain-block"><span class="lbl">结果</span><p>' + md(G.result) + '</p></div></div>' +
        '<div class="prob-layout">' +
        '<div class="prob-board"><div style="width:100%"><canvas id="ch-g-canvas"></canvas></div>' +
        '<div class="row" style="margin-top:10px">' +
        '<button class="btn ghost sm" id="ch-g-prev">上一步</button>' +
        '<button class="btn ghost sm" id="ch-g-next">下一步</button>' +
        '<button class="btn ghost sm" id="ch-g-first">从头开始</button>' +
        '<span class="pill wood" id="ch-g-prog"></span>' +
        '</div></div>' +
        '<div class="prob-notes">' +
        '<div class="explain-block"><span class="lbl">着法记录</span>' +
        '<div class="sc-moves" id="ch-g-notes"></div></div>' +
        '<div id="ch-g-key"></div>' +
        '</div></div>';
      return bindGame(G);
    }
    var h = '<h1>名局</h1><p class="sub">' + list.length +
      ' 局历史上的名局，可以一手一手回放。<b>手顺全部由引擎逐手验算</b> —— ' +
      '棋谱里只要有一个字母抄错，引擎立刻会出来说这一步不合法。</p>';
    list.forEach(function (G) {
      h += '<div class="card" style="cursor:pointer" onclick="location.hash=\'#/chess/games/' + G.id + '\'">' +
        '<h3 style="margin-top:0">' + esc(G.title) + '</h3>' +
        '<p class="small muted" style="margin:0">' + esc(G.date) + ' · ' + esc(G.event) + ' —— ' + esc(G.oneLine || '') + '</p></div>';
    });
    host.innerHTML = h;
  }

  function bindGame(G) {
    var bd = setup(G.pieces || CH.START_POSITION, G.toMove || 'w', G.castling || 'KQkq');
    var start = viewPieces(bd);
    var plies = [];
    var r = walkLine(bd, G.line, function (i, r2) {
      plies.push({ label: G.line[i], fen: viewPieces(bd) });
    });
    var view = CB.mount($('ch-g-canvas'), { size: 420, interactive: false });

    function show(n) {
      var cur = Math.max(0, Math.min(plies.length, n));
      view.setPosition(cur === 0 ? start : plies[cur - 1].fen);
      $('ch-g-prog').textContent = cur + ' / ' + plies.length;
      var html = '', i;
      for (i = 0; i < plies.length; i += 2) {
        var num = (i / 2 | 0) + 1;
        html += '<div class="sol-row" style="cursor:pointer' +
          (i + 1 === cur ? ';font-weight:600' : '') + '" data-n="' + (i + 1) + '">' +
          '<span class="sol-n">' + num + '.</span><span class="sol-t">' +
          esc(plies[i].label) + (plies[i + 1] ? '　' + esc(plies[i + 1].label) : '') + '</span></div>';
      }
      $('ch-g-notes').innerHTML = html;
      $('ch-g-notes').querySelectorAll('.sol-row').forEach(function (row) {
        row.onclick = function () { show(parseInt(row.getAttribute('data-n'), 10)); };
      });
    }
    if (!r.ok) {
      $('ch-g-notes').innerHTML = '<p class="small muted">手顺有问题：' + esc(r.why) + '</p>';
      $('ch-g-key').innerHTML = '<div class="card"><p class="small muted">这一局的手顺引擎走不通，已跳过。</p></div>';
    } else if (G.keys && G.keys.length) {
      $('ch-g-key').innerHTML = '<div class="card"><h3 style="margin-top:0">值得停下来看的地方</h3>' +
        G.keys.map(function (k) {
          return '<div class="sol-row" style="cursor:pointer" data-n="' + k.n + '">' +
            '<span class="sol-n">' + k.n + '.</span><span class="sol-t"><b>' + esc(k.label) + '</b> —— ' +
            esc(k.text) + '</span></div>';
        }).join('') + '</div>';
      $('ch-g-key').querySelectorAll('.sol-row').forEach(function (row) {
        row.onclick = function () { show(parseInt(row.getAttribute('data-n'), 10)); };
      });
    }
    var n0 = 0;
    $('ch-g-prev').onclick = function () { show(n0 - 1); n0 = Math.max(0, n0 - 1); };
    $('ch-g-next').onclick = function () { show(n0 + 1); n0 = Math.min(plies.length, n0 + 1); };
    $('ch-g-first').onclick = function () { show(0); n0 = 0; };
    show(0);
  }

  /* ======================= 页面：实战自测 =======================
     三件套，与围棋 / 象棋 / 将棋的自测一一对应：
       review    摆出你自己下过的一盘棋，逐手点评（点评只判规则层算得清的，
                 判据见 src/chess-review.js）
       checklist 常见失误自查表（数据在 src/chess-selfcheck.js）
       quiz      从战术题库随机抽题，独立走完才算过
     三样都不记进度、不排名，做完就清空。 */

  var SC_TABS = { review: '对局自评', checklist: '常见失误自查表', quiz: '随机测验' };

  function renderSelfCheck(host, tab) {
    if (!SC_TABS[tab]) tab = 'review';
    var html = '<h1>实战自测</h1>' +
      '<p class="sub">三样东西：下一盘看点评、照着一张表查毛病、抽题测验。' +
      '点评只讲<b>规则层算得清</b>的事 —— 白丢一个子、放掉一个杀着、王门被打开，' +
      '不猜「哪一手更好」。</p>' +
      '<div class="row" id="ch-sc-tabs" style="margin-bottom:16px">';
    Object.keys(SC_TABS).forEach(function (k) {
      html += '<button class="btn' + (tab === k ? '' : ' ghost') + ' sm" data-tab="' + k + '">' +
        SC_TABS[k] + '</button>';
    });
    html += '</div><div id="ch-sc-body"></div>';
    host.innerHTML = html;
    $('ch-sc-tabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (!b) return;
      location.hash = '#/chess/selfcheck/' + b.getAttribute('data-tab');
    });
    var body = $('ch-sc-body');
    if (tab === 'checklist') return renderChecklist(body);
    if (tab === 'quiz') return renderQuiz(body);
    return renderReviewGame(body);
  }

  /* ---------------- 一、对局自评 ---------------- */

  function renderReviewGame(host) {
    var RV = (typeof window !== 'undefined' ? window.ChessReview : null) ||
      (typeof globalThis !== 'undefined' ? globalThis.ChessReview : null);
    if (!RV) {
      host.innerHTML = '<div class="card"><p>点评引擎没加载出来（src/chess-review.js）。' +
        '打包时漏了脚本就会出现这个。</p></div>';
      return;
    }
    var my = 'w';                       /* 点评哪一方 —— 可以随时切换 */
    var bd = setup(CH.START_POSITION, 'w', 'KQkq');
    var sel = -1, hints = [], hist = [], entries = [], done = false;

    host.innerHTML =
      '<p class="sub">把你下过的一盘棋摆进来（<b>两边都你来走</b>），' +
      '右下角会逐手挑毛病。挑出来的每一条都对应「常见失误自查表」里的一个类别。</p>' +
      '<div class="row" style="margin-bottom:12px">' +
      '<span class="pill wood" id="ch-sc-side"></span>' +
      '<button class="btn ghost sm" id="ch-sc-flip">换一边点评</button>' +
      '<button class="btn ghost sm" id="ch-sc-undo">悔一步</button>' +
      '<button class="btn ghost sm" id="ch-sc-reset">重来</button>' +
      '</div>' +
      '<div class="prob-layout">' +
      '<div class="prob-board"><div style="width:100%"><canvas id="ch-sc-canvas"></canvas></div>' +
      '<div id="ch-sc-status" style="margin-top:10px"></div></div>' +
      '<div class="prob-notes">' +
      '<div class="explain-block"><span class="lbl">逐手点评</span>' +
      '<div class="sc-moves" id="ch-sc-notes"><p class="small muted">走一手，这里就会出点评。</p></div></div>' +
      '</div></div>';

    var view = CB.mount($('ch-sc-canvas'), { onTap: onTap });

    function sync() {
      view.setPosition(viewPieces(bd));
      view.setSelection(sel);
      view.setHints(hints.map(function (m) { return m.to; }));
      view.setCheck(bd.isChecked(bd.toMove) ? bd.findKing(bd.toMove) : -1);
      $('ch-sc-side').textContent = '正在点评：' + (my === 'w' ? '白方' : '黑方') + '的着法';
    }

    function renderNotes() {
      if (!entries.length) {
        $('ch-sc-notes').innerHTML = '<p class="small muted">走一手，这里就会出点评。</p>';
        return;
      }
      var h = '', i, j;
      for (i = entries.length - 1; i >= 0; i--) {          /* 最新的放最上面 */
        var e = entries[i];
        h += '<div class="sol-row"><span class="sol-n">' + e.no + '.</span>' +
          '<span class="sol-t"><b>' + esc(e.label) + '</b>';
        if (e.skipped) h += ' <span class="small muted">（' + (e.side === 'w' ? '白' : '黑') +
          '方的一手，未点评）</span>';
        else if (!e.items.length) h += ' <span class="small muted">（没什么问题）</span>';
        h += '</span></div>';
        for (j = 0; j < e.items.length; j++) {
          h += '<div class="sol-row" style="background:transparent"><span class="sol-n">' +
            (e.items[j].level === 'high' ? '⚠' : '·') + '</span><span class="sol-t">' +
            '<b>' + esc(e.items[j].kind) + '</b>：' + md(e.items[j].text) + '</span></div>';
        }
      }
      $('ch-sc-notes').innerHTML = h;
    }

    function status(html) { $('ch-sc-status').innerHTML = html || ''; }

    function onTap(i) {
      if (done) return;
      if (sel < 0) {
        if (bd.g[i] !== bd.toMove) { status('<p class="small muted">先点轮到走的那一方的子。</p>'); return; }
        sel = i;
        hints = bd.legalMoves(bd.toMove).filter(function (m) { return m.from === i; });
        sync(); return;
      }
      if (i === sel) { sel = -1; hints = []; sync(); return; }
      var cands = hints.filter(function (m) { return m.to === i; });
      if (!cands.length) { status('<p class="small muted">这一格走不到。</p>'); return; }
      /* 有升变就一律按升后处理（这里的目的是看点评，不是考升变选择） */
      var pick = cands.filter(function (m) { return m.promo === 'Q'; })[0] || cands[0];
      var mover = bd.toMove;                       /* 引擎颜色值（1/2） */
      var moverChar = CH.colorChar(mover);         /* 'w'/'b' —— 与 my 同一个域才能比 */
      var label = CH.toLabelI(sel) + '-' + CH.toLabelI(i) + (pick.promo ? '=' + pick.promo : '');
      /* ★ 点评必须在**走之前**问：reviewMove 要的是「走之前的局面」，
         它内部自己走一遍、算完再撤回来。 */
      var cmts = (moverChar === my) ? RV.reviewMove(bd, pick, mover) : [];
      var r = bd.play(sel, i, mover, pick.promo || null, pick.castle || null);
      if (!r.ok) { status('<p class="small muted">这一手不合法。</p>'); return; }
      hist.push({ rec: r.rec, entry: entries.length });
      sel = -1; hints = [];
      entries.push({ no: bd.moves.length, label: label, items: cmts,
        skipped: moverChar !== my, side: moverChar });
      renderNotes();
      sync();
      if (bd.isMate(CH.other(mover))) {
        done = true;
        status('<div class="feedback ok"><div class="head">将杀</div><p>' +
          (mover === 'w' ? '白方' : '黑方') + '把对方将死了。</p></div>');
      } else if (bd.isStalemate(CH.other(mover))) {
        done = true;
        status('<div class="feedback"><div class="head">逼和</div><p>对方没有合法着法但也没被将军 —— 和棋。</p></div>');
      } else {
        status('<p class="small muted">轮' + (bd.toMove === 'w' ? '白' : '黑') + '方走。</p>');
      }
    }

    $('ch-sc-flip').onclick = function () {
      /* ★ my 全程保持 'w'/'b' 字符串这一个域。
         别写成 `my = CH.other(my)` —— 那返回的是引擎颜色值（1/2），
         之后 `moverChar === my` 就永远不成立，开关会静默失效（踩过）。 */
      my = (my === 'w') ? 'b' : 'w';
      sync();
      status('<p class="small muted">从现在起只点评' + (my === 'w' ? '白' : '黑') + '方的着法（之前的点评不动）。</p>');
    };
    $('ch-sc-undo').onclick = function () {
      if (!hist.length) return;
      var h = hist.pop();
      bd.undo(h.rec);
      /* 被撤掉的这一手如果在 entries 里留了点评，也要一起拿掉 */
      if (h.entry < entries.length) entries.length = h.entry;
      done = false; sel = -1; hints = [];
      renderNotes(); sync(); status('<p class="small muted">退回来了一步。</p>');
    };
    $('ch-sc-reset').onclick = function () {
      bd = setup(CH.START_POSITION, 'w', 'KQkq');
      my = 'w';
      sel = -1; hints = []; hist = []; entries = []; done = false;
      renderNotes(); sync(); status('');
    };
    renderNotes(); sync();
  }

  /* ---------------- 二、常见失误自查表 ---------------- */

  function renderChecklist(host) {
    var list = data('CHESS_SELFCHECK');
    if (!list.length) {
      host.innerHTML = '<div class="card"><p>自查表没加载出来（src/chess-selfcheck.js）。</p></div>';
      return;
    }
    var KINDS = ['送子', '漏应', '漏杀', '王的安全', '孤子', '开局', '兵形'];
    var html = '<p class="sub">国际象棋里真会输棋的那些毛病，' + list.length +
      ' 条。每条都写清「怎么发现自己犯了」「为什么会这样」「下次怎么做」。' +
      '其中前五类与逐手点评引擎的判据一一对应 —— 点评说你犯了什么，就翻到对应那一类。</p>';
    KINDS.forEach(function (k) {
      var items = list.filter(function (c) { return c.kind === k; });
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

  /* ---------------- 三、随机测验 ----------------
     从战术题库里随机抽 5 道，复用战术题页面（renderTacticsOne）。
     计分口径：**没用「看答案」自己走完的题数** —— 说清楚，不假装是限时考试。 */

  function renderQuiz(host) {
    var all = data('CHESS_MATES');
    if (!all.length) {
      host.innerHTML = '<div class="card"><p>战术题库是空的，先跑 tools/gen_chess_mates.js。</p></div>';
      return;
    }
    var pool = all.slice(), i, j, t;
    for (i = pool.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    var queue = pool.slice(0, Math.min(5, pool.length));
    var idx = 0, ok = 0;

    function bar() {
      var d = document.createElement('div');
      d.className = 'crumb small muted';
      d.style.cssText = 'margin-bottom:10px;display:flex;gap:10px;align-items:center';
      d.innerHTML = '<span>第 ' + Math.min(idx + 1, queue.length) + ' / ' + queue.length +
        ' 题 · 独立做出 ' + ok + ' 题</span>';
      var quit = document.createElement('button');
      quit.className = 'btn ghost sm';
      quit.textContent = '重新抽题';
      quit.onclick = function () { renderQuiz(host); };
      d.appendChild(quit);
      host.insertBefore(d, host.firstChild);
    }

    function step() {
      if (idx >= queue.length) {
        host.innerHTML = '<h1>做完了</h1><div class="card"><p>' + queue.length + ' 道题里，' +
          '<b>独立做出 ' + ok + ' 道</b>（没点「看答案」就算独立做出）。</p>' +
          '<p class="small muted">做错的题不记分 —— 这个工具不上报、不排名，' +
          '只用来告诉你现在卡在哪一类杀法上。</p>' +
          '<div class="row" style="margin-top:12px">' +
          '<button class="btn" id="ch-qz-again">再来五道</button>' +
          '<button class="btn ghost" onclick="location.hash=\'#/chess/tactics\'">去战术题库</button>' +
          '</div></div>';
        $('ch-qz-again').onclick = function () { renderQuiz(host); };
        return;
      }
      var q = {};
      for (var k in queue[idx]) if (Object.prototype.hasOwnProperty.call(queue[idx], k)) q[k] = queue[idx][k];
      q.onDone = function (usedAnswer) {
        if (!usedAnswer) ok++;
        idx++;
        var b = document.createElement('button');
        b.className = 'btn';
        b.style.marginTop = '12px';
        b.textContent = (idx >= queue.length ? '看结果' : '下一题');
        b.onclick = function () { step(); };
        host.appendChild(b);
        var head = host.querySelector('.crumb');
        if (head) head.firstChild.textContent = '第 ' + Math.min(idx + 1, queue.length) + ' / ' +
          queue.length + ' 题 · 独立做出 ' + ok + ' 题';
      };
      renderTacticsOne(host, q.id, [q]);
      bar();
    }
    step();
  }

  /* ======================= 路由 ======================= */

  function render(seg, host) {
    var sub = seg[1] || '';
    var arg = seg[2] ? decodeURIComponent(seg[2]) : '';
    if (sub === '') return renderHome(host);
    if (sub === 'rules') return renderRules(host);
    if (sub === 'board') return renderBoard(host);
    if (sub === 'terms') return renderTerms(host, arg);
    if (sub === 'lesson') return renderLesson(host, arg);
    if (sub === 'tactics') return renderTactics(host, arg);
    if (sub === 'endgame') return renderEndgame(host, arg);
    if (sub === 'opening') return renderOpening(host, arg);
    if (sub === 'games') return renderGames(host, arg);
    if (sub === 'selfcheck') return renderSelfCheck(host, arg);
    return renderSoon(sub, host);
  }

  function renderSoon(sub, host) {
    host.innerHTML = '<h1>还没开工</h1>' +
      '<div class="card"><p><b>国际象棋 · ' + esc(sub) + '</b> 这一页还没做。</p>' +
      '<p class="small muted">已经能用的是：首页 · 入门 · 战术 · 残局 · 开局 · 名局 · 词典 · 摆棋 · 规则 · 实战自测。</p></div>';
  }

  return { render: render };
})();

if (typeof window !== 'undefined') window.ChessApp = ChessApp;
if (typeof module !== 'undefined' && module.exports) module.exports = ChessApp;
