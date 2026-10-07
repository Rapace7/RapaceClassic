/* 棋盘渲染组件 —— Canvas 绘制，支持点击落子、标记、响应式 */
(function (global) {
  'use strict';

  var COL = {
    boardBg: '#f3e5c9',
    boardBg2: '#faf1de',
    line: '#c6aa81',
    lineEdge: '#ab8e64',
    label: '#b09a78',
    black1: '#6d635a', black2: '#2e2a26',
    white1: '#fffefb', white2: '#ece4d6',
    ghost: 'rgba(172,152,122,0.38)',
    lib: '#7f9a72',
    good: '#7f9a72',
    bad: '#c9907e',
    point: '#5b86ad',   /* 中性提示点：**蓝点** —— 讲解文案里 53 处都写「蓝点」，
                            而这个值原先误配成棕色 #b08968（连下面 case 的注释都写着「蓝点」）。
                            改成蓝之后与全站文案一致，也不再有人问「蓝点在哪」。 */
    eye: '#8fa87a',
    lastMove: '#2e9e5b',
    focus: '#d9822b'    /* 题面指定的「就是这几颗」——橙色圆环。
                           用处：题面写「下边有两块黑棋」时，棋盘下边往往一大片黑子，
                           读者根本找不到说的是哪两块。用 focus 直接圈出来，指向就明确了。 */
  };

  function GoBoardView(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = opts.size || 9;
    this.onPlay = opts.onPlay || null;
    this.interactive = opts.interactive !== false;
    this.showLabels = opts.showLabels !== false;
    this.stones = [];
    this.marks = [];
    this.lastMove = null;
    this.hover = null;
    this.padding = 0;
    this.cell = 0;
    this.dpr = 1;
    this.hideStones = false;
    this._bind();
    this.resize();
  }

  GoBoardView.prototype._bind = function () {
    var self = this;
    this.canvas.addEventListener('click', function (e) {
      if (!self.interactive) return;
      var p = self._toBoard(e);
      if (p && self.onPlay) self.onPlay(p.x, p.y);
    });
    this.canvas.addEventListener('mousemove', function (e) {
      if (!self.interactive) return;
      var p = self._toBoard(e);
      var changed = (!!p !== !!self.hover) ||
        (p && self.hover && (p.x !== self.hover.x || p.y !== self.hover.y));
      self.hover = p;
      if (changed) self.draw();
    });
    this.canvas.addEventListener('mouseleave', function () {
      if (self.hover) { self.hover = null; self.draw(); }
    });
    this._onResize = function () { self.resize(); };
    window.addEventListener('resize', this._onResize);
  };

  GoBoardView.prototype.destroy = function () {
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this.canvas.width = 0;
    this.canvas.height = 0;
  };

  GoBoardView.prototype._toBoard = function (e) {
    if (!this.cell) return null;
    var r = this.canvas.getBoundingClientRect();
    var x = (e.clientX - r.left) * (this.canvas.width / this.dpr) / r.width;
    var y = (e.clientY - r.top) * (this.canvas.height / this.dpr) / r.height;
    var gx = Math.round((x - this.padding) / this.cell);
    var gy = Math.round((y - this.padding) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.size || gy >= this.size) return null;
    var dx = x - (this.padding + gx * this.cell);
    var dy = y - (this.padding + gy * this.cell);
    if (Math.sqrt(dx * dx + dy * dy) > this.cell * 0.62) return null;
    return { x: gx, y: gy };
  };

  GoBoardView.prototype.setSize = function (n) {
    this.size = n;
    this.resize();
  };

  GoBoardView.prototype.setStones = function (stones) {
    this.stones = stones || [];
    this.draw();
  };

  GoBoardView.prototype.setMarks = function (marks) {
    this.marks = marks || [];
    this.draw();
  };

  GoBoardView.prototype.setLastMove = function (m) {
    this.lastMove = m;
    this.draw();
  };

  GoBoardView.prototype.resize = function () {
    var parent = this.canvas.parentElement;
    if (!parent) return;
    var w = parent.clientWidth;
    if (!w) return;
    var dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(w * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = w + 'px';
    var pr = this.showLabels ? 0.075 : 0.05;
    this.padding = w * pr;
    this.cell = (w - this.padding * 2) / (this.size - 1);
    this.draw();
  };

  GoBoardView.prototype.draw = function () {
    var ctx = this.ctx, s = this.size, w = this.canvas.width / this.dpr;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, w);

    /* 木色底 */
    ctx.fillStyle = COL.boardBg;
    ctx.fillRect(0, 0, w, w);
    var grd = ctx.createLinearGradient(0, 0, w, w);
    grd.addColorStop(0, 'rgba(255,252,245,0.55)');
    grd.addColorStop(1, 'rgba(190,162,122,0.07)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, w);

    var pad = this.padding, cell = this.cell, i, j;
    var end = pad + cell * (s - 1);

    /* 网格 */
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = Math.max(1, cell * 0.014);
    ctx.beginPath();
    for (i = 0; i < s; i++) {
      ctx.moveTo(pad, pad + i * cell);
      ctx.lineTo(end, pad + i * cell);
      ctx.moveTo(pad + i * cell, pad);
      ctx.lineTo(pad + i * cell, end);
    }
    ctx.stroke();

    /* 外框加粗 */
    ctx.strokeStyle = COL.lineEdge;
    ctx.lineWidth = Math.max(1.5, cell * 0.028);
    ctx.strokeRect(pad, pad, end - pad, end - pad);

    /* 星位 */
    var stars = this._stars(s);
    ctx.fillStyle = COL.lineEdge;
    for (i = 0; i < stars.length; i++) {
      ctx.beginPath();
      ctx.arc(pad + stars[i][0] * cell, pad + stars[i][1] * cell, Math.max(2, cell * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }

    /* 坐标 */
    if (this.showLabels) {
      var letters = 'ABCDEFGHJKLMNOPQRST';
      ctx.fillStyle = COL.label;
      ctx.font = Math.max(9, cell * 0.30) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (i = 0; i < s; i++) {
        ctx.fillText(letters[i], pad + i * cell, pad * 0.48);
        ctx.fillText(letters[i], pad + i * cell, end + pad * 0.55);
        ctx.fillText(String(s - i), pad * 0.5, pad + i * cell);
        ctx.fillText(String(s - i), end + pad * 0.52, pad + i * cell);
      }
    }

    /* 棋子 */
    var st = this.stones, k;
    if (!this.hideStones) {
      for (k = 0; k < st.length; k++) {
        var sx = st[k][0], sy = st[k][1], sc = st[k][2];
        if (sx < 0 || sy < 0 || sx >= s || sy >= s) continue;
        this._stone(pad + sx * cell, pad + sy * cell, cell * 0.465, sc);
      }
    }

    /* 最后一手：在**棋子正中央**点一个绿点。
       旧的写法是棋子外面套一圈橙红细环，在木色盘面上几乎看不出来 ——
       用户点名「名局讲解里每一步棋都看不出最新手落在哪」，所以改成实心绿点。
       黑子上加一圈浅边、白子上加一圈深边，两个底色上都看得清。 */
    if (this.lastMove) {
      var lm = this.lastMove;
      var lcx = pad + lm[0] * cell, lcy = pad + lm[1] * cell;
      /* 2026-09-28 用户反馈「绿点太大、看着不舒服」：半径从 0.23 缩到 0.16，
         描边一并与半径同比收细，白子上那圈垫底色也跟着收 ——
         只改尺寸、不动颜色，保证「一眼看到最新手」的效果还在。 */
      var lr = cell * 0.16;
      var onBlack = (this._stoneAt(lm[0], lm[1]) === 'b' || this._stoneAt(lm[0], lm[1]) === 1);
      /* 白子在奶油色盘面上本来就对比弱，绿点单靠自身会显得「浮在盘上」，
         所以白子上给它一圈**深绿描边**、黑子上给一圈**浅色描边**，两边都咬得住。 */
      if (!onBlack) {
        ctx.beginPath();
        ctx.arc(lcx, lcy, lr + cell * 0.03, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(lcx, lcy, lr, 0, Math.PI * 2);
      ctx.fillStyle = COL.lastMove;
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.028);
      ctx.strokeStyle = onBlack ? 'rgba(255,255,255,0.95)' : '#1c6b40';
      ctx.stroke();
    }

    /* 悬停提示 */
    if (this.hover && this.interactive) {
      ctx.fillStyle = 'rgba(60,52,41,0.18)';
      ctx.beginPath();
      ctx.arc(pad + this.hover.x * cell, pad + this.hover.y * cell, cell * 0.44, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 标记 */
    var mk = this.marks;
    for (k = 0; k < mk.length; k++) {
      this._mark(pad + mk[k][0] * cell, pad + mk[k][1] * cell, cell, mk[k][2], mk[k][3], mk[k][0], mk[k][1]);
    }

    ctx.restore();
  };

  GoBoardView.prototype._stone = function (cx, cy, r, color) {
    var ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + r * 0.10, cy + r * 0.13, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(158,133,102,0.15)';
    ctx.fill();
    var g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.40, r * 0.10, cx, cy, r * 1.05);
    if (color === 'b' || color === 1) {
      g.addColorStop(0, COL.black1);
      g.addColorStop(1, COL.black2);
    } else {
      g.addColorStop(0, COL.white1);
      g.addColorStop(1, COL.white2);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = (color === 'b' || color === 1) ? 'rgba(90,80,70,0.42)' : 'rgba(170,155,132,0.48)';
    ctx.lineWidth = Math.max(0.8, r * 0.05);
    ctx.stroke();
    ctx.restore();
  };

  /* 找 (gx,gy) 上有没有子，返回颜色 'b'/'w'，没有则 null */
  GoBoardView.prototype._stoneAt = function (gx, gy) {
    var st = this.stones, k;
    for (k = 0; k < st.length; k++) {
      if (st[k][0] === gx && st[k][1] === gy) return st[k][2];
    }
    return null;
  };

  GoBoardView.prototype._mark = function (cx, cy, cell, type, text, gx, gy) {
    var ctx = this.ctx, r;
    ctx.save();
    switch (type) {
      case 'lib': /* 气：绿色空心圆 */
        ctx.strokeStyle = COL.lib;
        ctx.lineWidth = Math.max(1.6, cell * 0.055);
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.20, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'good': /* 正确点：绿色实心 */
        ctx.fillStyle = COL.good;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.22, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'bad': /* 禁入 / 错误：红叉 */
        ctx.strokeStyle = COL.bad;
        ctx.lineWidth = Math.max(2, cell * 0.075);
        r = cell * 0.22;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
        break;
      case 'point': /* 中性提示点：蓝点 */
        ctx.fillStyle = COL.point;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'eye': /* 眼：绿环 */
        ctx.strokeStyle = COL.eye;
        ctx.lineWidth = Math.max(2, cell * 0.07);
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.26, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'focus': /* 题目指定的目标棋子：橙色粗环。
                       半径压在棋子范围内（0.32），比 'eye' 更粗更醒目，
                       黑子白子上都能看清，也不会盖住棋子的颜色。 */
        ctx.strokeStyle = COL.focus;
        ctx.lineWidth = Math.max(2.2, cell * 0.085);
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.32, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'shape': /* 示意空点：灰色实心 */
        ctx.fillStyle = 'rgba(110,100,85,0.42)';
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.19, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'ghost': /* 刚被提掉的位置：虚线圈 */
        ctx.strokeStyle = COL.ghost;
        ctx.lineWidth = Math.max(1.2, cell * 0.045);
        ctx.setLineDash([cell * 0.12, cell * 0.10]);
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'label': /* 在交叉点上写第 4 个元素里的文字（如序号 1、2、3） */
        var txt = (text === undefined || text === null) ? '' : String(text);
        if (!txt) break;
        /* 底下是黑子 → 用浅底深字；底下是白子或空点 → 用深底浅字。
           这样黑白棋子和木色盘面上都看得清。 */
        var onBlack = (this._stoneAt(gx, gy) === 'b' || this._stoneAt(gx, gy) === 1);
        var lr = cell * 0.30;
        ctx.beginPath();
        ctx.arc(cx, cy, lr, 0, Math.PI * 2);
        ctx.fillStyle = onBlack ? 'rgba(250,245,236,0.95)' : 'rgba(60,52,41,0.82)';
        ctx.fill();
        ctx.strokeStyle = onBlack ? 'rgba(176,137,104,0.9)' : 'rgba(250,245,236,0.9)';
        ctx.lineWidth = Math.max(1, cell * 0.032);
        ctx.stroke();
        ctx.fillStyle = onBlack ? '#3c332a' : '#fdfaf5';
        ctx.font = '600 ' + Math.max(9, cell * 0.40) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, cx, cy);
        break;
      default:
        break;
    }
    ctx.restore();
  };

  GoBoardView.prototype._stars = function (s) {
    if (s === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
    if (s === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
    if (s === 19) return [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]];
    var mid = Math.floor(s / 2);
    var d = s >= 15 ? 3 : 2;
    return [[d, d], [s - 1 - d, d], [d, s - 1 - d], [s - 1 - d, s - 1 - d], [mid, mid]];
  };

  /* 从引擎 Board 取棋子列表 */
  GoBoardView.fromEngine = function (bd) {
    var out = [], i;
    for (i = 0; i < bd.n; i++) {
      if (bd.g[i] !== 0) out.push([i % bd.size, (i / bd.size) | 0, bd.g[i] === 1 ? 'b' : 'w']);
    }
    return out;
  };

  global.GoBoardView = GoBoardView;

})(window);
