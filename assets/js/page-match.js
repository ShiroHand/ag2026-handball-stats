import {loadJSON, el, q, n, pct, jpDate, jpTime, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, POSITIONS, POS_LABEL, shortRole, CAT, SERIES, sectionNav} from './core.js';
import {donut, legend, compareRow, courtMap, goalMap, stackedBars, rampLegend, lineChart} from './charts.js';
import {connectionSection, mergeConnections} from './connections.js';

const app = q('#app');
let T = null, M = null, MAN = null;

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('match', null); setError(app, e); return; }
  renderChrome('match', T);
  renderFoot();
  const id = params.get('id') || (T.detailIds || []).slice(-1)[0];
  if (!id) { app.append(el('div', {class: 'empty', text: 'まだ集計済みの試合がありません。'})); return; }
  await open(id);
}

async function open(id) {
  setBusy(app);
  try {
    M = await loadJSON(`data/matches/${id}.json`);
    MAN = await loadJSON(`data/manual/${id}.json`, {optional: true});
  } catch (e) { setError(app, e); return; }
  setParam('id', id);
  render();
  scrollTo({top: 0});
}

/* ------------------------------------------------------------------ 補助 */
const S = (t, k) => n(t.stats[k]);
const zoneRows = [
  {k: 'WING', label: 'ウイング'},
  {k: '6M', label: '6m'},
  {k: '9M', label: '9m'},
  {k: 'BT', label: 'ブレイクスルー'},
  {k: 'FB', label: '速攻'},
  {k: 'EG', label: '無人ゴール'},
  {k: '7M', label: '7mスロー'},
];

function render() {
  app.innerHTML = '';
  const H = M.teams[M.home], A = M.teams[M.away];

  app.append(matchPicker());
  app.append(headerCard(H, A));
  app.append(compareCard(H, A));
  app.append(phaseCard(H, A));
  app.append(shootingCard(H, A));
  app.append(gkCard(H, A));
  app.append(timelineCard(H, A));
  [H, A].forEach(t => app.append(connectionSection(mergeConnections([t]), {
    title: `${t.name} — アシスト連携`,
    subtitle: 'この試合でどの選手・どのポジションから得点が生まれたか',
    emptyNote: 'この試合はアシストの記録がありません。',
  })));
  [H, A].forEach(t => app.append(playersCard(t)));
  if (MAN) app.append(manualCard());
  else app.append(el('div', {class: 'card'},
    el('h2', {text: '戦術・システム（手入力データ）'}),
    el('div', {class: 'notice'},
      `この試合の手入力データ（data/manual/${M.id}.json）はまだありません。`,
      el('br'), '「データ入力」画面から攻撃システム・連携・タイムラインなどを追加できます。')));

  sectionNav(app);
}

/* ------------------------------------------------------------------ 試合選択 */
function matchPicker() {
  const sel = el('select', {onchange: (e) => open(e.target.value)});
  const done = T.matches.filter(m => m.hasResult && (T.detailIds || []).includes(m.id) && m.gender === M.gender);
  done.forEach(m => sel.append(el('option', {
    value: m.id, selected: m.id === M.id ? 'selected' : null,
    text: `${m.date} ${m.home.code} ${m.home.score}-${m.away.score} ${m.away.code}（${m.phaseDesc.replace(/^(Men|Women)\s*/, '')}）`,
  })));
  const switchGender = (g) => {
    const first = T.matches.filter(m => m.hasResult && (T.detailIds || []).includes(m.id) && m.gender === g).slice(-1)[0];
    if (first) open(first.id);
  };
  return el('div', {class: 'row', style: {marginBottom: '14px', gap: '10px'}},
    el('div', {class: 'chips'}, T.events.map(ev => el('button', {
      class: 'chip' + (ev.gender === M.gender ? ' on' : ''),
      onclick: () => switchGender(ev.gender),
      text: ev.gender === 'M' ? '男子' : '女子'}))),
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: '試合を選択'}), sel,
    el('a', {class: 'btn ghost sm', href: `team.html?team=${M.home}&g=${M.gender}`, text: `${M.home} 攻撃`}),
    el('a', {class: 'btn ghost sm', href: `defense.html?team=${M.home}&g=${M.gender}`, text: `${M.home} 守備`}),
    el('a', {class: 'btn ghost sm', href: `team.html?team=${M.away}&g=${M.gender}`, text: `${M.away} 攻撃`}),
    el('a', {class: 'btn ghost sm', href: `defense.html?team=${M.away}&g=${M.gender}`, text: `${M.away} 守備`}));
}

/* ------------------------------------------------------------------ ヘッダ */
function headerCard(H, A) {
  const side = (t, away) => el('div', {class: 'mh-team' + (away ? ' away' : '')},
    flagImg(t.code, 'flag'),
    el('div', {class: 'mh-name'}, t.nameS || t.name, el('small', {text: t.code})));
  const halves = (H.halves || []).map((h, i) =>
    `${h.label}: ${h.value}–${A.halves?.[i]?.value ?? '–'}`).join('　/　');

  return el('div', {class: 'card'},
    el('div', {class: 'match-head'},
      side(H),
      el('div', {},
        el('div', {class: 'mh-score'}, String(H.score), el('span', {class: 'sep', text: '–'}), String(A.score)),
        el('div', {class: 'mh-meta', text: halves})),
      side(A, true)),
    el('hr', {class: 'soft'}),
    el('div', {class: 'row muted', style: {gap: '18px', fontSize: '12px'}},
      el('span', {text: `${jpDate(M.date)} ${jpTime(M.dateTime)}`}),
      el('span', {text: M.venue}),
      el('span', {text: M.phaseDesc}),
      el('span', {text: M.unitDesc}),
      el('span', {class: 'badge official', text: M.statusDesc || M.status}),
      M.officials.length ? el('span', {text: '審判: ' + M.officials.filter(o => /referee|delegate/i.test(o.func)).map(o => `${o.name}(${o.org})`).join(', ')}) : null));
}

/* ------------------------------------------------------------------ 比較 */
function compareCard(H, A) {
  const box = el('div', {class: 'card'}, el('h2', {text: 'チーム比較'}),
    el('div', {class: 'sub'}, `左 ${H.code}　/　右 ${A.code}　— 数値が優位な側を濃色で表示`));
  const rows = [
    ['得点', H.score, A.score],
    ['シュート', S(H, 'SHOTS'), S(A, 'SHOTS')],
    ['決定率 %', S(H, 'EFFICIENCY'), S(A, 'EFFICIENCY')],
    ['フィールドG', S(H, 'GOALS') - S(H, '7M_GOALS'), S(A, 'GOALS') - S(A, '7M_GOALS')],
    ['7m 成功', `${S(H, '7M_GOALS')}/${S(H, '7M_SHOTS')}`, `${S(A, '7M_GOALS')}/${S(A, '7M_SHOTS')}`],
    ['GKセーブ', S(H, 'GK_SAVES'), S(A, 'GK_SAVES')],
    ['セーブ率 %', S(H, 'GK_SAVES_PERCENT'), S(A, 'GK_SAVES_PERCENT')],
    ['アシスト', H.derived.assists, A.derived.assists],
    ['ブロック', H.derived.blocks, A.derived.blocks],
    ['2分間退場', H.derived.twoMin, A.derived.twoMin],
    ['攻撃回数', H.possessions?.attacks, A.possessions?.attacks],
    ['守備回数', A.possessions?.attacks, H.possessions?.attacks],
    ['攻撃効率 %', H.possessions?.eff, A.possessions?.eff],
    ['ターンオーバー', H.possessions?.turnovers, A.possessions?.turnovers],
    ['OFリバウンド', H.possessions?.offReb, A.possessions?.offReb],
    ['DFリバウンド', H.possessions?.defReb, A.possessions?.defReb],
  ];
  rows.forEach(([label, l, r]) => {
    if (String(l).includes('/')) {
      box.append(el('div', {class: 'cmp-row'},
        el('div', {class: 'cmp-val right num', text: l}), el('div', {}),
        el('div', {class: 'cmp-label', text: label}), el('div', {}),
        el('div', {class: 'cmp-val num', text: r})));
    } else {
      const lower = ['2分間退場', 'ターンオーバー', '守備回数'].includes(label);
      box.append(compareRow(label, l ?? 0, r ?? 0, {hi: lower ? 'low' : 'high'}));
    }
  });
  return box;
}

/* ------------------------------------------------------------------ 攻撃内訳 */
function phaseCard(H, A) {
  const tbl = (t) => {
    const table = el('table', {});
    table.append(el('thead', {}, el('tr', {},
      el('th', {text: t.code + ' 攻撃内訳'}), el('th', {text: 'ゴール'}),
      el('th', {text: 'シュート'}), el('th', {text: '決定率'}))));
    const tb = el('tbody', {});
    zoneRows.forEach(z => {
      const g = S(t, z.k + '_GOALS'), s = S(t, z.k + '_SHOTS');
      if (!s && !g) return;
      tb.append(el('tr', {}, el('td', {text: z.label}), el('td', {class: 'num', text: g}),
        el('td', {class: 'num', text: s}), el('td', {class: 'num', text: pct(g, s)})));
    });
    tb.append(el('tr', {class: 'total'}, el('td', {text: '合計'}),
      el('td', {class: 'num', text: S(t, 'GOALS')}), el('td', {class: 'num', text: S(t, 'SHOTS')}),
      el('td', {class: 'num', text: pct(S(t, 'GOALS'), S(t, 'SHOTS'))})));
    table.append(tb);
    return el('div', {class: 'tbl-scroll'}, table);
  };

  const dn = (t) => {
    const saves = S(t, 'GK_SAVES'), conceded = S(t, 'GK_GOALS') || (S(t, 'GK_SHOTS') - saves);
    return el('div', {class: 'center'},
      el('div', {class: 'sec-title center', text: `${t.code} GK セーブ / 失点`}),
      donut([
        {label: '失点', value: conceded, color: '#2ba3e0'},
        {label: 'セーブ', value: saves, color: '#16385c'},
      ], {centerTop: pct(saves, saves + conceded), centerSub: 'セーブ率'}),
      legend([{label: '失点', color: '#2ba3e0'}, {label: 'セーブ', color: '#16385c'}]));
  };

  return el('div', {class: 'card'},
    el('h2', {text: '攻撃内訳とGK'}),
    el('div', {class: 'grid g4'}, tbl(H), dn(H), tbl(A), dn(A)));
}

/* ------------------------------------------------------------------ シュートマップ */
function shootingCard(H, A) {
  const block = (t) => el('div', {},
    el('div', {class: 'sec-title', text: `${t.code} — シュート位置`}),
    courtMap(t.shot),
    el('div', {class: 'sec-title', style: {marginTop: '14px'}, text: `${t.code} — ゴールマウス（枠内コース別）`}),
    goalMap(t.shotZone, {}, {width: 420}),
    el('div', {class: 'sub', style: {marginTop: '6px'}, text: '公式記録にコースが残っているシュートのみ集計'}));
  return el('div', {class: 'card'},
    el('h2', {text: 'シュートマップ'}),
    el('div', {class: 'grid g2'}, block(H), block(A)));
}

/* ------------------------------------------------------------------ GK */
function gkCard(H, A) {
  const gkBlock = (t) => {
    const gks = t.players.filter(p => p.isGK && (n(p.stats.GK_SHOTS) || n(p.stats.GK_SAVES)));
    if (!gks.length) return el('div', {class: 'empty', text: `${t.code}: GK記録なし`});
    return el('div', {},
      el('div', {class: 'sec-title', text: `${t.code} ゴールキーパー`}),
      el('div', {class: 'grid g2'},
        gks.map(p => el('div', {},
          el('div', {class: 'row', style: {justifyContent: 'space-between', marginBottom: '6px'}},
            el('div', {style: {fontWeight: 700}}, `#${p.bib} ${p.nameS}`),
            el('div', {class: 'muted', style: {fontSize: '12px'},
              text: `${n(p.stats.GK_SAVES)}/${n(p.stats.GK_SHOTS)} セーブ（${n(p.stats.GK_SAVES_PERCENT)}%）`})),
          goalMap(p.gkZone.map(r => r.map(c => ({g: c.sv, s: c.s}))), {}, {width: 300}),
          el('div', {class: 'sub', style: {marginTop: '4px'}, text: 'セーブ数 / 被シュート数（コース別）'}),
          el('div', {class: 'mapbox', style: {marginTop: '8px'}},
            courtMap(Object.fromEntries(Object.entries(p.gk).map(([k, v]) => [k, {g: v.sv, s: v.s}])), {width: 300}))))));
  };
  return el('div', {class: 'card'}, el('h2', {text: 'GK パフォーマンス'}),
    el('div', {class: 'grid g2'}, gkBlock(H), gkBlock(A)));
}

/* ------------------------------------------------------------------ 選手 */
function playersCard(t) {
  const ps = t.players.slice().sort((a, b) =>
    n(b.stats.TIME_PLAYED) - n(a.stats.TIME_PLAYED) || n(b.stats.GOALS) - n(a.stats.GOALS));
  const table = el('table', {});
  const head = ['#', '選手', 'Pos', '出場', '得点', 'シュート', '決定率', 'アシスト', 'ブロック', '被ブロック',
    '2分', 'セーブ', '被シュート', 'セーブ率'];
  table.append(el('thead', {}, el('tr', {}, head.map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  const T0 = {g: 0, s: 0, a: 0, bl: 0, bd: 0, tm: 0, sv: 0, gs: 0};
  ps.forEach(p => {
    const st = p.stats;
    const g = n(st.GOALS), s = n(st.SHOTS), sv = n(st.GK_SAVES), gs = n(st.GK_SHOTS);
    T0.g += g; T0.s += s; T0.a += n(st.ASSISTS); T0.bl += n(st.BLOCKS);
    T0.bd += n(st.BLOCKED); T0.tm += n(st['2MINUTES']); T0.sv += sv; T0.gs += gs;
    tb.append(el('tr', {},
      el('td', {class: 'num muted', text: p.bib}),
      el('td', {}, el('div', {class: 'row', style: {gap: '6px'}},
        el('span', {text: p.nameS || p.name}), p.captain ? el('span', {class: 'tag', text: 'C'}) : null)),
      el('td', {text: shortRole(p.role)}),
      el('td', {class: 'num', text: p.time || fmtSec(n(st.TIME_PLAYED))}),
      el('td', {class: 'num', style: {fontWeight: g ? 700 : 400}, text: g || ''}),
      el('td', {class: 'num', text: s || ''}),
      el('td', {class: 'num', text: s ? pct(g, s) : ''}),
      el('td', {class: 'num', text: n(st.ASSISTS) || ''}),
      el('td', {class: 'num', text: n(st.BLOCKS) || ''}),
      el('td', {class: 'num', text: n(st.BLOCKED) || ''}),
      el('td', {class: 'num', text: n(st['2MINUTES']) || ''}),
      el('td', {class: 'num', text: sv || ''}),
      el('td', {class: 'num', text: gs || ''}),
      el('td', {class: 'num', text: gs ? pct(sv, gs) : ''})));
  });
  tb.append(el('tr', {class: 'total'},
    el('td', {}), el('td', {text: '合計'}), el('td', {}), el('td', {}),
    el('td', {class: 'num', text: T0.g}), el('td', {class: 'num', text: T0.s}),
    el('td', {class: 'num', text: pct(T0.g, T0.s)}), el('td', {class: 'num', text: T0.a}),
    el('td', {class: 'num', text: T0.bl}), el('td', {class: 'num', text: T0.bd}),
    el('td', {class: 'num', text: T0.tm}), el('td', {class: 'num', text: T0.sv}),
    el('td', {class: 'num', text: T0.gs}), el('td', {class: 'num', text: pct(T0.sv, T0.gs)})));
  table.append(tb);

  const bars = ps.filter(p => n(p.stats.SHOTS) || n(p.stats.GK_SHOTS)).map(p => ({
    label: `${p.bib} ${p.nameS}`,
    goals: n(p.stats.GOALS),
    failed: Math.max(0, n(p.stats.SHOTS) - n(p.stats.GOALS)),
    saves: n(p.stats.GK_SAVES),
    blocked: n(p.stats.BLOCKED),
  }));

  return el('div', {class: 'card'},
    el('div', {class: 'row', style: {gap: '10px', marginBottom: '8px'}},
      flagImg(t.code, 'flag sm'),
      el('h2', {style: {margin: 0}, text: `${t.name} — 選手スタッツ`})),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '選手別 内訳'}),
    stackedBars(bars, [
      {key: 'goals', label: 'ゴール', color: SERIES.goals},
      {key: 'failed', label: '失敗シュート', color: SERIES.failed},
      {key: 'saves', label: 'GKセーブ', color: SERIES.saves},
      {key: 'blocked', label: '被ブロック', color: SERIES.outs},
    ]),
    legend([
      {label: 'ゴール', color: SERIES.goals}, {label: '失敗シュート', color: SERIES.failed},
      {label: 'GKセーブ', color: SERIES.saves}, {label: '被ブロック', color: SERIES.outs}]));
}

function fmtSec(sec) {
  if (!sec || sec < 0) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ 手入力 */
function manualCard() {
  const box = el('div', {class: 'card'}, el('h2', {text: '戦術・システム（手入力データ）'}));
  if (MAN.note) box.append(el('div', {class: 'notice', text: MAN.note}));
  (MAN.teams || []).forEach(t => {
    box.append(el('div', {class: 'sec-title', style: {marginTop: '12px'}, text: `${t.code} — 攻撃システム`}));
    const table = el('table', {});
    table.append(el('thead', {}, el('tr', {},
      ['システム', '回数', 'ゴール', 'セーブ', 'ポスト/アウト', '7m獲得', 'ロスト', 'ゴール%']
        .map(h => el('th', {text: h})))));
    const tb = el('tbody', {});
    (t.systems || []).forEach(s => tb.append(el('tr', {},
      el('td', {text: s.name}), el('td', {class: 'num', text: s.times}),
      el('td', {class: 'num', text: s.goals}), el('td', {class: 'num', text: s.saves}),
      el('td', {class: 'num', text: s.postOut}), el('td', {class: 'num', text: s.sevenM}),
      el('td', {class: 'num', text: s.lost}),
      el('td', {class: 'num', text: pct(n(s.goals), n(s.times))}))));
    table.append(tb);
    box.append(el('div', {class: 'tbl-scroll'}, table));
    if (t.comment) box.append(el('div', {class: 'sub', style: {marginTop: '6px'}, text: t.comment}));
  });
  return box;
}


/* ------------------------------------------------------------------ 5分刻み時系列 */
const TL_METRICS = [
  {key: 'attacks', label: '攻撃回数'},
  {key: 'goals', label: '得点'},
  {key: 'shots', label: 'シュート'},
  {key: 'missed', label: 'ミス（不成功）'},
  {key: 'saves', label: 'GKセーブ'},
  {key: 'turnovers', label: 'ターンオーバー'},
  {key: 'assists', label: 'アシスト'},
  {key: 'offReb', label: 'OFリバウンド'},
  {key: 'defReb', label: 'DFリバウンド'},
  {key: 'twoMin', label: '2分間退場'},
];

function timelineCard(H, A) {
  const buckets = [...new Set([...(H.timeline || []), ...(A.timeline || [])].map(x => x.bucket))]
    .sort((a, b) => parseInt(a) - parseInt(b));
  if (!buckets.length) {
    return el('div', {class: 'card'}, el('h2', {text: '5分ごとの推移'}),
      el('div', {class: 'empty', text: 'プレーバイプレーが未取得のため表示できません。'}));
  }
  const val = (t, b, k) => n((t.timeline || []).find(x => x.bucket === b)?.[k]);
  const series = (t, k) => buckets.map(b => val(t, b, k));
  const cum = (arr) => arr.reduce((acc, v) => (acc.push((acc[acc.length - 1] || 0) + v), acc), []);

  /* 表: 指標ごとに 2 行（両チーム） */
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: '指標'}), el('th', {text: 'チーム'}),
    buckets.map(b => el('th', {text: b + '分'})), el('th', {text: '計'}))));
  const tb = el('tbody', {});
  TL_METRICS.forEach((m, i) => {
    [H, A].forEach((t, j) => {
      const vals = series(t, m.key);
      const tr = el('tr', {style: i % 2 ? {background: 'var(--surface-2)'} : null},
        j === 0 ? el('td', {rowspan: 2, style: {fontWeight: 700}, text: m.label}) : null,
        el('td', {style: {fontWeight: 600, color: j ? 'var(--ink-2)' : 'var(--navy)'}, text: t.code}),
        vals.map(v => el('td', {class: 'num', text: v || ''})),
        el('td', {class: 'num', style: {fontWeight: 700}, text: vals.reduce((a, b2) => a + b2, 0)}));
      tb.append(tr);
    });
  });
  table.append(tb);

  const chart = (key, label) => el('div', {},
    el('div', {class: 'sec-title', text: label}),
    lineChart([
      {label: H.code, color: CAT[0], values: series(H, key)},
      {label: A.code, color: CAT[4], values: series(A, key)},
    ], buckets, {width: 560, height: 200}),
    legend([{label: H.code, color: CAT[0]}, {label: A.code, color: CAT[4]}]));

  return el('div', {class: 'card'},
    el('h2', {text: '5分ごとの推移'}),
    el('div', {class: 'sub', text: '公式プレーバイプレーの時刻から5分区切りで集計。OFリバウンドは同一攻撃内の再シュート、DFリバウンドは相手のシュートをセーブ／ポストで回収した回数（推定）。'}),
    el('div', {class: 'grid g2'}, chart('goals', '得点'), chart('attacks', '攻撃回数')),
    el('div', {class: 'grid g2', style: {marginTop: '8px'}}, chart('shots', 'シュート'), chart('turnovers', 'ターンオーバー')),
    el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '5分ごとの数値'}),
    el('div', {class: 'tbl-scroll'}, table),
    el('div', {style: {marginTop: '16px'}},
      el('div', {class: 'sec-title', text: '累積得点の推移'}),
      lineChart([
        {label: H.code, color: CAT[0], values: cum(series(H, 'goals'))},
        {label: A.code, color: CAT[4], values: cum(series(A, 'goals'))},
      ], buckets, {width: 900, height: 220}),
      legend([{label: H.code, color: CAT[0]}, {label: A.code, color: CAT[4]}])));
}
