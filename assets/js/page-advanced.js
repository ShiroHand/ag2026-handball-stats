/* ==========================================================================
   page-advanced.js — 発展分析

   他競技の分析手法をハンドボールに翻訳したもの。

   ・5ファクター（バスケの Four Factors + 攻撃効率）
   ・ゲームステート別（サッカーの game state 分析）
   ・サイドアウト構造（バレーの「返し」）
   ・2分退場のコスト（ラグビーのシンビン分析）
   ========================================================================== */
import {loadJSON, el, q, n, pct, fmt, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, effColor, effInk, sectionNav, tip, CAT} from './core.js';
import {hbars, legend, rampLegend} from './charts.js';
import {standardize, ols} from './stats.js';
import {selectedFromUrl, applyFilter, allMatchFilterCard} from './matchfilter.js';

const app = q('#app');
let T = null, FILES = null, gender = params.get('g') || 'M';
let picked = selectedFromUrl();

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('advanced', null); setError(app, e); return; }
  renderChrome('advanced', T);
  renderFoot();
  setBusy(app, 'データを集計中…');
  FILES = (await Promise.all((T.detailIds || []).map(id =>
    loadJSON(`data/matches/${id}.json`, {optional: true})))).filter(Boolean);
  render();
}

const oppOf = (f, c) => (f.home === c ? f.away : f.home);

/* ------------------------------------------------------------------ 集計 */
/* 1チーム×1試合を1行にする。回帰の標本にもチーム比較にも使う。 */
function rows(list) {
  const out = [];
  for (const f of list) {
    for (const code of [f.home, f.away]) {
      const me = f.teams[code], op = f.teams[oppOf(f, code)];
      if (!me || !op) continue;
      const mp = me.possessions || {}, opp = op.possessions || {};
      const atk = n(mp.attacks), def = n(opp.attacks);
      if (!atk || !def) continue;
      const goals = n(me.stats?.GOALS), shots = n(me.stats?.SHOTS);
      const seven = (me.shots || []).filter(s => s.zone === 'P7').length;
      out.push({
        code, name: me.nameS || me.name || code, gender: f.gender, id: f.id,
        atk, def, goals, conceded: n(op.stats?.GOALS),
        shotPct: shots ? goals / shots * 100 : 0,
        toRate: n(mp.turnovers) / atk * 100,
        orbRate: n(mp.offReb) / atk * 100,
        sevenRate: seven / atk * 100,
        eff: goals / atk * 100,
        net: goals / atk * 50 - n(op.stats?.GOALS) / def * 50,
        state: me.gameState, stateDef: me.gameStateDef,
        trans: me.transitions, susp: me.suspension, players: me.players || [],
      });
    }
  }
  return out;
}

/* チーム単位にまとめる（合計してから割る） */
function byTeam(rs) {
  const m = new Map();
  for (const r of rs) {
    const c = m.get(r.code) || {code: r.code, name: r.name, games: 0,
      atk: 0, def: 0, goals: 0, conceded: 0, shots: 0, to: 0, orb: 0, seven: 0};
    c.games++; c.atk += r.atk; c.def += r.def; c.goals += r.goals; c.conceded += r.conceded;
    c.shots += r.goals / (r.shotPct / 100 || 1);
    c.to += r.toRate / 100 * r.atk;
    c.orb += r.orbRate / 100 * r.atk;
    c.seven += r.sevenRate / 100 * r.atk;
    m.set(r.code, c);
  }
  return [...m.values()].map(c => ({...c,
    shotPct: c.shots ? c.goals / c.shots * 100 : 0,
    toRate: c.atk ? c.to / c.atk * 100 : 0,
    orbRate: c.atk ? c.orb / c.atk * 100 : 0,
    sevenRate: c.atk ? c.seven / c.atk * 100 : 0,
    eff: c.atk ? c.goals / c.atk * 100 : 0,
    net: c.atk && c.def ? c.goals / c.atk * 50 - c.conceded / c.def * 50 : 0,
  })).sort((a, b) => b.net - a.net);
}

/* ------------------------------------------------------------------ 描画 */
function render() {
  app.innerHTML = '';
  const events = (T.events || []);
  app.append(el('div', {class: 'row', style: {marginBottom: '14px', gap: '10px'}},
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: 'カテゴリ'}),
    el('div', {class: 'chips'}, events.map(ev => el('button', {
      class: 'chip' + (ev.gender === gender ? ' on' : ''),
      text: ev.gender === 'W' ? '女子' : '男子',
      onclick: () => { gender = ev.gender; setParam('g', gender); render(); },
    })))));

  const all = FILES.filter(f => f.gender === gender)
    .sort((a, b) => (a.dateTime || '').localeCompare(b.dateTime || ''));
  if (!all.length) {
    app.append(el('div', {class: 'card'},
      el('div', {class: 'notice', text: 'このカテゴリの集計済み試合がまだありません。'})));
    return;
  }
  app.append(allMatchFilterCard(all, picked, (next) => { picked = next; render(); }));
  const list = applyFilter(all, picked);
  const rs = rows(list);
  const teams = byTeam(rs);

  app.append(fiveFactorCard(rs, teams));
  app.append(gameStateCard(rs, teams));
  app.append(sideoutCard(rs));
  app.append(suspensionCard(rs, list));
  sectionNav(app);
}

/* ---------- 1. 5ファクター ---------- */
const FACTORS = [
  {k: 'shotPct', label: 'シュート決定率', good: 1},
  {k: 'toRate', label: 'ターンオーバー率', good: -1},
  {k: 'orbRate', label: 'オフェンスリバウンド率', good: 1},
  {k: 'sevenRate', label: '7m獲得率', good: 1},
  {k: 'eff', label: '攻撃効率', good: 1},
];

function fiveFactorCard(rs, teams) {
  const box = el('div', {class: 'card'},
    el('h2', {text: '5ファクター（バスケの Four Factors + 攻撃効率）'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'バスケットボールの Four Factors（決定率・ターンオーバー率・'
        + 'オフェンスリバウンド率・フリースロー率）をハンドボールに置き換え、'
        + '攻撃効率を5つめに加えたものです。分母はすべて攻撃回数。'}));

  /* 比較表 */
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    [el('th', {text: 'チーム'}), el('th', {class: 'num', text: '試合'}),
      ...FACTORS.map(f => el('th', {class: 'num', text: f.label})),
      el('th', {class: 'num', text: '差引(50回)'})])));
  const tb = el('tbody', {});
  const col = {};
  FACTORS.forEach(f => {
    const xs = teams.map(t => t[f.k]);
    const mu = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;
    col[f.k] = {mu, sd};
  });
  teams.forEach(t => {
    const tr = el('tr', {}, el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
      flagImg(t.code, 'flag sm'), el('span', {text: t.code}))),
      el('td', {class: 'num', text: t.games}));
    FACTORS.forEach(f => {
      const z = (t[f.k] - col[f.k].mu) / col[f.k].sd * f.good;
      const td = el('td', {class: 'num', text: fmt(t[f.k], 1) + '%'});
      /* 平均から離れているほど濃く。緑＝良い側 */
      const a = Math.min(0.32, Math.abs(z) * 0.14);
      td.style.background = z > 0 ? `rgba(31,157,107,${a.toFixed(3)})` : `rgba(228,87,46,${a.toFixed(3)})`;
      tip(td, `${f.label}<br>${fmt(t[f.k], 1)}%（平均 ${fmt(col[f.k].mu, 1)}%）<br>`
        + `平均との差 ${z > 0 ? '+' : ''}${fmt(z, 2)} 標準偏差`);
      tr.append(td);
    });
    tr.append(el('td', {class: 'num', style: {fontWeight: 700}, text: fmt(t.net, 1)}));
    tb.append(tr);
  });
  table.append(tb);
  box.append(el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'sub', style: {marginTop: '6px'},
      text: '色は大会平均からの離れ具合（緑＝良い側、赤＝悪い側）。'
        + 'ターンオーバー率だけは少ないほうが良いので色を反転しています。'}));

  /* 重み推定 */
  box.append(el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: 'どの要素が効いているか'}));
  const fit = (keys, target, label) => {
    const rows2 = rs.filter(r => Number.isFinite(r[target]));
    if (rows2.length < keys.length + 3) return el('div', {class: 'notice', text: '試合数が足りません。'});
    const {z: X} = standardize(rows2.map(r => keys.map(k => r[k])));
    const {z: Y} = standardize(rows2.map(r => [r[target]]));
    const res = ols(X, Y.map(v => v[0]));
    if (!res) return el('div', {class: 'notice', text: '回帰を計算できませんでした。'});
    const items = keys.map((k, i) => ({
      label: FACTORS.find(f => f.k === k).label,
      v: +res.coef[i].toFixed(3),
    })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    return el('div', {},
      el('div', {class: 'sub', style: {margin: '0 0 6px'},
        text: `${label}　標本 チーム×試合 ${res.n}件・決定係数 R² = ${fmt(res.r2, 2)}`}),
      hbars(items.map(i => ({label: i.label, v: i.v})),
        {valueKey: 'v', labelKey: 'label', color: CAT[0], fmtv: (v) => fmt(v, 2), labelWidth: '170px'}));
  };
  box.append(
    fit(['shotPct', 'toRate', 'orbRate', 'sevenRate'], 'eff', '① 4要素 → 攻撃効率'),
    el('div', {style: {height: '10px'}}),
    fit(['shotPct', 'toRate', 'orbRate', 'sevenRate', 'eff'], 'net', '② 5要素 → 50回あたりの差引'));

  box.append(el('div', {class: 'sub', style: {marginTop: '10px'},
    text: '数値は標準化偏回帰係数です。単位の違う指標どうしで効き目を比べられます。'
      + '②では攻撃効率が他の4要素の結果でもあるため、4要素の係数を吸収します'
      + '（多重共線性）。①と併せて読んでください。'
      + 'オフェンスリバウンド率はハンドボールでは攻撃の3%程度しか起きないため、'
      + 'バスケの Four Factors ほどは効きません。'}));
  return box;
}

/* ---------- 2. ゲームステート ---------- */
const STATES = [
  {k: 'lead3', label: '3点以上リード'},
  {k: 'lead1', label: '1〜2点リード'},
  {k: 'tied', label: '同点'},
  {k: 'behind1', label: '1〜2点ビハインド'},
  {k: 'behind3', label: '3点以上ビハインド'},
];

let stateTeam = 'all';        // ゲームステート表の対象チーム

function gameStateCard(rs) {
  const box = el('div', {class: 'card'},
    el('h2', {text: 'ゲームステート（点差）別'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'サッカー分析の基本的な考え方です。攻撃を始めた時点の点差で分けています。'
        + '「強いから効率が良い」のか「リードしているから効率が良く見える」のかを切り分けられます。'}));

  const codes = [...new Set(rs.map(r => r.code))].sort();
  if (!codes.includes(stateTeam)) stateTeam = 'all';
  const chips = el('div', {class: 'chips', style: {marginBottom: '10px'}});
  const host = el('div', {});
  [['all', 'すべて'], ...codes.map(c => [c, c])].forEach(([k, label]) => {
    chips.append(el('button', {
      class: 'chip' + (stateTeam === k ? ' on' : ''),
      text: label,
      onclick: (e) => {
        stateTeam = k;
        [...chips.children].forEach(c => c.className = 'chip');
        e.currentTarget.className = 'chip on';
        draw();
      }}));
  });
  box.append(el('div', {class: 'row', style: {gap: '10px'}},
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: 'チーム'}), chips), host);

  const draw = () => {
    host.innerHTML = '';
    const use = stateTeam === 'all' ? rs : rs.filter(r => r.code === stateTeam);
    host.append(stateBody(use, stateTeam));
  };
  draw();
  box.append(teamStateMatrix(rs));
  return box;
}

/* 1チームぶん／全体ぶんの表と棒グラフ */
function stateBody(rs, who) {
  const box = el('div', {});
  const agg = (key) => {
    const out = {};
    STATES.forEach(s => out[s.k] = {attacks: 0, goals: 0, shots: 0, turnovers: 0});
    for (const r of rs) {
      const src = r[key]; if (!src) continue;
      for (const s of STATES) {
        const v = src[s.k]; if (!v) continue;
        out[s.k].attacks += n(v.attacks); out[s.k].goals += n(v.goals);
        out[s.k].shots += n(v.shots); out[s.k].turnovers += n(v.turnovers);
      }
    }
    return out;
  };
  const att = agg('state'), def = agg('stateDef');

  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['点差', '攻撃回数', '得点', '攻撃効率', '決定率', 'TO率',
      '守備回数', '失点', '被攻撃効率'].map((h, i) => el('th', {class: i ? 'num' : '', text: h})))));
  const tb = el('tbody', {});
  STATES.forEach(s => {
    const a = att[s.k], d = def[s.k];
    const e = a.attacks ? a.goals / a.attacks * 100 : null;
    const de = d.attacks ? d.goals / d.attacks * 100 : null;
    const eTd = el('td', {class: 'num', style: {fontWeight: 700}, text: a.attacks ? fmt(e, 1) + '%' : '·'});
    if (a.attacks) { eTd.style.background = effColor(e); eTd.style.color = effInk(e); }
    tb.append(el('tr', {},
      el('td', {text: s.label}),
      el('td', {class: 'num', text: a.attacks || '·'}),
      el('td', {class: 'num', text: a.goals || '·'}),
      eTd,
      el('td', {class: 'num', text: a.shots ? pct(a.goals, a.shots) : '·'}),
      el('td', {class: 'num', text: a.attacks ? pct(a.turnovers, a.attacks) : '·'}),
      el('td', {class: 'num', text: d.attacks || '·'}),
      el('td', {class: 'num', text: d.goals || '·'}),
      el('td', {class: 'num', text: d.attacks ? fmt(de, 1) + '%' : '·'})));
  });
  table.append(tb);
  box.append(el('div', {class: 'tbl-scroll'}, table));

  const eff = STATES.map(s => ({label: s.label,
    v: att[s.k].attacks ? +(att[s.k].goals / att[s.k].attacks * 100).toFixed(1) : 0}));
  box.append(el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '点差別の攻撃効率'}),
    hbars(eff, {valueKey: 'v', labelKey: 'label', color: CAT[0], fmtv: (v) => v + '%', labelWidth: '150px'}),
    el('div', {class: 'sub', style: {marginTop: '8px'},
      text: who === 'all'
        ? '全チームを合計しているので、この表は構造的に対称になります'
          + '（自分の「3点リード時の攻撃」は相手の「3点ビハインド時の守備」なので）。'
          + 'チームを選ぶと、そのチームだけの数字になります。'
        : 'ビハインドの効率が高く出るのは、負けているチームが攻めざるを得ないからだけでなく、'
          + '点差が開いた試合では強いチームの守備が緩む影響も混ざります。'
          + '比べるときは同点・接戦の行を見るのが安全です。'}));
  return box;
}

/* チーム × 点差 の攻撃効率マトリクス */
function teamStateMatrix(rs) {
  const m = new Map();
  for (const r of rs) {
    const c = m.get(r.code) || {code: r.code, games: 0, s: {}};
    c.games++;
    for (const st of STATES) {
      const v = r.state?.[st.k]; if (!v) continue;
      const a = c.s[st.k] = c.s[st.k] || {attacks: 0, goals: 0};
      a.attacks += n(v.attacks); a.goals += n(v.goals);
    }
    m.set(r.code, c);
  }
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    [el('th', {text: 'チーム'}), el('th', {class: 'num', text: '試合'}),
      ...STATES.map(s => el('th', {class: 'num', text: s.label})),
      el('th', {class: 'num', text: '全体'})])));
  const tb = el('tbody', {});
  [...m.values()].sort((a, b) => a.code.localeCompare(b.code)).forEach(c => {
    let ta = 0, tg = 0;
    const tr = el('tr', {}, el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
      flagImg(c.code, 'flag sm'), el('span', {text: c.code}))),
      el('td', {class: 'num', text: c.games}));
    STATES.forEach(s => {
      const v = c.s[s.k] || {attacks: 0, goals: 0};
      ta += v.attacks; tg += v.goals;
      const e = v.attacks ? v.goals / v.attacks * 100 : null;
      const td = el('td', {class: 'num', text: v.attacks >= 5 ? fmt(e, 0) + '%' : '·'});
      if (v.attacks >= 5) { td.style.background = effColor(e); td.style.color = effInk(e); }
      if (v.attacks) tip(td, `${s.label}<br>得点 ${v.goals} / 攻撃 ${v.attacks}<br>攻撃効率 ${fmt(e, 1)}%`);
      tr.append(td);
    });
    tr.append(el('td', {class: 'num', style: {fontWeight: 700}, text: ta ? fmt(tg / ta * 100, 0) + '%' : '·'}));
    tb.append(tr);
  });
  table.append(tb);
  return el('div', {},
    el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: 'チーム × 点差 の攻撃効率'}),
    el('div', {class: 'sub', style: {margin: '-6px 0 8px'},
      text: '攻撃回数が5回未満のセルは「·」にしています。'
        + 'リードしているときだけ効率が高いチームと、点差に関係なく安定しているチームを見分けられます。'}),
    el('div', {class: 'tbl-scroll'}, table),
    rampLegend('攻撃効率'));
}

/* ---------- 3. サイドアウト構造 ---------- */
function sideoutCard(rs) {
  const box = el('div', {class: 'card'},
    el('h2', {text: 'サイドアウト構造 — 失点後に返せるか'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'バレーボールの中核概念「サーブ権を失ったあと、次で取り返せるか」の翻訳です。'
        + '失点した直後の自分の攻撃で取り返した割合を「返し率」、'
        + '自分が得点した直後に相手に取り返された割合を「被返し率」としています。'
        + '返せない状態が続くと一気に点差が開くので、連続失点の起点になります。'}));

  const m = new Map();
  for (const r of rs) {
    const tr = r.trans; if (!tr) continue;
    const c = m.get(r.code) || {code: r.code, games: 0,
      backN: 0, backG: 0, giveN: 0, giveG: 0, atk: 0, goals: 0};
    c.games++;
    c.atk += r.atk; c.goals += r.goals;
    const back = tr.afterOpp?.GOAL, give = tr.afterOwn?.GOAL;
    if (back) { c.backN += n(back.n); c.backG += n(back.goals); }
    if (give) { c.giveN += n(give.n); c.giveG += n(give.goals); }
    m.set(r.code, c);
  }
  const list = [...m.values()].map(c => ({...c,
    backRate: c.backN ? c.backG / c.backN * 100 : null,
    giveRate: c.giveN ? c.giveG / c.giveN * 100 : null,
    eff: c.atk ? c.goals / c.atk * 100 : 0,
  })).sort((a, b) => (b.backRate ?? -1) - (a.backRate ?? -1));

  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['チーム', '試合', '失点した回数', '返した', '返し率', '攻撃効率', '差',
      '得点した回数', '返された', '被返し率'].map((h, i) => el('th', {class: i ? 'num' : '', text: h})))));
  const tb = el('tbody', {});
  list.forEach(c => {
    const d = c.backRate === null ? null : c.backRate - c.eff;
    tb.append(el('tr', {},
      el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
        flagImg(c.code, 'flag sm'), el('span', {text: c.code}))),
      el('td', {class: 'num', text: c.games}),
      el('td', {class: 'num', text: c.backN}),
      el('td', {class: 'num', text: c.backG}),
      el('td', {class: 'num', style: {fontWeight: 700}, text: c.backRate === null ? '·' : fmt(c.backRate, 1) + '%'}),
      el('td', {class: 'num muted', text: fmt(c.eff, 1) + '%'}),
      el('td', {class: 'num', style: {color: d > 0 ? 'var(--good)' : (d < 0 ? 'var(--bad)' : '')},
        text: d === null ? '' : (d > 0 ? '+' : '') + fmt(d, 1)}),
      el('td', {class: 'num', text: c.giveN}),
      el('td', {class: 'num', text: c.giveG}),
      el('td', {class: 'num', text: c.giveRate === null ? '·' : fmt(c.giveRate, 1) + '%'})));
  });
  table.append(tb);
  box.append(el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'sub', style: {marginTop: '8px'},
      text: '「差」は 返し率 − そのチームの攻撃効率です。プラスなら失点直後にむしろ強く、'
        + 'マイナスなら失点がもう1点を呼びやすいことになります。'
        + '失点直後はスローオフから始まるため相手の守備が整っており、'
        + '大会全体では攻撃効率より低く出るのが普通です。'}));
  return box;
}

/* ---------- 4. 2分退場のコスト ---------- */
function suspensionCard(rs, list) {
  const box = el('div', {class: 'card'},
    el('h2', {text: '2分退場のコスト'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'ラグビーのシンビン分析と同じ考え方です。退場の記録時刻から120秒の区間を作り、'
        + 'その間に実際に何点動いたかを数えています。'
        + 'ファウルで止めることの是非を、感覚ではなく点数で議論するための材料です。'}));

  const m = new Map();
  let totN = 0, totSec = 0, totAg = 0, totFor = 0;
  const byPlayer = new Map();
  for (const r of rs) {
    const s = r.susp; if (!s) continue;
    const c = m.get(r.code) || {code: r.code, games: 0, n: 0, sec: 0, against: 0, forGoals: 0,
      oppN: 0, oppFor: 0, oppAgainst: 0};
    c.games++;
    c.n += n(s.own.n); c.sec += n(s.own.sec);
    c.against += n(s.own.against); c.forGoals += n(s.own.forGoals);
    c.oppN += n(s.opp.n); c.oppFor += n(s.opp.forGoals); c.oppAgainst += n(s.opp.against);
    m.set(r.code, c);
    totN += n(s.own.n); totSec += n(s.own.sec);
    totAg += n(s.own.against); totFor += n(s.own.forGoals);
    for (const p of s.players || []) {
      const key = r.code + '|' + p.bib;
      const rec = byPlayer.get(key) || {code: r.code, bib: p.bib, n: 0, against: 0, forGoals: 0,
        name: (r.players.find(x => x.bib === p.bib) || {}).nameS || p.bib};
      rec.n += n(p.n); rec.against += n(p.against); rec.forGoals += n(p.forGoals);
      byPlayer.set(key, rec);
    }
  }

  box.append(el('div', {class: 'kpi-grid', style: {marginBottom: '14px'}},
    kpi('2分退場', totN, `合計 ${Math.round(totSec / 60)}分`),
    kpi('退場中の失点', totAg, `1回あたり ${fmt(totN ? totAg / totN : 0, 2)}`),
    kpi('退場中の得点', totFor, `1回あたり ${fmt(totN ? totFor / totN : 0, 2)}`),
    kpi('1回あたりの差引', fmt(totN ? (totFor - totAg) / totN : 0, 2), '得点 − 失点')));

  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['チーム', '試合', '退場', '退場中の失点', '1回あたり', '退場中の得点', '差引/回',
      '相手の退場', 'その間の得点', '1回あたり'].map((h, i) => el('th', {class: i ? 'num' : '', text: h})))));
  const tb = el('tbody', {});
  [...m.values()].sort((a, b) => (b.against / (b.n || 1)) - (a.against / (a.n || 1))).forEach(c => {
    tb.append(el('tr', {},
      el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
        flagImg(c.code, 'flag sm'), el('span', {text: c.code}))),
      el('td', {class: 'num', text: c.games}),
      el('td', {class: 'num', text: c.n}),
      el('td', {class: 'num', text: c.against}),
      el('td', {class: 'num', style: {fontWeight: 700}, text: c.n ? fmt(c.against / c.n, 2) : '·'}),
      el('td', {class: 'num', text: c.forGoals}),
      el('td', {class: 'num', text: c.n ? fmt((c.forGoals - c.against) / c.n, 2) : '·'}),
      el('td', {class: 'num', text: c.oppN}),
      el('td', {class: 'num', text: c.oppFor}),
      el('td', {class: 'num', text: c.oppN ? fmt(c.oppFor / c.oppN, 2) : '·'})));
  });
  table.append(tb);
  box.append(el('div', {class: 'tbl-scroll'}, table));

  const ps = [...byPlayer.values()].filter(p => p.n >= 2)
    .sort((a, b) => b.against - a.against).slice(0, 12);
  if (ps.length) {
    const t2 = el('table', {});
    t2.append(el('thead', {}, el('tr', {},
      ['選手', 'チーム', '退場', '退場中の失点', '1回あたり'].map((h, i) => el('th', {class: i ? 'num' : '', text: h})))));
    const b2 = el('tbody', {});
    ps.forEach(p => b2.append(el('tr', {},
      el('td', {text: p.name}),
      el('td', {text: p.code}),
      el('td', {class: 'num', text: p.n}),
      el('td', {class: 'num', text: p.against}),
      el('td', {class: 'num', style: {fontWeight: 700}, text: fmt(p.against / p.n, 2)}))));
    t2.append(b2);
    box.append(el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '退場の多い選手（2回以上）'}),
      el('div', {class: 'tbl-scroll'}, t2));
  }

  box.append(el('div', {class: 'sub', style: {marginTop: '10px'},
    text: '同時に2人が退場している時間は、チーム合計では二重に数えないよう区間を統合しています。'
      + '選手別だけは区間ごとに割り当てているので、同時退場では同じ失点が複数人に付きます。'
      + '「誰の退場が高くついたか」の目安として読んでください。'}));
  return box;
}

function kpi(label, value, sub) {
  return el('div', {class: 'kpi'},
    el('div', {class: 'k', text: label}),
    el('div', {class: 'v', text: String(value)}),
    el('div', {class: 's', text: sub}));
}
