import {loadJSON, el, q, n, pct, jpDate, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, photoImg, shortRole, tip, CAT, SERIES, sectionNav} from './core.js';
import {donut, legend, courtMap, goalMap, stackedBars, lineChart, hbars, zoneBreakdownTable} from './charts.js';
import {connectionSection, mergeConnections, assistedZoneTable} from './connections.js';
import {countsFromTeam, addCounts, emptyCounts, kpiGrid, KPI_NOTE} from './kpi.js';
import {selectedFromUrl, applyFilter, matchFilterCard} from './matchfilter.js';
import {mergeTransitions, transitionCard, fastPerMatchCard} from './transitions.js';
import {tempoCard, addTempo} from './tempo.js';
import {buildRef, gkSummary} from './gkstats.js';
import {costModel, buildContrib, groupMeans, groupLabel, ASSIST_SHARE} from './contrib.js';
import {buildZoneRef} from './gkstats.js';

const app = q('#app');
let T = null, FILES = null, code = null, gender = params.get('g') || 'M';
let picked = selectedFromUrl();   // 対象試合の絞り込み（null = 全試合）

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('team', null); setError(app, e); return; }
  renderChrome('team', T);
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

function myMatches() {
  return FILES.filter(f => f.gender === gender && f.teams[code])
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

/* 集計 */
function agg(list) {
  const stats = {}, shot = {}, gk = {}, players = new Map();
  const zoneAdd = (target, map, keys) => {
    for (const [z, v] of Object.entries(map || {})) {
      target[z] = target[z] || Object.fromEntries(keys.map(k => [k, 0]));
      keys.forEach(k => target[z][k] += n(v[k]));
    }
  };
  let gz = null, sz = null;
  const zAdd = (acc, zones, keys) => {
    if (!zones) return acc;
    if (!acc) acc = zones.map(r => r.map(() => Object.fromEntries(keys.map(k => [k, 0]))));
    zones.forEach((r, i) => r.forEach((c, j) => keys.forEach(k => acc[i][j][k] += n(c[k]))));
    return acc;
  };
  list.forEach(f => {
    const t = f.teams[code];
    Object.entries(t.stats).forEach(([k, v]) => {
      if (/PERCENT|EFFICIENCY/.test(k)) return;
      stats[k] = (stats[k] || 0) + n(v);
    });
    zoneAdd(shot, t.shot, ['g', 's']);
    zoneAdd(gk, t.gk, ['sv', 's', 'g']);
    gz = zAdd(gz, t.gkZone, ['sv', 's', 'g']);
    sz = zAdd(sz, t.shotZone, ['g', 's']);
    t.players.forEach(p => {
      const key = p.bib + '|' + p.name;
      if (!players.has(key)) players.set(key, {...p, stats: {}, games: 0, shot: {}, gk: {}, tempo: null, tempoGK: null, tempoAssist: null, tempoSteal: null});
      const a = players.get(key);
      a.games++;
      if (!a.reg && p.reg) a.reg = p.reg;        // 登録番号（顔写真）は取れた試合のものを使う
      Object.entries(p.stats).forEach(([k, v]) => {
        if (/PERCENT|EFFICIENCY/.test(k)) return;
        a.stats[k] = (a.stats[k] || 0) + n(v);
      });
      zoneAdd(a.shot, p.shot, ['g', 's']);
      zoneAdd(a.gk, p.gk, ['sv', 's', 'g']);
      if (p.tempo) a.tempo = addTempo(a.tempo, p.tempo, false);
      if (p.tempoGK) a.tempoGK = addTempo(a.tempoGK, p.tempoGK, true);
      if (p.tempoAssist) a.tempoAssist = addTempo(a.tempoAssist, p.tempoAssist, false);
      if (p.tempoSteal) a.tempoSteal = addTempo(a.tempoSteal, p.tempoSteal, false);
    });
  });
  return {stats, shot, gk, gkZone: gz, shotZone: sz, players: [...players.values()]};
}

function render() {
  app.innerHTML = '';
  const teams = T.teams.filter(t => t.gender === gender);
  const allMatches = myMatches();
  const list = applyFilter(allMatches, picked);
  const meta = T.teams.find(t => t.code === code) || {code, name: code};

  /* チーム選択 */
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
        code = first ? first.code : code; setParam('team', code); render();
      }, text: ev.gender === 'M' ? '男子' : '女子'})))));

  app.append(el('div', {class: 'card'},
    el('div', {class: 'row', style: {gap: '14px'}},
      flagImg(code, 'flag'),
      el('div', {},
        el('div', {style: {fontSize: '22px', fontWeight: 700, color: 'var(--navy)'}, text: meta.name}),
        el('div', {class: 'muted', style: {fontSize: '12px'},
          text: `${code}　/　${gender === 'M' ? '男子' : '女子'}　/　集計対象 ${list.length} 試合` + (allMatches.length !== list.length ? `（全${allMatches.length}試合中）` : '')})),
      el('div', {style: {flex: '1'}}),
      el('a', {class: 'btn ghost sm', href: `defense.html?team=${code}&g=${gender}`, text: 'このチームの守備分析 →'}))));

  if (!allMatches.length) {
    app.append(el('div', {class: 'empty', text: 'まだ集計できる試合がありません。'}));
    return;
  }
  if (allMatches.length > 1) {
    app.append(matchFilterCard(allMatches, picked, (f) => oppOf(f), (next) => {
      picked = next; render(); scrollTo({top: 0});
    }));
  }

  const A = agg(list);
  const gf = list.reduce((a, f) => a + n(f.teams[code].score), 0);
  const ga = list.reduce((a, f) => a + n(f.teams[oppOf(f)].score), 0);

  app.append(el('div', {class: 'grid g4'},
    kpi('平均得点', (gf / list.length).toFixed(1), `総得点 ${gf}`),
    kpi('平均失点', (ga / list.length).toFixed(1), `総失点 ${ga}`),
    kpi('シュート決定率', pct(A.stats.GOALS, A.stats.SHOTS), `${A.stats.GOALS || 0}/${A.stats.SHOTS || 0}`),
    kpi('GKセーブ率', pct(A.stats.GK_SAVES, A.stats.GK_SHOTS), `${A.stats.GK_SAVES || 0}/${A.stats.GK_SHOTS || 0}`)));

  /* 攻撃のKPI（全試合の累計） */
  const own = list.reduce((acc, f) => addCounts(acc, countsFromTeam(f.teams[code])), emptyCounts());
  const foe = list.reduce((acc, f) => addCounts(acc, countsFromTeam(f.teams[oppOf(f)])), emptyCounts());
  /* 守備側の位置別は相手のシュートマップを合計する。
     GKスタッツ由来のマップは集計キーの重複で過大になるため使わない
     （守備分析ページと同じ作り方に揃えている）。 */
  const oppShot = {};
  list.forEach(f => {
    const sm = f.teams[oppOf(f)].shot || {};
    for (const [z, v] of Object.entries(sm)) {
      oppShot[z] = oppShot[z] || {g: 0, s: 0};
      oppShot[z].g += n(v.g); oppShot[z].s += n(v.s);
    }
  });
  app.append(el('div', {class: 'card'},
    el('h2', {text: `攻撃のKPI — ${list.length}試合の累計`}),
    el('div', {class: 'sub', text: KPI_NOTE}),
    kpiGrid(own, 'att', foe),
    el('div', {class: 'sub', style: {marginTop: '10px'},
      text: `1試合あたり: 攻撃 ${(own.attacks / list.length).toFixed(1)} 回 / 得点 ${(own.goals / list.length).toFixed(1)} / シュート ${(own.shots / list.length).toFixed(1)} / ターンオーバー ${(own.turnovers / list.length).toFixed(1)}`})));

  app.append(transitionCard(mergeTransitions(list, code),
    {title: `攻守の切り替え — ${list.length}試合の累計`,
      attacks: own.attacks, defAttacks: foe.attacks}));

  app.append(fastPerMatchCard(list, code, {title: '試合ごとの速攻 — 得点・失点の内訳'}) || el('span'));

  /* 累積シュート */
  app.append(el('div', {class: 'card'},
    el('h2', {text: '累積シュートマップ（全試合）'}),
    el('div', {class: 'grid g3'},
      el('div', {}, el('div', {class: 'sec-title', text: '攻撃 — シュート位置'}),
        courtMap(A.shot, {attacks: own.attacks, perLabel: '得点'})),
      el('div', {}, el('div', {class: 'sec-title', text: '攻撃 — ゴールマウス'}), goalMap(A.shotZone, {}, {width: 360}),
        el('div', {class: 'sec-title', style: {marginTop: '12px'}, text: '守備 — GKセーブ位置'}),
        goalMap((A.gkZone || []).map(r => r.map(c => ({g: c.sv, s: c.s}))), {}, {width: 360})),
      el('div', {}, el('div', {class: 'sec-title', text: '守備 — 被シュート位置'}),
        courtMap(oppShot, {attacks: foe.attacks, perLabel: '失点'}),
        el('div', {class: 'sub', text: '色は相手の決定率（濃い赤ほど失点が多い位置）'}))),
    el('div', {class: 'grid g2', style: {marginTop: '14px'}},
      el('div', {}, el('div', {class: 'sec-title', text: '攻撃 — 位置別の内訳'}),
        zoneBreakdownTable(A.shot, {attacks: own.attacks, perLabel: '得点'})),
      el('div', {}, el('div', {class: 'sec-title', text: '守備 — 位置別の失点内訳'}),
        zoneBreakdownTable(oppShot, {attacks: foe.attacks, perLabel: '失点', shotLabel: '被シュート'})))));

  /* 攻撃内訳 + ドーナツ */
  app.append(el('div', {class: 'card'},
    el('h2', {text: '攻撃内訳・GK'}),
    el('div', {class: 'grid g3'},
      zoneTable(A.stats),
      el('div', {class: 'center'},
        el('div', {class: 'sec-title center', text: 'ゴール / 失敗シュート'}),
        donut([
          {label: 'ゴール', value: n(A.stats.GOALS), color: '#1f9d6b'},
          {label: '失敗', value: Math.max(0, n(A.stats.SHOTS) - n(A.stats.GOALS)), color: '#2ba3e0'},
        ], {centerTop: pct(A.stats.GOALS, A.stats.SHOTS), centerSub: '決定率'}),
        legend([{label: 'ゴール', color: '#1f9d6b'}, {label: '失敗シュート', color: '#2ba3e0'}])),
      el('div', {class: 'center'},
        el('div', {class: 'sec-title center', text: 'GK セーブ / 失点'}),
        donut([
          {label: '失点', value: Math.max(0, n(A.stats.GK_SHOTS) - n(A.stats.GK_SAVES)), color: '#2ba3e0'},
          {label: 'セーブ', value: n(A.stats.GK_SAVES), color: '#16385c'},
        ], {centerTop: pct(A.stats.GK_SAVES, A.stats.GK_SHOTS), centerSub: 'セーブ率'}),
        legend([{label: '失点', color: '#2ba3e0'}, {label: 'セーブ', color: '#16385c'}])))));

  /* 連携（アシスト） */
  const mine = list.map(f => f.teams[code]);
  const cs = connectionSection(mergeConnections(mine), {
    title: '連携（アシスト）— 全試合累計',
    subtitle: 'どの選手からどの選手へ、どのポジション間で得点が生まれているか',
  });
  const az = assistedZoneTable(mine);
  if (az) {
    cs.append(el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: '得点位置ごとのアシスト率'}));
    cs.append(az);
    cs.append(el('div', {class: 'sub', style: {marginTop: '6px'},
      text: 'アシスト率が低い位置は個人技・速攻など単独で完結している得点が多いことを示します。'}));
  }
  app.append(cs);

  /* 試合別推移 */
  app.append(developmentCard(list));

  /* 選手累計 */
  app.append(playersCard(A, list.length));
  app.append(tempoCard(A.players, {title: `選手別 攻撃の速さ（${list.length} 試合の累計）`}));
  app.append(gaeCard(list, A));
  app.append(contribCard(list));

  sectionNav(app);
}

function oppOf(f) { return f.home === code ? f.away : f.home; }

function kpi(k, v, s) {
  return el('div', {class: 'kpi'}, el('div', {class: 'k', text: k}),
    el('div', {class: 'v', text: v}), el('div', {class: 's', text: s}));
}

const ZR = [['WING', 'ウイング'], ['6M', '6m'], ['9M', '9m'], ['BT', 'ブレイクスルー'],
  ['FB', '速攻'], ['EG', '無人ゴール'], ['7M', '7mスロー']];

function zoneTable(stats) {
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: '攻撃内訳（累計）'}), el('th', {text: 'ゴール'}), el('th', {text: 'シュート'}), el('th', {text: '決定率'}))));
  const tb = el('tbody', {});
  ZR.forEach(([k, label]) => {
    const g = n(stats[k + '_GOALS']), s = n(stats[k + '_SHOTS']);
    if (!g && !s) return;
    tb.append(el('tr', {}, el('td', {text: label}), el('td', {class: 'num', text: g}),
      el('td', {class: 'num', text: s}), el('td', {class: 'num', text: pct(g, s)})));
  });
  tb.append(el('tr', {class: 'total'}, el('td', {text: '合計'}),
    el('td', {class: 'num', text: n(stats.GOALS)}), el('td', {class: 'num', text: n(stats.SHOTS)}),
    el('td', {class: 'num', text: pct(stats.GOALS, stats.SHOTS)})));
  table.append(tb);
  return el('div', {class: 'tbl-scroll'}, table);
}

function developmentCard(list) {
  const labels = list.map(f => `${f.date.slice(5)} vs ${oppOf(f)}`);
  const rows = [
    ['得点', f => n(f.teams[code].score)],
    ['失点', f => n(f.teams[oppOf(f)].score)],
    ['シュート', f => n(f.teams[code].stats.SHOTS)],
    ['決定率 %', f => n(f.teams[code].stats.EFFICIENCY)],
    ['GKセーブ', f => n(f.teams[code].stats.GK_SAVES)],
    ['セーブ率 %', f => n(f.teams[code].stats.GK_SAVES_PERCENT)],
    ['7m', f => `${n(f.teams[code].stats['7M_GOALS'])}/${n(f.teams[code].stats['7M_SHOTS'])}`],
    ['2分間退場', f => n(f.teams[code].derived?.twoMin)],
  ];
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {}, el('th', {text: '試合別推移'}),
    list.map(f => el('th', {text: `${jpDate(f.date)} ${oppOf(f)}`})))));
  const tb = el('tbody', {});
  rows.forEach(([label, fn]) => tb.append(el('tr', {},
    el('td', {text: label}), list.map(f => el('td', {class: 'num', text: fn(f)})))));
  table.append(tb);

  return el('div', {class: 'card'},
    el('h2', {text: '試合別の推移'}),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {style: {marginTop: '14px'}},
      lineChart([
        {label: '得点', color: CAT[0], values: list.map(f => n(f.teams[code].score))},
        {label: '失点', color: CAT[4], values: list.map(f => n(f.teams[oppOf(f)].score))},
      ], labels, {width: 900, height: 220})),
    legend([{label: '得点', color: CAT[0]}, {label: '失点', color: CAT[4]}]));
}

function playersCard(A, games) {
  const ps = A.players.slice().sort((a, b) => n(b.stats.GOALS) - n(a.stats.GOALS) || n(b.stats.TIME_PLAYED) - n(a.stats.TIME_PLAYED));
  const table = el('table', {});
  const head = ['#', '選手', 'Pos', '試合', '出場計', '得点', '平均', 'シュート', '決定率',
    'アシスト', 'ブロック', '2分', 'セーブ', '被シュート', 'セーブ率'];
  table.append(el('thead', {}, el('tr', {}, head.map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  ps.forEach(p => {
    const st = p.stats, g = n(st.GOALS), s = n(st.SHOTS), sv = n(st.GK_SAVES), gs = n(st.GK_SHOTS);
    tb.append(el('tr', {},
      el('td', {class: 'num muted', text: p.bib}),
      el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
        photoImg(p.reg, p.nameS || p.name, 'photo sm'),
        el('span', {text: p.nameS || p.name}))),
      el('td', {text: shortRole(p.role)}),
      el('td', {class: 'num', text: p.games}),
      el('td', {class: 'num', text: fmtSec(n(st.TIME_PLAYED))}),
      el('td', {class: 'num', style: {fontWeight: g ? 700 : 400}, text: g || ''}),
      el('td', {class: 'num', text: g ? (g / p.games).toFixed(1) : ''}),
      el('td', {class: 'num', text: s || ''}),
      el('td', {class: 'num', text: s ? pct(g, s) : ''}),
      el('td', {class: 'num', text: n(st.ASSISTS) || ''}),
      el('td', {class: 'num', text: n(st.BLOCKS) || ''}),
      el('td', {class: 'num', text: n(st['2MINUTES']) || ''}),
      el('td', {class: 'num', text: sv || ''}),
      el('td', {class: 'num', text: gs || ''}),
      el('td', {class: 'num', text: gs ? pct(sv, gs) : ''})));
  });
  table.append(tb);

  const bars = ps.filter(p => n(p.stats.SHOTS) || n(p.stats.GK_SHOTS)).map(p => ({
    label: `${p.bib} ${p.nameS}`,
    goals: n(p.stats.GOALS),
    failed: Math.max(0, n(p.stats.SHOTS) - n(p.stats.GOALS)),
    saves: n(p.stats.GK_SAVES),
  }));

  return el('div', {class: 'card'},
    el('h2', {text: `選手 累計スタッツ（${games} 試合）`}),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '選手別 内訳'}),
    stackedBars(bars, [
      {key: 'goals', label: 'ゴール', color: SERIES.goals},
      {key: 'failed', label: '失敗シュート', color: SERIES.failed},
      {key: 'saves', label: 'GKセーブ', color: SERIES.saves},
    ]),
    legend([{label: 'ゴール', color: SERIES.goals}, {label: '失敗シュート', color: SERIES.failed},
      {label: 'GKセーブ', color: SERIES.saves}]));
}

function fmtSec(sec) {
  if (!sec || sec < 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}


/* ---------- 期待得点との差（選手版） ----------
   GK分析で使っている「位置×コース別の大会平均決定率」を撃った側に当てる。
   決定率が高いのは簡単な位置から打っているからなのか、本当に上手いのかを切り分ける。
   基準にはその選手自身のぶんを除いた平均を使う（leave-one-out）。 */
function gaeCard(list, A) {
  /* 参照表は同じカテゴリの全試合から作る（対象試合だけだと薄くなるため） */
  const all = [];
  FILES.filter(f => f.gender === gender).forEach(f => {
    for (const c of Object.keys(f.teams)) all.push(...(f.teams[c].shots || []));
  });
  const ref = buildRef(all);
  const zref = buildZoneRef(all);

  const byBib = new Map();
  list.forEach(f => {
    const t = f.teams[code]; if (!t) return;
    for (const sh of t.shots || []) {
      const cur = byBib.get(sh.bib) || {bib: sh.bib, name: sh.name, role: sh.role, shots: []};
      cur.shots.push(sh);
      byBib.set(sh.bib, cur);
    }
  });
  const regOf = {};
  (A.players || []).forEach(p => { if (p.reg) regOf[p.bib] = p.reg; });

  const rows = [...byBib.values()]
    .map(p => ({...p, sum: gkSummary(p.shots, ref)}))
    .filter(p => p.sum.xn >= 5)
    .map(p => {
      /* 位置基準（枠外込み）。自分のぶんは基準から抜く */
      const own = {};
      p.shots.forEach(s => {
        if (!s.zone) return;
        const o = own[s.zone] = own[s.zone] || {n: 0, g: 0};
        o.n++; if (s.result === 'GOAL') o.g++;
      });
      let xgZ = 0, nZ = 0, goals = 0, off = 0;
      p.shots.forEach(s => {
        if (!s.zone) return;
        xgZ += zref.expect(s.zone, own[s.zone]); nZ++;
        if (s.result === 'GOAL') goals++;
        if (!['GOAL', 'SAVE'].includes(s.result)) off++;
      });
      return {...p, gae: p.sum.xgoals - p.sum.xg, gaeZ: goals - xgZ, xgZ, nZ, goalsAll: goals, off};
    })
    .sort((a, b) => b.gaeZ - a.gaeZ);

  if (!rows.length) {
    return el('div', {class: 'card'},
      el('h2', {text: '選手別 期待得点との差'}),
      el('div', {class: 'sub', text: 'コースが記録されたシュートが5本以上の選手がいません。'}));
  }

  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['#', '選手', 'Pos', 'シュート', '枠内', '枠外・ブロック', '得点', '決定率',
      '位置基準の期待得点', '差（位置基準）', 'コース基準の期待得点', '差（コース基準）']
      .map((h, i) => el('th', {class: i < 3 ? '' : 'num', text: h})))));
  const tb = el('tbody', {});
  let tXg = 0, tG = 0, tN = 0, tXz = 0, tGz = 0, tNz = 0;
  const diffTd = (v, note) => {
    const td = el('td', {class: 'num', style: {fontWeight: 700,
      color: v > 0.05 ? 'var(--good)' : (v < -0.05 ? 'var(--bad)' : '')},
      text: (v > 0 ? '+' : '') + v.toFixed(1)});
    tip(td, note);
    return td;
  };
  rows.forEach(p => {
    const s = p.sum;
    tXg += s.xg; tG += s.xgoals; tN += s.xn;
    tXz += p.xgZ; tGz += p.goalsAll; tNz += p.nZ;
    tb.append(el('tr', {},
      el('td', {class: 'num muted', text: p.bib}),
      el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
        photoImg(regOf[p.bib], p.name, 'photo sm'), el('span', {text: p.name}))),
      el('td', {text: shortRole(p.role)}),
      el('td', {class: 'num', text: s.n}),
      el('td', {class: 'num', text: s.onTarget}),
      el('td', {class: 'num', text: p.off || ''}),
      el('td', {class: 'num', text: p.goalsAll}),
      el('td', {class: 'num', text: s.n ? pct(p.goalsAll, s.n) : ''}),
      el('td', {class: 'num muted', text: p.xgZ.toFixed(1)}),
      diffTd(p.gaeZ, `全シュート ${p.nZ} 本が対象（枠外・ブロック込み）<br>`
        + `期待得点 ${p.xgZ.toFixed(1)} / 実際の得点 ${p.goalsAll}`),
      el('td', {class: 'num muted', text: s.xg.toFixed(1)}),
      diffTd(p.gae, `コースが記録されている ${s.xn} 本が対象（枠内のみ）<br>`
        + `期待得点 ${s.xg.toFixed(1)} / 実際の得点 ${s.xgoals}`)));
  });
  tb.append(el('tr', {class: 'total'},
    el('td', {}), el('td', {text: '合計'}), el('td', {}), el('td', {}), el('td', {}), el('td', {}),
    el('td', {class: 'num', text: tGz}), el('td', {}),
    el('td', {class: 'num', text: tXz.toFixed(1)}),
    el('td', {class: 'num', text: ((tGz - tXz) > 0 ? '+' : '') + (tGz - tXz).toFixed(1)}),
    el('td', {class: 'num', text: tXg.toFixed(1)}),
    el('td', {class: 'num', text: ((tG - tXg) > 0 ? '+' : '') + (tG - tXg).toFixed(1)})));
  table.append(tb);

  return el('div', {class: 'card'},
    el('h2', {text: '選手別 期待得点との差'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: '「大会平均の選手が同じシュートを打ったら何点入るか」と実際の得点を比べたものです。'
        + '決定率が高いのは簡単な位置から打っているからなのか、本当に上手いのかを切り分けられます。'
        + '基準は2種類あります。位置基準は全シュートが対象で、枠を外したぶんも罰せられます。'
        + 'コース基準は枠内に飛んだシュートだけが対象で、同じコースに飛ばしたときに'
        + '平均より入ったか、つまりGKとの勝負だけを見ます。'
        + '2つの差が大きい選手は、枠に飛ばす技術と決め切る技術のどちらかに偏りがあります。'
        + 'どちらも基準にはその選手自身のぶんを除いた平均を使っています。'}),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'sub', style: {marginTop: '8px'},
      text: `コースが記録されたシュートが5本以上の選手のみ。位置基準の対象 ${tNz} 本、`
        + `コース基準の対象 ${tN} 本。`
        + '本数が少ない選手の差は大きく振れます。並べ替えは位置基準で行っています。'}));
}


/* ---------- 攻撃の貢献度（得点換算） ----------
   フィニッシュ（期待得点との差）・ミス・2分退場を同じ「点」に換算して足す。
   換算レートは大会データから推定する（contrib.js）。
   アシストは公式の定義上ほぼ得点にしか記録されないため点に換算できないので、
   合算せず別列で並記する。守備はほとんど記録が無いので、これは総合評価ではない。 */
function contribCard(list) {
  const sameCat = FILES.filter(f => f.gender === gender);
  const cost = costModel(sameCat);
  const poolAll = buildContrib(sameCat, sameCat, cost);   // 平均の基準はカテゴリ全体
  const means = groupMeans(poolAll);
  /* 表示条件は groupMeans の母集団と必ず同じにする。
     ずれていると「6本しか打っていない選手を、10本以上の選手だけで作った平均」と
     比べることになり、出場時間の短い選手ほど60分あたりの値が振れて誤読を招く。 */
  const MIN_SHOTS = 10, MIN_MIN = 40;
  const mine = buildContrib(list, sameCat, cost)
    .filter(r => r.code === code && r.shots >= MIN_SHOTS && r.min >= MIN_MIN);

  if (!mine.length) {
    return el('div', {class: 'card'},
      el('h2', {text: '攻撃の貢献度（得点換算）'}),
      el('div', {class: 'sub', text: '対象になる選手がいません（シュート10本以上・出場40分以上）。'}));
  }
  mine.forEach(r => {
    const m = means[r.group];
    r.adj = m ? r.per60 - m.mean : null;
  });
  mine.sort((a, b) => (b.adj ?? -99) - (a.adj ?? -99));

  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['#', '選手', 'Pos', '出場', 'シュート', '得点', 'フィニッシュ', '（参考）コース基準',
      'アシスト', 'ミス', '退場', '合計', '60分あたり', '同ポジ平均との差']
      .map((h, i) => el('th', {class: i < 3 ? '' : 'num', text: h})))));
  const tb = el('tbody', {});
  mine.forEach(r => {
    const fin = el('td', {class: 'num', style: {fontWeight: 600,
      color: r.gae > 0.05 ? 'var(--good)' : (r.gae < -0.05 ? 'var(--bad)' : '')},
      text: (r.gae > 0 ? '+' : '') + r.gae.toFixed(1)});
    tip(fin, `位置基準（枠外込み）。全シュート ${r.nZ} 本が対象<br>`
      + `期待得点 ${r.xgZ.toFixed(1)} / 実際の得点 ${r.goals}`);
    const finC = el('td', {class: 'num muted',
      text: (r.gaeCourse > 0 ? '+' : '') + r.gaeCourse.toFixed(1)});
    tip(finC, `コース基準（枠内のみ）。${r.xn} 本が対象<br>`
      + `期待得点 ${r.xg.toFixed(1)} / 実際の得点 ${r.xgoals}<br>`
      + '合計には使っていません');
    const asTd = el('td', {class: 'num', style: {fontWeight: 600,
      color: r.astVal > 0.05 ? 'var(--good)' : ''},
      text: r.astN ? `${r.astN}（+${r.astVal.toFixed(1)}）` : '0'});
    if (r.astN) {
      tip(asTd, `アシスト ${r.astN} 本 × 1本あたり ${r.astPer.toFixed(2)}点 × ${ASSIST_SHARE} = +${r.astVal.toFixed(1)}点<br>`
        + `1本あたりの値は、パスが届いた位置の期待得点（平均 ${r.astPer.toFixed(2)}）から決まります<br>`
        + (r.astLinked < r.astN
          ? `うち ${r.astLinked} 本はプレーバイプレーでシュートに結びつきました。残りは本人の平均で補っています`
          : 'すべてプレーバイプレーでシュートに結びついています'));
    }
    const toTd = el('td', {class: 'num', text: r.to ? `${r.to}（${r.toLoss.toFixed(1)}）` : '0'});
    tip(toTd, `ミス ${r.to} 回 × ${cost.toCost.toFixed(2)}点 = ${r.toLoss.toFixed(1)}点`);
    const spTd = el('td', {class: 'num', text: r.susp ? `${r.susp}（${r.spLoss.toFixed(1)}）` : '0'});
    if (r.susp) tip(spTd, `2分退場 ${r.susp} 回 × ${cost.suspCost.toFixed(2)}点 = ${r.spLoss.toFixed(1)}点`);
    const adj = el('td', {class: 'num', style: {fontWeight: 700,
      color: r.adj > 0 ? 'var(--good)' : (r.adj < 0 ? 'var(--bad)' : '')},
      text: r.adj === null ? '·' : (r.adj > 0 ? '+' : '') + r.adj.toFixed(2)});
    if (r.adj !== null) {
      tip(adj, `${groupLabel(r.group)}の平均 ${means[r.group].mean.toFixed(2)}（${means[r.group].n}人）<br>`
        + `この選手 ${r.per60.toFixed(2)}<br>誤差 ±${(r.se / r.min * 60).toFixed(2)}（60分あたり）`);
    }
    const tot = el('td', {class: 'num', text: (r.total > 0 ? '+' : '') + r.total.toFixed(1)});
    tip(tot, `フィニッシュ（位置基準）${r.gae.toFixed(1)} / アシスト +${r.astVal.toFixed(1)} / ミス ${r.toLoss.toFixed(1)} / 退場 ${r.spLoss.toFixed(1)}<br>`
      + `誤差 ±${r.se.toFixed(1)}点`);
    tb.append(el('tr', {},
      el('td', {class: 'num muted', text: r.bib}),
      el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
        photoImg(r.reg, r.name, 'photo sm'), el('span', {text: r.name}))),
      el('td', {text: shortRole(r.role)}),
      el('td', {class: 'num', text: Math.round(r.min)}),
      el('td', {class: 'num', text: r.shots}),
      el('td', {class: 'num', text: r.goals}),
      fin, finC, asTd, toTd, spTd, tot,
      el('td', {class: 'num muted', text: r.per60.toFixed(2)}),
      adj));
  });
  table.append(tb);

  const rate = (v) => (v * 100).toFixed(0) + '%';
  return el('div', {class: 'card'},
    el('h2', {text: '攻撃の貢献度（得点換算）'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'フィニッシュ・アシスト・ミス・2分退場を同じ「点」に換算して足したものです。'
        + 'バスケットボールの BPM やサッカーの VAEP と同じ考え方で、'
        + '換算レートは大会データから推定しています。'
        + 'フィニッシュは位置基準（枠外込み）を使います。'
        + 'ターンオーバーを課金しながら枠外シュートを0点にするのは筋が通らないためです。'
        + 'コース基準の値も参考として並べていますが、合計には入れていません。'}),
    el('div', {class: 'kpi-grid', style: {marginBottom: '12px'}},
      ck('攻撃1回の期待得点', cost.ev.toFixed(3) + '点', ''),
      ck('ミス1回の損', '−' + cost.toCost.toFixed(2) + '点', 'ミス直後は相手が ' + rate(cost.pTO) + ' 得点'),
      ck('2分退場1回の損', '−' + cost.suspCost.toFixed(2) + '点', `実測 ${cost.suspN} 回から`),
      ck('得点で終わった直後', rate(cost.pGoal), '相手の得点率（最も低い）')),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: 'この数字の読み方'}),
    el('div', {class: 'sub',
      text: '主指標は「同ポジ平均との差」です。素の合計で並べるとポジションで順位が決まってしまいます。'
        + `実測でも60分あたりの平均は ${Object.keys(means).filter(k => means[k])
          .map(k => `${groupLabel(k)} ${means[k].mean.toFixed(2)}`).join('・')} と差があり、`
        + 'ボールに触る回数の多いポジションほどミスが増えるためです。'}),
    el('div', {class: 'sub', style: {marginTop: '6px'},
      text: 'アシストは「作ったチャンスの価値」の一部として配っています。'
        + 'シューターに渡しているのは実得点と期待得点の差、つまりフィニッシュのぶんだけで、'
        + 'その位置に立てたこと自体の価値は誰にも配られていません。そこから払うので、'
        + 'アシストを足してもシューターの点は1点も減りません。'
        + `1本あたりはパスが届いた位置の期待得点の${ASSIST_SHARE}倍で、`
        + '速攻へのパス0.33点・ウイングへ0.28点・ポストへ0.25点・9mへの振り0.17点、平均0.27点です。'
        + 'バスケットボールの Win Shares が1本のシュートをパサーとシューターで折半するのと'
        + '同じ水準（得点の正味価値0.544点の半分）に合わせています。'}),
    el('div', {class: 'sub', style: {marginTop: '6px'},
      text: 'ただしこの0.27点は測定値ではなく取り決めです。'
        + 'このデータではアシストが付いたシュートの期待得点は0.654、付いていないシュートは0.639で、'
        + 'ほぼ差がありません。突破や7mという同じくらい価値の高い終わり方にアシストが付かないためで、'
        + '「アシストが良いチャンスを作った証拠」はデータからは出てきません。'}),
    el('div', {class: 'sub', style: {marginTop: '6px'},
      text: 'これは総合評価ではありません。ブロックとスティールは1選手あたり大会累計で'
        + '1.4回しか記録が無く、スクリーン・7mを獲得する動き・守備のポジショニングは'
        + '1つも入りません。守備の良い選手は不当に低く出ます。'}),
    el('div', {class: 'sub', style: {marginTop: '6px'},
      text: '対象はシュート10本以上・出場40分以上の選手です。'
        + '比較の基準になる同ポジション平均も同じ条件の選手から作っているので、'
        + '「少ない出場時間の選手が、たくさん出ている選手の平均と比べられる」ことは起きません。'}),
    el('div', {class: 'sub', style: {marginTop: '6px'},
      text: '誤差は数値にカーソルを合わせると出ます。大会を通して1人あたり±2点前後あるので、'
        + '近い値どうしを区別することはできません。上位と下位を見分ける用途に限ってください。'}));
}

function ck(label, value, sub) {
  return el('div', {class: 'kpi'},
    el('div', {class: 'k', text: label}),
    el('div', {class: 'v', text: String(value)}),
    sub ? el('div', {class: 's', text: sub}) : null);
}
