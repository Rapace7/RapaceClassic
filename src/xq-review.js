/* 逐手点评引擎 —— 给一盘象棋棋谱的**每一手**做客观点评
 *
 * 为什么要单独写它：
 *   「对局自评」在围棋那边靠的是纯规则（打吃 / 漏应 / 填眼…）。象棋这边判据更硬 ——
 *   下面这些问题全部能用规则引擎 + 残局求解器算出来，**不需要任何 AI 判断**：
 *
 *     送子        这一手走完，对方有一步能吃你的子、净赚 ≥ 阈值（这手新造成的损失）
 *     漏应        走棋前你已经有子被白吃，这一手却没处理（老账没还）
 *     错过杀棋    走棋前你有杀（一步杀 / 求解器判胜），走完这个杀没了
 *     放对方成杀  这一手走完，对方有 ≤N 步杀
 *     兑子亏      这一手本身就是一次亏本交换（净损失 ≥ 阈值）
 *     开局毛病    开局阶段反复走同一个子 / 大子迟迟不出
 *
 * 两条纪律：
 *   1) 判据全部可复算 —— 每一条结论都能由 xq-engine.js 的规则事实推出（净赚多少、
 *      是哪一步能吃、有没有杀）。不凭感觉说「这手不好」。
 *   2) 算不出来的一律留空，**不许编**：替代着法（better）只写引擎真算出来的点；
 *      杀棋深查超预算就如实标注「没算完」，绝不把「没算完」说成「没问题」。
 *
 * 子力价值沿用 xq-solver.js 的那一套：车 900 / 炮 450 / 马 400 / 仕相 200 / 兵 100。
 *
 * ── 两种运行环境 ─────────────────────────────────────────────
 *   Node（命令行 / 工具）：
 *       var XQReview = require('./xq-review.js');
 *       XQReview.reviewGame(moves, opts)      // moves = [{from:[x,y],to:[x,y]}, ...]，红先
 *     这条路上**接上了 xq-solver.js**，「有没有杀」判到 ≤N 步（N 默认 3）。
 *   浏览器（对局自评页面）：
 *       &lt;script src="xq-review.js"&gt;   →  window.XQReview
 *     浏览器里没有求解器（xq-solver.js 是 Node 工具，要 require/fs），所以杀棋只判到
 *     **一步杀**；六类判据里其余五类不受影响。页面会如实写明这一点，不假装算过。
 *
 * ── 输出格式 ────────────────────────────────────────────────
 *   reviewGame / session.push 产出的每一条：
 *     { n, side, level, tone, kind, move, why, better, marks }
 *       n      第几手（从 1 起）
 *       side   '红' | '黑'
 *       level  '严重' | '注意' | '提示'      —— 问题有多要紧
 *       tone   'bad' | 'info' | 'good' | 'dull'  —— 界面按它上色（bad=问题，dull=正常）
 *       kind   送子 / 漏应 / 错过杀棋 / 放对方成杀 / 兑子亏 / 开局毛病 / 非法着法
 *              / 将死 / 得子 / 将军 / 正常
 *       move   'H3-E3'（引擎的点名法，与 XQ.toLabel 一致）
 *       why    人话讲清「哪一手、什么毛病、为什么」
 *       better 引擎算出来的替代点；算不出来就是 ''（不许编）
 *       marks  [起点下标, 终点下标] —— 给界面画提示用的「对方将怎么吃你 / 正解在哪」
 *
 *   一手最多给一条「子力」点评（兑子亏 / 送子 / 漏应 三选一）—— 它们说的是同一件事，
 *   同时报三条只会把话说糊。杀棋类（放对方成杀 / 错过杀棋）可以再叠一条。
 *
 * ── 命令行的用法 ─────────────────────────────────────────────
 *   node src/xq-review.js                  点评内置样例整盘
 *   node src/xq-review.js game:xq-g09      点评内置名局（xq-games-*.js 里的 9 局）
 *   node src/xq-review.js 棋谱.json        点评外部棋谱（[{from:[x,y],to:[x,y]},...]）
 *   node src/xq-review.js 棋谱.txt         每行一手，写成 'H3-E3' 或 'H3 E3'
 *   node src/xq-review.js -v               连「这一手正常」也打出来
 *   node src/xq-review.js -t               跑自检（故意犯错，断言能被抓出来）
 */
'use strict';

(function (global) {
  'use strict';

  /* 棋子中文名（与 xq-board.js 的画字一致） */
  var TYPE_CN = { K: '帅/将', A: '仕/士', B: '相/象', N: '马', R: '车', C: '炮', P: '兵/卒' };
  /* 「大子」—— 开局迟迟不出指的就是这三样 */
  var BIG = { R: 1, N: 1, C: 1 };

  var DEFAULT = {
    seeDepth: 2,          /* 交换评估深度：1 = 只看一步反吃；2 = 吃 / 反吃 / 再吃 */
    minGain: 100,         /* 「对方能净赚多少」的门槛：不足一个兵（100）就不算问题 */
    seeMin: 50,           /* 「兑子亏」的门槛单独放低到半个兵：开局炮换马恰好亏 50
                             （炮 450 换马 400，对方车再吃回炮）——按 100 算会把这种
                             典型劣招说成「正常」，用户一眼就看出不对。 */
    threatMin: 200,       /* 「漏应」只报仕/相（200）以上的子被白吃 —— 丢个兵不算漏应 */
    mateDepth: 3,         /* 杀棋深度（半回合）；1 = 只判一步杀（浏览器上限） */
    mateNodeLimit: 40000, /* 单次求解器的节点上限 */
    mateBudgetMs: 6000,   /* 全盘用于杀棋深查的时间预算，用完就如实标注 */
    betterBudgetMs: 3000, /* 全盘用于算「替代着法」的时间预算 */
    openingPlies: 20,     /* 开局阶段：两边各 10 手 */
    repeatLimit: 3,       /* 开局里同一个子走满几手算「反复走同一个子」 */
    maxMoves: 400,        /* 最多点评多少手（防止一份坏棋谱卡死） */
    seeNodeLimit: 200000  /* 交换评估的总节点上限（防御性） */
  };

  var REASON_CN = {
    nopiece: '这个位置上没有该走的棋子',
    shape: '这个棋子不能这样走',
    'self-check': '走完自己的将/帅会被将军（送将，或者没应将）',
    'capture-king': '不能吃将/帅 —— 棋局只能以将死结束',
    same: '原地不动不算走子',
    out: '点到棋盘外面了',
    'bad-args': '这一手的起点或终点没写全'
  };

  function makeAPI(XQ, solver) {
    var RED = XQ.RED, BLACK = XQ.BLACK, EMPTY = XQ.EMPTY;
    var VALUE = { K: 0, A: 200, B: 200, N: 400, R: 900, C: 450, P: 100 };
    var HAS_SOLVER = !!solver && typeof solver.search === 'function';

    /* START_INFO[下标] = { color, type } —— 用来认「哪个 id 是开局没动过的大子」 */
    var START_INFO = {};
    (function () {
      var sp = XQ.START_POSITION || [];
      for (var i = 0; i < sp.length; i++) {
        var q = sp[i][1] * XQ.COLS + sp[i][0];
        START_INFO[q] = { color: sp[i][2] === 'r' ? RED : BLACK, type: String(sp[i][3]).toUpperCase() };
      }
    })();

    function other(c) { return c === RED ? BLACK : RED; }
    function sideName(c) { return c === RED ? '红' : '黑'; }
    function vn(t) { return VALUE[t] || 0; }
    function cn(t) { return TYPE_CN[t] || '子'; }
    function mvLabel(from, to) { return XQ.toLabel(from) + '-' + XQ.toLabel(to); }

    function merge(dst, src) {
      var k;
      for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k];
      return dst;
    }

    /* ══════════════════════════════════════════════════════════
     * 一、子力：交叉点交换评估（SEE）
     * ══════════════════════════════════════════════════════════ */

    /* 某个点上，color 方有哪些子能吃到它（用统一的 movesFrom 推，不开特例） */
    function attackersOf(bd, to, color) {
      var out = [], i, j, ms;
      for (i = 0; i < bd.n; i++) {
        if (bd.g[i] !== color) continue;
        ms = bd.movesFrom(i);
        for (j = 0; j < ms.length; j++) if (ms[j] === to) { out.push(i); break; }
      }
      /* 便宜的子先上（搜索顺序而已，不改结果） */
      out.sort(function (a, b) { return vn(bd.t[a]) - vn(bd.t[b]); });
      return out;
    }

    /* 现在走 from→to 吃这个子，**净价值**是多少（不是「吃到多少」，是「赚到多少」）。
     *   净价值 = 吃到的子价值 − 对方反吃回来的最好结果（对方也可以选择不吃）
     * depth = 还允许反吃几层。返回 null 表示这一步根本不合法。
     * 这是「白送 / 亏换」的硬判据：净价值 > 0 才叫赚。 */
    function see(bd, from, to, color, depth, st) {
      var vt = bd.t[to];
      if (!vt || vt === 'K') return null;
      var victim = vn(vt);
      var r = bd.play(from, to, color);
      if (!r.ok) return null;
      var oppBest = 0;
      if (depth > 0 && st.nodes < st.nodeLimit) {
        st.nodes++;
        var atk = attackersOf(bd, to, other(color));
        for (var i = 0; i < atk.length; i++) {
          var v = see(bd, atk[i], to, other(color), depth - 1, st);
          if (v !== null && v > oppBest) oppBest = v;
        }
      }
      bd.undo(r.rec);
      return victim - oppBest;
    }

    /* color 方现在最多能白赚多少（含「什么都不赚」，所以最低是 0）。
     * 返回 { gain, move:{from,to,capType} } —— move 就是那一步「怎么赚的」。 */
    function gainFor(bd, color, cfg, st) {
      var best = 0, bestMv = null, i, j, ms, to, vt, v;
      for (i = 0; i < bd.n; i++) {
        if (bd.g[i] !== color) continue;
        ms = bd.movesFrom(i);
        for (j = 0; j < ms.length; j++) {
          to = ms[j];
          vt = bd.t[to];
          if (!vt || vt === 'K') continue;
          /* 吃到的子还不如现在已经赚到的多 ⇒ 这一手不可能更好 */
          if (vn(vt) <= best) continue;
          v = see(bd, i, to, color, cfg.seeDepth, st);
          if (v !== null && v > best) { best = v; bestMv = { from: i, to: to, capType: vt }; }
        }
      }
      return { gain: best, move: bestMv };
    }

    /* ══════════════════════════════════════════════════════════
     * 二、杀棋：一步杀扫描 + （有求解器时）≤N 步杀
     * ══════════════════════════════════════════════════════════ */

    /* 扫 color 方的全部合法着法：
     *   mates  —— 走完直接把对方将死（或困毙）的着法
     *   checks —— 走完能将军的着法条数（用来决定值不值得深查）
     * 只用引擎规则，不依赖求解器 —— 所以浏览器里也能跑。 */
    function mateScan(bd, color) {
      var mates = [], checks = 0, i, j, ms, to, r, opp = other(color);
      for (i = 0; i < bd.n; i++) {
        if (bd.g[i] !== color) continue;
        ms = bd.movesFrom(i);
        for (j = 0; j < ms.length; j++) {
          to = ms[j];
          if (bd.t[to] === 'K') continue;           /* 不允许吃将 */
          r = bd.play(i, to, color);
          if (!r.ok) continue;
          if (bd.isChecked(opp)) {
            checks++;
            if (bd.isMate(opp)) mates.push({ from: i, to: to, cap: r.captured.length > 0 });
          }
          bd.undo(r.rec);
        }
      }
      return { mates: mates, checks: checks };
    }

    /* 只回答「color 走，能不能在 maxDepth 个半回合内强制取胜」。算不完/超预算返回 null。 */
    function trySearch(bd, color, maxDepth, cfg) {
      if (!HAS_SOLVER) return null;
      try {
        var r = solver.search(bd, {
          side: color, want: 'win', maxDepth: maxDepth, nodeLimit: cfg.mateNodeLimit
        });
        if (r.result === 'unknown') return null;
        return r;
      } catch (e) {
        return null;              /* 非法局面（上一手没应将之类）——不猜，直接放弃 */
      }
    }

    /* 局面已经走成「轮到 opp 走」了，问：opp 还有活路吗？
     *   true  —— 找到一条活路（杀不成了）
     *   false —— 所有应手都会被将死（杀还在）
     *   null  —— 预算用完 / 没有求解器，算不出来（**不猜**）
     * 只在「走之前确实有杀」的时候才会调用，所以不算热路径。 */
    function oppHasEscape(bd, me, depth, cfg, budget) {
      var opp = other(me);
      if (bd.isMate(opp)) return false;
      if (depth <= 0) return true;
      if (!budget.ok()) return null;
      var list = bd.legalMoves(opp), i, r, sub, stillWin;
      for (i = 0; i < list.length; i++) {
        if (!budget.ok()) return null;
        r = bd.play(list[i].from, list[i].to, opp);
        if (!r.ok) continue;
        if (bd.isMate(me)) stillWin = false;              /* 反被将死 → 这条活路成立 */
        else {
          sub = trySearch(bd, me, depth - 1, cfg);
          if (sub === null) { bd.undo(r.rec); return null; }
          stillWin = (sub.result === 'win');
        }
        bd.undo(r.rec);
        if (!stillWin) return true;
      }
      return false;
    }

    /* ══════════════════════════════════════════════════════════
     * 三、替代着法：按「子力 + 一步杀」算一手更稳的
     * ══════════════════════════════════════════════════════════
     * 纪律：这只是一个**一层子力搜索**，不是什么棋力分析。它只会说
     *   「走这一手，对方赚不到便宜（或赚得更少），而且不会立刻被将死」——
     *   这正是子力判据里的事实，不越界去评论大局。 */

    function scoreMove(bd, mv, color, cfg, st) {
      var opp = other(color);
      var own = 0;
      if (bd.t[mv.to] && bd.t[mv.to] !== 'K') {
        own = see(bd, mv.from, mv.to, color, cfg.seeDepth, st);
        if (own === null) return null;
      }
      var r = bd.play(mv.from, mv.to, color);
      if (!r.ok) return null;
      var score, oppGain = 0, oppMate = false;
      if (bd.isMate(opp)) score = 100000;                      /* 直接杀了，最好 */
      else {
        oppGain = gainFor(bd, opp, cfg, st).gain;
        score = own - oppGain;
      }
      bd.undo(r.rec);
      return { score: score, own: own, oppGain: oppGain, oppMate: oppMate };
    }

    /* 给一手「出了问题」的棋找替代点。返回 { move:'A1-A2', why:'…' } 或 null。 */
    function suggestBetter(bd, color, played, cfg, budget, st) {
      if (!budget.ok()) return null;
      var list = bd.legalMoves(color), i, cands = [], s, mv;
      for (i = 0; i < list.length; i++) {
        mv = list[i];
        if (mv.from === played.from && mv.to === played.to) continue;
        s = scoreMove(bd, mv, color, cfg, st);
        if (s === null) continue;
        cands.push({ from: mv.from, to: mv.to, score: s.score, oppGain: s.oppGain });
        if (!budget.ok()) break;
      }
      if (!cands.length) return null;
      var playedScore = scoreMove(bd, { from: played.from, to: played.to }, color, cfg, st);
      if (!playedScore) return null;
      cands.sort(function (a, b) { return b.score - a.score; });

      /* 前面几名还要过一遍「一步杀」——子力不亏但白送一步杀，不能推荐 */
      var top = cands.slice(0, 8), picked = null;
      for (i = 0; i < top.length; i++) {
        if (!budget.ok()) break;
        var r = bd.play(top[i].from, top[i].to, color);
        if (!r.ok) continue;
        var bad = mateScan(bd, other(color)).mates.length > 0;
        bd.undo(r.rec);
        if (!bad) { picked = top[i]; break; }
      }
      if (!picked) return null;
      var gain = picked.score - playedScore.score;
      if (gain < cfg.minGain) return null;               /* 好不了多少就不推荐了，别硬凑 */
      var txt = mvLabel(picked.from, picked.to);
      var why;
      if (playedScore.oppGain >= cfg.minGain && picked.oppGain < cfg.minGain) {
        why = '走 ' + txt + ' 之后，对方就赚不到了（按子力算，比这一手少亏 ' + gain + ' 分）';
      } else if (playedScore.score < 0 && picked.score >= 0) {
        why = '按子力算，走 ' + txt + ' 不亏（这一手亏了 ' + (-playedScore.score) + ' 分）';
      } else {
        why = '按子力算，走 ' + txt + ' 比这一手好 ' + gain + ' 分（一层交换，不看后手）';
      }
      return { move: txt, why: why, from: picked.from, to: picked.to };
    }

    /* ══════════════════════════════════════════════════════════
     * 四、逐手点评：会话（页面可以一手一手地推）
     * ══════════════════════════════════════════════════════════ */

    function createSession(opts) {
      var cfg = merge(merge({}, DEFAULT), opts || {});
      var bd = new XQ.Board();
      var standard = !cfg.setup;
      if (standard) bd.reset(); else bd.setup(cfg.setup);
      var firstColor = cfg.first === 'b' ? BLACK : RED;
      bd.toMove = firstColor;

      var st = { nodes: 0, nodeLimit: cfg.seeNodeLimit };
      var mateBudget = { t0: Date.now(), ms: cfg.mateBudgetMs, spent: 0 };
      var betterBudget = { t0: Date.now(), ms: cfg.betterBudgetMs, spent: 0 };
      mateBudget.ok = function () { return (Date.now() - this.t0) < this.ms; };
      betterBudget.ok = function () { return (Date.now() - this.t0) < this.ms; };

      var entries = [];
      var plays = [];          /* 记下的每一手（含引擎 rec），供 undo */
      var ids = {}, idStart = {}, movedCount = {}, capturedIds = {};
      var repeatReported = {};
      var oldThreatReported = {};   /* 已经「提过一次」的老账（键 = 威胁方起点>被威胁点） */
      var finished = false;

      function initIds() {
        var i, id;
        for (i = 0; i < bd.n; i++) {
          if (bd.g[i] === EMPTY) continue;
          id = (bd.g[i] === RED ? 'r' : 'b') + bd.t[i] + i;
          ids[i] = id;
          idStart[id] = i;
          movedCount[id] = 0;
        }
      }
      function trackMove(fromI, toI) {
        var id = ids[fromI];
        delete ids[fromI];
        if (ids[toI] !== undefined) { capturedIds[ids[toI]] = 1; delete ids[toI]; }
        if (id === undefined) id = 'x' + fromI + '_' + toI;      /* 认不出的子：当新子，不影响判据 */
        ids[toI] = id;
        if (idStart[id] === undefined) idStart[id] = fromI;
        movedCount[id] = (movedCount[id] || 0) + 1;
        return id;
      }
      if (standard) initIds();

      function plyNo() { return plays.length + 1; }

      /* ---- 一手棋的全部判据 ---- */
      function push(move) {
        if (finished) return { ok: false, reason: 'ended', findings: [] };
        if (!move || !move.from || !move.to) return { ok: false, reason: 'bad-args', findings: [] };
        var color = bd.toMove, opp = other(color);
        var n = plyNo();
        var fromI = bd.idx(move.from[0], move.from[1]);
        var toI = bd.idx(move.to[0], move.to[1]);
        var label = mvLabel(fromI, toI);
        var findings = [];

        function add(o) {
          o.n = n; o.side = sideName(color); o.move = label;
          if (o.tone === undefined) o.tone = 'bad';
          if (o.marks === undefined) o.marks = null;
          findings.push(o);
        }

        /* ---------- 走之前：先把「走之前的事实」记下来 ---------- */
        var preScan = mateScan(bd, color);                 /* 我有一步杀吗 / 有将军着吗 */
        var preGain = gainFor(bd, opp, cfg, st);           /* 对方现在最多能白赚多少 */
        /* 「这笔账」的人话版本 —— 必须在走子之前取，走完子摆的位置就变了 */
        var preGainDesc = preGain.move
          ? (sideName(opp) + '方的' + cn(bd.t[preGain.move.from]) + '（' + XQ.toLabel(preGain.move.from) +
             '）能吃你的' + cn(bd.t[preGain.move.to]) + '（' + XQ.toLabel(preGain.move.to) + '）')
          : null;
        /* 上一手时，现在走棋的这一方最多能白赚多少 —— 用来判「对方这个威胁是不是刚出现的」。
           对方刚威胁上（比如上一手马踩上来）和你这个子已经暴露了二十手，是两件事：
           前者是你这一手该管的账，后者只能提一次（你可能有更大的算路，硬管反而亏）。
           记的是**走子之前**的赚头：轮到对方走时的局面，正好就是「对方上一手之前的局面」。 */
        var prevOwnGain = plays.length ? plays[plays.length - 1].ownGain : -1;
        var ownGainBefore = gainFor(bd, color, cfg, st);
        var playedSee = null;
        if (bd.t[toI] && bd.t[toI] !== 'K' && bd.g[fromI] === color) {
          playedSee = see(bd, fromI, toI, color, cfg.seeDepth, st);
        }
        var preWin = null;
        if (!preScan.mates.length && preScan.checks > 0 && cfg.mateDepth >= 3 && mateBudget.ok()) {
          var s = trySearch(bd, color, cfg.mateDepth, cfg);
          if (s && s.result === 'win') preWin = s;
        }

        /* ---------- 真走这一手（非法就到此为止） ---------- */
        var r = bd.play(fromI, toI, color);
        if (!r.ok) {
          var whyIllegal = (REASON_CN[r.reason] || '这一手不合法') + '（引擎判定：' + r.reason + '）。';
          add({ level: '严重', kind: '非法着法', why: label + ' 走不出来：' + whyIllegal +
            (r.reason === 'self-check' ? '象棋里被将军必须应将，这一步没有应上。' : ''),
            better: '' });
          return { ok: false, reason: r.reason, findings: findings };
        }

        var pieceType = r.rec.type;
        var id = null;
        if (standard && n <= cfg.openingPlies) id = trackMove(fromI, toI);

        /* ---------- 走之后的事实 ---------- */
        var postGain = gainFor(bd, opp, cfg, st);
        var oppScan = mateScan(bd, opp);
        var mated = bd.isMate(opp);

        /* ---------- 判据一：这一手就把对方将死了（正面） ---------- */
        if (mated) {
          add({
            level: '提示', tone: 'good', kind: '将死',
            why: label + ' 把' + sideName(opp) + '方' + (bd.isChecked(opp) ? '将死' : '困毙') + '了，棋局到此结束。',
            better: ''
          });
          return finishAfter(color, r, plays, entries, findings, ownGainBefore.gain);
        }

        /* ---------- 判据二：放对方成杀 ---------- */
        var wantBetter = null;        /* 需要算替代点的那一条（算完填 better） */
        if (oppScan.mates.length) {
          var m = oppScan.mates[0];
          add({
            level: '严重', kind: '放对方成杀',
            why: '这一手之后，' + sideName(opp) + '方有一步杀：' + mvLabel(m.from, m.to) + ' —— ' +
              sideName(opp) + '方走这一步就把你的将将死，你没有任何救法。' +
              '（这一步是引擎扫出来的：' + sideName(opp) + '方所有着法里，' + oppScan.mates.length +
              ' 步能直接结束棋局。）',
            better: '', marks: [m.from, m.to]
          });
          wantBetter = findings[findings.length - 1];
        } else if (oppScan.checks > 0 && cfg.mateDepth >= 3 && mateBudget.ok()) {
          var os = trySearch(bd, opp, cfg.mateDepth, cfg);
          if (os && os.result === 'win' && os.bestPath && os.bestPath.length) {
            var line = os.bestPath.map(function (x) { return x.label; }).join(' ');
            add({
              level: '严重', kind: '放对方成杀',
              why: '这一手之后，' + sideName(opp) + '方有 ' + os.bestPath.length +
                ' 个半回合以内的杀棋，你挡不住。引擎算出来的杀法：' + line + '。',
              better: '', marks: [os.bestPath[0].from, os.bestPath[0].to]
            });
            wantBetter = findings[findings.length - 1];
          } else if (!os) {
            add({
              level: '注意', tone: 'info', kind: '放对方成杀',
              why: '这一手之后，' + sideName(opp) + '方有将军的着法，杀棋深查没算完（超了这次的时间预算），' +
                '所以这一条只能提示「可能有杀」，不下结论。',
              better: '', marks: null
            });
          }
        }

        /* ---------- 判据三：错过杀棋 ---------- */
        var missed = null;
        if (preScan.mates.length) {
          var playedIsMate = false, k0;
          for (k0 = 0; k0 < preScan.mates.length; k0++) {
            if (preScan.mates[k0].from === fromI && preScan.mates[k0].to === toI) playedIsMate = true;
          }
          if (!playedIsMate) {
            var first = preScan.mates[0];
            missed = {
              depth: 1,
              why: '走这一步之前，你有一步杀：' + mvLabel(first.from, first.to) + ' —— 走它就直接结束棋局。' +
                '你走了 ' + label + '，这个杀没了。',
              better: mvLabel(first.from, first.to) + '：引擎扫出的一步杀' +
                (preScan.mates.length > 1 ? '（另有 ' + (preScan.mates.length - 1) + ' 个点也是一步杀）' : ''),
              marks: [first.from, first.to]
            };
          }
        } else if (preWin) {
          var esc = oppHasEscape(bd, color, cfg.mateDepth - 1, cfg, mateBudget);
          if (esc === true && preWin.bestPath && preWin.bestPath.length) {
            var wn = preWin.bestPath.length;
            missed = {
              depth: wn,
              why: '走这一步之前，你有 ' + wn + ' 个半回合以内的杀棋（求解器判胜），你走了 ' + label +
                '，这个杀没了。引擎算出来的杀法：' + preWin.bestPath.map(function (x) { return x.label; }).join(' ') + '。',
              better: preWin.bestPath[0].label + '：求解器给的第一手（整条杀法：' +
                preWin.bestPath.map(function (x) { return x.label; }).join(' ') + '）',
              marks: [preWin.bestPath[0].from, preWin.bestPath[0].to]
            };
          }
        }
        if (missed) {
          add({ level: '严重', kind: '错过杀棋', why: missed.why, better: missed.better, marks: missed.marks });
        }

        /* ---------- 判据四/五/六：子力（三选一，不叠报） ----------
         * 杀棋和子力是两件事，可以同时成立（「本来有一步杀，这一手既丢了杀、又白送一个车」）。
         * 所以这里**不再**被「错过杀棋」挡住；但这种情况替代点只给杀棋那一条 ——
         * 「本来能一步赢」永远优先，不能让子力建议把它顶掉。 */
        var matTarget = null;
        var oldPair = null;
        {
          /* 这一手吃进来多少（没吃子就是 0），以及「这一手之后对方能净赚多少」。
             两者相减才是这一手真正的亏 —— 不减的话「吃他一个车、让自己的马留在嘴里」会被
             说成净亏 400，其实还赚 500，那就是假警；「炮换马」也会被说成净亏 450，其实是 50。 */
          var vCap = (r.captured && r.captured.length) ? vn(r.rec.capType) : 0;
          var netLoss = postGain.gain - vCap;
          if (playedSee !== null && playedSee <= -cfg.seeMin) {
            var lost = -playedSee;
            /* 开局用炮换马是典型劣招（棋谚「开局炮胜马」）：子力上就亏半个兵，
               更要紧的是白走一步、让对方顺势出车。数字之外补一句棋理。 */
            var extra = '';
            if (n <= cfg.openingPlies && pieceType === 'C' && r.rec.capType === 'N') {
              extra = ' 象棋里有句棋谚「开局炮胜马」：开局时炮比马值钱，' +
                '换掉之后对方接着就能把车开出来 —— 这一换不只亏子力，还等于白走了一步。';
            }
            add({
              level: lvl(lost), kind: '兑子亏',
              why: '这一手 ' + label + ' 吃对方的' + cn(r.rec.capType) + '，但对方能反吃回来：' +
                '按交换算，这一手净亏 ' + lost + ' 分（吃进 ' + vn(r.rec.capType) +
                '，赔进 ' + (lost + vn(r.rec.capType)) + ' 分）。' + extra,
              better: '', marks: null
            });
            matTarget = findings[findings.length - 1];
          } else if (postGain.gain >= cfg.minGain && postGain.gain > preGain.gain && netLoss >= cfg.minGain) {
            var gm = postGain.move;
            add({
              level: lvl(netLoss), kind: '送子',
              why: '这一手之后，' + sideName(opp) + '方的' + cn(bd.t[gm.from]) + '（' + XQ.toLabel(gm.from) +
                '）可以吃你的' + cn(bd.t[gm.to]) + '（' + XQ.toLabel(gm.to) + '），这一笔对方净赚 ' +
                postGain.gain + ' 分' +
                (vCap ? '；你这一手吃进来 ' + vCap + ' 分，两笔相抵还是净亏 ' + netLoss + ' 分'
                      : '，你净亏 ' + netLoss + ' 分') +
                '。走这一步之前对方最多只赚 ' + preGain.gain + ' 分 —— 这笔亏是这一手新造成的。',
              better: '', marks: [gm.from, gm.to]
            });
            matTarget = findings[findings.length - 1];
          } else if (preGain.gain >= cfg.threatMin && postGain.gain >= preGain.gain) {
            var pm = preGain.move;
            /* 必须确认「这笔账还在」：被威胁的那个子还在原地、对方那一手还能吃到它。
               （否则可能是「你把马挪走了，但对方另有一样大的赚头」——那不是漏应。） */
            var stillThere = false;
            if (bd.g[pm.to] === color && bd.g[pm.from] === opp) {
              var vv = see(bd, pm.from, pm.to, opp, cfg.seeDepth, st);
              stillThere = vv !== null && vv >= preGain.gain;
            }
            var pKey = pm.from + '>' + pm.to;
            var threatNew = (prevOwnGain < 0) || (preGain.gain > prevOwnGain);
            /* 还有一个更重要的过滤器：**我自己现在也能白赚同样多或更多吗？**
               能（比如我下一步就能吃他的车），那「不管他的威胁、先吃大的」是正着，不是漏应 ——
               只有「他威胁的这笔账比我眼下能赚的都大」，才谈得上漏应。 */
            var canOutGain = ownGainBefore.gain >= preGain.gain;
            if (stillThere && threatNew && !canOutGain) {
              /* 对方**上一手刚威胁上**（上一手还没这个赚头），你却没管 —— 这是实打实的漏应 */
              add({
                level: lvl(preGain.gain), kind: '漏应',
                why: '对方上一手刚威胁上你：' + preGainDesc + '，你净亏 ' + preGain.gain + ' 分。' +
                  '你走了 ' + label + '，没有管它 —— 现在它还在那儿' +
                  (prevOwnGain < 0 ? '。' : '（上一手对方还赚不到这笔）。'),
                better: '', marks: [pm.from, pm.to]
              });
              matTarget = findings[findings.length - 1];
            } else if (stillThere && !canOutGain && !oldThreatReported[pKey]) {
              /* 老账：这个子其实已经暴露好几手了。只提一次 —— 你没管它可能是有意（后面有更大的算路），
                 但按子力算这笔账一直在，值得知道。 */
              oldThreatReported[pKey] = 1;
              oldPair = pKey;
              add({
                level: '提示', tone: 'info', kind: '漏应',
                why: '注意（只提这一次）：' + preGainDesc + '，按子力算随时能白赚 ' + preGain.gain +
                  ' 分，这一手没管它。（你要是另有更大的算路，可以不管 —— 但这笔账要自己知道。）',
                better: '', marks: [pm.from, pm.to]
              });
            }
          }
        }
        if (matTarget && !missed) wantBetter = matTarget;

        /* ---------- 替代着法：只在这一手真有问题时算 ----------
         * 必须回到**走棋之前**的局面上算 —— 在「轮到对方走」的局面上找「我该走哪」是胡说。
         * 所以：撤回这一手 → 算 → 原样走回来。 */
        if (wantBetter && betterBudget.ok()) {
          bd.undo(r.rec);
          var bm = suggestBetter(bd, color, { from: fromI, to: toI }, cfg, betterBudget, st);
          var r2 = bd.play(fromI, toI, color);
          if (r2.ok) r = r2;
          if (bm) {
            wantBetter.better = bm.move + '：' + bm.why +
              (wantBetter.kind === '放对方成杀' ? '（先把杀路堵住）' : '');
          }
        }

        /* ---------- 开头毛病（只在开局阶段，且这一手没有严重问题时才提） ---------- */
        var hasSerious = false;
        for (var q = 0; q < findings.length; q++) if (findings[q].level === '严重') hasSerious = true;
        if (standard && id && !hasSerious && movedCount[id] >= cfg.repeatLimit && !repeatReported[id]) {
          repeatReported[id] = 1;
          add({
            level: '注意', tone: 'info', kind: '开局毛病',
            why: '开局 ' + Math.ceil(n / 2) + ' 个回合里，这一个' + cn(pieceType) + '已经走了 ' +
              movedCount[id] + ' 手 —— 同一个子反复走，等于别的子都还没动。开局要的是把子力铺开，' +
              '不是把一个子来回挪。',
            better: '', marks: null
          });
        }

        /* ---------- 一点问题都没有：也要有一句话（不许沉默） ---------- */
        var oldThreatHint = (preGainDesc && preGain.gain >= cfg.threatMin && postGain.gain >= preGain.gain)
          ? preGainDesc : null;
        if (!findings.length) {
          if (r.captured.length && playedSee !== null && playedSee > 0) {
            add({
              level: '提示', tone: 'good', kind: '得子',
              why: '这一手 ' + label + ' 吃掉' + sideName(opp) + '方的' + cn(r.rec.capType) +
                '，按交换算净赚 ' + playedSee + ' 分。',
              better: '', marks: [fromI, toI]
            });
          } else if (bd.isChecked(opp)) {
            add({
              level: '提示', tone: 'good', kind: '将军',
              why: '这一手 ' + label + ' 将军，' + sideName(opp) + '方必须应，你先手。' +
                '（对方没有被将死，也没有反手杀你。）',
              better: '', marks: [fromI, toI]
            });
          } else {
            var quiet;
            if (oldThreatHint) {
              /* 盘上有笔「老账」已经提过，这一手还是没管 —— 中性说明里点一句，但不重复整段 */
              quiet = '这一步本身没有新问题（没有送子、也没有给对方杀棋）—— 不过 ' + oldThreatHint +
                '这笔账还没结，前面已经说过一次了';
            } else {
              quiet = '这一步正常：没有送子、没有漏应、没有给对方杀棋';
              if (preGain.gain > 0) quiet += '（盘上对方能赚的只有 ' + preGain.gain + ' 分，这一手没有把它变大）';
            }
            add({ level: '提示', tone: 'dull', kind: '正常', why: label + ' —— ' + quiet + '。', better: '', marks: null });
          }
        }

        for (var z = 0; z < findings.length; z++) entries.push(findings[z]);
        plays.push({
          rec: r.rec, color: color, n: n, from: fromI, to: toI, label: label, findings: findings,
          ownGain: ownGainBefore.gain, oldPair: oldPair
        });
        return { ok: true, findings: findings, entry: findings[0], board: bd };
      }

      /* 走出一手之后收尾（把 findings 记进 entries / plays）——将死那一支单独走 */
      function finishAfter(color, rec, playsArr, entriesArr, findings, own) {
        for (var z = 0; z < findings.length; z++) entriesArr.push(findings[z]);
        playsArr.push({
          rec: rec.rec, color: color, n: findings[0].n, from: rec.rec.from, to: rec.rec.to,
          label: findings[0].move, findings: findings, terminal: true, ownGain: own === undefined ? 0 : own
        });
        finished = true;
        return { ok: true, findings: findings, entry: findings[0], board: bd, terminal: true };
      }

      /* 子力损失 → 严重程度：丢车马炮（≥400）算严重；丢仕相（≥200）算注意；丢兵算提示 */
      function lvl(v) { return v >= 400 ? '严重' : (v >= 200 ? '注意' : '提示'); }

      /* 撤销最后一手：连同它的点评一起退掉，并重建开局计数 */
      function undo() {
        if (!plays.length) return null;
        var p = plays.pop();
        bd.undo(p.rec);
        entries = entries.filter(function (e) { return e.n !== p.n; });
        if (p.oldPair) delete oldThreatReported[p.oldPair];
        finished = false;
        rebuildOpening();
        return p;
      }

      function rebuildOpening() {
        ids = {}; idStart = {}; movedCount = {}; capturedIds = {}; repeatReported = {};
        if (!standard) return;
        initIds();
        for (var i = 0; i < plays.length && i < cfg.openingPlies; i++) {
          trackMove(plays[i].from, plays[i].to);
        }
      }
      /* 开局小结（阶段性的，不是某一手）：只在整盘摆完之后给一条。
         它说的是「开局 10 个回合走完，哪几个大子一步没动」。 */
      function finishEntries() {
        var res = [];
        if (!standard) return res;
        var limit = Math.min(cfg.openingPlies, plays.length);
        if (limit < cfg.openingPlies) return res;
        var sides = [firstColor, other(firstColor)], si, key, id, info;
        for (si = 0; si < sides.length; si++) {
          var miss = [];
          for (key in movedCount) {
            if (!Object.prototype.hasOwnProperty.call(movedCount, key)) continue;
            if (movedCount[key] > 0 || capturedIds[key]) continue;
            info = START_INFO[idStart[key]];
            if (!info || info.color !== sides[si] || !BIG[info.type]) continue;
            miss.push(cn(info.type) + '（' + XQ.toLabel(idStart[key]) + '）');
          }
          if (miss.length) {
            res.push({
              n: cfg.openingPlies, side: sideName(sides[si]), level: '提示', tone: 'info',
              kind: '开局毛病', move: '（开局小结）',
              why: '开局 ' + (cfg.openingPlies / 2) + ' 个回合走完，' + sideName(sides[si]) +
                '方还有大子一步没动：' + miss.join('、') + '。子力不出，后面就很难组织攻势 —— ' +
                '开局先把马炮车走出来，比在原地挪子划算。',
              better: '', marks: null
            });
          }
        }
        return res;
      }

      function reset() {
        if (standard) bd.reset(); else bd.setup(cfg.setup);
        bd.toMove = firstColor;
        st.nodes = 0;
        mateBudget.t0 = Date.now();
        betterBudget.t0 = Date.now();
        entries = []; plays = []; finished = false;
        ids = {}; idStart = {}; movedCount = {}; capturedIds = {}; repeatReported = {};
        oldThreatReported = {};
        if (standard) initIds();
      }

      var api = {
        cfg: cfg, board: bd, standard: standard,
        push: push, undo: undo, reset: reset,
        finishEntries: finishEntries,
        isFinished: function () { return finished; },
        moves: function () { return plays.slice(); },
        entries: function () { return entries.slice(); },
        summary: function () { return summarize(entries.concat(finishEntries())); },
        elapsedMs: function () { return Date.now() - Math.min(mateBudget.t0, betterBudget.t0); }
      };
      return api;
    }

    /* ══════════════════════════════════════════════════════════
     * 五、整盘：reviewGame
     * ══════════════════════════════════════════════════════════ */

    var PROBLEM_KINDS = { '送子': 1, '漏应': 1, '错过杀棋': 1, '放对方成杀': 1, '兑子亏': 1, '非法着法': 1 };

    function reviewGame(moves, opts) {
      var cfg = merge(merge({}, DEFAULT), opts || {});
      var s = createSession(opts || {});
      var out = [];
      var list = (moves || []).slice(0, cfg.maxMoves);
      for (var i = 0; i < list.length; i++) {
        var res = s.push(list[i]);
        for (var j = 0; j < res.findings.length; j++) out.push(res.findings[j]);
        if (res.terminal || !res.ok) break;
      }
      var fin = s.finishEntries();
      for (var k = 0; k < fin.length; k++) out.push(fin[k]);

      /* 一手都没走成（第一手就非法）时，也要有一条说法，而不是空数组 */
      if (out.length === 0) {
        out.push({
          n: 0, side: '—', level: '提示', tone: 'info', kind: '正常', move: '—',
          why: '这份棋谱是空的 —— 没有可点评的手。（要点评就先按红先、一手一手把棋摆进来。）',
          better: '', marks: null
        });
      }
      out.summary = summarize(out);
      out.session = s;
      return out;
    }

    function summarize(entries) {
      var byKind = {}, byLevel = { '严重': 0, '注意': 0, '提示': 0 };
      var moveSet = {}, problemMoves = {}, worst = null, i, e;
      for (i = 0; i < (entries || []).length; i++) {
        e = entries[i];
        byKind[e.kind] = (byKind[e.kind] || 0) + 1;
        if (byLevel[e.level] !== undefined) byLevel[e.level]++;
        if (e.n) moveSet[e.n] = 1;
        if (PROBLEM_KINDS[e.kind] && e.n) problemMoves[e.n] = 1;
        if (PROBLEM_KINDS[e.kind]) {
          if (!worst || rank(e) > rank(worst)) worst = e;
        }
      }
      var nMove = 0, k2;
      for (k2 in moveSet) if (Object.prototype.hasOwnProperty.call(moveSet, k2)) nMove++;
      var nProb = 0;
      for (k2 in problemMoves) if (Object.prototype.hasOwnProperty.call(problemMoves, k2)) nProb++;
      return {
        moves: nMove, problemMoves: nProb,
        byKind: byKind, byLevel: byLevel,
        worst: worst,
        solver: HAS_SOLVER,
        kinds: kindsOf(byKind)
      };
    }
    function rank(e) {
      var base = e.level === '严重' ? 300 : (e.level === '注意' ? 200 : 100);
      return base + (e.n ? 1 / e.n : 0);
    }
    function kindsOf(byKind) {
      var order = ['送子', '漏应', '错过杀棋', '放对方成杀', '兑子亏', '开局毛病', '非法着法'];
      var out = [], i;
      for (i = 0; i < order.length; i++) {
        if (byKind[order[i]]) out.push({ kind: order[i], n: byKind[order[i]] });
      }
      return out;
    }

    var API = {
      reviewGame: reviewGame,
      createSession: createSession,
      summarize: summarize,
      DEFAULT: DEFAULT,
      VALUE: VALUE,
      TYPE_CN: TYPE_CN,
      /* 六类问题 + 「走不出来」兜底 —— 自查表要按这张表一一对上，所以导出它 */
      PROBLEM_KINDS: PROBLEM_KINDS,
      /* 下面几个是给自检/别的工具复用的内部判据（页面用不到） */
      see: see, gainFor: gainFor, mateScan: mateScan,
      hasSolver: function () { return HAS_SOLVER; },
      selfTest: null
    };
    return API;
  }

  /* ══════════════════════════════════════════════════════════
   * 装载：Node 走 require（顺手接上求解器），浏览器挂 window
   * ══════════════════════════════════════════════════════════ */
  var isNode = (typeof module !== 'undefined' && module.exports && typeof require === 'function');
  var API;
  if (isNode) {
    /* 求解器在 tools/ 下（src/ 里没有），所以这一条要往上一级找 ——
       原来写的是 './xq-solver.js'，从 src/ 里解析必然找不到，
       于是 `node src/xq-review.js` 一直是 MODULE_NOT_FOUND。 */
    API = makeAPI(require('../src/xq-engine.js'), require('../tools/xq-solver.js'));
    module.exports = API;
  } else if (!global.XQ) {
    /* 页面里 xq-engine.js 必须先加载 —— 不然这里连棋盘都摆不出来。
       不静默失败：留一个能读的说明，界面会把它显示出来。 */
    global.XQReview = {
      error: '规则引擎没加载：请把 xq-engine.js 排在 xq-review.js 之前。',
      reviewGame: function () { return []; }
    };
    return;
  } else {
    API = makeAPI(global.XQ, global.XQSolver || null);
    global.XQReview = API;
  }

  if (!isNode) return;

  /* ══════════════════════════════════════════════════════════
   * 自检：**故意犯错**，断言能被抓出来；再验「正常的一手不许乱报」
   * ══════════════════════════════════════════════════════════ */
  var XQ = require('../src/xq-engine.js');
  var path = require('path');

  function find(entries, kind) {
    for (var i = 0; i < entries.length; i++) if (entries[i].kind === kind) return entries[i];
    return null;
  }
  function problems(entries) {
    var out = [], i;
    for (i = 0; i < entries.length; i++) {
      if (API.summarize([entries[i]]).problemMoves > 0) out.push(entries[i]);
    }
    return out;
  }

  function selfTest(verbose) {
    var pass = 0, fail = 0;
    function padW(s, w) {
      var wide = 0, i, ch;
      s = String(s);
      for (i = 0; i < s.length; i++) { ch = s.charCodeAt(i); wide += (ch > 0x2e80) ? 2 : 1; }
      while (wide < w) { s += ' '; wide++; }
      return s;
    }
    function run(name, fn) {
      var r;
      try { r = fn(); } catch (e) { r = { ok: false, msg: '抛异常：' + e.message }; }
      if (!r || typeof r !== 'object') r = { ok: false, msg: '没有返回结果' };
      if (r.ok) pass++; else fail++;
      console.log('  %s %s %s', r.ok ? '✓' : '✗', padW(name, 34), r.msg);
      if (verbose && r.detail) console.log('      ' + r.detail);
    }
    function board(list) { return new XQ.Board().setup(list); }
    function idx(x, y) { return y * 9 + x; }

    console.log('');
    console.log('xq-review 自检（每条都是「造一个错，看它抓不抓得住」）');

    /* 0. 子力表必须与求解器一致 —— 两张表不一致，后面所有分数都是错的 */
    run('子力表与 xq-solver 一致', function () {
      var s = require('../tools/xq-solver.js'), bad = [], k;
      for (k in API.VALUE) if (s.VALUE[k] !== API.VALUE[k]) bad.push(k);
      return { ok: bad.length === 0, msg: bad.length ? ('不一致：' + bad.join(',')) : '车900/炮450/马400/仕相200/兵100 两边相同' };
    });

    /* 1. 送子：红车自己走到黑马嘴里（这个局面红方没有杀，判据要单独站得住） */
    run('送子·红车送进黑马口', function () {
      var setup = [[3, 9, 'r', 'K'], [4, 0, 'b', 'K'], [0, 9, 'r', 'R'], [1, 3, 'b', 'N']];
      var es = API.reviewGame([{ from: [0, 9], to: [0, 5] }], { setup: setup });
      var f = find(es, '送子');
      if (!f) return { ok: false, msg: '没报送子（entries: ' + es.map(function (e) { return e.kind; }).join(',') + '）' };
      var ok = /900/.test(f.why) && f.marks && f.marks[1] === idx(0, 5);
      return { ok: ok, msg: (ok ? '报出送子，净亏 900，指出对方一步能吃' : '报了送子但内容不对'),
        detail: f.why + (f.better ? ' ｜ better=' + f.better : '') };
    });

    /* 1b. 又该杀又该送：两个事实都要报出来（杀棋优先给替代点） */
    run('错过杀棋+送子·两条都报', function () {
      var setup = [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [0, 9, 'r', 'R'], [1, 3, 'b', 'N']];
      var es = API.reviewGame([{ from: [0, 9], to: [0, 5] }], { setup: setup });
      var f1 = find(es, '错过杀棋'), f2 = find(es, '送子');
      var ok = !!f1 && !!f2 && /D1/.test(f1.better || '');
      return {
        ok: ok,
        msg: ok ? '两条都报出；替代点给的是那一步杀（A1-D1）' : ('缺一条：错过杀棋=' + !!f1 + ' 送子=' + !!f2),
        detail: (f1 ? f1.why : '') + ' ／ ' + (f2 ? f2.why : '')
      };
    });

    /* 2. 漏应：红马早就在黑车嘴里（无人保护），红方却去拱了一个兵 */
    run('漏应·老账没还', function () {
      var setup = [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [8, 9, 'r', 'R'], [0, 0, 'b', 'R'],
                   [0, 5, 'r', 'N'], [4, 6, 'r', 'P']];
      var es = API.reviewGame([{ from: [4, 6], to: [4, 5] }], { setup: setup });
      var f = find(es, '漏应');
      var noSong = find(es, '送子');
      if (!f) return { ok: false, msg: '没报漏应（entries: ' + es.map(function (e) { return e.kind; }).join(',') + '）' };
      return { ok: !noSong, msg: (noSong ? '错报了送子（这一手没新造成损失）' : '报出漏应，且没误报送子'), detail: f.why };
    });

    /* 2b. 漏应（刚威胁上）：上一手对方才把车摆过来盯住你的马，你却去走别处 */
    run('漏应·对方刚威胁上这一手', function () {
      var setup = [[4, 9, 'r', 'K'], [8, 7, 'r', 'R'], [4, 5, 'r', 'N'],
                   [3, 0, 'b', 'K'], [0, 3, 'b', 'R']];
      var es = API.reviewGame([{ from: [8, 7], to: [8, 6] }, { from: [0, 3], to: [0, 5] },
                               { from: [8, 6], to: [8, 3] }], { setup: setup });
      var f = find(es, '漏应');
      if (!f) return { ok: false, msg: '没报（entries: ' + es.map(function (e) { return '第' + e.n + '手' + e.kind; }).join(' ') + '）' };
      var ok = f.n === 3 && f.level !== '提示' && /上一手刚威胁上你/.test(f.why);
      return {
        ok: ok,
        msg: ok ? '第 3 手报出「对方上一手刚威胁上你」（注意/严重级）' : ('报了但不对：第' + f.n + '手 ' + f.level),
        detail: f.why
      };
    });

    /* 3. 错过杀棋：红有一步杀（车平到 A10 配合兵控 E9），红却去挪了车 */
    run('错过杀棋·一步杀不走', function () {
      var setup = [[3, 9, 'r', 'K'], [4, 0, 'b', 'K'], [0, 1, 'r', 'R'], [4, 2, 'r', 'P']];
      var es = API.reviewGame([{ from: [0, 1], to: [0, 4] }], { setup: setup });
      var f = find(es, '错过杀棋');
      if (!f) return { ok: false, msg: '没报错过杀棋（entries: ' + es.map(function (e) { return e.kind; }).join(',') + '）' };
      var ok = /A10/.test(f.better);
      return { ok: ok, msg: ok ? '报出错过杀棋，替代点正是那一步杀' : '报了但 better 里没有那一步杀', detail: f.why + ' ｜ better=' + f.better };
    });

    /* 4. 放对方成杀：红车挪了一步闲棋，黑车立刻 A9→A10 杀（红兵被黑卒压住，退路全封） */
    run('放对方成杀·自己让开杀路', function () {
      var setup = [[4, 9, 'r', 'K'], [0, 3, 'r', 'R'], [3, 0, 'b', 'K'], [0, 8, 'b', 'R'], [4, 7, 'b', 'P']];
      var es = API.reviewGame([{ from: [0, 3], to: [1, 3] }], { setup: setup });
      var f = find(es, '放对方成杀');
      if (!f) return { ok: false, msg: '没报（entries: ' + es.map(function (e) { return e.kind; }).join(',') + '）' };
      var ok = f.level === '严重' && f.marks && f.marks[1] === idx(0, 9);
      return { ok: ok, msg: ok ? '报出放对方成杀，并指出黑车那一步杀' : '报了但没指出杀点', detail: f.why };
    });

    /* 5. 正常一手：标准开局炮二平五（红炮 B3→E3），**不许**报任何问题 */
    run('正常一手·不许假警', function () {
      var es = API.reviewGame([{ from: [1, 7], to: [4, 7] }]);
      var p = problems(es);
      if (p.length) return { ok: false, msg: '误报了：' + p.map(function (e) { return e.kind + '：' + e.why; }).join(' ｜ ') };
      var ok = es.length === 1 && es[0].kind === '正常';
      return { ok: ok, msg: ok ? '一声不响地放行，且给了「这一步正常」的说明' : ('结论是 ' + es[0].kind + '，期望「正常」'), detail: es[0].why };
    });

    /* 6. 标准开局前 6 手（双方正常出子）都不该报问题 */
    run('正常开局·六手无假警', function () {
      var mv = [{ from: [1, 7], to: [4, 7] }, { from: [1, 2], to: [4, 2] }, { from: [1, 9], to: [2, 7] },
                { from: [1, 0], to: [2, 2] }, { from: [0, 9], to: [1, 9] }, { from: [0, 0], to: [1, 0] }];
      var es = API.reviewGame(mv);
      var p = problems(es);
      return { ok: p.length === 0, msg: p.length ? ('误报 ' + p.length + ' 条：' + p.map(function (e) { return e.kind + '（第' + e.n + '手）'; }).join(',')) : '六手全部放行' };
    });

    /* 7. 兑子亏：红车吃一个被黑车（同线）护住的炮 —— 吃进 450 赔进 900 */
    run('兑子亏·车换炮亏', function () {
      var setup = [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 4, 'r', 'R'], [4, 1, 'b', 'C'], [0, 1, 'b', 'R']];
      var es = API.reviewGame([{ from: [4, 4], to: [4, 1] }], { setup: setup });
      var f = find(es, '兑子亏');
      var ok = !!f && /450/.test(f.why) && f.level === '严重';
      return { ok: ok, msg: ok ? '报出兑子亏（净亏 450，严重）' : ('没报（entries: ' + es.map(function (e) { return e.kind; }).join(',') + '）'), detail: f ? f.why : '' };
    });

    /* 7b. 吃大子后小亏：红马吃黑车（900），但黑车回头吃红马（400）——
           这一手是净赚 500，**不许**报成送子（假警比漏报更糟） */
    run('净账·吃大子后小亏不算送子', function () {
      var setup = [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [2, 2, 'r', 'N'], [0, 1, 'b', 'R'], [2, 0, 'b', 'N']];
      var es = API.reviewGame([{ from: [2, 2], to: [0, 1] }], { setup: setup });
      var p = problems(es);
      var f = find(es, '得子');
      var ok = p.length === 0 && !!f && /500/.test(f.why);
      return {
        ok: ok,
        msg: ok ? '没误报，如实报「吃子净赚 500」' :
          (p.length ? ('误报：' + p.map(function (e) { return e.kind; }).join(',')) : '没报得子'),
        detail: (f ? f.why : '') + (p.length ? ' ｜误报：' + p.map(function (e) { return e.why; }).join(' ') : '')
      };
    });

    /* 7c. 吃小亏大：红炮吃掉一个卒（吃进 100），却让开黑车吃红车的路（赔进 900）——
           netLoss 必须把吃进来那 100 减掉：报「对方净赚 900、相抵净亏 800」，不是 900 */
    run('净账·吃小失大要把吃进的减掉', function () {
      var setup = [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 0, 'b', 'R'], [4, 4, 'r', 'C'],
                   [4, 7, 'r', 'R'], [1, 4, 'b', 'P'], [3, 4, 'b', 'N']];
      var es = API.reviewGame([{ from: [4, 4], to: [1, 4] }], { setup: setup });
      var f = find(es, '送子');
      if (!f) return { ok: false, msg: '没报送子（entries: ' + es.map(function (e) { return e.kind; }).join(',') + '）' };
      var ok = /净赚 900/.test(f.why) && /吃进来 100/.test(f.why) && /净亏 800/.test(f.why);
      return { ok: ok, msg: ok ? '报出送子：对方净赚 900，减掉吃进的 100 后净亏 800' : '报了但账没算对', detail: f.why };
    });

    /* 7d. 炮换马：红炮 B3 打黑马 B10（吃进 400），黑车 A10 吃回红炮（赔进 450）——
           真实的亏只有 50 分。两件事都要成立：
             ① **不能说成「净亏 450」** —— 那等于把吃进来的 400 忘了；
             ② **也不能一声不响** —— 棋谚「开局炮胜马」，这半个兵是实打实亏的，
                而且对方顺势出车，等于白走一步。2026-09-29 用户实测指出：
                这一步原来被判「正常」，可它是公认的劣招。 */
    run('净账·炮换马亏 50 要说出来、但别说成亏 450', function () {
      var es = API.reviewGame([{ from: [1, 7], to: [1, 0] }]);
      var songzi = find(es, '送子');
      var duizi = find(es, '兑子亏');
      var ok = !songzi && !!duizi && /净亏 50 分/.test(duizi.why) && duizi.level === '提示';
      return {
        ok: ok,
        msg: ok ? '报出「兑子亏 50 分」（提示级），没有误报成「净亏 450」' :
          ('送子=' + (songzi ? songzi.why : '无') + ' ｜ 兑子亏=' + (duizi ? duizi.why : '无')),
        detail: es.map(function (e) { return e.kind + '：' + e.why; }).join(' ')
      };
    });

    /* 8. 开局毛病：红炮在开局里来回走三次 */
    run('开局毛病·一子反复走', function () {
      var mv = [{ from: [1, 7], to: [4, 7] }, { from: [7, 2], to: [4, 2] },
                { from: [4, 7], to: [3, 7] }, { from: [7, 0], to: [6, 2] },
                { from: [3, 7], to: [4, 7] }, { from: [6, 2], to: [4, 1] }];
      var es = API.reviewGame(mv);
      var f = find(es, '开局毛病');
      var p = problems(es);
      return {
        ok: !!f && p.length === 1,
        msg: f ? ('第 ' + f.n + ' 手报出开局毛病（同一个子走了 3 手）' + (p.length === 1 ? '，且没有别的误报' : '，但另有 ' + (p.length - 1) + ' 条误报：' + p.map(function (e) { return e.kind; }).join(',')))
          : ('没报（entries: ' + es.map(function (e) { return '第' + e.n + '手' + e.kind; }).join(' ') + '）'),
        detail: f ? f.why : ''
      };
    });

    /* 9. 非法着法 / 漏应将：被将军却走别处 —— 引擎会拒收，工具要如实说 */
    run('漏应将·被将军没应上', function () {
      var setup = [[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 0, 'b', 'R'], [2, 6, 'r', 'P']];
      var es = API.reviewGame([{ from: [2, 6], to: [2, 5] }], { setup: setup });
      var f = find(es, '非法着法');
      var ok = f && /将/.test(f.why);
      return { ok: !!ok, msg: ok ? '如实报出「这一步走不出来」（送将/没应将）' : ('没报非法着法（entries: ' + es.map(function (e) { return e.kind; }).join(',') + '）'), detail: f ? f.why : '' };
    });

    /* 10. 真名局整盘：不许抛异常、不许超时（这是性能的底线） */
    run('真名局整盘·不炸且不超时', function () {
      var g = null, i;
      global.window = global.window || {};
      var names = ['a', 'b', 'c'];
      for (i = 0; i < names.length; i++) {
        try { require(path.join(__dirname, '..', 'src', 'xq-games-' + names[i] + '.js')); } catch (e) { }
      }
      var games = global.window.XQ_GAMES || [];
      for (i = 0; i < games.length; i++) if (games[i].id === 'xq-g09') g = games[i];
      if (!g) return { ok: false, msg: '没找到内置名局 xq-g09（数据文件没挂上？）' };
      var t0 = Date.now();
      var es = API.reviewGame(g.moves, { mateBudgetMs: 4000 });
      var ms = Date.now() - t0;
      var ok = ms < 20000 && es.length > 0;
      return {
        ok: ok,
        msg: 'xq-g09 共 ' + g.moves.length + ' 手，点评 ' + es.length + ' 条，耗时 ' + ms + ' 毫秒' +
          (ms < 20000 ? '' : '（超 20 秒）'),
        detail: '问题手：' + API.summarize(es).problemMoves + ' 手 ｜ ' +
          API.summarize(es).kinds.map(function (k) { return k.kind + '×' + k.n; }).join(' ')
      };
    });

    /* 11. 会话（页面用的那条路）：push / undo 之后，局面与点评都要回到原样 */
    run('会话·undo 后局面与点评都回滚', function () {
      var s = API.createSession({});
      var a = s.push({ from: [1, 7], to: [4, 7] });
      var b = s.push({ from: [1, 0], to: [2, 2] });
      var g1 = Array.prototype.slice.call(s.board.g).join(',');
      s.undo();
      var g2 = Array.prototype.slice.call(s.board.g).join(',');
      var after = s.entries();
      var s2 = API.createSession({});
      s2.push({ from: [1, 7], to: [4, 7] });
      var g3 = Array.prototype.slice.call(s2.board.g).join(',');
      var ok = g2 === g3 && after.length === 1 && after[0].n === 1 && s.board.toMove === XQ.BLACK;
      return { ok: ok, msg: ok ? '撤销一手后局面、轮到谁走、点评条数全部回到一手时的状态' : '回滚不对' };
    });

    console.log('');
    console.log('自检：通过 %d，失败 %d', pass, fail);
    return fail === 0;
  }

  API.selfTest = selfTest;

  /* ══════════════════════════════════════════════════════════
   * 命令行
   * ══════════════════════════════════════════════════════════ */
  function loadMovesFromFile(p) {
    var fs = require('fs'), txt = fs.readFileSync(p, 'utf8');
    if (/\.json$/i.test(p)) {
      var j = JSON.parse(txt);
      var arr = Array.isArray(j) ? j : (j.moves || []);
      return arr.map(function (m) {
        if (m.from && m.to) return { from: m.from, to: m.to };
        if (m[0] && m[1]) return { from: m[0], to: m[1] };
        throw new Error('棋谱里有一手读不出 from/to：' + JSON.stringify(m));
      });
    }
    var out = [];
    txt.split(/\r?\n/).forEach(function (line) {
      line = line.replace(/[#;].*$/, '').trim();
      if (!line) return;
      var m = line.split(/[\s,，→>-]+/).filter(function (s) { return !!s; });
      if (m.length < 2) return;
      var a = XQ.fromLabel(m[0]), b = XQ.fromLabel(m[1]);
      if (a < 0 || b < 0) throw new Error('这一行读不出坐标：' + line);
      out.push({ from: [a % 9, (a / 9) | 0], to: [b % 9, (b / 9) | 0] });
    });
    return out;
  }

  function loadGame(idOrNo) {
    global.window = global.window || {};
    var names = ['a', 'b', 'c'], i;
    for (i = 0; i < names.length; i++) {
      try { require(path.join(__dirname, '..', 'src', 'xq-games-' + names[i] + '.js')); } catch (e) { }
    }
    var games = global.window.XQ_GAMES || [], g = null;
    for (i = 0; i < games.length; i++) {
      if (games[i].id === idOrNo) g = games[i];
      else if (String(games[i].no) === String(idOrNo)) g = games[i];
    }
    return g;
  }

  function printReview(entries, opts) {
    var verbose = opts && opts.verbose;
    var sum = API.summarize(entries);
    var shown = 0, i, e;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.tone === 'dull' && !verbose) continue;
      shown++;
      console.log('');
      console.log('第 ' + e.n + ' 手 ' + e.side + '  ' + e.move +
        '   [' + e.level + '·' + e.kind + ']');
      console.log('    ' + e.why);
      if (e.better) console.log('    引擎给的替代点：' + e.better);
    }
    if (!shown) console.log('\n（没有发现任何问题 —— 这一盘在规则层面走得很干净。）');
    console.log('');
    console.log('════════ 全盘小结 ════════');
    console.log('共点评 %d 手；其中有问题 %d 手', sum.moves, sum.problemMoves);
    if (sum.kinds.length) {
      sum.kinds.forEach(function (k) {
        console.log('    ' + padW(k.kind, 12) + k.n + ' 次');
      });
    }
    if (sum.worst) {
      console.log('最要紧的一手：第 %d 手 %s %s（%s·%s）',
        sum.worst.n, sum.worst.side, sum.worst.move, sum.worst.level, sum.worst.kind);
    }
    if (!API.hasSolver()) {
      console.log('注意：这次运行**没有接上残局求解器**，杀棋只判到一步杀。');
    }
    console.log('子力表：车 900 / 炮 450 / 马 400 / 仕相 200 / 兵 100');

    function padW(s, w) {
      var wide = 0, k, ch;
      s = String(s);
      for (k = 0; k < s.length; k++) { ch = s.charCodeAt(k); wide += (ch > 0x2e80) ? 2 : 1; }
      while (wide < w) { s += ' '; wide++; }
      return s;
    }
  }

  if (require.main === module) {
    var argv = process.argv.slice(2);
    var verbose = argv.indexOf('-v') >= 0 || argv.indexOf('--verbose') >= 0;
    var args = argv.filter(function (a) { return a.charAt(0) !== '-'; });

    if (argv.indexOf('-t') >= 0 || argv.indexOf('--test') >= 0) {
      process.exit(selfTest(verbose) ? 0 : 1);
    }

    var moves = null, title = '内置样例';
    var a0 = args[0];
    if (!a0) {
      var g = loadGame('xq-g09');
      if (!g) { console.error('找不到内置样例，请用 game:<id> 指定一局。'); process.exit(1); }
      moves = g.moves; title = '内置样例：' + g.id + ' ' + g.title + '（' + g.event + '）';
    } else if (/^game[:,]/.test(a0)) {
      var g2 = loadGame(a0.replace(/^game[:,]/, ''));
      if (!g2) { console.error('没有这一局：' + a0); process.exit(1); }
      moves = g2.moves; title = g2.id + ' ' + g2.title + '（' + g2.event + '，' + g2.result + '）';
    } else {
      var fs = require('fs');
      if (!fs.existsSync(a0)) { console.error('文件不存在：' + a0); process.exit(1); }
      moves = loadMovesFromFile(a0); title = a0;
    }

    console.log('点评：' + title);
    console.log('共 ' + moves.length + ' 手（红先，交替）');
    if (!API.hasSolver()) console.log('（没有求解器：杀棋只判到一步杀）');
    var t0 = Date.now();
    var es = API.reviewGame(moves, {});
    printReview(es, { verbose: verbose });
    console.log('耗时 %d 毫秒', Date.now() - t0);
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
