import {loadJSON, el, q, n, pct, jpDate, jpTime, renderChrome, renderFoot, setError,
        params, setParam, flagImg, CAT} from './core.js';
import {hbars} from './charts.js';

const app = q('#app');
let T = null;
let gender = params.get('g') || 'M';

init();

async function init() {
  try {
    T = await loadJSON('data/tournament.json');
  } catch (e) { renderChrome('index', null); setError(app, e); return; }
  renderChrome('index', T);
  renderFoot();
  render();
  buildRanking(gender).then(render).catch(() => {});
}

function matchesOf(g) { return T.matches.filter(m => m.gender === g); }

function render() {
  app.innerHTML = '';
  const ms = matchesOf(gender);
  const done = ms.filter(m => m.hasResult);

  /* ---- 見出し + 男女切替 ---- */
  app.append(el('div', {class: 'row', style: {justifyContent: 'space-between', marginBottom: '14px'}},
    el('div', {},
      el('h1', {style: {margin: '0 0 2px', fontSize: '20px', color: 'var(--navy)'}, text: T.name}),
      el('div', {class: 'muted', style: {fontSize: '12px'}, text: `${T.days[0]} 〜 ${T.days[T.days.length - 1]}`})),
    el('div', {class: 'chips'},
      ...T.events.map(ev => el('button', {
        class: 'chip' + (ev.gender === gender ? ' on' : ''),
        onclick: () => { gender = ev.gender; setParam('g', gender); render(); buildRanking(gender).then(render).catch(() => {}); },
        text: ev.gender === 'M' ? '男子' : '女子',
      })))));

  /* ---- KPI ---- */
  const goals = done.reduce((a, m) => a + n(m.home.score) + n(m.away.score), 0);
  app.append(el('div', {class: 'grid g4'},
    kpi('日程', `${ms.length}`, '試合'),
    kpi('実施済み', `${done.length}`, `残り ${ms.length - done.length} 試合`),
    kpi('平均総得点', done.length ? (goals / done.length).toFixed(1) : '–', '両チーム合計 / 試合'),
    kpi('参加チーム', `${T.teams.filter(t => t.gender === gender).length}`, gender === 'M' ? '男子' : '女子')));

  /* ---- 順位表 ---- */
  const st = T.standings.find(s => s.event.startsWith(gender));
  if (st && st.groups.length) {
    const card = el('div', {class: 'card'}, el('h2', {text: '順位表'}));
    const grid = el('div', {class: 'grid ' + (st.groups.length > 1 ? 'g2' : '')});
    st.groups.forEach(g => grid.append(standingsTable(g)));
    card.append(grid);
    app.append(card);
  }

  /* ---- 得点ランキング ---- */
  const scorers = topScorers(gender);
  if (scorers.length) {
    app.append(el('div', {class: 'card'},
      el('h2', {text: '得点ランキング（実施済み試合の累計）'}),
      el('div', {class: 'grid g2'},
        el('div', {}, el('div', {class: 'sub', text: '得点'}),
          hbars(scorers.slice(0, 12), {valueKey: 'v', labelKey: 'label', color: CAT[0]})),
        el('div', {}, el('div', {class: 'sub', text: 'GKセーブ数'}),
          hbars(topSavers(gender).slice(0, 12), {valueKey: 'v', labelKey: 'label', color: CAT[3]})))));
  }

  /* ---- 日程・結果 ---- */
  const card = el('div', {class: 'card'}, el('h2', {text: '日程・結果'}));
  const byDay = new Map();
  ms.forEach(m => { if (!byDay.has(m.date)) byDay.set(m.date, []); byDay.get(m.date).push(m); });
  [...byDay.entries()].forEach(([d, list]) => {
    card.append(el('div', {style: {margin: '14px 0 6px', fontWeight: 700, color: 'var(--navy)', fontSize: '13px'}},
      jpDate(d) + '　', el('span', {class: 'muted', style: {fontWeight: 400, fontSize: '12px'}, text: d})));
    list.forEach(m => card.append(matchRow(m)));
  });
  app.append(card);

  /* ---- チーム一覧 ---- */
  const teams = T.teams.filter(t => t.gender === gender);
  app.append(el('div', {class: 'card'},
    el('h2', {text: 'チーム別レポート'}),
    el('div', {class: 'grid g4'},
      teams.map(t => el('a', {class: 'kpi', href: `team.html?team=${t.code}&g=${t.gender}`,
        style: {display: 'block', textDecoration: 'none'}},
        el('div', {class: 'row', style: {gap: '8px'}}, flagImg(t.code, 'flag sm'),
          el('div', {class: 'v', style: {fontSize: '15px'}, text: t.code})),
        el('div', {class: 's', text: t.name}),
        el('div', {class: 'row', style: {gap: '8px', marginTop: '4px'}},
          el('span', {class: 'k', text: `実施 ${t.played} 試合`}),
          el('span', {class: 'tag', text: '攻撃'}),
          el('span', {class: 'tag', style: {cursor: 'pointer'},
            onclick: (e) => { e.preventDefault(); location.href = `defense.html?team=${t.code}&g=${t.gender}`; },
            text: '守備'})))))));
}

function kpi(k, v, s) {
  return el('div', {class: 'kpi'}, el('div', {class: 'k', text: k}),
    el('div', {class: 'v', text: v}), el('div', {class: 's', text: s}));
}

function standingsTable(g) {
  const t = el('table', {});
  t.append(el('thead', {}, el('tr', {},
    el('th', {text: g.desc}), el('th', {text: '試'}), el('th', {text: '勝'}),
    el('th', {text: '分'}), el('th', {text: '敗'}), el('th', {text: '得'}),
    el('th', {text: '失'}), el('th', {text: '差'}), el('th', {text: '点'}))));
  const tb = el('tbody', {});
  g.rows.forEach(r => tb.append(el('tr', {},
    el('td', {}, el('div', {class: 'row', style: {gap: '7px'}},
      el('span', {class: 'muted num', style: {width: '14px'}, text: r.rank}),
      flagImg(r.org, 'flag sm'),
      el('a', {href: `team.html?team=${r.org}`, text: r.name}))),
    el('td', {class: 'num', text: r.played}), el('td', {class: 'num', text: r.won}),
    el('td', {class: 'num', text: r.tied}), el('td', {class: 'num', text: r.lost}),
    el('td', {class: 'num', text: r.for}), el('td', {class: 'num', text: r.against}),
    el('td', {class: 'num', text: r.diff}),
    el('td', {class: 'num', style: {fontWeight: 700}, text: r.pts}))));
  t.append(tb);
  return el('div', {class: 'tbl-scroll'}, t);
}

function matchRow(m) {
  const done = m.hasResult;
  const badge = m.isLive ? el('span', {class: 'badge live', text: 'LIVE'})
    : done ? el('span', {class: 'badge official', text: '終了'})
    : el('span', {class: 'badge sched', text: jpTime(m.dateTime)});
  const side = (t, right) => el('div', {class: 'row', style: {
    gap: '8px', flex: '1', justifyContent: right ? 'flex-end' : 'flex-start',
    flexDirection: right ? 'row-reverse' : 'row',
  }}, flagImg(t.code, 'flag sm'),
     el('span', {class: t.code ? '' : 'muted', style: {fontWeight: t.winner ? 700 : 500},
       text: t.name || t.code || '未定'}));
  const score = el('div', {class: 'num', style: {
    width: '96px', textAlign: 'center', fontWeight: 700, fontSize: '16px', color: 'var(--navy)',
  }, text: done ? `${m.home.score} – ${m.away.score}` : 'vs'});

  const body = el('div', {class: 'row', style: {gap: '10px', padding: '7px 8px', borderBottom: '1px solid var(--line)'}},
    el('div', {style: {width: '58px'}}, badge),
    el('div', {class: 'muted nowrap', style: {width: '132px', fontSize: '11px'}, text: m.phaseDesc.replace(/^(Men|Women)\s*/, '')}),
    side(m.home), score, side(m.away, true),
    el('div', {class: 'muted nowrap', style: {width: '120px', fontSize: '11px', textAlign: 'right'}, text: m.venue}),
    done ? el('a', {class: 'btn ghost sm', href: `match.html?id=${m.id}`, text: 'レポート'})
         : el('span', {style: {width: '66px'}}));
  return body;
}

/* ---- 選手ランキング（各試合ファイルを集計） ---- */
const RANK = {};       // gender -> {scorers, savers}
let _details = null;

function topScorers(g) { return RANK[g]?.scorers || []; }
function topSavers(g) { return RANK[g]?.savers || []; }

async function buildRanking(g) {
  if (RANK[g]) return;
  if (!_details) {
    _details = Promise.all((T.detailIds || []).map(id =>
      loadJSON(`data/matches/${id}.json`, {optional: true})));
  }
  const files = (await _details).filter(Boolean);
  const sc = new Map(), sv = new Map();
  files.filter(f => f.gender === g).forEach(f => {
    Object.values(f.teams).forEach(tm => tm.players.forEach(p => {
      const key = `${tm.code}  ${p.nameS || p.name}`;
      const goals = n(p.stats.GOALS), saves = n(p.stats.GK_SAVES);
      if (goals) sc.set(key, (sc.get(key) || 0) + goals);
      if (saves) sv.set(key, (sv.get(key) || 0) + saves);
    }));
  });
  const rows = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, v]) => ({label, v}));
  RANK[g] = {scorers: rows(sc), savers: rows(sv)};
}
