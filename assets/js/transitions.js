/* ==========================================================================
   transitions.js — 攻守の切り替え（直前の攻撃の終わり方 → 次の攻撃の成否）

   afterOwn: 自分の攻撃がこう終わった直後、相手はどうだったか（= 自分の失点）
   afterOpp: 相手の攻撃がこう終わった直後、自分はどうだったか（= 自分の得点）
   ========================================================================== */
import {el, n, pct, tip, flagImg, jpDate} from './core.js';
import {svg} from './charts.js';

export const TRANS_KEYS = ['TO', 'GOAL', 'SAVE', 'POST'];
export const TRANS_LABEL = {
  own: {
    TO: '自分がミスで失った直後',
    GOAL: '自分が得点した直後',
    SAVE: '自分のシュートがセーブされた直後',
    POST: '自分のシュートが枠外・ポストの直後',
  },
  opp: {
    TO: '相手がミスで失った直後',
    GOAL: '相手が得点した直後',
    SAVE: '相手のシュートがセーブされた直後',
    POST: '相手のシュートが枠外・ポストの直後',
  },
};
export const TRANS_SHORT = {TO: 'ミス', GOAL: '得点', SAVE: 'セーブ', POST: '枠外・ポスト'};

const FIELDS = ['n', 'goals', 'shots', 'bt', 'btGoals',
  'fast', 'fastGoals', 'second', 'secondGoals', 'set', 'setGoals'];
/* 秒数は生の値の配列。中央値は後から合算できないので、足すときは連結する。 */
const SEC_FIELDS = ['fastSecs', 'secondSecs', 'setSecs'];
const blank = () => ({
  ...Object.fromEntries(FIELDS.map(f => [f, 0])),
  ...Object.fromEntries(SEC_FIELDS.map(f => [f, []])),
});
export const emptyTrans = () => ({
  afterOwn: Object.fromEntries(TRANS_KEYS.map(k => [k, blank()])),
  afterOpp: Object.fromEntries(TRANS_KEYS.map(k => [k, blank()])),
});

export function addTrans(a, b) {
  const out = emptyTrans();
  for (const side of ['afterOwn', 'afterOpp']) {
    for (const k of TRANS_KEYS) {
      FIELDS.forEach(f => { out[side][k][f] = n(a?.[side]?.[k]?.[f]) + n(b?.[side]?.[k]?.[f]); });
      SEC_FIELDS.forEach(f => {
        out[side][k][f] = [...(a?.[side]?.[k]?.[f] || []), ...(b?.[side]?.[k]?.[f] || [])];
      });
    }
  }
  return out;
}

export function mergeTransitions(list, code) {
  return list.reduce((acc, f) => addTrans(acc, f.teams?.[code]?.transitions), emptyTrans());
}

/* 良し悪しの配色。0 = 悪い(赤) / 100 = 良い(緑)。
   サイトのシュートマップは「赤＝決定率が高い＝良い」だが、失点率は逆に読むため、
   この表では良し悪しそのものを色にする。 */
const GOOD_RAMP = [[0, [205, 42, 32]], [35, [228, 87, 46]], [50, [232, 163, 61]],
  [65, [150, 173, 120]], [100, [31, 157, 107]]];
function goodColor(goodness) {
  if (goodness === null || !Number.isFinite(goodness)) return 'var(--ink-3)';
  const v = Math.max(0, Math.min(100, goodness));
  for (let i = 1; i < GOOD_RAMP.length; i++) {
    if (v <= GOOD_RAMP[i][0]) {
      const [p0, c0] = GOOD_RAMP[i - 1], [p1, c1] = GOOD_RAMP[i];
      const t = (v - p0) / (p1 - p0 || 1);
      const c = c0.map((x, k) => Math.round(x + (c1[k] - x) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(31,157,107)';
}

const totalOf = (side) => TRANS_KEYS.reduce((acc, k) => {
  FIELDS.forEach(f => acc[f] += n(side?.[k]?.[f]));
  SEC_FIELDS.forEach(f => acc[f].push(...(side?.[k]?.[f] || [])));
  return acc;
}, blank());

/* 中央値。外れ値に引きずられないので、所要時間はこちらを主に出す。 */
export function median(arr) {
  const a = (arr || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export const meanOf = (arr) => {
  const a = (arr || []).filter(Number.isFinite);
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
};

/* 速攻率 = 次の攻撃のシュートのうち速攻（FB）だった割合。
   ブレイクスルー（BT）は実測で中央値29秒とセット攻撃と変わらないため含めない。 */
export const fastRate = (v) => (n(v?.shots) > 0 ? n(v.fast) / n(v.shots) * 100 : null);
/* シュートまでの平均秒。速攻とそれ以外を分けて出す（混ぜると実態が見えないため） */
/* 帯ごとの所要時間（中央値）。平均はツールチップで添える。 */
export const fastSec = (v) => median(v?.fastSecs);
export const secondSec = (v) => median(v?.secondSecs);
export const slowSec = (v) => median(v?.setSecs);

/* 1つの向きの表 */
function tableFor(side, which, denom) {
  const labels = TRANS_LABEL[which === 'afterOwn' ? 'own' : 'opp'];
  const outcome = which === 'afterOwn' ? '失点' : '得点';
  /* 50回あたりの分母は KPI と揃える。
     得点はそのチームの総攻撃回数、失点は総守備回数（＝相手の総攻撃回数）。 */
  const perHead = which === 'afterOwn' ? '守備50回あたり失点' : '攻撃50回あたり得点';
  const tot = totalOf(side);
  const table = el('table', {});
  const head = ['直前の攻撃の終わり方', '回数', outcome, `${outcome}率`];
  if (denom > 0) head.push(perHead);
  head.push('速攻率', 'シュートまでの中央値(秒)', '全体に占める割合');
  table.append(el('thead', {}, el('tr', {}, head.map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  TRANS_KEYS.forEach(k => {
    const v = side?.[k] || {n: 0, goals: 0};
    const rate = v.n > 0 ? v.goals / v.n * 100 : null;
    const fr = fastRate(v), fsec = fastSec(v), ssec = slowSec(v);
    /* 失点率は高いほど悪い・得点率は高いほど良いので、色の向きを揃えるために反転する */
    const good = which === 'afterOwn' ? (rate === null ? null : 100 - rate) : rate;   // 大きいほど良い
    const bar = el('span', {class: 'pillbar', style: {minWidth: '70px'}});
    const fill = el('span');
    fill.style.width = (tot.n > 0 ? v.n / tot.n * 100 : 0) + '%';
    fill.style.background = 'var(--blue)';
    bar.append(fill);
    tb.append(el('tr', {},
      el('td', {text: labels[k]}),
      el('td', {class: 'num', text: v.n || '–'}),
      el('td', {class: 'num', style: {fontWeight: 700}, text: v.goals || (v.n ? 0 : '–')}),
      el('td', {class: 'num', style: rate === null ? null
        : {color: goodColor(good), fontWeight: 700}, text: rate === null ? '–' : Math.round(rate) + '%'}),
      denom > 0 ? el('td', {class: 'num', text: (v.goals / denom * 50).toFixed(2)}) : null,
      el('td', {class: 'num', title: v.shots ? `${v.fast} / ${v.shots} 本` : '',
        style: fr === null ? null : {color: goodColor(which === 'afterOwn' ? 100 - fr : fr), fontWeight: 700},
        text: fr === null ? '–' : Math.round(fr) + '%'}),
      el('td', {class: 'num'},
        fsec === null && ssec === null ? '–' : el('div', {},
          fsec !== null ? el('div', {style: {fontWeight: 700, color: 'var(--navy-2)'},
            text: '速攻 ' + fsec.toFixed(fsec % 1 ? 1 : 0)}) : null,
          ssec !== null ? el('div', {style: {fontSize: '10.5px', color: 'var(--ink-3)'},
            text: 'セット ' + ssec.toFixed(ssec % 1 ? 1 : 0)}) : null)),
      el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
        bar, el('span', {class: 'num', style: {fontSize: '11.5px', minWidth: '36px'},
          text: tot.n > 0 ? pct(v.n, tot.n) : '–'})))));
  });
  tb.append(el('tr', {class: 'total'},
    el('td', {text: '合計'}),
    el('td', {class: 'num', text: tot.n}),
    el('td', {class: 'num', text: tot.goals}),
    el('td', {class: 'num', text: tot.n ? pct(tot.goals, tot.n) : '–'}),
    denom > 0 ? el('td', {class: 'num', style: {fontWeight: 700},
      text: (tot.goals / denom * 50).toFixed(2)}) : null,
    el('td', {class: 'num', text: fastRate(tot) === null ? '–' : Math.round(fastRate(tot)) + '%'}),
    el('td', {class: 'num'}, el('div', {},
      fastSec(tot) !== null ? el('div', {style: {fontWeight: 700},
        text: '速攻 ' + fastSec(tot).toFixed(fastSec(tot) % 1 ? 1 : 0)}) : null,
      slowSec(tot) !== null ? el('div', {style: {fontSize: '10.5px', color: 'var(--ink-3)'},
        text: 'セット ' + slowSec(tot).toFixed(slowSec(tot) % 1 ? 1 : 0)}) : null)),
    el('td', {class: 'num', text: '100%'})));
  table.append(tb);
  return el('div', {class: 'tbl-scroll'}, table);
}

/* 4つの状況を横棒で比べる（率の差が一目で分かるように） */
function rateBars(side, which) {
  const outcome = which === 'afterOwn' ? '失点率' : '得点率';
  const rows = TRANS_KEYS.map(k => {
    const v = side?.[k] || {n: 0, goals: 0};
    return {k, n: v.n, goals: v.goals, rate: v.n > 0 ? v.goals / v.n * 100 : null};
  });
  const W = 260, H = rows.length * 26 + 18;
  const root = svg('svg', {class: 'chart', viewBox: `0 0 ${W} ${H}`});
  root.setAttribute('style', 'width:100%;max-width:' + W + 'px;height:auto');
  const x0 = 84, iw = W - x0 - 34;
  rows.forEach((r, i) => {
    const y = i * 26 + 10;
    root.append(svg('text', {x: x0 - 6, y: y + 12, 'text-anchor': 'end', 'font-size': 10.5,
      fill: '#4a6377'}, TRANS_SHORT[r.k]));
    root.append(svg('rect', {x: x0, y: y + 3, width: iw, height: 13, rx: 3, fill: '#eef3f8'}));
    if (r.rate !== null) {
      const good = which === 'afterOwn' ? 100 - r.rate : r.rate;
      root.append(svg('rect', {x: x0, y: y + 3, width: Math.max(2, iw * r.rate / 100),
        height: 13, rx: 3, fill: goodColor(good)}));
      root.append(svg('text', {x: x0 + iw + 4, y: y + 13.5, 'font-size': 10.5,
        'font-weight': 700, fill: '#152b40'}, Math.round(r.rate) + '%'));
    } else {
      root.append(svg('text', {x: x0 + iw + 4, y: y + 13.5, 'font-size': 10.5, fill: '#7b8fa1'}, '–'));
    }
    const g = svg('rect', {x: x0, y: y + 3, width: iw, height: 13, fill: 'transparent'});
    tip(g, `<b>${TRANS_SHORT[r.k]}の直後</b><br>${r.goals} / ${r.n} = ${r.rate === null ? '–' : Math.round(r.rate) + '%'}`);
    root.append(g);
  });
  return el('div', {}, el('div', {class: 'sub', style: {margin: '0 0 4px'}, text: outcome}), root);
}

/* ---------- 速攻の得点内訳 ----------
   「速攻での得点（失点）が、直前のどの終わり方から生まれたか」を分解する。
   構成比の合計は100%になる。 */
/* 速攻と遅攻を並べた内訳表。
   遅攻の本数・得点は引き算で出せる（shots - fast / goals - fastGoals）ので、
   データ側に追加項目は要らない。 */
/* 次の攻撃を「速さ」の一本の軸で3つに分ける。
     速攻      … 公式が FB と記録したもの（中央値9秒）
     2次速攻   … FB ではないが20秒以内に打ったもの（中央値13秒）
     セット攻撃 … 20秒を超えたもの（中央値37秒）
   20秒は実測した所要時間の谷から選んだ。決定率は 80% / 71% / 59% と段階的に下がる。
   ブレイクスルー(BT)はこの軸とは別（どの帯にも現れる）ので、ここには出さない。
   BT の内訳は「位置別の内訳」の表にある。 */
const BANDS = [
  {key: 'fast', gk: 'fastGoals', secs: 'fastSecs', label: '速攻（FB）'},
  {key: 'second', gk: 'secondGoals', secs: 'secondSecs', label: '2次速攻（20秒以内）'},
  {key: 'set', gk: 'setGoals', secs: 'setSecs', label: 'セット攻撃（20秒超）'},
];

function splitBlock(side, which) {
  const outcome = which === 'afterOwn' ? '失点' : '得点';
  const labels = TRANS_LABEL[which === 'afterOwn' ? 'own' : 'opp'];
  const hot = which === 'afterOwn' ? 'var(--bad)' : 'var(--good)';
  const COLORS = [hot, 'var(--warn)', 'var(--line-2)'];

  const rows = TRANS_KEYS.map(k => ({k, v: side?.[k] || {}}));
  const T = {};
  BANDS.forEach(b => { T[b.key] = 0; T[b.gk] = 0; T[b.secs] = []; });
  rows.forEach(r => BANDS.forEach(b => {
    T[b.key] += n(r.v[b.key]); T[b.gk] += n(r.v[b.gk]);
    T[b.secs].push(...(r.v[b.secs] || []));
  }));
  const totShots = BANDS.reduce((a, b) => a + T[b.key], 0);
  if (!totShots) {
    return el('div', {class: 'empty', style: {padding: '18px'}, text: '記録がありません。'});
  }
  const totG = BANDS.reduce((a, b) => a + T[b.gk], 0);
  const conv = (g, s2) => (s2 > 0 ? Math.round(g / s2 * 100) + '%' : '–');

  const table = el('table', {});
  table.append(el('thead', {},
    el('tr', {},
      el('th', {rowspan: 2, text: '直前の攻撃の終わり方'}),
      BANDS.map(b => el('th', {colspan: 4, text: b.label})),
      el('th', {rowspan: 2, text: `${outcome}の構成比`})),
    el('tr', {}, BANDS.flatMap(() => [
      el('th', {text: '本'}), el('th', {text: outcome}),
      el('th', {text: '決定率'}), el('th', {text: '中央値(秒)'})]))));

  const tb = el('tbody', {});
  rows.forEach(r => {
    const g = BANDS.reduce((a, b) => a + n(r.v[b.gk]), 0);
    const bar = el('span', {class: 'pillbar', style: {minWidth: '78px'}});
    BANDS.forEach((b, i) => {
      const seg = el('span');
      seg.style.width = (totG > 0 ? n(r.v[b.gk]) / totG * 100 : 0) + '%';
      seg.style.background = COLORS[i];
      bar.append(seg);
    });
    const cells = BANDS.flatMap(b => {
      const shots = n(r.v[b.key]), goals = n(r.v[b.gk]);
      const arr = r.v[b.secs] || [];
      const md = median(arr), mn = meanOf(arr);
      return [
        el('td', {class: 'num', text: shots || '·'}),
        el('td', {class: 'num', style: {fontWeight: 700}, text: goals || (shots ? 0 : '·')}),
        el('td', {class: 'num', text: conv(goals, shots)}),
        el('td', {class: 'num', style: {fontWeight: 600},
          title: mn === null ? '' : `平均 ${mn.toFixed(1)}秒 / n=${arr.length}`,
          text: md === null ? '–' : md.toFixed(md % 1 ? 1 : 0)}),
      ];
    });
    tb.append(el('tr', {}, el('td', {text: labels[r.k]}), cells,
      el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
        bar, el('span', {class: 'num', style: {fontSize: '11.5px', minWidth: '34px'},
          text: totG > 0 ? pct(g, totG) : '–'})))));
  });
  tb.append(el('tr', {class: 'total'}, el('td', {text: '合計'}),
    BANDS.flatMap(b => {
      const md = median(T[b.secs]), mn = meanOf(T[b.secs]);
      return [
        el('td', {class: 'num', text: T[b.key]}),
        el('td', {class: 'num', text: T[b.gk]}),
        el('td', {class: 'num', text: conv(T[b.gk], T[b.key])}),
        el('td', {class: 'num', title: mn === null ? '' : `平均 ${mn.toFixed(1)}秒`,
          text: md === null ? '–' : md.toFixed(md % 1 ? 1 : 0)}),
      ];
    }),
    el('td', {class: 'num', text: '100%'})));
  table.append(tb);

  const legend = el('div', {class: 'split-legend'});
  BANDS.forEach((b, i) => {
    const sw = el('i'); sw.style.background = COLORS[i];
    legend.append(el('span', {}, sw,
      `${b.label} ${T[b.gk]}点（${totG > 0 ? Math.round(T[b.gk] / totG * 100) : 0}%）`));
  });
  return el('div', {}, el('div', {class: 'tbl-scroll'}, table), legend);
}

/* ---------- 試合ごとの速攻得点・失点 ----------
   累計だとどの試合で崩れたのかが見えないので、1試合1行で並べる。 */
export function fastPerMatchCard(list, code, {title = '試合ごとの速攻'} = {}) {
  const rows = list.map(f => {
    const tr = f.teams?.[code]?.transitions;
    const opp = f.home === code ? f.away : f.home;
    return {f, opp, tr};
  }).filter(r => r.tr);
  if (!rows.length) return null;

  const table = el('table', {});
  const h1 = el('tr', {},
    el('th', {rowspan: 2, text: '対戦相手'}),
    el('th', {colspan: 5, text: '速攻での得点（相手の攻撃が…の後）'}),
    el('th', {colspan: 5, text: '速攻での失点（自分の攻撃が…の後）'}));
  const sub = () => TRANS_KEYS.map(k => el('th', {text: TRANS_SHORT[k] + '後'}))
    .concat([el('th', {text: '計'})]);
  const h2 = el('tr', {}, sub(), sub());
  table.append(el('thead', {}, h1, h2));

  const tb = el('tbody', {});
  const sums = {att: {}, def: {}};
  TRANS_KEYS.forEach(k => { sums.att[k] = 0; sums.def[k] = 0; });
  rows.forEach(r => {
    const cells = [];
    for (const [side, bag] of [['afterOpp', 'att'], ['afterOwn', 'def']]) {
      let t = 0;
      TRANS_KEYS.forEach(k => {
        const g = n(r.tr[side]?.[k]?.fastGoals);
        t += g; sums[bag][k] += g;
        cells.push(el('td', {class: 'num', style: g ? {fontWeight: 600} : {color: 'var(--line-2)'},
          title: `速攻シュート ${n(r.tr[side]?.[k]?.fast)} 本`, text: g || '·'}));
      });
      cells.push(el('td', {class: 'num', style: {fontWeight: 700,
        background: 'var(--surface-2)'}, text: t}));
    }
    tb.append(el('tr', {},
      el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
        el('span', {class: 'muted', style: {fontSize: '11px'}, text: jpDate(r.f.date)}),
        flagImg(r.opp, 'flag sm'),
        el('a', {href: `match.html?id=${r.f.id}`, text: r.opp}))),
      cells));
  });
  const totalCells = [];
  for (const bag of ['att', 'def']) {
    let t = 0;
    TRANS_KEYS.forEach(k => { t += sums[bag][k]; totalCells.push(el('td', {class: 'num', text: sums[bag][k] || '·'})); });
    totalCells.push(el('td', {class: 'num', style: {fontWeight: 700}, text: t}));
  }
  tb.append(el('tr', {class: 'total'}, el('td', {text: '合計'}), totalCells));
  table.append(tb);

  return el('div', {class: 'card'},
    el('h2', {text: title}),
    el('div', {class: 'sub',
      text: '速攻・ブレイクスルーで決まった得点を、直前の攻撃がどう終わったかで分けたものです。'
        + 'セルにカーソルを合わせると、その状況の速攻シュート数が出ます。「·」は0本。'}),
    el('div', {class: 'tbl-scroll'}, table));
}

/* ---------- カード本体 ---------- */
export function transitionCard(tr, {title = '攻守の切り替え', note = '',
  attacks = 0, defAttacks = 0} = {}) {
  const own = totalOf(tr.afterOwn), opp = totalOf(tr.afterOpp);
  if (!own.n && !opp.n) {
    return el('div', {class: 'card'}, el('h2', {text: title}),
      el('div', {class: 'empty', text: 'プレーバイプレーが未取得のため表示できません。'}));
  }
  /* 見出しの要約。ターンオーバーの「痛さ」を主役に置く。 */
  const toOwn = tr.afterOwn.TO || {}, toOpp = tr.afterOpp.TO || {};
  const item = (k, v, s2, tone) => {
    const box = el('div', {class: 'trans-lead-item' + (tone ? ' tl-' + tone : '')},
      el('span', {class: 'tl-k', text: k}),
      el('span', {class: 'tl-v', text: v}));
    if (s2) box.append(el('span', {class: 'tl-s', text: s2}));
    return box;
  };
  const lead = el('div', {class: 'trans-lead'});
  const frOwn = fastRate(toOwn), fsOwn = fastSec(toOwn);
  const frOpp = fastRate(toOpp), fsOpp = fastSec(toOpp);
  if (frOwn !== null) {
    lead.append(item('自分のミス後に速攻を許した割合', Math.round(frOwn) + '%',
      `${toOwn.fast}/${toOwn.shots}本` + (fsOwn !== null ? `　相手のシュートまで中央値${fsOwn.toFixed(fsOwn % 1 ? 1 : 0)}秒` : ''), 'bad'));
  }
  if (frOpp !== null) {
    lead.append(item('相手のミス後に速攻で攻めた割合', Math.round(frOpp) + '%',
      `${toOpp.fast}/${toOpp.shots}本` + (fsOpp !== null ? `　自分のシュートまで中央値${fsOpp.toFixed(fsOpp % 1 ? 1 : 0)}秒` : ''), 'good'));
  }
  /* いちばん失点しやすい／得点しやすい切り替え（回数3以上のものから） */
  const best = (side) => {
    const rows = TRANS_KEYS.map(k => ({k, ...side[k]})).filter(r => r.n >= 3)
      .map(r => ({...r, rate: r.goals / r.n * 100}));
    if (rows.length < 2) return null;
    return rows.sort((a, b) => b.rate - a.rate)[0];
  };
  const worstDef = best(tr.afterOwn), bestAtk = best(tr.afterOpp);
  if (worstDef) {
    lead.append(item('最も失点しやすい切り替え',
      `${TRANS_SHORT[worstDef.k]}の直後 ${Math.round(worstDef.rate)}%`,
      `${worstDef.goals}/${worstDef.n}`));
  }
  if (bestAtk) {
    lead.append(item('最も得点しやすい切り替え',
      `相手の${TRANS_SHORT[bestAtk.k]}の直後 ${Math.round(bestAtk.rate)}%`,
      `${bestAtk.goals}/${bestAtk.n}`));
  }

  return el('div', {class: 'card'},
    el('h2', {text: title}),
    el('div', {class: 'sub',
      text: '直前の攻撃がどう終わったかで、次の攻撃の成否がどう変わるかを数えたものです。'
        + '「速攻率」は次の攻撃のシュートのうち速攻（FB）だった割合。'
        + '「シュートまでの中央値」は速攻とセット攻撃に分けた中央値です（外れ値に引きずられないため平均ではなく中央値）。'
        + 'ブレイクスルー（BT）は実測で中央値29秒とセット攻撃と変わらないため速攻に含めていません。'
        + 'ハーフの最初の攻撃など、直前の攻撃が無いものは含みません。' + (note ? ' ' + note : '')}),
    lead,
    el('div', {class: 'grid g2', style: {marginTop: '12px'}},
      el('div', {},
        el('div', {class: 'sec-title', text: '守備 — 自分の攻撃の終わり方別の失点'}),
        rateBars(tr.afterOwn, 'afterOwn'),
        el('div', {style: {marginTop: '10px'}}, tableFor(tr.afterOwn, 'afterOwn', defAttacks))),
      el('div', {},
        el('div', {class: 'sec-title', text: '攻撃 — 相手の攻撃の終わり方別の得点'}),
        rateBars(tr.afterOpp, 'afterOpp'),
        el('div', {style: {marginTop: '10px'}}, tableFor(tr.afterOpp, 'afterOpp', attacks)))),
    el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: '次の攻撃の速さ別の内訳'}),
    el('div', {class: 'sub', style: {margin: '-6px 0 10px'},
      text: '次の攻撃がどれだけ速かったかで3つに分けたものです。'
        + '公式が速攻（FB）と記録したもの、FBではないが20秒以内に打ったもの（2次速攻）、20秒を超えたもの。'
        + '20秒は所要時間の分布に出る谷から選んだしきい値で、公式の定義ではありません。'
        + '「中央値(秒)」にカーソルを合わせると平均と本数が出ます。'
        + 'ブレイクスルー（BT）は速さとは別の軸なのでここには出しません（位置別の内訳の表にあります）。'}),
    el('div', {class: 'sub', style: {margin: '0 0 4px', fontWeight: 700, color: 'var(--navy)'},
      text: '守備 — 失点の内訳'}),
    splitBlock(tr.afterOwn, 'afterOwn'),
    el('div', {class: 'sub', style: {margin: '14px 0 4px', fontWeight: 700, color: 'var(--navy)'},
      text: '攻撃 — 得点の内訳'}),
    splitBlock(tr.afterOpp, 'afterOpp'),
    el('div', {class: 'sub', style: {marginTop: '10px'},
      text: '回数が少ない状況（10回未満）の割合は大きく振れます。回数の列を必ず併せて見てください。'
        + (attacks > 0 || defAttacks > 0
          ? `　「50回あたり」の分母はチームの総攻撃回数${attacks ? '（' + attacks + '回）' : ''}`
            + `／総守備回数${defAttacks ? '（' + defAttacks + '回）' : ''}で、KPIと同じです。`
            + '切り替えで捉えられない攻撃（ハーフ最初の攻撃など）があるため、'
            + '合計はKPIの「50回あたり」より少し小さくなります。'
          : '')}));
}
