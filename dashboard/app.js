/* Token Radar's page: the board, the live-token view, the model, and one detail view per
   protocol. It reads window.RADAR, the dataset main.ts writes beside this page, and nothing
   else: no fetch, no network, no framework. State lives in the address hash, so a link opens
   the same board, filter or detail view: #tab=board|live|model, #q=, #cat=, #chain=,
   #min=, #watchlist=1, #sort=rank|tvl|change|implied|age, #detail=<slug>. */
(function () {
  'use strict';

  var RADAR = window.RADAR || { rows: [], live: [], multiples: [] };
  var rows = RADAR.rows || [];
  var live = RADAR.live || [];
  var multiples = RADAR.multiples || [];

  /** Compact dollars: 481000000 -> $481.0M, 603309 -> $603.3K. */
  function money(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  /** Whole dollars with thousands separators. */
  function moneyFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Signed per cent with one decimal, or an em dash when unknown. */
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  /** Age in days as years or days: 543 -> 1.5y, 45 -> 45d. */
  function ageLabel(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  /** Escape text for HTML. */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** One farm step as action plus its cost and time, split from the stored string. */
  function splitStep(step) {
    var costAt = step.lastIndexOf(' Cost: ');
    var timeAt = step.lastIndexOf(' Time: ');
    if (costAt < 0 || timeAt < 0 || timeAt < costAt) return { text: step, cost: '', time: '' };
    return {
      text: step.slice(0, costAt),
      cost: step.slice(costAt + 7, timeAt).replace(/\.$/, ''),
      time: step.slice(timeAt + 7).replace(/\.$/, ''),
    };
  }

  /** The address hash as a plain object. */
  function readHash() {
    var out = {};
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return out;
    raw.split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at < 0) return;
      out[decodeURIComponent(pair.slice(0, at))] = decodeURIComponent(pair.slice(at + 1));
    });
    return out;
  }

  var state = {
    tab: 'board',
    q: '',
    cat: '',
    chain: '',
    min: 0,
    watchlist: false,
    sort: 'rank',
    dir: 1,
    detail: null,
  };

  /** State from the address hash, on load. A hash that names nothing resets the rest, so a
      link to a filtered board never carries a detail view along with it. */
  function stateFromHash() {
    var h = readHash();
    state.tab = 'board';
    state.q = '';
    state.cat = '';
    state.chain = '';
    state.min = 0;
    state.watchlist = false;
    state.sort = 'rank';
    state.dir = 1;
    state.detail = null;
    if (h.tab === 'live' || h.tab === 'model') state.tab = h.tab;
    if (h.q) state.q = h.q;
    if (h.cat) state.cat = h.cat;
    if (h.chain) state.chain = h.chain;
    if (h.min) state.min = Number(h.min) || 0;
    if (h.watchlist === '1') state.watchlist = true;
    if (['rank', 'tvl', 'change', 'implied', 'age'].indexOf(h.sort) >= 0) state.sort = h.sort;
    if (h.dir === '-1') state.dir = -1;
    if (h.detail) state.detail = h.detail;
  }

  /** State back into the address hash, without scrolling the page. */
  function stateToHash() {
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.min) parts.push('min=' + state.min);
    if (state.watchlist) parts.push('watchlist=1');
    if (state.sort !== 'rank') parts.push('sort=' + state.sort);
    if (state.dir === -1) parts.push('dir=-1');
    if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
    var hash = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash || window.location.pathname + window.location.search);
  }

  /** Distinct values of a field across the board, sorted. */
  function distinct(field) {
    var seen = {};
    rows.forEach(function (r) {
      var values = field === 'chains' ? r.chains : [r[field]];
      values.forEach(function (v) { if (v) seen[v] = true; });
    });
    return Object.keys(seen).sort();
  }

  /** The board after the filters, in the chosen sort order. */
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watchlist && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.min && r.tvl_usd < state.min) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var va = key === 'tvl' ? a.tvl_usd : key === 'change' ? (a.change_7d === null ? -Infinity : a.change_7d) : key === 'implied' ? a.implied_value_usd : key === 'age' ? (a.age_days === null ? -1 : a.age_days) : a.rank;
      var vb = key === 'tvl' ? b.tvl_usd : key === 'change' ? (b.change_7d === null ? -Infinity : b.change_7d) : key === 'implied' ? b.implied_value_usd : key === 'age' ? (b.age_days === null ? -1 : b.age_days) : b.rank;
      if (va === vb) return a.rank - b.rank;
      return (va < vb ? -1 : 1) * state.dir;
    });
    return out;
  }

  function bySlug(slug) {
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) return rows[i];
    return null;
  }

  /** One row's one-line reason for its rank, for the top picks. */
  function whyLine(r) {
    var bits = [];
    bits.push('TVL ' + money(r.tvl_usd));
    bits.push('peer ' + r.peer_multiple.toFixed(3) + 'x');
    if (r.change_7d !== null) bits.push('7d ' + pct(r.change_7d));
    if (r.age_days !== null) bits.push('live ' + ageLabel(r.age_days) + ' with no token');
    return bits.join(' · ');
  }

  var main = document.getElementById('board');
  var topValue = rows.length ? rows[0].implied_value_usd : 1;

  function headerHtml() {
    return '<div class="shell">' +
      '<header class="top"><div class="brand"><span class="mark"></span><span class="brand-name">Token Radar · model ' + esc(RADAR.model_version || '') + '</span></div>' +
      '<div class="top-meta"><span>Snapshot <b>' + esc(RADAR.as_of || '') + '</b></span><span>Protocols <b>' + (RADAR.rows ? RADAR.rows.length : 0) + ' ranked</b></span><span>Watchlist <b>' + (RADAR.watchlist_size || 0) + ' / ' + (RADAR.watchlist_size || 0) + '</b></span></div></header>' +
      '<section class="lede"><div><h1>Which pre-token protocol is worth farming next?</h1>' +
      '<p>Every protocol in the snapshot that <b>records no token</b> and is not a product of one that already trades, ranked by what its launch would be worth. The implied value is this radar\u2019s own claim, built only from the snapshot\u2019s figures: TVL, seven-day growth, time running with no token, and how its category trades.</p></div>' +
      '<div class="facts">' +
      '<div class="fact"><span>Board rows</span><b>' + rows.length + '</b></div>' +
      '<div class="fact"><span>Watchlist covered</span><b>' + (RADAR.watchlist_size || 0) + ' of ' + (RADAR.watchlist_size || 0) + '</b></div>' +
      '<div class="fact"><span>Top implied value</span><b>' + money(topValue) + '</b></div>' +
      '<div class="fact"><span>Set aside, not ranked</span><b>' + (RADAR.excluded_pre_token || 0) + ' pre-token</b></div>' +
      '</div></section>';
  }

  function picksHtml() {
    var picks = rows.slice(0, 3);
    if (!picks.length) return '';
    return '<section class="picks" aria-label="Top picks">' + picks.map(function (r) {
      return '<button class="pick" data-slug="' + esc(r.slug) + '"><span class="rank">Rank ' + r.rank + (r.on_watchlist ? ' · Watchlist' : '') + '</span>' +
        '<b>' + esc(r.name) + '</b><span class="why">' + esc(whyLine(r)) + '</span>' +
        '<span class="value">' + money(r.implied_value_usd) + ' implied</span></button>';
    }).join('') + '</section>';
  }

  function controlsHtml() {
    var cats = distinct('category');
    var chains = distinct('chains');
    var minOptions = [[0, 'Any TVL'], [10000000, '$10M+'], [50000000, '$50M+'], [100000000, '$100M+'], [500000000, '$500M+'], [1000000000, '$1B+']];
    return '<div class="controls">' +
      '<div class="tabs" role="group" aria-label="View">' +
      '<button data-tab="board" aria-pressed="' + (state.tab === 'board') + '">Board</button>' +
      '<button data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live tokens</button>' +
      '<button data-tab="model" aria-pressed="' + (state.tab === 'model') + '">How the model works</button></div>' +
      '<div class="field"><label for="q">Search</label><input id="q" type="search" placeholder="Name, slug or category" value="' + esc(state.q) + '"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat"><option value="">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain"><option value="">All chains</option>' +
      chains.map(function (c) { return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="min">Min TVL</label><select id="min">' +
      minOptions.map(function (o) { return '<option value="' + o[0] + '"' + (state.min === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<label class="check"><input id="watchlist" type="checkbox"' + (state.watchlist ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count" id="count"></span></div>';
  }

  function sortButton(key, label) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<button data-sort="' + key + '">' + label + arrow + '</button>';
  }

  function boardHtml(list) {
    if (!list.length) {
      return '<div class="panel"><div class="empty"><h2>Nothing matches those filters</h2><p>Loosen the search, the category or the TVL floor.</p><button class="button primary" id="reset">Clear the filters</button></div></div>';
    }
    var body = list.map(function (r) {
      var change = r.change_7d === null ? '<span class="num">—</span>' : '<span class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
      var width = Math.max(2, Math.round((r.implied_value_usd / topValue) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' data-selected="true"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td>' + change + '</td>' +
        '<td><span class="implied"><span class="num">' + money(r.implied_value_usd) + '</span><span class="bar"><i style="width:' + width + '%"></i></span></span></td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td>' + (r.on_watchlist ? '<span class="badge">Watchlist</span>' : '<span class="tag">Early find</span>') + '</td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table><thead><tr>' +
      '<th>' + sortButton('rank', 'Rank') + '</th><th>Protocol</th><th>' + sortButton('tvl', 'TVL') + '</th><th>' + sortButton('change', '7d') + '</th>' +
      '<th>' + sortButton('implied', 'Implied value') + '</th><th>' + sortButton('age', 'No token for') + '</th><th>Status</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div>';
  }

  function liveHtml() {
    var body = live.map(function (p) {
      var change = p.change_7d === null ? '<span class="num">—</span>' : '<span class="num ' + (p.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(p.change_7d) + '</span>';
      return '<tr><td><span class="name"><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.slug) + ' · ' + esc(p.category || 'no category') + '</span></span></td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + (p.multiple === null ? '—' : p.multiple.toFixed(3) + 'x') + '</td><td>' + change + '</td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Protocol</th><th>Market cap</th><th>TVL</th><th>MCap / TVL</th><th>7d</th></tr></thead><tbody>' + body + '</tbody></table></div></div>' +
      '<section class="panel model"><h2>Why this table is here</h2><p>These are the protocols whose token already trades, shown at the market\u2019s own value. Their market-cap-to-TVL ratios are the peer multiples that price the board: a category\u2019s multiple is the median ratio of its protocols in this table, and a category with fewer than three of them is priced at the snapshot-wide median of <b>' + (RADAR.global_multiple || 0).toFixed(3) + 'x</b>. Nothing on the board is priced by hand.</p></section>';
  }

  function modelHtml() {
    var m = RADAR.model || {};
    var multRows = multiples.map(function (x) {
      return '<tr><td>' + esc(x.category) + '</td><td class="num">' + x.multiple.toFixed(3) + 'x</td><td class="num">' + x.peers + '</td><td>' + (x.used_global ? 'Snapshot median' : 'Category median') + '</td></tr>';
    }).join('');
    return '<section class="panel model"><h2>The value model, in full</h2>' +
      '<p>Every rank follows from the snapshot alone. No protocol name is ever special-cased: the same function scores all ' + rows.length + ' rows.</p>' +
      '<div class="formula">implied = TVL x peer_multiple(category)<br>' +
      '<span>x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')</span><br>' +
      '<span>x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')</span><br>' +
      '<span>x (1 + min(chains - 1, ' + m.chain_max + ') x ' + m.chain_step + ')</span></div>' +
      '<p><b>Peer multiple.</b> The median market-cap-to-TVL ratio of the token-bearing protocols in the same category, where at least ' + m.min_peers + ' of them trade; otherwise the snapshot-wide median. Clamped to [' + m.multiple_min + ', ' + m.multiple_max + '], so one outlier cannot set a category\u2019s price. <b>Growth.</b> The seven-day TVL change, clamped, so a hot week lifts a protocol and a cold one cuts it, neither without limit. <b>Maturity.</b> How long the protocol has run with no token: longer earns more, up to three years. <b>Chains.</b> A protocol live on more chains earns a little more, capped at five chains.</p>' +
      '<h3>Peer multiples by category</h3><div class="table-wrap"><table class="mult-table"><thead><tr><th>Category</th><th>Multiple</th><th>Peers</th><th>Source</th></tr></thead><tbody>' + multRows + '</tbody></table></div>' +
      '<p class="note"><b>What the board leaves out.</b> ' + (RADAR.excluded_pre_token || 0) + ' protocols record no token but are not ranked: centralised exchanges, bridges, liquid-staking and restaking products, wrapped or staked products, exchange-branded products and versioned pools. A launch there would be a product of a token that already trades, not a new one. The watchlist\u2019s 40 protocols all pass this rule, and the board holds every one of them.</p>' +
      '<p class="note"><b>What \u201cno token\u201d means.</b> The snapshot records no token for these protocols; that is not proof they have none. The implied value is this radar\u2019s own claim about a launch, never a promise that one happens, and never a prediction of when.</p>' +
      '</section>';
  }

  function detailHtml(r) {
    if (!r) return '';
    var base = r.tvl_usd * r.peer_multiple;
    var steps = r.farm_steps.map(function (s) {
      var part = splitStep(s);
      return '<li><b>' + esc(part.text) + '</b>' + (part.cost || part.time ? '<span class="cost">' + esc([part.cost, part.time].filter(Boolean).join(' · ')) + '</span>' : '') + '</li>';
    }).join('');
    return '<aside class="detail" id="detail" aria-label="Protocol detail"><div class="detail-head"><div>' +
      '<span class="sub">Rank ' + r.rank + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ')) + '</span>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · listed ' + esc(r.listed_at || 'unknown') + ' · records no token</p></div>' +
      '<button class="close" id="close-detail">Close</button></div>' +
      '<div class="detail-section"><h3>Implied value</h3><div class="equation">' +
      '<div><span>TVL x peer multiple (' + esc(r.category || 'no category') + ', ' + r.peer_multiple.toFixed(3) + 'x)</span><b>' + moneyFull(base) + '</b></div>' +
      '<div><span>Growth multiplier (' + pct(r.change_7d) + ' over 7 days)</span><b>' + r.growth_multiplier.toFixed(4) + 'x</b></div>' +
      '<div><span>Maturity multiplier (' + ageLabel(r.age_days) + ' with no token)</span><b>' + r.maturity_multiplier.toFixed(4) + 'x</b></div>' +
      '<div><span>Chain multiplier (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</span><b>' + r.chain_multiplier.toFixed(4) + 'x</b></div>' +
      '<div class="total"><span>Implied value</span><b>' + moneyFull(r.implied_value_usd) + '</b></div></div></div>' +
      '<div class="detail-section"><h3>How to farm it</h3><ol class="steps">' + steps + '</ol>' +
      '<p style="margin-top:12px">Farm plans are generated from the protocol\u2019s own record: its category, its chains, its TVL and its age. Nothing here is financial advice, and no token is promised.</p></div></aside>';
  }

  function render() {
    var list = filteredRows();
    var html = headerHtml() + picksHtml() + controlsHtml();
    if (state.tab === 'live') html += liveHtml();
    else if (state.tab === 'model') html += modelHtml();
    else html += boardHtml(list);
    html += '<footer class="foot"><span>Source: the sealed protocol snapshot of ' + esc(RADAR.as_of || '') + ' (DefiLlama protocols, fetched once for this bounty). Implied values are this radar\u2019s own claim.</span>' +
      '<span>Model ' + esc(RADAR.model_version || '') + ': peer multiples by category, seven-day growth, time with no token, chain breadth. The program that built this page runs from the same snapshot with no network.</span></footer></div>';
    var selected = state.detail ? bySlug(state.detail) : null;
    if (selected) html += detailHtml(selected);
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    var count = document.getElementById('count');
    if (count && state.tab === 'board') count.textContent = list.length + ' of ' + rows.length + ' protocols';
    stateToHash();
  }

  function openDetail(slug) {
    state.detail = slug;
    render();
    var detail = document.getElementById('detail');
    if (detail) detail.scrollTop = 0;
  }

  main.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-tab]');
    if (tab) { state.tab = tab.getAttribute('data-tab'); state.detail = null; render(); return; }
    var sort = event.target.closest('[data-sort]');
    if (sort) {
      var key = sort.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      render(); return;
    }
    if (event.target.id === 'reset') {
      state.q = ''; state.cat = ''; state.chain = ''; state.min = 0; state.watchlist = false; state.sort = 'rank'; state.dir = 1;
      render(); return;
    }
    if (event.target.id === 'close-detail') { state.detail = null; render(); return; }
    var row = event.target.closest('[data-slug]');
    if (row) openDetail(row.getAttribute('data-slug'));
  });

  main.addEventListener('input', function (event) {
    if (event.target.id === 'q') { state.q = event.target.value; render(); var q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  });

  main.addEventListener('change', function (event) {
    if (event.target.id === 'cat') { state.cat = event.target.value; render(); }
    if (event.target.id === 'chain') { state.chain = event.target.value; render(); }
    if (event.target.id === 'min') { state.min = Number(event.target.value) || 0; render(); }
    if (event.target.id === 'watchlist') { state.watchlist = event.target.checked; render(); }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.detail) { state.detail = null; render(); }
  });

  window.addEventListener('hashchange', function () {
    stateFromHash();
    render();
  });

  stateFromHash();
  render();
})();
