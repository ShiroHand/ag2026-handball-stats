#!/usr/bin/env node
/* data/tournament.json に出てくる国・地域の国旗画像を assets/flags/ に保存する（不足分のみ）。 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'flags');
const SRC = (code) => `https://results.asiangames2026.org/ag2026/flags/${code}.png`;
const SRC2 = (code) => `https://results.asiangames2026.org/assets/png/${code}.png`;

const t = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'tournament.json'), 'utf8'));
const codes = new Set();
t.teams.forEach(x => codes.add(x.code));
t.matches.forEach(m => { if (m.home.code) codes.add(m.home.code); if (m.away.code) codes.add(m.away.code); });

await fs.mkdir(OUT, {recursive: true});
let got = 0;
for (const c of codes) {
  const file = path.join(OUT, c + '.png');
  try { await fs.access(file); continue; } catch {}
  for (const url of [SRC2(c), SRC(c)]) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100) continue;
      await fs.writeFile(file, buf);
      got++; break;
    } catch {}
  }
}
console.log(`国旗: ${got} 件を追加（対象 ${codes.size} 件）`);
