/* 玄清棋典 —— 围棋术语词典（列表网格 + 详情页 + 棋盘图示）
 *
 * 用法（由 app.js / index.html 接线）：
 *   window.GoGlossary.render(host, seg)
 *     seg = []  或 ['glossary']            → 列表页（按分类铺卡片网格 + 搜索）
 *     seg = ['glossary', '气']             → 详情页（四段正文 + 图示 + 上下条）
 *   host 是容器元素（app.js 里的 app）。
 *
 * 数据只读 src/glossary.js 里的全局 GLOSSARY（94 条），本文件不改数据。
 * 棋盘图用 window.GoBoardView（src/board.js），静态盘 + 标记，不接交互。
 */
(function (global) {
  'use strict';

  /* ============================================================
     一、棋盘图示（只放「能画准的」术语）
     字段：s 路数 / st 棋子 [[x,y,'b'|'w']] / mk 标记 [[x,y,'lib'|'good'|'bad'|'point'|'eye'|'focus'|'shape'|'ghost', '文字']] / cap 图注
     坐标 [x,y]，y 从上往下，(0,0) 是左上角（与 board.js 一致）。
     每张图都用引擎核对过（见 tmpwork/_gloss_figs_check.js）。
     ============================================================ */
  var FIGURES = {

    '气': {
      s: 9,
      st: [[4, 4, 'b']],
      mk: [[3, 4, 'lib'], [5, 4, 'lib'], [4, 3, 'lib'], [4, 5, 'lib']],
      cap: '中间这颗黑子，上下左右四个点都能走 —— 所以它有 4 口气（绿圈）。被对方贴上来一口气、一口气地紧掉，气尽了就要被提走。'
    },

    '提子': {
      s: 9,
      st: [[3, 4, 'b'], [5, 4, 'b'], [4, 3, 'b'], [4, 5, 'b']],
      mk: [[4, 4, 'ghost']],
      cap: '白子刚才被这四颗黑子围得一口气都没有，已经**从盘上拿走**了（虚线圈是它原来待的位置）。「提子」就是把对方没气的子从盘上拿走 —— 拿走以后，那个点空出来，黑棋自己的气反而变多了。'
    },

    '打吃': {
      s: 9,
      st: [[4, 4, 'b'], [3, 4, 'w'], [5, 4, 'w'], [4, 3, 'w']],
      mk: [[4, 5, 'lib']],
      cap: '黑子只剩底下最后一口气（绿圈）。白棋下一步下在那里就能把它提掉 —— 这种「只差一手就被提」的状态叫「打吃」，被打了吃的子必须马上处理。'
    },

    '双打吃': {
      s: 9,
      st: [[2, 4, 'b'], [3, 3, 'b'], [6, 4, 'b'], [5, 3, 'b'], [4, 4, 'b'], [3, 4, 'w'], [5, 4, 'w']],
      mk: [[4, 4, 'focus'], [3, 5, 'lib'], [5, 5, 'lib']],
      cap: '黑棋下在中间这一点（橙圈），一下子把**左右两颗白子同时变成只剩一口气**（绿圈）—— 白棋这一手只能救一边，另一边就被提掉。这就是双打吃：一手棋赚两处。'
    },

    '紧气': {
      s: 9,
      st: [[4, 4, 'b'], [3, 4, 'w'], [5, 4, 'w']],
      mk: [[4, 3, 'lib'], [4, 5, 'lib']],
      cap: '白棋从左右两边贴上来，把黑子的气从 4 口压到只剩上下 2 口（绿圈）。这样一步步减少对方的气叫「紧气」—— 对杀的时候，谁先把对方的气紧到最少，谁就先动手。'
    },

    '禁入点': {
      s: 9,
      st: [[1, 0, 'b'], [0, 1, 'b'], [1, 1, 'b']],
      mk: [[0, 0, 'bad']],
      cap: '角上的红叉处被三颗黑子围住。白棋若下在这里，自己的子**一口气都没有**，又提不掉任何黑子 —— 这样的点是「禁入点」，白棋不能下（除非下下去能提子）。'
    },

    '眼': {
      s: 9,
      st: [[3, 3, 'b'], [4, 3, 'b'], [5, 3, 'b'], [6, 3, 'b'], [3, 4, 'b'], [6, 4, 'b'],
        [3, 5, 'b'], [4, 5, 'b'], [5, 5, 'b'], [6, 5, 'b']],
      mk: [[4, 4, 'eye'], [5, 4, 'eye']],
      cap: '被黑棋整圈围住的这两个空点，就是一只「眼」（两格的眼空间）。眼里的空点对方不能随便填 —— 眼是做活的基础，眼做得越大，越容易分出两只眼。'
    },

    '真眼': {
      s: 9,
      st: [[3, 3, 'b'], [4, 3, 'b'], [5, 3, 'b'], [3, 4, 'b'], [5, 4, 'b'],
        [3, 5, 'b'], [4, 5, 'b'], [5, 5, 'b']],
      mk: [[4, 4, 'eye']],
      cap: '眼里的空点，四边和**四个斜角**全是自己的子（三个黑角就在斜角上）。白棋无论怎么下都填不进这只眼 —— 这叫「真眼」，真眼是填不掉的。'
    },

    '假眼': {
      s: 9,
      st: [[3, 4, 'b'], [5, 4, 'b'], [4, 3, 'b'], [4, 5, 'b'],
        [2, 4, 'w'], [3, 3, 'w'], [3, 5, 'w'], [6, 4, 'w'], [5, 3, 'w'], [5, 5, 'w'], [4, 2, 'w'], [4, 6, 'w']],
      mk: [[4, 4, 'eye']],
      cap: '中间看着像一只眼（绿圈），可它斜角上全是白子，围着它的四颗黑子**都只剩这一口气**。白棋直接下进绿圈里，会一口气提掉这四颗黑子 —— 这样的「眼」是**假眼**，不算眼，靠它活不了。'
    },

    '做眼': {
      s: 9,
      st: [[3, 4, 'b'], [4, 3, 'b'], [5, 4, 'b'], [4, 5, 'b']],
      mk: [[4, 5, 'focus'], [4, 4, 'eye']],
      cap: '黑棋的眼原来**差一边没封口**（右下还漏着），在橙圈处补一手，中间的空点就被自己的子围成一只完整的眼（绿圈）—— 这一手就叫「做眼」。做眼往往比多吃几个子重要：**先做活，再谈别的**。'
    },

    '破眼': {
      s: 9,
      st: [[3, 3, 'w'], [4, 3, 'w'], [5, 3, 'w'], [6, 3, 'w'], [3, 4, 'w'], [6, 4, 'w'],
        [3, 5, 'w'], [4, 5, 'w'], [5, 5, 'w'], [6, 5, 'w'], [4, 4, 'b']],
      mk: [[4, 4, 'focus']],
      cap: '白棋这块棋只有中间两格的眼空间。黑棋下在正中间（橙圈），白棋就再也做不出两只眼 —— 这叫「破眼」。破眼的急所，通常就是眼形正中间那一点。'
    },

    '打劫': {
      s: 9,
      st: [[4, 4, 'b'], [6, 4, 'b'], [5, 3, 'b'], [5, 5, 'b'], [3, 4, 'w'], [4, 3, 'w'], [4, 5, 'w']],
      mk: [[4, 4, 'focus'], [5, 4, 'ghost']],
      cap: '黑棋刚提掉一颗白子（虚线圈是它原来的位置）。但黑棋这颗子（橙圈）自己也只剩一口气 —— 白棋**不能马上提回去**，必须先去别处下一手逼黑棋应（找「劫材」），回头才能提。这一来一回就是「打劫」。'
    },

    '征子': {
      s: 9,
      st: [[3, 0, 'w'], [4, 0, 'w'], [5, 0, 'w'], [2, 0, 'b'], [3, 1, 'b'], [4, 1, 'b'], [5, 1, 'b']],
      mk: [[6, 0, 'lib']],
      cap: '白棋被黑棋打吃了，只能沿着边一直往右逃（绿圈是它唯一的气）。黑棋贴着追，每追一步白棋还是只有两口气 —— 一路追到角上，整串白子被吃。这就是「征子」（俗称扭羊头）：**逃的方向上有对方的子（引征），征子就不成立**。'
    },

    '断': {
      s: 9,
      st: [[2, 4, 'b'], [3, 4, 'b'], [5, 4, 'b'], [6, 4, 'b']],
      mk: [[4, 4, 'point']],
      cap: '黑棋这两块之间空着一点（蓝点）。白棋下在那里，就把黑棋切成两块 —— 这个点叫「断点」，是棋形最要紧的弱点。「棋从断处生」，攻击往往就是从这里开始的。'
    },

    '虎口': {
      s: 9,
      st: [[3, 4, 'b'], [4, 3, 'b'], [5, 4, 'b']],
      mk: [[4, 4, 'point']],
      cap: '三颗黑子围出的这个点像一张开的虎口（蓝点）。白棋走进去，立刻只剩一口气被打吃 —— 虎口不是禁入点，但**走进去等于送子**。自己走成虎口，反而是好形。'
    },

    '长': {
      s: 9,
      st: [[4, 4, 'b'], [4, 5, 'b']],
      mk: [[4, 6, 'point']],
      cap: '顺着自己已有的子往前多走一个（蓝点），就叫「长」。长是慢棋，但**最结实**，气多、不会被轻易切断 —— 初学者把「长」练好，比学花招有用得多。'
    },

    '粘': {
      s: 9,
      st: [[4, 4, 'b'], [4, 6, 'b'], [3, 5, 'w'], [5, 5, 'w']],
      mk: [[4, 5, 'good']],
      cap: '黑棋上下两颗子原来是分开的，白棋正打算从中间切断。黑棋在绿点「粘」一手，两块就连成一块了 —— **该粘的时候不粘，棋就被切成两半**。'
    },

    '挡': {
      s: 9,
      st: [[4, 4, 'w'], [5, 4, 'b']],
      mk: [[5, 4, 'good']],
      cap: '白棋想从这一边走出去，黑棋在绿点「挡」住它的去路。「挡」是最直接的争地走法：挡住对方进来的方向，自己这边就成了实地。'
    },

    '长气': {
      s: 9,
      st: [[4, 4, 'b'], [4, 5, 'b'], [4, 6, 'b'], [3, 4, 'w'], [5, 4, 'w'], [3, 5, 'w'], [5, 5, 'w'], [4, 3, 'w']],
      mk: [[3, 6, 'lib'], [5, 6, 'lib'], [4, 7, 'lib']],
      cap: '黑棋原来只剩一口气，往下一「长」之后就有了三口气（绿圈）—— 这就是「长气」：**多长一个子，气就多起来**，对杀时气多的一方赢。'
    },

    '活棋': {
      s: 9,
      st: [[3, 3, 'b'], [4, 3, 'b'], [5, 3, 'b'], [6, 3, 'b'], [7, 3, 'b'],
        [3, 4, 'b'], [5, 4, 'b'], [7, 4, 'b'],
        [3, 5, 'b'], [4, 5, 'b'], [5, 5, 'b'], [6, 5, 'b'], [7, 5, 'b']],
      mk: [[4, 4, 'eye'], [6, 4, 'eye']],
      cap: '黑棋这块棋里有**两只分开的真眼**（绿圈）。白棋一次只能填一只，填第二只的时候自己的子会被提掉 —— 所以有两只真眼的棋是「活棋」，怎么杀都杀不死。'
    },

    '星位': {
      s: 13,
      st: [],
      mk: [[3, 3, 'point']],
      cap: '星位就是棋盘上早就画好的小黑点（图上是左上角那一个）。它在第四条线的交点上，**角、边、中腹都顾得上**，是最常用的起手点。'
    },

    '小目': {
      s: 13,
      st: [],
      mk: [[3, 2, 'point']],
      cap: '小目在星位的斜下方：横着第四条线、竖着第三条线（图上蓝点）。它比星位更贴近角，**先取实地**，是另一种最常用的起手。'
    },

    '三三': {
      s: 13,
      st: [],
      mk: [[2, 2, 'point']],
      cap: '三三就是横竖都在**第三条线**上的那个交点（图上蓝点）。它一手就把角上的地圈住，实在、安稳，代价是位置低、对外面影响小。'
    },

    '天元': {
      s: 13,
      st: [],
      mk: [[6, 6, 'point']],
      cap: '棋盘正中央的那一点叫「天元」（图上蓝点）。它离四条边一样远，是全局最中间的位置 —— 起手走天元不能直接得地，一般在特殊战略（比如打散对方模样）时才用。'
    },

    '金角银边草肚皮': {
      s: 13,
      st: [],
      mk: [[2, 2, 'point'], [2, 10, 'point'], [10, 2, 'point'], [10, 10, 'point'],
        [6, 2, 'shape'], [6, 10, 'shape'], [2, 6, 'shape'], [10, 6, 'shape'], [6, 6, 'shape']],
      cap: '同样花几手棋，**角上（蓝点）围到的地最多，边上（灰点）次之，中腹（灰点）最少**：因为角有两条边帮你挡着，边有一条，中腹一条也没有。这就是「金角、银边、草肚皮」。'
    },

    /* ===== 以下是「概念类」示意图 =====
       这些词讲的不是某个固定形状，而是**一片区域的性质**（模样、厚势、孤棋…），
       所以用灰点 shape 表示「范围」、绿点 good 表示「这一手」、蓝点 point 表示「要点」。
       画法不像死活图那样有唯一答案，但每张都对着正文核过一遍。 */

    '模样': {
      s: 9,
      st: [[1, 2, 'b'], [1, 4, 'b'], [2, 5, 'b'], [4, 5, 'b'], [5, 4, 'b'], [5, 2, 'b']],
      mk: [[2, 3, 'shape'], [3, 3, 'shape'], [3, 4, 'shape'], [2, 4, 'shape'], [4, 3, 'shape']],
      cap: '黑棋这几颗子**没有直接围成地**，但它们一起圈出了一片「将来可能变成地」的范围（灰点）—— 这就是「模样」。**模样是虚的**：对方打进来，它立刻变成一场战斗；对方不来，它才慢慢变成实地。'
    },

    '守角': {
      s: 13,
      st: [[3, 3, 'b']],
      mk: [[4, 5, 'good']],
      cap: '黑棋占了星位（A）。再花一手补在绿点（斜着一路飞出去）—— 这就是「守角」，把角上的地真正圈住。**守角要付出一手棋的代价**，值不值得，看盘上还有没有更大的地方。'
    },

    '挂角': {
      s: 13,
      st: [[3, 3, 'b']],
      mk: [[2, 5, 'good']],
      cap: '黑棋占星位（A），白棋从旁边靠近（绿点）—— 这就是「挂角」。**挂角不是进攻**，而是不让你舒服地守角，同时给白棋自己找出路。挂的位置高低，决定了你后面是想取地还是取势。'
    },

    '厚势': {
      s: 9,
      st: [[2, 2, 'b'], [3, 2, 'b'], [4, 2, 'b'], [2, 3, 'b'], [3, 3, 'b'], [4, 3, 'b']],
      mk: [[2, 4, 'shape'], [3, 4, 'shape'], [4, 4, 'shape'], [5, 4, 'shape']],
      cap: '黑棋这一片**连成一块、没有任何断点**，而且朝着下方的空间（灰点）—— 这叫「厚势」。厚势本身不直接得地，但**对方不敢靠近它**，所以你可以放心去别处抢地。'
    },

    '实地与势力': {
      s: 9,
      st: [[1, 5, 'b'], [2, 5, 'b'], [3, 5, 'b'], [1, 6, 'b'], [3, 6, 'b'], [1, 7, 'b'], [2, 7, 'b'], [3, 7, 'b'],
        [6, 2, 'w'], [7, 3, 'w'], [7, 4, 'w']],
      mk: [[2, 6, 'shape'], [6, 3, 'shape'], [6, 4, 'shape']],
      cap: '左下角黑棋围住的（灰点）是**实地** —— 已经确定属于黑棋的地。右上白棋那几手朝向中腹的影响（灰点）是**势力** —— 还没有变成地，但将来可能变成很大一片。**实地确定但小，势力不确定但可能很大** —— 围棋里最古老的一道选择题就在这两者之间。'
    },

    '大场': {
      s: 9,
      st: [[2, 2, 'b'], [6, 2, 'w']],
      mk: [[2, 6, 'point'], [6, 6, 'point'], [4, 2, 'point']],
      cap: '双方各占一个角之后（A 黑、B 白），盘上价值最大的地方就是边上这几个点（蓝点）—— 它们既能就地拆边围地，又能兼顾角和朝向中腹。**这些点叫「大场」。布局阶段的任务，就是按价值高低依次去占它们。**'
    },

    '急所': {
      s: 9,
      st: [[3, 4, 'w'], [4, 4, 'w'], [5, 4, 'w'], [3, 5, 'w'], [5, 5, 'w'], [3, 6, 'w'], [4, 6, 'w'], [5, 6, 'w']],
      mk: [[4, 5, 'point']],
      cap: '白棋这块棋内部只剩一个点（蓝点）。黑棋下在那里就破眼、白棋自己下在那里就做活 —— **这种「双方谁下到谁得利、直接关系到生死」的点叫「急所」。**一句话：「大场是占便宜，急所是防受伤。**有弱点时，急所优先于大场。**」'
    },

    '打入': {
      s: 9,
      st: [[1, 3, 'b'], [1, 5, 'b'], [2, 6, 'b'], [4, 6, 'b'], [5, 5, 'b'], [5, 3, 'b'], [3, 4, 'w']],
      mk: [[3, 4, 'good']],
      cap: '黑棋在左边围出了一大片模样，白棋直接下进去（绿点）—— 这就是「打入」。打入**风险大**：进去之后要么就地做活、要么跟外面连上，否则就被吃掉；但它能一手破坏对方整片的潜力，所以是破模样的首选手段。'
    },

    '大眼': {
      s: 9,
      st: [[2, 3, 'w'], [3, 3, 'w'], [4, 3, 'w'], [5, 3, 'w'],
        [2, 4, 'w'], [5, 4, 'w'],
        [2, 5, 'w'], [5, 5, 'w'],
        [2, 6, 'w'], [3, 6, 'w'], [4, 6, 'w'], [5, 6, 'w']],
      mk: [[3, 4, 'eye'], [4, 4, 'eye'], [3, 5, 'eye'], [4, 5, 'eye']],
      cap: '白棋围出的空点有四个（灰点）—— 一次围住好几个点的空，叫「大眼」。**大眼的死活要看形状**：图上这个方正的四点（直四）是活的；换成丁四就死了。空间越大越容易活，但形状不对照样死。'
    },

    '孤棋': {
      s: 9,
      st: [[4, 2, 'b'], [4, 3, 'b'], [3, 4, 'b'], [4, 4, 'b'], [5, 4, 'b']],
      mk: [[3, 3, 'shape'], [5, 3, 'shape']],
      cap: '黑棋这一串子周围**没有自己的接应、也没做出眼** —— 这叫「孤棋」。孤棋只能一路逃，而逃的一方永远被动：对方追着走，顺手把地都围了。**布局阶段最忌讳的，就是把子走成孤棋。**'
    },

    '大龙': {
      s: 9,
      st: [[2, 2, 'w'], [3, 2, 'w'], [4, 2, 'w'], [5, 2, 'w'], [5, 3, 'w'], [5, 4, 'w'],
        [5, 5, 'w'], [4, 5, 'w'], [3, 5, 'w']],
      mk: [[2, 4, 'shape'], [3, 4, 'shape'], [4, 4, 'shape']],
      cap: '白棋这一整条连成一块、拐着弯穿过大半个棋盘 —— 这就是「大龙」。**大龙的安全是围棋里最大的事**：一条龙少说十几个子，一旦被围死，棋基本就结束了。所以攻大龙和救大龙，往往是整盘棋的主线。'
    },

    '中腹的价值': {
      s: 9,
      st: [[2, 2, 'b'], [6, 2, 'b'], [2, 6, 'b'], [6, 6, 'b']],
      mk: [[3, 4, 'shape'], [4, 4, 'shape'], [4, 3, 'shape'], [3, 3, 'shape']],
      cap: '中腹（灰点）离四条边都远，**围起来最难也最慢** —— 同样几手棋，角上能围一大片，中腹只围得出一小团。这就是「金角银边草肚皮」。但中腹的价值不是零：**它是连接四方的枢纽**，1933 年的新布局革命挑战的正是这一点。'
    }
  };

  /* ============================================================
     二、小工具（与 app.js 的 esc / md 保持一致的渲染手感）
     ============================================================ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /* 支持 **粗体** 与 \n（反斜杠+n，数据里写的换段标记） */
  function md(s) {
    return esc(s)
      .replace(/\\n/g, '</p><p>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  /* 一句话摘要：去掉粗体标记与换段符，截 38 字 */
  function plain(s, n) {
    var t = String(s == null ? '' : s).replace(/\\n/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  /* 词条 = 主词典 + 补编（走法手法那一批自带图，放在 glossary-more.js） */
  function terms() {
    return (global.GLOSSARY || []).concat(global.GLOSSARY_MORE || []);
  }
  /* 取图：**词条自带的 fig 优先**，其次查 FIGURES 表。
     新词条把图和内容放在一起更省事，老词条继续用表。 */
  function figOf(term) {
    if (!term) return null;
    /* 三个来源，按优先级：① 词条自带的 fig（glossary-more / glossary-figs 里）
                             ② 本文件的老 FIGURES 表
                             ③ 补编那批（概念／计算／布局／中盘／官子） */
    return term.fig || FIGURES[term.t] ||
      (global.GLOSSARY_FIGS && global.GLOSSARY_FIGS[term.t]) || null;
  }
  function byName(name) {
    var G = terms();
    for (var i = 0; i < G.length; i++) if (G[i].t === name) return G[i];
    return null;
  }
  /* 分类顺序 = 数据里第一次出现的顺序 */
  function categories() {
    var G = terms(), out = [];
    for (var i = 0; i < G.length; i++) if (out.indexOf(G[i].c) === -1) out.push(G[i].c);
    return out;
  }
  function hashFor(term) {
    return '#/glossary' + (term ? '/' + encodeURIComponent(term) : '');
  }

  /* ============================================================
     三、列表页：按分类铺卡片网格（一行 3–4 个）+ 搜索
     ============================================================ */
  var LIST_CSS = [
    '.gd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:14px;}',
    '@media(max-width:1080px){.gd-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}',
    '@media(max-width:760px){.gd-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}',
    '@media(max-width:470px){.gd-grid{grid-template-columns:1fr;}}',
    '.gd-cat{margin-bottom:6px;}',
    '.entry.gd-card{padding:15px 17px;cursor:pointer;position:relative;}',
    '.entry.gd-card .t{font-size:15.5px;margin-bottom:4px;}',
    '.entry.gd-card .d{font-size:12.5px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}',
    '.entry.gd-card .m{font-size:11.5px;margin-top:9px;}',
    '.entry.gd-card .m .has-fig{color:var(--accent-2,#8a6a3a);}',
    '.gd-empty{color:var(--ink-3);font-size:14px;padding:18px 2px;}'
  ].join('');

  function renderList(host) {
    var G = terms(), cats = categories(), i, c;
    var figN = 0;
    for (i = 0; i < G.length; i++) if (figOf(G[i])) figN++;

    var html = '';
    html += '<h1>术语词典</h1>';
    html += '<p class="sub">下棋时听到的词，这里都讲透 —— 不只是「是什么」，还包括<b>为什么是这样</b>、<b>实战里怎么用</b>、' +
      '<b>新手最容易搞错哪一点</b>。共 <b>' + G.length + '</b> 条，按 <b>' + cats.length + '</b> 类铺开，' +
      '其中 <b>' + figN + '</b> 条配了棋盘图。点卡片进整页详解。</p>';
    html += '<input class="search-box" id="g-search" autocomplete="off" placeholder="搜术语、解释或用途…（例如：打劫、征子、目）">';

    for (c = 0; c < cats.length; c++) {
      var list = G.filter(function (x) { return x.c === cats[c]; });
      html += '<section class="gd-cat" data-cat="' + esc(cats[c]) + '">';
      html += '<div class="part-title">' + esc(cats[c]) +
        ' <span class="small muted" style="font-weight:400">' + list.length + ' 条</span></div>';
      html += '<div class="entry-grid gd-grid">';
      for (i = 0; i < list.length; i++) {
        var g = list[i];
        var text = (g.t + ' ' + g.c + ' ' + (g.d || '') + ' ' + (g.w || '') + ' ' + (g.u || '') + ' ' + (g.e || '')).toLowerCase();
        html += '<button class="entry gd-card" data-term="' + esc(g.t) + '" data-cat="' + esc(g.c) +
          '" data-text="' + esc(text) + '">' +
          '<div class="t">' + esc(g.t) + '</div>' +
          '<div class="d">' + esc(plain(g.d, 38)) + '</div>' +
          '<div class="m muted">' + (figOf(g) ? '<span class="has-fig">▦ 带棋盘图</span> · ' : '') + '看详解 →</div>' +
          '</button>';
      }
      html += '</div></section>';
    }
    html += '<div class="gd-empty" id="gd-empty" style="display:none">没有找到匹配的术语，换个说法试试（比如「眼」「飞」「官子」）。</div>';

    host.innerHTML = '<style>' + LIST_CSS + '</style>' + html;

    /* 搜索：输入即过滤卡片，整组没有命中就藏掉整组 */
    var search = host.querySelector('#g-search');
    if (search) {
      search.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase();
        var cards = host.querySelectorAll('.gd-card'), k, anyHit = 0;
        for (k = 0; k < cards.length; k++) {
          var hit = !q || cards[k].getAttribute('data-text').indexOf(q) !== -1;
          cards[k].style.display = hit ? '' : 'none';
          if (hit) anyHit++;
        }
        var secs = host.querySelectorAll('.gd-cat');
        for (k = 0; k < secs.length; k++) {
          var vis = 0, kids = secs[k].querySelectorAll('.gd-card');
          for (var m = 0; m < kids.length; m++) if (kids[m].style.display !== 'none') vis++;
          secs[k].style.display = vis ? '' : 'none';
        }
        var empty = host.querySelector('#gd-empty');
        if (empty) empty.style.display = anyHit ? 'none' : '';
      });
    }
  }

  /* ============================================================
     四、详情页：四段正文 + 棋盘图 + 相关术语 + 上一条/下一条
     ============================================================ */
  var DETAIL_CSS = [
    '.gd-sec{margin:24px 0;}',
    '.gd-sec h3{display:flex;align-items:center;gap:9px;margin:0 0 10px;font-size:16px;}',
    '.gd-sec h3::before{content:"";width:4px;height:15px;border-radius:999px;background:var(--accent,#b08968);}',
    '.gd-sec p{margin:9px 0;font-size:14.8px;line-height:1.9;color:var(--ink-2,#4b4239);}',
    '.gd-sec.gd-warn{background:#fdf6ec;border-left:3px solid #e6c9a8;border-radius:0 10px 10px 0;padding:14px 18px;}',
    '.gd-sec.gd-warn h3::before{background:#d8a76a;}',
    '.gd-fig{margin:20px 0 6px;}',
    '.gd-fig .board-shell{max-width:436px;}',   /* 木色底只包住棋盘，不要拉成一整条 */
    '.gd-fig .cap{font-size:13px;line-height:1.8;color:var(--ink-2,#5b5147);margin-top:12px;}',
    '.gd-fig .cap b{color:#4b4239;}',
    '.gd-rel{margin:26px 0 6px;display:flex;gap:9px;align-items:center;flex-wrap:wrap;}',
    '.gd-rel .lbl{font-size:13px;color:var(--ink-3,#8a8078);}',
    '.gd-nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:26px 0 4px;padding-top:18px;border-top:1px solid var(--line,#e8e0d4);}',
    '.gd-nav .pos{font-size:12.5px;color:var(--ink-3,#8a8078);margin-left:auto;}',
    '.gd-crumb{background:none;border:none;padding:0;color:var(--ink-3,#8a8078);font-size:13px;cursor:pointer;}',
    '.gd-crumb:hover{color:var(--accent-2,#8a6a3a);}'
  ].join('');

  /* 已挂载的棋盘视图：下一次渲染前统一销毁（否则 window resize 监听会越积越多） */
  var liveViews = [];
  function clearBoards() {
    for (var i = 0; i < liveViews.length; i++) {
      try { liveViews[i].destroy(); } catch (e) { }
    }
    liveViews = [];
  }

  /* 记住最后一次渲染用的容器，好在卸载时把**挂在它上面的点击委托**也摘掉。
     ⚠️ 这是修一个真 bug：原来 unmount 只调 clearBoards（只清棋盘视图），
     点击委托一直留在 #app 上。于是从围棋词典切到**象棋词典**之后，围棋那套委托还在跑 ——
     象棋词典的卡片同样带 data-term 属性，于是点象棋的卡片会跳到 `#/glossary/...`（围棋的地址），
     象棋词典的详情页永远进不去（实测现象就是这样）。 */
  var lastHost = null;
  function fullUnmount() {
    clearBoards();
    if (lastHost && lastHost.__gdHandler) {
      lastHost.removeEventListener('click', lastHost.__gdHandler);
      lastHost.__gdHandler = null;
    }
    lastHost = null;
  }
  /* 离开词典页时也把棋盘视图销毁掉（board.js 会在 window 上挂 resize 监听，
     不销毁就会一个页面攒一个）。留在词典页内的跳转不销毁，交给 render 自己重挂。 */
  if (global.addEventListener) {
    global.addEventListener('hashchange', function () {
      if (String(global.location && global.location.hash || '').indexOf('#/glossary') !== 0) clearBoards();
    });
  }

  function mountFig(holder, fig, name) {
    var canvas = holder.querySelector('canvas');
    if (!canvas || !global.GoBoardView) return;
    var view = new global.GoBoardView(canvas, { size: fig.s || 9, interactive: false });
    canvas.__view = view;        /* 给自动化测试读盘面用 */
    canvas.__fig = name;
    liveViews.push(view);
    /* 棋盘尺寸按容器宽度算：页面刚插入时宽度可能还是 0，等一帧再量 */
    var tries = 0;
    (function retry() {
      if (canvas.parentElement && canvas.parentElement.clientWidth > 0) {
        view.resize();
        view.setStones(fig.st || []);
        view.setMarks(fig.mk || []);
        return;
      }
      if (tries++ < 20) requestAnimationFrame(retry);
    })();
  }

  function renderDetail(host, name) {
    var G = terms(), g = byName(name);
    if (!g) { renderList(host); return; }
    var idx = G.indexOf(g);
    var prev = idx > 0 ? G[idx - 1] : null;
    var next = idx < G.length - 1 ? G[idx + 1] : null;
    var fig = figOf(g);

    var html = '<style>' + DETAIL_CSS + '</style>';
    html += '<div class="lesson-head">';
    html += '<div class="crumb"><button class="gd-crumb" type="button" data-term="">← 回词典</button></div>';
    html += '<h1>' + esc(g.t) + ' <span class="pill wood">' + esc(g.c) + '</span></h1>';
    html += '<div class="lede">' + esc(g.c) + ' 类术语 · 第 ' + (idx + 1) + ' 条 · 共 ' + G.length + ' 条</div>';
    html += '</div>';

    if (fig) {
      html += '<div class="gd-fig"><div class="board-shell"><div class="board-holder sz' + (fig.s || 9) +
        '" style="max-width:' + ((fig.s || 9) >= 13 ? 420 : 400) + 'px"><canvas></canvas></div></div>' +
        '<div class="cap">' + md(fig.cap) + '</div></div>';
    }

    html += '<div class="gd-sec"><h3>是什么</h3><p>' + md(g.d) + '</p></div>';
    if (g.w) html += '<div class="gd-sec"><h3>为什么</h3><p>' + md(g.w) + '</p></div>';
    if (g.u) html += '<div class="gd-sec"><h3>怎么用</h3><p>' + md(g.u) + '</p></div>';
    if (g.e) html += '<div class="gd-sec gd-warn"><h3>容易搞错</h3><p>' + md(g.e) + '</p></div>';

    if (g.r && g.r.length) {
      html += '<div class="gd-rel"><span class="lbl">相关术语：</span>';
      for (var i = 0; i < g.r.length; i++) {
        var ok = !!byName(g.r[i]);
        html += ok
          ? '<button class="btn ghost sm" type="button" data-term="' + esc(g.r[i]) + '">' + esc(g.r[i]) + '</button>'
          : '<span class="pill gray">' + esc(g.r[i]) + '</span>';
      }
      html += '</div>';
    }

    html += '<div class="gd-nav">' +
      '<button class="btn ghost sm" type="button" id="gd-prev" data-nav="prev"' + (prev ? '' : ' disabled') + '>' +
      (prev ? '← 上一条：' + esc(prev.t) : '← 已是第一条') + '</button>' +
      '<button class="btn sm" type="button" id="gd-next" data-nav="next"' + (next ? '' : ' disabled') + '>' +
      (next ? '下一条：' + esc(next.t) + ' →' : '已是最后一条 →') + '</button>' +
      '<span class="pos">第 ' + (idx + 1) + ' / ' + G.length + ' 条 · ' + esc(g.c) + '</span>' +
      '</div>';

    host.innerHTML = html;

    if (fig) {
      var holder = host.querySelector('.gd-fig .board-holder');
      if (holder) mountFig(holder, fig, g.t);
    }

    /* 上一条 / 下一条 用真实列表顺序，到头置灰（按钮 disabled，不会死链） */
    var pv = host.querySelector('#gd-prev'), nx = host.querySelector('#gd-next');
    if (pv && prev) pv.addEventListener('click', function () { go(host, prev.t); });
    if (nx && next) nx.addEventListener('click', function () { go(host, next.t); });
    host.__gdPrev = prev ? prev.t : null;
    host.__gdNext = next ? next.t : null;
  }

  /* ============================================================
     五、入口：渲染 + 导航
     ============================================================ */
  /* 跳转：优先改 hash（交给 app.js 的路由）；hash 没变时自己重渲染，保证预览页也能用 */
  function go(host, term) {
    var h = hashFor(term);
    if (global.location && global.location.hash === h) {
      render(host, term ? ['glossary', term] : ['glossary']);
    } else if (global.location) {
      global.location.hash = h;
    } else {
      render(host, term ? ['glossary', term] : ['glossary']);
    }
  }

  function onClick(host, e) {
    var el = e.target;
    while (el && el !== host && !(el.getAttribute && el.getAttribute('data-term') !== null)) el = el.parentNode;
    if (!el || el === host) return;
    var t = el.getAttribute('data-term');
    if (t === null) return;
    e.preventDefault();
    go(host, t || '');
  }

  function render(host, seg) {
    if (!host) return;
    seg = seg || [];
    clearBoards();
    /* 同一容器反复渲染时，先摘掉上一次的委托监听 */
    if (host.__gdHandler) host.removeEventListener('click', host.__gdHandler);
    host.__gdHandler = function (e) { onClick(host, e); };
    host.addEventListener('click', host.__gdHandler);
    lastHost = host;

    var term = '';
    if (seg[1]) { try { term = decodeURIComponent(seg[1]); } catch (e) { term = seg[1]; } }
    if (term && byName(term)) renderDetail(host, term);
    else renderList(host);
    host.__gdTerm = term || '';
  }

  var API = {
    render: render,
    FIGURES: FIGURES,
    /* 供 app.js 在切换页面（unmountAll）时调用，销毁本模块挂的棋盘视图 */
    unmount: fullUnmount,
    _go: function (host, t) { go(host, t); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.GoGlossary = API;

})(typeof window !== 'undefined' ? window : globalThis);
