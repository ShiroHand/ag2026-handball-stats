import {loadJSON, el, q, n, pct, jpDate, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, CAT, sectionNav} from './core.js';
import {hbars, legend, lineChart} from './charts.js';
import {per50, showPer50} from './kpi.js';
import {mergeTransitions, transitionCard} from './transitions.js';

const app = q('#app');

/* 50回あたりの得点 − 失点 */
function diff50(me, op) {
  const a = per50(n(me.goals), n(me.attacks)), d = per50(n(op.goals), n(op.attacks));
  if (a === null || d === null) return '–';
  return (a - d >= 0 ? '+' : '') + (a - d).toFixed(1);
}
let T = null, FILES = null, REPORTS = {}, code = null, gender = params.get('g') || 'M';

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('situations', null); setError(app, e); return; }
  renderChrome('situations', T);
  renderFoot();
  setBusy(app, 'データを集計中…');
  FILES = (await Promise.all((T.detailIds || []).map(id =>
    loadJSON(`data/matches/${id}.json`, {optional: true})))).filter(Boolean);
  REPORTS = Object.fromEntries((await Promise.all((T.detailIds || []).map(async id =>
    [id, await loadJSON(`data/reports/${id}.json`, {optional: true})])))
    .filter(([, r]) => r));
  code = params.get('team') || (T.teams.find(t => t.gender === gender && t.played)?.code) || T.teams[0]?.code;
  if (!params.get('g')) {
    const t0 = T.teams.find(t => t.code === code);
    if (t0) gender = t0.gender;
  } else if (!T.teams.some(t => t.code === code && t.gender === gender)) {
    const alt = T.teams.find(t => t.gender === gender && t.played) || T.teams.find(t => t.gender === gender);
    if (alt) code = alt.code;
  }
  render();
}

const oppOf = (f, c) => (f.home === c ? f.away : f.home);
const matchesOf = (c) => FILES.filter(f => f.gender === gender && f.teams[c])
  .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

const SIT = [
  {key: 'equal', label: '均等', desc: '同人数（6対6）'},
  {key: 'up', label: '数的優位', desc: '相手が2分間退場中'},
  {key: 'down', label: '数的不利', desc: '自チームが2分間退場中'},
];

const blank = () => ({attacks: 0, goals: 0, shots: 0, missed: 0, saves: 0,
  turnovers: 0, twoMin: 0, assists: 0, offReb: 0, defReb: 0});
const add = (a, b) => { for (const k of Object.keys(a)) a[k] += n(b?.[k]); return a; };

function agg(c) {
  const list = matchesOf(c);
  const poss = blank(), possOpp = blank();
  const sit = {equal: blank(), up: blank(), down: blank()};
  const sitDef = {equal: blank(), up: blank(), down: blank()};
  const eg = {shotsFor: 0, goalsFor: 0, shotsAgainst: 0, goalsAgainst: 0};
  list.forEach(f => {
    const me = f.teams[c], op = f.teams[oppOf(f, c)];
    add(poss, me.possessions); add(possOpp, op.possessions);
    SIT.forEach(s => { add(sit[s.key], me.situations?.[s.key]); add(sitDef[s.key], me.situationsDef?.[s.key]); });
    for (const k of Object.keys(eg)) eg[k] += n(me.emptyGoal?.[k]);
  });
  return {list, poss, possOpp, sit, sitDef, eg};
}

function render() {
  app.innerHTML = '';
  const teams = T.teams.filter(t => t.gender === gender);
  const meta = T.teams.find(t => t.code === code) || {code, name: code};

  const sel = el('select', {onchange: (e) => { code = e.target.value; setParam('team', code); render(); scrollTo({top: 0}); }});
  teams.forEach(t => sel.append(el('option', {value: t.code, selected: t.code === code ? 'selected' : null,
    text: `${t.code} — ${t.name}（${t.played}試合）`})));
  app.append(el('div', {class: 'row', style: {marginBottom: '14px', gap: '10px'}},
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: 'チームを選択'}), sel,
    el('div', {class: 'chips'}, T.events.map(ev => el('button', {
      class: 'chip' + (ev.gender === gender ? ' on' : ''),
      onclick: () => {
        gender = ev.gender; setParam('g', gender);
        const first = T.teams.find(t => t.gender === gender);
        code = first ? first.code : code; setParam('team', code); render(); scrollTo({top: 0});
      }, text: ev.gender === 'M' ? '男子' : '女子'})))));

  app.append(el('div', {class: 'card'},
    el('div', {class: 'row', style: {gap: '14px'}},
      flagImg(code, 'flag'),
      el('div', {},
        el('div', {style: {fontSize: '22px', fontWeight: 700, color: 'var(--navy)'}},
          meta.name, el('span', {style: {fontSize: '14px', color: 'var(--ink-3)', marginLeft: '10px'}, text: '局面分析'})),
        el('div', {class: 'muted', style: {fontSize: '12px'},
          text: `攻撃回数・リバウンド・数的状況・無人ゴール　/　${gender === 'M' ? '男子' : '女子'}`})))));

  const A = agg(code);
  if (!A.list.length) {
    app.append(el('div', {class: 'empty', text: 'まだ集計できる試合がありません。'}));
    app.append(rankingCard());
    return;
  }
  const g = A.list.length;

  /* ---- 攻撃回数・効率 KPI ---- */
  app.append(el('div', {class: 'grid g4'},
    kpi('攻撃回数', A.poss.attacks, `1試合 ${(A.poss.attacks / g).toFixed(1)} 回`),
    kpi('攻撃効率', pct(A.poss.goals, A.poss.attacks, 1), `得点 ${A.poss.goals} / 攻撃 ${A.poss.attacks}`),
    kpi('守備回数', A.possOpp.attacks, `1試合 ${(A.possOpp.attacks / g).toFixed(1)} 回`),
    kpi('被攻撃効率', pct(A.possOpp.goals, A.possOpp.attacks, 1), `失点 ${A.possOpp.goals} / 被攻撃 ${A.possOpp.attacks}`)));

  /* 50回あたりに換算した得点・失点（試合のテンポに左右されない指標） */
  const p50a = per50(A.poss.goals, A.poss.attacks);
  const p50d = per50(A.possOpp.goals, A.possOpp.attacks);
  app.append(el('div', {class: 'grid g3'},
    kpi('50攻撃あたり得点', showPer50(p50a), '攻撃効率 × 50'),
    kpi('50守備あたり失点', showPer50(p50d), '被攻撃効率 × 50'),
    kpi('差引（50回あたり）',
      (p50a !== null && p50d !== null ? ((p50a - p50d >= 0 ? '+' : '') + (p50a - p50d).toFixed(1)) : '–'),
      '得点 − 失点。プラスが大きいほど強い')));

  app.append(el('div', {class: 'grid g4'},
    kpi('OFリバウンド', A.poss.offReb, `1試合 ${(A.poss.offReb / g).toFixed(1)} 回`),
    kpi('DFリバウンド', A.poss.defReb, `1試合 ${(A.poss.defReb / g).toFixed(1)} 回`),
    kpi('ターンオーバー', A.poss.turnovers, `攻撃の ${pct(A.poss.turnovers, A.poss.attacks)}`),
    kpi('被ターンオーバー', A.possOpp.turnovers, `相手攻撃の ${pct(A.possOpp.turnovers, A.possOpp.attacks)}`)));

  /* ---- 数的状況 ---- */
  app.append(el('div', {class: 'card'},
    el('h2', {text: '数的状況別（均等 / 数的優位 / 数的不利）'}),
    el('div', {class: 'sub'},
      '2分間退場の記録時刻から、各プレー時点の人数差を復元して分類しています',
      el('br'),
      'handball.ai レポートの Equality / Superiority / Inferiority に相当します。'),
    el('div', {class: 'grid g2'},
      sitTable(A.sit, '攻撃時', ['攻撃回数', '得点', 'シュート', '攻撃効率', '決定率']),
      sitTable(A.sitDef, '守備時', ['被攻撃回数', '失点', '被シュート', '被攻撃効率', '被決定率'], true)),
    el('div', {class: 'grid g2', style: {marginTop: '16px'}},
      el('div', {},
        el('div', {class: 'sec-title', text: '攻撃効率（得点 / 攻撃回数）'}),
        hbars(SIT.map(s => ({label: s.label, v: A.sit[s.key].attacks
          ? +(A.sit[s.key].goals / A.sit[s.key].attacks * 100).toFixed(1) : 0, color: CAT[0]})),
          {valueKey: 'v', labelKey: 'label', max: 100, fmtv: (v) => v + '%'})),
      el('div', {},
        el('div', {class: 'sec-title', text: '被攻撃効率（失点 / 被攻撃回数）'}),
        hbars(SIT.map(s => ({label: s.label, v: A.sitDef[s.key].attacks
          ? +(A.sitDef[s.key].goals / A.sitDef[s.key].attacks * 100).toFixed(1) : 0, color: CAT[4]})),
          {valueKey: 'v', labelKey: 'label', max: 100, fmtv: (v) => v + '%'})))));

  /* ---- 無人ゴール（7対6） ---- */
  app.append(emptyGoalCard(A));

  /* ---- 試合別 ---- */
  app.append(transitionCard(mergeTransitions(A.list, code),
    {title: `攻守の切り替え — ${A.list.length}試合の累計`}));
  app.append(perMatchCard(A));

  /* ---- 大会内ランキング ---- */
  app.append(rankingCard());

  sectionNav(app);
}

function kpi(k, v, s) {
  return el('div', {class: 'kpi'}, el('div', {class: 'k', text: k}),
    el('div', {class: 'v', text: v}), el('div', {class: 's', text: s}));
}

function sitTable(sit, title, heads, def = false) {
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: title}), heads.map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  const tot = blank();
  SIT.forEach(s => {
    const v = sit[s.key];
    add(tot, v);
    tb.append(el('tr', {},
      el('td', {}, el('div', {}, s.label),
        el('div', {class: 'muted', style: {fontSize: '11px'}, text: s.desc})),
      el('td', {class: 'num', text: v.attacks}),
      el('td', {class: 'num', style: {fontWeight: 700}, text: v.goals}),
      el('td', {class: 'num', text: v.shots}),
      el('td', {class: 'num', text: pct(v.goals, v.attacks, 1)}),
      el('td', {class: 'num', text: pct(v.goals, v.shots)})));
  });
  tb.append(el('tr', {class: 'total'},
    el('td', {text: '合計'}),
    el('td', {class: 'num', text: tot.attacks}), el('td', {class: 'num', text: tot.goals}),
    el('td', {class: 'num', text: tot.shots}),
    el('td', {class: 'num', text: pct(tot.goals, tot.attacks, 1)}),
    el('td', {class: 'num', text: pct(tot.goals, tot.shots)})));
  table.append(tb);
  return el('div', {class: 'tbl-scroll'}, table);
}

const EG_STATES = [
  {key: 'v7x6', label: '7対6（GKを下げて7人攻撃）'},
  {key: 'v6x6', label: '6対6（通常）'},
  {key: 'other', label: 'その他'},
];
const EG_COLS = [
  {k: 'attacks', label: '攻撃回数'}, {k: 'goals', label: '得点'},
  {k: 'saves', label: 'セーブされ'}, {k: 'missed', label: 'ミス'},
  {k: 'blocked', label: 'ブロック'}, {k: 'post', label: 'ポスト'},
  {k: 'turnovers', label: 'ターンオーバー'}, {k: 'goalsAgainst', label: '被無人ゴール'},
];

/* 公式 Empty Goal Analysis (C77) を全試合ぶん合算する */
function egOfficial(list, c) {
  const sit = {}, tl = {}, dur = {}, subs = {courtToGk: 0, courtToCourt: 0, gkGk: 0, total: 0};
  let found = false;
  EG_STATES.forEach(s => sit[s.key] = Object.fromEntries(EG_COLS.map(x => [x.k, 0])));
  list.forEach(f => {
    const r = REPORTS[f.id]?.emptyGoal;
    if (!r) return;
    found = true;
    EG_STATES.forEach(s => {
      const v = r.situations?.[c]?.[s.key];
      if (v) EG_COLS.forEach(x => sit[s.key][x.k] += n(v[x.k]));
      const t = r.timeline?.[c]?.[s.key] || {};
      for (const [b, o] of Object.entries(t)) {
        tl[b] = tl[b] || {goals: 0, attacks: 0};
        tl[b].goals += n(o.goals); tl[b].attacks += n(o.attacks);
      }
    });
    for (const [d, o] of Object.entries(r.duration?.[c] || {})) {
      dur[d] = dur[d] || {goals: 0, attacks: 0};
      dur[d].goals += n(o.goals); dur[d].attacks += n(o.attacks);
    }
    for (const k of Object.keys(subs)) subs[k] += n(r.substitutions?.[c]?.[k]);
  });
  return found ? {sit, tl, dur, subs} : null;
}

const DUR_ORDER = ['<15s', '15-30s', '30-45s', '45-60s', '>60s'];
const BUCKET_ORDER = ['0-5', '5-10', '10-15', '15-20', '20-25', '25-30',
  '30-35', '35-40', '40-45', '45-50', '50-55', '55-60'];

function emptyGoalCard(A) {
  const box = el('div', {class: 'card'}, el('h2', {text: '無人ゴール・7対6（公式 Empty Goal Analysis）'}));
  const off = egOfficial(A.list, code);

  if (!off) {
    const e = A.eg;
    box.append(el('div', {class: 'sub'},
      '公式PDFレポート（Empty Goal Analysis）が未取得のため、プレーバイプレー由来の集計のみ表示しています。'));
    box.append(el('div', {class: 'grid g4'},
      kpi('無人ゴールへのシュート', e.shotsFor, '相手がGKを下げていた局面'),
      kpi('うち成功', e.goalsFor, pct(e.goalsFor, e.shotsFor)),
      kpi('無人ゴールを打たれた', e.shotsAgainst, '自チームがGKを下げていた局面'),
      kpi('うち失点', e.goalsAgainst, pct(e.goalsAgainst, e.shotsAgainst))));
    return box;
  }

  const s7 = off.sit.v7x6;
  box.append(el('div', {class: 'sub'},
    '公式の Empty Goal Analysis レポートから取り込んだ、GKを下げて7人で攻めた局面の集計です。'));
  box.append(el('div', {class: 'grid g4'},
    kpi('7対6の攻撃回数', s7.attacks, `全攻撃の ${pct(s7.attacks, A.poss.attacks)}`),
    kpi('7対6の得点', s7.goals, `効率 ${pct(s7.goals, s7.attacks, 1)}`),
    kpi('7対6中の被無人ゴール', s7.goalsAgainst, 'GK不在を突かれた失点'),
    kpi('GK→コートプレーヤー交代', off.subs.courtToGk, '7人攻撃に切り替えた回数')));

  /* 状態別の表 */
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: '人数状況'}), EG_COLS.map(c2 => el('th', {text: c2.label})), el('th', {text: '効率'}))));
  const tb = el('tbody', {});
  const tot = Object.fromEntries(EG_COLS.map(x => [x.k, 0]));
  EG_STATES.forEach(st => {
    const v = off.sit[st.key];
    EG_COLS.forEach(x => tot[x.k] += n(v[x.k]));
    tb.append(el('tr', {},
      el('td', {text: st.label}),
      EG_COLS.map(x => el('td', {class: 'num',
        style: x.k === 'goals' ? {fontWeight: 700} : null, text: n(v[x.k]) || ''})),
      el('td', {class: 'num', text: pct(v.goals, v.attacks, 1)})));
  });
  tb.append(el('tr', {class: 'total'},
    el('td', {text: '合計'}),
    EG_COLS.map(x => el('td', {class: 'num', text: tot[x.k] || ''})),
    el('td', {class: 'num', text: pct(tot.goals, tot.attacks, 1)})));
  table.append(tb);
  box.append(el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '人数状況別の攻撃'}));
  box.append(el('div', {class: 'tbl-scroll'}, table));

  /* 5分推移と攻撃時間 */
  const tlB = BUCKET_ORDER.filter(b => off.tl[b]);
  const durB = DUR_ORDER.filter(d => off.dur[d]);
  const grid = el('div', {class: 'grid g2', style: {marginTop: '16px'}});
  if (tlB.length) {
    grid.append(el('div', {},
      el('div', {class: 'sec-title', text: '無人ゴール局面の発生時間帯（5分ごと）'}),
      lineChart([
        {label: '攻撃回数', color: CAT[1], values: tlB.map(b => off.tl[b].attacks)},
        {label: '得点', color: CAT[0], values: tlB.map(b => off.tl[b].goals)},
      ], tlB, {width: 560, height: 200}),
      legend([{label: '攻撃回数', color: CAT[1]}, {label: '得点', color: CAT[0]}])));
  }
  if (durB.length) {
    grid.append(el('div', {},
      el('div', {class: 'sec-title', text: '攻撃時間別の成否'}),
      hbars(durB.map(d => ({label: `${d}　${off.dur[d].goals}/${off.dur[d].attacks}`,
        v: off.dur[d].attacks ? +(off.dur[d].goals / off.dur[d].attacks * 100).toFixed(0) : 0, color: CAT[0]})),
        {valueKey: 'v', labelKey: 'label', max: 100, fmtv: (v) => v + '%', labelWidth: '150px'}),
      el('div', {class: 'sub', style: {marginTop: '6px'}, text: 'ラベルの数字は 得点/攻撃回数、バーは成功率'})));
  }
  if (grid.children.length) box.append(grid);

  box.append(el('div', {class: 'sub', style: {marginTop: '10px'}},
    `交代回数: GK→コートプレーヤー ${off.subs.courtToGk} / コート内 ${off.subs.courtToCourt} / 合計 ${off.subs.total}`));
  return box;
}

function perMatchCard(A) {
  const rows = A.list.map(f => {
    const me = f.teams[code], op = f.teams[oppOf(f, code)];
    return {f, opp: oppOf(f, code), me: me.possessions || {}, op: op.possessions || {}};
  });
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['対戦相手', '攻撃回数', '得点', '攻撃効率', '50攻撃あたり得点', 'OFリバ', 'DFリバ', 'TO',
      '守備回数', '失点', '被攻撃効率', '50守備あたり失点', '差引'].map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  rows.forEach(r => tb.append(el('tr', {},
    el('td', {}, el('div', {class: 'row', style: {gap: '7px'}},
      el('span', {class: 'muted', style: {fontSize: '11px'}, text: jpDate(r.f.date)}),
      flagImg(r.opp, 'flag sm'),
      el('a', {href: `match.html?id=${r.f.id}`, text: r.opp}))),
    el('td', {class: 'num', text: n(r.me.attacks)}),
    el('td', {class: 'num', style: {fontWeight: 700}, text: n(r.me.goals)}),
    el('td', {class: 'num', text: pct(n(r.me.goals), n(r.me.attacks), 1)}),
    el('td', {class: 'num', text: showPer50(per50(n(r.me.goals), n(r.me.attacks)))}),
    el('td', {class: 'num', text: n(r.me.offReb) || ''}),
    el('td', {class: 'num', text: n(r.me.defReb) || ''}),
    el('td', {class: 'num', text: n(r.me.turnovers) || ''}),
    el('td', {class: 'num', text: n(r.op.attacks)}),
    el('td', {class: 'num', text: n(r.op.goals)}),
    el('td', {class: 'num', text: pct(n(r.op.goals), n(r.op.attacks), 1)}),
    el('td', {class: 'num', text: showPer50(per50(n(r.op.goals), n(r.op.attacks)))}),
    el('td', {class: 'num', style: {fontWeight: 700}, text: diff50(r.me, r.op)}))));
  table.append(tb);

  const labels = rows.map(r => `${jpDate(r.f.date)} ${r.opp}`);
  return el('div', {class: 'card'},
    el('h2', {text: '試合ごとの攻撃回数と効率'}),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'grid g2', style: {marginTop: '14px'}},
      el('div', {},
        el('div', {class: 'sec-title', text: '攻撃回数・守備回数'}),
        lineChart([
          {label: '攻撃回数', color: CAT[0], values: rows.map(r => n(r.me.attacks))},
          {label: '守備回数', color: CAT[1], values: rows.map(r => n(r.op.attacks))},
        ], labels, {width: 560, height: 200}),
        legend([{label: '攻撃回数', color: CAT[0]}, {label: '守備回数', color: CAT[1]}])),
      el('div', {},
        el('div', {class: 'sec-title', text: '攻撃効率・被攻撃効率（%）'}),
        lineChart([
          {label: '攻撃効率', color: CAT[0], values: rows.map(r => n(r.me.attacks) ? Math.round(n(r.me.goals) / n(r.me.attacks) * 100) : 0)},
          {label: '被攻撃効率', color: CAT[4], values: rows.map(r => n(r.op.attacks) ? Math.round(n(r.op.goals) / n(r.op.attacks) * 100) : 0)},
        ], labels, {width: 560, height: 200}),
        legend([{label: '攻撃効率', color: CAT[0]}, {label: '被攻撃効率', color: CAT[4]}]))));
}

function rankingCard() {
  const rows = T.teams.filter(t => t.gender === gender).map(t => {
    const A = agg(t.code);
    if (!A.list.length) return null;
    return {
      code: t.code, name: t.name, games: A.list.length,
      attacks: A.poss.attacks, goals: A.poss.goals,
      eff: A.poss.attacks ? A.poss.goals / A.poss.attacks * 100 : 0,
      defEff: A.possOpp.attacks ? A.possOpp.goals / A.possOpp.attacks * 100 : 0,
      offReb: A.poss.offReb, defReb: A.poss.defReb, to: A.poss.turnovers,
    };
  }).filter(Boolean).map(r => ({...r, margin: (r.eff - r.defEff) / 100 * 50}))
    .sort((a, b) => b.margin - a.margin);

  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['#', 'チーム', '試合', '攻撃回数', '得点', '攻撃効率', '被攻撃効率',
      '50攻撃あたり得点', '50守備あたり失点', '差引', 'OFリバ', 'DFリバ', 'TO']
      .map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  rows.forEach((r, i) => tb.append(el('tr', {style: r.code === code ? {background: '#eaf4fc'} : null},
    el('td', {class: 'num muted', text: i + 1}),
    el('td', {}, el('div', {class: 'row', style: {gap: '7px'}}, flagImg(r.code, 'flag sm'),
      el('a', {href: `situations.html?team=${r.code}&g=${gender}`, text: r.name}))),
    el('td', {class: 'num', text: r.games}),
    el('td', {class: 'num', text: r.attacks}),
    el('td', {class: 'num', text: r.goals}),
    el('td', {class: 'num', style: {fontWeight: 700}, text: r.eff.toFixed(1) + '%'}),
    el('td', {class: 'num', text: r.defEff.toFixed(1) + '%'}),
    el('td', {class: 'num', text: (r.eff / 100 * 50).toFixed(1)}),
    el('td', {class: 'num', text: (r.defEff / 100 * 50).toFixed(1)}),
    el('td', {class: 'num', style: {fontWeight: 700},
      text: (r.margin >= 0 ? '+' : '') + r.margin.toFixed(1)}),
    el('td', {class: 'num', text: r.offReb || ''}),
    el('td', {class: 'num', text: r.defReb || ''}),
    el('td', {class: 'num', text: r.to || ''}))));
  table.append(tb);

  return el('div', {class: 'card'},
    el('h2', {text: `大会内 攻撃効率ランキング（${gender === 'M' ? '男子' : '女子'}）`}),
    el('div', {class: 'sub', text: '攻撃効率 = 得点 ÷ 攻撃回数。攻撃回数は公式プレーバイプレーの攻撃開始イベント数です。'}),
    el('div', {class: 'tbl-scroll'}, table));
}
