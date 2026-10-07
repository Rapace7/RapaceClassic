/* 中国象棋棋盘渲染组件 —— Canvas 绘制，支持点击走子、选中 / 可走点 / 最后一手标记、响应式
 *
 * 定位：这个文件只负责「画」和「派发点击」，**不含任何规则**。
 *   走法是否合法、是不是送将、有没有照面 —— 全部由 XQ（xq-engine.js）判断。
 *   好处：不加载引擎也能单独渲染一张棋盘（规则速查页的静态演示就是这么用的）。
 *
 * 用法：
 *   var view = XQBoard.mount(canvasEl, {
 *     side: 'r',           // 'r' 红方在下（默认）/ 'b' 黑方在下（整盘转 180°）
 *     interactive: true,   // 是否接受点击
 *     showLabels: false,   // 是否在盘边画 A–I 列 / 1–10 行（与 XQ.toLabel 同向）
 *     onSelect: function (i) {},         // 可选：选中 / 取消选中（取消时 i = -1）
 *     onMove:   function (from, to) {}   // 点完「起点 → 终点」后派发。
 *                                        // 返回 false 表示这手不被接受，棋盘会保留选中（方便改点别处）
 *   });
 *
 *   view.setPieces([[x, y, 'r', 'K'], ...])   // 与 XQ.Board.setup 的格式完全一致
 *   view.setSelection(i)                      // 高亮选中的棋子（i 为引擎下标）
 *   view.setHints([i, ...])                   // 显示可走点（空点画蓝点，有子处画蓝圈）
 *   view.setLastMove(from, to)                // from 画虚圈、to 画绿圈；传 (-1,-1) 即清除
 *   view.clearMarks()                         // 清掉选中 + 提示 + 最后一手
 *   view.setSide('b') / view.setInteractive(false) / view.resize() / view.destroy()
 *
 * 坐标：所有下标 i / from / to 都是引擎下标 = y * 9 + x，即 XQ.Board.idx(x, y) 的结果。
 *   棋盘语义与引擎一致：(0,0) 是棋盘左上角（黑方底线那一排的最左边），x 自左向右、y 自上向下。
 *   默认红方在下（红 y=7..9），与 XQ.toLabel「A1 在左下角」一致。
 *
 * 棋子字：**简体**（红方 帅仕相马车炮兵 / 黑方 将士象马车炮卒），
 *         红黑靠颜色区分，车马炮两边同字 —— 这是简体棋具的通行做法。
 *   与实物象棋一致，一眼就能分清是哪一方的子。
 */
(function (global) {
  'use strict';

  var COLS = 9, ROWS = 10;
  var TAU = Math.PI * 2;
  var LETTERS = 'ABCDEFGHI';
  var FONT = '"STKaiti","KaiTi","楷体","Microsoft YaHei",serif';

  var COL = {
    bg: '#f3e5c9',
    line: '#c6aa81',
    lineEdge: '#ab8e64',
    frame: '#9c7f57',
    label: '#b09a78',
    riverText: '#bda588',
    sel: '#d9822b',          /* 选中：橙圈（与围棋盘的 focus 色一致） */
    hint: '#5b86ad',         /* 可走点：蓝点 / 蓝圈（与围棋盘的 point 色一致） */
    last: '#2e9e5b',         /* 最后一手：绿圈（与围棋盘一致） */
    lastFrom: 'rgba(46,158,91,0.55)',
    hover: 'rgba(60,52,41,0.10)',
    /* 红方：暖红环 + 暖白盘面 */
    rRing: '#b3271f', rText: '#a8231b', rFace1: '#fffdf8', rFace2: '#f7ddc6',
    /* 黑方：墨黑环 + 冷白盘面 */
    bRing: '#3a332c', bText: '#2b2622', bFace1: '#fdfaf4', bFace2: '#e4ded2'
  };

  /* 棋子上的字：**用简体**（用户要求）。
     红黑主要靠**颜色**区分 —— 车 / 马 / 炮 两边同字（简体棋具就是这么做的），
     只有 帅/将、仕/士、相/象、兵/卒 这四对天生不同。
     所以判断归属看颜色，不要靠字形。 */
  var CHARS = {
    r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
    b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' }
  };

  function XQBoardView(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.side = opts.side === 'b' ? 'b' : 'r';
    this.flip = this.side === 'b';
    this.interactive = opts.interactive !== false;
    /* 默认**开**：讲解与题库里到处是 B5、H2 这样的坐标，盘边不带标号就没法对照（用户提过）。
       个别小盘（如规则速查里的演示盘）若要关，显式传 showLabels: false。 */
    this.showLabels = opts.showLabels !== false;
    this.onMove = opts.onMove || null;
    this.onSelect = opts.onSelect || null;

    this.list = [];          /* [[x,y,'r'|'b',type], ...] */
    this.sel = -1;           /* 选中的引擎下标，-1 表示没有 */
    this.hints = [];         /* 可走点下标 */
    this.lastFrom = -1;
    this.lastTo = -1;
    this.hover = -1;

    this.w = 0; this.h = 0; this.pad = 0; this.cell = 0; this.dpr = 1; this.labelH = 0;

    this._bind();
    this.resize();
    /* 首次挂在 DOM 上时父容器可能还没算出宽度，下一帧补一次 */
    var self = this;
    if (global.requestAnimationFrame) {
      global.requestAnimationFrame(function () { self.resize(); });
    }
  }

  /* ---------------- 生命周期 ---------------- */

  XQBoardView.prototype._bind = function () {
    var self = this;
    this.canvas.addEventListener('click', function (e) {
      if (!self.interactive) return;
      var i = self._toPoint(e);
      if (i >= 0) self._clickPoint(i);
    });
    this.canvas.addEventListener('mousemove', function (e) {
      if (!self.interactive) return;
      var i = self._toPoint(e);
      if (i !== self.hover) { self.hover = i; self.draw(); }
    });
    this.canvas.addEventListener('mouseleave', function () {
      if (self.hover !== -1) { self.hover = -1; self.draw(); }
    });
    this._onResize = function () { self.resize(); };
    global.addEventListener('resize', this._onResize);
    /* 父容器宽度变化（例如窗口没动、但布局变了）也要重绘 */
    if (global.ResizeObserver && this.canvas.parentElement) {
      this._ro = new global.ResizeObserver(function () { self.resize(); });
      this._ro.observe(this.canvas.parentElement);
    }
  };

  XQBoardView.prototype.destroy = function () {
    if (this._onResize) global.removeEventListener('resize', this._onResize);
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this.canvas.width = 0;
    this.canvas.height = 0;
  };

  /* ---------------- 对外方法 ---------------- */

  XQBoardView.prototype.setPieces = function (list) {
    this.list = list || [];
    /* 选中的子可能已经被吃掉 / 被摆走，顺手校验一下 */
    if (this.sel >= 0 && !this._pieceAt(this.sel)) { this.sel = -1; this.hints = []; }
    this.draw();
  };

  XQBoardView.prototype.setSelection = function (i) {
    this.sel = (i === null || i === undefined || i < 0) ? -1 : i;
    this.draw();
  };

  XQBoardView.prototype.setHints = function (list) {
    this.hints = list || [];
    this.draw();
  };

  XQBoardView.prototype.setLastMove = function (from, to) {
    var ok = (from !== null && from !== undefined && from >= 0 && to !== null && to !== undefined && to >= 0);
    this.lastFrom = ok ? from : -1;
    this.lastTo = ok ? to : -1;
    this.draw();
  };

  XQBoardView.prototype.clearMarks = function () {
    this.sel = -1;
    this.hints = [];
    this.lastFrom = -1;
    this.lastTo = -1;
    this.draw();
  };

  XQBoardView.prototype.setSide = function (side) {
    this.side = side === 'b' ? 'b' : 'r';
    this.flip = this.side === 'b';
    this.hover = -1;
    this.draw();
  };

  XQBoardView.prototype.setInteractive = function (on) {
    this.interactive = on !== false;
    if (!this.interactive) this.hover = -1;
    this.draw();
  };

  XQBoardView.prototype.resize = function () {
    var parent = this.canvas.parentElement;
    if (!parent) return;
    var w = parent.clientWidth;
    if (!w) return;
    var dpr = global.devicePixelRatio || 1;
    this.dpr = dpr;
    /* 盘边坐标要**单独占一条带**，不能靠「加大内边距」硬挤 ——
       试过 0.085 / 0.11 两档都挡：棋子在交叉点上，第 1 行棋子的外缘在 `pad − 0.44×cell`，
       而坐标字心会落进这个范围里；把 pad 继续加大只会让格子越缩越小（恶性循环）。
       现在改成：**棋盘尺寸不变，画布上下各加一条 labelH 高的坐标带**。 */
    var labelH = this.showLabels ? Math.max(16, Math.round(w * 0.04)) : 0;
    var pad = w * 0.055 + labelH;
    var cell = (w - pad * 2) / (COLS - 1);
    var h = pad * 2 + cell * (ROWS - 1);
    this.w = w; this.h = h; this.pad = pad; this.cell = cell; this.labelH = labelH;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.draw();
  };

  /* ---------------- 坐标换算 ---------------- */

  /* 棋盘坐标 → 屏幕格坐标（黑方在下时整盘转 180°） */
  XQBoardView.prototype._map = function (x, y) {
    return this.flip ? [COLS - 1 - x, ROWS - 1 - y] : [x, y];
  };
  XQBoardView.prototype._unmap = function (sx, sy) {
    return this.flip ? [COLS - 1 - sx, ROWS - 1 - sy] : [sx, sy];
  };

  XQBoardView.prototype._pieceAt = function (i) {
    var b = this._xy(i), k;
    for (k = 0; k < this.list.length; k++) {
      var p = this.list[k];
      if (p[0] === b[0] && p[1] === b[1]) return p;
    }
    return null;
  };

  XQBoardView.prototype._xy = function (i) { return [i % COLS, (i / COLS) | 0]; };

  /* 鼠标事件 → 最近的交叉点下标；离得太远返回 -1 */
  XQBoardView.prototype._toPoint = function (e) {
    if (!this.cell) return -1;
    var r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    var px = (e.clientX - r.left) * (this.w / r.width);
    var py = (e.clientY - r.top) * (this.h / r.height);
    var sx = Math.round((px - this.pad) / this.cell);
    var sy = Math.round((py - this.pad) / this.cell);
    if (sx < 0 || sx > COLS - 1 || sy < 0 || sy > ROWS - 1) return -1;
    var dx = px - (this.pad + sx * this.cell);
    var dy = py - (this.pad + sy * this.cell);
    if (Math.sqrt(dx * dx + dy * dy) > this.cell * 0.68) return -1;
    var b = this._unmap(sx, sy);
    return b[1] * COLS + b[0];
  };

  /* 点击派发：第一次点自己的子 → 选中；再点目标点 → onMove；点自己另一个子 → 改选中 */
  XQBoardView.prototype._clickPoint = function (i) {
    var self = this;
    var here = this._pieceAt(i);
    var prev = this.sel >= 0 ? this._pieceAt(this.sel) : null;

    if (!prev) {                                   /* 还没选中任何子 */
      if (!here) return;
      this.sel = i;
      this._notify(i);
      this.draw();
      return;
    }
    if (i === this.sel) {                          /* 再点一次 → 取消选中 */
      this.sel = -1;
      this._notify(-1);
      this.draw();
      return;
    }
    if (here && here[2] === prev[2]) {             /* 点到自己另一个子 → 改选中 */
      this.sel = i;
      this._notify(i);
      this.draw();
      return;
    }
    var from = this.sel, ok = true;
    if (this.onMove) ok = this.onMove(from, i);
    if (ok === false) { this.draw(); return; }     /* 被拒绝：保留选中，方便用户改点别处 */
    this.sel = -1;
    this._notify(-1);
    this.draw();
  };

  XQBoardView.prototype._notify = function (i) {
    if (this.onSelect) this.onSelect(i);
  };

  /* ---------------- 绘制 ---------------- */

  XQBoardView.prototype.draw = function () {
    if (!this.cell) return;
    var ctx = this.ctx, pad = this.pad, cell = this.cell, w = this.w, h = this.h;
    var x0 = pad, y0 = pad;
    var x1 = pad + cell * (COLS - 1), y1 = pad + cell * (ROWS - 1);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* 木色底 + 一点斜向光晕（与围棋盘同色系） */
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, h);
    var grd = ctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, 'rgba(255,252,245,0.55)');
    grd.addColorStop(1, 'rgba(190,162,122,0.08)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    var lw = Math.max(1, cell * 0.026);
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = lw;
    ctx.beginPath();
    var c, r;
    /* 10 条横线：通到底 */
    for (r = 0; r < ROWS; r++) {
      ctx.moveTo(x0, y0 + r * cell);
      ctx.lineTo(x1, y0 + r * cell);
    }
    /* 竖线：最左最右两条通到底（外框），中间 7 条在河界处断开 */
    for (c = 0; c < COLS; c++) {
      var X = x0 + c * cell;
      if (c === 0 || c === COLS - 1) {
        ctx.moveTo(X, y0); ctx.lineTo(X, y1);
      } else {
        ctx.moveTo(X, y0); ctx.lineTo(X, y0 + 4 * cell);
        ctx.moveTo(X, y0 + 5 * cell); ctx.lineTo(X, y1);
      }
    }
    ctx.stroke();

    /* 九宫斜线（上下各一个 3×3 宫） */
    ctx.beginPath();
    ctx.moveTo(x0 + 3 * cell, y0); ctx.lineTo(x0 + 5 * cell, y0 + 2 * cell);
    ctx.moveTo(x0 + 5 * cell, y0); ctx.lineTo(x0 + 3 * cell, y0 + 2 * cell);
    ctx.moveTo(x0 + 3 * cell, y0 + 7 * cell); ctx.lineTo(x0 + 5 * cell, y1);
    ctx.moveTo(x0 + 5 * cell, y0 + 7 * cell); ctx.lineTo(x0 + 3 * cell, y1);
    ctx.stroke();

    /* 外框加粗 */
    ctx.strokeStyle = COL.frame;
    ctx.lineWidth = Math.max(1.6, cell * 0.045);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    /* 楚河汉界（写在河界那一道空白里，位置随翻转走） */
    ctx.fillStyle = COL.riverText;
    ctx.font = '600 ' + Math.max(10, cell * 0.52) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var cy = y0 + 4.5 * cell;
    var leftX = this._map(1.5, 4.5)[0], rightX = this._map(6.5, 4.5)[0];
    ctx.fillText('楚 河', x0 + leftX * cell, cy);
    ctx.fillText('汉 界', x0 + rightX * cell, cy);

    /* 盘边坐标（默认关；开了就是 A–I 列 / 1–10 行，与 XQ.toLabel 一致） */
    if (this.showLabels) {
      ctx.fillStyle = COL.label;
      ctx.font = Math.max(9, cell * 0.36) + 'px system-ui, sans-serif';
      for (c = 0; c < COLS; c++) {
        var bx = this._unmap(c, 0)[0];
        /* 坐标画在**坐标带的正中** —— 不能用「网格线往上挪一点」的写法：
           网格线在 pad 处，而 pad = 内边距 + labelH，所以 y0 − labelH/2 仍然落在棋子范围内。 */
        ctx.fillText(LETTERS[bx], x0 + c * cell, this.labelH * 0.5);
        ctx.fillText(LETTERS[bx], x0 + c * cell, this.h - this.labelH * 0.5);
      }
      for (r = 0; r < ROWS; r++) {
        var by = this._unmap(0, r)[1];
        ctx.fillText(String(ROWS - by), this.labelH * 0.5, y0 + r * cell);
        ctx.fillText(String(ROWS - by), this.w - this.labelH * 0.5, y0 + r * cell);
      }
    }

    var k;

    /* 可走点：空点画蓝点（画在棋子下面） */
    for (k = 0; k < this.hints.length; k++) {
      var hp = this._map(this._xy(this.hints[k])[0], this._xy(this.hints[k])[1]);
      if (this._pieceAt(this.hints[k])) continue;
      ctx.fillStyle = COL.hint;
      ctx.beginPath();
      ctx.arc(x0 + hp[0] * cell, y0 + hp[1] * cell, Math.max(2, cell * 0.13), 0, TAU);
      ctx.fill();
    }

    /* 最后一手的起点：虚圈（画在棋子下面，免得盖住字） */
    if (this.lastFrom >= 0) {
      var fp = this._map(this._xy(this.lastFrom)[0], this._xy(this.lastFrom)[1]);
      ctx.save();
      ctx.strokeStyle = COL.lastFrom;
      ctx.lineWidth = Math.max(1.4, cell * 0.045);
      ctx.setLineDash([cell * 0.14, cell * 0.11]);
      ctx.beginPath();
      ctx.arc(x0 + fp[0] * cell, y0 + fp[1] * cell, cell * 0.44, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    /* 棋子 */
    for (k = 0; k < this.list.length; k++) {
      var p = this.list[k];
      if (p[0] < 0 || p[0] > COLS - 1 || p[1] < 0 || p[1] > ROWS - 1) continue;
      var sp = this._map(p[0], p[1]);
      var color = (p[2] === 'b' || p[2] === 2) ? 'b' : 'r';
      var type = String(p[3] || '').toUpperCase();
      this._piece(x0 + sp[0] * cell, y0 + sp[1] * cell, cell * 0.455, color, CHARS[color][type] || '?');
    }

    /* 最后一手的落点：绿圈 */
    if (this.lastTo >= 0) {
      var tp = this._map(this._xy(this.lastTo)[0], this._xy(this.lastTo)[1]);
      ctx.strokeStyle = COL.last;
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.beginPath();
      ctx.arc(x0 + tp[0] * cell, y0 + tp[1] * cell, cell * 0.44, 0, TAU);
      ctx.stroke();
    }

    /* 可走点里「有子的那几格」（可以吃子）：蓝圈 */
    for (k = 0; k < this.hints.length; k++) {
      if (!this._pieceAt(this.hints[k])) continue;
      var cp = this._map(this._xy(this.hints[k])[0], this._xy(this.hints[k])[1]);
      ctx.strokeStyle = COL.hint;
      ctx.lineWidth = Math.max(2, cell * 0.055);
      ctx.beginPath();
      ctx.arc(x0 + cp[0] * cell, y0 + cp[1] * cell, cell * 0.47, 0, TAU);
      ctx.stroke();
    }

    /* 选中：橙圈 */
    if (this.sel >= 0) {
      var slp = this._map(this._xy(this.sel)[0], this._xy(this.sel)[1]);
      ctx.strokeStyle = COL.sel;
      ctx.lineWidth = Math.max(2.4, cell * 0.075);
      ctx.beginPath();
      ctx.arc(x0 + slp[0] * cell, y0 + slp[1] * cell, cell * 0.47, 0, TAU);
      ctx.stroke();
    }

    /* 悬停 */
    if (this.interactive && this.hover >= 0 && this.hover !== this.sel) {
      var hvp = this._map(this._xy(this.hover)[0], this._xy(this.hover)[1]);
      ctx.fillStyle = COL.hover;
      ctx.beginPath();
      ctx.arc(x0 + hvp[0] * cell, y0 + hvp[1] * cell, cell * 0.42, 0, TAU);
      ctx.fill();
    }
  };

  /* 一颗棋子：木色圆盘 + 该方的彩色圆环 + 汉字 */
  XQBoardView.prototype._piece = function (cx, cy, r, color, ch) {
    var ctx = this.ctx;
    var isRed = color === 'r';
    var ring = isRed ? COL.rRing : COL.bRing;
    var text = isRed ? COL.rText : COL.bText;
    var f1 = isRed ? COL.rFace1 : COL.bFace1;
    var f2 = isRed ? COL.rFace2 : COL.bFace2;

    /* 投影：让棋子看着「有厚度」，压在盘面上不像贴纸 */
    ctx.beginPath();
    ctx.arc(cx + r * 0.07, cy + r * 0.11, r * 0.98, 0, TAU);
    ctx.fillStyle = 'rgba(150,124,95,0.20)';
    ctx.fill();

    var g = ctx.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.10, cx, cy, r * 1.05);
    g.addColorStop(0, f1);
    g.addColorStop(1, f2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = ring;
    ctx.lineWidth = Math.max(1.2, r * 0.15);
    ctx.stroke();

    ctx.strokeStyle = ring;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = Math.max(0.8, r * 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.76, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = text;
    ctx.font = '700 ' + (r * 1.30) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, cx, cy + r * 0.04);
  };

  global.XQBoard = {
    mount: function (canvas, opts) {
      var v = new XQBoardView(canvas, opts);
      /* 把视图挂到 canvas 上：测试脚本要靠它拿 pad/cell 反算点击坐标
         （国际象棋棋盘也是这么挂的 —— canvas.__chessView）。 */
      if (canvas) canvas.__xqView = v;
      return v;
    },
    View: XQBoardView,
    CHARS: CHARS,
    COLORS: COL
  };

})(typeof window !== 'undefined' ? window : this);
