/* ==========================================================================
   connections.js — アシスト連携（誰から誰へ / ポジション間）の共通セクション
   ========================================================================== */
import {el, n, pct, ZONE_LABEL, CAT} from './core.js';
import {passMap, matrixTable, hbars, legend} from './charts.js';

/* 複数試合ぶんの connections / posLinks を合算する */
export function mergeConnections(list) {
  const conn = new Map(), pos = new Map();
  list.forEach(t => {
    (t.connections || []).forEach(c => {
      const k = `${c.fromBib}>${c.toBib}`;
      if (!conn.has(k)) conn.set(k, {...c, count: 0, goals: 0, zones: {}});
      const a = conn.get(k);
      a.count += n(c.count); a.goals += n(c.goals);
      for (const [z, v] of Object.entries(c.zones || {})) a.zones[z] = (a.zones[z] || 0) + n(v);
      if (c.fromName) a.fromName = c.fromName;
      if (c.toName) a.toName = c.toName;
    });
    (t.posLinks || []).forEach(l => {
      const k = `${l.from}>${l.to}`;
      if (!pos.has(k)) pos.set(k, {from: l.from, to: l.to, count: 0, goals: 0});
      pos.get(k).count += n(l.count);
      pos.get(k).goals += n(l.goals);
    });
  });
  return {
    connections: [...conn.values()].sort((a, b) => b.count - a.count),
    posLinks: [...pos.values()].sort((a, b) => b.count - a.count),
  };
}

const pName = (bib, name) => `#${bib} ${name}`;

/* 連携セクション本体 */
export function connectionSection({connections, posLinks}, {
  title = '連携（アシスト）', subtitle = '', tone = 'off', emptyNote = '',
} = {}) {
  const card = el('div', {class: 'card'}, el('h2', {text: title}));
  if (subtitle) card.append(el('div', {class: 'sub', text: subtitle}));

  if (!connections.length) {
    card.append(el('div', {class: 'empty', text: emptyNote || 'アシストの記録がありません。'}));
    return card;
  }

  const totalA = connections.reduce((a, c) => a + n(c.count), 0);
  const totalG = connections.reduce((a, c) => a + n(c.goals), 0);

  /* 上位連携 */
  const top = connections.slice(0, 12).map(c => ({
    label: `${pName(c.fromBib, c.fromName)} → ${pName(c.toBib, c.toName)}`,
    v: n(c.count),
    color: tone === 'def' ? CAT[4] : CAT[0],
  }));

  card.append(el('div', {class: 'grid g2'},
    el('div', {},
      passMap(posLinks, {width: 440, title: 'ポジション間のパス図'}),
      el('div', {class: 'sub', style: {marginTop: '6px'},
        text: `アシスト ${totalA} 本 / うち得点 ${totalG} 本（${pct(totalG, totalA)}）`})),
    el('div', {},
      el('div', {class: 'sec-title', text: '主な連携（選手別・上位12）'}),
      hbars(top, {valueKey: 'v', labelKey: 'label'}),
      el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: 'ポジション間 内訳'}),
      posTable(posLinks))));

  card.append(el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: '連携マトリクス（出し手 × 受け手）'}));
  card.append(playerMatrix(connections));
  card.append(el('div', {class: 'sub', style: {marginTop: '8px'},
    text: '公式のプレーバイプレー（アシスト記録）から集計しています。数字はアシスト本数。'}));
  return card;
}

function posTable(posLinks) {
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: '出し手'}), el('th', {text: '受け手'}),
    el('th', {text: 'アシスト'}), el('th', {text: '得点'}), el('th', {text: '成功率'}))));
  const tb = el('tbody', {});
  posLinks.forEach(l => tb.append(el('tr', {},
    el('td', {text: l.from}), el('td', {text: l.to}),
    el('td', {class: 'num', text: n(l.count)}),
    el('td', {class: 'num', text: n(l.goals)}),
    el('td', {class: 'num', text: pct(n(l.goals), n(l.count))}))));
  table.append(tb);
  return el('div', {class: 'tbl-scroll', style: {maxHeight: '260px', overflowY: 'auto'}}, table);
}

function playerMatrix(connections) {
  const passers = new Map(), receivers = new Map();
  connections.forEach(c => {
    if (!passers.has(c.fromBib)) passers.set(c.fromBib, {key: c.fromBib, label: pName(c.fromBib, c.fromName), role: c.fromRole});
    if (!receivers.has(c.toBib)) receivers.set(c.toBib, {key: c.toBib, label: `#${c.toBib}`, full: pName(c.toBib, c.toName), role: c.toRole});
  });
  const byTotal = (map, dir) => [...map.values()].sort((a, b) =>
    connections.filter(c => c[dir] === b.key).reduce((s, c) => s + n(c.count), 0) -
    connections.filter(c => c[dir] === a.key).reduce((s, c) => s + n(c.count), 0));
  const rows = byTotal(passers, 'fromBib');
  const cols = byTotal(receivers, 'toBib');
  const get = (r, c) => connections.find(x => x.fromBib === r.key && x.toBib === c.key)?.count || 0;
  return matrixTable(rows, cols, get, {rowLabel: '出し手＼受け手'});
}

/* シュートイベントから「どの位置から決めたか」を連携付きで見る補助 */
export function assistedZoneTable(list) {
  const z = {};
  list.forEach(t => (t.shots || []).forEach(s => {
    if (s.result !== 'GOAL') return;
    const k = s.zone;
    z[k] = z[k] || {goals: 0, assisted: 0};
    z[k].goals++;
    if (s.assistBib) z[k].assisted++;
  }));
  const rows = Object.entries(z).sort((a, b) => b[1].goals - a[1].goals);
  if (!rows.length) return null;
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: '得点位置'}), el('th', {text: '得点'}),
    el('th', {text: 'アシスト有'}), el('th', {text: '割合'}))));
  const tb = el('tbody', {});
  rows.forEach(([k, v]) => tb.append(el('tr', {},
    el('td', {text: ZONE_LABEL[k] || k}),
    el('td', {class: 'num', text: v.goals}),
    el('td', {class: 'num', text: v.assisted}),
    el('td', {class: 'num', text: pct(v.assisted, v.goals)}))));
  table.append(tb);
  return el('div', {class: 'tbl-scroll'}, table);
}
