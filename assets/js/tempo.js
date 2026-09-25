/* ==========================================================================
   tempo.js — 攻撃の速さ（速攻 / 2次速攻 / セット攻撃）の選手別内訳

   チーム単位の集計は transitions.js が担当する。こちらは同じ判定を
   「撃った選手」と「浴びたGK」に割り当てたもの。

   帯の定義は scripts/fetch-data.mjs の SECOND_WAVE_SEC と揃えてある。
     速攻      … 公式が FB と記録したもの（中央値9秒）
     2次速攻   … FB ではないが15秒以内に打ったもの（中央値11秒）
     セット攻撃 … 15秒を超えたもの（中央値36秒）

   数えているのは「攻守が切り替わった直後の攻撃」だけなので、
   選手スタッツの総得点とは一致しない。オフェンスリバウンドで続けて撃った分や、
   時刻が取れなかった数本が入らないため。表にもその注記を出している。
   ========================================================================== */
import {el, n, pct, tip, photoImg, shortRole, playerName} from './core.js';
import {legend} from './charts.js';

export const TEMPO_BANDS = [
  {key: 'fast', label: '速攻', sub: 'FB'},
  {key: 'second', label: '2次速攻', sub: '15秒以内'},
  {key: 'set', label: 'セット', sub: '15秒超'},
];

export const blankTempo = (gk) => Object.fromEntries(TEMPO_BANDS.map(b =>
  [b.key, gk ? {s: 0, sv: 0, g: 0} : {s: 0, g: 0}]));

/* 選手レコードの tempo / tempoGK を足し合わせる（累計ページ用） */
export function addTempo(acc, src, gk) {
  if (!src) return acc;
  const out = acc || blankTempo(gk);
  for (const b of TEMPO_BANDS) {
    const v = src[b.key]; if (!v) continue;
    out[b.key].s += n(v.s);
    out[b.key].g += n(v.g);
    if (gk) out[b.key].sv += n(v.sv);
  }
  return out;
}

const total = (t, key) => TEMPO_BANDS.reduce((a, b) => a + n(t?.[b.key]?.[key]), 0);
export const tempoShots = (t) => total(t, 's');
export const hasTempo = (t) => tempoShots(t) > 0;

/* 速いほど濃く。速攻の構成比を見るための薄い色づけ */
function shareInk(share) {
  if (!Number.isFinite(share) || share <= 0) return '';
  const a = Math.min(0.28, 0.05 + share * 0.5);
  return `rgba(43,163,224,${a.toFixed(3)})`;
}

/* --------------------------------------------------------------- 選手の表 */
/* mode: 'shoot'（撃った側）/ 'gk'（浴びた側） */
export function tempoTable(rows, mode) {
  const isGK = mode === 'gk';
  const table = el('table', {});
  const head = el('tr', {},
    el('th', {text: '#'}), el('th', {text: '選手'}), el('th', {text: 'Pos'}));
  TEMPO_BANDS.forEach(b => {
    head.append(el('th', {class: 'num', text: isGK ? `${b.label} 被弾` : `${b.label} 本数`}));
    head.append(el('th', {class: 'num', text: isGK ? 'セーブ率' : '決定率'}));
    head.append(el('th', {class: 'num', text: '構成比'}));
  });
  head.append(el('th', {class: 'num', text: '合計'}));
  table.append(el('thead', {}, head));

  const tb = el('tbody', {});
  const tot = blankTempo(isGK);
  rows.forEach(r => {
    const t = r.tempo, all = tempoShots(t);
    const tr = el('tr', {},
      el('td', {class: 'num muted', text: r.bib}),
      el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
        photoImg(r.reg, playerName(r), 'photo sm'),
        el('span', {text: playerName(r)}))),
      el('td', {text: shortRole(r.role)}));
    TEMPO_BANDS.forEach(b => {
      const v = t[b.key] || {}, s = n(v.s), made = isGK ? n(v.sv) : n(v.g);
      tot[b.key].s += s; tot[b.key].g += n(v.g);
      if (isGK) tot[b.key].sv += n(v.sv);
      const share = all ? s / all : 0;
      tr.append(el('td', {class: 'num', style: {background: shareInk(share)}, text: s || ''}));
      tr.append(el('td', {class: 'num', text: s ? pct(made, s) : ''}));
      tr.append(el('td', {class: 'num muted', text: s ? pct(s, all) : ''}));
    });
    tr.append(el('td', {class: 'num', style: {fontWeight: 700}, text: all || ''}));
    tb.append(tr);
  });

  const allTot = tempoShots(tot);
  const foot = el('tr', {class: 'total'},
    el('td', {}), el('td', {text: '合計'}), el('td', {}));
  TEMPO_BANDS.forEach(b => {
    const v = tot[b.key], made = isGK ? v.sv : v.g;
    foot.append(el('td', {class: 'num', text: v.s || ''}));
    foot.append(el('td', {class: 'num', text: v.s ? pct(made, v.s) : ''}));
    foot.append(el('td', {class: 'num', text: v.s ? pct(v.s, allTot) : ''}));
  });
  foot.append(el('td', {class: 'num', text: allTot || ''}));
  tb.append(foot);
  table.append(tb);
  return table;
}

/* --------------------------------------------------------------- 積み上げ棒 */
function tempoBars(rows, mode) {
  const isGK = mode === 'gk';
  const max = Math.max(1, ...rows.map(r => tempoShots(r.tempo)));
  const COLORS = BAND_COLORS;
  const wrap = el('div', {class: 'tempo-bars'});
  rows.forEach(r => {
    const t = r.tempo, all = tempoShots(t);
    if (!all) return;
    const bar = el('div', {class: 'tempo-bar'});
    TEMPO_BANDS.forEach((b, i) => {
      const v = t[b.key] || {}, s = n(v.s);
      if (!s) return;
      const seg = el('span', {class: 'tempo-seg',
        style: {width: `${s / max * 100}%`, background: COLORS[i]},
        text: s >= 3 ? String(s) : ''});
      tip(seg, `<b>${playerName(r)}</b><br>${b.label}（${b.sub}）<br>`
        + `${isGK ? '被シュート' : 'シュート'} ${s}本 / ${isGK ? 'セーブ' : '得点'} `
        + `${isGK ? n(v.sv) : n(v.g)}（${pct(isGK ? v.sv : v.g, s)}）<br>`
        + `構成比 ${pct(s, all)}`);
      bar.append(seg);
    });
    wrap.append(el('div', {class: 'tempo-row'},
      el('div', {class: 'tempo-name', text: `${r.bib} ${playerName(r)}`}),
      el('div', {class: 'tempo-track'}, bar)));
  });
  return wrap;
}

const BAND_COLORS = ['#e4572e', '#e8a33d', '#2ba3e0'];
export const tempoLegend = () => legend(TEMPO_BANDS.map((b, i) =>
  ({label: `${b.label}（${b.sub}）`, color: BAND_COLORS[i]})));

/* --------------------------------------------------------------- カード */
/* players: 選手配列（tempo / tempoGK を持つ）
   opts: {title, note} */
export function tempoCard(players, opts = {}) {
  const shooters = players
    .map(p => ({...p, tempo: p.tempo}))
    .filter(p => hasTempo(p.tempo))
    .sort((a, b) => tempoShots(b.tempo) - tempoShots(a.tempo));
  const keepers = players
    .map(p => ({...p, tempo: p.tempoGK}))
    .filter(p => hasTempo(p.tempo))
    .sort((a, b) => tempoShots(b.tempo) - tempoShots(a.tempo));

  if (!shooters.length && !keepers.length) {
    return el('div', {class: 'card'},
      el('h2', {text: opts.title || '選手別 攻撃の速さ'}),
      el('div', {class: 'sub', text: 'この範囲では速さを判定できる攻撃がありません。'}));
  }

  const card = el('div', {class: 'card'},
    el('h2', {text: opts.title || '選手別 攻撃の速さ'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 12px'},
      text: '攻守が切り替わった直後の攻撃を、シュートまでの速さで3つに分けたものです。'
        + '速攻は公式が FB と記録したもの、2次速攻は FB ではないが15秒以内、'
        + '残りがセット攻撃。15秒は所要時間の分布（山は11〜13秒）から選んだしきい値で、'
        + '公式の定義ではありません。'}));

  if (shooters.length) {
    card.append(
      el('div', {class: 'sec-title', text: '撃った選手'}),
      el('div', {class: 'tbl-scroll'}, tempoTable(shooters, 'shoot')),
      el('div', {class: 'sec-title', style: {marginTop: '14px'}, text: '選手別 速さの内訳'}),
      tempoBars(shooters, 'shoot'), tempoLegend());
  }
  if (keepers.length) {
    card.append(
      el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: 'GK — 浴びたシュート'}),
      el('div', {class: 'sub', style: {margin: '-6px 0 8px'},
        text: '速攻をどれだけ浴びたか、そのときのセーブ率です。'}),
      el('div', {class: 'tbl-scroll'}, tempoTable(keepers, 'gk')),
      el('div', {class: 'sec-title', style: {marginTop: '14px'}, text: 'GK別 速さの内訳'}),
      tempoBars(keepers, 'gk'), tempoLegend());
  }
  card.append(el('div', {class: 'sub', style: {marginTop: '12px'},
    text: opts.note || '攻守が切り替わった直後の攻撃だけを数えています。'
      + 'オフェンスリバウンドから続けて撃ったシュートや、時刻が取れなかった数本は入らないため、'
      + '合計は選手スタッツのシュート数とは一致しません。'}));
  return card;
}
