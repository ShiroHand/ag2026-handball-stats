import {loadJSON, el, q, n, pct, jpDate, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, shortRole, CAT, SERIES, sectionNav} from './core.js';
import {donut, legend, courtMap, goalMap, stackedBars, lineChart, hbars} from './charts.js';
import {connectionSection, mergeConnections, assistedZoneTable} from './connections.js';

const app = q('#app');
let T = null, FILES = null, code = null, gender = params.get('g') || 'M';

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
      if (!players.has(key)) players.set(key, {...p, stats: {}, games: 0, shot: {}, gk: {}});
      const a = players.get(key);
      a.games++;
      Object.entries(p.stats).forEach(([k, v]) => {
        if (/PERCENT|EFFICIENCY/.test(k)) return;
        a.stats[k] = (a.stats[k] || 0) + n(v);
      });
      zoneAdd(a.shot, p.shot, ['g', 's']);
      zoneAdd(a.gk, p.gk, ['sv', 's', 'g']);
    });
  });
  return {stats, shot, gk, gkZone: gz, shotZone: sz, players: [...players.values()]};
}

function render() {
  app.innerHTML = '';
  const teams = T.teams.filter(t => t.gender === gender);
  const list = myMatches();
  const meta = T.teams.find(t => t.code === code) || {code, name: code};

  /* チーム選択 */
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
        code = first ? first.code : code; setParam('team', code); render();
      }, text: ev.gender === 'M' ? '男子' : '女子'})))));

  app.append(el('div', {class: 'card'},
    el('div', {class: 'row', style: {gap: '14px'}},
      flagImg(code, 'flag'),
      el('div', {},
        el('div', {style: {fontSize: '22px', fontWeight: 700, color: 'var(--navy)'}, text: meta.name}),
        el('div', {class: 'muted', style: {fontSize: '12px'},
          text: `${code}　/　${gender === 'M' ? '男子' : '女子'}　/　集計対象 ${list.length} 試合`})),
      el('div', {style: {flex: '1'}}),
      el('a', {class: 'btn ghost sm', href: `defense.html?team=${code}&g=${gender}`, text: 'このチームの守備分析 →'}))));

  if (!list.length) {
    app.append(el('div', {class: 'empty', text: 'まだ集計できる試合がありません。'}));
    return;
  }

  const A = agg(list);
  const gf = list.reduce((a, f) => a + n(f.teams[code].score), 0);
  const ga = list.reduce((a, f) => a + n(f.teams[oppOf(f)].score), 0);

  app.append(el('div', {class: 'grid g4'},
    kpi('平均得点', (gf / list.length).toFixed(1), `総得点 ${gf}`),
    kpi('平均失点', (ga / list.length).toFixed(1), `総失点 ${ga}`),
    kpi('シュート決定率', pct(A.stats.GOALS, A.stats.SHOTS), `${A.stats.GOALS || 0}/${A.stats.SHOTS || 0}`),
    kpi('GKセーブ率', pct(A.stats.GK_SAVES, A.stats.GK_SHOTS), `${A.stats.GK_SAVES || 0}/${A.stats.GK_SHOTS || 0}`)));

  /* 累積シュート */
  app.append(el('div', {class: 'card'},
    el('h2', {text: '累積シュートマップ（全試合）'}),
    el('div', {class: 'grid g3'},
      el('div', {}, el('div', {class: 'sec-title', text: '攻撃 — シュート位置'}), courtMap(A.shot)),
      el('div', {}, el('div', {class: 'sec-title', text: '攻撃 — ゴールマウス'}), goalMap(A.shotZone, {}, {width: 360}),
        el('div', {class: 'sec-title', style: {marginTop: '12px'}, text: '守備 — GKセーブ位置'}),
        goalMap((A.gkZone || []).map(r => r.map(c => ({g: c.sv, s: c.s}))), {}, {width: 360})),
      el('div', {}, el('div', {class: 'sec-title', text: '守備 — 被シュート位置'}),
        courtMap(Object.fromEntries(Object.entries(A.gk).map(([k, v]) => [k, {g: v.g, s: v.s}]))),
        el('div', {class: 'sub', text: '色は相手の決定率（濃い赤ほど失点が多い位置）'})))));

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
      el('td', {text: p.nameS || p.name}),
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
