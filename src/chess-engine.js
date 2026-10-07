/* 国际象棋规则引擎 —— 纯规则，不含任何评估
 *
 * 为什么自己写：
 *   项目要完全离线（打包成单文件、零依赖），不能引第三方棋库。
 *   象棋、将棋两个板块都是自己写的引擎，这里保持同一套路。
 *
 * 坐标口径（**与其他三个棋种都不通用，别记混**）：
 *   内部 [x, y]，x = 0..7 对应 a..h 列，y = 0..7 对应第 8..1 行（y=0 是顶边、黑方那一边）。
 *   所以 a1 = (0,7)、h8 = (7,0)、e1 = (4,7)、e8 = (4,0)。
 *   对外用国际通行的代数记法：toLabel/fromLabel。
 *
 * 规则覆盖：
 *   · 六种棋子的走法（兵、马、象、车、后、王）
 *   · 兵：首步可走两格、斜吃、**吃过路兵**、升变（后/车/象/马）
 *   · **王车易位**（短易位、长易位，含「路径不能被打、不能穿过被攻击格、不能正被将」三条限制）
 *   · 将军 / 将杀 / 逼和（stalemate）判定
 *   · 合法性：任何让自己王被吃的走法都不合法（含牵制）—— 由「试走后检查」实现，不特判
 *
 * 未实现（与象棋、将棋两个引擎保持同一条口子）：
 *   ① 五十回合自然限着、三次重复局面（和棋规则）—— 需要历史记录，本轮不做
 *   ② 局面不足判和（单王对单王等）
 *   打分/评估、开局库、搜索 —— 这里只做规则。
 */
'use strict';

var CHESS = (function () {

  var SIZE = 8, N = 64;
  var EMPTY = 0, WHITE = 1, BLACK = 2;

  var FILES = 'abcdefgh';
  var TYPES = ['K', 'Q', 'R', 'B', 'N', 'P'];

  /* 棋子名字：中文与英文都要，题库和讲解都要用 */
  var CN = {
    w: { K: '王', Q: '后', R: '车', B: '象', N: '马', P: '兵' },
    b: { K: '王', Q: '后', R: '车', B: '象', N: '马', P: '兵' }
  };
  var EN = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
  /* 代数记法的字母（兵吃子、以及升变的写法和中文讲法都不同） */
  var SAN = { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N', P: '' };

  var colorOf = function (s) {
    if (s === WHITE || s === 'w' || s === 'W' || s === 'white') return WHITE;
    if (s === BLACK || s === 'b' || s === 'B' || s === 'black') return BLACK;
    return WHITE;
  };
  /* ★ 这三个必须**先归一化再判断**，不能写成 `c === WHITE ? ... : ...`。
     写成后者的话，传字符串（'w'/'b'）时 'b' !== WHITE 会落到 else 分支 ——
     `other('b')` 返回白方、`other('w')` 也返回白方，**两种写法都得到白方**，
     而且一声不响。页面里「换一边点评」这类开关就会静默失效（2026-09-29 踩过）。
     自检里有「两种写法必须等价」那一条把这个钉住。 */
  var other = function (c) { return colorOf(c) === WHITE ? BLACK : WHITE; };
  var colorChar = function (c) { return colorOf(c) === WHITE ? 'w' : 'b'; };
  var colorName = function (c) { return colorOf(c) === WHITE ? '白方' : '黑方'; };

  function pieceName(type, color) {
    return (colorOf(color) === WHITE ? CN.w : CN.b)[type] || type;
  }
  function pieceNameEn(type) { return EN[type] || type; }

  /* [x, y] → 'e4' 之类 */
  function toLabel(x, y) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return '??';
    return FILES.charAt(x) + (SIZE - y);
  }
  function toLabelI(i) { return toLabel(i % SIZE, (i / SIZE) | 0); }

  /* 'e4' → [x, y]；认不出返回 null */
  function fromLabel(s) {
    if (!s || s.length < 2) return null;
    var x = FILES.indexOf(String(s).charAt(0).toLowerCase());
    var r = parseInt(String(s).slice(1), 10);
    if (x < 0 || !(r >= 1 && r <= SIZE)) return null;
    return [x, SIZE - r];
  }
  function fromLabelI(s) {
    var p = fromLabel(s);
    return p ? p[1] * SIZE + p[0] : -1;
  }

  /* ---------------- 局面 ---------------- */

  function Board() {
    this.g = new Uint8Array(N);        /* 颜色 */
    this.t = new Array(N).fill(null);  /* 类型 */
    this.toMove = WHITE;
    /* 易位权：K/Q = 白方短/长，k/q = 黑方。字符串里有的字母就还有权 */
    this.castling = 'KQkq';
    this.ep = -1;                      /* 吃过路兵的目标格（下标），没有就是 -1 */
    this.halfmove = 0;                 /* 半回合计数（五十回合规则用，本轮只是记着） */
    this.fullmove = 1;
    this.moves = [];                   /* 走子栈，供 undo */
  }

  Board.prototype.idx = function (x, y) { return y * SIZE + x; };
  Board.prototype.xy = function (i) { return { x: i % SIZE, y: (i / SIZE) | 0 }; };
  Board.prototype.at = function (i) { return this.g[i]; };
  Board.prototype.typeAt = function (i) { return this.t[i]; };

  Board.prototype.setup = function (pieces, toMove, castling) {
    this.g = new Uint8Array(N);
    this.t = new Array(N).fill(null);
    this.ep = -1; this.halfmove = 0; this.fullmove = 1;
    this.moves = [];
    for (var k = 0; k < pieces.length; k++) {
      var p = pieces[k];
      var i = this.idx(p[0], p[1]);
      this.g[i] = colorOf(p[2]);
      this.t[i] = p[3];
    }
    this.toMove = toMove ? colorOf(toMove) : WHITE;
    this.castling = (castling === undefined || castling === null) ? '' : String(castling);
  };

  Board.prototype.reset = function () {
    this.setup(START_POSITION, WHITE, 'KQkq');
  };

  /* 初始局面。内部 y=0 是第 8 行，所以黑方（8/7 行）在上半、白方（2/1 行）在下半。 */
  var START_POSITION = (function () {
    var out = [];
    var back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (var x = 0; x < 8; x++) {
      out.push([x, 0, 'b', back[x]]);       /* 黑方底线（第 8 行） */
      out.push([x, 1, 'b', 'P']);           /* 黑兵（第 7 行） */
      out.push([x, 6, 'w', 'P']);           /* 白兵（第 2 行） */
      out.push([x, 7, 'w', back[x]]);       /* 白方底线（第 1 行） */
    }
    return out;
  })();

  /* ---------------- 走法生成 ---------------- */

  var _KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var _KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var _BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var _ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function inside(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }

  /* 白兵往上走（y 减小），黑兵往下走（y 增大） */
  function pawnDir(color) { return colorOf(color) === WHITE ? -1 : 1; }
  function startRank(color) { return colorOf(color) === WHITE ? 6 : 1; }
  function promoRank(color) { return colorOf(color) === WHITE ? 0 : 7; }

  /* 某一格是否被 who 方攻击 —— 注意是「攻击」不是「能合法走到」：
     兵只看斜前两格、王只看邻格、滑行棋子遇到第一个子（不论颜色）就停。 */
  Board.prototype.isAttacked = function (i, who) {
    who = colorOf(who);
    var p = this.xy(i), x = p.x, y = p.y, k, d, xx, yy, j;

    /* 兵：白兵从「下往上」吃，所以攻击 (x, y) 的白兵在 (x±1, y+1) */
    var pd = who === WHITE ? 1 : -1;
    for (k = -1; k <= 1; k += 2) {
      xx = x + k; yy = y + pd;
      if (inside(xx, yy)) {
        j = this.idx(xx, yy);
        if (this.g[j] === who && this.t[j] === 'P') return true;
      }
    }
    /* 马 */
    for (k = 0; k < 8; k++) {
      xx = x + _KNIGHT[k][0]; yy = y + _KNIGHT[k][1];
      if (!inside(xx, yy)) continue;
      j = this.idx(xx, yy);
      if (this.g[j] === who && this.t[j] === 'N') return true;
    }
    /* 王 */
    for (k = 0; k < 8; k++) {
      xx = x + _KING[k][0]; yy = y + _KING[k][1];
      if (!inside(xx, yy)) continue;
      j = this.idx(xx, yy);
      if (this.g[j] === who && this.t[j] === 'K') return true;
    }
    /* 斜线：象 / 后 */
    for (d = 0; d < 4; d++) {
      xx = x + _BISHOP[d][0]; yy = y + _BISHOP[d][1];
      while (inside(xx, yy)) {
        j = this.idx(xx, yy);
        if (this.g[j]) {
          if (this.g[j] === who && (this.t[j] === 'B' || this.t[j] === 'Q')) return true;
          break;
        }
        xx += _BISHOP[d][0]; yy += _BISHOP[d][1];
      }
    }
    /* 直线：车 / 后 */
    for (d = 0; d < 4; d++) {
      xx = x + _ROOK[d][0]; yy = y + _ROOK[d][1];
      while (inside(xx, yy)) {
        j = this.idx(xx, yy);
        if (this.g[j]) {
          if (this.g[j] === who && (this.t[j] === 'R' || this.t[j] === 'Q')) return true;
          break;
        }
        xx += _ROOK[d][0]; yy += _ROOK[d][1];
      }
    }
    return false;
  };

  Board.prototype.findKing = function (color) {
    color = colorOf(color);
    for (var i = 0; i < N; i++) if (this.g[i] === color && this.t[i] === 'K') return i;
    return -1;
  };

  Board.prototype.isChecked = function (color) {
    color = colorOf(color);
    var k = this.findKing(color);
    if (k < 0) return false;
    return this.isAttacked(k, other(color));
  };

  /* 伪合法着法（不管自己的王会不会因此被吃） */
  Board.prototype.pseudoMoves = function (color) {
    color = colorOf(color);
    var out = [], i, x, y, k, d, xx, yy, j, t, p;
    for (i = 0; i < N; i++) {
      if (this.g[i] !== color) continue;
      p = this.xy(i); x = p.x; y = p.y; t = this.t[i];

      if (t === 'P') {
        var dir = pawnDir(color), sr = startRank(color), pr = promoRank(color);
        /* 前进一格 */
        yy = y + dir;
        if (inside(x, yy) && !this.g[this.idx(x, yy)]) {
          out.push({ from: i, to: this.idx(x, yy), promo: null });
          /* 前进两格（只在起步位置、且中间是空的） */
          if (y === sr && !this.g[this.idx(x, y + 2 * dir)]) {
            out.push({ from: i, to: this.idx(x, y + 2 * dir), promo: null });
          }
        }
        /* 斜吃 */
        for (k = -1; k <= 1; k += 2) {
          xx = x + k; yy = y + dir;
          if (!inside(xx, yy)) continue;
          j = this.idx(xx, yy);
          if ((this.g[j] && this.g[j] !== color) || j === this.ep) {
            out.push({ from: i, to: j, promo: null });
          }
        }
        continue;
      }

      if (t === 'N' || t === 'K') {
        var steps = (t === 'N') ? _KNIGHT : _KING;
        for (k = 0; k < steps.length; k++) {
          xx = x + steps[k][0]; yy = y + steps[k][1];
          if (!inside(xx, yy)) continue;
          j = this.idx(xx, yy);
          if (this.g[j] === color) continue;
          out.push({ from: i, to: j, promo: null });
        }
        continue;
      }

      var dirs = (t === 'B') ? _BISHOP : (t === 'R') ? _ROOK : _BISHOP.concat(_ROOK);
      for (d = 0; d < dirs.length; d++) {
        xx = x + dirs[d][0]; yy = y + dirs[d][1];
        while (inside(xx, yy)) {
          j = this.idx(xx, yy);
          if (this.g[j] === color) break;
          out.push({ from: i, to: j, promo: null });
          if (this.g[j]) break;
          xx += dirs[d][0]; yy += dirs[d][1];
        }
      }
    }

    /* 王车易位。三条限制缺一不可（见 movement 的注释） */
    var homeY = (color === WHITE) ? 7 : 0;
    var rights = color === WHITE ? ['K', 'Q'] : ['k', 'q'];
    var kingI = this.idx(4, homeY);
    if (this.g[kingI] === color && this.t[kingI] === 'K' && !this.isAttacked(kingI, other(color))) {
      /* 短易位：f、g 两格空，且王经过的 e、f、g 都不能被攻击 */
      if (this.castling.indexOf(rights[0]) >= 0 &&
        !this.g[this.idx(5, homeY)] && !this.g[this.idx(6, homeY)] &&
        this.t[this.idx(7, homeY)] === 'R' && this.g[this.idx(7, homeY)] === color &&
        !this.isAttacked(this.idx(5, homeY), other(color)) &&
        !this.isAttacked(this.idx(6, homeY), other(color))) {
        out.push({ from: kingI, to: this.idx(6, homeY), castle: 'K', promo: null });
      }
      /* 长易位：b、c、d 三格空，且王经过的 e、d、c 都不能被攻击 */
      if (this.castling.indexOf(rights[1]) >= 0 &&
        !this.g[this.idx(1, homeY)] && !this.g[this.idx(2, homeY)] && !this.g[this.idx(3, homeY)] &&
        this.t[this.idx(0, homeY)] === 'R' && this.g[this.idx(0, homeY)] === color &&
        !this.isAttacked(this.idx(3, homeY), other(color)) &&
        !this.isAttacked(this.idx(2, homeY), other(color))) {
        out.push({ from: kingI, to: this.idx(2, homeY), castle: 'Q', promo: null });
      }
    }

    /* 兵的升变：走到最后一格时展开成四种选择 */
    var final = [];
    for (k = 0; k < out.length; k++) {
      var m = out[k];
      var mt = this.t[m.from];
      if (mt === 'P' && (m.to / SIZE | 0) === promoRank(color)) {
        ['Q', 'R', 'B', 'N'].forEach(function (ty) {
          final.push({ from: m.from, to: m.to, promo: ty, castle: null });
        });
      } else {
        final.push(m);
      }
    }
    return final;
  };

  /* 合法着法 = 伪合法 － 走完自己王被吃的 */
  Board.prototype.legalMoves = function (color) {
    color = colorOf(color);
    var out = [], ms = this.pseudoMoves(color), i;
    for (i = 0; i < ms.length; i++) {
      var r = this.play(ms[i].from, ms[i].to, color, ms[i].promo, ms[i].castle);
      if (r.ok && !this.isChecked(color)) out.push(ms[i]);
      if (r.ok) this.undo(r.rec);
    }
    return out;
  };

  /* 走一手。返回 { ok, rec, captured }。不合法返回 { ok:false, reason }。
     promote: 'Q'/'R'/'B'/'N' 或 null；castle: 'K'/'Q' 或 null。 */
  Board.prototype.play = function (from, to, color, promote, castle) {
    color = colorOf(color);
    if (this.g[from] !== color) return { ok: false, reason: 'no-piece' };
    if (from === to) return { ok: false, reason: 'same-square' };
    var type = this.t[from];

    /* 用生成的着法表校验 —— 这样「兵能不能斜走」「易位路径通不通」这类规则
       只有一处实现，不会出现两个地方各写一套、慢慢走岔的情况。 */
    var legalHere = null, ms = this.pseudoMoves(color), k;
    for (k = 0; k < ms.length; k++) {
      if (ms[k].from === from && ms[k].to === to) {
        if (type === 'P' && (to / SIZE | 0) === promoRank(color)) {
          if (ms[k].promo === (promote || 'Q')) { legalHere = ms[k]; break; }
        } else if (ms[k].castle === (castle || null)) { legalHere = ms[k]; break; }
        else if (!ms[k].castle && !castle) { legalHere = ms[k]; break; }
      }
    }
    if (!legalHere) return { ok: false, reason: 'illegal' };

    var rec = {
      from: from, to: to, color: color, type: type,
      capI: (this.g[to] ? to : -1), capT: this.t[to],
      epCapI: -1, epCapT: null,
      castle: legalHere.castle || null,
      promo: (type === 'P' && (to / SIZE | 0) === promoRank(color)) ? (promote || 'Q') : null,
      prevEp: this.ep, prevCastling: this.castling,
      prevHalf: this.halfmove
    };

    /* 吃过路兵：兵斜走、落点是空格、而这个空格正是「过路兵目标格」 */
    if (type === 'P' && (to % SIZE) !== (from % SIZE) && !this.g[to] && to === this.ep) {
      var capI = this.idx(to % SIZE, (from / SIZE) | 0);
      rec.epCapI = capI; rec.epCapT = this.t[capI];
      this.g[capI] = EMPTY; this.t[capI] = null;
    }

    this.g[to] = color; this.t[to] = rec.promo ? rec.promo : type;
    this.g[from] = EMPTY; this.t[from] = null;

    /* 王车易位：车也要跟着动 */
    if (rec.castle) {
      var hy = (color === WHITE) ? 7 : 0;
      if (rec.castle === 'K') {
        this.g[this.idx(5, hy)] = color; this.t[this.idx(5, hy)] = 'R';
        this.g[this.idx(7, hy)] = EMPTY; this.t[this.idx(7, hy)] = null;
      } else {
        this.g[this.idx(3, hy)] = color; this.t[this.idx(3, hy)] = 'R';
        this.g[this.idx(0, hy)] = EMPTY; this.t[this.idx(0, hy)] = null;
      }
    }

    /* 易位权：王动过就全没了；车动过 / 车被吃，对应那一边没了 */
    var c = this.castling;
    if (type === 'K') {
      c = color === WHITE ? c.replace(/[KQ]/g, '') : c.replace(/[kq]/g, '');
    } else if (type === 'R') {
      if (from === this.idx(0, 7)) c = c.replace('Q', '');
      if (from === this.idx(7, 7)) c = c.replace('K', '');
      if (from === this.idx(0, 0)) c = c.replace('q', '');
      if (from === this.idx(7, 0)) c = c.replace('k', '');
    }
    if (to === this.idx(0, 7)) c = c.replace('Q', '');
    if (to === this.idx(7, 7)) c = c.replace('K', '');
    if (to === this.idx(0, 0)) c = c.replace('q', '');
    if (to === this.idx(7, 0)) c = c.replace('k', '');
    this.castling = c;

    /* 过路兵目标格：只有「兵从起步位置走两格」才会产生 */
    this.ep = -1;
    if (type === 'P' && Math.abs((to / SIZE | 0) - (from / SIZE | 0)) === 2) {
      this.ep = this.idx(from % SIZE, ((from / SIZE | 0) + (to / SIZE | 0)) / 2);
    }

    /* 半回合计数：吃子或动兵就归零 */
    this.halfmove = (type === 'P' || rec.capI >= 0 || rec.epCapI >= 0) ? 0 : this.halfmove + 1;
    if (color === BLACK) this.fullmove++;
    this.toMove = other(color);
    this.moves.push(rec);

    return { ok: true, rec: rec, captured: rec.capI >= 0 ? 1 : (rec.epCapI >= 0 ? 1 : 0) };
  };

  /* 悔棋必须把**所有**被改过的状态还回去：盘面、易位权、过路兵格、
     半回合计数、行棋方、fullmove。少还一个，后面整盘都会慢慢歪掉。 */
  Board.prototype.undo = function (rec) {
    if (!rec) return;
    var i;
    this.g[rec.from] = rec.color; this.t[rec.from] = rec.type;
    this.g[rec.to] = EMPTY; this.t[rec.to] = null;
    if (rec.capI >= 0) { this.g[rec.capI] = other(rec.color); this.t[rec.capI] = rec.capT; }
    if (rec.epCapI >= 0) { this.g[rec.epCapI] = other(rec.color); this.t[rec.epCapI] = rec.epCapT; }
    if (rec.castle) {
      var hy = (rec.color === WHITE) ? 7 : 0;
      if (rec.castle === 'K') {
        this.g[this.idx(7, hy)] = rec.color; this.t[this.idx(7, hy)] = 'R';
        this.g[this.idx(5, hy)] = EMPTY; this.t[this.idx(5, hy)] = null;
      } else {
        this.g[this.idx(0, hy)] = rec.color; this.t[this.idx(0, hy)] = 'R';
        this.g[this.idx(3, hy)] = EMPTY; this.t[this.idx(3, hy)] = null;
      }
    }
    this.ep = rec.prevEp;
    this.castling = rec.prevCastling;
    this.halfmove = rec.prevHalf;
    this.toMove = rec.color;
    if (rec.color === BLACK) this.fullmove--;
    this.moves.pop();
  };

  Board.prototype.isMate = function (color) {
    color = colorOf(color);
    return this.isChecked(color) && this.legalMoves(color).length === 0;
  };
  Board.prototype.isStalemate = function (color) {
    color = colorOf(color);
    return !this.isChecked(color) && this.legalMoves(color).length === 0;
  };

  /* 王的位置（给「王的安全」这类点评用） */
  Board.prototype.kingSquare = function (color) { return this.findKing(color); };

  /* 子力统计：盘上各方的棋子（升变后的算升变后的类型） */
  Board.prototype.pieces = function () {
    var out = [];
    for (var i = 0; i < N; i++) {
      if (!this.g[i]) continue;
      out.push([i % SIZE, (i / SIZE) | 0, colorChar(this.g[i]), this.t[i]]);
    }
    return out;
  };

  /* 子力点数（只用于很粗略的提示，不做评估） */
  Board.prototype.material = function (color) {
    color = colorOf(color);
    var V = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 }, s = 0;
    for (var i = 0; i < N; i++) if (this.g[i] === color) s += V[this.t[i]] || 0;
    return s;
  };

  /* ---------------- 代数记法解析 ----------------
     页面与校验器**共用这一份**。各写一套的话两边会慢慢走岔 ——
     校验说「这条手顺能走通」而页面走不通，那校验就白做了。

     支持的写法（够本项目的数据文件用）：
       e2-e4 / e2e4 / e4 / Nf3 / Nxf3 / exd5 / O-O / O-O-O / e8=Q / exd8=N
     不支持：完整 SAN 的消歧里那些少见形式、+ / # 会直接忽略。
     两个同型子都能到同一格时，用列或行前缀消歧（如 Nbd2、R1e2）。 */
  Board.prototype.parseMove = function (str) {
    var s = String(str || '').trim();
    if (!s) return null;
    var bd = this, k;

    var e = /^([a-h])([1-8])[-x]?([a-h])([1-8])(=?[QRBN])?$/.exec(s);
    if (e) {
      var a = fromLabelI(e[1] + e[2]), b = fromLabelI(e[3] + e[4]);
      if (a < 0 || b < 0) return null;
      return { from: a, to: b, promo: e[5] ? e[5].replace('=', '') : null, castle: null };
    }

    var txt = s.replace(/[+#!?]/g, '').replace(/e\.p\./gi, '').replace(/x/g, '');
    if (/^(O-O-O|0-0-0)$/i.test(txt)) return { castle: 'Q', from: -1, to: -1, promo: null };
    if (/^(O-O|0-0)$/i.test(txt)) return { castle: 'K', from: -1, to: -1, promo: null };

    var m = /^([KQRBN]?)([a-h]?)([1-8]?)([a-h][1-8])([QRBN]?)$/.exec(txt);
    if (!m) return null;
    var type = m[1] || 'P';
    var to = fromLabelI(m[4]);
    if (to < 0) return null;
    var ms = this.legalMoves(this.toMove), cands = [];
    for (k = 0; k < ms.length; k++) {
      var mv = ms[k];
      if (mv.to !== to || mv.castle) continue;
      if (this.t[mv.from] !== type) continue;
      if (m[2] && FILES.charAt(mv.from % 8) !== m[2]) continue;
      if (m[3] && String(8 - ((mv.from / 8) | 0)) !== m[3]) continue;
      if (m[5] && mv.promo !== m[5]) continue;
      cands.push(mv);
    }
    if (!cands.length) return null;
    return { from: cands[0].from, to: cands[0].to, promo: cands[0].promo || null, castle: cands[0].castle || null };
  };

  /* 把一手走法写成代数记法（简版，够页面显示用） */
  Board.prototype.moveLabel = function (from, to, castle) {
    if (castle) return castle === 'K' ? 'O-O' : 'O-O-O';
    return toLabelI(from) + '-' + toLabelI(to);
  };

  return {
    SIZE: SIZE, N: N, EMPTY: EMPTY, WHITE: WHITE, BLACK: BLACK,
    FILES: FILES, TYPES: TYPES, START_POSITION: START_POSITION,
    Board: Board,
    other: other, colorChar: colorChar, colorName: colorName, colorOf: colorOf,
    pieceName: pieceName, pieceNameEn: pieceNameEn, SAN: SAN,
    toLabel: toLabel, toLabelI: toLabelI, fromLabel: fromLabel, fromLabelI: fromLabelI
  };
})();

/* ============================ 自检 ============================ */
/* 引擎不可信，后面所有的题、所有的讲解就都不可信。
   这些用例用**规则本身**做判据（不是拿引擎的输出当答案），
   每一条都是「规则书里明写的东西」。 */
function chessSelfTest(verbose) {
  var CH = CHESS;
  var pass = 0, fail = 0;

  function run(name, setup, fn) {
    var bd = new CH.Board();
    if (setup) setup(bd);
    var got;
    try { got = fn(bd); } catch (e) { got = { ok: false, msg: '抛异常：' + e.message }; }
    if (got && got.ok) { pass++; if (verbose) console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + '   ' + ((got && got.msg) || '')); }
  }

  /* 造一个只有王的局面，方便单独测某种棋子 */
  function base(pieces) {
    return [[4, 0, 'b', 'K'], [4, 7, 'w', 'K']].concat(pieces || []);
  }
  function mk() { var bd = new CH.Board(); bd.setup(base()); return bd; }

  /* --- 初始局面 --- */
  run('初形：白方 20 手合法着法', function (bd) { bd.setup(CH.START_POSITION, CH.WHITE, 'KQkq'); },
    function (bd) {
      var n = bd.legalMoves(CH.WHITE).length;
      return { ok: n === 20, msg: '实际 ' + n + ' 手' };
    });
  run('初形：双方各 16 子', function (bd) { bd.setup(CH.START_POSITION, CH.WHITE, 'KQkq'); },
    function (bd) {
      return { ok: bd.pieces().filter(function (p) { return p[2] === 'w'; }).length === 16 &&
        bd.pieces().filter(function (p) { return p[2] === 'b'; }).length === 16, msg: '棋子数不对' };
    });
  run('初形：e2-e4 能走两格', function (bd) { bd.setup(CH.START_POSITION, CH.WHITE, 'KQkq'); },
    function (bd) {
      var r = bd.play(bd.idx(4, 6), bd.idx(4, 4), CH.WHITE);
      var okp = r.ok && bd.t[bd.idx(4, 4)] === 'P' && bd.ep === bd.idx(4, 5);
      if (r.ok) bd.undo(r.rec);
      return { ok: okp, msg: '走完 ep 应为 e3，实际 ' + CH.toLabelI(bd.ep) };
    });

  /* --- 坐标 --- */
  run('坐标：a1 是 (0,7)、h8 是 (7,0)', null, function () {
    return { ok: CH.toLabel(0, 7) === 'a1' && CH.toLabel(7, 0) === 'h8' &&
      CH.fromLabelI('e4') === 4 * 8 + 4, msg: 'a1=' + CH.toLabel(0, 7) + ' h8=' + CH.toLabel(7, 0) };
  });

  /* --- 马的走法 --- */
  run('马：中心八面威风，角落只有两格', function (bd) { bd.setup(base([[3, 3, 'w', 'N']])); },
    function (bd) {
      var c = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(3, 3); }).length;
      var bd2 = new CH.Board(); bd2.setup(base([[0, 0, 'w', 'N']]));
      var e = bd2.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd2.idx(0, 0); }).length;
      return { ok: c === 8 && e === 2, msg: '中心 ' + c + ' 格、角落 ' + e + ' 格' };
    });

  /* --- 滑行棋子被挡 --- */
  run('车：被己方子挡住就停', function (bd) { bd.setup(base([[0, 7, 'w', 'R'], [0, 6, 'w', 'P']])); },
    function (bd) {
      /* a1 的车：沿 a 列往上被 a2 的自家兵挡住（0 格）；
         沿第 1 行往右 b1 c1 d1 三格，再往右是自家王 e1。共 3。 */
      var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(0, 7); });
      return { ok: ms.length === 3, msg: '车走了 ' + ms.length + ' 格（应为 3）' };
    });

  /* --- 兵 --- */
  run('兵：斜前方有敌子才能吃', function (bd) {
    bd.setup(base([[3, 4, 'w', 'P'], [2, 3, 'b', 'P'], [4, 3, 'b', 'N']]));
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(3, 4); });
    return { ok: ms.length === 3, msg: '兵走了 ' + ms.length + ' 种（应为 3：直进 1 + 斜吃 2）' };
  });
  run('兵：正前方有敌子不能直进、也不能斜吃', function (bd) {
    bd.setup(base([[3, 4, 'w', 'P'], [3, 3, 'b', 'P']]));
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(3, 4); });
    return { ok: ms.length === 0, msg: '兵居然有 ' + ms.length + ' 种走法' };
  });
  run('兵：走到底线必须升变（展开四种）', function (bd) {
    /* 王要摆远 —— base() 把黑王放在 e8，白兵在 d7 时正好能斜吃它，
       那样会多出四种「吃王升变」，看起来像引擎多给了（实测踩过）。 */
    bd.setup([[0, 0, 'b', 'K'], [7, 7, 'w', 'K'], [3, 1, 'w', 'P']], CH.WHITE, '');
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(3, 1); });
    return { ok: ms.length === 4, msg: '升变只有 ' + ms.length + ' 种（应为 4）' };
  });

  /* --- 吃过路兵 --- */
  run('吃过路兵：白兵能从 d5 吃到 c6 的空格',
    function (bd) {
      /* 白兵 d5；黑兵 c7 起步走两格到 c5，中间的 c6 成为「过路兵目标格」 */
      bd.setup([[4, 0, 'b', 'K'], [7, 7, 'w', 'K'], [3, 3, 'w', 'P'], [2, 1, 'b', 'P']], CH.BLACK, '');
    },
    function (bd) {
      var r = bd.play(bd.idx(2, 1), bd.idx(2, 3), CH.BLACK);      /* 黑兵 c7→c5 走两格 */
      if (!r.ok) return { ok: false, msg: '黑兵走不了：' + r.reason };
      var epI = bd.idx(2, 2);                                      /* 过路兵目标格 c6 */
      var r2 = bd.play(bd.idx(3, 3), epI, CH.WHITE);               /* 白兵 d5 斜吃 c6 */
      var okp = r2.ok && r2.rec.epCapI === bd.idx(2, 3) && bd.g[bd.idx(2, 3)] === CH.EMPTY;
      return { ok: okp, msg: r2.ok ? ('吃过路兵没吃对：epCapI=' + r2.rec.epCapI) : ('走不了：' + r2.reason) };
    });

  /* --- 王车易位 --- */
  run('短易位：一切就绪时成立', function (bd) {
    bd.setup([[4, 0, 'b', 'K'], [0, 0, 'b', 'R'], [4, 7, 'w', 'K'], [7, 7, 'w', 'R']], CH.WHITE, 'K');
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.castle === 'K'; });
    return { ok: ms.length === 1 && ms[0].to === bd.idx(6, 7), msg: '短易位着法 ' + ms.length + ' 个' };
  });
  run('短易位：f1 被攻击时不能走', function (bd) {
    bd.setup([[4, 0, 'b', 'K'], [5, 0, 'b', 'R'], [4, 7, 'w', 'K'], [7, 7, 'w', 'R']], CH.WHITE, 'K');
  }, function (bd) {
    /* 黑车在 f8 盯着 f1 —— 王要经过 f1，所以不能易位 */
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.castle === 'K'; });
    return { ok: ms.length === 0, msg: '竟然还能易位' };
  });
  run('长易位：b1、c1、d1 全空才成立', function (bd) {
    bd.setup([[4, 0, 'b', 'K'], [4, 7, 'w', 'K'], [0, 7, 'w', 'R']], CH.WHITE, 'Q');
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.castle === 'Q'; });
    return { ok: ms.length === 1 && ms[0].to === bd.idx(2, 7), msg: '长易位 ' + ms.length + ' 个' };
  });
  run('长易位：b1 被占就不能走', function (bd) {
    /* ★ 长易位要求 b1 也是空的（不只是 c1、d1）——
       易位之后车要从 a1 走到 d1，b1、c1、d1 都得让开。 */
    bd.setup([[4, 0, 'b', 'K'], [4, 7, 'w', 'K'], [0, 7, 'w', 'R'], [1, 7, 'w', 'N']], CH.WHITE, 'Q');
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.castle === 'Q'; });
    return { ok: ms.length === 0, msg: 'b1 有子竟然还能长易位（' + ms.length + ' 个）' };
  });

  /* --- 将 / 将杀 / 逼和 --- */
  run('将杀：后排杀（车 + 王封锁）', function (bd) {
    bd.setup([[4, 0, 'b', 'K'], [0, 0, 'w', 'R'], [7, 0, 'w', 'R'], [4, 2, 'w', 'K']], CH.WHITE, '');
  }, function (bd) {
    /* 黑王 e8；白车 a8、h8 封住第 8 行（a8 车直接将军）；白王 e6 封住 d7/e7/f7 三格 */
    var chk = bd.isChecked(CH.BLACK);
    var mate = bd.isMate(CH.BLACK);
    return { ok: chk && mate, msg: '被将=' + chk + ' 被将杀=' + mate + '（合法着法 ' + bd.legalMoves(CH.BLACK).length + '）' };
  });
  run('逼和：黑王没被将但一步也走不了', function (bd) {
    /* 黑王 a8；白后 c7、白王任意远 —— 经典逼和形 */
    bd.setup([[0, 0, 'b', 'K'], [2, 1, 'w', 'Q'], [7, 7, 'w', 'K']], CH.BLACK, '');
  }, function (bd) {
    var chk = bd.isChecked(CH.BLACK), ms = bd.legalMoves(CH.BLACK).length;
    return { ok: !chk && ms === 0 && bd.isStalemate(CH.BLACK), msg: '被将=' + chk + ' 着法=' + ms };
  });
  run('牵制：被牵住的车只能沿那条线走', function (bd) {
    /* 白王 e1、白车 e2、黑车 e8 —— 白车一动王就被将军，
       所以它只能留在 e 列上：e3、e4、e5、e6、e7、吃 e8，共 6 格。 */
    bd.setup([[0, 0, 'b', 'K'], [4, 7, 'w', 'K'], [4, 6, 'w', 'R'], [4, 0, 'b', 'R']], CH.WHITE, '');
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(4, 6); });
    var off = ms.filter(function (m) { return (m.to % 8) !== 4; }).length;
    return { ok: ms.length === 6 && off === 0, msg: '被牵制的车有 ' + ms.length + ' 种走法（应 6），离开 e 列 ' + off + ' 种' };
  });
  run('牵制：被牵住的象一步也走不了', function (bd) {
    /* 同一局面换成象：象只能斜走，斜走就松开 e 列 → 一步都不能走 */
    bd.setup([[0, 0, 'b', 'K'], [4, 7, 'w', 'K'], [4, 6, 'w', 'B'], [4, 0, 'b', 'R']], CH.WHITE, '');
  }, function (bd) {
    var ms = bd.legalMoves(CH.WHITE).filter(function (m) { return m.from === bd.idx(4, 6); });
    return { ok: ms.length === 0, msg: '被牵制的象有 ' + ms.length + ' 种走法（应为 0）' };
  });

  /* --- undo 还原 --- */
  run('undo 还原易位权 / 过路兵 / 行棋方', function (bd) {
    bd.setup(CH.START_POSITION, CH.WHITE, 'KQkq');
  }, function (bd) {
    var before = { cast: bd.castling, ep: bd.ep, tm: bd.toMove, half: bd.halfmove, n: bd.pieces().length };
    var r = bd.play(bd.idx(4, 6), bd.idx(4, 4), CH.WHITE);
    bd.undo(r.rec);
    var okp = bd.castling === before.cast && bd.ep === before.ep &&
      bd.toMove === before.tm && bd.halfmove === before.half &&
      bd.pieces().length === before.n && bd.t[bd.idx(4, 6)] === 'P' && !bd.g[bd.idx(4, 4)];
    return { ok: okp, msg: JSON.stringify({ cast: bd.castling, ep: bd.ep, tm: bd.toMove }) };
  });

  /* --- 枚举 API 不能改状态（将棋引擎踩过这个坑） --- */
  run('不变量：legalMoves 不动局面状态', function (bd) { bd.reset(); }, function (bd) {
    var s = bd.castling, e = bd.ep, t = bd.toMove, n = bd.pieces().length, h = bd.halfmove;
    bd.legalMoves(CH.WHITE); bd.isMate(CH.BLACK); bd.isChecked(CH.WHITE);
    return {
      ok: bd.castling === s && bd.ep === e && bd.toMove === t &&
        bd.pieces().length === n && bd.halfmove === h && bd.moves.length === 0,
      msg: 'castling=' + bd.castling + ' toMove=' + bd.toMove + ' 栈深=' + bd.moves.length
    };
  });

  /* --- 颜色参数的两种写法必须等价（'w'/'b' 字符串 与 WHITE/BLACK 数字） ---
     写成 `c === WHITE ? BLACK : WHITE` 时，传 'b' 会落到 else 也返回白方 ——
     两种写法都得到白方，静默出错。页面「换一边点评」这类开关就会失效。 */
  run('颜色换算：字符串与数字两种写法等价', function (bd) { bd.reset(); }, function () {
    var pairs = [
      [CH.other('w'), CH.other(CH.WHITE), CH.BLACK],
      [CH.other('b'), CH.other(CH.BLACK), CH.WHITE],
      [CH.colorChar('w'), CH.colorChar(CH.WHITE), 'w'],
      [CH.colorChar('b'), CH.colorChar(CH.BLACK), 'b']
    ];
    var bad = [];
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][0] !== pairs[i][2] || pairs[i][1] !== pairs[i][2]) bad.push(i);
    }
    return { ok: bad.length === 0, msg: bad.length ? '第 ' + bad.join(',') + ' 组不一致' : '' };
  });

  return { pass: pass, fail: fail };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CHESS;
  module.exports.selfTest = chessSelfTest;
}
if (typeof window !== 'undefined') {
  window.CHESS = CHESS;
  window.CHESS.selfTest = chessSelfTest;
}

/* 直接在命令行跑就执行自检 */
if (typeof require !== 'undefined' && typeof module !== 'undefined' &&
  require.main === module) {
  var r = chessSelfTest(true);
  console.log('\n国际象棋引擎自检：' + r.pass + ' 通过 ' + r.fail + ' 失败');
  process.exit(r.fail ? 1 : 0);
}
