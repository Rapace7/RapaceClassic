/* 围棋规则引擎 —— 纯 JavaScript，零依赖，浏览器与 Node 通用 */
(function (global) {
  'use strict';

  var EMPTY = 0, BLACK = 1, WHITE = 2;

  function other(c) { return c === BLACK ? WHITE : BLACK; }
  function colorName(c) { return c === BLACK ? '黑' : (c === WHITE ? '白' : '空'); }

  function Board(size) {
    this.size = size | 0;
    this.n = this.size * this.size;
    this.g = new Int8Array(this.n);
    this.ko = -1;
    this.captured = [0, 0, 0];
    this.moves = [];
    this.toMove = BLACK;
    this.passCount = 0;
    this.nb = buildNeighbors(this.size);
  }

  function buildNeighbors(size) {
    var nb = new Array(size * size), x, y, i, a;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        i = y * size + x; a = [];
        if (x > 0) a.push(i - 1);
        if (x < size - 1) a.push(i + 1);
        if (y > 0) a.push(i - size);
        if (y < size - 1) a.push(i + size);
        nb[i] = a;
      }
    }
    return nb;
  }

  Board.prototype.idx = function (x, y) { return y * this.size + x; };
  Board.prototype.xy = function (i) { return { x: i % this.size, y: (i / this.size) | 0 }; };
  Board.prototype.at = function (x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return -1;
    return this.g[y * this.size + x];
  };

  /* 取一整块棋及其全部气 */
  Board.prototype.group = function (i) {
    var c = this.g[i];
    if (c === EMPTY) return { stones: [], libs: [] };
    var seen = new Uint8Array(this.n), stones = [], libs = [], st = [i];
    seen[i] = 1;
    while (st.length) {
      var p = st.pop(); stones.push(p);
      var ns = this.nb[p];
      for (var k = 0; k < ns.length; k++) {
        var q = ns[k];
        if (seen[q]) continue;
        if (this.g[q] === EMPTY) { seen[q] = 1; libs.push(q); }
        else if (this.g[q] === c) { seen[q] = 1; st.push(q); }
      }
    }
    return { stones: stones, libs: libs };
  };

  Board.prototype.liberties = function (i) { return this.group(i).libs.length; };

  /* 落子。返回 {ok, reason, rec, captured}；rec 可交给 undo 完全回滚 */
  Board.prototype.play = function (i, color) {
    if (i < 0 || i >= this.n) return { ok: false, reason: 'out' };
    if (this.g[i] !== EMPTY) return { ok: false, reason: 'occupied' };
    if (i === this.ko) return { ok: false, reason: 'ko' };

    var opp = other(color), koBefore = this.ko;
    this.ko = -1;
    this.g[i] = color;

    var captured = [], ns = this.nb[i], k, q;
    for (k = 0; k < ns.length; k++) {
      q = ns[k];
      if (this.g[q] === opp) {
        var grp = this.group(q);
        if (grp.libs.length === 0) {
          for (var t = 0; t < grp.stones.length; t++) {
            this.g[grp.stones[t]] = EMPTY;
            captured.push(grp.stones[t]);
          }
        }
      }
    }

    if (captured.length === 0) {
      var own = this.group(i);
      if (own.libs.length === 0) {
        this.g[i] = EMPTY;
        this.ko = koBefore;
        return { ok: false, reason: 'suicide' };
      }
    }

    if (captured.length === 1) {
      var g2 = this.group(i);
      if (g2.stones.length === 1 && g2.libs.length === 1 && g2.libs[0] === captured[0]) {
        this.ko = captured[0];
      }
    }

    this.captured[color] += captured.length;
    var rec = { i: i, color: color, captured: captured, koBefore: koBefore, koAfter: this.ko, pass: false };
    this.moves.push(rec);
    this.passCount = 0;
    this.toMove = opp;
    return { ok: true, rec: rec, captured: captured };
  };

  Board.prototype.undo = function (rec) {
    if (!rec) return;
    if (rec.pass) {
      this.ko = rec.koBefore;
      this.moves.pop();
      this.passCount = Math.max(0, this.passCount - 1);
      this.toMove = rec.color;
      return;
    }
    this.g[rec.i] = EMPTY;
    for (var k = 0; k < rec.captured.length; k++) this.g[rec.captured[k]] = other(rec.color);
    this.captured[rec.color] -= rec.captured.length;
    this.ko = rec.koBefore;
    this.moves.pop();
    this.toMove = rec.color;
  };

  Board.prototype.isLegal = function (i, color) {
    var r = this.play(i, color);
    if (r.ok) this.undo(r.rec);
    return r.ok;
  };

  Board.prototype.legalMoves = function (color) {
    var out = [], i;
    for (i = 0; i < this.n; i++) {
      if (this.g[i] === EMPTY && this.isLegal(i, color)) out.push(i);
    }
    return out;
  };

  Board.prototype.pass = function (color) {
    var rec = { pass: true, color: color, captured: [], koBefore: this.ko, koAfter: -1 };
    this.ko = -1;
    this.moves.push(rec);
    this.passCount++;
    this.toMove = other(color);
    return rec;
  };

  Board.prototype.isOver = function () { return this.passCount >= 2; };

  /* 判断空点是否像「真眼」（己方颜色 color 的眼）。
     用于 AI 不填自己的眼，也用于教学演示。 */
  Board.prototype.isTrueEye = function (i, color) {
    if (this.g[i] !== EMPTY) return false;
    var s = this.size, p = this.xy(i), x = p.x, y = p.y;
    var own = function (xx, yy) {
      if (xx < 0 || yy < 0 || xx >= s || yy >= s) return true;
      return this.g[yy * s + xx] === color;
    }.bind(this);
    if (!own(x - 1, y) || !own(x + 1, y) || !own(x, y - 1) || !own(x, y + 1)) return false;
    var dx = [-1, 1, -1, 1], dy = [-1, -1, 1, 1], inBoard = 0, good = 0, k, xx, yy;
    for (k = 0; k < 4; k++) {
      xx = x + dx[k]; yy = y + dy[k];
      if (xx < 0 || yy < 0 || xx >= s || yy >= s) continue;
      inBoard++;
      if (this.g[yy * s + xx] === color) good++;
    }
    if (inBoard < 1) return false;
    /* 中间点（4 个对角）允许 1 个不是自己；边、角上要求更严 */
    var need = inBoard >= 4 ? 3 : 1;
    return good >= need;
  };

  /* 面积法数子（中国规则）。komi 为黑贴目数 */
  Board.prototype.score = function (komi) {
    komi = komi || 0;
    var s = this.size, n = this.n, g = this.g;
    var black = 0, white = 0, seen = new Uint8Array(n), i, k;
    for (i = 0; i < n; i++) {
      if (g[i] === BLACK) black++;
      else if (g[i] === WHITE) white++;
      else if (!seen[i]) {
        var region = [], st = [i], tb = false, tw = false;
        seen[i] = 1;
        while (st.length) {
          var p = st.pop(); region.push(p);
          var ns = this.nb[p];
          for (k = 0; k < ns.length; k++) {
            var q = ns[k];
            if (seen[q]) continue;
            if (g[q] === EMPTY) { seen[q] = 1; st.push(q); }
            else if (g[q] === BLACK) tb = true;
            else tw = true;
          }
        }
        if (tb && !tw) black += region.length;
        else if (tw && !tb) white += region.length;
      }
    }
    return { black: black, white: white, komi: komi, diff: black - (white + komi) };
  };

  Board.prototype.copy = function () {
    var b = new Board(this.size);
    b.g.set(this.g);
    b.ko = this.ko;
    b.captured = this.captured.slice();
    b.toMove = this.toMove;
    b.passCount = this.passCount;
    return b;
  };

  Board.prototype.reset = function () {
    this.g.fill(EMPTY);
    this.ko = -1;
    this.captured = [0, 0, 0];
    this.moves = [];
    this.toMove = BLACK;
    this.passCount = 0;
  };

  /* 从 [{x,y,c}] 或 ['b',x,y] 之类的简写摆局面 */
  Board.prototype.setup = function (stones) {
    this.reset();
    for (var k = 0; k < stones.length; k++) {
      var st = stones[k];
      var x, y, c;
      if (Array.isArray(st)) { x = st[0]; y = st[1]; c = st[2]; }
      else { x = st.x; y = st.y; c = st.c; }
      if (typeof c === 'string') c = (c === 'b' || c === 'B') ? BLACK : WHITE;
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
      this.g[y * this.size + x] = c;
    }
  };

  Board.prototype.stones = function () {
    var out = [], i;
    for (i = 0; i < this.n; i++) if (this.g[i] !== EMPTY) out.push({ x: i % this.size, y: (i / this.size) | 0, c: this.g[i] });
    return out;
  };

  var GoEngine = {
    Board: Board,
    BLACK: BLACK, WHITE: WHITE, EMPTY: EMPTY,
    other: other, colorName: colorName,
    /* 围棋坐标：A1 在左下角，纵坐标从下往上数 */
    toLabel: function (i, size) {
      var x = i % size, y = (i / size) | 0;
      var letters = 'ABCDEFGHJKLMNOPQRST';
      return letters[x] + (size - y);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GoEngine;
  else global.GoEngine = GoEngine;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
