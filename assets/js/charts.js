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
export function courtMap(map, {title = '', width = 460} = {}) {
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
    const w = 20, hh = 9.4;
    const gx = p.x - w / 2, gy = p.y - hh / 2;
    const grp = svg('g', {});
    grp.append(svg('rect', {x: gx, y: gy, width: w, height: hh, rx: 4.7,
      fill: s > 0 ? effColor(e) : 'rgba(255,255,255,.28)',
      stroke: 'rgba(255,255,255,.55)', 'stroke-width': .35}));
    grp.append(svg('text', {x: p.x, y: gy + 3.6, 'text-anchor': 'middle', 'font-size': 2.5,
      'font-weight': 600, fill: s > 0 ? effInk(e) : '#ffffff', opacity: .85}, p.en));
    grp.append(svg('text', {x: p.x, y: gy + 7.6, 'text-anchor': 'middle', 'font-size': 4.2,
      'font-weight': 700, fill: s > 0 ? effInk(e) : '#ffffff'}, `${g}/${s}`));
    tip(grp, `<b>${p.label}</b><br>ゴール ${g} / シュート ${s}<br>決定率 ${pct(g, s)}`);
    root.append(grp);
  });

  const box = el('div', {});
  if (title) box.append(el('div', {class: 'sec-title', text: title}));
  box.append(el('div', {class: 'mapbox'}, root));
  box.append(rampLegend('決定率'));
  return box;
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
export function hbars(rows, {valueKey = 'v', labelKey = 'label', max = null, color = '#2ba3e0', fmtv = (v) => v, height = 22} = {}) {
  const m = max ?? Math.max(1, ...rows.map(r => n(r[valueKey])));
  return el('div', {},
    rows.map(r => el('div', {class: 'row', style: {gap: '8px', margin: '3px 0'}},
      el('div', {style: {width: '150px', fontSize: '12px'}, class: 'nowrap', text: r[labelKey]}),
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
export function lineChart(series, labels, {width = 820, height = 210, yTitle = ''} = {}) {
  const pad = {l: 34, r: 12, t: 14, b: 26};
  const maxY = Math.max(3, ...series.flatMap(s => s.values.map(n)));
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const X = (i) => pad.l + (labels.length > 1 ? i / (labels.length - 1) * iw : iw / 2);
  const Y = (v) => pad.t + ih - (n(v) / maxY) * ih;
  const root = svg('svg', {class: 'chart', viewBox: `0 0 ${width} ${height}`});
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = maxY / ticks * i, y = Y(v);
    root.append(svg('line', {x1: pad.l, x2: width - pad.r, y1: y, y2: y, stroke: '#e3eaf1', 'stroke-width': 1}));
    root.append(svg('text', {x: pad.l - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#7b8fa1'}, Math.round(v)));
  }
  labels.forEach((lb, i) => {
    const anchor = i === 0 ? 'start' : (i === labels.length - 1 ? 'end' : 'middle');
    const x = i === 0 ? pad.l - 2 : (i === labels.length - 1 ? width - pad.r + 2 : X(i));
    root.append(svg('text', {x, y: height - 7, 'text-anchor': anchor, 'font-size': 10, fill: '#7b8fa1'}, lb));
  });
  series.forEach(s => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'} ${X(i)} ${Y(v)}`).join(' ');
    root.append(svg('path', {d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round'}));
    s.values.forEach((v, i) => {
      const c = svg('circle', {cx: X(i), cy: Y(v), r: 4, fill: s.color, stroke: '#fff', 'stroke-width': 2});
      tip(c, `<b>${s.label}</b><br>${labels[i]}: ${v}`);
      root.append(c);
    });
  });
  if (yTitle) root.append(svg('text', {x: pad.l, y: 10, 'font-size': 10, fill: '#7b8fa1'}, yTitle));
  return root;
}

export {SERIES};
