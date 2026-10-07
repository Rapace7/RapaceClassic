/* 中国象棋规则引擎 —— 纯 JavaScript，零依赖，浏览器与 Node 通用
 *
 * 为什么单独写一个引擎：
 *   围棋引擎 core 是「气 / 块 / 提子」，象棋是「棋子走形 + 将帅安全」，
 *   两套语义放一起只会互相污染。这里只做象棋规则，界面层按下面的接口调用即可。
 *
 * ── 棋盘语义（与围棋引擎对齐的部分）────────────────────────────────
 *   固定 9 列 × 10 行（COLS=9, ROWS=10, N=90）
 *   bd.g[i]   该点归属：0 空 / 1 红 / 2 黑           （对齐围棋 g[]）
 *   bd.t[i]   该点棋子类型：'K'帅将 'A'仕士 'B'相象 'N'马 'R'车 'C'炮 'P'兵卒；空点 null
 *   bd.idx(x, y) / bd.xy(i)   坐标换算：x 从 0 起左→右，y 从 0 起上→下，(0,0)=棋盘左上角
 *   bd.play(from, to, color)  走子；返回 {ok:true, rec, captured} 或 {ok:false, reason}
 *                             rec 交给 bd.undo(rec) 可完全回滚
 *   bd.setup([[x,y,color,type], ...])  color 用 'r'/'b'，type 用上面的字母
 *   XQ.toLabel(i)             转成坐标名
 *
 * ── play 的签名说明（与围棋 play(i, color) 的差异）────────────────
 *   围棋落子只需 1 个点，象棋必须给出「起点 + 终点」，所以 play 多带一个参数：
 *       bd.play(from, to, color)     // from/to 都是 bd.idx(x,y)
 *   另提供等价写法 bd.play(mv, color)，mv 为 {from, to}（即 legalMoves 的元素）。
 *   这是刻意的、唯一的差异，其余名字与语义与围棋引擎保持一致。
 *
 * ── toLabel 记号（全程统一，只此一种）─────────────────────────────
 *   与围棋引擎同向：A1 在棋盘左下角。列 A–I 对应 x=0..8（左→右），
 *   行 1–10 对应 y=9..0（自下而上）。例：红帅初始位 (4,9) = E1，
 *   黑将初始位 (4,0) = E10。棋谱里用的是「炮二平五」，那是走法记法、
 *   需要起点与终点，本引擎只对「单个点」给名字，故采用上面的字母+数字。
 *
 * ── 已实现 ─────────────────────────────────────────────────────
 *   七种棋子走法（含蹩马腿 / 塞象眼 / 象不过河 / 炮隔一子吃 / 兵过河横走）
 *   将帅照面非法、送将非法、将军 isChecked、合法着法 legalMoves、
 *   将死与困毙 isMate（中国象棋里困毙同样算输）
 *   不允许「吃将」：走法若落在对方将/帅所在点，一律返回 reason='capture-king'
 *   （胜负只能由 isMate 判定；否则「把将吃了」会被误当成赢棋）
 *   对弈状态：bd.toMove、bd.moves（着法栈）、bd.undo(rec) 完全回滚
 *   标准开局 bd.reset()、点名字 XQ.toLabel(i) / XQ.fromLabel('E1')
 *
 * ── 未实现（界面层不要依赖）────────────────────────────────────
 *   1) 长将 / 长捉 判负 —— 需要「重复局面 + 是否连续将军」的历史判定，
 *      本轮不做。搜索结果里若出现双方循环，一律按和棋（draw）处理。
 *   2) 循环局面 / 和棋规则（60 回合无吃子等）—— 未实现。
 *   3) 记谱（炮二平五那套完整的进/退/平记法）—— 未实现，只有 toLabel 的点名。
 */
(function (global) {
  'use strict';

  var COLS = 9, ROWS = 10, N = 90;
  var EMPTY = 0, RED = 1, BLACK = 2;
  var TYPES = { K: 1, A: 1, B: 1, N: 1, R: 1, C: 1, P: 1 };
  var NAME = { K: '帅/将', A: '仕/士', B: '相/象', N: '马', R: '车', C: '炮', P: '兵/卒' };
  var LETTERS = 'ABCDEFGHI';

  function other(c) { return c === RED ? BLACK : RED; }
  function inBoard(x, y) { return x >= 0 && x < COLS && y >= 0 && y < ROWS; }
  function inPalace(x, y, c) {
    if (x < 3 || x > 5) return false;
    return c === RED ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
  }
  /* 是否在己方半场（象/相不能过河） */
  function ownHalf(y, c) { return c === RED ? y >= 5 : y <= 4; }
  /* 是否已过河（兵/卒过河才能横走） */
  function crossed(y, c) { return c === RED ? y <= 4 : y >= 5; }

  function Board() {
    this.cols = COLS;
    this.rows = ROWS;
    this.n = N;
    this.g = new Int8Array(N);        /* 归属：0 空 / 1 红 / 2 黑 */
    this.t = new Array(N);            /* 类型：'K'.. 空点 null */
    for (var i = 0; i < N; i++) this.t[i] = null;
    this.moves = [];
    this.toMove = RED;
  }

  Board.prototype.idx = function (x, y) { return y * COLS + x; };
  Board.prototype.xy = function (i) { return { x: i % COLS, y: (i / COLS) | 0 }; };
  Board.prototype.at = function (x, y) {
    if (!inBoard(x, y)) return -1;
    return this.g[this.idx(x, y)];
  };
  Board.prototype.typeAt = function (x, y) {
    if (!inBoard(x, y)) return null;
    return this.t[this.idx(x, y)];
  };

  /* 找某方的将/帅。返回下标，找不到返回 -1 */
  Board.prototype.findKing = function (color) {
    for (var i = 0; i < N; i++) if (this.g[i] === color && this.t[i] === 'K') return i;
    return -1;
  };

  /* ── 走法生成：由棋子的「走形」统一推出伪合法着法 ──────────────
   * 返回终点下标数组；不做「送将」过滤（那是 isChecked 的事）。
   * 所有棋子共用此函数，不在别处硬编码任何一格。 */
  Board.prototype.movesFrom = function (i) {
    var c = this.g[i];
    if (c === EMPTY) return [];
    var k = this.t[i], p = this.xy(i), x = p.x, y = p.y, out = [], self = this;
    function push(xx, yy) {
      if (!inBoard(xx, yy)) return;
      var q = self.idx(xx, yy);
      if (self.g[q] === c) return;          /* 不能吃自己的子 */
      out.push(q);
    }
    function slide(dx, dy) {
      var xx = x + dx, yy = y + dy;
      while (inBoard(xx, yy)) {
        var q = self.idx(xx, yy);
        if (self.g[q] === EMPTY) out.push(q);
        else { if (self.g[q] !== c) out.push(q); break; }
        xx += dx; yy += dy;
      }
    }
    function cannon(dx, dy) {
      var xx = x + dx, yy = y + dy, screen = false;
      while (inBoard(xx, yy)) {
        var q = self.idx(xx, yy);
        if (self.g[q] === EMPTY) { if (!screen) out.push(q); }
        else {
          if (!screen) screen = true;                       /* 第一个子 = 炮架 */
          else { if (self.g[q] !== c) out.push(q); break; } /* 炮架之后再撞到的第一个子：敌子可吃，然后停 */
        }
        xx += dx; yy += dy;
      }
    }
    var dx, dy, kz, xx, yy;
    if (k === 'K') {                                  /* 帅/将：九宫内直走一格 */
      var kd = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (kz = 0; kz < 4; kz++) {
        xx = x + kd[kz][0]; yy = y + kd[kz][1];
        if (inPalace(xx, yy, c)) push(xx, yy);
      }
    } else if (k === 'A') {                           /* 仕/士：九宫内斜走一格 */
      var ad = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (kz = 0; kz < 4; kz++) {
        xx = x + ad[kz][0]; yy = y + ad[kz][1];
        if (inPalace(xx, yy, c)) push(xx, yy);
      }
    } else if (k === 'B') {                           /* 相/象：走田，塞象眼，不过河 */
      var bd4 = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
      for (kz = 0; kz < 4; kz++) {
        dx = bd4[kz][0]; dy = bd4[kz][1];
        xx = x + dx; yy = y + dy;
        if (!inBoard(xx, yy)) continue;
        if (!ownHalf(yy, c)) continue;                /* 不能过河 */
        if (this.g[this.idx(x + dx / 2, y + dy / 2)] !== EMPTY) continue;  /* 塞象眼 */
        push(xx, yy);
      }
    } else if (k === 'N') {                           /* 马：走日，蹩马腿 */
      var nd = [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
                [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]];
      for (kz = 0; kz < 8; kz++) {
        dx = nd[kz][0]; dy = nd[kz][1];
        xx = x + dx; yy = y + dy;
        if (!inBoard(xx, yy)) continue;
        if (this.g[this.idx(x + nd[kz][2], y + nd[kz][3])] !== EMPTY) continue; /* 蹩马腿 */
        push(xx, yy);
      }
    } else if (k === 'R') {                           /* 车：直线任意步，不能穿子 */
      slide(0, -1); slide(0, 1); slide(-1, 0); slide(1, 0);
    } else if (k === 'C') {                           /* 炮：不吃同车；吃须隔且只隔一个子 */
      cannon(0, -1); cannon(0, 1); cannon(-1, 0); cannon(1, 0);
    } else if (k === 'P') {                           /* 兵/卒：向前一格；过河后可左右 */
      var fwd = (c === RED) ? -1 : 1;
      push(x, y + fwd);
      if (crossed(y, c)) { push(x - 1, y); push(x + 1, y); }
    }
    return out;
  };
  /* ── 将帅照面：两将同列且中间无子 ⇒ 非法 ────────────────── */
  Board.prototype.kingsFace = function () {
    var rk = this.findKing(RED), bk = this.findKing(BLACK);
    if (rk < 0 || bk < 0) return false;
    var a = this.xy(rk), b = this.xy(bk);
    if (a.x !== b.x) return false;
    var lo = Math.min(a.y, b.y) + 1, hi = Math.max(a.y, b.y);
    for (var y = lo; y < hi; y++) if (this.g[this.idx(a.x, y)] !== EMPTY) return false;
    return true;
  };

  /* 某点是否被 byColor 攻击。用统一的 movesFrom 推导，不对某种棋子开特例 */
  Board.prototype.isAttacked = function (i, byColor) {
    for (var j = 0; j < N; j++) {
      if (this.g[j] !== byColor) continue;
      if (this.movesFrom(j).indexOf(i) >= 0) return true;
    }
    return false;
  };

  /* 某方的将是否处于被将军状态（含「将帅照面」视为被攻击） */
  Board.prototype.isChecked = function (color) {
    var k = this.findKing(color);
    if (k < 0) return true;                       /* 将没了，视为已被将死 */
    if (this.isAttacked(k, other(color))) return true;
    if (this.kingsFace()) return true;
    return false;
  };

  /* ── 走子 ──────────────────────────────────────────────────
   * bd.play(from, to, color)   或   bd.play({from, to}, color)
   * 返回 {ok:true, rec, captured} / {ok:false, reason}
   * 这里已经做了全部合法性校验（含送将、照面），所以 play 成功 == 着一手合法棋 */
  Board.prototype.play = function (a, b, c) {
    var from, to, color;
    if (a && typeof a === 'object') { from = a.from; to = a.to; color = b; }
    else { from = a; to = b; color = c; }

    if (from == null || to == null) return { ok: false, reason: 'bad-args' };
    if (from < 0 || from >= N || to < 0 || to >= N) return { ok: false, reason: 'out' };
    if (from === to) return { ok: false, reason: 'same' };
    if (this.g[from] !== color) return { ok: false, reason: 'nopiece' };
    /* 象棋里将/帅永远不被吃掉 —— 轮到谁走而对方的将没了，是「上将」之类的非法局面，
       胜负由 isMate 判定，不允许用「吃将」来结束对局 */
    if (this.t[to] === 'K') return { ok: false, reason: 'capture-king' };
    if (this.movesFrom(from).indexOf(to) < 0) return { ok: false, reason: 'shape' };

    var rec = {
      from: from, to: to, color: color,
      type: this.t[from],
      capSq: this.g[to] !== EMPTY ? to : -1,
      capColor: this.g[to],
      capType: this.t[to]
    };
    /* 落子 */
    this.g[to] = color; this.t[to] = this.t[from];
    this.g[from] = EMPTY; this.t[from] = null;
    /* 送将 / 照面 一律非法，原样撤回 */
    if (this.isChecked(color)) { this.undo(rec); return { ok: false, reason: 'self-check' }; }
    this.moves.push(rec);
    this.toMove = other(color);
    return { ok: true, rec: rec, captured: rec.capSq >= 0 ? [rec.capSq] : [] };
  };

  Board.prototype.undo = function (rec) {
    if (!rec) return;
    this.g[rec.from] = rec.color; this.t[rec.from] = rec.type;
    this.g[rec.to] = rec.capSq >= 0 ? rec.capColor : EMPTY;
    this.t[rec.to] = rec.capSq >= 0 ? rec.capType : null;
    if (this.moves.length && this.moves[this.moves.length - 1] === rec) this.moves.pop();
    this.toMove = rec.color;
  };

  /* 试走一手再撤回，看是否合法 */
  Board.prototype.isLegal = function (from, to, color) {
    var r = this.play(from, to, color);
    if (r.ok) { this.undo(r.rec); return true; }
    return false;
  };

  /* 某方全部合法着法，元素为 {from, to, cap}；顺序稳定（按起点、终点从小到大） */
  Board.prototype.legalMoves = function (color) {
    var out = [], i, j, ms;
    for (i = 0; i < N; i++) {
      if (this.g[i] !== color) continue;
      ms = this.movesFrom(i);
      for (j = 0; j < ms.length; j++) {
        var to = ms[j];
        if (this.isLegal(i, to, color)) out.push({ from: i, to: to, cap: this.g[to] !== EMPTY });
      }
    }
    return out;
  };

  /* 无合法着法 = 输。中国象棋里「困毙」同样算输，与围棋不同 —— 所以将死与
     困毙共用这一个判定，返回 true 即该方已负。 */
  Board.prototype.isMate = function (color) {
    if (this.findKing(color) < 0) return true;         /* 将已被吃/不在场 */
    return this.legalMoves(color).length === 0;
  };
  /* 语文上区分一下，方便界面显示「将死」还是「困毙」 */
  Board.prototype.isStalemate = function (color) {
    return this.isMate(color) && !this.isChecked(color);
  };

  /* 摆局面：[[x, y, color, type], ...]，color 用 'r'/'b'（也接受 1/2） */
  Board.prototype.setup = function (list) {
    this.g = new Int8Array(N);
    this.t = new Array(N);
    for (var i = 0; i < N; i++) this.t[i] = null;
    this.moves = [];
    this.toMove = RED;
    for (var k = 0; k < (list || []).length; k++) {
      var it = list[k];
      if (!it || it.length < 4) continue;
      var x = it[0], y = it[1], cc = it[2], tp = String(it[3]).toUpperCase();
      if (!inBoard(x, y)) throw new Error('setup: 越界坐标 (' + x + ',' + y + ')');
      if (!TYPES[tp]) throw new Error('setup: 未知棋子类型 ' + tp);
      var ci = (cc === 'r' || cc === 'R' || cc === RED) ? RED : BLACK;
      var q = this.idx(x, y);
      this.g[q] = ci; this.t[q] = tp;
    }
    return this;
  };

  /* 摆回标准开局（红在上、黑在下是约定？不 —— 本引擎 y 向上递减为红方方向：
     红方在下方 y=7..9，黑方在上方 y=0..2，与 toLabel「A1 左下」一致）*/
  Board.prototype.reset = function () {
    return this.setup(START_POSITION);
  };

  Board.prototype.pieces = function (color) {
    var out = [];
    for (var i = 0; i < N; i++) if (this.g[i] === (color || this.g[i]) && this.g[i] !== EMPTY) out.push(i);
    return out;
  };

  var START_POSITION = [
    [0, 0, 'b', 'R'], [1, 0, 'b', 'N'], [2, 0, 'b', 'B'], [3, 0, 'b', 'A'],
    [4, 0, 'b', 'K'], [5, 0, 'b', 'A'], [6, 0, 'b', 'B'], [7, 0, 'b', 'N'],
    [8, 0, 'b', 'R'],
    [1, 2, 'b', 'C'], [7, 2, 'b', 'C'],
    [0, 3, 'b', 'P'], [2, 3, 'b', 'P'], [4, 3, 'b', 'P'], [6, 3, 'b', 'P'], [8, 3, 'b', 'P'],
    [0, 9, 'r', 'R'], [1, 9, 'r', 'N'], [2, 9, 'r', 'B'], [3, 9, 'r', 'A'],
    [4, 9, 'r', 'K'], [5, 9, 'r', 'A'], [6, 9, 'r', 'B'], [7, 9, 'r', 'N'],
    [8, 9, 'r', 'R'],
    [1, 7, 'r', 'C'], [7, 7, 'r', 'C'],
    [0, 6, 'r', 'P'], [2, 6, 'r', 'P'], [4, 6, 'r', 'P'], [6, 6, 'r', 'P'], [8, 6, 'r', 'P']
  ];

  var XQ = {
    Board: Board,
    EMPTY: EMPTY, RED: RED, BLACK: BLACK,
    COLS: COLS, ROWS: ROWS, N: N,
    NAME: NAME,
    other: other,
    colorName: function (c) { return c === RED ? '红' : (c === BLACK ? '黑' : '空'); },
    typeName: function (t) { return NAME[t] || '空'; },
    /* 与围棋引擎同向：A1 在棋盘左下角；列 A–I 自左向右，行 1–10 自下而上 */
    toLabel: function (i) {
      var x = i % COLS, y = (i / COLS) | 0;
      return LETTERS[x] + (ROWS - y);
    },
    fromLabel: function (s) {
      var x = LETTERS.indexOf(String(s).charAt(0).toUpperCase());
      var rk = parseInt(String(s).slice(1), 10);
      if (x < 0 || !(rk >= 1 && rk <= ROWS)) return -1;
      return (ROWS - rk) * COLS + x;
    },
    START_POSITION: START_POSITION
  };
  /* ============================ 自检 ============================ */
  /* 每个结论都由 movesFrom / isChecked / legalMoves 统一推出，测试只是「核对」，
     不参与规则计算。坐标一律写成 bd.idx(x, y)，不手算下标。 */
  function selfTest(verbose) {
    var pass = 0, fail = 0;

    /* 中文按 2 个字符宽对齐（console.log 只认 %s，没有宽度填充） */
    function padW(s, w) {
      var wide = 0, i, ch;
      s = String(s);
      for (i = 0; i < s.length; i++) {
        ch = s.charCodeAt(i);
        wide += (ch > 0x2e80) ? 2 : 1;
      }
      while (wide < w) { s += ' '; wide++; }
      return s;
    }

    function run(name, setupFn, checkFn) {
      var bd = new XQ.Board(), info = {}, r;
      try {
        info = setupFn(bd) || {};
        r = checkFn(bd, info);
        if (!r || typeof r !== 'object') r = { ok: false, msg: '检查函数没返回结果' };
      } catch (e) {
        r = { ok: false, msg: '抛异常：' + e.message };
      }
      if (r.ok) pass++; else fail++;
      console.log('  %s %s %s', r.ok ? '✓' : '✗', padW(name, 30), r.msg);
      if (verbose && r.detail) console.log('      ' + r.detail);
    }

    /* 基础局面：红帅 E1(4,9)、黑将 D10(3,0)。两将不同列 ⇒ 不照面，可放心摆子 */
    function base(extra) { return [[4, 9, 'r', 'K'], [3, 0, 'b', 'K']].concat(extra || []); }
    function mv(bd, ax, ay, bx, by, color) {
      return bd.isLegal(bd.idx(ax, ay), bd.idx(bx, by), color === undefined ? XQ.RED : color);
    }

    /* ---------------- ① 七种棋子走法 ---------------- */
    run('车·直线可走', function (bd) {
      bd.setup(base([[0, 9, 'r', 'R']]));
    }, function (bd) {
      return { ok: mv(bd, 0, 9, 0, 0) === true, msg: 'A1→A10 = ' + mv(bd, 0, 9, 0, 0) };
    });

    run('车·不能穿子', function (bd) {
      bd.setup(base([[0, 9, 'r', 'R'], [0, 5, 'b', 'P']]));
    }, function (bd) {
      return { ok: mv(bd, 0, 9, 0, 0) === false, msg: '中间有子 A1→A10 = ' + mv(bd, 0, 9, 0, 0) };
    });

    run('马·走日可走', function (bd) {
      bd.setup(base([[2, 5, 'r', 'N']]));
    }, function (bd) {
      return { ok: mv(bd, 2, 5, 3, 3) === true, msg: 'C5→D7 = ' + mv(bd, 2, 5, 3, 3) };
    });

    run('马·蹩马腿不可走', function (bd) {
      bd.setup(base([[2, 5, 'r', 'N'], [2, 4, 'b', 'P']]));
    }, function (bd) {
      return { ok: mv(bd, 2, 5, 3, 3) === false, msg: '马腿 C6 有子 → C5→D7 = ' + mv(bd, 2, 5, 3, 3) };
    });

    run('象·走田可走', function (bd) {
      bd.setup(base([[2, 9, 'r', 'B']]));
    }, function (bd) {
      return { ok: mv(bd, 2, 9, 4, 7) === true, msg: 'C1→E3 = ' + mv(bd, 2, 9, 4, 7) };
    });

    run('象·塞象眼不可走', function (bd) {
      bd.setup(base([[2, 9, 'r', 'B'], [3, 8, 'b', 'P']]));
    }, function (bd) {
      return { ok: mv(bd, 2, 9, 4, 7) === false, msg: '象眼 D2 有子 → C1→E3 = ' + mv(bd, 2, 9, 4, 7) };
    });

    run('象·不能过河', function (bd) {
      bd.setup(base([[2, 5, 'r', 'B']]));
    }, function (bd) {
      return { ok: mv(bd, 2, 5, 4, 3) === false, msg: 'C5→E7（跨河）= ' + mv(bd, 2, 5, 4, 3) };
    });

    run('仕·九宫斜走可走', function (bd) {
      bd.setup(base([[4, 8, 'r', 'A']]));
    }, function (bd) {
      return { ok: mv(bd, 4, 8, 3, 9) === true, msg: 'E2→D1 = ' + mv(bd, 4, 8, 3, 9) };
    });

    run('仕·不能直走', function (bd) {
      bd.setup(base([[4, 8, 'r', 'A']]));
    }, function (bd) {
      return { ok: mv(bd, 4, 8, 5, 8) === false, msg: 'E2→F2（直走）= ' + mv(bd, 4, 8, 5, 8) };
    });

    run('帅·九宫直走可走', function (bd) {
      bd.setup(base([]));
    }, function (bd) {
      return { ok: mv(bd, 4, 9, 4, 8) === true, msg: 'E1→E2 = ' + mv(bd, 4, 9, 4, 8) };
    });

    run('帅·不能出九宫', function (bd) {
      bd.setup([[3, 9, 'r', 'K'], [4, 0, 'b', 'K']]);
    }, function (bd) {
      var out = mv(bd, 3, 9, 2, 9), inn = mv(bd, 3, 9, 3, 8);
      return { ok: out === false && inn === true, msg: 'D1→C1(出宫)=' + out + ' D1→D2(宫内)=' + inn };
    });

    run('炮·不吃子走法同车', function (bd) {
      bd.setup(base([[1, 9, 'r', 'C']]));
    }, function (bd) {
      return { ok: mv(bd, 1, 9, 1, 0) === true, msg: 'B1→B10（空路）= ' + mv(bd, 1, 9, 1, 0) };
    });

    run('炮·隔一子可吃', function (bd) {
      bd.setup(base([[1, 9, 'r', 'C'], [1, 5, 'b', 'P'], [1, 0, 'b', 'R']]));
    }, function (bd) {
      return { ok: mv(bd, 1, 9, 1, 0) === true, msg: '炮架 B6 隔一子吃 B10 = ' + mv(bd, 1, 9, 1, 0) };
    });

    run('炮·不能隔两子吃', function (bd) {
      bd.setup(base([[1, 9, 'r', 'C'], [1, 7, 'b', 'P'], [1, 5, 'b', 'P'], [1, 0, 'b', 'R']]));
    }, function (bd) {
      var two = mv(bd, 1, 9, 1, 0), one = mv(bd, 1, 9, 1, 5);
      return { ok: two === false && one === true, msg: '隔两子吃B10=' + two + ' 吃炮架B6=' + one };
    });

    run('兵·未过河只能向前', function (bd) {
      bd.setup(base([[4, 6, 'r', 'P']]));
    }, function (bd) {
      return { ok: mv(bd, 4, 6, 4, 5) === true, msg: 'E4→E5（向前）= ' + mv(bd, 4, 6, 4, 5) };
    });

    run('兵·未过河不能横走', function (bd) {
      bd.setup(base([[4, 6, 'r', 'P']]));
    }, function (bd) {
      return { ok: mv(bd, 4, 6, 3, 6) === false, msg: 'E4→D4（横走）= ' + mv(bd, 4, 6, 3, 6) };
    });

    run('兵·过河后可横走', function (bd) {
      bd.setup(base([[4, 4, 'r', 'P']]));
    }, function (bd) {
      var side = mv(bd, 4, 4, 3, 4), back = mv(bd, 4, 4, 4, 5);
      return { ok: side === true && back === false, msg: '过河横走E7→D7=' + side + ' 后退E7→E6=' + back };
    });

    /* ---------------- ② 将帅照面 / 送将 ---------------- */
    run('将帅照面·移开挡子即非法', function (bd) {
      bd.setup([[4, 9, 'r', 'K'], [4, 0, 'b', 'K'], [4, 5, 'r', 'R']]);
      return { face0: bd.kingsFace() };
    }, function (bd, o) {
      var away = mv(bd, 4, 5, 0, 5);
      var chip = new XQ.Board().setup([[4, 9, 'r', 'K'], [4, 0, 'b', 'K']]);
      return {
        ok: o.face0 === false && away === false && chip.kingsFace() === true,
        msg: '移开前照面=' + o.face0 + ' 移开后该着合法=' + away + ' 同列无子照面=' + chip.kingsFace()
      };
    });

    run('送将·暴露己将即非法', function (bd) {
      bd.setup([[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 0, 'b', 'R'], [4, 5, 'r', 'R']]);
      return { chk0: bd.isChecked(XQ.RED) };
    }, function (bd, o) {
      var away = mv(bd, 4, 5, 0, 5);      /* 让开 → 被黑车照将 */
      var stay = mv(bd, 4, 5, 4, 6);      /* 仍挡着 → 合法 */
      return {
        ok: o.chk0 === false && away === false && stay === true,
        msg: '移开前被将=' + o.chk0 + ' 送将该着合法=' + away + ' 保持阻挡合法=' + stay
      };
    });

    /* ---------------- ③ 将军 / 应将 ---------------- */
    run('将军·识别并只能应将', function (bd) {
      bd.setup([[4, 9, 'r', 'K'], [3, 0, 'b', 'K'], [4, 0, 'b', 'R']]);
      return {};
    }, function (bd) {
      var chk = bd.isChecked(XQ.RED);
      var list = bd.legalMoves(XQ.RED), bad = 0, i, r;
      for (i = 0; i < list.length; i++) {
        r = bd.play(list[i].from, list[i].to, XQ.RED);
        if (r.ok) { if (bd.isChecked(XQ.RED)) bad++; bd.undo(r.rec); }
      }
      return {
        ok: chk === true && list.length > 0 && bad === 0,
        msg: '被将=' + chk + ' 合法应着=' + list.length + ' 应后仍被将=' + bad
      };
    });

    /* ---------------- ④ 将死 / 困毙（都是输）---------------- */
    run('不允许吃将', function (bd) {
      bd.setup([[3, 9, 'r', 'K'], [4, 0, 'b', 'K'], [0, 0, 'r', 'R']]);
    }, function (bd) {
      var r = bd.play(bd.idx(0, 0), bd.idx(4, 0), XQ.RED);
      return { ok: r.ok === false && r.reason === 'capture-king', msg: '车吃将 → ' + (r.ok ? '被允许（错）' : r.reason) };
    });

    run('将死·无着且正被将 ⇒ 负', function (bd) {
      bd.setup([[4, 9, 'r', 'K'], [0, 0, 'r', 'R'], [4, 2, 'r', 'R'], [4, 0, 'b', 'K']]);
      return {};
    }, function (bd) {
      var mate = bd.isMate(XQ.BLACK), chk = bd.isChecked(XQ.BLACK);
      return { ok: mate === true && chk === true, msg: '无合法着=' + mate + ' 被将=' + chk };
    });

    run('困毙·无着但未被将 ⇒ 同样负', function (bd) {
      bd.setup([[3, 9, 'r', 'K'], [3, 2, 'r', 'R'], [5, 2, 'r', 'R'], [0, 1, 'r', 'R'], [4, 0, 'b', 'K']]);
      return {};
    }, function (bd) {
      var mate = bd.isMate(XQ.BLACK), chk = bd.isChecked(XQ.BLACK);
      return {
        ok: mate === true && chk === false,
        msg: '无合法着=' + mate + ' 被将=' + chk + '（困毙，按象棋规则算负）'
      };
    });

    /* ---------------- ⑤ 回滚 ---------------- */
    run('play/undo·局面完全回滚', function () {
      return {};
    }, function (bd) {
      bd.reset();
      var g0 = Array.prototype.slice.call(bd.g), t0 = bd.t.slice();
      var recs = [], color = XQ.RED, i, list, r;
      for (i = 0; i < 6; i++) {
        list = bd.legalMoves(color);
        r = bd.play(list[0].from, list[0].to, color);
        if (!r.ok) return { ok: false, msg: '第' + (i + 1) + '手意外非法：' + r.reason };
        recs.push(r.rec);
        color = XQ.other(color);
      }
      for (i = recs.length - 1; i >= 0; i--) bd.undo(recs[i]);
      var same = true;
      for (i = 0; i < bd.n; i++) if (bd.g[i] !== g0[i] || bd.t[i] !== t0[i]) same = false;
      return {
        ok: same && bd.moves.length === 0,
        msg: '走6手再逐手撤回：局面一致=' + same + ' 着法栈已空=' + (bd.moves.length === 0)
      };
    });

    /* ---------------- ⑥ 坐标与摆局 ---------------- */
    run('toLabel·E1 在左下角', function (bd) {
      bd.setup(XQ.START_POSITION);
    }, function (bd) {
      var a = XQ.toLabel(bd.idx(4, 9)), b = XQ.toLabel(bd.idx(4, 0)), c = XQ.toLabel(bd.idx(0, 0));
      var back = XQ.fromLabel(a) === bd.idx(4, 9);
      return { ok: a === 'E1' && b === 'E10' && c === 'A10' && back, msg: a + ' / ' + b + ' / ' + c + ' 反查=' + back };
    });

    run('标准开局·双方各 16 子且红先', function (bd) {
      bd.reset();
    }, function (bd) {
      var r = 0, b = 0, i;
      for (i = 0; i < bd.n; i++) { if (bd.g[i] === XQ.RED) r++; else if (bd.g[i] === XQ.BLACK) b++; }
      var ok = r === 16 && b === 16 && bd.isChecked(XQ.RED) === false && bd.isChecked(XQ.BLACK) === false
        && bd.legalMoves(XQ.RED).length === 44;
      return { ok: ok, msg: '红' + r + '子 黑' + b + '子 红方着法数=' + bd.legalMoves(XQ.RED).length };
    });

    console.log('');
    console.log('自检：通过 %d，失败 %d', pass, fail);
    return fail === 0;
  }

  XQ.selfTest = selfTest;

  if (typeof module !== 'undefined' && module.exports) module.exports = XQ;
  else global.XQ = XQ;

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    process.exit(selfTest(process.argv.indexOf('-v') >= 0) ? 0 : 1);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
