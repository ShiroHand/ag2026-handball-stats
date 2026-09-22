#!/usr/bin/env node
/* ==========================================================================
   fetch-flags.mjs
   data/tournament.json に出てくる国・地域の国旗画像を assets/flags/<CODE>.png に保存する。

   公式サイトの国旗画像はビルドハッシュ付きのファイル名（例 CHN.DdpT2hCV.png）で
   配信されており固定URLがないため、トップページ → メインJS を辿って
   実際のファイル名を毎回抽出してからダウンロードする。
   ========================================================================== */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://results.asiangames2026.org';
const OUT = path.join(ROOT, 'assets', 'flags');

const force = process.argv.includes('--force');

/* 必要なコードを集める */
const t = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'tournament.json'), 'utf8'));
const codes = new Set();
(t.teams || []).forEach(x => x.code && codes.add(x.code));
(t.matches || []).forEach(m => {
  if (m.home?.code) codes.add(m.home.code);
  if (m.away?.code) codes.add(m.away.code);
});
(t.standings || []).forEach(s => (s.groups || []).forEach(g =>
  (g.rows || []).forEach(r => r.org && codes.add(r.org))));

if (!codes.size) { console.log('国旗: 対象なし'); process.exit(0); }

/* 既に持っているものは飛ばす */
await fs.mkdir(OUT, {recursive: true});
const have = new Set((await fs.readdir(OUT)).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)));
const need = [...codes].filter(c => force || !have.has(c));
if (!need.length) { console.log(`国旗: 最新（${codes.size} 件保持）`); process.exit(0); }

/* ハッシュ付きファイル名を抽出 */
const html = await fetch(SITE + '/').then(r => r.text());
const js = (html.match(/\/assets\/index\.[A-Za-z0-9_-]+\.js/) || [])[0];
if (!js) { console.error('国旗: メインJSを特定できませんでした'); process.exit(0); }
const bundle = await fetch(SITE + js).then(r => r.text());

const map = new Map();                       // CODE -> assets/png/CODE.hash.png
for (const m of bundle.matchAll(/assets\/png\/([A-Z]{3})\.[A-Za-z0-9_-]+\.png/g)) {
  if (!map.has(m[1])) map.set(m[1], m[0]);
}
console.log(`国旗: バンドルから ${map.size} 件のURLを検出`);

let got = 0, miss = [];
for (const code of need) {
  const rel = map.get(code);
  if (!rel) { miss.push(code); continue; }
  try {
    const res = await fetch(`${SITE}/${rel}`);
    if (!res.ok) { miss.push(code); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) { miss.push(code); continue; }
    await fs.writeFile(path.join(OUT, code + '.png'), buf);
    got++;
  } catch { miss.push(code); }
}
console.log(`国旗: ${got} 件を保存${miss.length ? ` / 未取得: ${miss.join(', ')}` : ''}`);
