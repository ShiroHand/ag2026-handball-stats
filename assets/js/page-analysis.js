/* ==========================================================================
   page-analysis.js — クラスター分析・主成分分析

   ・散布図: 横軸 50攻撃あたり得点 / 縦軸 50守備あたり失点
   ・k-means でチームを分類
   ・主成分分析を「攻撃のみ」「守備のみ」「攻守まとめて」の3通り
   ========================================================================== */
import {loadJSON, el, q, n, pct, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, CAT, sectionNav} from './core.js';
import {scatter, legend, hbars} from './charts.js';
import {standardize, kmeans, silhouette, pca, adequacy, mean} from './stats.js';
import {selectedFromUrl, applyFilter, allMatchFilterCard} from './matchfilter.js';
import {TRANS_KEYS, addTrans, emptyTrans} from './transitions.js';

const app = q('#app');
let T = null, FILES = null;
let gender = params.get('g') || 'M';
let picked = selectedFromUrl();
let K = parseInt(params.get('k'), 10) || 3;

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('analysis', null); setError(app, e); return; }
  renderChrome('analysis', T);
  renderFoot();
  setBusy(app, 'データを集計中…');
  FILES = (await Promise.all((T.detailIds || []).map(id =>
    loadJSON(`data/matches/${id}.json`, {optional: true})))).filter(Boolean);
  render();
}

/* ------------------------------------------------------------------ 変数定義 */
const WING = ['LW', 'RW'], SIX = ['L6', 'C6', 'R6'], NINE = ['L9', 'C9', 'R9'], FAST = ['FB', 'BT'];
const share = (map, keys, total) => {
  if (!total) return 0;
  return keys.reduce((a, k) => a + n(map?.[k]?.g), 0) / total * 100;
};

/* 1チーム×1試合ぶんの指標。すべて割合か換算値にして、試合数の差で歪まないようにする。 */
function rowOf(me, op) {
  const mp = me.possessions || {}, opp = op.possessions || {};
  const atk = n(mp.attacks), def = n(opp.attacks);
  if (!atk || !def) return null;
  const goals = n(me.stats?.GOALS), shots = n(me.stats?.SHOTS);
  const conceded = n(op.stats?.GOALS);
  const res = {};
  for (const s of me.shots || []) res[s.result] = (res[s.result] || 0) + 1;
  const onT = (res.GOAL || 0) + (res.SAVE || 0);
  const saves = n(me.stats?.GK_SAVES), faced = n(me.stats?.GK_SHOTS);
  return {
    /* 攻撃 */
    attPer50: goals / atk * 50,
    toRate: n(mp.turnovers) / atk * 100,
    shotPct: shots ? goals / shots * 100 : 0,
    assistRate: goals ? n(me.derived?.assists) / goals * 100 : 0,
    wingShare: share(me.shot, WING, goals),
    sixShare: share(me.shot, SIX, goals),
    nineShare: share(me.shot, NINE, goals),
    fastShare: share(me.shot, FAST, goals),
    /* 守備（相手の攻撃を見る） */
    defPer50: conceded / def * 50,
    oppToRate: n(opp.turnovers) / def * 100,
    savePct: faced ? saves / faced * 100 : 0,
    dWingShare: share(op.shot, WING, conceded),
    dSixShare: share(op.shot, SIX, conceded),
    dNineShare: share(op.shot, NINE, conceded),
    dFastShare: share(op.shot, FAST, conceded),
    /* 攻守の切り替え。回数が少ない状況もあるので、4状況をまとめた率も持っておく */
    ...transVars(me.transitions),
  };
}

/* 切り替えの指標。個別の状況は回数が少ないので、
   「ミス直後」と「シュートが枠に行かなかった直後」の2つに絞る。 */
function transVars(tr) {
  const sum = (side, keys) => keys.reduce((a, k) => ({
    n: a.n + n(tr?.[side]?.[k]?.n), g: a.g + n(tr?.[side]?.[k]?.goals),
  }), {n: 0, g: 0});
  const rate = (o) => (o.n > 0 ? o.g / o.n * 100 : null);
  const ownTO = sum('afterOwn', ['TO']);
  const ownMiss = sum('afterOwn', ['SAVE', 'POST']);
  const oppTO = sum('afterOpp', ['TO']);
  const oppMiss = sum('afterOpp', ['SAVE', 'POST']);
  const all = sum('afterOwn', TRANS_KEYS), allA = sum('afterOpp', TRANS_KEYS);
  return {
    transDefTO: rate(ownTO) ?? rate(all) ?? 0,
    transDefMiss: rate(ownMiss) ?? rate(all) ?? 0,
    transAttTO: rate(oppTO) ?? rate(allA) ?? 0,
    transAttMiss: rate(oppMiss) ?? rate(allA) ?? 0,
  };
}

const VARS = {
  att: [
    {k: 'attPer50', label: '50攻撃あたり得点'},
    {k: 'shotPct', label: 'シュート決定率'},
    {k: 'toRate', label: 'ターンオーバー率'},
    {k: 'assistRate', label: 'アシスト率'},
    {k: 'wingShare', label: 'ウイング得点比率'},
    {k: 'sixShare', label: '6m得点比率'},
    {k: 'nineShare', label: '9m得点比率'},
    {k: 'fastShare', label: '速攻・BT得点比率'},
    {k: 'transAttTO', label: '相手ミス直後の得点率'},
    {k: 'transAttMiss', label: '相手シュート失敗直後の得点率'},
  ],
  def: [
    {k: 'defPer50', label: '50守備あたり失点'},
    {k: 'savePct', label: 'GKセーブ率'},
    {k: 'oppToRate', label: '相手TO誘発率'},
    {k: 'dWingShare', label: '被ウイング失点比率'},
    {k: 'dSixShare', label: '被6m失点比率'},
    {k: 'dNineShare', label: '被9m失点比率'},
    {k: 'dFastShare', label: '被速攻・BT失点比率'},
    {k: 'transDefTO', label: '自ミス直後の被失点率'},
    {k: 'transDefMiss', label: '自シュート失敗直後の被失点率'},
  ],
};
VARS.all = [...VARS.att, ...VARS.def];

/* ------------------------------------------------------------------ 集計 */
/* チーム×試合の行（因子分析用）と、チーム平均の行（散布図・分類用） */
function build(list) {
  const perGame = [];                     // {code, gender, id, opp, vals}
  list.forEach(f => {
    for (const code of [f.home, f.away]) {
      const me = f.teams[code], op = f.teams[code === f.home ? f.away : f.home];
      if (!me || !op) continue;
      const v = rowOf(me, op);
      if (v) perGame.push({code, gender: f.gender, id: f.id, date: f.date,
        opp: code === f.home ? f.away : f.home, name: me.nameS || me.name || code, vals: v});
    }
  });
  /* チーム単位は「合計してから割る」（試合ごとの平均だと大差の試合が軽くなるため） */
  const byTeam = new Map();
  list.forEach(f => {
    for (const code of [f.home, f.away]) {
      const me = f.teams[code], op = f.teams[code === f.home ? f.away : f.home];
      if (!me || !op) continue;
      const cur = byTeam.get(code) || {code, gender: f.gender, name: me.nameS || me.name || code,
        games: 0, atk: 0, def: 0, goals: 0, conceded: 0, shots: 0, to: 0, oppTo: 0,
        assists: 0, saves: 0, faced: 0, shot: {}, oppShot: {}, tr: null};
      const mp = me.possessions || {}, opp = op.possessions || {};
      if (!n(mp.attacks) || !n(opp.attacks)) continue;
      cur.games++;
      cur.atk += n(mp.attacks); cur.def += n(opp.attacks);
      cur.goals += n(me.stats?.GOALS); cur.conceded += n(op.stats?.GOALS);
      cur.shots += n(me.stats?.SHOTS);
      cur.to += n(mp.turnovers); cur.oppTo += n(opp.turnovers);
      cur.assists += n(me.derived?.assists);
      cur.saves += n(me.stats?.GK_SAVES); cur.faced += n(me.stats?.GK_SHOTS);
      for (const [z, v] of Object.entries(me.shot || {})) {
        cur.shot[z] = cur.shot[z] || {g: 0, s: 0};
        cur.shot[z].g += n(v.g); cur.shot[z].s += n(v.s);
      }
      for (const [z, v] of Object.entries(op.shot || {})) {
        cur.oppShot[z] = cur.oppShot[z] || {g: 0, s: 0};
        cur.oppShot[z].g += n(v.g); cur.oppShot[z].s += n(v.s);
      }
      cur.tr = addTrans(cur.tr || emptyTrans(), me.transitions);
      byTeam.set(code, cur);
    }
  });
  const teams = [...byTeam.values()].map(t => ({
    ...t,
    vals: {
      attPer50: t.goals / t.atk * 50,
      toRate: t.to / t.atk * 100,
      shotPct: t.shots ? t.goals / t.shots * 100 : 0,
      assistRate: t.goals ? t.assists / t.goals * 100 : 0,
      wingShare: share(t.shot, WING, t.goals),
      sixShare: share(t.shot, SIX, t.goals),
      nineShare: share(t.shot, NINE, t.goals),
      fastShare: share(t.shot, FAST, t.goals),
      defPer50: t.conceded / t.def * 50,
      oppToRate: t.oppTo / t.def * 100,
      savePct: t.faced ? t.saves / t.faced * 100 : 0,
      dWingShare: share(t.oppShot, WING, t.conceded),
      dSixShare: share(t.oppShot, SIX, t.conceded),
      dNineShare: share(t.oppShot, NINE, t.conceded),
      dFastShare: share(t.oppShot, FAST, t.conceded),
      ...transVars(t.tr),
    },
  }));
  return {perGame, teams};
}

/* 男女で水準が違うので、男女それぞれの中で標準化してから混ぜる。
   こうすると標本数を倍にできて、因子の推定が安定する。 */
function zWithinGender(rows, vars) {
  const out = new Array(rows.length);
  for (const g of ['M', 'W']) {
    const idx = rows.map((r, i) => (r.gender === g ? i : -1)).filter(i => i >= 0);
    if (!idx.length) continue;
    const mat = idx.map(i => vars.map(v => rows[i].vals[v.k]));
    const {z} = standardize(mat);
    idx.forEach((i, k) => out[i] = z[k]);
  }
  return out.filter(Boolean).length === rows.length ? out : null;
}

/* ------------------------------------------------------------------ 描画 */
const CLUSTER_COLORS = ['#2ba3e0', '#1f9d6b', '#e8a33d', '#d6336c', '#7a5bbd'];

function render() {
  app.innerHTML = '';

  /* --- 操作行 --- */
  app.append(el('div', {class: 'row', style: {marginBottom: '14px', gap: '10px'}},
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: 'カテゴリ'}),
    el('div', {class: 'chips'}, (T.events || []).map(ev => el('button', {
      class: 'chip' + (ev.gender === gender ? ' on' : ''),
      onclick: () => { gender = ev.gender; setParam('g', gender); render(); scrollTo({top: 0}); },
      text: ev.gender === 'M' ? '男子' : '女子'}))),
    el('div', {style: {flex: '1'}}),
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: '分類の数'}),
    el('div', {class: 'chips'}, [2, 3, 4].map(k => el('button', {
      class: 'chip' + (k === K ? ' on' : ''),
      onclick: () => { K = k; setParam('k', k); render(); }, text: `${k}`})))));

  const allMatches = FILES.filter(f => f.gender === gender)
    .sort((a, b) => (a.dateTime || '').localeCompare(b.dateTime || ''));
  if (!allMatches.length) {
    app.append(el('div', {class: 'empty', text: 'このカテゴリの集計済み試合がまだありません。'}));
    return;
  }
  app.append(allMatchFilterCard(allMatches, picked, (next) => {
    picked = next; render(); scrollTo({top: 0});
  }));

  const list = applyFilter(allMatches, picked);
  const {teams} = build(list);
  /* 因子分析は標本数が要るので、選択中の試合に「もう一方のカテゴリの全試合」を足して推定する。
     標準化は男女別に行うので、水準の違いは持ち込まれない。 */
  const other = FILES.filter(f => f.gender !== gender);
  const {perGame: allPerGame} = build([...list, ...other]);

  if (teams.length < 3) {
    app.append(el('div', {class: 'notice',
      text: `分析に使えるチームが ${teams.length} しかありません。試合を増やして選んでください。`}));
    return;
  }

  app.append(scatterCard(teams));
  app.append(clusterCard(teams));
  app.append(pcaCard('att', '攻撃だけの因子分析', allPerGame, teams));
  app.append(pcaCard('def', '守備だけの因子分析', allPerGame, teams));
  app.append(pcaCard('all', '攻守をまとめた因子分析', allPerGame, teams));
  sectionNav(app);
}

/* ---------- 散布図 + 分類 ---------- */
let LAST = null;       // クラスタ結果を2カードで共有する

function clusterTeams(teams) {
  const mat = teams.map(t => [t.vals.attPer50, t.vals.defPer50]);
  const {z} = standardize(mat);
  const k = Math.min(K, teams.length - 1);
  const km = kmeans(z, k);
  const sil = silhouette(z, km.labels);
  /* 「攻撃が強い順」にクラスタ番号を振り直して、色の意味を安定させる */
  const order = km.centers.map((c, i) => ({i, score: c[0] - c[1]}))
    .sort((a, b) => b.score - a.score).map(o => o.i);
  const remap = {};
  order.forEach((old, ni) => remap[old] = ni);
  const labels = km.labels.map(l => remap[l]);
  return {labels, k, sil};
}

/* クラスタの名前。攻守それぞれが平均から何σ離れているかで型を決め、
   同じ型が2つ出たら差引の大きい順に「上位／下位」を付けて区別する。 */
function clusterNames(teams, labels, k) {
  const A = teams.map(t => t.vals.attPer50), D = teams.map(t => t.vals.defPer50);
  const mA = mean(A), mD = mean(D);
  const sA = Math.sqrt(mean(A.map(v => (v - mA) ** 2))) || 1;
  const sD = Math.sqrt(mean(D.map(v => (v - mD) ** 2))) || 1;
  const info = [];
  for (let ci = 0; ci < k; ci++) {
    const idx = teams.map((t, i) => (labels[i] === ci ? i : -1)).filter(i => i >= 0);
    if (!idx.length) { info.push(null); continue; }
    const a = mean(idx.map(i => A[i])), d = mean(idx.map(i => D[i]));
    const za = (a - mA) / sA;             // プラスなら攻撃が良い
    const zd = (mD - d) / sD;             // プラスなら守備が良い（失点が少ない）
    const TH = 0.35;
    let name, desc;
    if (za > TH && zd > TH) { name = '総合力型'; desc = '攻守とも平均より良い'; }
    else if (za > TH && zd < -TH) { name = '撃ち合い型'; desc = '攻撃は良いが失点も多い'; }
    else if (za < -TH && zd > TH) { name = '守備型'; desc = '得点は伸びないが失点を抑える'; }
    else if (za < -TH && zd < -TH) { name = '苦戦型'; desc = '攻守とも平均を下回る'; }
    else if (za > TH) { name = '攻撃寄り'; desc = '攻撃が平均より良く、守備は平均的'; }
    else if (zd > TH) { name = '守備寄り'; desc = '守備が平均より良く、攻撃は平均的'; }
    else if (za < -TH) { name = '攻撃に課題'; desc = '得点力が平均を下回る'; }
    else if (zd < -TH) { name = '守備に課題'; desc = '失点が平均を上回る'; }
    else { name = '平均型'; desc = '攻守とも平均的'; }
    info.push({ci, name, desc, a, d, margin: a - d});
  }
  /* 名前が重なったら差引の順で区別する */
  const byName = {};
  info.filter(Boolean).forEach(x => (byName[x.name] = byName[x.name] || []).push(x));
  Object.values(byName).forEach(g => {
    if (g.length < 2) return;
    g.sort((x, y) => y.margin - x.margin);
    g.forEach((x, i) => { x.name += i === 0 ? '（上位）' : g.length === 2 ? '（下位）' : `（${i + 1}番手）`; });
  });
  return info;
}

function scatterCard(teams) {
  const {labels, sil} = clusterTeams(teams);
  LAST = {labels, sil};
  const mx = mean(teams.map(t => t.vals.attPer50));
  const my = mean(teams.map(t => t.vals.defPer50));

  const points = teams.map((t, i) => ({
    x: +t.vals.attPer50.toFixed(2),
    y: +t.vals.defPer50.toFixed(2),
    label: t.code,
    color: CLUSTER_COLORS[labels[i] % CLUSTER_COLORS.length],
    r: 8,
    tip: `<b>${t.name}</b>（${t.games}試合）<br>`
      + `50攻撃あたり得点 ${t.vals.attPer50.toFixed(1)}<br>`
      + `50守備あたり失点 ${t.vals.defPer50.toFixed(1)}<br>`
      + `差引 ${(t.vals.attPer50 - t.vals.defPer50).toFixed(1)}`,
  }));

  return el('div', {class: 'card'},
    el('h2', {text: '攻守の効率マップ'}),
    el('div', {class: 'sub',
      text: '横軸は攻撃50回あたりの得点、縦軸は守備50回あたりの失点。'
        + '縦軸は上にいくほど失点が少ない（良い）向きに反転してあるので、右上ほど強いチームです。'
        + '破線は選択中の試合での平均。'}),
    scatter(points, {
      width: 760, height: 500, yDown: true,
      xTitle: '50攻撃あたり得点 →（多いほど良い）',
      yTitle: '← 50守備あたり失点（少ないほど良い）',
      /* 縦軸を反転しているので、上＝失点が少ない。右上が最も強い。 */
      quadrants: {x: mx, y: my, labels: [
        {at: 'rt', text: '総合力型（得点↑ 失点↓）', color: '#1f9d6b'},
        {at: 'lt', text: '守備型（得点↓ 失点↓）', color: '#2ba3e0'},
        {at: 'rb', text: '撃ち合い型（得点↑ 失点↑）', color: '#e8a33d'},
        {at: 'lb', text: '苦戦型（得点↓ 失点↑）', color: '#d6336c'},
      ]},
    }));
}

function clusterCard(teams) {
  const {labels, sil} = LAST;
  const k = Math.max(...labels) + 1;
  const groups = Array.from({length: k}, (_, ci) =>
    teams.map((t, i) => ({t, i})).filter(x => labels[x.i] === ci));

  const names = clusterNames(teams, labels, k);
  const cards = el('div', {class: 'grid g3'});
  groups.forEach((g, ci) => {
    if (!g.length) return;
    const nm = names[ci] || {name: `分類${ci + 1}`, desc: ''};
    const a = mean(g.map(x => x.t.vals.attPer50));
    const d = mean(g.map(x => x.t.vals.defPer50));
    const box = el('div', {class: 'clu'});
    box.style.borderTopColor = CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
    box.append(el('div', {class: 'clu-head'},
      el('span', {class: 'clu-dot', style: {background: CLUSTER_COLORS[ci % CLUSTER_COLORS.length]}}),
      el('b', {text: `分類${ci + 1}: ${nm.name}`})));
    box.append(el('div', {class: 'clu-desc', text: nm.desc}));
    box.append(el('div', {class: 'clu-stat',
      text: `平均 得点${a.toFixed(1)} / 失点${d.toFixed(1)} / 差引${(a - d >= 0 ? '+' : '') + (a - d).toFixed(1)}`}));
    const ul = el('div', {class: 'clu-teams'});
    g.sort((x, y) => (y.t.vals.attPer50 - y.t.vals.defPer50) - (x.t.vals.attPer50 - x.t.vals.defPer50))
      .forEach(x => ul.append(el('div', {class: 'clu-team'},
        flagImg(x.t.code, 'flag sm'),
        el('span', {text: x.t.name}),
        el('span', {class: 'muted num', style: {marginLeft: 'auto', fontSize: '11.5px'},
          text: `${x.t.vals.attPer50.toFixed(1)} / ${x.t.vals.defPer50.toFixed(1)}`}))));
    box.append(ul);
    cards.append(box);
  });

  const quality = sil === null ? '—'
    : sil > 0.5 ? `${sil.toFixed(2)}（はっきり分かれている）`
    : sil > 0.25 ? `${sil.toFixed(2)}（ゆるやかに分かれている）`
    : `${sil.toFixed(2)}（ほとんど分かれていない）`;

  return el('div', {class: 'card'},
    el('h2', {text: `クラスター分析 — ${k}分類`}),
    el('div', {class: 'sub',
      text: '50回あたりの得点と失点を標準化し、k-means法で分類しました。'
        + `分かれ具合の目安（シルエット係数）: ${quality}。`
        + 'チーム数が少ないので、分類の数を変えると所属も変わります。上のボタンで試してください。'}),
    cards);
}

/* ---------- 主成分分析 ---------- */
function pcaCard(kind, title, perGame, teams) {
  const vars = VARS[kind];
  const rows = perGame.filter(r => Number.isFinite(r.vals[vars[0].k]));
  const z = zWithinGender(rows, vars);
  const adq = adequacy(rows.length, vars.length);

  if (!z || rows.length < vars.length + 2) {
    return el('div', {class: 'card'},
      el('h2', {text: title}),
      el('div', {class: 'notice', text: adq.text}));
  }
  const P = pca(z);
  if (!P) {
    return el('div', {class: 'card'},
      el('h2', {text: title}),
      el('div', {class: 'notice', text: '主成分を計算できませんでした。試合数が足りません。'}));
  }

  /* 負荷量の表（第1・第2主成分） */
  const loadTable = el('table', {});
  loadTable.append(el('thead', {}, el('tr', {},
    ['変数', '第1主成分', '第2主成分'].map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  vars.map((v, j) => ({v, l1: P.loadings[0][j], l2: P.loadings[1][j]}))
    .sort((a, b) => Math.abs(b.l1) - Math.abs(a.l1))
    .forEach(r => {
      const cell = (x) => {
        const td = el('td', {class: 'num'});
        const bar = el('span', {class: 'load-bar'});
        const fill = el('span', {class: 'load-fill'});
        fill.style.width = Math.abs(x) * 50 + '%';
        fill.style.background = x >= 0 ? 'var(--good)' : 'var(--bad)';
        fill.style.marginLeft = x >= 0 ? '50%' : (50 - Math.abs(x) * 50) + '%';
        bar.append(fill);
        td.append(el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
          bar, el('span', {style: {minWidth: '38px', fontWeight: Math.abs(x) > 0.5 ? 700 : 400},
            text: x.toFixed(2)})));
        return td;
      };
      tb.append(el('tr', {}, el('td', {text: r.v.label}), cell(r.l1), cell(r.l2)));
    });
  loadTable.append(tb);

  /* チームを主成分平面に置く（チーム×試合の得点を平均） */
  const byTeam = new Map();
  rows.forEach((r, i) => {
    if (r.gender !== gender) return;
    const cur = byTeam.get(r.code) || {code: r.code, name: r.name, n: 0, x: 0, y: 0};
    cur.n++; cur.x += P.scores[i][0]; cur.y += P.scores[i][1];
    byTeam.set(r.code, cur);
  });
  const shown = new Set(teams.map(t => t.code));
  const pts = [...byTeam.values()].filter(t => shown.has(t.code)).map(t => ({
    x: +(t.x / t.n).toFixed(3), y: +(t.y / t.n).toFixed(3),
    label: t.code, color: CAT[0], r: 7,
    tip: `<b>${t.name}</b><br>第1主成分 ${(t.x / t.n).toFixed(2)}<br>第2主成分 ${(t.y / t.n).toFixed(2)}<br>${t.n}試合の平均`,
  }));

  const top = (k, sign) => vars.map((v, j) => ({v, l: P.loadings[k][j]}))
    .filter(x => (sign > 0 ? x.l > 0.35 : x.l < -0.35))
    .sort((a, b) => Math.abs(b.l) - Math.abs(a.l)).slice(0, 3).map(x => x.v.label).join('・') || '—';

  return el('div', {class: 'card'},
    el('h2', {text: title}),
    el('div', {class: 'sub',
      text: `変数${vars.length}個・チーム×試合${rows.length}件。男女それぞれの中で標準化してから合わせています`
        + '（男女で水準が違うため／標本を増やして推定を安定させるため）。'}),
    el('div', {class: 'notice notice-' + adq.level, style: {marginBottom: '12px'}, text: adq.text}),
    el('div', {class: 'grid g2'},
      el('div', {},
        el('div', {class: 'sec-title', text: '各主成分が説明する情報量'}),
        hbars(P.ratio.slice(0, Math.min(5, vars.length)).map((r, i) => ({
          label: `第${i + 1}主成分`, v: +(r * 100).toFixed(1),
        })), {valueKey: 'v', labelKey: 'label', color: CAT[1], fmtv: (v) => v + '%', labelWidth: '92px'}),
        el('div', {class: 'sub', style: {marginTop: '6px'},
          text: `第1＋第2主成分で全体の ${(P.cumulative[1] * 100).toFixed(0)}% を説明しています。`}),
        el('div', {class: 'sec-title', style: {marginTop: '14px'}, text: '軸の意味'}),
        el('div', {class: 'axis-read'},
          el('div', {}, el('b', {text: '第1主成分 +側: '}), top(0, 1)),
          el('div', {}, el('b', {text: '第1主成分 −側: '}), top(0, -1)),
          el('div', {style: {marginTop: '6px'}}, el('b', {text: '第2主成分 +側: '}), top(1, 1)),
          el('div', {}, el('b', {text: '第2主成分 −側: '}), top(1, -1)))),
      el('div', {},
        el('div', {class: 'sec-title', text: 'チームの位置（主成分得点の平均）'}),
        scatter(pts, {width: 560, height: 420,
          xTitle: '第1主成分', yTitle: '第2主成分',
          quadrants: {x: 0, y: 0, labels: []}}))),
    el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '負荷量（変数と主成分の相関）'}),
    el('div', {class: 'sub', style: {margin: '-6px 0 8px'},
      text: '絶対値が 0.5 を超える変数が、その主成分の意味を決めています。緑＝プラス、赤＝マイナス。'}),
    el('div', {class: 'tbl-scroll'}, loadTable));
}
