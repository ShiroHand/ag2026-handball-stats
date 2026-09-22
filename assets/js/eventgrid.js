/* ==========================================================================
   eventgrid.js — 選手別イベントの記号タイムライン（handball.ai 方式）
   1行 = 1選手、横軸 = 試合経過時間。出来事を記号で置く。
   ========================================================================== */
import {el, n, pct, tip, shortRole, photoImg, params} from './core.js';
import {svg} from './charts.js';

/* 記号の定義。mark: 円内に描く文字（空なら塗りつぶしの点）  */
export const EVENT_SYMBOLS = {
  G:   {mark: '',   fill: '#1f9d6b', ink: '#fff', label: 'ゴール',            group: 'att'},
  '7G':{mark: '7',  fill: '#1f9d6b', ink: '#fff', label: '7mゴール',          group: 'att'},
  GG:  {mark: 'G',  fill: '#0f8c94', ink: '#fff', label: 'GKのゴール',        group: 'att'},
  A:   {mark: 'A',  fill: '#2ba3e0', ink: '#fff', label: 'アシスト',          group: 'att'},
  X:   {mark: 'X',  fill: '#e4572e', ink: '#fff', label: 'ノーゴール（セーブ・ポスト・枠外）', group: 'att'},
  '7X':{mark: '7',  fill: '#e4572e', ink: '#fff', label: '7m失敗',            group: 'att'},
  L:   {mark: '',   fill: '#2f3d49', ink: '#fff', label: 'ミス（ロストボール・テクニカル）', group: 'att'},
  S:   {mark: 'S',  fill: '#7a5bbd', ink: '#fff', label: 'スティール',        group: 'def'},
  B:   {mark: 'B',  fill: '#16385c', ink: '#fff', label: 'ブロック',          group: 'def'},
  '7C':{mark: 'P',  fill: '#c98b2a', ink: '#fff', label: '7mを与えた',        group: 'def'},
  '2M':{mark: '2',  fill: '#d92d20', ink: '#fff', label: '2分間退場',         group: 'def'},
  YC:  {mark: '',   fill: '#e8c33d', ink: '#3a2f00', label: '警告（イエロー）', group: 'def'},
  RC:  {mark: '',   fill: '#b3170f', ink: '#fff', label: '失格（レッド）',     group: 'def'},
  GS:  {mark: 'S',  fill: '#1f9d6b', ink: '#fff', label: 'GKセーブ',          group: 'gk'},
  GR:  {mark: '',   fill: '#e4572e', ink: '#fff', label: 'GK失点',            group: 'gk'},
};

const ATT_SET = new Set(['G', '7G', 'GG', 'X', '7X']);
const MISS_SET = new Set(['X', '7X']);

/* 選手ごとに集計する */
export function summarize(events, players) {
  const by = new Map();
  const get = (bib) => {
    if (!by.has(bib)) by.set(bib, {bib, ev: [], goals: 0, shots: 0, assists: 0,
      lost: 0, steals: 0, blocks: 0, twoMin: 0, saves: 0, conceded: 0, sevenC: 0});
    return by.get(bib);
  };
  for (const p of players) get(p.bib);
  for (const e of events) {
    const r = get(e.bib);
    r.ev.push(e);
    if (ATT_SET.has(e.type)) { r.shots++; if (!MISS_SET.has(e.type)) r.goals++; }
    if (e.type === 'A') r.assists++;
    if (e.type === 'L') r.lost++;
    if (e.type === 'S') r.steals++;
    if (e.type === 'B') r.blocks++;
    if (e.type === '7C') r.sevenC++;
    if (e.type === '2M') r.twoMin++;
    if (e.type === 'GS') r.saves++;
    if (e.type === 'GR') r.conceded++;
  }
  return by;
}

/* 記号ひとつ */
function marker(x, y, e, r = 8.2) {
  const s = EVENT_SYMBOLS[e.type];
  if (!s) return null;
  const g = svg('g', {class: 'eg-mark'});
  g.append(svg('circle', {cx: x, cy: y, r, fill: s.fill, stroke: '#fff', 'stroke-width': 1.4}));
  if (s.mark) {
    g.append(svg('text', {
      x, y: y + 3.3, 'text-anchor': 'middle', 'font-size': 9.5,
      'font-weight': 700, fill: s.ink,
    }, s.mark));
  }
  const extra = e.zone ? `<br>位置: ${e.zone}` : '';
  tip(g, `<b>${s.label}</b><br>${e.p}P ${e.t}${extra}`);
  return g;
}

/* ---------- 本体 ----------
   rows: [{player, sum}]、横軸は 0 〜 maxSec。 */
export function eventGrid(rows, {maxSec = 3600, width = 900, rowH = 30, showPhoto = true} = {}) {
  const padL = 8, padR = 14, padT = 26;
  const H = padT + rows.length * rowH + 10;
  const plotW = width - padL - padR;
  const xOf = (sec) => padL + Math.max(0, Math.min(1, sec / maxSec)) * plotW;

  /* 画素そのままで描く（引き伸ばすと記号が楕円になるため） */
  const root = svg('svg', {class: 'eg-svg', viewBox: `0 0 ${width} ${H}`, width, height: H});

  /* 5分ごとの目盛り、ハーフタイムは太線 */
  for (let s = 0; s <= maxSec; s += 300) {
    const x = xOf(s);
    const half = s > 0 && s % 1800 === 0;
    root.append(svg('line', {x1: x, y1: padT - 8, x2: x, y2: H - 8,
      stroke: half ? '#9fb2c2' : '#e6ecf2', 'stroke-width': half ? 1.4 : 1}));
    if (s % 600 === 0 && s < maxSec) {
      root.append(svg('text', {x: x + 3, y: 13, 'font-size': 10, fill: '#7b8fa1'}, `${s / 60}'`));
    }
  }

  rows.forEach((r, i) => {
    const y = padT + i * rowH + rowH / 2;
    if (i % 2 === 0) {
      root.append(svg('rect', {x: 0, y: y - rowH / 2, width, height: rowH, fill: '#f6f9fc'}));
    }
    /* 2分退場はその2分間を帯で示す */
    for (const e of r.sum.ev) {
      if (e.type !== '2M') continue;
      root.append(svg('rect', {
        x: xOf(e.sec), y: y - 11, width: Math.max(2, xOf(e.sec + 120) - xOf(e.sec)), height: 22,
        fill: '#d92d20', opacity: 0.12, rx: 3,
      }));
    }
    /* 同時刻に重なったら少し縦にずらす */
    const seen = [];
    for (const e of r.sum.ev) {
      const x = xOf(e.sec);
      const near = seen.filter(v => Math.abs(v - x) < 13).length;
      seen.push(x);
      const m = marker(x, y + (near % 2 ? (near % 4 < 2 ? -9 : 9) : 0), e);
      if (m) root.append(m);
    }
  });
  return root;
}

/* 凡例（使われた記号だけを出す） */
export function symbolLegend(used = null) {
  const keys = Object.keys(EVENT_SYMBOLS).filter(k => !used || used.has(k));
  const box = el('div', {class: 'eg-legend'});
  for (const k of keys) {
    const s = EVENT_SYMBOLS[k];
    if (!s) continue;
    const dot = el('span', {class: 'eg-dot', text: s.mark || ''});
    dot.style.background = s.fill;
    dot.style.color = s.ink;
    box.append(el('span', {class: 'eg-leg-item'}, dot, el('span', {text: s.label})));
  }
  return box;
}

/* ---------- 選手別イベント カード ---------- */
export function eventGridSection(team, {maxSec = 3600, gridWidth = 1000} = {}) {
  const events = team.events || [];
  if (!events.length) {
    return el('div', {class: 'empty', text: 'この試合のプレーバイプレーがまだ取得できていません。'});
  }
  const sums = summarize(events, team.players || []);
  const order = {GK: 0, LW: 1, LB: 2, CB: 3, RB: 4, RW: 5, PV: 6, LP: 6};
  const rows = (team.players || [])
    .map(p => ({player: p, sum: sums.get(p.bib)}))
    .filter(r => r.sum && r.sum.ev.length)
    .sort((a, b) => {
      const ra = order[shortRole(a.player.role)] ?? 9, rb = order[shortRole(b.player.role)] ?? 9;
      return ra - rb || (parseInt(a.player.bib, 10) || 0) - (parseInt(b.player.bib, 10) || 0);
    });
  if (!rows.length) return el('div', {class: 'empty', text: '記録された出来事がありません。'});

  const wrap = el('div', {class: 'eg-wrap'});

  /* 左: 選手（顔写真つき） / 右: 時間軸（横スクロール） */
  const names = el('div', {class: 'eg-names'});
  names.append(el('div', {class: 'eg-head', text: '選手'}));
  const stats = el('div', {class: 'eg-stats'});
  const isGKteam = rows.some(r => r.player.isGK);
  stats.append(el('div', {class: 'eg-head eg-statrow'},
    el('span', {text: '得点'}), el('span', {text: 'S'}), el('span', {text: '成功率'}),
    el('span', {text: 'A'}), el('span', {text: 'ミス'}),
    el('span', {text: isGKteam ? 'SV' : '—'}), el('span', {text: '2分'})));

  for (const r of rows) {
    const p = r.player, s = r.sum;
    const cell = el('div', {class: 'eg-name'});
    cell.append(photoImg(p.reg, p.nameS || p.name, 'eg-photo'));
    cell.append(el('span', {class: 'eg-bib', text: p.bib}));
    cell.append(el('span', {class: 'eg-pname'},
      el('b', {text: p.nameS || p.name}),
      el('small', {text: shortRole(p.role) + (p.captain ? ' · C' : '')})));
    names.append(cell);

    const gkSh = s.saves + s.conceded;
    stats.append(el('div', {class: 'eg-statrow num'},
      el('span', {text: s.goals || '–'}),
      el('span', {text: s.shots || '–'}),
      el('span', {text: s.shots ? pct(s.goals, s.shots) : '–'}),
      el('span', {text: s.assists || '–'}),
      el('span', {text: s.lost || '–'}),
      el('span', {text: gkSh ? `${s.saves}/${gkSh}` : '–'}),
      el('span', {text: s.twoMin || '–'})));
  }

  /* 幅は実際の表示幅に合わせて描き直す（記号を真円に保つため） */
  const grid = el('div', {class: 'eg-grid'});
  let drawnAt = 0;
  const draw = (w) => {
    const px = Math.max(680, Math.round(w) || gridWidth);
    if (Math.abs(px - drawnAt) < 12) return;
    drawnAt = px;
    grid.innerHTML = '';
    grid.append(eventGrid(rows, {maxSec, width: px}));
  };
  draw(gridWidth);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(([e]) => draw(e.contentRect.width)).observe(grid);
  }

  wrap.append(names, grid, stats);
  wrap.usedSymbols = new Set(events.map(e => e.type));
  return wrap;
}
