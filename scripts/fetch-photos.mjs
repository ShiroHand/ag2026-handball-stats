#!/usr/bin/env node
/* ==========================================================================
   fetch-photos.mjs
   公式の選手顔写真を assets/photos/<登録番号>.jpg に取り込む。依存なし / Node 18+。

     node scripts/fetch-photos.mjs           # 不足分だけ取得
     node scripts/fetch-photos.mjs --all     # 名簿の全員ぶん取得
     node scripts/fetch-photos.mjs --force   # すでにある画像も取り直す

   写真URLは公式の設定APIが返す photoPath（= .../ag2026/photos/<登録番号>.jpg）。
   登録番号は data/entries.json（fetch-data.mjs が保存）と各試合データから集める。
   ========================================================================== */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'assets', 'photos');
const CFG = 'https://back.results.asiangames2026.org/s/AG2026/en/config';
const FALLBACK_BASE = 'https://results.asiangames2026.org/ag2026/photos/';

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const FORCE = argv.includes('--force');
const MIN_BYTES = 800;          // これ未満はエラーページ等とみなす

const S = (v) => (v === null || v === undefined) ? '' : String(v);

/* 設定APIは zlib deflate（latin1 で再エンコードされて返ることがある） */
async function photoBase() {
  try {
    const zlib = await import('node:zlib');
    const res = await fetch(CFG);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = Buffer.from(await res.arrayBuffer());
    let txt = null;
    for (const f of [
      () => zlib.inflateSync(raw),
      () => zlib.inflateSync(Buffer.from(raw.toString('utf8'), 'latin1')),
      () => zlib.gunzipSync(raw),
      () => zlib.inflateRawSync(raw),
      () => raw,
    ]) { try { txt = f().toString('utf8'); JSON.parse(txt); break; } catch { txt = null; } }
    const p = txt && JSON.parse(txt).photoPath;
    if (p) return S(p).endsWith('/') ? p : p + '/';
  } catch { /* 取れなければ既知のパスを使う */ }
  return FALLBACK_BASE;
}

/* 取りに行く登録番号を集める（出場した選手を優先する） */
async function wanted() {
  const played = new Set(), listed = new Set();
  try {
    const dir = path.join(DATA, 'matches');
    for (const f of await fs.readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      const m = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      for (const t of Object.values(m.teams || {})) {
        for (const p of t.players || []) if (p.reg) played.add(S(p.reg));
      }
    }
  } catch { /* 試合データがまだ無い */ }
  try {
    const e = JSON.parse(await fs.readFile(path.join(DATA, 'entries.json'), 'utf8'));
    for (const p of e.participants || []) if (p.reg) listed.add(S(p.reg));
  } catch { /* 名簿がまだ無い */ }
  return ALL ? new Set([...listed, ...played]) : (played.size ? played : listed);
}

async function main() {
  await fs.mkdir(OUT, {recursive: true});
  const have = new Set();
  for (const f of await fs.readdir(OUT).catch(() => [])) {
    if (f.endsWith('.jpg')) have.add(f.slice(0, -4));
  }
  const need = [...await wanted()].filter(r => FORCE || !have.has(r));
  if (!need.length) {
    console.log(`✔ 顔写真は最新です（${have.size}件）`);
    return;
  }

  const base = await photoBase();
  console.log(`▶ 顔写真を取得: ${need.length}件  (${base})`);

  let ok = 0, miss = 0;
  for (let i = 0; i < need.length; i += 8) {
    await Promise.all(need.slice(i, i + 8).map(async (reg) => {
      try {
        const res = await fetch(base + reg + '.jpg');
        if (!res.ok) { miss++; return; }
        const ct = S(res.headers.get('content-type'));
        const buf = Buffer.from(await res.arrayBuffer());
        if (!/image/i.test(ct) || buf.length < MIN_BYTES) { miss++; return; }
        await fs.writeFile(path.join(OUT, reg + '.jpg'), buf);
        ok++;
      } catch { miss++; }
    }));
  }
  console.log(`✔ 完了 — 取得 ${ok}件 / 取得できず ${miss}件 / 保有 ${have.size + ok}件`);
}

main().catch(e => { console.error('✖ 失敗:', e.message); process.exit(1); });
