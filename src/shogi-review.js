/* 将棋 · 逐手点评（对局自评用）
 *
 * 定位：**只做规则层能算清的判断**，不猜棋感。
 *   能算清的是：「这枚驹现在有没有人保护」「它是不是被对方盯着」「这一手会不会把王的门打开」。
 *   算不清的是：「这手是不是缓手」「大局观对不对」—— 一律不判，宁可少说。
 *
 * 三个判据各自独立，一手可以同时命中多条：
 *   送驹      —— 落下的驹没人保护，而对方有子能吃到它
 *   孤驹      —— 驹深入对方阵地，周围没有自己的接应
 *   王的安全  —— 把紧挨着王的驹调走了
 *
 * 与自查表（shogi-selfcheck.js）的关系：这里产出的 kind 就是那张表的 kind，
 * 页面拿它把「你犯的毛病」和「该看哪一条」对起来。
 */
(function (global) {
  'use strict';

  var S = global.SHOGI;

  var VAL = { R: 5, B: 5, G: 3, S: 2, N: 2, L: 2, P: 1, K: 99 };
  function valueOf(bd, i) {
    var t = bd.t[i];
    if (!t || t === 'K') return 0;
    return (VAL[t] || 1) + (bd.p[i] ? 1 : 0);       /* 升变过再算它贵一点 */
  }

  /* 某点上的驹有没有**自己人**保护。
     注意：不能直接拿 isAttacked 问 —— 那函数里 movesFrom 会跳过被己方占据的点，
     自己的驹正好占在这个点上，问出来永远是「没人保护」。**得先把它挪开再问。** */
  function defendedAt(bd, sq, color) {
    var g = bd.g[sq], t = bd.t[sq], p = bd.p[sq];
    bd.g[sq] = 0; bd.t[sq] = null; bd.p[sq] = 0;
    var ok = bd.isAttacked(sq, color);
    bd.g[sq] = g; bd.t[sq] = t; bd.p[sq] = p;
    return ok;
  }

  /* 谁在盯着这个点（对方能吃到这里的驹）—— 用于说清「对方用哪枚驹吃你」 */
  function attackersOf(bd, sq, byColor) {
    var out = [], i, ms, j;
    for (i = 0; i < S.N; i++) {
      if (bd.g[i] !== byColor) continue;
      ms = bd.movesFrom(i);
      for (j = 0; j < ms.length; j++) if (ms[j] === sq) { out.push(i); break; }
    }
    return out;
  }

  function dist(a, b) {
    var ax = a % 9, ay = (a / 9) | 0, bx = b % 9, by = (b / 9) | 0;
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  /* 走完一手之后点评。bd 必须是**已经走完**的局面；rec 是引擎返回的那条记录。 */
  function reviewMove(bd, rec, color) {
    var out = [], foe = S.other(color);
    var to = rec.to, k = bd.findKing(color);

    var t = bd.t[to];
    if (!t) return out;                              /* 这一手被吃回去了之类的怪情况，不评 */
    var name = S.pieceName(t, bd.p[to] === 1);

    /* ① 送驹：落点被对方盯着，而自己没人保 */
    var foes = attackersOf(bd, to, foe);
    var safe = defendedAt(bd, to, color);
    if (foes.length && !safe) {
      var big = valueOf(bd, to) >= 3;
      out.push({
        kind: '送驹', sq: to, level: big ? 'high' : 'low',
        text: '这枚' + name + '落在 ' + S.toLabel(to) + '，**没人保护**，' +
          '而对方有 ' + foes.length + ' 个驹能吃到这里。' +
          (big ? '这是大驹，白丢一枚的代价很重 —— 走之前先看它有没有保护。'
            : '小驹被吃还勉强能接受，但也要看清楚对方吃完之后会不会顺势把你的棋形冲开。')
      });
    }

    /* ② 孤驹：深入对方阵地、四周没有自己人接应 */
    if (!rec.drop && S.inZone(to, color) && valueOf(bd, to) >= 2) {
      var near = 0, i;
      for (i = 0; i < S.N; i++) {
        if (bd.g[i] !== color || i === to) continue;
        if (dist(i, to) <= 1) near++;
      }
      if (!near) {
        out.push({
          kind: '驹形', sq: to, level: 'low',
          text: name + '孤零零地到了 ' + S.toLabel(to) + '，周围八格没有一枚自己的驹。' +
            '对方只要拿一枚小驹来贴，它就得一路退 —— 而且这种形一旦被围，往往连退路都没有。'
        });
      }
    }

    /* ③ 王的安全：把紧挨着王的驹调走了 */
    if (!rec.drop && k >= 0 && rec.from !== k && dist(rec.from, k) <= 1 && dist(to, k) > 1) {
      var open = 0, j;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var xx = (k % 9) + dx, yy = ((k / 9) | 0) + dy;
          if (xx < 0 || xx > 8 || yy < 0 || yy > 8) continue;
          if (bd.g[yy * 9 + xx] === S.EMPTY) open++;
        }
      }
      out.push({
        kind: '王的安全', sq: k, level: open >= 3 ? 'high' : 'low',
        text: '这一手把贴着王的 ' + name + '调走了。现在王周围空着 ' + open + ' 格 —— ' +
          '对方手里只要有持驹，随时能从这里打进来将军。' +
          (open >= 3 ? '**空格已经三个以上，很危险。**' : '')
      });
    }

    return out;
  }

  /* 手里攥着持驹却一直没打 —— 由调用方把「连着几手没用过打驹」传进来 */
  function handIdle(plySinceDrop, handCount) {
    if (handCount >= 2 && plySinceDrop >= 8) {
      return {
        kind: '持驹', level: 'low',
        text: '手里已经攒了 ' + handCount + ' 枚驹，' + plySinceDrop + ' 手没打过一次。' +
          '持驹是将棋独有的资源 —— 打出去既能进攻，也能在自家被王手时垫子。' +
          '攥着不用，等于白吃。'
      };
    }
    return null;
  }

  var API = { reviewMove: reviewMove, handIdle: handIdle, defendedAt: defendedAt, valueOf: valueOf };

  /* ---------- 自检 ---------- */
  function selfTest(verbose) {
    var pass = 0, fail = 0;
    function padW(s, w) {
      var wide = 0, i, ch;
      s = String(s);
      for (i = 0; i < s.length; i++) { ch = s.charCodeAt(i); wide += (ch > 0x2e80) ? 2 : 1; }
      while (wide < w) { s += ' '; wide++; }
      return s;
    }
    function check(name, ok, msg) {
      if (ok) pass++; else fail++;
      console.log('  %s %s %s', ok ? '✓' : '✗', padW(name, 30), msg);
    }
    function kindsOf(bd, rec, color) {
      return reviewMove(bd, rec, color).map(function (x) { return x.kind; });
    }
    var SENTE = S.SENTE, GOTE = S.GOTE;

    /* ① 白送：先手金（７五）横走到 ８五，正落在后手飞（８四）的嘴上，且没人保护 */
    {
      var bd = new S.Board();
      bd.setup([[4, 8, 's', 'K'], [4, 0, 'g', 'K'], [1, 3, 'g', 'R'], [2, 4, 's', 'G']]);
      var r = bd.play(bd.idx(2, 4), bd.idx(1, 4), SENTE);
      var ks = r.ok ? kindsOf(bd, r.rec, SENTE) : ['走不通:' + r.reason];
      check('送驹·被飞盯上且无人保护', ks.indexOf('送驹') >= 0, '判出：' + (ks.join('、') || '（什么都没判）'));
      if (r.ok) bd.undo(r.rec);
    }

    /* ② 有保护就不该判送驹：同一手，但 ９九 的香护住了 ８五 */
    {
      var bd = new S.Board();
      bd.setup([[4, 8, 's', 'K'], [4, 0, 'g', 'K'], [1, 3, 'g', 'R'],
        [2, 4, 's', 'G'], [1, 8, 's', 'L']]);
      var r = bd.play(bd.idx(2, 4), bd.idx(1, 4), SENTE);
      var ks = r.ok ? kindsOf(bd, r.rec, SENTE) : ['走不通:' + r.reason];
      check('送驹·有保护就不判', ks.indexOf('送驹') < 0, '判出：' + (ks.join('、') || '（空）'));
      if (r.ok) bd.undo(r.rec);
    }

    /* ③ 把贴着王的驹调走 → 判「王的安全」 */
    {
      var bd = new S.Board();
      bd.setup([[4, 8, 's', 'K'], [0, 0, 'g', 'K'], [3, 7, 's', 'G']]);
      var r = bd.play(bd.idx(3, 7), bd.idx(3, 6), SENTE);    /* 金从 ４八 挪到 ４七 */
      var ks = r.ok ? kindsOf(bd, r.rec, SENTE) : ['走不通:' + r.reason];
      check('王的安全·调走贴身的驹', ks.indexOf('王的安全') >= 0, '判出：' + (ks.join('、') || '（什么都没判）'));
      if (r.ok) bd.undo(r.rec);
    }

    /* ④ 持驹闲置 */
    {
      check('持驹闲置·攒两枚且八手没打', !!handIdle(9, 2), JSON.stringify(handIdle(9, 2) && handIdle(9, 2).kind));
      check('持驹闲置·刚打过就不判', handIdle(2, 2) === null, '返回 null');
    }

    console.log('');
    console.log('自检：通过 %d，失败 %d', pass, fail);
    return fail === 0;
  }

  API.selfTest = selfTest;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.ShogiReview = API;

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    process.exit(selfTest(process.argv.indexOf('-v') >= 0) ? 0 : 1);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
