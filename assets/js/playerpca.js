/* ==========================================================================
   playerpca.js — 選手単位の主成分分析

   落とし穴と対策:
     全ポジションを混ぜてそのまま回すと、第1主成分が「ウイングらしさ ↔ バックらしさ」
     になってしまう。シュート位置・決定率・アシスト率のすべてがポジションで
     構造的に違うため、分析しなくても分かることが最大の分散として出てくる。
     そこで、ポジション群ごとに標準化してから合わせる（男女別の標準化と同じ発想）。

     群は ウイング(LW/RW) / サイドバック(LB/RB) / センター(CB) / ポスト(P) の4つ。
     左右は鏡像なので同じ群にまとめてよい。GKは別ページなので除く。

   標本の取り方:
     「選手×試合」だと1試合3〜4本しか打たないので割合がほとんど運になる。
     大会を通した累計を1人1行として扱う。
   ========================================================================== */
import {n, pct} from './core.js';
import {standardize} from './stats.js';

export const POS_GROUP = [
  {key: 'wing', label: 'ウイング', roles: ['LW', 'RW']},
  {key: 'back', label: 'サイドバック', roles: ['LB', 'RB']},
  {key: 'cb', label: 'センター', roles: ['CB']},
  {key: 'pivot', label: 'ポスト', roles: ['P', 'PV', 'LP']},
];
const GROUP_OF = {};
POS_GROUP.forEach(g => g.roles.forEach(r => GROUP_OF[r] = g.key));
export const groupOfRole = (r) => GROUP_OF[String(r || '').toUpperCase()] || '';

export const PLAYER_VARS = [
  {k: 'goals60', label: '60分あたり得点'},
  {k: 'shots60', label: '60分あたりシュート'},
  {k: 'shotPct', label: 'シュート決定率'},
  {k: 'assist60', label: '60分あたりアシスト'},
  {k: 'to60', label: '60分あたりミス'},
  {k: 'blocked', label: '被ブロック率'},
  {k: 'def60', label: '60分あたり守備関与'},
  {k: 'sevenM60', label: '60分あたり7m'},
  {k: 'fastShare', label: '速攻シュート比率'},
  {k: 'spread', label: 'コースの散らばり'},
];

/* コースの散らばり＝エントロピー。同じ隅ばかり狙う選手か、散らす選手か。
   9コースすべてを均等に打てば最大の log2(9)=3.17。 */
function entropy(counts) {
  const vals = Object.values(counts);
  const t = vals.reduce((a, b) => a + b, 0);
  if (t < 4) return null;                       // 4本未満では散らばりを語れない
  return -vals.reduce((a, v) => a + (v / t) * Math.log2(v / t), 0);
}

/* list: 対象試合。1人1行にまとめる。 */
export function buildPlayers(list) {
  const map = new Map();
  for (const f of list) {
    for (const code of Object.keys(f.teams)) {
      const t = f.teams[code];
      const evByBib = {};
      for (const e of t.events || []) {
        (evByBib[e.bib] = evByBib[e.bib] || {}).L = evByBib[e.bib].L || 0;
        evByBib[e.bib][e.type] = (evByBib[e.bib][e.type] || 0) + 1;
      }
      const shotsByBib = {};
      for (const s of t.shots || []) (shotsByBib[s.bib] = shotsByBib[s.bib] || []).push(s);

      for (const p of t.players || []) {
        const grp = groupOfRole(p.role);
        if (!grp) continue;                     // GK・不明は対象外
        const key = code + '|' + p.bib;
        const cur = map.get(key) || {key, code, bib: p.bib, gender: f.gender,
          name: p.nameS || p.name || p.bib, role: p.role, group: grp, reg: p.reg || '',
          games: 0, sec: 0, goals: 0, shots: 0, assists: 0, blocked: 0,
          blocks: 0, steals: 0, sevenM: 0, to: 0, fast: 0, tempoN: 0, course: {}};
        if (!cur.reg && p.reg) cur.reg = p.reg;
        const st = p.stats || {}, ev = evByBib[p.bib] || {};
        cur.games++;
        cur.sec += n(st.TIME_PLAYED);
        cur.goals += n(st.GOALS); cur.shots += n(st.SHOTS);
        cur.assists += n(st.ASSISTS); cur.blocked += n(st.BLOCKED);
        cur.blocks += n(st.BLOCKS); cur.steals += n(ev.S);
        cur.sevenM += n(ev['7G']) + n(ev['7X']);
        cur.to += n(ev.L);                       // 公式の選手別 TURNOVERS は全員0なのでイベントから数える
        if (p.tempo) {
          for (const b of ['fast', 'second', 'set']) cur.tempoN += n(p.tempo[b]?.s);
          cur.fast += n(p.tempo.fast?.s);
        }
        for (const s of shotsByBib[p.bib] || []) {
          if (s.goalZone) cur.course[s.goalZone] = (cur.course[s.goalZone] || 0) + 1;
        }
        map.set(key, cur);
      }
    }
  }
  const out = [];
  for (const p of map.values()) {
    const min = p.sec / 60;
    if (min <= 0) continue;
    const per = (v) => v / min * 60;
    p.min = min;
    p.vals = {
      goals60: per(p.goals),
      shots60: per(p.shots),
      shotPct: p.shots ? p.goals / p.shots * 100 : 0,
      assist60: per(p.assists),
      to60: per(p.to),
      blocked: p.shots ? p.blocked / p.shots * 100 : 0,
      def60: per(p.blocks + p.steals),
      sevenM60: per(p.sevenM),
      fastShare: p.tempoN ? p.fast / p.tempoN * 100 : 0,
      spread: entropy(p.course),
    };
    out.push(p);
  }
  return out;
}

/* ポジション群の中で標準化してから合わせる。
   群内の人数が少ないと標準化が不安定なので、4人未満の群は落とす。
   spread が取れない選手は群の平均（＝標準化後の0）で埋める。 */
export function zWithinGroup(rows, vars) {
  const out = new Array(rows.length);
  const groups = [...new Set(rows.map(r => r.group))];
  const kept = [];
  for (const g of groups) {
    const idx = rows.map((r, i) => (r.group === g ? i : -1)).filter(i => i >= 0);
    if (idx.length < 4) continue;
    /* 欠損（spread=null）は群の平均で埋めてから標準化する */
    const fill = {};
    for (const v of vars) {
      const xs = idx.map(i => rows[i].vals[v.k]).filter(x => Number.isFinite(x));
      fill[v.k] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    }
    const mat = idx.map(i => vars.map(v => {
      const x = rows[i].vals[v.k];
      return Number.isFinite(x) ? x : fill[v.k];
    }));
    const {z} = standardize(mat);
    idx.forEach((i, k) => { out[i] = z[k]; kept.push(i); });
  }
  const keep = kept.sort((a, b) => a - b);
  return {z: keep.map(i => out[i]), rows: keep.map(i => rows[i])};
}
