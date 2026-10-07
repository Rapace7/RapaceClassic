/* 国际象棋 · 逐手点评（实战自测用）
 *
 * 定位与将棋那份（src/shogi-review.js）一致：**只判规则层算得清的东西**。
 *   算得清：「这枚子落下去有没有人保」「对方能不能白吃」「你刚才放掉了什么杀着」「王的门前是不是空了」。
 *   算不清：「这一手是不是缓手」「大局观对不对」—— 一律不判，宁可少说。
 *
 * ★ 与象棋 / 将棋那两份的差别：国际象棋的子力价值是**公认的数值**，
 *   所以「白丢一个车」这种话可以算着说，不用靠估。子力表用最通用的 P1 N3 B3 R5 Q9。
 *
 * 五个判据（一手可以同时命中多条）：
 *   送子      落下的子没人保护，而对方能用**更便宜**的子吃掉它
 *   漏应      上一手对方已经有「白赚一子」的机会，你这一手没处理掉
 *   漏杀      你本来有一手将杀，却走了别的
 *   王的安全  这一手之后对方有一步将杀；或者把王门前的兵推走了
 *   孤子      大子孤零零深入对方半场，周围没有自己人接应
 *
 * 与自查表（src/chess-selfcheck.js）的关系：这里产出的 kind 就是那张表的 kind，
 * 页面拿它把「你犯的毛病」和「该看哪一条」对起来。
 *
 * 输入约定：reviewMove(bd, move, color) —— bd 是**走这一手之前**的局面，
 *   move 是引擎着法对象（{from,to,promo,castle}）。函数内部自己走、自己撤。
 */
(function (global) {
  'use strict';

  var CH = (typeof window !== 'undefined' ? window.CHESS : null) ||
    (typeof require !== 'undefined' ? require('./chess-engine.js') : null);

  /* 通用子力表：兵 1 / 马 3 / 象 3 / 车 5 / 后 9 */
  var VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  function val(t) { return VAL[t] || 0; }
  function sqName(i) { return CH.toLabelI(i); }
  function pieceAt(bd, i) { return CH.pieceName(bd.t[i], CH.colorChar(bd.g[i])); }

  /* 有哪些 who 方的子能吃到 sq 这一格 */
  function attackersOf(bd, sq, who) {
    var list = [], i, ms = bd.pseudoMoves(who);
    for (i = 0; i < CH.N; i++) {
      if (i === sq || bd.g[i] !== who) continue;
      for (var k = 0; k < ms.length; k++) {
        if (ms[k].from === i && ms[k].to === sq) { list.push(i); break; }
      }
    }
    return list;
  }

  /* 这一格上的子有没有自己人保护。
     直接问 isAttacked 是对的 —— 它是**从目标格往外扫**的，占位的那枚子不会挡住结论。 */
  function defended(bd, sq, color) { return bd.isAttacked(sq, color); }

  /* 某方「一手之内最多能白赚多少子力」：
     枚举所有吃子着法，赚 = 吃到的子 −（吃完之后对方能还手 ? 我这枚子的价值 : 0）。 */
  function bestCaptureGain(bd, color) {
    var ms = bd.pseudoMoves(color), best = 0, i;
    for (i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!bd.t[m.to] || bd.g[m.to] === color) continue;
      var won = val(bd.t[m.to]);
      var r = bd.play(m.from, m.to, color, m.promo, m.castle);
      if (!r.ok) continue;
      var back = defended(bd, m.to, CH.other(color)) ? val(bd.t[m.to]) : 0;
      bd.undo(r.rec);
      if (won - back > best) best = won - back;
    }
    return best;
  }

  /* 某方所有「一手将杀」的着法 */
  function matesInOne(bd, color) {
    var out = [], ms = bd.legalMoves(color), i;
    for (i = 0; i < ms.length; i++) {
      var r = bd.play(ms[i].from, ms[i].to, color, ms[i].promo, ms[i].castle);
      if (!r.ok) continue;
      var mate = bd.isMate(CH.other(color));
      bd.undo(r.rec);
      if (mate) out.push(ms[i]);
    }
    return out;
  }

  function cheb(a, b) {
    var ax = a % 8, ay = (a / 8) | 0, bx = b % 8, by = (b / 8) | 0;
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }
  /* 在不在对方**深处**（六线以内）。
     ★ 不能写成「过了中线就算」：西班牙开局的 3.Bb5 落在 b5（黑方半场的边线），
       那是一步标准好棋，被判成「孤军深入」就是在乱报。
       真正的毛病是「大子孤零零钻进对方六线以内，后面没人接应」——
       白方是第 6/7/8 横线（y<=2），黑方是第 1/2/3 横线（y>=5）。 */
  function inDeep(sq, color) {
    var y = (sq / 8) | 0;
    return CH.colorOf(color) === CH.WHITE ? y <= 2 : y >= 5;
  }
  /* 这枚子有没有打到任何对方子（吃得到东西）。车占到第 7 横线时常常没接应，
     但它在横冲直撞 —— 那种不该算「白待着」。 */
  function attacksAnyEnemy(bd, sq, color) {
    var ms = bd.pseudoMoves(color), i;
    for (i = 0; i < ms.length; i++) {
      if (ms[i].from !== sq) continue;
      if (bd.t[ms[i].to] && bd.g[ms[i].to] !== color) return true;
    }
    return false;
  }
  /* 王还在底线时，「门前那一格」的格号。
     ★ 只在王已经离开中线（a/b/c 或 g/h 列，也就是易位后或主动靠边）时才算 ——
       否则 1.e4 / 1...e5 这种**完全正常**的开局第一步都会被判成「推空王门」，
       一个开口就乱报的工具没人会信。中线的 e 兵、d 兵推出去是开局的事，不是毛病。 */
  function shieldSquare(bd, color) {
    var k = bd.findKing(color);
    if (k < 0) return -1;
    var x = k % 8, y = (k / 8) | 0;
    var back = CH.colorOf(color) === CH.WHITE ? 7 : 0;
    if (y !== back) return -1;                  /* 王已经离开底线，不谈「门前」 */
    if (x >= 3 && x <= 5) return -1;            /* 王还在中线（a…h 的 d/e/f），不算 */
    var ny = CH.colorOf(color) === CH.WHITE ? y - 1 : y + 1;
    return bd.idx(x, ny);
  }

  var KINDS = ['送子', '漏应', '漏杀', '王的安全', '孤子'];

  /* ------------------------------------------------ 主入口
     bd 是走这一手**之前**的局面（bd.toMove === color）。 */
  function reviewMove(bd, move, color) {
    var out = [];
    if (!move || typeof move.from !== 'number' || move.from < 0) return out;   /* 认不出的着法直接放过 */
    var foe = CH.other(color);
    var from = move.from, to = move.to;

    /* 走之前的快照 —— 漏杀、漏应都要拿它做对比 */
    var capturedVal = (bd.t[to] && bd.g[to] !== color) ? val(bd.t[to]) : 0;
    var mateBefore = matesInOne(bd, color);
    var threatBefore = bestCaptureGain(bd, foe);

    var r = bd.play(from, to, color, move.promo || null, move.castle || null);
    if (!r.ok) return out;

    var movedVal = val(bd.t[to]);
    var movedName = bd.t[to] ? pieceAt(bd, to) : '子';
    var i, j;

    /* ① 漏杀：本来有一手将杀，却走了别的（除非你吃到的子比将杀更值 —— 那不可能，9 是上限） */
    if (mateBefore.length && capturedVal < 9) {
      var wasMate = false;
      for (i = 0; i < mateBefore.length; i++) {
        if (mateBefore[i].from === from && mateBefore[i].to === to) { wasMate = true; break; }
      }
      if (!wasMate) {
        out.push({
          kind: '漏杀', sq: mateBefore[0].from, level: 'high',
          text: '**你刚才有一手将杀**（' + sqName(mateBefore[0].from) + '-' + sqName(mateBefore[0].to) +
            '），却走了 ' + sqName(from) + '-' + sqName(to) + '。' +
            '杀棋是最高优先级 —— 每次轮到自己走，先花两秒扫一遍「我有没有一步将杀」。'
        });
      }
    }

    /* ② 送子：落下的子没人保护、对方能用更便宜的子吃掉它，且这不是一桩划算的交换 */
    var atk = attackersOf(bd, to, foe);
    if (atk.length && movedVal > 0) {
      var cheap = 99, cheapest = -1;
      for (j = 0; j < atk.length; j++) {
        var av = val(bd.t[atk[j]]);
        if (av < cheap) { cheap = av; cheapest = atk[j]; }
      }
      var defendedHere = defended(bd, to, color);
      /* 落点上的子自己能吃掉那个最便宜的攻击者，就不算白送 —— 那是还手 */
      var canHitBack = false;
      var vm = bd.legalMoves(color);
      for (j = 0; j < vm.length; j++) {
        if (vm[j].from === to && vm[j].to === cheapest) { canHitBack = true; break; }
      }
      if (!defendedHere && movedVal > cheap && !canHitBack && capturedVal < movedVal) {
        out.push({
          kind: '送子', sq: to, level: movedVal >= 5 ? 'high' : 'low',
          text: movedName + '落在 ' + sqName(to) + '，**没人保护**，而对方的' +
            pieceAt(bd, cheapest) + '（值 ' + cheap + '）能吃到它 —— 白丢 ' + movedVal + ' 点子力。' +
            (movedVal >= 5 ? '**这是大子，落子之前必须先看它有没有保护。**'
              : '小亏，但攒几次就够输了。')
        });
      }
    }

    /* ③ 漏应：走之前对方就有「白赚一子」的机会，走完还在 */
    var threatAfter = bestCaptureGain(bd, foe);
    if (threatBefore >= 3 && threatAfter >= 3 && capturedVal < threatBefore) {
      out.push({
        kind: '漏应', sq: to, level: threatAfter >= 5 ? 'high' : 'low',
        text: '你走之前，对方就已经有能吃出 **' + threatBefore + ' 点子力** 的着法；' +
          '这一手走完，口子还开着（现在值 ' + threatAfter + ' 点）。' +
          '轮到自己走，第一件事是看对方上一手冲着谁来 —— 威胁不处理，这一手等于白花。'
      });
    }

    /* ④ 王的安全：这一步之后对方有一步将杀；或者把王门前的兵推走了 */
    var replies = matesInOne(bd, foe);
    if (replies.length) {
      out.push({
        kind: '王的安全', sq: bd.findKing(color), level: 'high',
        text: '这一手之后，**对方出现了 ' + replies.length + ' 种一步将杀**（例如 ' +
          sqName(replies[0].from) + '-' + sqName(replies[0].to) + '）。' +
          '落子前问自己一句「我这一步有没有把王露出来」。'
      });
    }
    var sh = shieldSquare(bd, color);
    if (sh >= 0 && from === sh && !bd.g[sh]) {
      out.push({
        kind: '王的安全', sq: sh, level: 'low',
        text: '你把王正前方那一格（' + sqName(sh) + '）推空了，王门前开了个口子。' +
          '王还在底线时，这一格常常就是对方车、后打进来的通道。'
      });
    }

    /* ⑤ 孤子：大子钻进对方六线以内，周围两格没有自己人，而且没有打到任何东西 */
    if (movedVal >= 3 && !move.castle && inDeep(to, color) && !attacksAnyEnemy(bd, to, color)) {
      var near = 0, z;
      for (z = 0; z < CH.N; z++) {
        if (bd.g[z] !== color || z === to) continue;
        if (cheb(z, to) <= 2) near++;
      }
      if (near === 0) {
        out.push({
          kind: '孤子', sq: to, level: 'low',
          text: movedName + '孤零零地到了 ' + sqName(to) + '（对方六线以内），' +
            '周围两格没有一枚自己的子，眼前也没有能吃到的东西 —— ' +
            '**这就是「进去了但没接着打」的样子**：对方的兵、马贴上来就能赶它，' +
            '你还要花额外手数去救。深入之前先想好谁来接应、进去打什么。'
        });
      }
    }

    bd.undo(r.rec);
    return out;
  }

  var API = {
    reviewMove: reviewMove,
    KINDS: KINDS,
    VAL: VAL, valueOf: val, bestCaptureGain: bestCaptureGain,
    matesInOne: matesInOne, attackersOf: attackersOf, defended: defended
  };

  /* ============================ 自检 ============================ */
  /* 点评引擎不可信，页面上的每句点评就都不可信 —— 这一份比别处更该有自检。 */
  function selfTest() {
    var pass = 0, fail = 0;
    function run(name, fn) {
      var r;
      try { r = fn(); } catch (e) { r = { ok: false, msg: '抛异常：' + e.message }; }
      if (r.ok) pass++; else fail++;
      console.log('  %s %s %s', r.ok ? '✓' : '✗', name, r.msg || '');
    }
    function mk(list) { var b = new CH.Board(); b.setup(list, 'w', ''); return b; }
    function sq(s) { return CH.fromLabelI(s); }
    function kindsOf(bd, from, to) {
      return reviewMove(bd, { from: sq(from), to: sq(to), promo: null, castle: null }, CH.WHITE)
        .map(function (x) { return x.kind; });
    }

    /* ① 送子：白车 h4 横走到 e4，正落在黑象 c6 的斜线上，且没人保护 */
    run('送子·车落在对方象的嘴上且没人保', function () {
      var bd = mk([[4, 7, 'w', 'K'], [4, 0, 'b', 'K'], [7, 4, 'w', 'R'], [2, 2, 'b', 'B']]);
      var ks = kindsOf(bd, 'h4', 'e4');
      return { ok: ks.indexOf('送子') >= 0, msg: '判出：' + (ks.join('、') || '（什么都没判）') };
    });

    /* ② 有保护就不该判送子：同一个落点，但白兵在 d3 护着 e4 */
    run('送子·有保护就不判', function () {
      var bd = mk([[4, 7, 'w', 'K'], [4, 0, 'b', 'K'], [7, 4, 'w', 'R'],
        [2, 2, 'b', 'B'], [3, 5, 'w', 'P']]);
      var ks = kindsOf(bd, 'h4', 'e4');
      return { ok: ks.indexOf('送子') < 0, msg: '判出：' + (ks.join('、') || '（空）') };
    });

    /* ③ 漏杀：白方本来有 Re8#，却把车平到 h1（a1 被自己的王占着，走不过去） */
    run('漏杀·有一手将杀却走了别的', function () {
      var bd = mk([[0, 7, 'w', 'K'], [4, 7, 'w', 'R'], [7, 0, 'b', 'K'],
        [6, 1, 'b', 'P'], [7, 1, 'b', 'P']]);
      var mates = matesInOne(bd, CH.WHITE);
      if (!mates.length) return { ok: false, msg: '前提不成立：这个局面没有一手杀' };
      var ks = kindsOf(bd, 'e1', 'h1');
      return { ok: ks.indexOf('漏杀') >= 0, msg: '一手杀 ' + mates.length + ' 种，判出：' + ks.join('、') };
    });

    /* ④ 王的安全：王已易位到 g1，把王门前那一格（g2）推空 */
    run('王的安全·推走王门前的兵', function () {
      var bd = mk([[6, 7, 'w', 'K'], [6, 6, 'w', 'P'], [0, 7, 'w', 'R'], [4, 0, 'b', 'K']]);
      var ks = kindsOf(bd, 'g2', 'g3');
      return { ok: ks.indexOf('王的安全') >= 0, msg: '判出：' + (ks.join('、') || '（什么都没判）') };
    });

    /* ④b 中线上的兵推进**不该**被判成推空王门（1.e4 是正常的开局第一步） */
    run('王的安全·1.e4 不该被判', function () {
      var bd = new CH.Board();
      bd.setup(CH.START_POSITION, 'w', 'KQkq');
      var ks = kindsOf(bd, 'e2', 'e4');
      return { ok: ks.indexOf('王的安全') < 0, msg: '判出：' + (ks.join('、') || '（空）') };
    });

    /* ⑤ 孤子：白车从 a1 直上 a6（对方六线以内），周围两格没人，也打不到东西 */
    run('孤子·大子孤军深入', function () {
      var bd = mk([[4, 7, 'w', 'K'], [0, 7, 'w', 'R'], [4, 0, 'b', 'K']]);
      var ks = kindsOf(bd, 'a1', 'a6');
      return { ok: ks.indexOf('孤子') >= 0, msg: '判出：' + (ks.join('、') || '（什么都没判）') };
    });

    /* ⑤b 孤子不能乱报：西班牙开局 3.Bb5 落在 b5（黑方半场边线）是标准好棋 */
    run('孤子·开局 3.Bb5 不该被判', function () {
      var bd = new CH.Board();
      bd.setup(CH.START_POSITION, 'w', 'KQkq');
      var seq = ['e4', 'e5', 'Nf3', 'Nc6'];
      for (var i = 0; i < seq.length; i++) {
        var m = bd.parseMove(seq[i]);
        bd.play(m.from, m.to, bd.toMove, null, null);
      }
      var mv = bd.parseMove('Bb5');
      var ks = reviewMove(bd, mv, bd.toMove).map(function (x) { return x.kind; });
      return { ok: ks.indexOf('孤子') < 0, msg: '判出：' + (ks.join('、') || '（空）') };
    });

    /* ⑥ 平静的一手不该乱报 */
    run('平静的一手·不该乱报', function () {
      var bd = mk([[4, 7, 'w', 'K'], [4, 0, 'b', 'K'], [0, 7, 'w', 'R']]);
      var ks = kindsOf(bd, 'a1', 'b1');
      return { ok: ks.length === 0, msg: ks.length ? '报了：' + ks.join('、') : '（空，对）' };
    });

    console.log('');
    console.log('自检：通过 %d，失败 %d', pass, fail);
    return fail === 0;
  }

  API.selfTest = selfTest;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.ChessReview = API;

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    process.exit(selfTest() ? 0 : 1);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
