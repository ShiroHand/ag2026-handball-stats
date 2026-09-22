#!/usr/bin/env node
/* ==========================================================================
   fetch-reports.mjs
   公式PDFレポートのうち、APIでは配信されていない情報を取り込む。

     C77  Empty Goal Analysis     — 7対6 / 6対6 の攻撃回数・得点・効率・5分推移・交代数
     C83  Match Team Statistics   — 公式の攻撃回数（Number of Attacks）と Scoring Efficiency

   PDF のテキスト化には poppler-utils の pdftotext を使う（-bbox-layout で座標つき）。
   pdftotext が無い環境では何もせず終了する。

     node scripts/fetch-reports.mjs
     node scripts/fetch-reports.mjs --force
   ========================================================================== */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://back.results.asiangames2026.org/s/AG2026/en';
const DISC = 'HBL';
const DATA = path.join(ROOT, 'data', 'reports');
const FORCE = process.argv.includes('--force');

const S = (v) => (v === null || v === undefined) ? '' : String(v);
const N = (v) => { const x = parseFloat(String(v ?? '').replace('%', '')); return Number.isFinite(x) ? x : 0; };

/* ---------------------------------------------------------------- API */
function inflate(buf) {
  for (const f of [
    () => zlib.inflateSync(buf),
    () => zlib.inflateSync(Buffer.from(buf.toString('utf8'), 'latin1')),
    () => zlib.gunzipSync(buf),
    () => zlib.inflateRawSync(buf),
  ]) { try { return f(); } catch {} }
  return buf;
}
async function api(p) {
  const res = await fetch(API + p);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${p}`);
  return JSON.parse(inflate(Buffer.from(await res.arrayBuffer())).toString('utf8'));
}

/* ---------------------------------------------------------------- PDF */
async function hasPdftotext() {
  try { await run('pdftotext', ['-v']); return true; } catch { return false; }
}

/* PDF ファイルを単語＋座標に変換する */
const unescape = (t) => String(t)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function pdfWordsFromFile(tmp, {keep = false} = {}) {
  try {
    const {stdout} = await run('pdftotext', ['-bbox-layout', tmp, '-'], {maxBuffer: 64 * 1024 * 1024});
    const words = [];
    let page = 0;
    for (const m of stdout.matchAll(/<page width="[\d.]+" height="[\d.]+">|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      if (m[0].startsWith('<page')) { page++; continue; }
      words.push({page, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: unescape(m[5])});
    }
    return words;
  } finally { if (!keep) fs.unlink(tmp).catch(() => {}); }
}

/* URL から取得して変換する */
async function pdfWords(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const tmp = path.join(os.tmpdir(), `rep-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  return pdfWordsFromFile(tmp);
}

/* 同じ行（y が近い単語）にまとめる */
function toLines(words) {
  const map = new Map();
  for (const w of words) {
    const k = `${w.page}|${Math.round(w.y0)}`;
    if (!map.has(k)) map.set(k, {page: w.page, y: w.y0, words: []});
    map.get(k).words.push(w);
  }
  return [...map.values()]
    .map(l => ({...l, words: l.words.sort((a, b) => a.x0 - b.x0)}))
    .map(l => ({...l, text: l.words.map(w => w.t).join(' ')}))
    .sort((a, b) => a.page - b.page || a.y - b.y);
}

const isNum = (t) => /^\d+(?:\/\d+)?$/.test(t);
const center = (w) => (w.x0 + w.x1) / 2;

/* 見出し行（TEAMA/TEAMB が並ぶ行）から列の中心座標を得る */
function colCenters(line, codes) {
  return line.words.filter(w => codes.includes(w.t)).map(w => ({x: center(w), code: w.t}));
}
/* 行の数値を、最も近い列に割り当てる */
function assign(line, cols, groups, minX) {
  const out = {};
  for (const w of line.words) {
    if (!isNum(w.t) || w.x1 < minX) continue;
    const c = center(w);
    let bi = 0, bd = Infinity;
    cols.forEach((col, i) => { const d = Math.abs(col.x - c); if (d < bd) { bd = d; bi = i; } });
    if (bd > 22) continue;
    const g = groups[Math.floor(bi / 2)];
    if (!g) continue;
    out[g] = out[g] || {};
    out[g][cols[bi].code] = w.t;
  }
  return out;
}

/* ---------------------------------------------------------------- C77 */
const EG_METRICS = ['attacks', 'goals', 'saves', 'missed', 'blocked', 'post', 'turnovers', 'pct', 'goalsAgainst'];
const EG_ROWS = [
  {match: /^7\s*against\s*6/i, key: 'v7x6'},
  {match: /^6\s*against\s*6/i, key: 'v6x6'},
  {match: /^Other/i, key: 'other'},
];
const SUB_ROWS = [
  {match: /Goalkeeper\s*<->\s*Goalkeeper/i, key: 'gkGk'},
  {match: /Courtplayer\s*<->\s*Goalkeeper/i, key: 'courtToGk'},
  {match: /Courtplayer\s*<->\s*Courtplayer/i, key: 'courtToCourt'},
];

function parseEmptyGoal(lines, codes) {
  const out = {
    situations: {}, timeline: {}, duration: {}, substitutions: {},
  };
  codes.forEach(c => {
    out.situations[c] = {};
    out.timeline[c] = {};
    out.duration[c] = {};
    out.substitutions[c] = {};
  });

  /* ---- 1. 攻撃内訳 ---- */
  const hdrIdx = lines.findIndex(l => l.words.filter(w => codes.includes(w.t)).length >= 16);
  if (hdrIdx >= 0) {
    const cols = colCenters(lines[hdrIdx], codes);
    const minX = Math.min(...cols.map(c => c.x)) - 14;
    for (let i = hdrIdx + 1; i < Math.min(hdrIdx + 8, lines.length); i++) {
      const label = lines[i].words.filter(w => w.x1 < minX).map(w => w.t).join(' ');
      const row = EG_ROWS.find(r => r.match.test(label.trim()));
      if (!row) continue;
      const vals = assign(lines[i], cols, EG_METRICS, minX);
      codes.forEach(c => {
        out.situations[c][row.key] = Object.fromEntries(
          EG_METRICS.map(m => [m, N(vals[m]?.[c])]));
      });
    }
  }

  /* ---- 2. 5分ごと（前半・後半の2ブロック） ---- */
  const halfHdrs = lines.map((l, i) => ({l, i}))
    .filter(({l}) => l.words.filter(w => codes.includes(w.t)).length === 12);
  const BUCKETS = [['0-5', '5-10', '10-15', '15-20', '20-25', '25-30'],
                   ['30-35', '35-40', '40-45', '45-50', '50-55', '55-60']];
  halfHdrs.slice(0, 2).forEach(({l, i}, half) => {
    const cols = colCenters(l, codes);
    const minX = Math.min(...cols.map(c => c.x)) - 14;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const label = lines[j].words.filter(w => w.x1 < minX).map(w => w.t).join(' ');
      const row = EG_ROWS.find(r => r.match.test(label.trim()));
      if (!row) continue;
      const vals = assign(lines[j], cols, BUCKETS[half], minX);
      codes.forEach(c => {
        out.timeline[c][row.key] = out.timeline[c][row.key] || {};
        BUCKETS[half].forEach(b => {
          const v = vals[b]?.[c];
          if (v) {
            const [g, a] = v.split('/').map(Number);
            out.timeline[c][row.key][b] = {goals: g || 0, attacks: a || 0};
          }
        });
      });
    }
  });

  /* ---- 3. 攻撃時間別 ---- */
  const durIdx = lines.findIndex(l => /ANALYSIS BY DURATION/i.test(l.text));
  if (durIdx >= 0) {
    const hdr = lines.slice(durIdx + 1, durIdx + 4).find(l => /sec\./i.test(l.text));
    if (hdr) {
      const cells = hdr.words.filter(w => /sec|>|<|\d/.test(w.t));
      /* 「<15 sec.」のように複数語なので、sec. の位置を列中心として使う */
      const secs = hdr.words.filter(w => /^sec\.?$/i.test(w.t)).map(w => center(w));
      const labels = ['<15s', '15-30s', '30-45s', '45-60s', '>60s'];
      for (let j = durIdx + 1; j < Math.min(durIdx + 10, lines.length); j++) {
        const first = lines[j].words[0];
        if (!first || !codes.includes(first.t)) continue;
        const code = first.t;
        lines[j].words.slice(1).forEach(w => {
          if (!isNum(w.t)) return;
          const c = center(w);
          let bi = 0, bd = Infinity;
          secs.forEach((x, i2) => { const d = Math.abs(x - c); if (d < bd) { bd = d; bi = i2; } });
          if (bd > 34) return;
          const [g, a] = w.t.split('/').map(Number);
          out.duration[code][labels[bi]] = {goals: g || 0, attacks: a || 0};
        });
      }
    }
  }

  /* ---- 4. 交代サマリー ---- */
  const subIdx = lines.findIndex(l => /SUBSTITUTION SUMMARY/i.test(l.text));
  if (subIdx >= 0) {
    const hdr = lines.slice(subIdx, subIdx + 4).find(l => l.words.filter(w => codes.includes(w.t)).length === 2);
    if (hdr) {
      const cols = colCenters(hdr, codes);
      const minX = Math.min(...cols.map(c => c.x)) - 20;
      for (let j = subIdx + 1; j < Math.min(subIdx + 9, lines.length); j++) {
        const label = lines[j].words.filter(w => w.x1 < minX).map(w => w.t).join(' ');
        const row = SUB_ROWS.find(r => r.match.test(label.replace(/\s+/g, ' ')));
        const isTotal = /^Total:?$/i.test(label.trim());
        if (!row && !isTotal) continue;
        const key = row ? row.key : 'total';
        lines[j].words.forEach(w => {
          if (!isNum(w.t) || w.x1 < minX) return;
          const c = center(w);
          let bi = 0, bd = Infinity;
          cols.forEach((col, i2) => { const d = Math.abs(col.x - c); if (d < bd) { bd = d; bi = i2; } });
          if (bd > 30) return;
          out.substitutions[cols[bi].code][key] = N(w.t);
        });
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- C83 */
function parseTeamStats(lines, codes) {
  const out = {};
  let cur = null;
  for (const l of lines) {
    const m0 = l.text.match(/^([A-Z]{3})\s+-\s+/);
    if (m0 && codes.includes(m0[1])) cur = m0[1];
    const m = l.text.match(/Number of Attacks:\s*(\d+)\s*,?\s*Scoring Efficiency:\s*(\d+)/i);
    if (m && cur) out[cur] = {attacks: +m[1], efficiency: +m[2]};
  }
  return out;
}

/* ---------------------------------------------------------------- main */
function unitId(key) {
  const p = String(key).split('.');
  const trim = (s) => S(s).replace(/-+$/, '') || '0';
  return [trim(p[0]), trim(p[2]), trim(p[3])].filter(Boolean).join('-');
}

/* オフライン検証用: node scripts/fetch-reports.mjs --local <C77.pdf> <C83.pdf> <KOR,KUW> */
async function local() {
  const i = process.argv.indexOf('--local');
  const [f77, f83, codesArg] = process.argv.slice(i + 1);
  const codes = (codesArg || '').split(',').filter(Boolean);
  const rec = {codes};
  if (f77) rec.emptyGoal = parseEmptyGoal(toLines(await pdfWordsFromFile(f77, {keep: true})), codes);
  if (f83) rec.teamStats = parseTeamStats(toLines(await pdfWordsFromFile(f83, {keep: true})), codes);
  console.log(JSON.stringify(rec, null, 1));
}

async function main() {
  if (process.argv.includes('--local')) return local();
  if (!await hasPdftotext()) {
    console.log('レポート: pdftotext が見つからないためスキップします（poppler-utils が必要）');
    return;
  }
  const t = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'tournament.json'), 'utf8'));
  const done = (t.matches || []).filter(m => m.hasResult && (t.detailIds || []).includes(m.id));
  await fs.mkdir(DATA, {recursive: true});

  let made = 0, skipped = 0;
  for (const m of done) {
    const file = path.join(DATA, m.id + '.json');
    if (!FORCE) { try { await fs.access(file); skipped++; continue; } catch {} }

    let groups;
    try { groups = await api(`/${DISC}/reports/unit/${m.key}`); }
    catch { continue; }
    const all = (groups || []).flatMap(g => g.Reports || []);
    const find = (oris) => all.find(r => r.Oris === oris && r.URL.includes(m.key.replace(/\./g, '')));
    const c77 = find('C77'), c83 = find('C83');
    const codes = [m.home.code, m.away.code].filter(Boolean);
    if (!codes.length) continue;

    const rec = {id: m.id, key: m.key, codes, updatedAt: new Date().toISOString()};
    try {
      if (c77) {
        const w = await pdfWords(c77.URL);
        if (w) Object.assign(rec, {emptyGoal: parseEmptyGoal(toLines(w), codes), emptyGoalSource: c77.URL});
      }
      if (c83) {
        const w = await pdfWords(c83.URL);
        if (w) Object.assign(rec, {teamStats: parseTeamStats(toLines(w), codes), teamStatsSource: c83.URL});
      }
    } catch (e) { console.warn(`  ! ${m.id}: ${e.message}`); }

    if (!rec.emptyGoal && !rec.teamStats) continue;
    await fs.writeFile(file, JSON.stringify(rec, null, 1));
    made++;
    console.log(`  · ${m.id} (${codes.join(' vs ')})`);
  }
  console.log(`✔ レポート取り込み完了 — 新規 ${made} 件 / 既存 ${skipped} 件`);
}

main().catch(e => { console.error('✖ レポート取り込み失敗:', e.message); process.exit(0); });
