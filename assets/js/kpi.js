/* ==========================================================================
   kpi.js — 攻撃・守備の要点を同じ定義で並べる

   どのページでも同じ計算になるように、集計の素材（counts）を渡す形にしている。
   counts: {attacks, goals, turnovers, shots, onTarget, offTarget, blocked, assists}
   ========================================================================== */
import {el, flagImg} from './core.js';

export const rate = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '–');

/* 1試合ぶん / 累計ぶんの素材を、チームデータから取り出す。
   side='att' は自分の攻撃、side='def' は相手にやられた側（＝自分の守備）。 */
export function countsFromTeam(t, {officialAttacks = null} = {}) {
  const st = t.stats || {}, po = t.possessions || {};
  const res = {};
  for (const s of t.shots || []) res[s.result] = (res[s.result] || 0) + 1;
  const hasPlay = (t.shots || []).length > 0;
  return {
    hasPlay,
    attacks: Number(officialAttacks) || Number(po.attacks) || 0,
    officialAttacks: !!officialAttacks,
    goals: Number(st.GOALS) || Number(po.goals) || 0,
    turnovers: Number(po.turnovers) || 0,
    shots: Number(st.SHOTS) || 0,
    onTarget: (res.GOAL || 0) + (res.SAVE || 0),
    offTarget: (res.POST || 0) + (res.MISS || 0),
    blocked: Number(t.derived?.blocked) || 0,
    assists: Number(t.derived?.assists) || Number(po.assists) || 0,
  };
}

export function addCounts(a, b) {
  const out = {...a};
  for (const k of ['attacks', 'goals', 'turnovers', 'shots', 'onTarget', 'offTarget', 'blocked', 'assists']) {
    out[k] = (a[k] || 0) + (b[k] || 0);
  }
  out.hasPlay = a.hasPlay || b.hasPlay;
  out.officialAttacks = a.officialAttacks && b.officialAttacks;
  return out;
}
export const emptyCounts = () => ({hasPlay: false, officialAttacks: false,
  attacks: 0, goals: 0, turnovers: 0, shots: 0, onTarget: 0, offTarget: 0, blocked: 0, assists: 0});

/* 守備側の言い方に読み替える */
const LABELS = {
  att: ['攻撃回数', '得点', 'ターンオーバー', '攻撃効率', 'ターンオーバー率',
    'シュート数', '枠内シュート', '枠外・ポスト', 'アシスト', 'アシスト率'],
  def: ['被攻撃回数', '失点', '相手のターンオーバー', '被攻撃効率', '相手のTO率',
    '被シュート数', '枠内被シュート', '相手の枠外・ポスト', '被アシスト', '被アシスト率'],
};

/* 50回の攻撃あたりに換算した得点。
   試合のテンポ（攻撃回数の多さ）に左右されずに攻守の質を比べられる。
   ハンドボールの1試合はおおよそ50攻撃なので、「1試合あたり何点」に近い感覚で読める。 */
export const PER = 50;
export const per50 = (goals, attacks) => (attacks > 0 ? goals / attacks * PER : null);
export const showPer50 = (v) => (v === null ? '–' : v.toFixed(1));

export function kpiList(c, side = 'att', opp = null) {
  const L = LABELS[side] || LABELS.att;
  const p = c.hasPlay;
  /* side='att' なら c が自分の攻撃・opp が自分の守備（相手の攻撃）。
     side='def' なら c が自分の守備・opp が自分の攻撃。 */
  const attC = side === 'def' ? opp : c;
  const defC = side === 'def' ? c : opp;
  const scored = attC ? per50(attC.goals, attC.attacks) : null;
  const conceded = defC ? per50(defC.goals, defC.attacks) : null;
  const extra = [];
  if (scored !== null) {
    extra.push({k: `${PER}攻撃あたり得点`, v: showPer50(scored), s: '攻撃効率 × 50'});
  }
  if (conceded !== null) {
    extra.push({k: `${PER}守備あたり失点`, v: showPer50(conceded), s: '被攻撃効率 × 50'});
  }
  if (scored !== null && conceded !== null) {
    const d = scored - conceded;
    extra.push({k: `差引（${PER}回あたり）`, v: (d >= 0 ? '+' : '') + d.toFixed(1),
      s: '得点 − 失点。プラスが大きいほど強い'});
  }
  return [
    {k: L[0], v: c.attacks || '–', s: c.officialAttacks ? '公式レポート' : 'プレーバイプレーから算出'},
    {k: L[1], v: c.goals},
    {k: L[2], v: p ? c.turnovers : '–'},
    {k: L[3], v: rate(c.goals, c.attacks), s: `${L[1]} ÷ ${L[0]}`},
    {k: L[4], v: p ? rate(c.turnovers, c.attacks) : '–', s: `TO ÷ ${L[0]}`},
    {k: L[5], v: c.shots, s: p ? `枠内${c.onTarget}・枠外${c.offTarget}・ブロック${c.blocked}` : ''},
    {k: L[6], v: p ? c.onTarget : '–', s: p ? rate(c.onTarget, c.shots) + ' / 全シュート' : ''},
    {k: L[7], v: p ? c.offTarget : '–', s: p ? rate(c.offTarget, c.shots) + ' / 全シュート' : ''},
    {k: L[8], v: c.assists},
    {k: L[9], v: rate(c.assists, c.goals), s: `${L[8]} ÷ ${L[1]}`},
    ...extra,
  ];
}

/* KPI タイルを並べる */
export function kpiGrid(counts, side = 'att', opp = null) {
  const grid = el('div', {class: 'kpi-grid'});
  kpiList(counts, side, opp).forEach(m => {
    const tile = el('div', {class: 'kpi' + (m.k.startsWith('差引') ? ' kpi-hi' : '')},
      el('div', {class: 'k', text: m.k}),
      el('div', {class: 'v', text: m.v}),
      m.s ? el('div', {class: 's', text: m.s}) : null);
    grid.append(tile);
  });
  return grid;
}

/* 見出し（国旗つき）＋タイル */
export function kpiBlock(counts, {code = '', name = '', side = 'att', opp = null} = {}) {
  return el('div', {},
    name ? el('div', {class: 'row', style: {gap: '8px', margin: '0 0 8px'}},
      code ? flagImg(code, 'flag sm') : null,
      el('span', {style: {fontWeight: 700, color: 'var(--navy)'}, text: name})) : null,
    kpiGrid(counts, side, opp));
}

export const KPI_NOTE = '攻撃回数・ターンオーバーは公式プレーバイプレーから算出した推定値です'
  + '（公式PDFレポートがある試合はその攻撃回数を使用）。枠内 + 枠外 + ブロック = シュート数。';
