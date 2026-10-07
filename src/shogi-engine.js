/* 日本将棋规则引擎 —— 纯 JavaScript，零依赖，浏览器与 Node 通用
 *
 * 为什么单独写第三个引擎：
 *   围棋引擎是「气 / 块 / 提子」，象棋引擎是「棋子走形 + 将帅安全」，
 *   将棋除了走形，还多出三件前两者都没有的事 —— **升变、持驹、打步诘**。
 *   硬塞进象棋引擎会把两边都搅浑（象棋没有"吃掉对方的子还能拿回来当自己的用"这种概念），
 *   所以这里只做将棋规则，界面层按下面的接口调用即可。
 *
 * ── 棋盘语义（与前两个引擎对齐的部分）────────────────────────────
 *   固定 9 列 × 9 行（SIZE=9, N=81）
 *   bd.g[i]   该点归属：0 空 / 1 先手 / 2 后手
 *   bd.t[i]   该点驹型：'K'王 'R'飞 'B'角 'G'金 'S'银 'N'桂 'L'香 'P'步；空点 null
 *   bd.p[i]   该点是否已升变：1 已升 / 0 未升（空点恒为 0）
 *   bd.idx(x, y) / bd.xy(i)   x 从 0 起左→右，y 从 0 起上→下，(0,0)=棋盘左上角
 *   bd.hand   持驹：bd.hand[1]['P'] = 先手手里有几枚步
 *   bd.setup(stones, hand, toMove)   摆局面（见下）
 *   SHOGI.toLabel(i) 转成将棋自己的记法
 *
 * ── play 与 drop（与围棋 play(i,color) 的差异）───────────────────
 *   围棋落子只需 1 个点；将棋有两种着手，签名各自独立：
 *       bd.play(from, to, color, promote)   走子（promote=true 表示这一手升变）
 *       bd.drop(type, to, color)            打驹（把持驹放到空点）
 *   两者返回 {ok:true, rec, captured} 或 {ok:false, reason}，都可用 bd.undo(rec) 完整回滚。
 *   `play` 另提供 bd.play(mv, color) 写法，mv 为 {from, to, promote}（legalMoves 的元素）。
 *
 * ── 坐标口径（这里换成将棋界自己的记法，不再用字母+数字）──────────
 *   筋（列）：**从右往左**数 1–9，最右一列是 1 筋；内部 x=8 是 1 筋 ⇒ 筋 = 9 - x
 *   段（行）：**从上往下**数 一–九；内部 y=0 是一段 ⇒ 段 = y + 1
 *   于是棋盘左上角 (0,0) 显示成「９一」，右下角 (8,8) 显示成「１九」。
 *   显示格式为「７六」＝全角数字筋 + 汉字段，与棋谱的坐标部分一致
 *   （棋谱后面还跟驹名与「成／打」，那属于**走法记谱**，不在本引擎范围内）。
 *
 * ── 先手 / 后手 ──────────────────────────────────────────────
 *   将棋不说黑白，说先手（先走的一方，朝上走）与后手（朝下走）。
 *   引擎内部沿用 g[] 的 1/2，只是名字换成 SHOGI.colorName()。
 *   上下翻转只在生成走法的最后一步做（dy 整体取反）—— 驹的左右步法本身对称，
 *   所以不需要动 dx，这一点与象棋不同（象棋红黑同形，将棋则是镜像）。
 *
 * ── 已实现 ───────────────────────────────────────────────────
 *   八种驹的走法（含龙马的「滑行 + 单步」叠加）
 *   升变：进入／离开／在敌阵内可自选；不能再走的落点（步香到最后一段、桂到最后两段）强制升变
 *   持驹：吃到的驹（升变子还原为原形）进自己手里；drop 可打回盘上
 *   禁手：二步（同筋两个己方未升变的步）、打步诘、打驹到无处可走的位置、打驹送将
 *   王手 bd.isChecked、诘み bd.isMate、合法着法 bd.legalMoves（含打驹）
 *   着法栈 bd.moves、完全回滚 bd.undo（**含持驹**）、初形 bd.reset()
 *   坐标 SHOGI.toLabel / fromLabel
 *
 * ── 未实现（界面层不要依赖）────────────────────────────────────
 *   1) 千日手（同一局面反复出现）与入玉宣言法 —— 需要局面历史与点数计算，本轮不做。
 *   2) 走法记谱（「７六歩」「同歩」「５八金右」那套完整写法）—— 未实现，只有点的名字。
 *   3) 终盘「持将棋」（双方王都入玉）判定 —— 未实现。
 */
(function (global) {
  'use strict';

  var SIZE = 9, N = 81;
  var EMPTY = 0, SENTE = 1, GOTE = 2;

  /* 持驹显示顺序：大驹在前，与将棋的惯例一致（飞角金金银桂香步） */
  var HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

  var NAME = { K: '王将', R: '飞车', B: '角行', G: '金将', S: '银将', N: '桂马', L: '香车', P: '步兵' };
  /* 升变后的名字（金与王没有升变形态） */
  var NAME_P = { R: '龙王', B: '龙马', S: '成银', N: '成桂', L: '成香', P: 'と金' };
  /* 棋子面上刻的字 —— 用将棋界的写法（繁体/日文新字体），全站统一，不混用简体 */
  var GLYPH = { K: '王', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩' };
  var GLYPH_P = { R: '龍', B: '馬', S: '成銀', N: '成桂', L: '成香', P: 'と' };

  var ZEN = '０１２３４５６７８９';
  var KANJI = '〇一二三四五六七八九';

  function other(c) { return c === SENTE ? GOTE : SENTE; }
  function inBoard(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }

  /* ── 步法表：一律以**先手**为基准写（dy 为负 = 向前）。
       后手在 movesFrom 里把 dy 整体取反即可 —— 驹的左右对称，dx 不用动。 */
  var ORTHO = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  var DIAG = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  var STEP = {
    K: ORTHO.concat(DIAG),                                        /* 王：八方各一格 */
    G: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]],     /* 金：六向，只差两个斜后 */
    S: [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]],             /* 银：五向，不能横走不能直退 */
    N: [[-1, -2], [1, -2]],                                       /* 桂：跳，中间那格不挡也不吃 */
    P: [[0, -1]],                                                 /* 步：向前一格 */
    L: [], R: [], B: []                                           /* 后三者全是滑行，见 SLIDE */
  };
  var SLIDE = {
    R: ORTHO,            /* 飞车：直线任意步 */
    B: DIAG,             /* 角行：斜线任意步 */
    L: [[0, -1]]         /* 香车：只向前滑 */
  };
  /* 升变后的**额外**走法：龙 = 飞 + 斜一格，马 = 角 + 直一格。
     其余升变（成银／成桂／成香／と金）一律按金走 —— 这是将棋里最省事也最容易忘的一条。 */
  var PROMO_STEP = { R: DIAG, B: ORTHO };
  var PROMO_SLIDE = { R: ORTHO, B: DIAG };

  /* 敌阵：先手在棋盘上方三段，后手在下方三段 */
  function inZone(i, color) {
    var y = (i / SIZE) | 0;
    return color === SENTE ? y <= 2 : y >= SIZE - 3;
  }
  /* 该落点是否让这枚驹再也走不动 —— 将棋禁止把驹放在这种位置（也不能走过去） */
  function canStand(k, to, color) {
    var y = (to / SIZE) | 0;
    if (k === 'P' || k === 'L') return color === SENTE ? y > 0 : y < SIZE - 1;
    if (k === 'N') return color === SENTE ? y > 1 : y < SIZE - 2;
    return true;
  }

  /* 升变检查里的 isMate 会再调 legalMoves，而 legalMoves 又会试打步，
     打步又要查打步诘 —— 不加限制会互相递归。这个深度计数让「打步诘」只在最外层检查一次。 */
  var probeDepth = 0;

  function Board() {
    this.size = SIZE;
    this.n = N;
    this.g = new Int8Array(N);
    this.t = new Array(N);
    this.p = new Uint8Array(N);
    for (var i = 0; i < N; i++) this.t[i] = null;
    this.hand = { 1: {}, 2: {} };
    this.moves = [];
    this.toMove = SENTE;
  }

  Board.prototype.idx = function (x, y) { return y * SIZE + x; };
  Board.prototype.xy = function (i) { return { x: i % SIZE, y: (i / SIZE) | 0 }; };
  Board.prototype.at = function (x, y) {
    if (!inBoard(x, y)) return -1;
    return this.g[this.idx(x, y)];
  };
  Board.prototype.typeAt = function (x, y) {
    if (!inBoard(x, y)) return null;
    return this.t[this.idx(x, y)];
  };
  Board.prototype.handCount = function (color, type) {
    return this.hand[color][String(type).toUpperCase()] || 0;
  };

  Board.prototype.findKing = function (color) {
    for (var i = 0; i < N; i++) if (this.g[i] === color && this.t[i] === 'K') return i;
    return -1;
  };

  /* ── 走法生成：由驹的「步形」统一推出伪合法着法 ────────────────
   * 返回终点下标数组；不做「王手放置」过滤（那是 play/isChecked 的事）。
   * 所有驹共用此函数，不在别处硬编码任何一格。 */
  Board.prototype.movesFrom = function (i) {
    var c = this.g[i];
    if (c === EMPTY) return [];
    var k = this.t[i], pro = this.p[i] === 1;
    var dir = (c === SENTE) ? 1 : -1;
    var self = this, out = [];
    var px = i % SIZE, py = (i / SIZE) | 0;

    function push(xx, yy) {
      if (!inBoard(xx, yy)) return;
      var q = self.idx(xx, yy);
      if (self.g[q] === c) return;     /* 不能吃自己的驹 */
      out.push(q);
    }
    function slide(dx, dy) {
      var xx = px + dx, yy = py + dy;
      while (inBoard(xx, yy)) {
        var q = self.idx(xx, yy);
        if (self.g[q] === EMPTY) out.push(q);
        else { if (self.g[q] !== c) out.push(q); break; }
        xx += dx; yy += dy;
      }
    }

    var steps, slides, j, d;
    if (pro && (k === 'R' || k === 'B')) {
      steps = PROMO_STEP[k]; slides = PROMO_SLIDE[k];   /* 龙 / 马：滑行照旧，另加单步 */
    } else if (pro) {
      steps = STEP.G; slides = [];                      /* 其余升变形态一律走金 */
    } else {
      steps = STEP[k] || []; slides = SLIDE[k] || [];
    }
    for (j = 0; j < steps.length; j++) {
      d = steps[j];
      push(px + d[0], py + d[1] * dir);
    }
    for (j = 0; j < slides.length; j++) {
      d = slides[j];
      slide(d[0], d[1] * dir);
    }
    return out;
  };

  /* 某点是否被 byColor 攻击。用统一的 movesFrom 推导，不对某种驹开特例。
     注：桂马的攻击点也由 movesFrom 自然给出，不需要单独处理。 */
  Board.prototype.isAttacked = function (i, byColor) {
    for (var j = 0; j < N; j++) {
      if (this.g[j] !== byColor) continue;
      if (this.movesFrom(j).indexOf(i) >= 0) return true;
    }
    return false;
  };

  /* 某方的王是否被将军（将棋没有「照面」概念，两王同列是允许的） */
  Board.prototype.isChecked = function (color) {
    var k = this.findKing(color);
    if (k < 0) return true;                       /* 王不在场，视为已被诘 */
    return this.isAttacked(k, other(color));
  };

  /* ── 走子 ──────────────────────────────────────────────────
   * bd.play(from, to, color, promote)  或  bd.play({from, to, promote}, color)
   * 返回 {ok:true, rec, captured} / {ok:false, reason}
   * 这里已做完所有合法性校验（驹形、升变资格、王手放置、吃王），
   * 所以 play 成功 == 着一手合法棋。 */
  Board.prototype.play = function (a, b, c, d) {
    var from, to, color, promote;
    if (a && typeof a === 'object') { from = a.from; to = a.to; color = b; promote = !!a.promote; }
    else { from = a; to = b; color = c; promote = !!d; }

    if (from == null || to == null) return { ok: false, reason: 'bad-args' };
    if (from < 0 || from >= N || to < 0 || to >= N) return { ok: false, reason: 'out' };
    if (from === to) return { ok: false, reason: 'same' };
    if (this.g[from] !== color) return { ok: false, reason: 'nopiece' };
    /* 将棋里王同样不会被「吃掉」—— 胜负只能由 isMate 判定 */
    if (this.t[to] === 'K') return { ok: false, reason: 'capture-king' };
    if (this.movesFrom(from).indexOf(to) < 0) return { ok: false, reason: 'shape' };

    var k = this.t[from], wasPro = this.p[from] === 1;
    if (promote) {
      /* 王不能升变；已升变的不能再升；起点与终点都不在敌阵也不许升 */
      if (k === 'K' || wasPro) return { ok: false, reason: 'no-promote' };
      if (!inZone(from, color) && !inZone(to, color)) return { ok: false, reason: 'no-promote' };
    }
    /* 走过去就没路可走的落点，强制升变（步香到最后一段、桂到最后两段） */
    if (k !== 'K' && !wasPro && !canStand(k, to, color)) promote = true;

    /* ★ 升变是**不可逆**的：已经升变的驹走一步之后，还是升变形态。
       这里早先写的是 `promote ? 1 : 0` —— 只看了「这一手选没选升变」，
       漏掉「这枚驹本来就已经升变」这一种。后果是龙王走一步变回飞车、
       と金走一步变回步兵、成银走一步变回银将。**用户就是这么发现的。** */
    var newPro = wasPro || promote;

    var rec = {
      mv: true, from: from, to: to, color: color, type: k,
      proFrom: wasPro,
      capSq: this.g[to] !== EMPTY ? to : -1,
      capColor: this.g[to],
      capType: this.t[to],
      capPro: this.p[to] === 1,
      proTo: newPro
    };
    this.g[to] = color; this.t[to] = k; this.p[to] = newPro ? 1 : 0;
    this.g[from] = EMPTY; this.t[from] = null; this.p[from] = 0;
    if (rec.capSq >= 0) {
      /* 吃到的驹进自己的持驹场 —— 已升变的子**还原为原形**（吃到「と金」得到的是「步」） */
      rec.gainType = rec.capType;
      this.hand[color][rec.gainType] = this.handCount(color, rec.gainType) + 1;
    }
    if (this.isChecked(color)) { this.undo(rec); return { ok: false, reason: 'self-check' }; }
    this.moves.push(rec);
    this.toMove = other(color);
    return { ok: true, rec: rec, captured: rec.capSq >= 0 ? [rec.capSq] : [] };
  };

  /* ── 打驹：把持驹放到空点 ──────────────────────────────────
   * 四道关卡：手里得有这枚驹、落点得空、落点以后还走得动、不能造成二步 / 打步诘。
   * 另外和王手放置一样，打完不能让己方的王处在被将状态。 */
  Board.prototype.drop = function (type, to, color) {
    var ty = String(type || '').toUpperCase();
    if (!NAME[ty] || ty === 'K') return { ok: false, reason: 'bad-type' };
    if (to == null || to < 0 || to >= N) return { ok: false, reason: 'out' };
    if (this.g[to] !== EMPTY) return { ok: false, reason: 'occupied' };
    if (this.handCount(color, ty) <= 0) return { ok: false, reason: 'no-hand' };
    if (!canStand(ty, to, color)) return { ok: false, reason: 'nowhere' };
    if (ty === 'P' && this.hasPawnInFile(to, color)) return { ok: false, reason: 'nifu' };

    var rec = { drop: true, type: ty, to: to, color: color, gainType: null };
    this.g[to] = color; this.t[to] = ty; this.p[to] = 0;
    var left = this.handCount(color, ty) - 1;
    if (left > 0) this.hand[color][ty] = left;
    else delete this.hand[color][ty];      /* 同上：不留 0 值键 */
    if (this.isChecked(color)) { this.undo(rec); return { ok: false, reason: 'self-check' }; }
    /* 打步诘：只禁止「**打**下来的步**刚好**将死对方」。
       同样的一手若是用盘上已有的步走成的（行步诘），则是好棋，不在禁止之列。 */
    var foe = other(color);
    if (ty === 'P' && probeDepth === 0 && this.isChecked(foe) && this.isMate(foe)) {
      this.undo(rec);
      return { ok: false, reason: 'uchifuzume' };
    }
    this.moves.push(rec);
    this.toMove = foe;
    return { ok: true, rec: rec, captured: [] };
  };

  Board.prototype.undo = function (rec) {
    if (!rec) return;
    if (rec.drop) {
      this.g[rec.to] = EMPTY; this.t[rec.to] = null; this.p[rec.to] = 0;
      this.hand[rec.color][rec.type] = this.handCount(rec.color, rec.type) + 1;
    } else {
      this.g[rec.from] = rec.color; this.t[rec.from] = rec.type; this.p[rec.from] = rec.proFrom ? 1 : 0;
      this.g[rec.to] = rec.capSq >= 0 ? rec.capColor : EMPTY;
      this.t[rec.to] = rec.capSq >= 0 ? rec.capType : null;
      this.p[rec.to] = (rec.capSq >= 0 && rec.capPro) ? 1 : 0;
    if (rec.capSq >= 0) {
      /* 归零就把键删掉，别留 0 值 —— legalMoves 会试走再撤回，留着 0 键的话
         `{R:0}` 这种"看着像持有飞车"的残渣会留在持驹里，JSON 一对比就露馅。 */
      var n = this.handCount(rec.color, rec.gainType) - 1;
      if (n > 0) this.hand[rec.color][rec.gainType] = n;
      else delete this.hand[rec.color][rec.gainType];
    }
    }
    if (this.moves.length && this.moves[this.moves.length - 1] === rec) this.moves.pop();
    this.toMove = rec.color;
  };

  /* 同筋（同一列）是否已有己方**未升变**的步 —— 打步前的二步检查。
     走步不会新增第二个步，所以二步只可能由「打」造成。 */
  Board.prototype.hasPawnInFile = function (to, color) {
    var x = to % SIZE;
    for (var y = 0; y < SIZE; y++) {
      var q = this.idx(x, y);
      if (this.g[q] === color && this.t[q] === 'P' && !this.p[q]) return true;
    }
    return false;
  };

  /* 试走一手再撤回，看是否合法 */
  Board.prototype.isLegal = function (from, to, color, promote) {
    var r = this.play(from, to, color, promote);
    if (r.ok) { this.undo(r.rec); return true; }
    return false;
  };

  /* 某一手的**升变变体**：能升时给 [false, true]，不能升时只给 [false]。
     注意「能不能升」看的是起点与终点有没有一端在敌阵。 */
  Board.prototype.promoVariants = function (from, to, color) {
    var k = this.t[from];
    if (k === 'K' || this.p[from]) return [false];
    if (!inZone(from, color) && !inZone(to, color)) return [false];
    if (!canStand(k, to, color)) return [true];        /* 死地：只能升，没得选 */
    return [false, true];
  };

  /* 某方全部合法着法。元素为
       {from, to, promote, cap}   走子
       {drop:'P', to, cap:false}  打驹
     顺序稳定：先按起点、终点枚举走子，再按持驹顺序枚举打点。 */
  Board.prototype.legalMoves = function (color) {
    /* 枚举过程靠「试走一手再撤回」实现，而 undo 会把 toMove 恢复成 rec.color（= 传进来的 color）。
       平时调用它时 color 恰好就是轮走方，看不出问题；可一旦有人拿它去算**对方**的着法
       （isMate(对手) 就是这么干的），枚举完 toMove 就被改成对手了 —— 轮次直接反掉。
       所以进出各存一次，退出时原样还回去（用 finally，异常路径也不漏）。 */
    var savedToMove = this.toMove;
    var out = [], i, j, v, vs, to, r;
    try {
    for (i = 0; i < N; i++) {
      if (this.g[i] !== color) continue;
      var ms = this.movesFrom(i);
      for (j = 0; j < ms.length; j++) {
        to = ms[j];
        vs = this.promoVariants(i, to, color);
        for (v = 0; v < vs.length; v++) {
          r = this.play(i, to, color, vs[v]);
          if (r.ok) {
            this.undo(r.rec);
            out.push({ from: i, to: to, promote: vs[v], cap: this.g[to] !== EMPTY });
          }
        }
      }
    }
    for (j = 0; j < HAND_ORDER.length; j++) {
      var ty = HAND_ORDER[j];
      if (this.handCount(color, ty) <= 0) continue;
      for (i = 0; i < N; i++) {
        if (this.g[i] !== EMPTY) continue;
        r = this.drop(ty, i, color);
        if (r.ok) { this.undo(r.rec); out.push({ drop: ty, to: i, cap: false }); }
      }
    }
    } finally {
      this.toMove = savedToMove;
    }
    return out;
  };

  /* 无合法着法 = 负。将棋里「詰み」把「王被将且无着」与「王未被将但无着」一并算负，
     所以不再像象棋那样区分将死与困毙。 */
  Board.prototype.isMate = function (color) {
    if (this.findKing(color) < 0) return true;
    probeDepth++;
    var n = this.legalMoves(color).length;
    probeDepth--;
    return n === 0;
  };

  /* 摆局面：stones 是 [[x, y, 's'|'g', 驹型, 是否已升变?], ...]
     hand 是 { 1: {P:2}, 2: {} }（也接受 [ {..先手..}, {..后手..} ]）
     toMove 是 's' / 'g'（默认先手） */
  Board.prototype.setup = function (stones, hand, toMove) {
    this.g = new Int8Array(N);
    this.t = new Array(N);
    this.p = new Uint8Array(N);
    for (var i = 0; i < N; i++) this.t[i] = null;
    this.moves = [];
    this.hand = { 1: {}, 2: {} };
    var list = stones || [], k;
    for (k = 0; k < list.length; k++) {
      var it = list[k];
      if (!it || it.length < 4) continue;
      var x = it[0], y = it[1], cc = it[2], tp = String(it[3]).toUpperCase();
      if (!inBoard(x, y)) throw new Error('setup: 越界坐标 (' + x + ',' + y + ')');
      if (!NAME[tp]) throw new Error('setup: 未知驹型 ' + tp);
      var ci = (cc === 's' || cc === 'S' || cc === SENTE) ? SENTE : GOTE;
      var q = this.idx(x, y);
      this.g[q] = ci; this.t[q] = tp; this.p[q] = it[4] ? 1 : 0;
    }
    if (hand) {
      var sides = Array.isArray(hand) ? [null, hand[0], hand[1]]
        : [null, hand[1] || hand['1'], hand[2] || hand['2']];
      for (var s = 1; s <= 2; s++) {
        var h = sides[s] || {};
        for (var ty in h) {
          if (!h.hasOwnProperty(ty)) continue;
          var T = String(ty).toUpperCase();
          if (T === 'K') throw new Error('setup: 王不可能在持驹里');
          this.hand[s][T] = h[ty];
        }
      }
    }
    this.toMove = (toMove === 'g' || toMove === 'G' || toMove === GOTE) ? GOTE : SENTE;
    return this;
  };

  /* 初形（平手）。上方后手、下方先手 —— 与 toLabel「９一在左上」一致。
     注意飞与角的位置：后手是 8二飞 2二角，先手是 8八飞 2八角（镜像）。 */
  var START_POSITION = (function () {
    var out = [], x;
    var BACK = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];   /* 最外一排由左到右 */
    for (x = 0; x < SIZE; x++) {
      out.push([x, 0, 'g', BACK[x]]);      /* 后手最上排（一段） */
      out.push([x, 8, 's', BACK[x]]);      /* 先手最下排（九段） */
      out.push([x, 2, 'g', 'P']);          /* 后手步（三段） */
      out.push([x, 6, 's', 'P']);          /* 先手步（七段） */
    }
    /* ★ 飞与角是**交叉**摆的，不是左右对称 ★
         先手：８八 角、２八 飞      后手：８二 飞、２二 角
       也就是说，你的角正对着对方的飞。
       这里最初写成了「两边飞都在 8 筋」（左右对称），是错的 ——
       拿 GSDB 的职业棋谱对拍时才暴露：那些棋谱第 35 手走了 B8h-7i（角在 ８八），
       而当时的盘面上 ８八 摆的是飞车，引擎直接报 shape。 */
    out.push([1, 1, 'g', 'R'], [7, 1, 'g', 'B']);   /* 后手：８二飞、２二角 */
    out.push([1, 7, 's', 'B'], [7, 7, 's', 'R']);   /* 先手：８八角、２八飞 */
    return out;
  })();

  Board.prototype.reset = function () { return this.setup(START_POSITION); };

  var SHOGI = {
    Board: Board,
    EMPTY: EMPTY, SENTE: SENTE, GOTE: GOTE,
    SIZE: SIZE, N: N,
    HAND_ORDER: HAND_ORDER,
    NAME: NAME, NAME_P: NAME_P,
    GLYPH: GLYPH, GLYPH_P: GLYPH_P,
    other: other,
    inZone: inZone,
    canStand: canStand,
    colorName: function (c) { return c === SENTE ? '先手' : (c === GOTE ? '后手' : '空'); },
    /* 驹名：pieceName('S', 0) = 银将，pieceName('P', 1) = と金 */
    pieceName: function (t, pro) {
      var T = String(t).toUpperCase();
      return (pro && NAME_P[T]) ? NAME_P[T] : (NAME[T] || '空');
    },
    /* 棋面上刻的字（简写）：glyph('S', 0) = 銀，glyph('P', 1) = と */
    glyph: function (t, pro) {
      var T = String(t).toUpperCase();
      return (pro && GLYPH_P[T]) ? GLYPH_P[T] : (GLYPH[T] || '');
    },
    /* 将棋记法：７六。筋从右往左 1–9，段从上往下 一–九 */
    toLabel: function (i) {
      var x = i % SIZE, y = (i / SIZE) | 0;
      return ZEN[SIZE - x] + KANJI[y + 1];
    },
    /* 宽容解析：全角或半角数字 + 汉字或阿拉伯段号都吃 */
    fromLabel: function (s) {
      s = String(s == null ? '' : s).trim();
      if (s.length < 2) return -1;
      var c0 = s.charAt(0), c1 = s.charAt(1);
      var file = ZEN.indexOf(c0) >= 0 ? ZEN.indexOf(c0) : parseInt(c0, 10);
      var rank = KANJI.indexOf(c1) > 0 ? KANJI.indexOf(c1) : parseInt(c1, 10);
      if (!(file >= 1 && file <= SIZE) || !(rank >= 1 && rank <= SIZE)) return -1;
      return (rank - 1) * SIZE + (SIZE - file);
    },
    START_POSITION: START_POSITION
  };
  /* ============================ 自检 ============================ */
  /* 每条结论都由 movesFrom / isChecked / legalMoves 统一推出，测试只做「核对」，
     不参与规则计算。坐标一律写成 bd.idx(x, y)，不手算下标。 */
  function selfTest(verbose) {
    var pass = 0, fail = 0;

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
      var bd = new SHOGI.Board(), info = {}, r;
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

    /* 基础局面：先手王 ５九(id 4,8)、后手王 ５一(id 4,0)。
       将棋没有「照面」限制，两王同列完全合法，摆子时省心。 */
    function base(extra, hand, toMove) {
      return [[4, 8, 's', 'K'], [4, 0, 'g', 'K']].concat(extra || []);
    }
    function mv(bd, ax, ay, bx, by, color, pro) {
      return bd.isLegal(bd.idx(ax, ay), bd.idx(bx, by), color === undefined ? SHOGI.SENTE : color, pro);
    }
    function S(i) { return SHOGI.toLabel(i); }

    /* ---------------- ① 八种驹的走法 ---------------- */
    run('步·只能向前一格', function (bd) {
      bd.setup(base([[4, 5, 's', 'P']]));
    }, function (bd) {
      var f = mv(bd, 4, 5, 4, 4), b = mv(bd, 4, 5, 4, 6), s = mv(bd, 4, 5, 5, 5);
      return { ok: f === true && b === false && s === false, msg: '前进=' + f + ' 后退=' + b + ' 横走=' + s };
    });

    /* 香摆在 ９六（不是最下排）—— 摆到 ９九 的话「后退」直接出界，测不出是不是真不能退 */
    run('香·向前滑行且不能穿子', function (bd) {
      bd.setup(base([[0, 5, 's', 'L'], [0, 2, 'g', 'P']]));
    }, function (bd) {
      var near = mv(bd, 0, 5, 0, 3), over = mv(bd, 0, 5, 0, 1), back = mv(bd, 0, 5, 0, 6);
      return {
        ok: near === true && over === false && back === false,
        msg: '滑到 ９四=' + near + ' 穿阻子到 ９二=' + over + ' 后退=' + back
      };
    });

    /* 注意这题的局面：桂放在 ５七（不是 ５九），否则会和基础局面里的先手王撞格 */
    run('桂·跳两格（中间格不挡）', function (bd) {
      bd.setup(base([[4, 6, 's', 'N'], [3, 5, 'g', 'P']]));
    }, function (bd) {
      var jump = mv(bd, 4, 6, 3, 4), one = mv(bd, 4, 6, 4, 5);
      return {
        ok: jump === true && one === false,
        msg: '跳到 ３四=' + jump + '（中间 ３五 有子也不挡）走到 ５五=' + one
      };
    });

    run('银·五向（不能横走／直退）', function (bd) {
      bd.setup(base([[4, 5, 's', 'S']]));
    }, function (bd) {
      var f = mv(bd, 4, 5, 4, 4), fl = mv(bd, 4, 5, 3, 4), fr = mv(bd, 4, 5, 5, 4);
      var bl = mv(bd, 4, 5, 3, 6), br = mv(bd, 4, 5, 5, 6);
      var side = mv(bd, 4, 5, 3, 5), back = mv(bd, 4, 5, 4, 6);
      return {
        ok: f && fl && fr && bl && br && !side && !back,
        msg: '五向=' + [f, fl, fr, bl, br].join('') + ' 横走=' + side + ' 直退=' + back
      };
    });

    run('金·六向（不能斜退）', function (bd) {
      bd.setup(base([[4, 5, 's', 'G']]));
    }, function (bd) {
      var ok6 = mv(bd, 4, 5, 4, 4) && mv(bd, 4, 5, 3, 4) && mv(bd, 4, 5, 5, 4)
        && mv(bd, 4, 5, 3, 5) && mv(bd, 4, 5, 5, 5) && mv(bd, 4, 5, 4, 6);
      var bl = mv(bd, 4, 5, 3, 6), br = mv(bd, 4, 5, 5, 6);
      return { ok: ok6 && !bl && !br, msg: '六向齐=' + ok6 + ' 左斜退=' + bl + ' 右斜退=' + br };
    });

    run('角·斜行且不能直走', function (bd) {
      bd.setup(base([[4, 4, 's', 'B']]));
    }, function (bd) {
      var diag = mv(bd, 4, 4, 0, 0), orth = mv(bd, 4, 4, 4, 0);
      return { ok: diag === true && orth === false, msg: '斜到 ９一=' + diag + ' 直走=' + orth };
    });

    run('飞·直行且不能斜走', function (bd) {
      bd.setup(base([[4, 4, 's', 'R']]));
    }, function (bd) {
      /* 走到 ５二 为止 —— 再往上一格 ５一 是后手王，吃王是被禁的，不能拿来当"直行"的样本 */
      var orth = mv(bd, 4, 4, 4, 1), diag = mv(bd, 4, 4, 0, 0);
      return { ok: orth === true && diag === false, msg: '直到 ５二=' + orth + ' 斜走 ９一=' + diag };
    });

    run('王·八方各一格', function (bd) {
      bd.setup([[4, 4, 's', 'K'], [0, 0, 'g', 'K']]);
    }, function (bd) {
      var all = true, i, d = [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
      for (i = 0; i < 8; i++) if (!mv(bd, 4, 4, 4 + d[i][0], 4 + d[i][1])) all = false;
      var far = mv(bd, 4, 4, 4, 2);
      return { ok: all && !far, msg: '八方=' + all + ' 走两格=' + far };
    });

    run('后手·方向整体翻转', function (bd) {
      bd.setup(base([[4, 3, 'g', 'P']]));
    }, function (bd) {
      var down = mv(bd, 4, 3, 4, 4, SHOGI.GOTE), up = mv(bd, 4, 3, 4, 2, SHOGI.GOTE);
      return { ok: down === true && up === false, msg: '后手步向下=' + down + ' 向上=' + up };
    });

    /* ---------------- ② 升变 ---------------- */
    run('升变·进敌阵可自选不成', function (bd) {
      bd.setup(base([[4, 3, 's', 'S']]));
    }, function (bd) {
      var no = mv(bd, 4, 3, 3, 2, SHOGI.SENTE, false);
      var yes = mv(bd, 4, 3, 3, 2, SHOGI.SENTE, true);
      return { ok: no === true && yes === true, msg: '进 ３二（敌阵）不成=' + no + ' 成=' + yes };
    });

    run('升变·非敌阵不许升', function (bd) {
      bd.setup(base([[4, 5, 's', 'S']]));
    }, function (bd) {
      var r = bd.play(bd.idx(4, 5), bd.idx(3, 4), SHOGI.SENTE, true);
      return { ok: r.ok === false && r.reason === 'no-promote', msg: '３四→３五 升变 → ' + (r.ok ? '被允许（错）' : r.reason) };
    });

    run('升变·银变金（能横走能直退）', function (bd) {
      bd.setup(base([[4, 5, 's', 'S', 1]]));
    }, function (bd) {
      var side = mv(bd, 4, 5, 3, 5), back = mv(bd, 4, 5, 4, 6);
      var bl = mv(bd, 4, 5, 3, 6);
      return {
        ok: side === true && back === true && bl === false,
        msg: '成银横走=' + side + ' 直退=' + back + '（斜退仍不可=' + bl + '）'
      };
    });

    /* 这里要测「步走到最上段」，所以 ５一 必须是空的 —— 两王都挪开摆 */
    run('强制升变·步到最上段', function (bd) {
      bd.setup([[0, 8, 's', 'K'], [8, 0, 'g', 'K'], [4, 1, 's', 'P']]);
    }, function (bd) {
      var r = bd.play(bd.idx(4, 1), bd.idx(4, 0), SHOGI.SENTE, false);
      var pro = r.ok && bd.p[bd.idx(4, 0)] === 1;
      if (r.ok) bd.undo(r.rec);
      return { ok: pro, msg: '走到 ５一 时想「不成」→ 实际强制已升=' + pro };
    });

    /* 用户发现：摆棋时「已经升变的驹往上走一步，就变回没升变的样子了」。
       根因是 play 里把 p[to] 写成了「这一手选没选升变」，漏了「本来就已经升变」。
       下面两条把「升变不可逆」钉死。 */
    run('升变·龙王走一步还是龙王', function (bd) {
      bd.setup(base([[4, 4, 's', 'R', 1]]));
    }, function (bd) {
      var r = bd.play(bd.idx(4, 4), bd.idx(4, 3), SHOGI.SENTE, false);
      var still = r.ok && bd.p[bd.idx(4, 3)] === 1;
      var diag = still && bd.isLegal(bd.idx(4, 3), bd.idx(3, 2), SHOGI.SENTE);   /* 龙多出来的斜走一格还在 */
      if (r.ok) bd.undo(r.rec);
      var back = bd.p[bd.idx(4, 4)] === 1;
      return { ok: still && diag && back, msg: '走完仍升变=' + still + ' 仍能斜走一格=' + diag + ' 撤回还原=' + back };
    });

    run('升变·と金走一步还是と金', function (bd) {
      bd.setup(base([[4, 4, 's', 'P', 1]]));
    }, function (bd) {
      var r = bd.play(bd.idx(4, 4), bd.idx(4, 3), SHOGI.SENTE, false);
      var still = r.ok && bd.p[bd.idx(4, 3)] === 1;
      var side = still && bd.isLegal(bd.idx(4, 3), bd.idx(3, 3), SHOGI.SENTE);   /* 与金同形：能横走 */
      if (r.ok) bd.undo(r.rec);
      return { ok: still && side, msg: '走完仍升变=' + still + ' 仍能横走=' + side };
    });

    run('龙·飞车滑行 + 斜一格', function (bd) {
      bd.setup([[0, 8, 's', 'K'], [8, 0, 'g', 'K'], [4, 4, 's', 'R', 1]]);
    }, function (bd) {
      var orth = mv(bd, 4, 4, 4, 0), diag1 = mv(bd, 4, 4, 3, 3), diag2 = mv(bd, 4, 4, 2, 2);
      return {
        ok: orth === true && diag1 === true && diag2 === false,
        msg: '直滑到 ５一=' + orth + ' 斜一格=' + diag1 + ' 斜两格=' + diag2
      };
    });

    run('马·角行滑行 + 直一格', function (bd) {
      bd.setup(base([[4, 4, 's', 'B', 1]]));
    }, function (bd) {
      var diag = mv(bd, 4, 4, 0, 0), orth1 = mv(bd, 4, 4, 4, 3), orth2 = mv(bd, 4, 4, 4, 2);
      return {
        ok: diag === true && orth1 === true && orth2 === false,
        msg: '斜滑到 ９一=' + diag + ' 直一格=' + orth1 + ' 直两格=' + orth2
      };
    });

    /* ---------------- ③ 持驹 ---------------- */
    run('持驹·吃子得驹', function (bd) {
      bd.setup(base([[4, 5, 's', 'R'], [4, 3, 'g', 'P']]));
    }, function (bd) {
      var r = bd.play(bd.idx(4, 5), bd.idx(4, 3), SHOGI.SENTE);
      var after = bd.handCount(SHOGI.SENTE, 'P');       /* 先存快照，undo 之后就看不到了 */
      if (r.ok) bd.undo(r.rec);
      return { ok: after === 1 && bd.handCount(SHOGI.SENTE, 'P') === 0, msg: '飞吃对手步 → 手里步数=' + after };
    });

    run('持驹·吃升变子还原原形', function (bd) {
      bd.setup(base([[4, 5, 's', 'R'], [4, 3, 'g', 'P', 1]]));
    }, function (bd) {
      var r = bd.play(bd.idx(4, 5), bd.idx(4, 3), SHOGI.SENTE);
      /* 吃到的是「と金」，进手里必须变回「步」—— 手里记的是 P，没有「と」这种东西 */
      var gotStep = bd.handCount(SHOGI.SENTE, 'P');
      var noTo = bd.handCount(SHOGI.SENTE, 'と') === 0 && bd.handCount(SHOGI.SENTE, 'P') === 1;
      if (r.ok) bd.undo(r.rec);
      return { ok: gotStep === 1 && noTo, msg: '吃「と金」→ 手里是「步」×' + gotStep };
    });

    run('持驹·打驹上位', function (bd) {
      bd.setup(base([]), { 1: { P: 2 } });
    }, function (bd) {
      var r = bd.drop('P', bd.idx(3, 4), SHOGI.SENTE);
      var placed = r.ok && bd.t[bd.idx(3, 4)] === 'P' && bd.g[bd.idx(3, 4)] === SHOGI.SENTE;
      var left = bd.handCount(SHOGI.SENTE, 'P');
      if (r.ok) bd.undo(r.rec);
      return { ok: placed && left === 1, msg: '打到 ４五=' + placed + ' 手里剩=' + left };
    });

    /* △３四歩 之后后手的角（２二）斜线打通，可以一路吃到先手的飞（８八）——
       这就是将棋的「角交换」。legalMoves 会试走这一手再撤回，撤回后手里不能留下 R:0 这种脏键。
       （这条是实际踩出来的：摆棋页走完 △３四歩，持驹里冒出一个 R:0。） */
    run('持驹·试探后不留 0 值键', function (bd) {
      bd.reset();
    }, function (bd) {
      bd.play(bd.idx(2, 6), bd.idx(2, 5), SHOGI.SENTE);   /* ▲７六歩 */
      bd.play(bd.idx(6, 2), bd.idx(6, 3), SHOGI.GOTE);    /* △３四歩 */
      bd.legalMoves(SHOGI.GOTE);                          /* 全部试走一遍 */
      var dirty = Object.keys(bd.hand[1]).length + Object.keys(bd.hand[2]).length;
      var r = bd.play(bd.idx(7, 1), bd.idx(1, 7), SHOGI.GOTE);   /* 角吃角 —— 这就是角交换 */
      var got = bd.handCount(SHOGI.GOTE, 'B');
      if (r.ok) bd.undo(r.rec);
      var dirty2 = Object.keys(bd.hand[1]).length + Object.keys(bd.hand[2]).length;
      return {
        ok: r.ok === true && got === 1 && dirty === 0 && dirty2 === 0,
        msg: '角交换成立=' + r.ok + ' 拿到角=' + got + ' 试探后脏键=' + dirty + ' 撤回后脏键=' + dirty2
      };
    });

    run('持驹·手里没有就打不出来', function (bd) {
      bd.setup(base([]));
    }, function (bd) {
      var r = bd.drop('P', bd.idx(3, 4), SHOGI.SENTE);
      return { ok: r.ok === false && r.reason === 'no-hand', msg: '空手打步 → ' + (r.ok ? '成功（错）' : r.reason) };
    });

    run('禁手·步不能打到最后一段', function (bd) {
      bd.setup([[0, 8, 's', 'K'], [8, 0, 'g', 'K']], { 1: { P: 1 } });
    }, function (bd) {
      var r = bd.drop('P', bd.idx(4, 0), SHOGI.SENTE);
      return { ok: r.ok === false && r.reason === 'nowhere', msg: '打步到 ５一 → ' + (r.ok ? '成功（错）' : r.reason) };
    });

    run('禁手·桂不能打到最后两段', function (bd) {
      bd.setup(base([]), { 1: { N: 1 } });
    }, function (bd) {
      var one = bd.drop('N', bd.idx(4, 1), SHOGI.SENTE);
      var ok = bd.drop('N', bd.idx(4, 2), SHOGI.SENTE);
      if (ok.ok) bd.undo(ok.rec);
      return {
        ok: one.ok === false && one.reason === 'nowhere' && ok.ok === true,
        msg: '打桂到 ５二 → ' + one.reason + '；到 ５三 → ' + (ok.ok ? '可以' : ok.reason)
      };
    });

    run('禁手·二步', function (bd) {
      bd.setup(base([[4, 6, 's', 'P']]), { 1: { P: 1 } });
    }, function (bd) {
      var same = bd.drop('P', bd.idx(4, 4), SHOGI.SENTE);      /* ５五：与 ５七 同筋 */
      var other = bd.drop('P', bd.idx(3, 4), SHOGI.SENTE);     /* ６五：换一筋 */
      if (other.ok) bd.undo(other.rec);
      return {
        ok: same.ok === false && same.reason === 'nifu' && other.ok === true,
        msg: '打步到同筋 ５五 → ' + same.reason + '；换到 ６五 → ' + (other.ok ? '可以' : other.reason)
      };
    });

    /* 打步诘局面（自己推的，不是抄的）：后手玉 ５一 已被四面包住 ——
         逃路 ４一／６一 被两只银控制，４二／６二 被两只金控制，中间的 ５二 一打步就是诘。
       所以「打步到 ５二」必须被拒；而同样一手若改用盘上已有的步走过去，则是合法好手。 */
    var UCHI = [
      [4, 0, 'g', 'K'],
      [0, 8, 's', 'K'],
      [3, 2, 's', 'G'], [5, 2, 's', 'G'],
      [2, 1, 's', 'S'], [6, 1, 's', 'S']
    ];

    run('禁手·打步诘', function (bd) {
      bd.setup(UCHI, { 1: { P: 1 } });
    }, function (bd) {
      var r = bd.drop('P', bd.idx(4, 1), SHOGI.SENTE);
      return {
        ok: r.ok === false && r.reason === 'uchifuzume',
        msg: '打步到 ５二 → ' + (r.ok ? '成功（错）' : r.reason)
      };
    });

    run('行步诘·不是打步就合法', function (bd) {
      bd.setup(UCHI.concat([[4, 2, 's', 'P']]));
    }, function (bd) {
      var r = bd.play(bd.idx(4, 2), bd.idx(4, 1), SHOGI.SENTE);   /* ５三 的步走到 ５二 */
      var mate = r.ok && bd.isChecked(SHOGI.GOTE) && bd.isMate(SHOGI.GOTE);
      if (r.ok) bd.undo(r.rec);
      return {
        ok: r.ok === true && mate === true,
        msg: '盘上的步走过去 → ' + (r.ok ? '合法且成诘' : r.reason)
      };
    });

    run('打驹·不能送将（挡不住就不许打）', function (bd) {
      bd.setup([[0, 8, 's', 'K'], [4, 0, 'g', 'K'], [0, 2, 'g', 'R']], { 1: { P: 2 } });
    }, function (bd) {
      /* 顺序要紧：先试「没挡住」那一手（此时 9 筋还空着，挡子一旦落下就测不出来了） */
      var away = bd.drop('P', bd.idx(4, 5), SHOGI.SENTE);       /* ５四：没挡住 → 自己还被将 */
      var block = bd.drop('P', bd.idx(0, 5), SHOGI.SENTE);      /* ９四：挡在 ９三 飞与 ９九 王之间 */
      if (block.ok) bd.undo(block.rec);
      return {
        ok: block.ok === true && away.ok === false && away.reason === 'self-check',
        msg: '挡在中间=' + (block.ok ? '可以' : block.reason) + ' 不挡=' + away.reason
      };
    });

    /* ---------------- ④ 王手 / 诘み ---------------- */
    run('王手·识别被将', function (bd) {
      bd.setup([[4, 8, 's', 'K'], [5, 0, 'g', 'K'], [4, 0, 'g', 'R']]);
    }, function (bd) {
      var chk = bd.isChecked(SHOGI.SENTE), calm = bd.isChecked(SHOGI.GOTE);
      return { ok: chk === true && calm === false, msg: '先手被将=' + chk + ' 后手被将=' + calm };
    });

    run('应将·被将后只能走应将手', function (bd) {
      bd.setup([[4, 8, 's', 'K'], [5, 0, 'g', 'K'], [4, 0, 'g', 'R']]);
    }, function (bd) {
      var list = bd.legalMoves(SHOGI.SENTE), bad = 0, i, r;
      for (i = 0; i < list.length; i++) {
        r = list[i].drop ? bd.drop(list[i].drop, list[i].to, SHOGI.SENTE)
          : bd.play(list[i].from, list[i].to, SHOGI.SENTE, list[i].promote);
        if (r.ok) { if (bd.isChecked(SHOGI.SENTE)) bad++; bd.undo(r.rec); }
      }
      return {
        ok: list.length > 0 && bad === 0,
        msg: '合法应着=' + list.length + ' 应后仍被将=' + bad
      };
    });

    run('诘み·双金封死 ５一', function (bd) {
      bd.setup([[4, 0, 'g', 'K'], [0, 8, 's', 'K'], [4, 1, 's', 'G'], [3, 1, 's', 'G']]);
    }, function (bd) {
      var mate = bd.isMate(SHOGI.GOTE), chk = bd.isChecked(SHOGI.GOTE);
      var moves = bd.legalMoves(SHOGI.GOTE).length;
      return { ok: mate === true && chk === true, msg: '合法着法=' + moves + ' 被将=' + chk };
    });

    run('不允许吃王', function (bd) {
      bd.setup([[4, 8, 's', 'K'], [4, 0, 'g', 'K'], [4, 4, 's', 'R']]);
    }, function (bd) {
      var r = bd.play(bd.idx(4, 4), bd.idx(4, 0), SHOGI.SENTE);
      return { ok: r.ok === false && r.reason === 'capture-king', msg: '飞吃王 → ' + (r.ok ? '被允许（错）' : r.reason) };
    });

    /* ---------------- ⑤ 回滚 ---------------- */
    run('play/undo·吃子后的持驹也回滚', function (bd) {
      bd.setup(base([[4, 5, 's', 'R'], [4, 3, 'g', 'P', 1]]));
    }, function (bd) {
      var r = bd.play(bd.idx(4, 5), bd.idx(4, 3), SHOGI.SENTE);
      var after = bd.handCount(SHOGI.SENTE, 'P');
      bd.undo(r.rec);
      var back = bd.handCount(SHOGI.SENTE, 'P');
      var board = bd.t[bd.idx(4, 3)] === 'P' && bd.p[bd.idx(4, 3)] === 1;
      return { ok: after === 1 && back === 0 && board, msg: '吃后手里=' + after + ' 撤回后=' + back + ' 原「と金」还原=' + board };
    });

    run('play/undo·连续六手完全回滚', function (bd) {
      bd.reset();
      return {
        g0: Array.prototype.slice.call(bd.g), t0: bd.t.slice(), p0: Array.prototype.slice.call(bd.p)
      };
    }, function (bd, o) {
      var recs = [], color = SHOGI.SENTE, i, list, r;
      for (i = 0; i < 6; i++) {
        list = bd.legalMoves(color);
        if (!list.length) return { ok: false, msg: '第 ' + (i + 1) + ' 手没着法了' };
        r = list[0].drop ? bd.drop(list[0].drop, list[0].to, color)
          : bd.play(list[0].from, list[0].to, color, list[0].promote);
        if (!r.ok) return { ok: false, msg: '第 ' + (i + 1) + ' 手意外非法：' + r.reason };
        recs.push(r.rec);
        color = SHOGI.other(color);
      }
      for (i = recs.length - 1; i >= 0; i--) bd.undo(recs[i]);
      var same = true, k;
      for (k = 0; k < bd.n; k++) {
        if (bd.g[k] !== o.g0[k] || bd.t[k] !== o.t0[k] || bd.p[k] !== o.p0[k]) same = false;
      }
      return { ok: same && bd.moves.length === 0, msg: '走六手再逐手撤回：局面一致=' + same + ' 着法栈已空=' + (bd.moves.length === 0) };
    });

    /* 这条是摆棋页上真踩出来的：走完三手后界面显示「轮到先手」，实际该后手走。
       根因是 legalMoves 试走完没把 toMove 还原 —— 它被 isMate(对手) 调用时就露馅了。 */
    run('不变量·算对手着法不动自家状态', function (bd) {
      bd.reset();
    }, function (bd) {
      bd.play(bd.idx(6, 6), bd.idx(6, 5), SHOGI.SENTE);          /* ▲３六歩 */
      bd.play(bd.idx(1, 2), bd.idx(1, 3), SHOGI.GOTE);           /* △８四歩 */
      bd.play(bd.idx(7, 7), bd.idx(2, 2), SHOGI.SENTE, true);    /* ▲７三角成 */
      var turn = bd.toMove, mv = bd.moves.length, hn = JSON.stringify(bd.hand);
      bd.legalMoves(SHOGI.SENTE);        /* 故意去算「对手」的着法 */
      bd.isMate(SHOGI.SENTE);
      return {
        ok: bd.toMove === turn && bd.moves.length === mv && JSON.stringify(bd.hand) === hn,
        msg: '算完对手着法：轮次 ' + turn + '→' + bd.toMove + '，着法栈 ' + mv + '→' + bd.moves.length +
          '，持驹不变=' + (JSON.stringify(bd.hand) === hn)
      };
    });

    /* ---------------- ⑥ 初形与坐标 ---------------- */
    run('初形·双方各 20 子、先手 30 手', function (bd) {
      bd.reset();
    }, function (bd) {
      var s = 0, g = 0, i;
      for (i = 0; i < bd.n; i++) { if (bd.g[i] === SHOGI.SENTE) s++; else if (bd.g[i] === SHOGI.GOTE) g++; }
      var n = bd.legalMoves(SHOGI.SENTE).length;
      return { ok: s === 20 && g === 20 && n === 30, msg: '先手' + s + '子 后手' + g + '子 先手着法数=' + n };
    });

    run('初形·两王未被将', function (bd) {
      bd.reset();
    }, function (bd) {
      var a = bd.isChecked(SHOGI.SENTE), b = bd.isChecked(SHOGI.GOTE);
      return { ok: a === false && b === false, msg: '先手被将=' + a + ' 后手被将=' + b };
    });

    run('坐标·９一在左上、１九在右下', function (bd) {
      bd.reset();
    }, function (bd) {
      var a = S(bd.idx(0, 0)), b = S(bd.idx(8, 8)), c = S(bd.idx(4, 8)), d = S(bd.idx(4, 0));
      var back = SHOGI.fromLabel(c) === bd.idx(4, 8);
      return {
        ok: a === '９一' && b === '１九' && c === '５九' && d === '５一' && back,
        msg: a + ' / ' + b + ' / ' + c + ' / ' + d + ' 反查=' + back
      };
    });

    /* 飞角是交叉摆的：先手 ８八角・２八飞，后手 ８二飞・２二角。
       这条断言本身也踩过一次坑 —— 原来断的是「先手飞在８八」，把错的当成对的了。 */
    run('初形·飞角交叉摆（先手 ８八角・２八飞）', function (bd) {
      bd.reset();
    }, function (bd) {
      /* 内部 x=1 是 8 筋（筋 = 9 − x），y=7 是 八段、y=1 是 二段 */
      var sb = bd.t[bd.idx(1, 7)], sr = bd.t[bd.idx(7, 7)];
      var gr = bd.t[bd.idx(1, 1)], gb = bd.t[bd.idx(7, 1)];
      var ok = sb === 'B' && sr === 'R' && gr === 'R' && gb === 'B';
      return {
        ok: ok,
        msg: '先手 ' + S(bd.idx(1, 7)) + '=' + sb + ' ' + S(bd.idx(7, 7)) + '=' + sr +
          '；后手 ' + S(bd.idx(1, 1)) + '=' + gr + ' ' + S(bd.idx(7, 1)) + '=' + gb
      };
    });

    console.log('');
    console.log('自检：通过 %d，失败 %d', pass, fail);
    return fail === 0;
  }

  SHOGI.selfTest = selfTest;

  if (typeof module !== 'undefined' && module.exports) module.exports = SHOGI;
  else global.SHOGI = SHOGI;

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    process.exit(selfTest(process.argv.indexOf('-v') >= 0) ? 0 : 1);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));