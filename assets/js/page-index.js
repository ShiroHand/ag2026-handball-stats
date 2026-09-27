import {loadJSON, el, q, n, pct, jpDate, jpTime, renderChrome, renderFoot, setError,
        params, setParam, flagImg, photoImg, shortRole, tip, CAT, withLang} from './core.js';
import {mergeTransitions, TRANS_KEYS, TRANS_SHORT, fastRate, fastSec} from './transitions.js';
import {costModel, buildContrib, groupMeans, groupLabel, POS_GROUP} from './contrib.js';
import {collectGKs, buildRef, gkSummary} from './gkstats.js';

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
          leaderList(scorers.slice(0, 12), CAT[0])),
        el('div', {}, el('div', {class: 'sub', text: 'GKセーブ数'}),
          leaderList(topSavers(gender).slice(0, 12), CAT[3])))));
  }
  const gaeCard = playerRankCard(gender, 'gae');
  if (gaeCard) app.append(gaeCard);
  const conCard = playerRankCard(gender, 'contrib');
  if (conCard) app.append(conCard);

  const gkCard = gkRankCard(gender);
  if (gkCard) app.append(gkCard);

  const effCard = efficiencyCard(gender);
  if (effCard) app.append(effCard);
  const trCard = transitionRankCard(gender);
  if (trCard) app.append(trCard);

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
            onclick: (e) => { e.preventDefault(); location.href = withLang(`defense.html?team=${t.code}&g=${t.gender}`); },
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

/* 攻守の切り替えの大会内ランキング */
function transitionRankCard(g) {
  const rows = RANK[g]?.trans || [];
  if (!rows.length) return null;
  const table = el('table', {});
  const head = ['チーム', '試合', '自ミス後に速攻を許した率', '相手ミス後に速攻で攻めた率'];
  TRANS_KEYS.forEach(k => head.push(`${TRANS_SHORT[k]}直後の失点率`));
  TRANS_KEYS.forEach(k => head.push(`相手${TRANS_SHORT[k]}直後の得点率`));
  table.append(el('thead', {}, el('tr', {}, head.map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  rows.forEach(r => {
    const tr = el('tr', {},
      el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
        flagImg(r.code, 'flag sm'),
        el('a', {href: `team.html?team=${r.code}&g=${g}`, text: r.name}))),
      el('td', {class: 'num', text: r.games}));
    /* 率と「50回あたり」を1セルに重ねて出す（列を増やすと横に長くなりすぎるため） */
    const cell = (v, denom) => {
      const td = el('td', {class: 'num', title: `${v.goals} / ${v.n}`});
      if (!v.n) { td.textContent = '–'; return td; }
      td.append(el('div', {style: {fontWeight: 700}, text: Math.round(v.goals / v.n * 100) + '%'}));
      if (denom > 0) {
        td.append(el('div', {style: {fontSize: '10px', color: 'var(--ink-3)'},
          text: (v.goals / denom * 50).toFixed(2)}));
      }
      return td;
    };
    /* ターンオーバー直後に速攻へ持ち込まれた／持ち込んだ割合 */
    const fastCell = (v, worseIsHigh) => {
      const fr = fastRate(v), as = fastSec(v);
      const td = el('td', {class: 'num', title: v.shots ? `${v.fast}/${v.shots}本` : ''});
      if (fr === null) { td.textContent = '–'; return td; }
      td.append(el('div', {style: {fontWeight: 700,
        color: worseIsHigh ? (fr >= 40 ? 'var(--bad)' : 'var(--ink)')
                           : (fr >= 40 ? 'var(--good)' : 'var(--ink)')},
        text: Math.round(fr) + '%'}));
      if (as !== null) {
        td.append(el('div', {style: {fontSize: '10px', color: 'var(--ink-3)'},
          text: as.toFixed(as % 1 ? 1 : 0) + '秒'}));
      }
      return td;
    };
    tr.append(fastCell(r.own.TO, true));
    tr.append(fastCell(r.opp.TO, false));
    TRANS_KEYS.forEach(k => tr.append(cell(r.own[k], r.defAttacks)));
    TRANS_KEYS.forEach(k => tr.append(cell(r.opp[k], r.attacks)));
    tb.append(tr);
  });
  table.append(tb);
  return el('div', {class: 'card'},
    el('h2', {text: '攻守の切り替え（大会内比較）'}),
    el('div', {class: 'sub',
      text: '左半分は「自分の攻撃がこう終わった直後に失点した割合」（低いほど良い）、'
        + '右半分は「相手の攻撃がこう終わった直後に得点した割合」（高いほど良い）。'
        + '最初の2列はターンオーバー直後に速攻へ持ち込まれた／持ち込んだ割合（下段はシュートまでの秒数）。'
        + '残りのセルは上段が率、下段が50回あたりの得点／失点（分母は総攻撃回数・総守備回数）。'
        + 'カーソルを合わせると実数が出ます。回数が少ない状況は大きく振れます。'}),
    el('div', {class: 'tbl-scroll'}, table));
}

/* 顔写真つきランキング */
function leaderList(rows, color) {
  if (!rows.length) return el('div', {class: 'empty', text: 'データがありません'});
  const max = Math.max(...rows.map(r => r.v), 1);
  const box = el('div', {class: 'lead'});
  rows.forEach((r, i) => {
    const bar = el('span', {class: 'lead-fill'});
    bar.style.width = (r.v / max * 100) + '%';
    bar.style.background = color;
    box.append(el('div', {class: 'lead-row'},
      el('span', {class: 'lead-rank', text: i + 1}),
      photoImg(r.reg, r.name, 'photo sm'),
      flagImg(r.code, 'flag sm'),
      el('span', {class: 'lead-name', text: r.name}),
      el('span', {class: 'lead-bar'}, bar),
      el('span', {class: 'lead-val num', text: r.v})));
  });
  return box;
}

/* 50回あたりの得点・失点でチームを並べる。
   攻撃回数が多い（テンポが速い）だけで得点が伸びているチームと、
   1回の攻撃を確実に決めているチームを区別できる。 */
function efficiencyCard(g) {
  const rows = (RANK[g]?.teams || []);
  if (!rows.length) return null;
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['#', 'チーム', '試合', '攻撃回数', '50攻撃あたり得点', '50守備あたり失点', '差引']
      .map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  rows.forEach((r, i) => tb.append(el('tr', {},
    el('td', {class: 'num muted', text: i + 1}),
    el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
      flagImg(r.code, 'flag sm'),
      el('a', {href: `team.html?team=${r.code}&g=${g}`, text: r.name}))),
    el('td', {class: 'num', text: r.games}),
    el('td', {class: 'num', text: r.attacks}),
    el('td', {class: 'num', text: r.scored.toFixed(1)}),
    el('td', {class: 'num', text: r.conceded.toFixed(1)}),
    el('td', {class: 'num', style: {fontWeight: 700, color: r.margin >= 0 ? 'var(--good)' : 'var(--bad)'},
      text: (r.margin >= 0 ? '+' : '') + r.margin.toFixed(1)}))));
  table.append(tb);
  return el('div', {class: 'card'},
    el('h2', {text: '50回あたりの得点・失点（攻守の効率）'}),
    el('div', {class: 'sub', text: '攻撃回数50回に換算した得点と失点。試合のテンポに左右されずに攻守の質を比べられます。差引の大きい順。'}),
    el('div', {class: 'tbl-scroll'}, table));
}

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
      const key = `${tm.code}|${p.bib}|${p.nameS || p.name}`;
      const goals = n(p.stats.GOALS), saves = n(p.stats.GK_SAVES);
      const put = (m, v) => {
        const cur = m.get(key) || {code: tm.code, name: p.nameS || p.name, reg: p.reg || '', v: 0};
        cur.v += v;
        if (!cur.reg && p.reg) cur.reg = p.reg;
        m.set(key, cur);
      };
      if (goals) put(sc, goals);
      if (saves) put(sv, saves);
    }));
  });
  const rows = (m) => [...m.values()].sort((a, b) => b.v - a.v);

  /* チームごとの 50回あたり得点・失点 */
  const tm = new Map();
  files.filter(f => f.gender === g).forEach(f => {
    for (const code of [f.home, f.away]) {
      const me = f.teams[code], op = f.teams[code === f.home ? f.away : f.home];
      if (!me || !op) continue;
      const mp = me.possessions || {}, op2 = op.possessions || {};
      if (!n(mp.attacks) || !n(op2.attacks)) continue;
      const cur = tm.get(code) || {code, name: me.nameS || me.name || code,
        games: 0, attacks: 0, goals: 0, defAttacks: 0, conceded: 0};
      cur.games++;
      cur.attacks += n(mp.attacks); cur.goals += n(mp.goals);
      cur.defAttacks += n(op2.attacks); cur.conceded += n(op2.goals);
      tm.set(code, cur);
    }
  });
  const teams = [...tm.values()].map(t => {
    const scored = t.attacks ? t.goals / t.attacks * 50 : 0;
    const conceded = t.defAttacks ? t.conceded / t.defAttacks * 50 : 0;
    return {...t, scored, conceded, margin: scored - conceded};
  }).sort((a, b) => b.margin - a.margin);

  /* 攻守の切り替え */
  const trRows = [];
  const codes = new Set();
  files.filter(f => f.gender === g).forEach(f => { codes.add(f.home); codes.add(f.away); });
  codes.forEach(code => {
    const mine = files.filter(f => f.gender === g && f.teams[code]);
    if (!mine.length) return;
    const tr = mergeTransitions(mine, code);
    const anyN = TRANS_KEYS.reduce((a, k) => a + tr.afterOwn[k].n + tr.afterOpp[k].n, 0);
    if (!anyN) return;
    const t0 = mine[0].teams[code];
    /* 50回あたりの分母（総攻撃回数・総守備回数） */
    let atk = 0, def = 0;
    mine.forEach(f => {
      const opCode = f.home === code ? f.away : f.home;
      atk += n(f.teams[code]?.possessions?.attacks);
      def += n(f.teams[opCode]?.possessions?.attacks);
    });
    trRows.push({code, name: t0.nameS || t0.name || code, games: mine.length,
      own: tr.afterOwn, opp: tr.afterOpp, attacks: atk, defAttacks: def});
  });
  trRows.sort((a, b) => a.code.localeCompare(b.code));

  /* 選手ランキング（期待得点との差・攻撃の貢献度）。
     平均の基準はカテゴリ全体なので、ここでまとめて作る。 */
  const mine = files.filter(f => f.gender === g);
  let players = [], cost = null, means = {};
  if (mine.length) {
    cost = costModel(mine);
    players = buildContrib(mine, mine, cost);
    means = groupMeans(players);
    players.forEach(r => {
      const m = means[r.group];
      r.adj = m ? r.per60 - m.mean : null;
    });
  }

  /* GK（GSAA） */
  let gkRows = [];
  if (mine.length) {
    const {gks, all} = collectGKs(mine);
    const ref = buildRef(all);
    gkRows = gks.map(x => ({...x, sum: gkSummary(x.shots, ref)}))
      .filter(x => x.sum.onTarget >= 20)
      .sort((a, b) => b.sum.gsaa - a.sum.gsaa);
  }

  RANK[g] = {scorers: rows(sc), savers: rows(sv), teams, trans: trRows,
    players, cost, means, gks: gkRows};
}


/* ---------- 選手ランキング（期待得点との差・攻撃の貢献度） ---------- */
/* kind: 'gae'（フィニッシュだけ）/ 'contrib'（ミス・退場まで含めた貢献度）
   貢献度は素の合計だとポジションで順位が決まってしまうので、
   同ポジション平均との差を主指標にする（チーム分析ページと同じ）。

   ポジションが違えば役割が違うので、並べる相手もポジションで絞れるようにする。
   ただし計算そのもの（期待得点の基準表・換算レート・同ポジ平均）は
   全ポジションのシュートから作る。絞るのは「表示する相手」だけ。 */
let posFilter = {gae: 'all', contrib: 'all'};

function playerRankCard(g, kind) {
  const R = RANK[g];
  if (!R || !R.players || !R.players.length) return null;
  const isGae = kind === 'gae';
  const all = R.players
    .filter(r => (isGae ? r.nZ >= 10 : (r.shots >= 10 && r.min >= 40)))
    .map(r => ({...r, key: isGae ? r.gae : (r.adj ?? -99)}))
    .filter(r => r.key > -98)
    .sort((a, b) => b.key - a.key);
  if (all.length < 5) return null;

  const table = (arr) => {
    const t = el('table', {});
    t.append(el('thead', {}, el('tr', {},
      (isGae
        ? ['#', '選手', 'チーム', '背番号', 'Pos', 'シュート', '枠外・ブロック', '得点',
          '期待得点', '差（位置基準）', '差（コース基準）']
        : ['#', '選手', 'チーム', '背番号', 'Pos', '出場', 'フィニッシュ', 'ミス', '合計', '同ポジ差'])
        /* 左から 順位 / 選手 / チーム は左寄せ、背番号から右は数字寄せ（Pos は左） */
        .map((h, i) => el('th', {class: (i < 3 || i === 4) ? '' : 'num', text: h})))));
    const tb = el('tbody', {});
    arr.forEach((r, i) => {
      const cells = isGae
        ? [r.nZ, r.offTarget || '', r.goals, r.xgZ.toFixed(1),
          (r.gae > 0 ? '+' : '') + r.gae.toFixed(1),
          (r.gaeCourse > 0 ? '+' : '') + r.gaeCourse.toFixed(1)]
        : [Math.round(r.min), (r.gae > 0 ? '+' : '') + r.gae.toFixed(1), r.to,
          (r.total > 0 ? '+' : '') + r.total.toFixed(1),
          (r.adj > 0 ? '+' : '') + r.adj.toFixed(2)];
      const tr = el('tr', {},
        el('td', {class: 'num muted', text: i + 1}),
        el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
          photoImg(r.reg, r.name, 'photo sm'), el('span', {text: r.name}))),
        el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
          flagImg(r.code, 'flag sm'), el('span', {text: r.code}))),
        el('td', {class: 'num muted', text: r.bib}),
        el('td', {text: shortRole(r.role)}),
        cells.map((c, j) => el('td', {class: 'num',
          style: {fontWeight: j === cells.length - (isGae ? 2 : 1) ? 700 : 400}, text: c})));
      tip(tr, `<b>${r.name}</b>（${r.code}・${shortRole(r.role)}）<br>`
        + `${r.games}試合 ${Math.round(r.min)}分 / ${r.goals}点 ${r.shots}本<br>`
        + `フィニッシュ（位置基準）${r.gae.toFixed(1)} / ミス ${r.toLoss.toFixed(1)} / 退場 ${r.spLoss.toFixed(1)}<br>`
        + `誤差 ±${r.se.toFixed(1)}点`);
      tb.append(tr);
    });
    t.append(tb);
    return el('div', {class: 'tbl-scroll'}, t);
  };

  const head = isGae
    ? {title: '期待得点との差 ランキング',
      sub: '「大会平均の選手が同じシュートを打ったら何点入るか」と実際の得点を比べたものです。'
        + '決定率が高いのは簡単な位置から打っているからなのか、本当に上手いのかを切り分けられます。'
        + '位置基準は全シュートが対象で枠外も罰せられ、コース基準は枠内に飛んだシュートだけが対象で'
        + 'GKとの勝負だけを見ます。2つの差が大きい選手は、'
        + '枠に飛ばす技術と決め切る技術のどちらかに偏りがあります。'
        + '並べ替えは位置基準です。シュート10本以上の選手が対象です。'
        + 'ポジションで絞ると、同じ役割の選手だけを並べられます。'
        + '期待得点の基準表は全ポジションのシュートから作っているので、絞っても値は変わりません。'}
    : {title: '攻撃の貢献度 ランキング',
      sub: 'フィニッシュ・ミス・2分退場を同じ「点」に換算して足したものです。'
        + '並べ替えは「同ポジ平均との差（60分あたり）」で行っています。'
        + '素の合計で並べるとボールに触る回数の多いポジションが不利になるためです。'
        + 'シュート10本以上・出場40分以上が対象です。'
        + 'ポジションで絞ると、同じ役割の選手だけを並べられます。'
        + '換算レートと同ポジ平均は全ポジションのデータから出しているので、絞っても値は変わりません。'};

  /* ---- ポジション絞り込み ---- */
  /* 3人未満の群はチップを出さない（順位を付ける意味が薄いため）。試合が増えれば出る。 */
  const avail = POS_GROUP.filter(gr => all.filter(r => r.group === gr.key).length >= 3);
  if (!avail.some(gr => gr.key === posFilter[kind])) posFilter[kind] = 'all';
  const chips = el('div', {class: 'chips'});
  const host = el('div', {});
  const draw = () => {
    const k = posFilter[kind];
    const rows = k === 'all' ? all : all.filter(r => r.group === k);
    host.innerHTML = '';
    if (k === 'all') {
      host.append(el('div', {class: 'sec-title', text: '上位15人'}), table(rows.slice(0, 15)),
        el('div', {class: 'sec-title', style: {marginTop: '14px'}, text: '下位10人'}),
        table(rows.slice(-10).reverse()));
    } else {
      host.append(el('div', {class: 'sec-title',
        text: `${groupLabel(k)}　${rows.length}人（全員）`}), table(rows));
    }
  };
  [{key: 'all', label: 'すべて'}, ...avail].forEach(gr => chips.append(el('button', {
    class: 'chip' + (posFilter[kind] === gr.key ? ' on' : ''),
    text: gr.label,
    onclick: (e) => {
      posFilter[kind] = gr.key;
      [...chips.children].forEach(c => c.className = 'chip');
      e.currentTarget.className = 'chip on';
      draw();
    }})));
  draw();

  const box = el('div', {class: 'card'},
    el('h2', {text: head.title}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'}, text: head.sub}),
    el('div', {class: 'row', style: {gap: '10px', marginBottom: '10px'}},
      el('span', {class: 'muted', style: {fontSize: '12px'}, text: 'ポジション'}), chips),
    host);

  if (!isGae && R.cost) {
    box.append(el('div', {class: 'sub', style: {marginTop: '10px'},
      text: `換算レートは大会データから推定しています。ミス1回 −${R.cost.toCost.toFixed(2)}点、`
        + `2分退場1回 −${R.cost.suspCost.toFixed(2)}点。`
        + 'アシストは公式の定義上ほぼ得点にしか記録されないため合算していません。'}));
  }
  box.append(el('div', {class: 'sub', style: {marginTop: '6px'},
    text: 'これは総合評価ではありません。守備の記録がほとんど無く、'
      + 'スクリーンや7mを獲得する動きは1つも入りません。'
      + '行にカーソルを合わせると内訳と誤差が出ます。'}));
  return box;
}


/* ---------- GKランキング（GSAA） ---------- */
function gkRankCard(g) {
  const rows = RANK[g]?.gks || [];
  if (rows.length < 3) return null;
  const table = (arr) => {
    const t = el('table', {});
    t.append(el('thead', {}, el('tr', {},
      ['#', 'GK', 'チーム', '背番号', '試合', '被シュート', '枠内', 'セーブ', '失点', 'セーブ率',
        '期待失点', 'GSAA', 'セーブ後の速攻率'].map((h, i) => el('th', {class: i < 3 ? '' : 'num', text: h})))));
    const tb = el('tbody', {});
    arr.forEach((r, i) => {
      const s = r.sum;
      const td = el('td', {class: 'num', style: {fontWeight: 700,
        color: s.gsaa > 0 ? 'var(--good)' : (s.gsaa < 0 ? 'var(--bad)' : '')},
        text: (s.gsaa > 0 ? '+' : '') + s.gsaa.toFixed(1)});
      const tr = el('tr', {},
        el('td', {class: 'num muted', text: i + 1}),
        el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
          photoImg(r.reg, r.name, 'photo sm'), el('span', {text: r.name}))),
        el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
          flagImg(r.code, 'flag sm'), el('span', {text: r.code}))),
        el('td', {class: 'num muted', text: r.bib}),
        el('td', {class: 'num', text: r.games}),
        el('td', {class: 'num', text: s.n}),
        el('td', {class: 'num', text: s.onTarget}),
        el('td', {class: 'num', text: s.saves}),
        el('td', {class: 'num', text: s.goals}),
        el('td', {class: 'num', style: {fontWeight: 700}, text: pct(s.saves, s.onTarget)}),
        el('td', {class: 'num muted', text: s.xg.toFixed(1)}),
        td,
        el('td', {class: 'num', text: r.outlet && r.outlet.n ? pct(r.outlet.fast, r.outlet.n) : '·'}));
      tip(tr, `<b>${r.name}</b>（${r.code}）<br>`
        + `コースが記録されている ${s.xn} 本が対象<br>`
        + `期待失点 ${s.xg.toFixed(1)} / 同じ ${s.xn} 本での実失点 ${s.xgoals}<br>`
        + (r.outlet && r.outlet.n
          ? `セーブして味方ボールになった ${r.outlet.n} 回（速攻 ${r.outlet.fast}）` : ''));
      tb.append(tr);
    });
    t.append(tb);
    return el('div', {class: 'tbl-scroll'}, t);
  };
  return el('div', {class: 'card'},
    el('h2', {text: 'GKランキング — 平均的なGKとの差（GSAA）'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'GSAA = 期待失点 − 実失点。浴びたシュート1本ずつについて「位置とコースが同じシュートを'
        + '大会平均のGKが受けたら何点入っていたか」を足し上げ、実際の失点を引いたものです。'
        + 'セーブ率は浴びたシュートの質に左右されますが、GSAAはそれを補正します。'
        + '枠内シュートを20本以上浴びたGKが対象です。'}),
    table(rows),
    el('div', {class: 'sub', style: {marginTop: '8px'},
      text: '「セーブ後の速攻率」はセーブの直後に味方が速攻へ持ち込めた割合です。'
        + 'セーブ率が同じでも、速攻に繋がるセーブをするGKとそうでないGKを見分けられます。'
        + '内訳はGK分析のページにあります。'}));
}
