/* ==========================================================================
   transitions.js — 攻守の切り替え（直前の攻撃の終わり方 → 次の攻撃の成否）

   afterOwn: 自分の攻撃がこう終わった直後、相手はどうだったか（= 自分の失点）
   afterOpp: 相手の攻撃がこう終わった直後、自分はどうだったか（= 自分の得点）
   ========================================================================== */
import {el, n, pct, tip} from './core.js';
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

export const emptyTrans = () => ({
  afterOwn: Object.fromEntries(TRANS_KEYS.map(k => [k, {n: 0, goals: 0}])),
  afterOpp: Object.fromEntries(TRANS_KEYS.map(k => [k, {n: 0, goals: 0}])),
});

export function addTrans(a, b) {
  const out = emptyTrans();
  for (const side of ['afterOwn', 'afterOpp']) {
    for (const k of TRANS_KEYS) {
      out[side][k].n = n(a?.[side]?.[k]?.n) + n(b?.[side]?.[k]?.n);
      out[side][k].goals = n(a?.[side]?.[k]?.goals) + n(b?.[side]?.[k]?.goals);
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

const totalOf = (side) => TRANS_KEYS.reduce((a, k) => ({
  n: a.n + n(side?.[k]?.n), goals: a.goals + n(side?.[k]?.goals),
}), {n: 0, goals: 0});

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
  head.push('全体に占める割合');
  table.append(el('thead', {}, el('tr', {}, head.map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  TRANS_KEYS.forEach(k => {
    const v = side?.[k] || {n: 0, goals: 0};
    const rate = v.n > 0 ? v.goals / v.n * 100 : null;
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

/* ---------- カード本体 ---------- */
export function transitionCard(tr, {title = '攻守の切り替え', note = '',
  attacks = 0, defAttacks = 0} = {}) {
  const own = totalOf(tr.afterOwn), opp = totalOf(tr.afterOpp);
  if (!own.n && !opp.n) {
    return el('div', {class: 'card'}, el('h2', {text: title}),
      el('div', {class: 'empty', text: 'プレーバイプレーが未取得のため表示できません。'}));
  }
  /* いちばん差が出ている状況を見出しに出す */
  const best = (side, which) => {
    const rows = TRANS_KEYS.map(k => ({k, ...side[k]}))
      .filter(r => r.n >= 3)
      .map(r => ({...r, rate: r.goals / r.n * 100}));
    if (rows.length < 2) return null;
    rows.sort((a, b) => b.rate - a.rate);
    return which === 'afterOwn' ? rows[0] : rows[0];
  };
  const worstDef = best(tr.afterOwn, 'afterOwn');
  const bestAtk = best(tr.afterOpp, 'afterOpp');

  const lead = el('div', {class: 'trans-lead'});
  if (worstDef) {
    lead.append(el('div', {class: 'trans-lead-item'},
      el('span', {class: 'tl-k', text: '最も失点しやすい切り替え'}),
      el('span', {class: 'tl-v', text: `${TRANS_SHORT[worstDef.k]}の直後 ${Math.round(worstDef.rate)}%`}),
      el('span', {class: 'tl-s', text: `${worstDef.goals}/${worstDef.n}`})));
  }
  if (bestAtk) {
    lead.append(el('div', {class: 'trans-lead-item'},
      el('span', {class: 'tl-k', text: '最も得点しやすい切り替え'}),
      el('span', {class: 'tl-v', text: `相手の${TRANS_SHORT[bestAtk.k]}の直後 ${Math.round(bestAtk.rate)}%`}),
      el('span', {class: 'tl-s', text: `${bestAtk.goals}/${bestAtk.n}`})));
  }

  return el('div', {class: 'card'},
    el('h2', {text: title}),
    el('div', {class: 'sub',
      text: '直前の攻撃がどう終わったかで、次の攻撃の成否がどう変わるかを数えたものです。'
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
    el('div', {class: 'sub', style: {marginTop: '10px'},
      text: '回数が少ない状況（10回未満）の割合は大きく振れます。回数の列を必ず併せて見てください。'
        + (attacks > 0 || defAttacks > 0
          ? `　「50回あたり」の分母はチームの総攻撃回数${attacks ? '（' + attacks + '回）' : ''}`
            + `／総守備回数${defAttacks ? '（' + defAttacks + '回）' : ''}で、KPIと同じです。`
            + '切り替えで捉えられない攻撃（ハーフ最初の攻撃など）があるため、'
            + '合計はKPIの「50回あたり」より少し小さくなります。'
          : '')}));
}
