import {loadJSON, el, q, n, pct, jpDate, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, shortRole, CAT, SERIES, sectionNav} from './core.js';
import {donut, legend, courtMap, goalMap, hbars, lineChart, stackedBars, zoneBreakdownTable} from './charts.js';
import {connectionSection, mergeConnections, assistedZoneTable} from './connections.js';
import {countsFromTeam, addCounts, emptyCounts, kpiGrid, KPI_NOTE} from './kpi.js';
import {selectedFromUrl, applyFilter, matchFilterCard} from './matchfilter.js';

const app = q('#app');
let T = null, FILES = null, code = null, gender = params.get('g') || 'M';
let picked = selectedFromUrl();   // 対象試合の絞り込み（null = 全試合）

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('defense', null); setError(app, e); return; }
  renderChrome('defense', T);
  renderFoot();
  setBusy(app, 'データを集計中…');
  FILES = (await Promise.all((T.detailIds || []).map(id =>
    loadJSON(`data/matches/${id}.json`, {optional: true})))).filter(Boolean);
  code = params.get('team') || (T.teams.find(t => t.gender === gender && t.played)?.code) || T.teams[0]?.code;
  /* g が明示されていればそれを優先。指定がなければチームの所属カテゴリに合わせる */
  if (!params.get('g')) {
    const t0 = T.teams.find(t => t.code === code);
    if (t0) gender = t0.gender;
  } else if (!T.teams.some(t => t.code === code && t.gender === gender)) {
    const alt = T.teams.find(t => t.gender === gender && t.played) || T.teams.find(t => t.gender === gender);
    if (alt) code = alt.code;
  }
  render();
}

/* ------------------------------------------------------------------ 集計 */
const oppOf = (f, c) => (f.home === c ? f.away : f.home);
const matchesOf = (c) => FILES.filter(f => f.gender === gender && f.teams[c])
  .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

const ZK = ['LW', 'L6', 'C6', 'R6', 'RW', 'L9', 'C9', 'R9', 'P7', 'EG', 'BT', 'FB', 'FLY'];

/* 守備 = 対戦相手の攻撃データの合計 */
/* useFilter=false のときは全試合で集計する（大会内ランキングは絞り込みの影響を受けない） */
function defAgg(c, useFilter = false) {
  const list = useFilter ? applyFilter(matchesOf(c), picked) : matchesOf(c);
  const conceded = {};                  // 相手の位置別 {g,s}
  ZK.forEach(z => conceded[z] = {g: 0, s: 0});
  let concededZone = null;              // 相手が決めたコース 3×3
  let saveZone = null;                  // 自GKのセーブコース 3×3
  const oppStats = {};                  // 相手チーム統計の合計
  const ownStats = {};                  // 自チーム（GK・ブロック等）の合計
  const oppScorers = new Map();         // 失点を許した相手選手
  const ownDef = new Map();             // 自チームの守備貢献

  const addZone = (acc, zones, keys) => {
    if (!zones) return acc;
    if (!acc) acc = zones.map(r => r.map(() => Object.fromEntries(keys.map(k => [k, 0]))));
    zones.forEach((r, i) => r.forEach((cell, j) => keys.forEach(k => acc[i][j][k] += n(cell[k]))));
    return acc;
  };

  list.forEach(f => {
    const me = f.teams[c], op = f.teams[oppOf(f, c)];
    ZK.forEach(z => {
      conceded[z].g += n(op.shot?.[z]?.g);
      conceded[z].s += n(op.shot?.[z]?.s);
    });
    concededZone = addZone(concededZone, op.shotZone, ['g', 's']);
    saveZone = addZone(saveZone, me.gkZone, ['sv', 's', 'g']);
    Object.entries(op.stats).forEach(([k, v]) => {
      if (/PERCENT|EFFICIENCY/.test(k)) return;
      oppStats[k] = (oppStats[k] || 0) + n(v);
    });
    Object.entries(me.stats).forEach(([k, v]) => {
      if (/PERCENT|EFFICIENCY/.test(k)) return;
      ownStats[k] = (ownStats[k] || 0) + n(v);
    });
    op.players.forEach(p => {
      const g = n(p.stats.GOALS);
      if (!g) return;
      const key = `${op.code} #${p.bib} ${p.nameS || p.name}`;
      oppScorers.set(key, (oppScorers.get(key) || 0) + g);
    });
    me.players.forEach(p => {
      const key = p.bib + '|' + p.name;
      if (!ownDef.has(key)) ownDef.set(key, {bib: p.bib, name: p.nameS || p.name, role: p.role,
        games: 0, blocks: 0, twoMin: 0, steals: 0, sevenMConceded: 0, saves: 0, gkShots: 0, time: 0});
      const a = ownDef.get(key);
      a.games++;
      a.saves += n(p.stats.GK_SAVES);
      a.gkShots += n(p.stats.GK_SHOTS);
      a.time += n(p.stats.TIME_PLAYED);
    });
    /* ブロック・スティール・被7m・2分はプレーバイプレー由来のほうが精度が高い */
    (me.defActs || []).forEach(d => {
      const hit = [...ownDef.values()].find(x => x.bib === d.bib);
      const a = hit || (ownDef.set(d.bib + '|' + d.name, {bib: d.bib, name: d.name, role: '',
        games: 0, blocks: 0, twoMin: 0, steals: 0, sevenMConceded: 0, saves: 0, gkShots: 0, time: 0}),
        ownDef.get(d.bib + '|' + d.name));
      a.blocks += n(d.blocks);
      a.steals += n(d.steals);
      a.twoMin += n(d.twoMin);
      a.sevenMConceded = n(a.sevenMConceded) + n(d.sevenMConceded);
    });
  });

  return {list, conceded, concededZone, saveZone, oppStats, ownStats,
    oppScorers: [...oppScorers.entries()].sort((a, b) => b[1] - a[1]).map(([label, v]) => ({label, v})),
    ownDef: [...ownDef.values()]};
}

/* ------------------------------------------------------------------ 描画 */
function render() {
  app.innerHTML = '';
  const teams = T.teams.filter(t => t.gender === gender);
  const meta = T.teams.find(t => t.code === code) || {code, name: code};

  const sel = el('select', {onchange: (e) => { code = e.target.value; picked = null; setParam('m', null); setParam('team', code); render(); scrollTo({top: 0}); }});
  teams.forEach(t => sel.append(el('option', {value: t.code, selected: t.code === code ? 'selected' : null,
    text: `${t.code} — ${t.name}（${t.played}試合）`})));
  app.append(el('div', {class: 'row', style: {marginBottom: '14px', gap: '10px'}},
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: 'チームを選択'}), sel,
    el('div', {class: 'chips'}, T.events.map(ev => el('button', {
      class: 'chip' + (ev.gender === gender ? ' on' : ''),
      onclick: () => {
        gender = ev.gender; setParam('g', gender);
        picked = null; setParam('m', null);
        const first = T.teams.find(t => t.gender === gender);
        code = first ? first.code : code; setParam('team', code); render(); scrollTo({top: 0});
      }, text: ev.gender === 'M' ? '男子' : '女子'})))));

  app.append(el('div', {class: 'card'},
    el('div', {class: 'row', style: {gap: '14px'}},
      flagImg(code, 'flag'),
      el('div', {},
        el('div', {style: {fontSize: '22px', fontWeight: 700, color: 'var(--navy)'}},
          meta.name, el('span', {style: {fontSize: '14px', color: 'var(--ink-3)', marginLeft: '10px'}, text: '守備分析'})),
        el('div', {class: 'muted', style: {fontSize: '12px'},
          text: `対戦相手の攻撃データを合計して算出　/　${gender === 'M' ? '男子' : '女子'}`})))));

  const allMatches = matchesOf(code);
  if (!allMatches.length) {
    app.append(el('div', {class: 'empty', text: 'まだ集計できる試合がありません。'}));
    app.append(rankingCard());
    return;
  }
  if (allMatches.length > 1) {
    app.append(matchFilterCard(allMatches, picked, (f) => oppOf(f, code), (next) => {
      picked = next; render(); scrollTo({top: 0});
    }));
  }

  const D = defAgg(code, true);

  const ga = D.list.reduce((a, f) => a + n(f.teams[oppOf(f, code)].score), 0);
  const oppShots = n(D.oppStats.SHOTS), oppGoals = n(D.oppStats.GOALS);
  const sv = n(D.ownStats.GK_SAVES), gsh = n(D.ownStats.GK_SHOTS);

  app.append(el('div', {class: 'grid g4'},
    kpi('平均失点', (ga / D.list.length).toFixed(1), `総失点 ${ga}（${D.list.length}試合）`),
    kpi('被シュート決定率', pct(oppGoals, oppShots), `${oppGoals}/${oppShots}　低いほど良い`),
    kpi('GKセーブ率', pct(sv, gsh), `${sv}/${gsh}`),
    kpi('1試合の被シュート', (oppShots / D.list.length).toFixed(1),
      `ブロック ${sumBy(D.ownDef, 'blocks')} / スティール ${sumBy(D.ownDef, 'steals')}`)));

  /* 守備のKPI（相手にやらせた内容の累計） */
  const opp = D.list.reduce((acc, f) => addCounts(acc, countsFromTeam(f.teams[oppOf(f, code)])), emptyCounts());
  const mine = D.list.reduce((acc, f) => addCounts(acc, countsFromTeam(f.teams[code])), emptyCounts());
  app.append(el('div', {class: 'card'},
    el('h2', {text: `守備のKPI — ${D.list.length}試合の累計`}),
    el('div', {class: 'sub', text: '相手チームの攻撃を合計したもの。数字が小さいほど良い守備です（相手のターンオーバーだけは多いほど良い）。' + KPI_NOTE}),
    kpiGrid(opp, 'def', mine),
    el('div', {class: 'sub', style: {marginTop: '10px'},
      text: `1試合あたり: 被攻撃 ${(opp.attacks / D.list.length).toFixed(1)} 回 / 失点 ${(opp.goals / D.list.length).toFixed(1)} / 被シュート ${(opp.shots / D.list.length).toFixed(1)} / 相手のTO ${(opp.turnovers / D.list.length).toFixed(1)}`})));

  /* --- 被シュートマップ --- */
  app.append(el('div', {class: 'card'},
    el('h2', {text: 'どこから失点しているか'}),
    el('div', {class: 'sub', text: '相手の全シュートを位置別に集計。濃い赤ほど相手の決定率が高い＝守備の弱点。'}),
    el('div', {class: 'grid g3'},
      el('div', {}, el('div', {class: 'sec-title', text: '被シュート位置（相手のゴール / シュート）'}),
        courtMap(D.conceded, {attacks: opp.attacks, perLabel: '失点'})),
      el('div', {}, el('div', {class: 'sec-title', text: '失点コース（相手が決めた枠内コース）'}),
        goalMap(D.concededZone, {}, {width: 360}),
        el('div', {class: 'sub', style: {marginTop: '6px'}, text: '相手のゴール / 枠内シュート'})),
      el('div', {}, el('div', {class: 'sec-title', text: 'GKセーブコース'}),
        goalMap((D.saveZone || []).map(r => r.map(c => ({g: c.sv, s: c.s}))), {}, {width: 360}),
        el('div', {class: 'sub', style: {marginTop: '6px'}, text: 'セーブ / 被シュート（コース別）'}))),
    el('div', {style: {marginTop: '14px'}},
      el('div', {class: 'sec-title', text: '位置別の失点内訳'}),
      zoneBreakdownTable(D.conceded, {attacks: opp.attacks, perLabel: '失点', shotLabel: '被シュート'}))));

  /* --- 相手の攻撃内訳 --- */
  app.append(el('div', {class: 'card'},
    el('h2', {text: '相手の攻撃内訳（被データ）'}),
    el('div', {class: 'grid g3'},
      concededZoneTable(D.oppStats),
      el('div', {class: 'center'},
        el('div', {class: 'sec-title center', text: 'GK セーブ / 失点'}),
        donut([
          {label: '失点', value: Math.max(0, gsh - sv), color: '#2ba3e0'},
          {label: 'セーブ', value: sv, color: '#16385c'},
        ], {centerTop: pct(sv, gsh), centerSub: 'セーブ率'}),
        legend([{label: '失点', color: '#2ba3e0'}, {label: 'セーブ', color: '#16385c'}])),
      el('div', {},
        el('div', {class: 'sec-title', text: '失点を許した相手選手'}),
        hbars(D.oppScorers.slice(0, 12), {valueKey: 'v', labelKey: 'label', color: CAT[4]})))));

  /* --- 相手の連携（どう崩されたか） --- */
  const opps = D.list.map(f => f.teams[oppOf(f, code)]);
  const cs = connectionSection(mergeConnections(opps), {
    title: '相手の連携 — どの形で崩されたか',
    subtitle: '対戦相手のアシスト連携を合計。矢印が太い経路ほど繰り返し失点している形。',
    tone: 'def',
    emptyNote: '相手のアシスト記録がありません。',
  });
  const az = assistedZoneTable(opps);
  if (az) {
    cs.append(el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: '失点位置ごとのアシスト率'}));
    cs.append(az);
    cs.append(el('div', {class: 'sub', style: {marginTop: '6px'},
      text: 'アシスト率が高い位置＝崩されて空いた失点、低い位置＝個人技や速攻で決められた失点。'}));
  }
  app.append(cs);

  /* --- 対戦相手別 --- */
  app.append(opponentCard(D));

  /* --- 自チームの守備貢献 --- */
  app.append(ownDefCard(D));

  /* --- 大会内ランキング --- */
  app.append(rankingCard());

  sectionNav(app);
}

const sumBy = (arr, k) => arr.reduce((a, b) => a + n(b[k]), 0);

function kpi(k, v, s) {
  return el('div', {class: 'kpi'}, el('div', {class: 'k', text: k}),
    el('div', {class: 'v', text: v}), el('div', {class: 's', text: s}));
}

const ZR = [['WING', 'ウイング'], ['6M', '6m'], ['9M', '9m'], ['BT', 'ブレイクスルー'],
  ['FB', '速攻'], ['EG', '無人ゴール'], ['7M', '7mスロー']];

function concededZoneTable(opp) {
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: '相手の攻撃（被・累計）'}), el('th', {text: '失点'}),
    el('th', {text: '被シュート'}), el('th', {text: '被決定率'}))));
  const tb = el('tbody', {});
  ZR.forEach(([k, label]) => {
    const g = n(opp[k + '_GOALS']), s = n(opp[k + '_SHOTS']);
    if (!g && !s) return;
    tb.append(el('tr', {}, el('td', {text: label}), el('td', {class: 'num', text: g}),
      el('td', {class: 'num', text: s}), el('td', {class: 'num', text: pct(g, s)})));
  });
  tb.append(el('tr', {class: 'total'}, el('td', {text: '合計'}),
    el('td', {class: 'num', text: n(opp.GOALS)}), el('td', {class: 'num', text: n(opp.SHOTS)}),
    el('td', {class: 'num', text: pct(opp.GOALS, opp.SHOTS)})));
  table.append(tb);
  return el('div', {class: 'tbl-scroll'}, table);
}

function opponentCard(D) {
  const rows = D.list.map(f => {
    const op = f.teams[oppOf(f, code)], me = f.teams[code];
    return {
      f, opp: oppOf(f, code),
      ga: n(op.score), shots: n(op.stats.SHOTS), goals: n(op.stats.GOALS),
      eff: n(op.stats.SHOTS) ? n(op.stats.GOALS) / n(op.stats.SHOTS) * 100 : 0,
      sv: n(me.stats.GK_SAVES), gsh: n(me.stats.GK_SHOTS),
      svp: n(me.stats.GK_SAVES_PERCENT),
      sevenM: `${n(op.stats['7M_GOALS'])}/${n(op.stats['7M_SHOTS'])}`,
      blocks: n(me.derived?.blocks), twoMin: n(me.derived?.twoMin),
      fb: n(op.stats.FB_GOALS), bt: n(op.stats.BT_GOALS),
    };
  });
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['対戦相手', '失点', '被シュート', '被決定率', 'GKセーブ', 'セーブ率', '被7m',
      '被速攻G', '被BT G', 'ブロック', '自2分'].map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  rows.forEach(r => tb.append(el('tr', {},
    el('td', {}, el('div', {class: 'row', style: {gap: '7px'}},
      el('span', {class: 'muted', style: {fontSize: '11px'}, text: jpDate(r.f.date)}),
      flagImg(r.opp, 'flag sm'),
      el('a', {href: `match.html?id=${r.f.id}`, text: r.opp}))),
    el('td', {class: 'num', style: {fontWeight: 700}, text: r.ga}),
    el('td', {class: 'num', text: r.shots}),
    el('td', {class: 'num', text: pct(r.goals, r.shots)}),
    el('td', {class: 'num', text: `${r.sv}/${r.gsh}`}),
    el('td', {class: 'num', text: r.svp + '%'}),
    el('td', {class: 'num', text: r.sevenM}),
    el('td', {class: 'num', text: r.fb || ''}),
    el('td', {class: 'num', text: r.bt || ''}),
    el('td', {class: 'num', text: r.blocks || ''}),
    el('td', {class: 'num', text: r.twoMin || ''}))));
  const tot = {
    ga: sumBy(rows, 'ga'), shots: sumBy(rows, 'shots'), goals: sumBy(rows, 'goals'),
    sv: sumBy(rows, 'sv'), gsh: sumBy(rows, 'gsh'), blocks: sumBy(rows, 'blocks'), twoMin: sumBy(rows, 'twoMin'),
  };
  tb.append(el('tr', {class: 'total'},
    el('td', {text: '合計'}), el('td', {class: 'num', text: tot.ga}),
    el('td', {class: 'num', text: tot.shots}), el('td', {class: 'num', text: pct(tot.goals, tot.shots)}),
    el('td', {class: 'num', text: `${tot.sv}/${tot.gsh}`}), el('td', {class: 'num', text: pct(tot.sv, tot.gsh)}),
    el('td', {}), el('td', {}), el('td', {}),
    el('td', {class: 'num', text: tot.blocks}), el('td', {class: 'num', text: tot.twoMin})));
  table.append(tb);

  const labels = D.list.map(f => `${jpDate(f.date)} ${oppOf(f, code)}`);
  return el('div', {class: 'card'},
    el('h2', {text: '対戦相手ごとの守備成績'}),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'grid g2', style: {marginTop: '14px'}},
      el('div', {},
        el('div', {class: 'sec-title', text: '失点・被シュート（本数）'}),
        lineChart([
          {label: '失点', color: CAT[4], values: rows.map(r => r.ga)},
          {label: '被シュート', color: CAT[1], values: rows.map(r => r.shots)},
        ], labels, {width: 560, height: 210}),
        legend([{label: '失点', color: CAT[4]}, {label: '被シュート', color: CAT[1]}])),
      el('div', {},
        el('div', {class: 'sec-title', text: '被決定率・セーブ率（%）'}),
        lineChart([
          {label: '被決定率', color: CAT[4], values: rows.map(r => Math.round(r.eff))},
          {label: 'セーブ率', color: CAT[3], values: rows.map(r => r.svp)},
        ], labels, {width: 560, height: 210}),
        legend([{label: '被決定率 %', color: CAT[4]}, {label: 'セーブ率 %', color: CAT[3]}]))));
}

function ownDefCard(D) {
  const ps = D.ownDef.filter(p => p.blocks || p.twoMin || p.gkShots || p.steals || p.sevenMConceded || p.time)
    .sort((a, b) => (b.blocks + b.steals) - (a.blocks + a.steals) || b.time - a.time);
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['#', '選手', 'Pos', '試合', '出場計', 'ブロック', 'スティール', '7m献上', '2分', 'セーブ', '被シュート', 'セーブ率']
      .map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  ps.forEach(p => tb.append(el('tr', {},
    el('td', {class: 'num muted', text: p.bib}),
    el('td', {text: p.name}),
    el('td', {text: shortRole(p.role)}),
    el('td', {class: 'num', text: p.games}),
    el('td', {class: 'num', text: fmtSec(p.time)}),
    el('td', {class: 'num', style: {fontWeight: p.blocks ? 700 : 400}, text: p.blocks || ''}),
    el('td', {class: 'num', text: p.steals || ''}),
    el('td', {class: 'num', text: p.sevenMConceded || ''}),
    el('td', {class: 'num', text: p.twoMin || ''}),
    el('td', {class: 'num', text: p.saves || ''}),
    el('td', {class: 'num', text: p.gkShots || ''}),
    el('td', {class: 'num', text: p.gkShots ? pct(p.saves, p.gkShots) : ''}))));
  table.append(tb);

  const bars = ps.filter(p => p.blocks || p.saves).map(p => ({
    label: `${p.bib} ${p.name}`, blocks: p.blocks, saves: p.saves, steals: p.steals,
  }));
  return el('div', {class: 'card'},
    el('h2', {text: '自チームの守備貢献'}),
    el('div', {class: 'tbl-scroll'}, table),
    bars.length ? el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: 'ブロック・セーブ・スティール'}) : null,
    bars.length ? stackedBars(bars, [
      {key: 'saves', label: 'GKセーブ', color: SERIES.saves},
      {key: 'blocks', label: 'ブロック', color: CAT[2]},
      {key: 'steals', label: 'スティール', color: CAT[5]},
    ]) : null,
    bars.length ? legend([{label: 'GKセーブ', color: SERIES.saves}, {label: 'ブロック', color: CAT[2]},
      {label: 'スティール', color: CAT[5]}]) : null);
}

/* 大会内の守備ランキング */
function rankingCard() {
  const rows = T.teams.filter(t => t.gender === gender).map(t => {
    const D = defAgg(t.code);
    if (!D.list.length) return null;
    const ga = D.list.reduce((a, f) => a + n(f.teams[oppOf(f, t.code)].score), 0);
    return {
      code: t.code, name: t.name, games: D.list.length,
      gaAvg: ga / D.list.length, ga,
      oppShots: n(D.oppStats.SHOTS), oppGoals: n(D.oppStats.GOALS),
      eff: n(D.oppStats.SHOTS) ? n(D.oppStats.GOALS) / n(D.oppStats.SHOTS) * 100 : 0,
      sv: n(D.ownStats.GK_SAVES), gsh: n(D.ownStats.GK_SHOTS),
      svp: n(D.ownStats.GK_SHOTS) ? n(D.ownStats.GK_SAVES) / n(D.ownStats.GK_SHOTS) * 100 : 0,
      blocks: sumBy(D.ownDef, 'blocks'),
    };
  }).filter(Boolean).sort((a, b) => a.gaAvg - b.gaAvg);

  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['#', 'チーム', '試合', '平均失点', '総失点', '被シュート', '被決定率', 'GKセーブ率', 'ブロック']
      .map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  rows.forEach((r, i) => tb.append(el('tr', {
    style: r.code === code ? {background: '#eaf4fc'} : null},
    el('td', {class: 'num muted', text: i + 1}),
    el('td', {}, el('div', {class: 'row', style: {gap: '7px'}}, flagImg(r.code, 'flag sm'),
      el('a', {href: `defense.html?team=${r.code}&g=${gender}`, text: r.name}))),
    el('td', {class: 'num', text: r.games}),
    el('td', {class: 'num', style: {fontWeight: 700}, text: r.gaAvg.toFixed(1)}),
    el('td', {class: 'num', text: r.ga}),
    el('td', {class: 'num', text: r.oppShots}),
    el('td', {class: 'num', text: r.eff.toFixed(0) + '%'}),
    el('td', {class: 'num', text: r.svp.toFixed(0) + '%'}),
    el('td', {class: 'num', text: r.blocks || ''}))));
  table.append(tb);

  return el('div', {class: 'card'},
    el('h2', {text: `大会内 守備ランキング（${gender === 'M' ? '男子' : '女子'}）`}),
    el('div', {class: 'sub', text: '平均失点が少ない順。行をクリックするとそのチームの守備分析に移動します。'}),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'grid g2', style: {marginTop: '16px'}},
      el('div', {}, el('div', {class: 'sec-title', text: '平均失点（少ない順）'}),
        hbars(rows.map(r => ({label: r.code + ' ' + r.name, v: +r.gaAvg.toFixed(1),
          color: r.code === code ? CAT[1] : CAT[0]})), {valueKey: 'v', labelKey: 'label'})),
      el('div', {}, el('div', {class: 'sec-title', text: 'GKセーブ率（高い順）'}),
        hbars(rows.slice().sort((a, b) => b.svp - a.svp).map(r => ({label: r.code + ' ' + r.name,
          v: +r.svp.toFixed(0), color: r.code === code ? CAT[1] : CAT[3]})),
        {valueKey: 'v', labelKey: 'label', fmtv: (v) => v + '%'}))));
}

function fmtSec(sec) {
  if (!sec || sec < 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
