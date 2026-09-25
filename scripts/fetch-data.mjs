#!/usr/bin/env node
/* ==========================================================================
   fetch-data.mjs
   公式リザルトAPI (results.asiangames2026.org) からハンドボールのデータを取得し、
   data/ 配下の JSON を上書き更新する。依存パッケージなし / Node 18+。

     node scripts/fetch-data.mjs                  # 全日程を更新
     node scripts/fetch-data.mjs --day 2026-09-22 # 指定日のみ
     node scripts/fetch-data.mjs --force          # 差分がなくても書き出す
     node scripts/fetch-data.mjs --bundle f.json  # 取得済みバンドルから再生成（オフライン）

   ※ レスポンスは zlib deflate ストリームだが latin1→utf8 で再エンコードされて返るため、
     そのまま展開できない場合はバイト列に戻してから展開する。
   ========================================================================== */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://back.results.asiangames2026.org/s/AG2026/en';
const DISC = 'HBL';
const DATA = path.join(ROOT, 'data');

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const FORCE = argv.includes('--force');
const ONLY_DAY = argOf('--day');
const BUNDLE = argOf('--bundle');

/* ---------------------------------------------------------------- fetching */
async function api(p, {optional = false} = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API + p, {headers: {accept: 'application/json'}});
      if (res.status === 404 || res.status === 400) {
        if (optional) return null;
        throw new Error(`HTTP ${res.status} ${p}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${p}`);
      return JSON.parse(inflate(Buffer.from(await res.arrayBuffer())).toString('utf8'));
    } catch (e) {
      if (attempt === 3) { if (optional) return null; throw e; }
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
}
function inflate(buf) {
  for (const f of [
    () => zlib.inflateSync(buf),
    () => zlib.inflateSync(Buffer.from(buf.toString('utf8'), 'latin1')),
    () => zlib.gunzipSync(buf),
    () => zlib.inflateRawSync(buf),
  ]) { try { return f(); } catch {} }
  return buf;
}

/* ---------------------------------------------------------------- helpers */
const S = (v) => (v === null || v === undefined) ? '' : String(v);
const N = (v) => { const x = parseFloat(String(v ?? '').replace('%', '')); return Number.isFinite(x) ? x : 0; };

export function unitId(key) {
  const p = String(key).split('.');
  const trim = (s) => S(s).replace(/-+$/, '') || '0';
  return [trim(p[0]), trim(p[2]), trim(p[3])].filter(Boolean).join('-');
}

/* 保持するスタッツキー */
const KEEP = [
  /^ST_(GOALS|SHOTS|EFFICIENCY|ASSISTS|ATTACKS|BLOCKS|BLOCKED|STEALS|TURNOVERS|EXCLUSIONS|2MINUTES|2P2MINUTES|YELLOW_CARDS|RED_CARDS|DIRECT_RED_CARDS|FIELD_GOALS|FIELD_SHOTS|FIELD_GOALS_PERCENT|COURTPLAYER_CHANGES|COURTPLAYER_BY_GOALKEEPER|FAIRPLAY_POINTS)$/,
  /^ST_(6M|9M|7M|BT|FB|FFB|EG|FLY|WING)(_(LEFT|RIGHT|CENTER)(_WING)?)?_(GOALS|SHOTS|SAVES|POST|MISSED|BLOCKED|FAULT)$/,
  /^ST_GK_[A-Z0-9_]+_(SAVES|SHOTS|GOALS|TOTAL_SHOTS)$/,
  /^ST_GK_(SAVES|SHOTS|GOALS|SAVES_PERCENT)$/,
  /^ST_GK_(SAVES|GOALS)_(TOP|MID|BOT)_(LEFT|CENTER|RIGHT)_SHOTS$/,
  /^ST_TIME[A-Z_]*$/,
];
function slimStats(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats || {})) {
    if (v === '' || v === null || v === undefined) continue;
    const kk = k.startsWith('ST_') ? k : 'ST_' + k;          // バンドル経由は接頭辞を除去済み
    if (KEEP.some(rx => rx.test(kk))) out[kk.replace(/^ST_/, '')] = v;
  }
  return out;
}

/* シュート位置 → 公式スタッツ接頭辞 */
export const ZONES = {
  LW: '6M_LEFT_WING', L6: '6M_LEFT', C6: '6M_CENTER', R6: '6M_RIGHT', RW: '6M_RIGHT_WING',
  L9: '9M_LEFT', C9: '9M_CENTER', R9: '9M_RIGHT', P7: '7M', EG: 'EG',
  BT: 'BT', FB: 'FB', FLY: 'FLY',
};
function shotMap(st) {
  const m = {};
  for (const [k, p] of Object.entries(ZONES)) m[k] = {g: N(st[p + '_GOALS']), s: N(st[p + '_SHOTS'])};
  return m;
}
function gkMap(st) {
  const m = {};
  for (const [k, p] of Object.entries(ZONES)) {
    const sv = N(st['GK_' + p + '_SAVES']);
    const sh = N(st['GK_' + p + '_SHOTS']) || N(st['GK_' + p + '_TOTAL_SHOTS']);
    m[k] = {sv, s: sh, g: Math.max(0, sh - sv)};
  }
  return m;
}
const extVal = (arr, rx) => S((arr || []).find(e => rx.test(S(e.Code)))?.Value ?? '');

/* ゴールマウス 3×3（GKのみ保持される）: "made/shots" 形式 */
const ROWS = ['TOP', 'MID', 'BOT'], COLS = ['LEFT', 'CENTER', 'RIGHT'];
const frac = (v) => {
  const m = String(v ?? '').match(/(-?\d+)\s*\/\s*(-?\d+)/);
  return m ? {a: +m[1], b: +m[2]} : {a: 0, b: 0};
};
function goalZone(st, kind /* 'SAVES' | 'GOALS' */) {
  return ROWS.map(r => COLS.map(c => {
    const f = frac(st[`GK_${kind}_${r}_${c}_SHOTS`]);
    return kind === 'SAVES' ? {sv: f.a, s: f.b, g: Math.max(0, f.b - f.a)} : {g: f.a, s: f.b};
  }));
}
function sumZone(list, keys) {
  return ROWS.map((_, r) => COLS.map((_, c) => {
    const o = Object.fromEntries(keys.map(k => [k, 0]));
    for (const z of list) for (const k of keys) o[k] += N(z?.[r]?.[c]?.[k]);
    return o;
  }));
}
const zoneEmpty = (z) => z.every(r => r.every(c => !N(c.s)));

/* ---------------------------------------------------------------- プレーバイプレー */
/* アクションコード → シュート位置キー */
const ACT_ZONE = {
  LW: 'LW', LSD: 'L6', CSD: 'C6', RSD: 'R6', RW: 'RW',
  LLD: 'L9', CLD: 'C9', RLD: 'R9', PTY: 'P7', EG: 'EG',
  BT: 'BT', FB: 'FB', FLY: 'FLY',
};
/* ゴールマウスのコース記号 → [行, 列] */
const GZ = {TL: [0, 0], TC: [0, 1], TR: [0, 2], ML: [1, 0], MC: [1, 1], MR: [1, 2],
  BL: [2, 0], BC: [2, 1], BR: [2, 2]};

/* 選手ポジションの正規化（連携図のノード） */
const ROLE_NODE = {
  GK: 'GK', G: 'GK',
  LW: 'LW', RW: 'RW', LB: 'LB', RB: 'RB', CB: 'CB',
  P: 'PV', PV: 'PV', LP: 'PV',
};
const roleNode = (r) => ROLE_NODE[S(r).toUpperCase()] || 'OTH';

/* API/バンドル両対応で 1 アクションを正規化 */
function normAction(a) {
  if (a.ac !== undefined) return a;                     // バンドル（取得済み）形式
  const e = (c) => S((a.Extensions || []).find(x => x.Code === c)?.Value);
  return {
    o: a.Order, p: S(a.Period), t: S(a.TimeStamp), ac: S(a.Action), ad: S(a.ActionDesc),
    r: S(a.Result), rd: S(a.ResultDesc), tm: S(a.Team), sh: S(a.ScoreH), sa: S(a.ScoreA),
    gz: e('ActionGoalZone'), gk: e('ActionDataGoalkeeper'),
    asN: e('ActionAssistant'), asR: e('ActionAssistantReg'),
    c: (a.Competitors || []).map(c => ({reg: S(c.Reg), bib: S(c.Bib), org: S(c.Org), n: S(c.NameS || c.Name)})),
  };
}

/* 時刻 "MM:SS" + ピリオド → 試合開始からの絶対秒 */
function absSec(period, stamp) {
  const p = parseInt(period, 10) || 1;
  const [mm, ss] = S(stamp).split(':').map(x => parseInt(x, 10) || 0);
  const base = p <= 2 ? (p - 1) * 30 * 60 : 60 * 60 + (p - 3) * 5 * 60;
  return base + mm * 60 + ss;
}
const BUCKET = 5 * 60;
const bucketLabel = (sec) => {
  const b = Math.floor(sec / BUCKET) * 5;
  return `${b}-${b + 5}`;
};

/* ポゼッション・リバウンド・数的状況・時間帯を組み立てる */
function buildPossessions(acts, teams, orgs) {
  const RECOVERED = new Set(['SAVE', 'POST', 'BLC']);   // 守備側がボールを回収し得る結末
  const blank = () => ({attacks: 0, goals: 0, shots: 0, missed: 0, saves: 0,
    turnovers: 0, twoMin: 0, assists: 0, offReb: 0, defReb: 0});
  const T = {};
  orgs.forEach(o => T[o] = {
    poss: blank(), timeline: new Map(),
    sit: {equal: blank(), up: blank(), down: blank()},
    sitDef: {equal: blank(), up: blank(), down: blank()},
    emptyGoal: {shotsFor: 0, goalsFor: 0, shotsAgainst: 0, goalsAgainst: 0},
  });
  const other = (o) => orgs.find(x => x !== o);
  const tl = (o, sec) => {
    const k = bucketLabel(sec);
    if (!T[o].timeline.has(k)) T[o].timeline.set(k, {bucket: k, ...blank()});
    return T[o].timeline.get(k);
  };

  /* 退場区間（2分）を先に集める */
  const susp = [];
  acts.forEach(a => {
    if (a.ac !== 'TMS') return;
    const org = a.c[0]?.org;
    if (!org) return;
    const s = absSec(a.p, a.t);
    susp.push({org, from: s, to: s + 120});
  });
  const shortOf = (org, sec) => susp.filter(x => x.org === org && sec >= x.from && sec < x.to).length;
  const sitKey = (org, sec) => {
    const d = shortOf(other(org), sec) - shortOf(org, sec);
    return d > 0 ? 'up' : (d < 0 ? 'down' : 'equal');
  };

  let cur = null;                       // 現在のポゼッション
  const closePoss = () => {
    if (!cur) return;
    const last = cur.shots[cur.shots.length - 1];
    if (last && RECOVERED.has(last.r)) {
      const opp = other(cur.org);
      if (opp) { T[opp].poss.defReb++; tl(opp, last.sec).defReb++; }
    }
    cur = null;
  };

  for (const a of acts) {
    const org = a.c[0]?.org;
    const sec = absSec(a.p, a.t);

    if (a.ac === 'ATTACK') {
      closePoss();
      if (org && T[org]) {
        const opp = other(org);
        /* 攻撃開始時点の人数差でそのポゼッション全体を分類する（回数と得点の分母を揃えるため） */
        cur = {org, shots: [], sec, kAtt: sitKey(org, sec), kDef: opp ? sitKey(opp, sec) : 'equal'};
        T[org].poss.attacks++;
        tl(org, sec).attacks++;
        T[org].sit[cur.kAtt].attacks++;
        if (opp) T[opp].sitDef[cur.kDef].attacks++;
      }
      continue;
    }
    if (a.ac === 'ENDP') { closePoss(); continue; }
    if (a.ac === 'TO' && org && T[org]) { T[org].poss.turnovers++; tl(org, sec).turnovers++; closePoss(); continue; }
    if (a.ac === 'TMS' && org && T[org]) { T[org].poss.twoMin++; tl(org, sec).twoMin++; continue; }
    if (a.ac === 'ASS' && org && T[org]) { T[org].poss.assists++; tl(org, sec).assists++; continue; }

    const zone = ACT_ZONE[a.ac];
    if (!zone || !org || !T[org]) continue;

    const opp = other(org);
    const goal = a.r === 'GOAL';
    const row = tl(org, sec);
    T[org].poss.shots++; row.shots++;
    if (goal) { T[org].poss.goals++; row.goals++; }
    else { T[org].poss.missed++; row.missed++; }
    if (a.r === 'SAVE' && opp) { T[opp].poss.saves++; tl(opp, sec).saves++; }

    /* 数的状況（そのシュートが属する攻撃の開始時点で分類） */
    const inPoss = cur && cur.org === org;
    const k = inPoss ? cur.kAtt : sitKey(org, sec);
    const st2 = T[org].sit[k];
    st2.shots++; if (goal) st2.goals++; else st2.missed++;
    if (opp) {
      const kd = inPoss ? cur.kDef : sitKey(opp, sec);
      const sd = T[opp].sitDef[kd];
      sd.shots++; if (goal) sd.goals++; else sd.missed++;
    }

    /* 無人ゴール（相手がGKを下げていた局面の結果） */
    if (a.ac === 'EG') {
      T[org].emptyGoal.shotsFor++; if (goal) T[org].emptyGoal.goalsFor++;
      if (opp) { T[opp].emptyGoal.shotsAgainst++; if (goal) T[opp].emptyGoal.goalsAgainst++; }
    }

    /* オフェンスリバウンド: 同じポゼッション内で前のシュートが弾かれた後の再シュート */
    if (cur && cur.org === org) {
      const prev = cur.shots[cur.shots.length - 1];
      if (prev && RECOVERED.has(prev.r)) { T[org].poss.offReb++; row.offReb++; }
      cur.shots.push({r: a.r, sec});
      if (goal) closePoss();
    }
  }
  closePoss();

  const out = {};
  for (const [org, x] of Object.entries(T)) {
    /* 攻撃回数は公式の ATTACK アクションを数えているが、速攻のときに
       ATTACK が記録されないことがあり、得点数より少なくなる試合がある
       （得点1本とターンオーバー1本はそれぞれ別の攻撃なので、論理的にありえない）。
       そこで各5分区間で「得点 + ターンオーバー」を下限として補い、
       試合合計はその区間の合計に揃える（表の「計」と一致させるため）。
       公式PDFで攻撃回数が確認できている試合では、ほぼ働かない。 */
    const p = x.poss;
    const tl = [...x.timeline.values()].sort((a, b) => parseInt(a.bucket) - parseInt(b.bucket));
    let floored = 0;
    for (const w of tl) {
      const min = w.goals + w.turnovers;
      if (w.attacks < min) { w.attacksRaw = w.attacks; w.attacks = min; }
      floored += w.attacks;
    }
    if (floored > p.attacks) { p.attacksRaw = p.attacks; p.attacks = floored; }
    out[org] = {
      possessions: {...p, eff: p.attacks ? +(p.goals / p.attacks * 100).toFixed(1) : 0},
      timeline: tl,
      situations: x.sit, situationsDef: x.sitDef, emptyGoal: x.emptyGoal,
    };
  }
  return out;
}

/* ---------------------------------------------------------------- 選手別イベント */
/* アクションの gk フィールドは選手登録番号だが、結果JSONの Members には登録番号が無い。
   そこで「そのGKが浴びた失点数・セーブ数」を公式の個人スタッツと突き合わせて特定する。 */
function gkRegMap(acts, teams) {
  const tally = {};
  for (const a of acts) {
    if (!ACT_ZONE[a.ac] || !a.gk) continue;
    const so = a.c[0]?.org;
    if (!so) continue;
    const t = tally[a.gk] || (tally[a.gk] = {goal: 0, save: 0, shooterOrg: so});
    if (a.r === 'GOAL') t.goal++; else if (a.r === 'SAVE') t.save++;
  }
  const orgs = Object.keys(teams);
  const out = {};
  for (const org of orgs) {
    const opp = orgs.find(o => o !== org);
    const regs = Object.entries(tally).filter(([, v]) => v.shooterOrg === opp);
    const gks = (teams[org]?.players || []).filter(p => p.isGK);
    const pairs = [];
    for (const [reg, v] of regs) {
      for (const g of gks) {
        pairs.push({reg, g, d: Math.abs(v.goal - N(g.stats.GK_GOALS)) + Math.abs(v.save - N(g.stats.GK_SAVES))});
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    const usedR = new Set(), usedB = new Set();
    for (const p of pairs) {
      if (usedR.has(p.reg) || usedB.has(p.g.bib)) continue;
      usedR.add(p.reg); usedB.add(p.g.bib);
      out[p.reg] = {org, bib: p.g.bib};
    }
  }
  return out;
}

/* handball.ai 風の記号タイムライン用に、選手ごとの出来事を時刻つきで並べる。
   type: G(得点) 7G(7m得点) X(ノーゴール) 7X(7m失敗) A(アシスト) L(ミス/テクニカル)
         S(スティール) B(ブロック) 2M(2分退場) YC/RC(カード) 7C(7m献上)
         GS(GKセーブ) GR(GK失点) GG(GKの得点) */
function buildEvents(acts, teams) {
  const gkOf = gkRegMap(acts, teams);
  const ev = {};
  for (const org of Object.keys(teams)) ev[org] = [];
  const isGKbib = (org, bib) => !!teams[org]?.players.find(p => p.bib === bib)?.isGK;
  const push = (org, a, bib, type, extra) => {
    if (!ev[org] || !bib) return;
    ev[org].push({sec: absSec(a.p, a.t), p: S(a.p), t: S(a.t), bib: S(bib), type, ...(extra || {})});
  };

  for (const a of acts) {
    const actor = a.c[0];
    const org = actor?.org;
    const bib = S(actor?.bib);
    if (!org || !ev[org]) continue;

    switch (a.ac) {
      case 'ASS': push(org, a, bib, 'A'); continue;
      case 'ST':  push(org, a, bib, 'S'); continue;
      case 'BLC': push(org, a, bib, 'B'); continue;
      case 'TO':  push(org, a, bib, 'L'); continue;
      case 'TMS': push(org, a, bib, '2M'); continue;
      case 'FRP': push(org, a, bib, '7C'); continue;
      case 'TYC': push(org, a, bib, 'YC'); continue;
      case 'DRC': push(org, a, bib, 'RC'); continue;
      case 'TFT': push(org, a, bib, 'L'); continue;
      default: break;
    }

    const zone = ACT_ZONE[a.ac];
    if (!zone) continue;
    const goal = a.r === 'GOAL';
    const seven = zone === 'P7';
    const shooterGK = isGKbib(org, bib);
    push(org, a, bib,
      shooterGK && goal ? 'GG' : goal ? (seven ? '7G' : 'G') : (seven ? '7X' : 'X'),
      {zone, result: S(a.r), gz: GZ[a.gz] ? a.gz : ''});

    /* GKが受けたシュートをすべて記録する。
       GR=失点 / GS=セーブ / GP=ポスト / GO=枠外。
       セーブ率の分母は GR+GS（枠内被シュート）のみなので、GP・GO は率に影響しない。 */
    const g = gkOf[a.gk];
    if (g && ev[g.org]) {
      const t = goal ? 'GR' : a.r === 'SAVE' ? 'GS' : a.r === 'POST' ? 'GP'
              : a.r === 'MISS' ? 'GO' : '';
      if (t) push(g.org, a, g.bib, t, {zone, result: S(a.r), gz: GZ[a.gz] ? a.gz : ''});
    }
  }
  for (const list of Object.values(ev)) list.sort((x, y) => x.sec - y.sec);
  return ev;
}

/* エントリー名簿 → 「性別/国/氏名」で引ける登録番号表。
   同姓同名（例: HKG の KAN Yik が2名）は曖昧なので引けないようにしておく。 */
let ROSTER = {byName: new Map(), valid: new Set()};
function buildRoster(roster) {
  const byName = new Map(), valid = new Set(), dup = new Set();
  for (const p of roster?.participants || []) {
    const k = `${p.gender}/${p.org}/${S(p.name).toUpperCase()}`;
    if (byName.has(k)) dup.add(k); else byName.set(k, S(p.reg));
    valid.add(S(p.reg));
  }
  for (const k of dup) byName.delete(k);
  return {byName, valid};
}

/* 選手登録番号（顔写真の取得に使う）を、アクションの出演者から拾う */
function regMap(acts, teams) {
  const out = {};
  for (const org of Object.keys(teams)) out[org] = {};
  for (const a of acts) {
    for (const c of a.c || []) {
      if (c.bib && c.reg && out[c.org] && !out[c.org][c.bib]) out[c.org][c.bib] = S(c.reg);
    }
  }
  const gkOf = gkRegMap(acts, teams);
  for (const [reg, g] of Object.entries(gkOf)) {
    if (out[g.org] && !out[g.org][g.bib]) out[g.org][g.bib] = reg;
  }
  return out;
}

function buildPlay(rawActions, teams) {
  const acts = (rawActions || []).map(normAction).sort((x, y) => x.o - y.o);
  const byOrg = {};
  for (const code of Object.keys(teams)) {
    byOrg[code] = {
      shots: [], connections: new Map(), posLinks: new Map(),
      assistBy: new Map(), defActs: new Map(), timeline: [],
    };
  }
  const roleOf = (org, bib) =>
    roleNode(teams[org]?.players.find(p => p.bib === bib)?.role);

  const pendingAss = {};                 // org -> {bib, name}
  const bumpDef = (org, bib, name, key) => {
    if (!byOrg[org] || !bib) return;
    const m = byOrg[org].defActs;
    if (!m.has(bib)) m.set(bib, {bib, name, blocks: 0, steals: 0, sevenMConceded: 0, twoMin: 0});
    m.get(bib)[key]++;
  };

  for (const a of acts) {
    const actor = a.c[0];
    const org = actor?.org;

    if (a.ac === 'ASS' && org) { pendingAss[org] = {bib: actor.bib, name: actor.n, o: a.o}; continue; }
    if (a.ac === 'BLC' && org) { bumpDef(org, actor.bib, actor.n, 'blocks'); continue; }
    if (a.ac === 'ST' && org) { bumpDef(org, actor.bib, actor.n, 'steals'); continue; }
    if (a.ac === 'FRP' && org) { bumpDef(org, actor.bib, actor.n, 'sevenMConceded'); continue; }
    if (a.ac === 'TMS' && org) { bumpDef(org, actor.bib, actor.n, 'twoMin'); continue; }
    if (a.ac === 'TO' && org) { pendingAss[org] = null; continue; }
    if (a.ac === 'ENDP') { for (const k of Object.keys(pendingAss)) pendingAss[k] = null; continue; }

    const zone = ACT_ZONE[a.ac];
    if (!zone || !org || !byOrg[org]) continue;

    /* アシストは ASS アクションのみを正とする（公式の ASSISTS 集計と本数が一致することを確認済み）。
       ゴール側の ActionAssistant フィールドは重複・取りこぼしがあるため使わない。
       ASS は同じチームの次のシュートに結び付ける。 */
    let asBib = '', asName = '';
    const pa = pendingAss[org];
    if (pa) { asBib = pa.bib; asName = pa.name; }
    pendingAss[org] = null;

    const T = byOrg[org];
    const isGoal = a.r === 'GOAL';
    T.shots.push({
      min: S(a.t), period: S(a.p), bib: S(actor.bib), name: S(actor.n),
      role: roleOf(org, actor.bib), zone, result: S(a.r),
      goalZone: GZ[a.gz] ? a.gz : '', assistBib: asBib,
      score: `${a.sh}-${a.sa}`,
    });

    if (!asBib) continue;

    const from = roleOf(org, asBib), to = roleOf(org, actor.bib);
    const ck = `${asBib}>${actor.bib}`;
    if (!T.connections.has(ck)) T.connections.set(ck, {
      fromBib: asBib, fromName: asName, fromRole: from,
      toBib: S(actor.bib), toName: S(actor.n), toRole: to,
      count: 0, goals: 0, zones: {},
    });
    const c = T.connections.get(ck);
    c.count++;
    if (isGoal) { c.goals++; c.zones[zone] = (c.zones[zone] || 0) + 1; }

    const pk = `${from}>${to}`;
    if (!T.posLinks.has(pk)) T.posLinks.set(pk, {from, to, count: 0, goals: 0});
    const pl = T.posLinks.get(pk);
    pl.count++; if (isGoal) pl.goals++;

    T.assistBy.set(asBib, (T.assistBy.get(asBib) || 0) + 1);
  }

  const out = {};
  for (const [org, T] of Object.entries(byOrg)) {
    out[org] = {
      shots: T.shots,
      connections: [...T.connections.values()].sort((a, b) => b.count - a.count),
      posLinks: [...T.posLinks.values()].sort((a, b) => b.count - a.count),
      defActs: [...T.defActs.values()].sort((a, b) =>
        (b.blocks + b.steals) - (a.blocks + a.steals)),
    };
  }
  return out;
}

/* ---------------------------------------------------------------- 事前分布 */
/* 5分間の割合は試行回数が3〜5回しかなく、そのまま出すとほぼ運の揺れになる
   （得点0の区間は0%、1回決めれば100%）。そこで大会全体のデータから
   ベータ分布の事前分布を推定し、各区間を縮小推定する（経験ベイズ）。

     補正後の割合 = (実測の分子 + k × 事前平均) / (実測の分母 + k)

   k は「事前分布を何回分の試行とみなすか」の重み。
   区間ごとの散らばりのうち、二項分布の揺れでは説明できない分（= 本当の実力差）
   がどれだけあるかをモーメント法で推定して決める。 */
const PRIOR_METRICS = [
  {key: 'eff', num: 'goals', den: 'attacks'},
  {key: 'assistRate', num: 'assists', den: 'goals'},
];
const PRIOR_ACC = {};      // gender -> {windows: {metric: [{x,n}]}, teams: {code: {...}}}

function collectForPriors(file) {
  const g = file.gender || 'M';
  const A = PRIOR_ACC[g] || (PRIOR_ACC[g] = {windows: {}, teams: {}});
  for (const m of PRIOR_METRICS) A.windows[m.key] = A.windows[m.key] || [];

  for (const [code, t] of Object.entries(file.teams || {})) {
    const T = A.teams[code] || (A.teams[code] = {code, games: 0, goals: 0, attacks: 0, assists: 0});
    const po = t.possessions || {};
    if (!N(po.attacks)) continue;
    T.games++;
    T.goals += N(t.stats?.GOALS) || N(po.goals);
    T.attacks += N(po.attacks);
    T.assists += N(t.derived?.assists) || N(po.assists);
    for (const w of t.timeline || []) {
      for (const m of PRIOR_METRICS) {
        const n = N(w[m.den]);
        if (n > 0) A.windows[m.key].push({x: Math.min(N(w[m.num]), n), n});
      }
    }
  }
}

/* モーメント法でベータ二項分布の k(=α+β) を推定する */
function fitPrior(samples) {
  const m = samples.length;
  const sx = samples.reduce((a, s) => a + s.x, 0);
  const sn = samples.reduce((a, s) => a + s.n, 0);
  if (m < 6 || sn <= 0) return null;
  const p = sx / sn;
  if (p <= 0 || p >= 1) return null;
  /* 実際の散らばり（分母で重み付け） */
  const obs = samples.reduce((a, s) => a + s.n * Math.pow(s.x / s.n - p, 2), 0) / sn;
  /* 二項分布だけで説明できる散らばり */
  const binom = p * (1 - p) * m / sn;
  const excess = obs - binom;
  /* 実力差が見えない（= 全部ただの揺れ）なら強めに縮小する */
  let k = excess > 1e-9 ? p * (1 - p) / excess - 1 : 300;
  k = Math.max(3, Math.min(300, k));
  return {mean: +p.toFixed(4), k: +k.toFixed(1), windows: m, trials: sn};
}

function buildPriors() {
  const out = {};
  for (const [g, A] of Object.entries(PRIOR_ACC)) {
    const metrics = {};
    for (const m of PRIOR_METRICS) {
      const f = fitPrior(A.windows[m.key] || []);
      if (f) metrics[m.key] = f;
    }
    if (!Object.keys(metrics).length) continue;
    const teams = {};
    for (const T of Object.values(A.teams)) {
      if (!T.attacks) continue;
      teams[T.code] = {
        games: T.games,
        eff: +(T.goals / T.attacks).toFixed(4),
        assistRate: T.goals > 0 ? +(T.assists / T.goals).toFixed(4) : null,
        attacks: T.attacks, goals: T.goals, assists: T.assists,
      };
    }
    out[g] = {metrics, teams};
  }
  return out;
}

/* ---------------------------------------------------------------- build */
/* 選手のゾーン別を合計してチームのシュートマップを作る（チーム統計は集約値のみのため） */
function sumMaps(list, keys) {
  const out = {};
  for (const z of Object.keys(ZONES)) {
    out[z] = Object.fromEntries(keys.map(k => [k, 0]));
    for (const m of list) for (const k of keys) out[z][k] += N(m?.[z]?.[k]);
  }
  return out;
}
const mapEmpty = (m, k = 's') => Object.values(m).every(v => !N(v[k]));

function buildMatchFile(key, res, listed, rawActions) {
  const info = res.Info || {};
  const teams = {};
  for (const c of res.Competitors || []) {
    const st = slimStats(c.Stats);
    teams[c.Org] = {
      code: c.Org,
      name: c.OrgDesc || c.Name || c.Org,
      nameS: c.NameS || c.Name || c.Org,
      score: N(c.Result),
      wlt: S(c.WLT),
      rank: S(c.Rk),
      stats: st,
      shot: shotMap(st),
      gk: gkMap(st),
      halves: (c.Splits || []).map(sp => ({label: S(sp.Category) || S(sp.Distance), value: N(sp.Result)})),
      players: (c.Members || []).map(m => {
        const ms = slimStats(m.Stats);
        return {
          bib: S(m.Bib),
          name: S(m.Name),
          nameS: S(m.NameS || m.Name),
          role: S(m.Position),
          func: S(m.Function),
          captain: !!m.Captain,
          isGK: /^(gk|g)$/i.test(S(m.Position)) || /goalkeeper/i.test(S(m.Position)) || !!m.InFieldGK || !!m.Stats?.GK_SHOTS || !!m.Stats?.ST_GK_SHOTS,
          time: extVal(m.Extensions, /time/i),
          stats: ms,
          shot: shotMap(ms),
          gk: gkMap(ms),
          gkZone: goalZone(ms, 'SAVES'),
          concededZone: goalZone(ms, 'GOALS'),
        };
      }).filter(p => p.bib),
    };
    const T = teams[c.Org];
    const fromPlayers = sumMaps(T.players.map(p => p.shot), ['g', 's']);
    if (!mapEmpty(fromPlayers)) T.shot = fromPlayers;
    const gks = T.players.filter(p => p.isGK);
    const gkFromPlayers = sumMaps(gks.map(p => p.gk), ['sv', 's', 'g']);
    if (!mapEmpty(gkFromPlayers)) T.gk = gkFromPlayers;
    T.gkZone = sumZone(gks.map(p => p.gkZone), ['sv', 's', 'g']);
    T.concededZone = sumZone(gks.map(p => p.concededZone), ['g', 's']);
  }
  /* ピリオド名を反映 + 選手合計の派生値 */
  const perNames = (res.Results?.Periods || []).map(p => S(p.Desc || p.Category || p.Code));
  for (const T of Object.values(teams)) {
    T.halves = T.halves.map((h, i) => ({label: perNames[i] || `P${i + 1}`, value: h.value}));
    const psum = (k) => T.players.reduce((a, p) => a + N(p.stats[k]), 0);
    T.derived = {
      assists: psum('ASSISTS'), steals: psum('STEALS'), blocks: psum('BLOCKS'),
      blocked: psum('BLOCKED'), turnovers: psum('TURNOVERS'),
      twoMin: N(T.stats['2MINUTES']) || psum('2MINUTES'),
      yc: N(T.stats.YELLOW_CARDS) || psum('YELLOW_CARDS'),
      rc: N(T.stats.RED_CARDS) || psum('RED_CARDS'),
    };
  }

  /* 自チームのゴールマウス別シュート = 相手GKが受けたシュート */
  const orgs = Object.keys(teams);
  if (orgs.length === 2) {
    teams[orgs[0]].shotZone = teams[orgs[1]].concededZone;
    teams[orgs[1]].shotZone = teams[orgs[0]].concededZone;
  }
  /* プレーバイプレーから連携・シュートイベント・守備アクションを抽出 */
  const play = buildPlay(rawActions, teams);
  for (const [org, p] of Object.entries(play)) {
    if (!teams[org]) continue;
    teams[org].shots = p.shots;
    teams[org].connections = p.connections;
    teams[org].posLinks = p.posLinks;
    teams[org].defActs = p.defActs;
  }
  /* ポゼッション・リバウンド・数的状況・時間帯 */
  const orgsAll = Object.keys(teams);
  const sorted = (rawActions || []).map(normAction).sort((x, y) => x.o - y.o);
  const pos = buildPossessions(sorted, teams, orgsAll);
  for (const [org, p] of Object.entries(pos)) {
    if (!teams[org]) continue;
    Object.assign(teams[org], p);
  }

  /* 選手別の記号タイムライン + 登録番号（顔写真用）。
     名簿（氏名一致）を第一候補、プレーバイプレー由来を補欠とする。 */
  const evs = buildEvents(sorted, teams);
  const regs = regMap(sorted, teams);
  const gender = S(res.Info?.Event || listed?.event).startsWith('W') ? 'W' : 'M';
  for (const org of orgsAll) {
    teams[org].events = evs[org] || [];
    for (const p of teams[org].players) {
      const byName = ROSTER.byName.get(`${gender}/${org}/${S(p.name).toUpperCase()}`);
      const byPlay = regs[org]?.[p.bib] || '';
      p.reg = byName || (ROSTER.valid.size && !ROSTER.valid.has(byPlay) ? '' : byPlay);
    }
  }

  const order = (res.Competitors || []).map(c => c.Org);
  const src = {...listed, ...info};
  return {
    id: unitId(key), key,
    status: S(src.Status), statusDesc: S(src.StatusDesc),
    dateTime: S(src.DateTimeRaw), date: S(src.DateTimeRaw).slice(0, 10),
    venue: S(src.VenueDesc), location: S(src.LocDesc),
    event: S(src.Event), eventDesc: S(src.EventDesc),
    gender: S(src.Event).startsWith('W') ? 'W' : 'M',
    phase: S(src.Phase), phaseDesc: S(src.PhaseDesc),
    unitDesc: S(src.UnitDesc), unitNum: S(src.UnitNum),
    duration: S(res.Results?.Duration),
    periods: (res.Results?.Periods || []).map(p => ({
      desc: S(p.Desc || p.Category || p.Code), result: S(p.Result || ''),
    })),
    officials: (res.Results?.Officials || []).map(o => ({
      func: S(o.FunctionDesc || o.Function), name: S(o.Name), org: S(o.Org),
    })),
    home: order[0] || '', away: order[1] || '',
    teams,
    updatedAt: new Date().toISOString(),
  };
}

function listedMatch(u) {
  return {
    id: unitId(u.Key), key: u.Key,
    date: S(u.DateTimeRaw).slice(0, 10), dateTime: S(u.DateTimeRaw),
    venue: S(u.VenueDesc), event: S(u.Event), eventDesc: S(u.EventDesc),
    gender: S(u.Event).startsWith('W') ? 'W' : 'M',
    phase: S(u.Phase), phaseDesc: S(u.PhaseDesc),
    unitDesc: S(u.UnitDesc), unitNum: S(u.UnitNum),
    status: S(u.Status), statusDesc: S(u.StatusDesc), isLive: !!u.IsLive,
    home: {code: S(u.Home?.Org), name: S(u.Home?.NameS || u.Home?.Name), score: S(u.Home?.Result), winner: !!u.Home?.Winner},
    away: {code: S(u.Away?.Org), name: S(u.Away?.NameS || u.Away?.Name), score: S(u.Away?.Result), winner: !!u.Away?.Winner},
    hasResult: S(u.Status) !== 'SCHEDULED' && S(u.Home?.Result) !== '',
  };
}

function buildStandings(evKey, evDesc, g) {
  return {
    event: evKey, eventDesc: evDesc,
    groups: (g.Groups || []).map(gr => ({
      key: S(gr.Key), desc: S(gr.DescA || gr.Desc), type: S(gr.Type),
      rows: (gr.Competitors || []).map(c => ({
        rank: S(c.Rk || c.Pos), org: S(c.Org), name: S(c.NameS || c.OrgDesc || c.Name),
        pts: S(c.Points), played: S(c.Played), won: S(c.Won), lost: S(c.Lost), tied: S(c.Tied),
        for: S(c.For || c.PtsFor), against: S(c.Against || c.PtsAgainst), diff: S(c.Diff || c.PtsDiff),
        qualified: S(c.Qualified),
      })),
    })),
  };
}

async function writeIfChanged(file, obj) {
  const next = JSON.stringify(obj, null, 1);
  try {
    const cur = await fs.readFile(file, 'utf8');
    const strip = (s) => s.replace(/"updatedAt":\s*"[^"]*"/g, '');
    if (!FORCE && strip(cur) === strip(next)) return false;
  } catch {}
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, next);
  return true;
}

/* ---------------------------------------------------------------- main */
async function main() {
  const t0 = Date.now();
  let bundle = null;
  if (BUNDLE) {
    bundle = JSON.parse(await fs.readFile(BUNDLE, 'utf8'));
    console.log('▶ バンドルから再生成:', BUNDLE);
  } else {
    console.log('▶ 公式リザルトAPI から取得します…');
  }

  const disc = bundle ? {Days: bundle.days.map(d => ({raw: d})), Events: bundle.events} : await api(`/${DISC}/disc/data`);
  const days = (disc.Days || []).map(d => d.raw);
  const events = (disc.Events || []).map(e => ({
    key: e.EvKey, desc: e.Desc, gender: String(e.EvKey).startsWith('W') ? 'W' : 'M',
  }));

  /* エントリー名簿（選手登録番号 = 顔写真のファイル名）。
     公式APIが落ちていても既存の名簿を使い続けられるように、取れなければ前回分を読む。 */
  let roster = null;
  try {
    const ent = bundle ? bundle.entries : await api(`/${DISC}/entries/list`, {optional: true});
    const ps = (ent?.participants || []).filter(p => S(p.Type) === 'A');
    if (ps.length) {
      roster = {
        updatedAt: new Date().toISOString(),
        participants: ps.map(p => ({reg: S(p.Reg), org: S(p.Org), gender: S(p.Gender), name: S(p.Name)})),
      };
      await writeIfChanged(path.join(DATA, 'entries.json'), roster);
    }
  } catch { /* 名簿が取れなくても他の処理は続ける */ }
  if (!roster) {
    try { roster = JSON.parse(await fs.readFile(path.join(DATA, 'entries.json'), 'utf8')); } catch {}
  }
  ROSTER = buildRoster(roster);

  const targetDays = ONLY_DAY ? [ONLY_DAY] : days;
  const matches = [];
  for (const d of targetDays) {
    const units = bundle ? (bundle.schedule[d] || []) : (await api(`/${DISC}/schedule/daily/${d}`, {optional: true}) || []);
    units.forEach(u => matches.push(listedMatch(u)));
    if (!bundle) console.log(`  · ${d}: ${units.length} 試合`);
  }
  matches.sort((a, b) => (a.dateTime || '').localeCompare(b.dateTime || ''));

  /* チーム一覧 */
  const teamMap = new Map();
  for (const m of matches) {
    for (const side of ['home', 'away']) {
      const t = m[side];
      if (!t.code) continue;
      const id = m.gender + ':' + t.code;
      if (!teamMap.has(id)) teamMap.set(id, {code: t.code, name: t.name, gender: m.gender, event: m.event, played: 0});
      if (m.hasResult) teamMap.get(id).played++;
    }
  }

  /* 順位表 */
  const standings = [];
  for (const ev of events) {
    const g = bundle ? bundle.groups[ev.key] : await api(`/${DISC}/groups/${ev.key}`, {optional: true});
    if (g) standings.push(buildStandings(ev.key, ev.desc, g));
  }

  /* 試合詳細 */
  let detail = 0, changed = 0;
  const ids = [];
  for (const m of matches) {
    if (!m.hasResult) continue;
    const res = bundle ? bundle.results[m.key] : await api(`/${DISC}/results/${m.key}`, {optional: true});
    if (!res || !res.Competitors?.length) continue;
    const acts = bundle ? (bundle.actions || {})[m.key]
                        : await api(`/${DISC}/actions/Total/${m.key}`, {optional: true});
    const file = buildMatchFile(m.key, res, m, acts);
    m.hasStats = Object.values(file.teams).some(t => Object.keys(t.stats || {}).length > 3);
    if (await writeIfChanged(path.join(DATA, 'matches', file.id + '.json'), file)) changed++;
    ids.push(file.id);
    detail++;
    collectForPriors(file);
  }

  const tournament = {
    name: '第20回アジア競技大会 愛知・名古屋 2026 — ハンドボール',
    nameEn: '20th Asian Games Aichi–Nagoya 2026 — Handball',
    discipline: DISC,
    source: 'https://results.asiangames2026.org/#/discipline/HBL',
    days, events,
    teams: [...teamMap.values()].sort((a, b) => a.gender.localeCompare(b.gender) || a.code.localeCompare(b.code)),
    matches, standings,
    detailIds: ids,
    priors: buildPriors(),
    updatedAt: new Date().toISOString(),
  };
  const tChanged = await writeIfChanged(path.join(DATA, 'tournament.json'), tournament);

  console.log(`✔ 完了 — 試合 ${matches.length}件 / 詳細 ${detail}件 / 更新 ${changed + (tChanged ? 1 : 0)}ファイル (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch(e => { console.error('✖ 失敗:', e.message); process.exit(1); });
