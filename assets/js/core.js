/* ==========================================================================
   core.js — 共通ユーティリティ / データローダ
   ========================================================================== */
export const DATA_ROOT = new URL('./', location.href).pathname.replace(/\/assets\/js\/$/, '/');

const _cache = new Map();

export async function loadJSON(path, {optional = false} = {}) {
  if (_cache.has(path)) return _cache.get(path);
  const p = (async () => {
    const res = await fetch(path + '?t=' + Date.now(), {cache: 'no-store'});
    if (!res.ok) {
      if (optional) return null;
      throw new Error(`${path} を読み込めませんでした (${res.status})`);
    }
    return res.json();
  })();
  _cache.set(path, p);
  return p;
}

export const q = (sel, root = document) => root.querySelector(sel);
export const qa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

/* ---------- 数値 ---------- */
export const n = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const x = parseFloat(String(v).replace('%', '').replace(',', ''));
  return Number.isFinite(x) ? x : 0;
};
export const pct = (made, att, digits = 0) =>
  att > 0 ? (made / att * 100).toFixed(digits) + '%' : '–';
export const ratio = (made, att) => `${made}/${att}`;
export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + n(f(b)), 0);

/* ---------- 日付 ---------- */
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function jpDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
export function jpTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function jpStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${jpTime(iso)}`;
}

/* ---------- 色 ---------- */
/* 効率(0–100%)は 50% を中立とする発散スケール: 青(低) – 灰(中) – 赤(高) */
const DIV = [
  [0, [37, 99, 158]], [25, [96, 155, 200]], [42, [186, 205, 219]],
  [50, [222, 226, 230]], [58, [242, 203, 160]], [75, [232, 137, 79]], [100, [205, 42, 32]],
];
function lerp(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
export function effColor(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '#cfd8e0';
  const v = Math.max(0, Math.min(100, p));
  for (let i = 1; i < DIV.length; i++) {
    if (v <= DIV[i][0]) {
      const [p0, c0] = DIV[i - 1], [p1, c1] = DIV[i];
      const t = (v - p0) / (p1 - p0 || 1);
      const c = lerp(c0, c1, t);
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(205,42,32)';
}
export function effInk(p) {
  if (p === null || !Number.isFinite(p)) return '#45596b';
  return (p >= 40 && p <= 62) ? '#152b40' : '#ffffff';
}
/* カテゴリ配色（固定順・循環させない） */
export const CAT = ['#2ba3e0', '#16385c', '#1f9d6b', '#e8a33d', '#e4572e', '#7a5bbd', '#0f8c94', '#96a3ad'];
export const SERIES = {
  goals: '#1f9d6b', failed: '#2ba3e0', saves: '#e8a33d',
  outs: '#96a3ad', lost: '#d6336c', posts: '#7a5bbd',
};

/* ---------- ツールチップ ---------- */
let _tt;
export function tip(target, html) {
  if (!_tt) { _tt = el('div', {class: 'tt'}); document.body.append(_tt); }
  target.addEventListener('mouseenter', () => { _tt.innerHTML = html; _tt.classList.add('on'); });
  target.addEventListener('mousemove', (e) => {
    _tt.style.left = Math.min(e.clientX + 14, innerWidth - 270) + 'px';
    _tt.style.top = (e.clientY + 18) + 'px';
  });
  target.addEventListener('mouseleave', () => _tt.classList.remove('on'));
}

/* ---------- 共通ヘッダ ---------- */
export function renderChrome(active, tournament) {
  const t = tournament || {};
  const bar = el('div', {class: 'topbar'},
    el('div', {class: 'topbar-in'},
      el('a', {class: 'brand', href: 'index.html'},
        el('span', {text: 'HANDBALL DASHBOARD'}),
        el('small', {text: t.name || 'Asian Games 2026'})),
      el('nav', {class: 'nav'},
        el('a', {href: 'index.html', class: active === 'index' ? 'on' : '', text: '大会トップ'}),
        el('a', {href: 'match.html', class: active === 'match' ? 'on' : '', text: '試合レポート'}),
        el('a', {href: 'team.html', class: active === 'team' ? 'on' : '', text: 'チーム分析（攻撃）'}),
        el('a', {href: 'defense.html', class: active === 'defense' ? 'on' : '', text: '守備分析'}),
        el('a', {href: 'entry.html', class: active === 'entry' ? 'on' : '', text: 'データ入力'})),
      el('div', {class: 'spacer'}),
      el('div', {class: 'stamp'},
        el('div', {text: 'データ更新: ' + (t.updatedAt ? jpStamp(t.updatedAt) : '—')}),
        el('div', {text: '出典: 公式リザルト (results.asiangames2026.org)'}))));
  document.body.prepend(bar);
}

export function renderFoot() {
  document.body.append(el('footer', {class: 'foot'},
    '公式リザルトシステムのデータを自動取得して表示しています。戦術・システム情報は手入力データ（data/manual/）で補完されます。'));
}

export function setBusy(host, msg = '読み込み中…') {
  host.innerHTML = '';
  host.append(el('div', {class: 'empty', text: msg}));
}
export function setError(host, e) {
  host.innerHTML = '';
  host.append(el('div', {class: 'notice', text: 'エラー: ' + (e && e.message || e)}));
}

/* ---------- URL パラメータ ---------- */
export const params = new URLSearchParams(location.search);
export function setParam(k, v) {
  const u = new URL(location.href);
  if (v === null || v === undefined || v === '') u.searchParams.delete(k);
  else u.searchParams.set(k, v);
  history.replaceState(null, '', u);
}

/* ---------- 国旗 ----------
   公式サイトの画像URLはビルドハッシュ付きで固定できないため、
   scripts/fetch-flags.mjs が assets/flags/<CODE>.png に取り込んだものを使う。
   未取得のコードは国名コードのバッジで代替する。 */
export const flagLocal = (code) => `assets/flags/${code}.png`;
export function flagImg(code, cls = 'flag') {
  if (!code) {
    const ph = el('span', {class: cls + ' flag-ph'});
    ph.style.visibility = 'hidden';
    return ph;
  }
  const img = el('img', {class: cls, alt: code, title: code, loading: 'lazy'});
  img.onerror = () => {
    const ph = el('span', {class: cls + ' flag-ph', text: code});
    img.replaceWith(ph);
  };
  img.src = flagLocal(code);
  return img;
}

/* ---------- シュート位置定義（handball.ai 準拠） ---------- */
export const POSITIONS = [
  {key: 'LW',  label: '左ウイング',  en: 'Left Wing',      x: 12, y: 17},
  {key: 'L6',  label: '左6m',        en: 'Left 6M',        x: 27, y: 30},
  {key: 'C6',  label: 'センター6m',  en: 'Center 6M',      x: 50, y: 40},
  {key: 'R6',  label: '右6m',        en: 'Right 6M',       x: 73, y: 30},
  {key: 'RW',  label: '右ウイング',  en: 'Right Wing',     x: 88, y: 17},
  {key: 'L9',  label: '左9m',        en: 'Left 9M',        x: 19, y: 60},
  {key: 'C9',  label: 'センター9m',  en: 'Center 9M',      x: 50, y: 66},
  {key: 'R9',  label: '右9m',        en: 'Right 9M',       x: 81, y: 60},
  {key: 'P7',  label: '7mスロー',    en: '7 Meters',       x: 30, y: 84},
  {key: 'EG',  label: '無人ゴール',  en: 'Opposite Field', x: 70, y: 84},
];
export const POS_LABEL = Object.fromEntries(POSITIONS.map(p => [p.key, p.label]));

/* 選手ポジション表記 */
export const ROLE_JP = {
  GK: 'GK', LW: 'LW', LB: 'LB', CB: 'CB', RB: 'RB', RW: 'RW', LP: 'PV', PV: 'PV',
  'Goalkeeper': 'GK', 'Left Wing': 'LW', 'Left Back': 'LB', 'Centre Back': 'CB',
  'Center Back': 'CB', 'Right Back': 'RB', 'Right Wing': 'RW', 'Pivot': 'PV', 'Line Player': 'PV',
};
export const shortRole = (s) => ROLE_JP[s] || (s || '').slice(0, 2).toUpperCase();

/* 名前の整形: "KIM Donguk" → "KIM Donguk" / 長すぎる場合は省略しない（表は横スクロール） */
export function playerName(p) { return p.nameS || p.name || ''; }
