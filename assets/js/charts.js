/* ==========================================================================
   charts.js — 依存なしの SVG チャート群
   ========================================================================== */
import {el, n, pct, effColor, effInk, tip, POSITIONS, SERIES} from './core.js';

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    e.setAttribute(k, v);
  }
  kids.flat().forEach(k => k && e.append(k.nodeType ? k : document.createTextNode(String(k))));
  return e;
}

/* ---------- ドーナツ ---------- */
export function donut(segments, {size = 190, thickness = 34, centerTop = '', centerSub = ''} = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - thickness / 2 - 2, cx = size / 2, cy = size / 2;
  const root = svg('svg', {class: 'chart', viewBox: `0 0 ${size} ${size}`, role: 'img'});
  let a0 = -Math.PI / 2;
  if (total <= 0) {
    root.append(svg('circle', {cx, cy, r, fill: 'none', stroke: '#e6ecf2', 'stroke-width': thickness}));
  }
  segments.forEach(s => {
    if (s.value <= 0) return;
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    const path = svg('path', {
      d: `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${large} 1 ${p1[0]} ${p1[1]}`,
      fill: 'none', stroke: s.color, 'stroke-width': thickness,
    });
    tip(path, `<b>${s.label}</b><br>${s.value} (${pct(s.value, total)})`);
    root.append(path);
    const mid = (a0 + a1) / 2, lr = r;
    if (s.value / total > 0.07) {
      root.append(svg('text', {
        x: cx + lr * Math.cos(mid), y: cy + lr * Math.sin(mid) + 4,
        'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#fff',
      }, pct(s.value, total)));
    }
    a0 = a1;
  });
  if (centerTop) {
    root.append(svg('text', {x: cx, y: cy - 2, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 700, fill: '#16385c'}, centerTop));
    root.append(svg('text', {x: cx, y: cy + 16, 'text-anchor': 'middle', 'font-size': 11, fill: '#7b8fa1'}, centerSub));
  }
  return root;
}

export function legend(items) {
  return el('div', {class: 'legend'},
    items.map(i => el('span', {}, el('i', {style: {background: i.color}}), i.label)));
}

/* ---------- 左右比較バー ---------- */
export function compareRow(label, left, right, {fmtv = (v) => v, hi = 'high'} = {}) {
  const lv = n(left), rv = n(right), max = Math.max(lv, rv, 1);
  const better = hi === 'high' ? (lv === rv ? 0 : (lv > rv ? -1 : 1)) : (lv === rv ? 0 : (lv < rv ? -1 : 1));
  const c = (side) => better === side ? '#16385c' : '#a9bccd';
  return el('div', {class: 'cmp-row'},
    el('div', {class: 'cmp-val right num', text: fmtv(left)}),
    el('div', {class: 'bar rtl'}, el('div', {class: 'fill', style: {width: (lv / max * 100) + '%', background: c(-1)}})),
    el('div', {class: 'cmp-label', text: label}),
    el('div', {class: 'bar'}, el('div', {class: 'fill', style: {width: (rv / max * 100) + '%', background: c(1)}})),
    el('div', {class: 'cmp-val num', text: fmtv(right)}));
}

/* ---------- コート別シュートマップ ---------- */
/* map: {LW:{g,s}, ...}  */
/* attacks を渡すと、各位置の「50回の攻撃あたり何点そこから取れているか」を併記する。
   分母はチームの総攻撃回数なので、全位置を足すと 50攻撃あたりの総得点になる。
   perLabel は守備側で「失点」に言い換えるために使う。 */
/* コート上の位置が決まらない攻撃。図の下に別枠で並べて、合計が必ず100%になるようにする。 */
export const OFF_COURT = [
  {key: 'BT', label: 'ブレイクスルー', en: 'Breakthrough'},
  {key: 'FB', label: '速攻', en: 'Fast Break'},
  {key: 'FLY', label: 'フライング', en: 'Flying'},
];
export const ALL_ZONE_KEYS = [...POSITIONS.map(p => p.key), ...OFF_COURT.map(z => z.key)];

export function courtMap(map, {title = '', width = 460, attacks = 0, perLabel = '得点', per = 50} = {}) {
  const h = Math.round(width * 0.92);
  const root = svg('svg', {class: 'chart', viewBox: `0 0 100 92`, preserveAspectRatio: 'xMidYMid meet'});
  root.setAttribute('style', `width:100%;max-width:${width}px;height:auto`);

  /* コート下地（角丸でクリップ） */
  const cid = 'cc' + Math.random().toString(36).slice(2, 8);
  root.append(svg('defs', {}, svg('clipPath', {id: cid},
    svg('rect', {x: 0, y: 0, width: 100, height: 92, rx: 3}))));
  const court = svg('g', {'clip-path': `url(#${cid})`});
  court.append(svg('rect', {x: 0, y: 0, width: 100, height: 92, fill: '#7fc0f2'}));
  /* 6mライン内（ゴールエリア） */
  court.append(svg('path', {d: 'M 9 0 A 41 33 0 0 0 91 0 Z', fill: '#1d3f66'}));
  court.append(svg('path', {d: 'M 9 0 A 41 33 0 0 0 91 0', fill: 'none', stroke: '#ffffff', 'stroke-width': .7}));
  /* 9mライン（フリースローライン） */
  court.append(svg('path', {d: 'M -2 0 A 52 48 0 0 0 102 0', fill: 'none', stroke: '#ffffff',
    'stroke-width': .6, 'stroke-dasharray': '2.4 2.2'}));
  /* ゴール */
  court.append(svg('rect', {x: 42, y: 0, width: 16, height: 1.8, fill: '#ffffff'}));
  root.append(court);

  POSITIONS.forEach(p => {
    const d = map && map[p.key] || {g: 0, s: 0};
    const g = n(d.g), s = n(d.s);
    const e = s > 0 ? g / s * 100 : null;
    const p50 = attacks > 0 ? g / attacks * per : null;
    const dp = per <= 10 ? 2 : 1;
    const w = 20, hh = attacks > 0 ? 12.4 : 9.4;
    const gx = p.x - w / 2, gy = p.y - hh / 2;
    const grp = svg('g', {});
    grp.append(svg('rect', {x: gx, y: gy, width: w, height: hh, rx: 4.7,
      fill: s > 0 ? effColor(e) : 'rgba(255,255,255,.28)',
      stroke: 'rgba(255,255,255,.55)', 'stroke-width': .35}));
    const ink = s > 0 ? effInk(e) : '#ffffff';
    grp.append(svg('text', {x: p.x, y: gy + 3.4, 'text-anchor': 'middle', 'font-size': 2.5,
      'font-weight': 600, fill: ink, opacity: .85}, p.en));
    grp.append(svg('text', {x: p.x, y: gy + 7.4, 'text-anchor': 'middle', 'font-size': 4.2,
      'font-weight': 700, fill: ink}, `${g}/${s}`));
    if (p50 !== null) {
      grp.append(svg('text', {x: p.x, y: gy + 11, 'text-anchor': 'middle', 'font-size': 2.9,
        'font-weight': 700, fill: ink, opacity: .9}, `${per}回 ${p50.toFixed(dp)}`));
    }
    const extra = p50 === null ? ''
      : `<br>${per}攻撃あたり${perLabel} ${p50.toFixed(dp)}`;
    tip(grp, `<b>${p.label}</b><br>ゴール ${g} / シュート ${s}<br>決定率 ${pct(g, s)}${extra}`);
    root.append(grp);
  });

  const box = el('div', {});
  if (title) box.append(el('div', {class: 'sec-title', text: title}));
  box.append(el('div', {class: 'mapbox'}, root));

  /* コート上に置けない攻撃（速攻・ブレイクスルー・フライング）を別枠に並べる。
     これを足すと、図の合計が KPI の「50回あたり」と完全に一致する。 */
  const extras = OFF_COURT.filter(z => n(map?.[z.key]?.s) > 0 || n(map?.[z.key]?.g) > 0);
  if (extras.length) {
    const strip = el('div', {class: 'offcourt'});
    strip.append(el('span', {class: 'offcourt-label', text: '位置が定まらない攻撃'}));
    extras.forEach(z => {
      const d = map[z.key] || {g: 0, s: 0};
      const g = n(d.g), s = n(d.s);
      const e = s > 0 ? g / s * 100 : null;
      const pill = el('div', {class: 'offcourt-pill'});
      pill.style.background = s > 0 ? effColor(e) : 'var(--surface-2)';
      pill.style.color = s > 0 ? effInk(e) : 'var(--ink-3)';
      pill.append(el('span', {class: 'oc-k', text: z.label}));
      pill.append(el('span', {class: 'oc-v', text: `${g}/${s}`}));
      if (attacks > 0) pill.append(el('span', {class: 'oc-p', text: `${per}回 ${(g / attacks * per).toFixed(1)}`}));
      tip(pill, `<b>${z.label}</b><br>ゴール ${g} / シュート ${s}<br>決定率 ${pct(g, s)}`
        + (attacks > 0 ? `<br>${per}回あたり${perLabel} ${(g / attacks * per).toFixed(2)}` : ''));
      strip.append(pill);
    });
    box.append(strip);
  }

  box.append(rampLegend('決定率'));
  if (attacks > 0) {
    const sumAll = ALL_ZONE_KEYS.reduce((a, k) => a + n(map?.[k]?.g), 0);
    box.append(el('div', {class: 'sub', style: {margin: '4px 0 0'},
      text: `上段 = ゴール/シュート（色は決定率）、下段 = ${per}回あたりの${perLabel}。`
        + `コート${POSITIONS.length}箇所＋別枠を合計すると ${(sumAll / attacks * per).toFixed(1)}`
        + `（${perLabel}${sumAll} ÷ ${attacks}回 × ${per}）で、KPI と一致します。`}));
  }
  return box;
}

/* シュート位置の内訳表。コート図と同じ数字を、合計まで含めて並べる。
   全ゾーンを足すとチームの総得点・総シュートに一致する（公式値で検証済み）。 */
export function zoneBreakdownTable(map, {attacks = 0, perLabel = '得点', per = 50, shotLabel = 'シュート'} = {}) {
  const rows = [
    ...POSITIONS.map(p => ({key: p.key, label: p.label, group: 'コート上'})),
    ...OFF_COURT.map(z => ({key: z.key, label: z.label, group: '位置が定まらない'})),
  ];
  const tot = rows.reduce((a, r) => {
    const d = map?.[r.key] || {};
    return {g: a.g + n(d.g), s: a.s + n(d.s)};
  }, {g: 0, s: 0});

  const table = el('table', {});
  const head = ['位置', perLabel, shotLabel, '決定率', `${per}回あたり`, `${perLabel}の構成比`];
  table.append(el('thead', {}, el('tr', {}, head.map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  let lastGroup = null;
  rows.forEach(r => {
    const d = map?.[r.key] || {};
    const g = n(d.g), s = n(d.s);
    if (!s && !g) return;
    if (r.group !== lastGroup) {
      lastGroup = r.group;
      tb.append(el('tr', {}, el('td', {colspan: head.length,
        style: {background: 'var(--surface-2)', fontWeight: 700, fontSize: '11.5px',
          color: 'var(--ink-3)', textAlign: 'left'}, text: r.group})));
    }
    const e = s > 0 ? g / s * 100 : null;
    const bar = el('span', {class: 'pillbar'});
    const fill = el('span');
    fill.style.width = (tot.g > 0 ? g / tot.g * 100 : 0) + '%';
    fill.style.background = 'var(--blue)';
    bar.append(fill);
    tb.append(el('tr', {},
      el('td', {text: r.label}),
      el('td', {class: 'num', style: {fontWeight: 700}, text: g || ''}),
      el('td', {class: 'num', text: s || ''}),
      el('td', {class: 'num', style: e === null ? null : {color: effColor(e), fontWeight: 700},
        text: s > 0 ? pct(g, s) : '–'}),
      el('td', {class: 'num', text: attacks > 0 ? (g / attacks * per).toFixed(1) : '–'}),
      el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
        bar, el('span', {class: 'num', style: {fontSize: '11.5px', minWidth: '34px'},
          text: tot.g > 0 ? pct(g, tot.g) : '–'})))));
  });
  tb.append(el('tr', {class: 'total'},
    el('td', {text: '合計'}),
    el('td', {class: 'num', text: tot.g}),
    el('td', {class: 'num', text: tot.s}),
    el('td', {class: 'num', text: pct(tot.g, tot.s)}),
    el('td', {class: 'num', text: attacks > 0 ? (tot.g / attacks * per).toFixed(1) : '–'}),
    el('td', {class: 'num', text: '100%'})));
  table.append(tb);
  return el('div', {class: 'tbl-scroll'}, table);
}

export function rampLegend(label = '決定率') {
  const sw = el('span', {class: 'sw'});
  [5, 20, 35, 50, 65, 80, 95].forEach(v => sw.append(el('i', {style: {background: effColor(v)}})));
  return el('div', {class: 'ramp'}, el('span', {text: '低'}), sw, el('span', {text: '高'}),
    el('span', {class: 'muted', text: '　' + label}));
}

/* ---------- ゴールマウス 3×3 マップ ---------- */
/* zones: [[{g,s} x3] x3] 上段→下段, outside:{top,left,right} */
export function goalMap(zones, outside = {}, {width = 380} = {}) {
  const root = svg('svg', {class: 'chart', viewBox: '0 0 100 74'});
  root.setAttribute('style', `width:100%;max-width:${width}px;height:auto`);
  root.append(svg('rect', {x: 0, y: 0, width: 100, height: 74, rx: 3, fill: '#1d3f66'}));
  /* 枠外表示 */
  const out = (x, y, v) => root.append(svg('text', {x, y, 'text-anchor': 'middle', 'font-size': 5,
    'font-weight': 700, fill: '#ffffff', opacity: .85}, v ?? 0));
  out(50, 8, outside.top);
  out(7, 40, outside.left);
  out(93, 40, outside.right);

  const x0 = 16, y0 = 14, w = 68, h = 48, gap = 1.1;
  const cw = (w - gap * 2) / 3, ch = (h - gap * 2) / 3;
  /* ゴールポスト */
  root.append(svg('rect', {x: x0 - 2, y: y0 - 2, width: w + 4, height: h + 4, fill: 'none',
    stroke: '#9fd0f5', 'stroke-width': 1.4}));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const d = (zones && zones[r] && zones[r][c]) || {g: 0, s: 0};
    const g = n(d.g), s = n(d.s), e = s > 0 ? g / s * 100 : null;
    const x = x0 + c * (cw + gap), y = y0 + r * (ch + gap);
    const grp = svg('g', {});
    grp.append(svg('rect', {x, y, width: cw, height: ch, rx: 1,
      fill: s > 0 ? effColor(e) : '#23507f'}));
    grp.append(svg('text', {x: x + cw / 2, y: y + ch / 2 + 2.4, 'text-anchor': 'middle',
      'font-size': 6, 'font-weight': 700, fill: s > 0 ? effInk(e) : '#7fa6cc'}, `${g} / ${s}`));
    tip(grp, `ゴール ${g} / シュート ${s}（決定率 ${pct(g, s)}）`);
    root.append(grp);
  }
  return root;
}

/* ---------- 横棒ランキング ---------- */
export function hbars(rows, {valueKey = 'v', labelKey = 'label', max = null, color = '#2ba3e0', fmtv = (v) => v, height = 22, labelWidth = '210px'} = {}) {
  const m = max ?? Math.max(1, ...rows.map(r => n(r[valueKey])));
  return el('div', {},
    rows.map(r => el('div', {class: 'row', style: {gap: '8px', margin: '3px 0'}},
      el('div', {style: {width: labelWidth, fontSize: '11.5px'}, class: 'nowrap', text: r[labelKey]}),
      el('div', {style: {flex: '1'}},
        el('div', {class: 'bar', style: {height: '12px'}},
          el('div', {class: 'fill', style: {width: (n(r[valueKey]) / m * 100) + '%', background: r.color || color}}))),
      el('div', {class: 'num', style: {width: '52px', textAlign: 'right', fontSize: '12px', fontWeight: 600},
        text: fmtv(r[valueKey])}))));
}

/* ---------- 積み上げ棒（選手別 内訳） ---------- */
export function stackedBars(rows, keys, {width = 1100, barH = 20} = {}) {
  const maxTotal = Math.max(1, ...rows.map(r => keys.reduce((a, k) => a + n(r[k.key]), 0)));
  const host = el('div', {});
  rows.forEach(r => {
    const total = keys.reduce((a, k) => a + n(r[k.key]), 0);
    const bar = el('div', {class: 'bar', style: {height: barH + 'px', borderRadius: '4px', width: (total / maxTotal * 100) + '%', minWidth: total ? '2px' : '0'}});
    keys.forEach(k => {
      const v = n(r[k.key]);
      if (!v) return;
      const seg = el('span', {style: {
        display: 'block', height: '100%', width: (v / (total || 1) * 100) + '%',
        background: k.color, boxShadow: 'inset -2px 0 0 #fff',
      }});
      tip(seg, `<b>${r.label}</b><br>${k.label}: ${v}`);
      bar.append(seg);
    });
    host.append(el('div', {class: 'row', style: {gap: '8px', margin: '2px 0'}},
      el('div', {style: {width: '190px', fontSize: '12px'}, class: 'nowrap', text: r.label}),
      el('div', {style: {flex: '1', display: 'flex'}}, bar),
      el('div', {class: 'num muted', style: {width: '34px', fontSize: '11px', textAlign: 'right'}, text: total || ''})));
  });
  return host;
}

/* ---------- 5分刻み折れ線 ---------- */
/* values に null を混ぜると、その区間は線を切って点も描かない（データ無しの意味）。
   maxY を渡すと縦軸を固定でき、割合のグラフを 0–100% に揃えられる。 */
export function lineChart(series, labels, {width = 820, height = 210, yTitle = '',
  maxY: fixedMax = null, fmtv = (v) => v, ticks = 4} = {}) {
  const pad = {l: 38, r: 12, t: 14, b: 26};
  const finite = (v) => v !== null && v !== undefined && Number.isFinite(n(v));
  const maxY = fixedMax || Math.max(3, ...series.flatMap(s => s.values.filter(finite).map(n)));
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const X = (i) => pad.l + (labels.length > 1 ? i / (labels.length - 1) * iw : iw / 2);
  const Y = (v) => pad.t + ih - (n(v) / maxY) * ih;
  const root = svg('svg', {class: 'chart', viewBox: `0 0 ${width} ${height}`});
  for (let i = 0; i <= ticks; i++) {
    const v = maxY / ticks * i, y = Y(v);
    root.append(svg('line', {x1: pad.l, x2: width - pad.r, y1: y, y2: y, stroke: '#e3eaf1', 'stroke-width': 1}));
    root.append(svg('text', {x: pad.l - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#7b8fa1'}, fmtv(Math.round(v))));
  }
  labels.forEach((lb, i) => {
    const anchor = i === 0 ? 'start' : (i === labels.length - 1 ? 'end' : 'middle');
    const x = i === 0 ? pad.l - 2 : (i === labels.length - 1 ? width - pad.r + 2 : X(i));
    root.append(svg('text', {x, y: height - 7, 'text-anchor': anchor, 'font-size': 10, fill: '#7b8fa1'}, lb));
  });
  series.forEach(s => {
    /* データが無い区間で線を切る */
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (!finite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'} ${X(i)} ${Y(v)} `;
      pen = true;
    });
    if (d) {
      root.append(svg('path', {
        d: d.trim(), fill: 'none', stroke: s.color,
        'stroke-width': s.dash ? 1.5 : 2, 'stroke-linejoin': 'round',
        'stroke-dasharray': s.dash || null, opacity: s.dash ? 0.65 : 1,
      }));
    }
    s.values.forEach((v, i) => {
      if (!finite(v)) return;
      const c = svg('circle', {
        cx: X(i), cy: Y(v), r: s.dash ? 2.6 : 4,
        fill: s.dash ? '#fff' : s.color, stroke: s.color, 'stroke-width': 2,
        opacity: s.dash ? 0.75 : 1,
      });
      tip(c, s.tips?.[i] || `<b>${s.label}</b><br>${labels[i]}: ${fmtv(v)}`);
      root.append(c);
    });
  });
  if (yTitle) root.append(svg('text', {x: pad.l, y: 10, 'font-size': 10, fill: '#7b8fa1'}, yTitle));
  return root;
}

export {SERIES};

/* ---------- ポジション連携図（パスネットワーク） ---------- */
/* links: [{from, to, count, goals}] / ノードはハンドボールの基本ポジション */
export const PASS_NODES = {
  LW: {label: 'LW', jp: '左ウイング', x: 13, y: 26},
  PV: {label: 'PV', jp: 'ピボット',   x: 50, y: 33},
  RW: {label: 'RW', jp: '右ウイング', x: 87, y: 26},
  LB: {label: 'LB', jp: '左バック',   x: 25, y: 62},
  CB: {label: 'CB', jp: 'センター',   x: 50, y: 70},
  RB: {label: 'RB', jp: '右バック',   x: 75, y: 62},
  GK: {label: 'GK', jp: 'GK',         x: 50, y: 88},
  OTH: {label: '—', jp: 'その他',     x: 88, y: 84},
};

export function passMap(links, {width = 460, metric = 'count', title = ''} = {}) {
  const used = new Set();
  links.forEach(l => { used.add(l.from); used.add(l.to); });
  const max = Math.max(1, ...links.map(l => n(l[metric])));

  const root = svg('svg', {class: 'chart', viewBox: '0 0 100 96'});
  root.setAttribute('style', `width:100%;max-width:${width}px;height:auto`);
  const cid = 'pc' + Math.random().toString(36).slice(2, 8);
  const aid = 'ah' + Math.random().toString(36).slice(2, 8);
  root.append(svg('defs', {},
    svg('clipPath', {id: cid}, svg('rect', {x: 0, y: 0, width: 100, height: 96, rx: 3})),
    svg('marker', {id: aid, viewBox: '0 0 10 10', refX: 8, refY: 5,
      markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse'},
      svg('path', {d: 'M 0 1 L 9 5 L 0 9 z', fill: '#ffffff'}))));

  const court = svg('g', {'clip-path': `url(#${cid})`});
  court.append(svg('rect', {x: 0, y: 0, width: 100, height: 96, fill: '#7fc0f2'}));
  court.append(svg('path', {d: 'M 9 0 A 41 33 0 0 0 91 0 Z', fill: '#1d3f66'}));
  court.append(svg('path', {d: 'M 9 0 A 41 33 0 0 0 91 0', fill: 'none', stroke: '#fff', 'stroke-width': .7}));
  court.append(svg('path', {d: 'M -2 0 A 52 48 0 0 0 102 0', fill: 'none', stroke: '#fff',
    'stroke-width': .6, 'stroke-dasharray': '2.4 2.2'}));
  court.append(svg('rect', {x: 42, y: 0, width: 16, height: 1.8, fill: '#fff'}));
  root.append(court);

  /* 矢印（本数が多いものほど太く不透明に） */
  links.slice().sort((a, b) => n(a[metric]) - n(b[metric])).forEach(l => {
    const A = PASS_NODES[l.from], B = PASS_NODES[l.to];
    if (!A || !B) return;
    const v = n(l[metric]);
    if (!v) return;
    const w = 0.7 + (v / max) * 3.2;
    const op = 0.42 + (v / max) * 0.58;
    const g = svg('g', {opacity: op});

    if (l.from === l.to) {                     // 自分から自分（同ポジション間）
      const r = 7.2;
      g.append(svg('path', {
        d: `M ${A.x - 3} ${A.y - 4} a ${r} ${r} 0 1 1 6 0`,
        fill: 'none', stroke: '#ffffff', 'stroke-width': w,
        'marker-end': `url(#${aid})`, 'stroke-linecap': 'round'}));
    } else {
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(9, len * 0.22);
      const cx = mx - (dy / len) * bow, cy = my + (dx / len) * bow;
      /* ノードの縁で止める */
      const t0 = 5.6 / len, t1 = 1 - 6.4 / len;
      const pt = (t) => {
        const u = 1 - t;
        return [u * u * A.x + 2 * u * t * cx + t * t * B.x,
                u * u * A.y + 2 * u * t * cy + t * t * B.y];
      };
      const p0 = pt(t0), p1 = pt(t1);
      g.append(svg('path', {d: `M ${p0[0]} ${p0[1]} Q ${cx} ${cy} ${p1[0]} ${p1[1]}`,
        fill: 'none', stroke: '#ffffff', 'stroke-width': w,
        'marker-end': `url(#${aid})`, 'stroke-linecap': 'round'}));
      const lp = pt(0.5);
      g.append(svg('circle', {cx: lp[0], cy: lp[1], r: 3, fill: '#16385c', opacity: .9}));
      g.append(svg('text', {x: lp[0], y: lp[1] + 1.5, 'text-anchor': 'middle',
        'font-size': 3.4, 'font-weight': 700, fill: '#ffffff'}, String(v)));
    }
    tip(g, `<b>${A.jp} → ${B.jp}</b><br>アシスト ${n(l.count)} 本 / 得点 ${n(l.goals)}`);
    root.append(g);
  });

  /* ノード */
  Object.entries(PASS_NODES).forEach(([k, p]) => {
    if (!used.has(k)) return;
    const out = links.filter(l => l.from === k).reduce((a, l) => a + n(l[metric]), 0);
    const inn = links.filter(l => l.to === k).reduce((a, l) => a + n(l[metric]), 0);
    const g = svg('g', {});
    g.append(svg('circle', {cx: p.x, cy: p.y, r: 5.4, fill: '#16385c',
      stroke: '#ffffff', 'stroke-width': .8}));
    g.append(svg('text', {x: p.x, y: p.y + 1.6, 'text-anchor': 'middle',
      'font-size': 4, 'font-weight': 700, fill: '#ffffff'}, p.label));
    tip(g, `<b>${p.jp}</b><br>出し手として ${out} 本<br>受け手として ${inn} 本`);
    root.append(g);
  });

  const box = el('div', {});
  if (title) box.append(el('div', {class: 'sec-title', text: title}));
  box.append(el('div', {class: 'mapbox'}, root));
  box.append(el('div', {class: 'ramp'},
    el('span', {class: 'muted', text: '矢印 = アシストの向き / 太さと数字 = 本数'})));
  return box;
}

/* ---------- 連携マトリクス（出し手 × 受け手） ---------- */
export function matrixTable(rows, cols, get, {rowLabel = '出し手＼受け手', fmtv = (v) => v || ''} = {}) {
  const max = Math.max(1, ...rows.flatMap(r => cols.map(c => n(get(r, c)))));
  const table = el('table', {class: 'matrix'});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: rowLabel}), cols.map(c => el('th', {text: c.label})), el('th', {text: '計'}))));
  const tb = el('tbody', {});
  rows.forEach(r => {
    const tot = cols.reduce((a, c) => a + n(get(r, c)), 0);
    tb.append(el('tr', {},
      el('td', {text: r.label}),
      cols.map(c => {
        const v = n(get(r, c));
        const td = el('td', {class: 'num', text: fmtv(v)});
        if (v) {
          td.style.background = `rgba(43,163,224,${0.12 + (v / max) * 0.6})`;
          td.style.fontWeight = '700';
          td.style.color = v / max > 0.6 ? '#fff' : 'inherit';
        }
        return td;
      }),
      el('td', {class: 'num', style: {fontWeight: 700}, text: tot || ''})));
  });
  const totRow = el('tr', {class: 'total'}, el('td', {text: '計'}),
    cols.map(c => el('td', {class: 'num', text: rows.reduce((a, r) => a + n(get(r, c)), 0) || ''})),
    el('td', {class: 'num', text: rows.reduce((a, r) => a + cols.reduce((b, c) => b + n(get(r, c)), 0), 0)}));
  tb.append(totRow);
  table.append(tb);
  return el('div', {class: 'tbl-scroll'}, table);
}
