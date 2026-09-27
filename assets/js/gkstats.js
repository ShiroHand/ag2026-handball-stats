/* ==========================================================================
   gkstats.js — GK分析の計算部分

   ・位置 × コース別の大会平均決定率（男女別）
   ・そこから求める期待失点と GSAA（平均的なGKとの差）
   ・コースを「ニア／ファー × 高さ」に折り畳む変換

   公式データの制約:
     - コースは枠内に飛んだシュート（GOAL / SAVE）にしか付かない。
       枠外・ポストは位置別・速さ別には出せるが、コース別には出せない。
     - 速さの帯はシュートの約85%に付く（ハーフ最初の攻撃、
       オフェンスリバウンドからの再シュート、時刻が取れなかった数本を除く）。
   ========================================================================== */
import {n, pct} from './core.js';

export const COURSES = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'];
export const COURSE_LABEL = {
  TL: '左上', TC: '中上', TR: '右上',
  ML: '左中', MC: '中央', MR: '右中',
  BL: '左下', BC: '中下', BR: '右下',
};
export const ON_TARGET = new Set(['GOAL', 'SAVE']);

/* ポジション群。13区分のままだとGK個人では1セル1本になるのでまとめる。 */
export const POS_GROUPS = [
  {key: 'wing', label: 'ウイング', zones: ['LW', 'RW']},
  {key: 'six', label: '6m', zones: ['L6', 'C6', 'R6']},
  {key: 'nine', label: '9m', zones: ['L9', 'C9', 'R9']},
  {key: 'p7', label: '7m', zones: ['P7']},
  {key: 'fb', label: '速攻', zones: ['FB']},
  {key: 'bt', label: 'ブレイクスルー', zones: ['BT']},
  {key: 'other', label: 'スカイシュート・無人ゴール', zones: ['FLY', 'EG']},
];
const GROUP_OF = {};
POS_GROUPS.forEach(g => g.zones.forEach(z => GROUP_OF[z] = g.key));
export const groupOfZone = (z) => GROUP_OF[z] || 'other';

/* ---------------------------------------------------------------- ニア／ファー */
/* コースは絶対位置（左上〜右下）なので、左右のウイングを合算できない。
   シュート位置から見た「ニア（近いポスト側）／ファー（遠いポスト側）」に
   直すと左右を折り畳めて標本が倍になり、指導で使う言葉とも一致する。

   実測でもこの変換には意味がある（31試合）:
     左ウイング ファー98本 / ニア39本、右ウイング ファー133本 / ニア44本。

   コート図は「守備側から見た向き」で記録されているので、
   左サイド（LW/L6/L9）から見たファーは画面右、右サイドから見たファーは画面左になる。
   中央（C6/C9/P7）と速攻は左右の別が無いので「中央」として別扱いにする。 */
const LEFT_ZONES = new Set(['LW', 'L6', 'L9']);
const RIGHT_ZONES = new Set(['RW', 'R6', 'R9']);
export const NEARFAR = [
  {key: 'farT', label: 'ファー上'}, {key: 'farM', label: 'ファー中'}, {key: 'farB', label: 'ファー下'},
  {key: 'nearT', label: 'ニア上'}, {key: 'nearM', label: 'ニア中'}, {key: 'nearB', label: 'ニア下'},
  {key: 'cenT', label: '中央上'}, {key: 'cenM', label: '中央中'}, {key: 'cenB', label: '中央下'},
];
export function nearFar(zone, course) {
  if (!course) return '';
  const h = course[0] === 'T' ? 'T' : (course[0] === 'M' ? 'M' : 'B');
  const side = course[1];                       // L / C / R
  if (side === 'C') return 'cen' + h;
  if (LEFT_ZONES.has(zone)) return (side === 'R' ? 'far' : 'near') + h;
  if (RIGHT_ZONES.has(zone)) return (side === 'L' ? 'far' : 'near') + h;
  return 'cen' + h;                             // 中央・速攻は左右の別なし
}

/* ---------------------------------------------------------------- 参照表 */
/* 位置 × コース別の決定率。男女で水準が違うので分けて作る。
   セルは薄いので、位置別の平均へ、さらに全体平均へと2段で縮小する（経験ベイズ）。
     補正後 = (得点 + k × 上位階層の平均) / (本数 + k)
   k は「上位階層を何本分とみなすか」。k=12 は実測で
   1セルの中央値が20本前後なので、20本あれば実測が6割方を占める重み。 */
const SHRINK_K = 12;

export function buildRef(shots) {
  const cell = {}, byPos = {};
  let allG = 0, allN = 0;
  for (const s of shots) {
    if (!ON_TARGET.has(s.result) || !s.goalZone || !s.zone) continue;
    const g = s.result === 'GOAL' ? 1 : 0;
    const ck = s.zone + '|' + s.goalZone;
    (cell[ck] = cell[ck] || {n: 0, g: 0}).n++; cell[ck].g += g;
    (byPos[s.zone] = byPos[s.zone] || {n: 0, g: 0}).n++; byPos[s.zone].g += g;
    allN++; allG += g;
  }
  const base = allN ? allG / allN : 0.7;
  const posRate = {};
  for (const [z, v] of Object.entries(byPos)) posRate[z] = (v.g + SHRINK_K * base) / (v.n + SHRINK_K);
  const rate = {};
  for (const [k, v] of Object.entries(cell)) {
    const z = k.split('|')[0];
    rate[k] = (v.g + SHRINK_K * (posRate[z] ?? base)) / (v.n + SHRINK_K);
  }
  /* 縮小は極端なセルを平均へ引き寄せるので、実際のシュート分布で重みづけすると
     期待値の合計が実際の得点数と少しずれる（実測で +0.8ポイントほど上振れ）。
     そのまま使うと全GKの GSAA が一律にプラスへ寄るので、
     参照集合の上で合計が一致するように定数倍して較正する。 */
  let sumRate = 0;
  for (const s of shots) {
    if (!ON_TARGET.has(s.result) || !s.goalZone || !s.zone) continue;
    sumRate += rate[s.zone + '|' + s.goalZone] ?? base;
  }
  const cal = sumRate > 0 ? allG / sumRate : 1;

  return {cell, byPos, rate, posRate, base, cal, n: allN, g: allG,
    /* leave-one-out: そのGK自身のぶんを抜いた期待値。
       自分が止めた／決められたぶんが基準値に混ざるのを避ける。 */
    expect(zone, course, own) {
      const k = zone + '|' + course;
      const c = cell[k] || {n: 0, g: 0};
      const p = byPos[zone] || {n: 0, g: 0};
      const o = own || {cellN: 0, cellG: 0, posN: 0, posG: 0};
      const pn = Math.max(0, p.n - o.posN), pg = Math.max(0, p.g - o.posG);
      const pr = (pg + SHRINK_K * base) / (pn + SHRINK_K);
      const cn = Math.max(0, c.n - o.cellN), cg = Math.max(0, c.g - o.cellG);
      const r = (cg + SHRINK_K * pr) / (cn + SHRINK_K);
      return Math.min(0.995, r * cal);
    }};
}

/* ---------------------------------------------------------------- GKの集計 */
/* shots は「そのGKが浴びたシュート」。ref は同じ性別の参照表。 */
export function gkSummary(shots, ref) {
  /* xn / xg / xgoals は「コースが記録されていて期待値を出せたシュート」だけの集計。
     GSAA は必ずこの部分集合の中で引き算する。枠内でもコースが無いシュート（約9%）を
     失点にだけ数えて期待値に数えないと、GSAA が systematically マイナスに振れる。 */
  const out = {
    n: 0, onTarget: 0, saves: 0, goals: 0, off: 0,
    xn: 0, xg: 0, xgoals: 0, gsaa: 0,
    band: {}, group: {}, course: {}, nearfar: {}, posCourse: {},
  };
  const bump = (m, k) => (m[k] = m[k] || {n: 0, saves: 0, goals: 0, off: 0, xn: 0, xg: 0, xgoals: 0});

  /* leave-one-out 用に、このGKがセル・位置ごとに何本浴びたかを先に数える */
  const own = {};
  for (const s of shots) {
    if (!ON_TARGET.has(s.result) || !s.goalZone || !s.zone) continue;
    const k = s.zone + '|' + s.goalZone;
    const o = own[k] = own[k] || {cellN: 0, cellG: 0};
    o.cellN++; if (s.result === 'GOAL') o.cellG++;
  }
  const ownPos = {};
  for (const s of shots) {
    if (!ON_TARGET.has(s.result) || !s.goalZone || !s.zone) continue;
    const o = ownPos[s.zone] = ownPos[s.zone] || {posN: 0, posG: 0};
    o.posN++; if (s.result === 'GOAL') o.posG++;
  }

  for (const s of shots) {
    const zone = s.zone || '', res = s.result;
    const isGoal = res === 'GOAL', isSave = res === 'SAVE';
    const on = ON_TARGET.has(res);
    out.n++;
    if (on) out.onTarget++; else out.off++;
    if (isSave) out.saves++;
    if (isGoal) out.goals++;

    const x = (on && s.goalZone && zone)
      ? ref.expect(zone, s.goalZone, {...(own[zone + '|' + s.goalZone] || {}), ...(ownPos[zone] || {})})
      : null;
    if (x !== null) { out.xn++; out.xg += x; if (isGoal) out.xgoals++; }

    const add = (m, k) => {
      if (!k) return;
      const b = bump(m, k);
      b.n++;
      if (isSave) b.saves++; else if (isGoal) b.goals++; else b.off++;
      if (x !== null) { b.xn++; b.xg += x; if (isGoal) b.xgoals++; }
    };
    /* 帯が付かないシュート（ハーフ最初の攻撃、オフェンスリバウンドからの再シュートなど）は
       セット攻撃に含める。別建てにすると読みにくいうえ、大半はセットの攻撃なので。 */
    add(out.band, s.band || 'set');
    add(out.group, groupOfZone(zone));
    if (on && s.goalZone) {
      add(out.course, s.goalZone);
      add(out.nearfar, nearFar(zone, s.goalZone));
      add(out.posCourse, zone + '|' + s.goalZone);
    }
  }
  out.gsaa = out.xg - out.xgoals;
  return out;
}

/* 表示用の小物 */
export const saveRate = (o) => (o && o.n - o.off > 0 ? pct(o.saves, o.n - o.off) : '');
export const savePctNum = (o) => {
  const on = o ? o.n - o.off : 0;
  return on > 0 ? n(o.saves) / on * 100 : null;
};
