/* 将棋 · 手筋题库（次の一手）—— **由 tools/next-gen.js 生成，不要手改**
 *
 * 每道题都带机器证明：
 *   · 正解唯一（没有第二个着法能达到同样的收获）
 *   · 正解之后，后手**每一种**应法都挡不住先手吃到子（对方怎么应都要掉东西）
 * 校验：node tools/verify_shogi_next.js
 */
(function (global) {
  'use strict';

  var NEXT = [
  {
    id: 'nx01',
    level: 1,
    toMove: 's',
    stones: [[4,0,'g','K'],[3,2,'g','S'],[3,5,'g','B'],[8,5,'s','B'],[5,1,'s','N'],[8,8,'s','K']],
    hand: {'1':{'S':1},'2':{}},
    answer: { drop: 'S', to: 13 },
    note: '▲５二銀打',
    check: true,
    gain: 'S',
    replyCount: 3,
    replies: [{'note':'△６二玉','gain':'银将'},{'note':'△５二銀','gain':'银将'}]
  },
  {
    id: 'nx02',
    level: 1,
    toMove: 's',
    stones: [[7,0,'g','K'],[7,1,'g','G'],[7,2,'g','N'],[8,3,'s','R'],[7,3,'s','S'],[8,8,'s','K']],
    hand: {'1':{'P':1,'S':1},'2':{}},
    answer: { drop: 'S', to: 24 },
    note: '▲３三銀打',
    check: false,
    gain: 'G',
    replyCount: 7,
    replies: [{'note':'△３一玉','gain':'金将'},{'note':'△３三金','gain':'金将'},{'note':'△１三金','gain':'金将'}]
  },
  {
    id: 'nx03',
    level: 1,
    toMove: 's',
    stones: [[5,1,'g','K'],[4,3,'g','L'],[2,5,'g','B'],[3,2,'g','G'],[3,6,'g','R'],[6,4,'s','B'],[6,2,'s','N'],[8,8,'s','K']],
    hand: {'1':{'G':1},'2':{}},
    answer: { drop: 'G', to: 22 },
    note: '▲５三金打',
    check: true,
    gain: 'G',
    replyCount: 5,
    replies: [{'note':'△３二玉','gain':'金将'},{'note':'△５三金','gain':'金将'}]
  },
  {
    id: 'nx04',
    level: 1,
    toMove: 's',
    stones: [[1,0,'g','K'],[1,1,'g','P'],[1,2,'g','B'],[2,2,'s','S'],[5,5,'s','G'],[2,5,'s','P'],[8,8,'s','K']],
    hand: {'1':{'S':1},'2':{}},
    answer: { drop: 'S', to: 11 },
    note: '▲７二銀打',
    check: true,
    gain: 'B',
    replyCount: 3,
    replies: [{'note':'△９一玉','gain':'角行'},{'note':'△７二角','gain':'角行'}]
  },
  {
    id: 'nx05',
    level: 1,
    toMove: 's',
    stones: [[1,0,'g','K'],[0,1,'g','P'],[4,2,'g','S'],[1,5,'g','B'],[4,3,'g','P'],[1,4,'s','B'],[0,2,'s','P'],[8,8,'s','K']],
    hand: {'1':{'G':1},'2':{}},
    answer: { from: 37, to: 21, promote: 1 },
    note: '▲６三角成',
    check: true,
    gain: 'S',
    replyCount: 3,
    replies: [{'note':'△８二玉','gain':'银将'}]
  },
  {
    id: 'nx06',
    level: 1,
    toMove: 's',
    stones: [[7,0,'g','K'],[7,1,'g','S'],[6,2,'g','L'],[7,3,'g','L'],[4,1,'g','N'],[8,4,'s','R'],[5,5,'s','G'],[8,8,'s','K']],
    hand: {'1':{'G':1},'2':{}},
    answer: { drop: 'G', to: 17 },
    note: '▲１二金打',
    check: true,
    gain: 'S',
    replyCount: 2,
    replies: [{'note':'△３一玉','gain':'银将'}]
  },
  {
    id: 'nx07',
    level: 1,
    toMove: 's',
    stones: [[2,1,'g','K'],[3,2,'g','N'],[2,5,'g','B'],[5,3,'s','R'],[1,4,'s','L'],[8,8,'s','K']],
    hand: {'1':{},'2':{}},
    answer: { from: 32, to: 29, promote: 0 },
    note: '▲７四飛',
    check: true,
    gain: 'B',
    replyCount: 2,
    replies: [{'note':'△６二玉','gain':'角行'}]
  },
  {
    id: 'nx08',
    level: 1,
    toMove: 's',
    stones: [[5,0,'g','K'],[5,1,'g','N'],[2,3,'g','R'],[4,3,'g','G'],[2,6,'s','G'],[1,5,'s','S'],[8,8,'s','K']],
    hand: {'1':{'N':1},'2':{}},
    answer: { drop: 'N', to: 48 },
    note: '▲６六桂打',
    check: false,
    gain: 'R',
    replyCount: 21,
    replies: [{'note':'△５一玉','gain':'飞车'},{'note':'△３四桂','gain':'飞车'}]
  },
  {
    id: 'nx09',
    level: 1,
    toMove: 's',
    stones: [[4,0,'g','K'],[4,1,'g','G'],[4,2,'g','S'],[2,4,'g','B'],[1,1,'g','G'],[0,5,'s','R'],[2,6,'s','P'],[8,8,'s','K']],
    hand: {'1':{'G':1,'S':1},'2':{}},
    answer: { from: 45, to: 0, promote: 1 },
    note: '▲９一飛成',
    check: true,
    gain: 'G',
    replyCount: 3,
    replies: [{'note':'△６二玉','gain':'金将'},{'note':'△８一金','gain':'金将'}]
  },
  {
    id: 'nx10',
    level: 1,
    toMove: 's',
    stones: [[5,0,'g','K'],[4,2,'g','N'],[6,2,'g','L'],[3,5,'g','N'],[7,3,'g','B'],[8,1,'s','B'],[3,3,'s','S'],[6,3,'s','N'],[8,8,'s','K']],
    hand: {'1':{'G':1,'N':1},'2':{}},
    answer: { from: 17, to: 25, promote: 1 },
    note: '▲２三角成',
    check: true,
    gain: 'B',
    replyCount: 3,
    replies: [{'note':'△５一玉','gain':'角行'}]
  },
  {
    id: 'nx11',
    level: 1,
    toMove: 's',
    stones: [[3,1,'g','K'],[2,3,'g','N'],[4,3,'g','N'],[3,2,'g','P'],[5,2,'g','R'],[2,2,'g','S'],[0,6,'g','S'],[6,3,'s','R'],[7,6,'s','G'],[5,5,'s','P'],[8,8,'s','K']],
    hand: {'1':{'S':1},'2':{}},
    answer: { from: 33, to: 15, promote: 1 },
    note: '▲３二飛成',
    check: true,
    gain: 'R',
    replyCount: 5,
    replies: [{'note':'△６一玉','gain':'飞车'},{'note':'△４二飛','gain':'飞车'}]
  },
  {
    id: 'nx12',
    level: 1,
    toMove: 's',
    stones: [[3,1,'g','K'],[4,3,'g','G'],[4,2,'g','N'],[2,2,'g','L'],[3,6,'g','B'],[1,4,'g','B'],[0,3,'g','P'],[3,4,'g','R'],[0,7,'s','R'],[5,5,'s','B'],[8,8,'s','K']],
    hand: {'1':{'G':1,'L':1},'2':{}},
    answer: { drop: 'G', to: 40 },
    note: '▲５五金打',
    check: false,
    gain: 'R',
    replyCount: 51,
    replies: [{'note':'△６三玉','gain':'飞车'},{'note':'△５五金','gain':'金将'},{'note':'△７四香','gain':'飞车'}]
  },
  {
    id: 'nx13',
    level: 1,
    toMove: 's',
    stones: [[7,1,'g','K'],[6,3,'g','P'],[7,4,'g','R'],[3,4,'s','B'],[7,6,'s','S'],[8,8,'s','K']],
    hand: {'1':{'G':1,'L':1},'2':{}},
    answer: { drop: 'L', to: 52 },
    note: '▲２六香打',
    check: false,
    gain: 'R',
    replyCount: 10,
    replies: [{'note':'△２三玉','gain':'飞车'},{'note':'△２六飛','gain':'飞车'},{'note':'△３五歩','gain':'飞车'}]
  }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = { NEXT: NEXT };
  else global.SHOGI_NEXT = NEXT;
})(typeof window !== 'undefined' ? window : this);
