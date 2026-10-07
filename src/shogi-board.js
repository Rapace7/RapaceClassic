/* 将棋棋盘渲染组件 —— Canvas 绘制，支持点击走子 / 打驹、选中与可走点、最后一手标记、响应式
 *
 * 定位：这个文件只负责「画」和「派发点击」，**不含任何规则**。
 *   走法是否合法、能不能升变、二步 / 打步诘 —— 全部由 SHOGI（shogi-engine.js）判断。
 *   好处：不加载引擎也能单独渲染一张棋盘（规则页的静态演示就是这么用的）。
 *
 * ── 与围棋盘 / 象棋盘的三处根本不同（写的时候别按老习惯来）──────────
 *   1) 棋子放在**格子里**，不是交叉点上 —— 所以 cell = 盘宽 / 9，取格中心；
 *      围棋象棋都是「9 条线 8 个间隔」，这里是「9 个格子」。
 *   2) 棋子是**五角形**，尖头朝着对方的阵地：先手朝上，后手朝下（旋转 180°）。
 *   3) 棋盘上下各有一条**持驹台**（吃掉对方的驹归自己，随时可以打回盘上），
 *      这两条带子要参与布局计算 —— 不算进去的话棋会被裁掉。
 *
 * 用法：
 *   var view = ShogiBoard.mount(canvasEl, {
 *     interactive: true,
 *     showLabels: true,                     // 盘边画筋号（１–９，右→左）与段号（一–九，上→下）
 *     onTap:     function (i) {},           // 点了棋盘上的某一格（i 为引擎下标）
 *     onTapHand: function (color, type) {}   // 点了持驹台上的某一枚驹
 *   });
 *
 *   view.setList([[x, y, 's'|'g', 'P', 是否已升变], ...])   // 与 SHOGI.Board.setup 的格式一致
 *   view.setHand({ 1: {P:2}, 2: {R:1} })                    // 持驹
 *   view.setSelection(i)                                   // 高亮选中的驹
 *   view.setHints([{to:i, cap:bool}, ...])                 // 可走点：空点画蓝点、有子处画蓝圈
 *   view.setLastMove(from, to)                             // from 画虚圈、to 画绿圈
 *   view.clearMarks()
 *   view.setTurn('s')  / view.resize() / view.destroy()
 *
 * 坐标：所有下标都是引擎下标 = y * 9 + x，与 SHOGI.Board.idx(x, y) 一致。
 *   (0,0) 是棋盘左上角 = ９一（九筋一段），与 SHOGI.toLabel 同向。
 *
 * 棋子字：**用将棋界自己的写法**（歩 香 桂 銀 金 角 飛 王／玉，升变后 と 成香 成桂 成銀 馬 龍），
 *   与全站「按各棋种自己的叫法」这条原则一致。升变子用**暗红色字**区分（实物棋具的通行做法）。
 */
(function (global) {
  'use strict';

  var SIZE = 9, N = 81;
  var TAU = Math.PI * 2;
  var FONT = '"Yu Mincho","Songti SC","STSong","SimSun",serif';

  var COL = {
    bg: '#f3e5c9',          /* 棋盘木色，与象棋盘同一档 */
    handBg: '#efe0c2',      /* 持驹台比棋盘略深一点，一眼分得开 */
    line: '#c6aa81',
    frame: '#9c7f57',
    label: '#b09a78',
    star: '#b39868',
    pieceFace1: '#fff9ec',  /* 驹面：上浅下深的木色渐变 */
    pieceFace2: '#f2e4c8',
    pieceFace3: '#ddc39c',
    pieceEdge: '#b89a6e',
    pieceShadow: 'rgba(120,98,66,0.17)',
    text: '#2b2622',
    textPromoted: '#a8231b',
    sel: '#d9822b',         /* 选中：橙圈（与围棋/象棋盘的 focus 色一致） */
    hint: '#5b86ad',        /* 可走点：蓝（与全站一致） */
    last: '#2e9e5b',        /* 最后一手：绿 */
    hover: 'rgba(60,52,41,0.10)'
  };

  function ShogiBoardView(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.interactive = opts.interactive !== false;
    this.showLabels = opts.showLabels !== false;
    this.onTap = opts.onTap || null;
    this.onTapHand = opts.onTapHand || null;

    this.list = [];                                  /* [[x,y,'s'|'g',type,pro], ...] */
    this.hand = { 1: {}, 2: {} };
    this.sel = -1;
    this.hints = [];                                 /* [{to, cap}] */
    this.lastFrom = -1;
    this.lastTo = -1;
    this.hover = -1;
    this.hoverHand = null;                           /* {color, type} */

    this.w = 0; this.h = 0; this.cell = 0; this.dpr = 1;
    this.bx = 0; this.by = 0; this.margin = 0; this.handH = 0;

    this._bind();
    this.resize();
    var self = this;
    if (global.requestAnimationFrame) global.requestAnimationFrame(function () { self.resize(); });
  }

  /* ---------------- 生命周期 ---------------- */

  ShogiBoardView.prototype._bind = function () {
    var self = this;
    this.canvas.addEventListener('click', function (e) {
      if (!self.interactive) return;
      var hit = self._hit(e);
      if (!hit) return;
      if (hit.kind === 'board') {
        if (self.onTap) self.onTap(hit.i);
      } else if (self.onTapHand) {
        self.onTapHand(hit.color, hit.type);
      }
    });
    this.canvas.addEventListener('mousemove', function (e) {
      if (!self.interactive) return;
      var hit = self._hit(e);
      var hb = hit && hit.kind === 'board' ? hit.i : -1;
      var hh = hit && hit.kind === 'hand' ? (hit.color + ':' + hit.type) : null;
      if (hb !== self.hover || hh !== self.hoverHand) {
        self.hover = hb; self.hoverHand = hh; self.draw();
      }
    });
    this.canvas.addEventListener('mouseleave', function () {
      if (self.hover !== -1 || self.hoverHand) { self.hover = -1; self.hoverHand = null; self.draw(); }
    });
    this._onResize = function () { self.resize(); };
    global.addEventListener('resize', this._onResize);
    if (global.ResizeObserver && this.canvas.parentElement) {
      this._ro = new global.ResizeObserver(function () { self.resize(); });
      this._ro.observe(this.canvas.parentElement);
    }
  };

  ShogiBoardView.prototype.destroy = function () {
    if (this._onResize) global.removeEventListener('resize', this._onResize);
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this.canvas.width = 0;
    this.canvas.height = 0;
  };

  /* ---------------- 对外方法 ---------------- */

  ShogiBoardView.prototype.setList = function (list) {
    this.list = list || [];
    if (this.sel >= 0 && !this._at(this.sel)) { this.sel = -1; this.hints = []; }
    this.draw();
  };
  ShogiBoardView.prototype.setHand = function (hand) {
    this.hand = { 1: (hand && hand[1]) || {}, 2: (hand && hand[2]) || {} };
    this.draw();
  };
  ShogiBoardView.prototype.setSelection = function (i) {
    this.sel = (i === null || i === undefined || i < 0) ? -1 : i;
    this.draw();
  };
  ShogiBoardView.prototype.setHints = function (list) {
    this.hints = list || [];
    this.draw();
  };
  ShogiBoardView.prototype.setLastMove = function (from, to) {
    var ok = (from !== null && from !== undefined && from >= 0 && to !== null && to !== undefined && to >= 0);
    this.lastFrom = ok ? from : -1;
    this.lastTo = ok ? to : -1;
    this.draw();
  };
  ShogiBoardView.prototype.clearMarks = function () {
    this.sel = -1; this.hints = []; this.lastFrom = -1; this.lastTo = -1;
    this.draw();
  };
  ShogiBoardView.prototype.setInteractive = function (on) {
    this.interactive = on !== false;
    if (!this.interactive) { this.hover = -1; this.hoverHand = null; }
    this.draw();
  };

  /* ---------------- 几何 ---------------- */

  ShogiBoardView.prototype.resize = function () {
    var parent = this.canvas.parentElement;
    if (!parent) return;
    var w = parent.clientWidth;
    if (!w) return;
    var dpr = global.devicePixelRatio || 1;
    this.dpr = dpr;
    /* 布局：［后手持驹台］［上边号］［9×9 盘］［下边号］［先手持驹台］
       持驹台高度按格子大小走 —— 手里最多可能同时拿着七八枚驹，太矮会挤成一堆。 */
    /* 盘边号要留够 —— 汉字段号（一…九）比数字宽，边距按 0.028 给会把左右两侧的字裁掉一半 */
    var margin = this.showLabels ? Math.max(20, Math.round(w * 0.045)) : Math.round(w * 0.014);
    var cell = (w - margin * 2) / SIZE;
    var handH = Math.round(cell * 0.92);
    var h = handH + margin + cell * SIZE + margin + handH;
    this.w = w; this.h = h; this.cell = cell; this.margin = margin; this.handH = handH;
    this.bx = margin; this.by = handH + margin;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.draw();
  };

  /* 像素 → 命中对象：棋盘格 or 持驹台里的某一枚 */
  ShogiBoardView.prototype._hit = function (e) {
    var r = this.canvas.getBoundingClientRect();
    var sx = (e.clientX - r.left) * (this.w / r.width);
    var sy = (e.clientY - r.top) * (this.h / r.height);
    /* 先看持驹台 */
    var slots = this._handSlots();
    var i;
    for (i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (sx >= s.x0 && sx <= s.x1 && sy >= s.y0 && sy <= s.y1) {
        return { kind: 'hand', color: s.color, type: s.type };
      }
    }
    /* 再看棋盘 */
    var x = Math.floor((sx - this.bx) / this.cell);
    var y = Math.floor((sy - this.by) / this.cell);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    return { kind: 'board', i: y * SIZE + x };
  };

  /* 持驹台的**唯一真源**：一行从哪儿起笔、这一行的顶边在哪。
     ★ 绘制与点击命中都必须从这里取坐标，不许各算各的。
     （踩过的坑：早先 _handRow 画的时候先写「先手／后手」两个字、再 x += tagW 才画第一枚驹，
       而 _handSlots 算命中框时直接从 this.bx 起，**把标签宽度整个漏掉了** ——
       命中框于是整体左移一个标签宽，用起来就是「鼠标要点在棋子左边才选得中」。
       两处的 y 起点还不一致，上排更离谱：命中框和棋子干脆不重叠。） */
  ShogiBoardView.prototype._handLayout = function (color) {
    var c = this.cell, ctx = this.ctx;
    var who = color === 1 ? '先手' : '后手';
    /* 用与绘制同一号的字测宽，保证 tagW 和画出来的完全一致 */
    ctx.save();
    ctx.font = Math.max(9, Math.round(c * 0.3)) + 'px ' + FONT;
    var tagW = ctx.measureText(who).width + c * 0.16;
    ctx.restore();
    /* 行顶边 y —— 棋子的方块画在 top + 0.43c，高 0.88c，所以命中框取 [top, top + 0.86c] */
    var top = (color === 2)
      ? this.by - this.margin * 1.2 - c * 0.92
      : this.by + c * SIZE + this.margin * 0.5;
    return { who: who, tagW: tagW, top: top, x0: this.bx + tagW };
  };

  /* 持驹台里每一枚驹占据的小方块（点击命中与绘制共用同一份计算，不会对不上） */
  ShogiBoardView.prototype._handSlots = function () {
    var out = [], self = this, c = this.cell;
    var order = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
    function row(color) {
      var L = self._handLayout(color), x = L.x0;
      for (var j = 0; j < order.length; j++) {
        var t = order[j], n = self.hand[color][t] || 0;
        if (!n) continue;
        for (var k = 0; k < n; k++) {
          out.push({
            kind: 'hand', color: color, type: t,
            x0: x, x1: x + c * 0.86, y0: L.top, y1: L.top + c * 0.86
          });
          x += c * 0.86;
        }
      }
    }
    row(2); row(1);
    return out;
  };

  ShogiBoardView.prototype._at = function (i) {
    var x = i % SIZE, y = (i / SIZE) | 0;
    for (var k = 0; k < this.list.length; k++) {
      var s = this.list[k];
      if (s[0] === x && s[1] === y) return s;
    }
    return null;
  };

  /* ---------------- 绘制 ---------------- */

  ShogiBoardView.prototype.draw = function () {
    var ctx = this.ctx, c = this.cell, i, k;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!c) return;

    /* 底色：棋盘木色 + 上下两条持驹台 */
    ctx.fillStyle = COL.bg;
    ctx.fillRect(this.bx, this.by, c * SIZE, c * SIZE);
    ctx.fillStyle = COL.handBg;
    ctx.fillRect(0, 0, this.w, this.by);
    ctx.fillRect(0, this.by + c * SIZE, this.w, this.h - this.by - c * SIZE);

    /* 格子线：9×9 个格子，所以竖横各 10 条 */
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = Math.max(1, Math.round(c * 0.035));
    ctx.beginPath();
    for (i = 0; i <= SIZE; i++) {
      ctx.moveTo(Math.round(this.bx + i * c) + 0.5, this.by);
      ctx.lineTo(Math.round(this.bx + i * c) + 0.5, this.by + c * SIZE);
      ctx.moveTo(this.bx, Math.round(this.by + i * c) + 0.5);
      ctx.lineTo(this.bx + c * SIZE, Math.round(this.by + i * c) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = COL.frame;
    ctx.lineWidth = Math.max(1.5, c * 0.055);
    ctx.strokeRect(this.bx, this.by, c * SIZE, c * SIZE);

    /* 星四点：３三・３六・６三・６六（筋段各自 3、6 的交点） */
    ctx.fillStyle = COL.star;
    var stars = [[3, 3], [6, 3], [3, 6], [6, 6]];
    for (k = 0; k < stars.length; k++) {
      ctx.beginPath();
      ctx.arc(this.bx + stars[k][0] * c, this.by + stars[k][1] * c, Math.max(2, c * 0.075), 0, TAU);
      ctx.fill();
    }

    if (this.showLabels) this._labels(ctx);

    /* 悬停高亮（先画在驹下面，免得盖住字） */
    if (this.hover >= 0 && this.interactive) {
      ctx.fillStyle = COL.hover;
      ctx.fillRect(this.bx + (this.hover % SIZE) * c, this.by + (((this.hover / SIZE) | 0)) * c, c, c);
    }

    /* 驹 */
    for (k = 0; k < this.list.length; k++) {
      var s = this.list[k];
      if (s[0] < 0 || s[0] >= SIZE || s[1] < 0 || s[1] >= SIZE) continue;
      this._piece(ctx,
        this.bx + (s[0] + 0.5) * c, this.by + (s[1] + 0.5) * c,
        c, s[2] === 's' || s[2] === 1 ? 1 : 2, s[3], !!s[4]);
    }

    /* 选中圈 */
    if (this.sel >= 0) {
      ctx.strokeStyle = COL.sel;
      ctx.lineWidth = Math.max(2, c * 0.075);
      this._roundCell(ctx, this.sel, c * 0.86);
      ctx.stroke();
    }
    /* 可走点：空点画蓝点、有子处画蓝圈（与围棋/象棋的用法一致） */
    for (k = 0; k < this.hints.length; k++) {
      var hn = this.hints[k], hx = hn.to % SIZE, hy = (hn.to / SIZE) | 0;
      var px = this.bx + (hx + 0.5) * c, py = this.by + (hy + 0.5) * c;
      if (hn.cap) {
        ctx.strokeStyle = COL.hint;
        ctx.lineWidth = Math.max(2, c * 0.07);
        ctx.beginPath();
        ctx.arc(px, py, c * 0.46, 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillStyle = COL.hint;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(3, c * 0.17), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    /* 最后一手：起点虚圈、终点绿圈 */
    if (this.lastFrom >= 0) {
      ctx.strokeStyle = 'rgba(46,158,91,0.5)';
      ctx.lineWidth = Math.max(1.5, c * 0.05);
      ctx.setLineDash([c * 0.14, c * 0.12]);
      this._roundCell(ctx, this.lastFrom, c * 0.86);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.lastTo >= 0) {
      ctx.strokeStyle = COL.last;
      ctx.lineWidth = Math.max(2, c * 0.075);
      this._roundCell(ctx, this.lastTo, c * 0.9);
      ctx.stroke();
    }

    /* 持驹台 —— 位置全从 _handSlots() 取，与点击命中同一份数据 */
    var handSlots = this._handSlots();
    this._handRow(ctx, 2, handSlots);
    this._handRow(ctx, 1, handSlots);
  };

  ShogiBoardView.prototype._roundCell = function (ctx, i, r) {
    var c = this.cell;
    var px = this.bx + ((i % SIZE) + 0.5) * c;
    var py = this.by + (((i / SIZE) | 0) + 0.5) * c;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.5, 0, TAU);
    ctx.stroke();
  };

  /* 盘边号：上边与下边写筋号（９…１，从右往左），左边与右边写段号（一…九，从上往下） */
  /* 盘边号：上下写筋号（９…１，右起），左右写段号（一…九，上起）。
     数字用**全角**，与 SHOGI.toLabel 的「７六」是同一套字形，不混半角。 */
  ShogiBoardView.prototype._labels = function (ctx) {
    var c = this.cell, i, ZEN = '０１２３４５６７８９', KANJI = '一二三四五六七八九';
    ctx.fillStyle = COL.label;
    ctx.font = Math.max(9, Math.round(c * 0.30)) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < SIZE; i++) {
      var px = this.bx + (i + 0.5) * c;          /* 筋：x=0 是 9 筋 */
      var fz = ZEN.charAt(SIZE - i);
      ctx.fillText(fz, px, this.by - this.margin * 0.5);
      ctx.fillText(fz, px, this.by + c * SIZE + this.margin * 0.5);
    }
    for (i = 0; i < SIZE; i++) {
      var py = this.by + (i + 0.5) * c;
      var rz = KANJI.charAt(i);
      ctx.fillText(rz, this.bx - this.margin * 0.55, py);
      ctx.fillText(rz, this.bx + c * SIZE + this.margin * 0.55, py);
    }
  };

  /* 持驹台：把某一方手里的驹按 飞→角→金→银→桂→香→步 排开，枚数用右下角小数字标。
     每一枚的位置**直接取 _handSlots() 的小方块** —— 绝不能在这里另算一套 x/y。 */
  ShogiBoardView.prototype._handRow = function (ctx, color, slots) {
    var c = this.cell, L = this._handLayout(color), i;
    var fs = Math.max(9, Math.round(c * 0.3));
    ctx.font = fs + 'px ' + FONT;
    ctx.fillStyle = COL.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(L.who, this.bx, L.top + c * 0.43);

    var mine = [], j;
    for (j = 0; j < slots.length; j++) if (slots[j].color === color) mine.push(slots[j]);
    if (!mine.length) {
      ctx.font = Math.max(9, Math.round(c * 0.26)) + 'px ' + FONT;
      ctx.fillStyle = COL.label;
      ctx.fillText('（手里没有驹）', L.x0 + c * 0.1, L.top + c * 0.43);
      return;
    }
    for (i = 0; i < mine.length; i++) {
      var s = mine[i];
      var hovered = this.hoverHand === (color + ':' + s.type);
      this._piece(ctx, s.x0 + c * 0.43, L.top + c * 0.43, c, color, s.type, false, hovered);
    }
  };

  /* 一枚五角形驹。color: 1 先手（尖头朝上）/ 2 后手（尖头朝下）。
     hovered 时描一圈橙色边。

     ── 形状照实物比例来（这里返过工）──────────────────────────────
     真实将棋驹是「**肩窄、底宽**」的五角形：顶上收成一个尖角，两条侧边从肩
     向底部**微微外张**。早先的写法是顶点 → 肩 → 底用同一个 x（侧边垂直），
     画出来像块方木牌、尖顶也钝，完全没有驹的样子。
       高 : 底宽 ≈ 1 : 0.88（实物大致是竖着略长的一条）
       肩宽 ≈ 底宽的 0.72，肩的位置在顶往下 27% 处
     这样顶点到肩的斜边接近 45°，肩到底边外张约 10° —— 才是驹的轮廓。 */
  ShogiBoardView.prototype._piece = function (ctx, cx, cy, cell, color, type, pro, hovered) {
    var hh = cell * 0.84;                 /* 总高 */
    var bw = hh * 0.88;                   /* 底宽（最宽处） */
    var sw = bw * 0.72;                   /* 肩宽（比底窄） */
    var topY = -hh / 2, botY = hh / 2;
    var sy = topY + hh * 0.27;            /* 两肩的高度 */
    var up = color === 1;

    function outline(dx, dy) {
      ctx.beginPath();
      ctx.moveTo(dx, dy + topY);
      ctx.lineTo(dx + sw / 2, dy + sy);
      ctx.lineTo(dx + bw / 2, dy + botY);
      ctx.lineTo(dx - bw / 2, dy + botY);
      ctx.lineTo(dx - sw / 2, dy + sy);
      ctx.closePath();
    }

    ctx.save();
    ctx.translate(cx, cy);
    if (!up) ctx.scale(1, -1);          /* 后手整体上下翻转 —— 尖头就朝着对方了 */
    /* 先压一层淡影：只做偏移、不做模糊，几乎不花时间，但驹一下就有了厚度。
       后手是翻转过来的，偏移量也要跟着翻，影子才始终落在**屏幕的下方**。 */
    outline(cell * 0.010, up ? cell * 0.024 : -cell * 0.024);
    ctx.fillStyle = COL.pieceShadow;
    ctx.fill();
    outline(0, 0);
    var g = ctx.createLinearGradient(0, topY, 0, botY);
    g.addColorStop(0, COL.pieceFace1);
    g.addColorStop(0.55, COL.pieceFace2);
    g.addColorStop(1, COL.pieceFace3);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = hovered ? COL.sel : COL.pieceEdge;
    ctx.lineWidth = Math.max(1, cell * (hovered ? 0.055 : 0.024));
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    /* 字要正着写（不能跟着驹翻）—— 所以另行绘制 */
    var glyph = (global.SHOGI && global.SHOGI.glyph) ? global.SHOGI.glyph(type, pro)
      : ((pro && { R: '龍', B: '馬', S: '成銀', N: '成桂', L: '成香', P: 'と' }[type]) || { K: '王', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩' }[type] || '');
    /* 将棋界的写法：先手的王写「王」、后手的写「玉」 */
    if (type === 'K' && color === 2) glyph = '玉';
    if (!glyph) return;
    var two = glyph.length > 1;
    ctx.fillStyle = pro ? COL.textPromoted : COL.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* 字往**底边**偏一点点（尖顶那头要留白）—— 这就是为什么偏移量要跟着朝向走 */
    var off = up ? cell * 0.03 : -cell * 0.03;
    /* 字号跟着**底宽**走，不跟着格子走 —— 驹一收窄，按格子给的字就顶边了 */
    if (two) {
      /* 「成銀」这种两字驹：上下叠着写，和实物一致。行距要留够，不然两字会叠上 */
      ctx.font = Math.round(bw * 0.40) + 'px ' + FONT;
      var dy = cell * 0.145;
      ctx.fillText(glyph.charAt(0), cx, cy - dy + off);
      ctx.fillText(glyph.charAt(1), cx, cy + dy + off);
    } else {
      ctx.font = Math.round(bw * 0.62) + 'px ' + FONT;
      ctx.fillText(glyph, cx, cy + off);
    }
  };

  var ShogiBoard = {
    mount: function (canvas, opts) {
      var v = new ShogiBoardView(canvas, opts);
      /* 挂一份引用，方便测试与调试读取棋盘状态（与围棋盘 canvas.__boardView 同一做法） */
      if (canvas) canvas.__shogiView = v;
      return v;
    },
    View: ShogiBoardView,
    COL: COL,
    SIZE: SIZE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ShogiBoard;
  else global.ShogiBoard = ShogiBoard;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
