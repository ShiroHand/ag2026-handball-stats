/* ==========================================================================
   contrib.js — 攻撃の貢献度（得点換算）

   違う種類のプレーを足すには、すべてを「点」に換算する共通の単位が要る。
   バスケの BPM やサッカーの VAEP と同じ考え方で、ハンドボール版の換算レートを
   大会データそのものから推定する（固定値を埋め込まない。試合が増えれば更新される）。

   ■ プレーの値段の出し方
     自分の攻撃がどう終わったかで、相手の次の攻撃の得点率が変わる（実測）:
       ミスで失った 62% / セーブ 56% / 枠外・ポスト 54% / 自分が得点 45%
     そこで、終わり方 k の得失点差への寄与を
       V(k) = (k が得点なら 1、それ以外 0) − (その直後に相手が得点する割合)
     と定義し、全ポゼッションの平均 V̄ を基準にする。
       ターンオーバーの損 = V̄ − V(TO)  … 実測で約 0.64点

   ■ アシストを合算しない理由
     公式のアシストは「得点に直結したパス」と定義されているため、
     ほぼ得点にしか記録されない（アシスト有の決定率 98.7% / 無 41.9%）。
     この差はパスの巧拙ではなく定義による循環なので、点に換算できない。
     別列で本数を並記する。

   ■ 記録されていないもの
     ブロック0.5回・スティール0.9回（1選手あたり大会累計）しか記録が無く、
     スクリーン、7mを獲得する動き、守備のポジショニングは1つも入らない。
     したがってこれは「総合評価」ではなく「攻撃の一部の貢献度」である。
   ========================================================================== */
import {n} from './core.js';
import {ON_TARGET, buildRef} from './gkstats.js';

export const POS_GROUP = [
  {key: 'wing', label: 'ウイング', roles: ['LW', 'RW']},
  {key: 'back', label: 'サイドバック', roles: ['LB', 'RB']},
  {key: 'cb', label: 'センター', roles: ['CB']},
  {key: 'pivot', label: 'ポスト', roles: ['P', 'PV', 'LP']},
];
const GROUP_OF = {};
POS_GROUP.forEach(g => g.roles.forEach(r => GROUP_OF[r] = g.key));
export const groupOfRole = (r) => GROUP_OF[String(r || '').toUpperCase()] || 'other';
export const groupLabel = (k) => (POS_GROUP.find(g => g.key === k) || {}).label || 'その他';

/* ---------------------------------------------------------------- 換算レート */
export function costModel(list, gender) {
  const use = list.filter(f => !gender || f.gender === gender);
  let atk = 0, goals = 0;
  const end = {GOAL: {n: 0, g: 0}, SAVE: {n: 0, g: 0}, POST: {n: 0, g: 0}, TO: {n: 0, g: 0}};
  let suspN = 0, suspAg = 0, suspFor = 0;
  for (const f of use) {
    for (const code of Object.keys(f.teams)) {
      const t = f.teams[code];
      atk += n(t.possessions?.attacks); goals += n(t.possessions?.goals);
      const tr = t.transitions?.afterOwn;
      if (tr) for (const k of Object.keys(end)) {
        const e = tr[k]; if (!e) continue;
        end[k].n += n(e.n); end[k].g += n(e.goals);
      }
      const s = t.suspension;
      if (s) { suspN += n(s.own.n); suspAg += n(s.own.against); suspFor += n(s.own.forGoals); }
    }
  }
  const p = (k) => (end[k].n ? end[k].g / end[k].n : 0.5);
  const V = {GOAL: 1 - p('GOAL'), SAVE: -p('SAVE'), POST: -p('POST'), TO: -p('TO')};
  const tot = Object.keys(end).reduce((a, k) => a + end[k].n, 0) || 1;
  const vBar = Object.keys(end).reduce((a, k) => a + end[k].n * V[k], 0) / tot;
  return {
    ev: atk ? goals / atk : 0.5,
    pTO: p('TO'), pSave: p('SAVE'), pPost: p('POST'), pGoal: p('GOAL'),
    vBar, V,
    toCost: vBar - V.TO,
    suspCost: suspN ? (suspAg - suspFor) / suspN : 0.6,
    suspN,
  };
}

/* ---------------------------------------------------------------- 選手別 */
/* list は集計対象の試合、refList は参照表を作るための試合（通常は同カテゴリ全試合）。 */
export function buildContrib(list, refList, cost) {
  const all = [];
  refList.forEach(f => {
    for (const c of Object.keys(f.teams)) all.push(...(f.teams[c].shots || []));
  });
  const ref = buildRef(all);

  const map = new Map();
  for (const f of list) {
    for (const code of Object.keys(f.teams)) {
      const t = f.teams[code];
      const ev = {};
      for (const e of t.events || []) (ev[e.bib] = ev[e.bib] || {})[e.type] = (ev[e.bib][e.type] || 0) + 1;
      const susp = {};
      for (const p of (t.suspension?.players || [])) susp[p.bib] = n(p.n);
      for (const p of t.players || []) {
        if (/^(gk|g)$/i.test(p.role || '')) continue;
        const key = code + '|' + p.bib;
        const c = map.get(key) || {key, code, bib: p.bib, name: p.nameS || p.name || p.bib,
          role: p.role, group: groupOfRole(p.role), reg: p.reg || '', games: 0,
          sec: 0, shots: 0, goals: 0, assists: 0, to: 0, susp: 0,
          xg: 0, xn: 0, xgoals: 0, varSum: 0, shotList: []};
        if (!c.reg && p.reg) c.reg = p.reg;
        c.games++;
        c.sec += n(p.stats?.TIME_PLAYED);
        c.shots += n(p.stats?.SHOTS); c.goals += n(p.stats?.GOALS);
        c.assists += n(p.stats?.ASSISTS);
        c.to += n((ev[p.bib] || {}).L);
        c.susp += n(susp[p.bib]);
        map.set(key, c);
      }
      for (const s of t.shots || []) {
        const c = map.get(code + '|' + s.bib);
        if (c) c.shotList.push(s);
      }
    }
  }

  const out = [];
  for (const c of map.values()) {
    /* 期待得点は leave-one-out（自分のぶんを基準から抜く）で出す */
    const ownCell = {}, ownPos = {};
    for (const s of c.shotList) {
      if (!ON_TARGET.has(s.result) || !s.goalZone || !s.zone) continue;
      const k = s.zone + '|' + s.goalZone;
      const a = ownCell[k] = ownCell[k] || {cellN: 0, cellG: 0};
      a.cellN++; if (s.result === 'GOAL') a.cellG++;
      const b = ownPos[s.zone] = ownPos[s.zone] || {posN: 0, posG: 0};
      b.posN++; if (s.result === 'GOAL') b.posG++;
    }
    for (const s of c.shotList) {
      if (!ON_TARGET.has(s.result) || !s.goalZone || !s.zone) continue;
      const p = ref.expect(s.zone, s.goalZone,
        {...(ownCell[s.zone + '|' + s.goalZone] || {}), ...(ownPos[s.zone] || {})});
      c.xg += p; c.xn++; c.varSum += p * (1 - p);
      if (s.result === 'GOAL') c.xgoals++;
    }
    const min = c.sec / 60;
    const gae = c.xgoals - c.xg;
    const toLoss = -cost.toCost * c.to;
    const spLoss = -cost.suspCost * c.susp;
    const total = gae + toLoss + spLoss;
    out.push({...c, min, gae, toLoss, spLoss, total,
      per60: min > 0 ? total / min * 60 : 0,
      se: Math.sqrt(c.varSum + cost.toCost ** 2 * c.to + cost.suspCost ** 2 * c.susp),
    });
  }
  return out;
}

/* ポジション群ごとの60分あたり平均。比較の基準にする。
   ウイングはボールに触る回数が少ないのでミスが少なく、センターは常に持つので多い。
   素の合計で並べるとポジションで順位が決まってしまうため、この補正が要る。 */
export function groupMeans(rows, minShots = 10, minMin = 40) {
  /* ポジションが取れない選手（'other'）は基準にしない。人数が少なく不安定なため。 */
  const pool = rows.filter(r => r.shots >= minShots && r.min >= minMin && r.group !== 'other');
  const sum = {}, cnt = {};
  pool.forEach(r => { sum[r.group] = (sum[r.group] || 0) + r.per60; cnt[r.group] = (cnt[r.group] || 0) + 1; });
  const out = {};
  for (const k of Object.keys(sum)) out[k] = {mean: sum[k] / cnt[k], n: cnt[k]};
  return out;
}
