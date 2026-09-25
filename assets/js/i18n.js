/* ==========================================================================
   i18n.js — 日本語／英語の表示切り替え

   方針: ソースの日本語はそのまま残し、描画の直前に置き換える。
   core.js の el() と tip() が text / html を t() に通すので、
   各ページのコードには一切手を入れていない。

   t() の手順:
     1) TPL（数値や名前が埋め込まれる文）を正規表現で置換
     2) 残りを辞書の「最長一致」で部分置換
        日本語は分かち書きしないので、部分文字列の置換が素直に効く。
        長いキーから順に当てて、当たった範囲は二度置換しない。

   辞書に無い語はそのまま日本語で残る（壊れるより残るほうがまし）。
   ========================================================================== */
import {EN, EN_TPL} from './i18n-en.js';

const STORE = 'hbl-lang';
const VALID = ['ja', 'en'];

function detect() {
  const u = new URLSearchParams(location.search).get('lang');
  if (VALID.includes(u)) return u;
  try {
    const s = localStorage.getItem(STORE);
    if (VALID.includes(s)) return s;
  } catch { /* プライベートモード等では読めない */ }
  return 'ja';
}

export const LANG = detect();
export const isEN = LANG === 'en';

/* URL に lang を載せたまま他ページへ移動するため、リンクの href を書き換える */
export function withLang(href) {
  if (!isEN || !href || /^(https?:|mailto:|#)/.test(href)) return href;
  return href + (href.includes('?') ? '&' : '?') + 'lang=en';
}

export function setLang(lang) {
  if (!VALID.includes(lang)) return;
  try { localStorage.setItem(STORE, lang); } catch { /* 保存できなくても続行 */ }
  const u = new URL(location.href);
  if (lang === 'ja') u.searchParams.delete('lang');
  else u.searchParams.set('lang', 'en');
  location.href = u.toString();
}

/* ---------------------------------------------------------------- 置換本体 */
const HAS_JP = /[぀-ヿ㐀-鿿]/;

/* TPL: 「{}」を任意文字列とみなす正規表現に変換しておく。
   ・固定部分に日本語が無いルールは意味が無いうえ、他のルールを壊すので捨てる
   ・固定部分が長い（＝具体的な）ルールから順に当てる */
const TPL_RULES = isEN ? Object.entries(EN_TPL)
  .map(([ja, en]) => ({ja, en, lit: ja.split('{}').join('')}))
  .filter(r => HAS_JP.test(r.lit))
  .sort((a, b) => b.lit.length - a.lit.length)
  .map(({ja, en}) => {
    const src = ja.split('{}')
      .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([^<]{1,30}?)');
    return {re: new RegExp(src, 'g'), en};
  }) : [];

/* 辞書のキーを長い順に。最長一致で当てるため */
const KEYS = isEN ? Object.keys(EN).filter(k => k).sort((a, b) => b.length - a.length) : [];

function applyTpl(s) {
  let out = s;
  for (const r of TPL_RULES) {
    if (!HAS_JP.test(out)) break;
    r.re.lastIndex = 0;
    out = out.replace(r.re, (...m) => {
      const caps = m.slice(1, -2);
      let i = 0;
      return r.en.replace(/\{\}/g, () => (caps[i++] ?? ''));
    });
  }
  return out;
}

/* 最長一致の部分置換。当たった範囲を mask で潰して二重置換を防ぐ */
function applyDict(s) {
  let out = s;
  const mask = new Array(out.length).fill(false);
  for (const k of KEYS) {
    let from = 0;
    for (;;) {
      const i = out.indexOf(k, from);
      if (i < 0) break;
      let free = true;
      for (let j = i; j < i + k.length; j++) if (mask[j]) { free = false; break; }
      if (!free) { from = i + 1; continue; }
      const v = EN[k];
      out = out.slice(0, i) + v + out.slice(i + k.length);
      mask.splice(i, k.length, ...new Array(v.length).fill(true));
      from = i + v.length;
    }
  }
  return out;
}

const cache = new Map();

export function t(s) {
  if (!isEN || typeof s !== 'string' || !s || !HAS_JP.test(s)) return s;
  if (cache.has(s)) return cache.get(s);
  /* 文全体が辞書にあるならそれが一番正確。TPL の部分一致に壊される前に返す */
  const out = EN[s] !== undefined ? EN[s] : applyDict(applyTpl(s));
  cache.set(s, out);
  return out;
}

/* ---------------------------------------------------------------- ボタン */
/* core.js の el() を使うと t() が二重にかかるので、ここでは素の DOM で作る */
export function langToggle() {
  const wrap = document.createElement('div');
  wrap.className = 'langsw';
  for (const [code, label] of [['ja', '日本語'], ['en', 'English']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = LANG === code ? 'on' : '';
    b.setAttribute('aria-pressed', String(LANG === code));
    b.addEventListener('click', () => { if (LANG !== code) setLang(code); });
    wrap.append(b);
  }
  return wrap;
}
