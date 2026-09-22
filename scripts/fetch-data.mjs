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

function buildMatchFile(key, res, listed) {
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
    const file = buildMatchFile(m.key, res, m);
    m.hasStats = Object.values(file.teams).some(t => Object.keys(t.stats || {}).length > 3);
    if (await writeIfChanged(path.join(DATA, 'matches', file.id + '.json'), file)) changed++;
    ids.push(file.id);
    detail++;
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
    updatedAt: new Date().toISOString(),
  };
  const tChanged = await writeIfChanged(path.join(DATA, 'tournament.json'), tournament);

  console.log(`✔ 完了 — 試合 ${matches.length}件 / 詳細 ${detail}件 / 更新 ${changed + (tChanged ? 1 : 0)}ファイル (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch(e => { console.error('✖ 失敗:', e.message); process.exit(1); });
