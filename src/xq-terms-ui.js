/* 象棋板块 · 术语词典页面 —— 只依赖 xq-terms.js（window.XQ_TERMS）与 xq-board.js（window.XQBoard）
 *
 * 入口（由 xq-app.js 的路由调用，接线由作者统一做）：
 *   window.XQTerms.render(host, seg)
 *     seg  —— hash 的分段数组，**不含 'xq' 前缀**
 *             #/xq/terms             → seg = ['terms']          列表页
 *             #/xq/terms/<术语名>    → seg = ['terms', '马后炮']  详情页
 *     host —— 容器元素（app.js 里的 #app）
 *
 * 为什么改成这样（用户原话「全铺开找也麻烦」）：
 *   旧版把 74 条术语的释义全部摊在页面上，想找一个词得一路滚到底。
 *   现在列表页只留术语名 + 释义开头，按分类排成卡片墙（一行 3–4 张），
 *   想看完整解释点进详情页 —— 一次只看一条，反而是最省事的看词典方式。
 *   详情页给四段（是什么 / 为什么 / 怎么用 / 容易搞错），重点术语配一张静态盘面，
 *   底部「上一条 / 下一条」可以按列表顺序一路翻下去。
 *
 * 样式：本项目不许改 style.css，所以只复用现成的类：
 *   .lesson-head(.crumb/.lede) .part-title .entry-grid .entry(.t/.d/.m) .pill
 *   .search-box .demo-wrap .board-shell .board-holder.sz9 .board-say
 *   .gloss-item.open .gloss-body(.gd/.gsec/.gk/.gv/.warn) .lesson-nav .btn(.ghost/.sm)
 *   两个注意点：
 *     1) .part-title 是 display:flex、.entry-grid 是 display:grid，都会盖掉 [hidden]
 *        的 display:none，所以过滤只能改 style.display，不能靠 hidden 属性。
 *     2) .gloss-body 默认 display:none，只有 .gloss-item.open 里才显示 ——
 *        详情页里拿它当四段的容器，渲染时一律带上 open。
 *
 * 自验钩子：XQTerms._state = { page, total, groups, byCat, visible, id, index,
 *                              hasDemo, pieces, marks, prev, next }
 *   纯给 CDP 自验脚本读，页面逻辑不依赖它。
 */
(function (global) {
  'use strict';

  /* 分组显示顺序。以后数据里加了新 cat，排在最后（与 xq-app.js 的 tier 排序同一套写法） */
  var CAT_ORDER = ['基础', '战术', '开局', '残局', '规则与裁判'];

  /* 列表页卡片上显示的释义长度（用户要的「def 开头 30 字左右」） */
  var EXCERPT = 34;

  /* 本模块挂出去的棋盘 view。重渲染前统一 destroy —— 否则每翻一条都会多留一个 resize 监听 */
  var alive = [];

  var XQTerms = {
    render: render,
    _state: { page: 'none' }
  };

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
      });
  }

  /* 正文里的 **粗体** → <b>，其余一律转义。数据里都是成对的 **，奇数段即加粗段。 */
  function rich(s) {
    var parts = String(s === null || s === undefined ? '' : s).split('**');
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      out += (i % 2 === 1) ? '<b>' + esc(parts[i]) + '</b>' : esc(parts[i]);
    }
    return out;
  }

  function killBoards() {
    for (var i = 0; i < alive.length; i++) { try { alive[i].destroy(); } catch (e) { } }
    alive = [];
  }

  function allTerms() { return global.XQ_TERMS || []; }

  /* 分组：按数据里出现过的 cat 汇总，再按 CAT_ORDER 排（未知分组放最后） */
  function groupByCat(list) {
    var cats = [], i, k;
    for (i = 0; i < list.length; i++) if (cats.indexOf(list[i].cat) < 0) cats.push(list[i].cat);
    cats.sort(function (a, b) {
      var ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var groups = [];
    for (i = 0; i < cats.length; i++) {
      var items = [];
      for (k = 0; k < list.length; k++) if (list[k].cat === cats[i]) items.push(list[k]);
      groups.push({ cat: cats[i], items: items });
    }
    return groups;
  }

  /* 搜索用的匹配文本：术语名 + 别称 + 释义 + 三段，全部小写 */
  function haystack(t) {
    return [t.term, (t.alias || []).join(' '), t.def || '', t.w || '', t.u || '', t.e || '']
      .join(' ').toLowerCase();
  }

  /* 卡片上的释义摘要：切到 EXCERPT 个字，断了就补省略号 */
  function excerpt(s) {
    s = String(s || '').replace(/\s+/g, '');
    return s.length > EXCERPT ? s.slice(0, EXCERPT) + '…' : s;
  }

  /* 术语名 → hash 片段。名字是中文，必须 encodeURIComponent，不然不同浏览器表现不一 */
  function hashOf(term) { return '#/xq/terms/' + encodeURIComponent(String(term)); }

  /* ---------------- 列表页：按分类的卡片墙 ---------------- */

  function cardHTML(t) {
    var tags = [];
    if (t.demo) tags.push('配图');
    if (t.w && t.u && t.e) tags.push('详解');
    var m = (t.alias && t.alias.length ? '又叫 ' + t.alias.join(' / ') + ' · ' : '') +
      (tags.length ? tags.join(' · ') + ' · ' : '') + '点开看 →';
    return '<button class="entry" data-term="' + esc(t.term) + '" data-cat="' + esc(t.cat) + '"' +
      ' data-text="' + esc(haystack(t)) + '"' +
      ' onclick="location.hash=\'' + hashOf(t.term) + '\'">' +
      '<div class="t">' + esc(t.term) + '</div>' +
      '<div class="d">' + esc(excerpt(t.def)) + '</div>' +
      '<div class="m">' + esc(m) + '</div></button>';
  }

  function renderList(host, list, groups, byCat) {
    var html = '';
    var nDemo = 0, nFull = 0, i;
    for (i = 0; i < list.length; i++) {
      if (list[i].demo) nDemo++;
      if (list[i].w && list[i].u && list[i].e) nFull++;
    }

    html += '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/xq">象棋</a> · 术语词典</div>' +
      '<h1>术语词典</h1>' +
      '<p class="lede">收了 <b>' + list.length + '</b> 条象棋术语，分五组：' +
      '<b>基础</b>（棋子走法、棋盘上的位置）、<b>战术</b>（杀法与惯用手法）、' +
      '<b>开局</b>、<b>残局</b>、<b>规则与裁判</b>。' +
      '点任意一张卡片进详情页 —— 那里把这条术语拆成「是什么 / 为什么 / 怎么用 / 容易搞错」四段讲透，' +
      '其中 <b>' + nDemo + '</b> 条还配了棋盘图示，页面底部可以顺着「上一条 / 下一条」一条条看下去。' +
      '只想找某个词，就在下面的框里打字过滤。</p></div>';

    html += '<input class="search-box" id="xq-terms-search" type="search" autocomplete="off" ' +
      'placeholder="搜术语、别称或释义，比如「马后炮」「过河」「长将」…">';
    html += '<p class="small muted" id="xq-terms-count"></p>';

    html += '<div id="xq-terms-list">';
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      var gd = 0, k;
      for (k = 0; k < g.items.length; k++) if (g.items[k].demo) gd++;
      html += '<div class="part-title" data-cat="' + esc(g.cat) + '">' +
        esc(g.cat) + ' · ' + g.items.length + ' 条' + (gd ? '（' + gd + ' 条有图）' : '') + '</div>';
      html += '<div class="entry-grid" data-cat="' + esc(g.cat) + '">';
      for (k = 0; k < g.items.length; k++) html += cardHTML(g.items[k]);
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="card" id="xq-terms-none" hidden>' +
      '<h3 style="margin-top:0">没找到这个词</h3>' +
      '<p>换个写法试试 —— 比如只输「马」「炮」这种单字，或者输释义里的词（「过河」「将军」）。' +
      '词典里没有的术语，宁可空着也不会瞎编。</p></div>';

    host.innerHTML = html;

    var search = el('xq-terms-search');
    var counter = el('xq-terms-count');
    var noneBox = el('xq-terms-none');

    function applyFilter(q) {
      q = String(q === null || q === undefined ? '' : q).trim().toLowerCase();
      var cards = host.querySelectorAll('.entry');
      var shown = 0, m;
      for (m = 0; m < cards.length; m++) {
        var hit = !q || (cards[m].getAttribute('data-text') || '').indexOf(q) !== -1;
        cards[m].style.display = hit ? '' : 'none';
        if (hit) shown++;
      }
      /* 组标题和它下面的卡片墙一起收起来（display 由 CSS 指定，必须改 style.display） */
      var titles = host.querySelectorAll('.part-title');
      for (m = 0; m < titles.length; m++) {
        var box = titles[m].nextElementSibling;
        var any = false, kids = box ? box.querySelectorAll('.entry') : [];
        for (var j = 0; j < kids.length; j++) if (kids[j].style.display !== 'none') any = true;
        titles[m].style.display = any ? '' : 'none';
        if (box) box.style.display = any ? '' : 'none';
      }
      if (noneBox) noneBox.hidden = shown > 0;
      if (counter) {
        counter.textContent = q
          ? '搜「' + q + '」：找到 ' + shown + ' 条（共 ' + list.length + ' 条）'
          : '共 ' + list.length + ' 条，分 ' + groups.length + ' 组，其中 ' + nFull +
            ' 条有完整讲解、' + nDemo + ' 条配图。输入即过滤。';
      }
      XQTerms._state.visible = shown;
    }

    if (search) search.addEventListener('input', function () { applyFilter(this.value); });
    applyFilter('');

    XQTerms._state = {
      page: 'list',
      total: list.length,
      groups: groups.length,
      byCat: byCat,
      visible: list.length,
      id: null, index: -1, hasDemo: false, pieces: 0, marks: 0, prev: false, next: false
    };
  }

  /* ---------------- 详情页：四段 + 盘面 + 上一条/下一条 ---------------- */

  function secHTML(label, text, warn) {
    if (!text) return '';
    return '<div class="gsec' + (warn ? ' warn' : '') + '">' +
      '<span class="gk">' + esc(label) + '</span>' +
      '<div class="gv">' + rich(text) + '</div></div>';
  }

  function renderDetail(host, list, idx) {
    var t = list[idx];
    var n = list.length;

    var html = '<div class="lesson-head">' +
      '<div class="crumb"><a href="#/xq/terms">← 回词典</a> · 第 ' + (idx + 1) + ' / ' + n + ' 条</div>' +
      '<h1>' + esc(t.term) + '</h1>' +
      '<div class="row" style="margin-top:10px"><span class="pill">' + esc(t.cat) + '</span>' +
      ((t.alias && t.alias.length)
        ? '<span class="small muted">又叫 ' + esc(t.alias.join(' / ')) + '</span>' : '') +
      (t.demo ? '<span class="pill gray">配图</span>' : '') +
      '</div></div>';

    /* 盘面：静态图，不接点击；盘边带 A–I / 1–10 坐标，正文里说 B3、E5 时好对照 */
    if (t.demo) {
      html += '<div class="demo-wrap"><div class="board-shell">' +
        '<div class="board-holder sz9"><canvas id="xq-term-canvas"></canvas></div>' +
        '<div class="board-say">' + rich(t.demo.caption) + '</div>' +
        '</div></div>';
    }

    /* 四段。.gloss-item.open 是为了让 .gloss-body 显示出来（该类的默认样式是 display:none） */
    html += '<div class="gloss-item open"><div class="gloss-body" style="padding-top:20px">' +
      '<span class="gk">是什么</span>' +
      '<p class="gd">' + rich(t.def) + '</p>' +
      secHTML('为什么有这条', t.w, false) +
      secHTML('实战里怎么用', t.u, false) +
      secHTML('容易搞错的地方', t.e, true);
    if (t.eg) html += '<p class="small muted" style="margin-top:16px">例：' + rich(t.eg) + '</p>';
    if (!t.w && !t.u && !t.e) {
      html += '<p class="small muted" style="margin-top:16px">' +
        '这条术语目前只收了释义 —— 详解（为什么 / 怎么用 / 容易搞错）还没有写。' +
        '词典里没有把握的说法宁可空着，回头再补。</p>';
    }
    html += '</div></div>';

    /* 上一条 / 下一条：按列表顺序前后跳，到头的那一侧是 disabled 的按钮（置灰、点不动） */
    var hasPrev = idx > 0, hasNext = idx < n - 1;
    html += '<div class="lesson-nav">';
    html += '<button class="btn ghost" id="xq-term-prev"' +
      (hasPrev ? ' onclick="location.hash=\'' + hashOf(list[idx - 1].term) + '\'"' : ' disabled') +
      '>← 上一条</button>';
    html += '<span class="small muted" style="align-self:center">第 ' + (idx + 1) + ' / ' + n +
      ' 条 · ' + esc(t.cat) + '</span>';
    html += '<button class="btn" id="xq-term-next"' +
      (hasNext ? ' onclick="location.hash=\'' + hashOf(list[idx + 1].term) + '\'"' : ' disabled') +
      '>下一条 →</button>';
    html += '</div>';

    host.innerHTML = html;

    /* 棋盘：数据里的 [x, y, color, type] 与 xq-board 的 setPieces 格式完全一致；
       marks 转成引擎下标后交给 setHints（空点画蓝点、有子的点画蓝圈）。 */
    var view = null, markN = 0;
    var canvas = el('xq-term-canvas');
    if (canvas && global.XQBoard && t.demo) {
      view = global.XQBoard.mount(canvas, { interactive: false, side: 'r', showLabels: true });
      alive.push(view);
      view.setPieces(t.demo.pieces);
      var marks = (t.demo.marks || []).map(function (m) { return m[1] * 9 + m[0]; });
      markN = marks.length;
      if (markN) view.setHints(marks);
    }

    XQTerms._state = {
      page: 'term',
      total: n,
      groups: 0,
      byCat: {},
      visible: n,
      id: t.term,
      index: idx,
      hasDemo: !!t.demo,
      pieces: t.demo ? (t.demo.pieces || []).length : 0,
      marks: markN,
      prev: hasPrev,
      next: hasNext
    };
  }

  /* ---------------- 入口 ---------------- */

  function render(host, seg) {
    killBoards();

    host = host || el('app');
    seg = seg || [];

    /* 容错：seg 可能是 ['terms', name]，也可能带上 'xq' 前缀 */
    var parts = seg.slice(0);
    while (parts.length && parts[0] === 'xq') parts.shift();
    if (parts[0] !== 'terms') parts.unshift('terms');

    var raw = parts[1] || '';
    var name = '';
    if (raw) { try { name = decodeURIComponent(String(raw)); } catch (e) { name = String(raw); } }

    var list = allTerms();
    if (!list.length) {
      /* 数据没挂上来（打包时漏了 xq-terms.js 之类）——说清楚，不给空页面 */
      host.innerHTML = '<div class="lesson-head">' +
        '<div class="crumb"><a href="#/xq">象棋</a> · 术语词典</div>' +
        '<h1>术语词典</h1></div>' +
        '<div class="card"><h3 style="margin-top:0">词典没加载出来</h3>' +
        '<p>页面里找不到 XQ_TERMS —— 大概是打包时漏了 xq-terms.js。这一条请报给作者。</p>' +
        '<p class="small muted" style="margin-bottom:0">可以先去看' +
        '<a href="#/xq/lesson">入门课</a>或<a href="#/xq/rules">规则速查</a>。</p></div>';
      XQTerms._state = {
        page: 'empty', total: 0, groups: 0, byCat: {}, visible: 0,
        id: null, index: -1, hasDemo: false, pieces: 0, marks: 0, prev: false, next: false
      };
      return;
    }

    var groups = groupByCat(list);
    var byCat = {}, i;
    for (i = 0; i < list.length; i++) byCat[list[i].cat] = (byCat[list[i].cat] || 0) + 1;

    if (!name) return renderList(host, list, groups, byCat);

    /* 名字不认识（手打 hash、旧链接：以前是锚点，现在整条跳转）→ 回列表页，不停在空白页 */
    var idx = -1;
    for (i = 0; i < list.length; i++) if (list[i].term === name) { idx = i; break; }
    if (idx < 0) return renderList(host, list, groups, byCat);

    return renderDetail(host, list, idx);
  }

  global.XQTerms = XQTerms;

})(typeof window !== 'undefined' ? window : this);
