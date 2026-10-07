/* 国际象棋棋盘渲染 —— 8×8 方格、代数坐标、棋子用 Unicode 字形
 *
 * 与另外三个棋种的差别：
 *   象棋 / 将棋 / 围棋都是「棋子放在交叉点上」，国际象棋是**放在格子里**。
 *   所以这里的命中判定是「点在哪个格子」，跟 xq-board / shogi-board 都不同。
 *
 * 棋子的画法：
 *   Unicode 有实心（♚♛♜♝♞♟）和空心（♔♕♖♗♘♙）两套。空心的笔画太细，
 *   小尺寸下几乎看不见，所以**两方都用实心字形**，靠 fillStyle 区分：
 *   白子填米白再描深色边，黑子填深色再描浅边。这样两种颜色都清晰。
 *
 * 对外接口（页面用这一套，不要直接碰 canvas）：
 *   mount(canvas, opts)                 -> view
 *   view.setPosition(pieces)            pieces = [[x,y,'w'|'b',类型]]
 *   view.setSelection(i) / setHints([i...]) / setLastMove(from,to)
 *   view.setCheck(i)                    被将军的王所在格，画红圈
 *   view.setFlip(bool)                  黑方视角
 *   view.onTap = function(i)            点某个格子
 */
'use strict';

var CHESS_BOARD = (function () {

  var SIZE = 8;
  var FILES = 'abcdefgh';

  var COL = {
    light: '#efe2cd',        /* 浅色格 */
    dark: '#b58863',         /* 深色格 */
    border: '#7b5b3f',
    label: '#6b5b45',
    sel: '#e0a63c',
    hint: '#5b86ad',
    hintCap: '#c96a5a',
    last: '#7f9a72',
    check: '#c0392b',
    whiteFill: '#fdfbf5',
    whiteEdge: '#5a4a38',
    blackFill: '#3a332c',
    blackEdge: '#c9bda9'
  };

  /* 实心字形：两方共用 */
  var GLYPH = {
    K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F'
  };
  var FONT = '"Segoe UI Symbol","Noto Sans Symbols 2","DejaVu Sans",sans-serif';

  function ChessBoardView(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pieces = [];
    this.sel = -1;
    this.hints = [];
    this.lastMove = null;
    this.check = -1;
    this.flip = !!opts.flip;
    this.onTap = opts.onTap || null;
    this.interactive = opts.interactive !== false;
    this.size = Math.max(240, opts.size || 480);
    this._bind();
    this._layout();
    /* ★ 把视图挂到 canvas 上 —— 测试脚本要靠它拿到 margin/cell 去算点击坐标。
       象棋、将棋两个棋盘都是这么做的（__xqView / __shogiView），这里保持一致。 */
    canvas.__chessView = this;
    this.draw();
  }

  ChessBoardView.prototype._layout = function () {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    this.w = this.size;
    this.margin = Math.round(this.size * 0.052);         /* 留给行列号 */
    this.cell = (this.size - this.margin * 2) / SIZE;
    this.bx = this.margin;
    this.by = this.margin;
    var c = this.canvas;
    c.width = Math.round(this.w * dpr);
    c.height = Math.round(this.w * dpr);
    c.style.width = this.w + 'px';
    c.style.height = this.w + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* 棋盘格坐标 (col, row) -> 屏幕像素。row 0 是顶边。 */
  ChessBoardView.prototype._xy = function (col, row) {
    if (this.flip) { col = SIZE - 1 - col; row = SIZE - 1 - row; }
    return { x: this.bx + col * this.cell, y: this.by + row * this.cell };
  };

  /* 内部下标 i -> 棋盘格 (col, row)。内部 x = 列(a=0)，y = 行(0 是第 8 行)。 */
  ChessBoardView.prototype._cr = function (i) {
    return { col: i % SIZE, row: (i / SIZE) | 0 };
  };

  ChessBoardView.prototype._bind = function () {
    var self = this;
    if (!this.interactive) return;
    this.canvas.addEventListener('click', function (e) {
      var i = self._hit(e);
      if (i >= 0 && self.onTap) self.onTap(i);
    });
    this.canvas.style.cursor = 'pointer';
  };

  ChessBoardView.prototype._hit = function (e) {
    var r = this.canvas.getBoundingClientRect();
    var scale = this.w / r.width;
    var px = (e.clientX - r.left) * scale - this.bx;
    var py = (e.clientY - r.top) * scale - this.by;
    var col = Math.floor(px / this.cell), row = Math.floor(py / this.cell);
    if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
    if (this.flip) { col = SIZE - 1 - col; row = SIZE - 1 - row; }
    return row * SIZE + col;
  };

  ChessBoardView.prototype.setPosition = function (pieces) { this.pieces = pieces || []; this.draw(); };
  ChessBoardView.prototype.setSelection = function (i) { this.sel = (i === undefined) ? -1 : i; this.draw(); };
  ChessBoardView.prototype.setHints = function (list) { this.hints = list || []; this.draw(); };
  ChessBoardView.prototype.setLastMove = function (from, to) {
    this.lastMove = (from === undefined || from < 0) ? null : { from: from, to: to };
    this.draw();
  };
  ChessBoardView.prototype.setCheck = function (i) { this.check = (i === undefined) ? -1 : i; this.draw(); };
  ChessBoardView.prototype.setFlip = function (f) { this.flip = !!f; this.draw(); };
  ChessBoardView.prototype.resize = function (px) { this.size = px; this._layout(); this.draw(); };

  /* 一枚棋子 */
  ChessBoardView.prototype._piece = function (ctx, cx, cy, cell, color, type) {
    var g = GLYPH[type];
    if (!g) return;
    var fs = Math.round(cell * 0.82);
    ctx.font = fs + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var isW = (color === 'w' || color === 1);
    /* 先描一圈边（两方都描，只是颜色不同），再填主体 —— 这样在深浅格上都看得清 */
    ctx.lineWidth = Math.max(1.2, cell * 0.045);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isW ? COL.whiteEdge : COL.blackEdge;
    ctx.strokeText(g, cx, cy + cell * 0.02);
    ctx.fillStyle = isW ? COL.whiteFill : COL.blackFill;
    ctx.fillText(g, cx, cy + cell * 0.02);
  };

  ChessBoardView.prototype.draw = function () {
    var ctx = this.ctx, i, j, p, sq;

    ctx.clearRect(0, 0, this.w, this.w);

    /* 格子 */
    for (j = 0; j < SIZE; j++) {
      for (i = 0; i < SIZE; i++) {
        sq = this._xy(i, j);
        /* 真正的 a8 是浅色：col+row 为偶数时是 a8 那一类 */
        ctx.fillStyle = ((i + j) % 2 === 0) ? COL.light : COL.dark;
        ctx.fillRect(sq.x, sq.y, this.cell + 0.6, this.cell + 0.6);
      }
    }

    /* 上一步的两格 */
    if (this.lastMove) {
      [this.lastMove.from, this.lastMove.to].forEach(function (k) {
        var c = this._cr(k), s = this._xy(c.col, c.row);
        ctx.fillStyle = 'rgba(127,154,114,0.45)';
        ctx.fillRect(s.x, s.y, this.cell, this.cell);
      }, this);
    }

    /* 选中格 */
    if (this.sel >= 0) {
      var c2 = this._cr(this.sel), s2 = this._xy(c2.col, c2.row);
      ctx.strokeStyle = COL.sel;
      ctx.lineWidth = Math.max(2, this.cell * 0.09);
      ctx.strokeRect(s2.x + ctx.lineWidth / 2, s2.y + ctx.lineWidth / 2,
        this.cell - ctx.lineWidth, this.cell - ctx.lineWidth);
    }

    /* 提示点：空格画小圆点，可吃的子画圈 */
    var occ = {};
    this.pieces.forEach(function (q) { occ[q[0] + ',' + q[1]] = true; });
    for (i = 0; i < this.hints.length; i++) {
      var h = this.hints[i];
      var hc = this._cr(h), hs = this._xy(hc.col, hc.row);
      var cx = hs.x + this.cell / 2, cy = hs.y + this.cell / 2;
      var isCap = !!occ[hc.col + ',' + hc.row];
      ctx.beginPath();
      if (isCap) {
        ctx.strokeStyle = COL.hintCap;
        ctx.lineWidth = Math.max(2, this.cell * 0.08);
        ctx.arc(cx, cy, this.cell * 0.42, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = COL.hint;
        ctx.globalAlpha = 0.55;
        ctx.arc(cx, cy, this.cell * 0.17, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    /* 棋子 */
    for (i = 0; i < this.pieces.length; i++) {
      p = this.pieces[i];
      var pc = this._cr(p[1] * SIZE + p[0]);
      var ps = this._xy(pc.col, pc.row);
      this._piece(ctx, ps.x + this.cell / 2, ps.y + this.cell / 2, this.cell, p[2], p[3]);
    }

    /* 被将军的王：红圈 */
    if (this.check >= 0) {
      var kc = this._cr(this.check), ks = this._xy(kc.col, kc.row);
      ctx.strokeStyle = COL.check;
      ctx.lineWidth = Math.max(2.5, this.cell * 0.1);
      ctx.beginPath();
      ctx.arc(ks.x + this.cell / 2, ks.y + this.cell / 2, this.cell * 0.44, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* 行列号：列 a–h 画在下方，行 1–8 画在左侧 */
    ctx.fillStyle = COL.label;
    var lf = Math.max(9, Math.round(this.cell * 0.28));
    ctx.font = lf + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < SIZE; i++) {
      var cc = this.flip ? (SIZE - 1 - i) : i;
      var x = this.bx + (i + 0.5) * this.cell;
      ctx.fillText(FILES.charAt(cc), x, this.by + SIZE * this.cell + this.margin * 0.52);
      var rr = this.flip ? (i + 1) : (SIZE - i);
      var y = this.by + (i + 0.5) * this.cell;
      ctx.fillText(String(rr), this.bx - this.margin * 0.5, y);
    }
  };

  return {
    mount: function (canvas, opts) { return new ChessBoardView(canvas, opts); },
    View: ChessBoardView,
    GLYPH: GLYPH,
    COL: COL,
    SIZE: SIZE
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CHESS_BOARD;
if (typeof window !== 'undefined') window.ChessBoard = CHESS_BOARD;
