/* ==========================================================================
   page-gk.js — GK分析

   ・大会のGK一覧（セーブ率と GSAA）
   ・GK個人の内訳: 速さの帯別 / ポジション群別 / コース別 / ニア・ファー別
   ・位置 × コースの行列（大会・チーム単位なら十分な標本がある）
   ========================================================================== */
import {loadJSON, el, q, n, pct, renderChrome, renderFoot, setError, setBusy,
        params, setParam, flagImg, photoImg, playerName, POSITIONS, ZONE_LABEL,
        effColor, effInk, sectionNav, tip} from './core.js';
import {goalMap, rampLegend, hbars, legend} from './charts.js';
import {selectedFromUrl, applyFilter, allMatchFilterCard} from './matchfilter.js';
import {COURSES, COURSE_LABEL, ON_TARGET, POS_GROUPS, groupOfZone,
        NEARFAR, nearFar, buildRef, gkSummary, saveRate, savePctNum} from './gkstats.js';

const app = q('#app');
let T = null, FILES = null, gender = params.get('g') || 'M';
let picked = selectedFromUrl();
let who = params.get('gk') || '';          // "TEAM|背番号"

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('gk', null); setError(app, e); return; }
  renderChrome('gk', T);
  renderFoot();
  setBusy(app, 'データを集計中…');
  FILES = (await Promise.all((T.detailIds || []).map(id =>
    loadJSON(`data/matches/${id}.json`, {optional: true})))).filter(Boolean);
  render();
}

/* ------------------------------------------------------------------ 集計 */
const isGK = (p) => /^(gk|g)$/i.test(p.role || '');

/* 対象試合から、GKごとに「浴びたシュート」を集める。
   相手チームの shots[] のうち gkBib が一致するものが、そのGKの被シュート。 */
function collect(list) {
  const gks = new Map();                   // key -> {code,bib,name,reg,games,shots[]}
  const all = [];                          // 参照表（大会平均）用に全シュート
  for (const f of list) {
    for (const code of [f.home, f.away]) {
      const me = f.teams[code], op = f.teams[code === f.home ? f.away : f.home];
      if (!me || !op) continue;
      for (const s of me.shots || []) all.push(s);
      for (const p of me.players || []) {
        if (!isGK(p)) continue;
        const key = code + '|' + p.bib;
        const cur = gks.get(key) || {key, code, bib: p.bib, name: playerName(p),
          reg: p.reg || '', gender: f.gender, games: 0, shots: []};
        if (!cur.reg && p.reg) cur.reg = p.reg;
        const faced = (op.shots || []).filter(s => s.gkBib === p.bib);
        if (!faced.length && !n(p.stats?.GK_SHOTS)) continue;
        cur.games++;
        cur.shots.push(...faced);
        gks.set(key, cur);
      }
    }
  }
  return {gks: [...gks.values()], all};
}

/* ------------------------------------------------------------------ 描画 */
function render() {
  app.innerHTML = '';

  const events = (T.events || []);
  app.append(el('div', {class: 'row', style: {marginBottom: '14px', gap: '10px'}},
    el('span', {class: 'muted', style: {fontSize: '12px'}, text: 'カテゴリ'}),
    el('div', {class: 'chips'}, events.map(ev => el('button', {
      class: 'chip' + (ev.gender === gender ? ' on' : ''),
      text: ev.gender === 'W' ? '女子' : '男子',
      onclick: () => { gender = ev.gender; setParam('g', gender); who = ''; setParam('gk', null); render(); },
    })))));

  const list0 = FILES.filter(f => f.gender === gender)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  if (!list0.length) {
    app.append(el('div', {class: 'card'}, el('div', {class: 'notice', text: 'このカテゴリの集計済み試合がまだありません。'})));
    return;
  }
  app.append(allMatchFilterCard(list0, picked, (next) => { picked = next; render(); }));
  const list = applyFilter(list0, picked);

  const {gks, all} = collect(list);
  const ref = buildRef(all);
  if (!gks.length) {
    app.append(el('div', {class: 'card'}, el('div', {class: 'notice', text: 'この範囲にGKの記録がありません。'})));
    return;
  }

  const rows = gks.map(g => ({...g, sum: gkSummary(g.shots, ref)}))
    .filter(g => g.sum.n > 0)
    .sort((a, b) => b.sum.gsaa - a.sum.gsaa);

  app.append(refCard(ref, all));
  app.append(rankCard(rows));

  if (!who || !rows.some(r => r.key === who)) who = rows[0].key;
  const cur = rows.find(r => r.key === who);
  app.append(pickerCard(rows));
  app.append(detailCard(cur, ref));
  app.append(posCourseCard(cur, all));
  sectionNav(app);
}

/* ---------- 参照表（位置×コースの大会平均決定率） ---------- */
function refCard(ref, all) {
  const withCourse = all.filter(s => ON_TARGET.has(s.result) && s.goalZone).length;
  const off = all.filter(s => !ON_TARGET.has(s.result)).length;
  return el('div', {class: 'card'},
    el('h2', {text: '前提 — このページで使うデータ'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: `対象のシュート ${all.length} 本。うち枠内 ${all.length - off} 本で、`
        + `コースが記録されているのは ${withCourse} 本です。`
        + '公式データではコースが枠内のシュートにしか付かないため、'
        + '枠外・ポストは位置別と速さ別までは出せますが、コース別には出せません。'
        + '速さの帯はシュートの約85%に付きます（ハーフ最初の攻撃、'
        + 'オフェンスリバウンドからの再シュート、時刻が取れなかった数本は帯が付きません）。'}),
    el('div', {class: 'sec-title', text: '枠内シュートの決定率（位置 × コース・大会平均）'}),
    el('div', {class: 'sub', style: {margin: '-6px 0 8px'},
      text: '期待失点の基準になる表です。標本の薄いセルは位置別の平均へ縮小しています（経験ベイズ）。'
        + 'セルの数字は「得点 / 本数」。'}),
    el('div', {class: 'tbl-scroll'}, refTable(ref)),
    rampLegend('決定率'));
}

function refTable(ref) {
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {text: '位置'}), COURSES.map(c => el('th', {class: 'num', text: COURSE_LABEL[c]})),
    el('th', {class: 'num', text: '計'}))));
  const tb = el('tbody', {});
  const zones = [...POSITIONS.map(p => p.key), 'BT', 'FB', 'FLY', 'EG']
    .filter((z, i, a) => a.indexOf(z) === i)
    .filter(z => ref.byPos[z]);
  zones.forEach(z => {
    const tr = el('tr', {}, el('td', {text: ZONE_LABEL[z] || z}));
    COURSES.forEach(c => {
      const v = ref.cell[z + '|' + c] || {n: 0, g: 0};
      const e = v.n > 0 ? v.g / v.n * 100 : null;
      const td = el('td', {class: 'num', text: v.n ? `${v.g}/${v.n}` : '·'});
      if (v.n) { td.style.background = effColor(e); td.style.color = effInk(e); }
      tip(td, `${ZONE_LABEL[z] || z} → ${COURSE_LABEL[c]}<br>得点 ${v.g} / 本数 ${v.n}`
        + `<br>実測 ${pct(v.g, v.n)}<br>補正後 ${(ref.rate[z + '|' + c] * 100).toFixed(0)}%`);
      tr.append(td);
    });
    const p = ref.byPos[z];
    tr.append(el('td', {class: 'num', style: {fontWeight: 700}, text: `${p.g}/${p.n}`}));
    tb.append(tr);
  });
  table.append(tb);
  return table;
}

/* ---------- GK一覧 ---------- */
const xgTd = (s) => {
  const td = el('td', {class: 'num muted', text: s.xg.toFixed(1)});
  tip(td, `コースが記録されている ${s.xn} 本が対象<br>`
    + `期待失点 ${s.xg.toFixed(1)} / 同じ ${s.xn} 本での実失点 ${s.xgoals}`);
  return td;
};

function rankCard(rows) {
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    ['GK', 'チーム', '試合', '被シュート', '枠内', 'セーブ', '失点', 'セーブ率',
      '期待失点', 'GSAA', '速攻セーブ率', '遅攻セーブ率'].map(h => el('th', {text: h})))));
  const tb = el('tbody', {});
  rows.forEach(r => {
    const s = r.sum;
    const on = s.onTarget;
    const fast = s.band.fast, set = s.band.set;
    const g = s.gsaa;
    const td = el('td', {class: 'num', style: {fontWeight: 700,
      color: g > 0 ? 'var(--good)' : (g < 0 ? 'var(--bad)' : '')}, text: (g > 0 ? '+' : '') + g.toFixed(1)});
    tip(td, `期待失点 ${s.xg.toFixed(1)} − 実失点 ${s.goals} = ${(g > 0 ? '+' : '') + g.toFixed(1)}`
      + '<br>プラスが大きいほど、平均的なGKより多く止めた');
    tb.append(el('tr', {},
      el('td', {}, el('div', {class: 'row', style: {gap: '7px', flexWrap: 'nowrap'}},
        photoImg(r.reg, r.name, 'photo sm'), el('span', {text: r.name}))),
      el('td', {}, el('div', {class: 'row', style: {gap: '6px', flexWrap: 'nowrap'}},
        flagImg(r.code, 'flag sm'), el('span', {text: r.code}))),
      el('td', {class: 'num', text: r.games}),
      el('td', {class: 'num', text: s.n}),
      el('td', {class: 'num', text: on}),
      el('td', {class: 'num', text: s.saves}),
      el('td', {class: 'num', text: s.goals}),
      el('td', {class: 'num', style: {fontWeight: 700}, text: on ? pct(s.saves, on) : ''}),
      xgTd(s),
      td,
      el('td', {class: 'num', text: saveRate(fast) || '·'}),
      el('td', {class: 'num', text: saveRate(set) || '·'})));
  });
  table.append(tb);

  return el('div', {class: 'card'},
    el('h2', {text: 'GK一覧 — 平均的なGKとの差（GSAA）'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'GSAA = 期待失点 − 実失点。浴びたシュート1本ずつについて「位置とコースが同じシュートを'
        + '大会平均のGKが受けたら何点入っていたか」を足し上げ、実際の失点を引いたものです。'
        + 'セーブ率は浴びたシュートの質に左右されますが、GSAAはそれを補正します。'
        + '基準にはそのGK自身のぶんを除いた平均を使っています（自分の成績が基準に混ざらないように）。'}),
    el('div', {class: 'tbl-scroll'}, table));
}

/* ---------- GK選択 ---------- */
function pickerCard(rows) {
  const chips = el('div', {class: 'chips'});
  rows.slice().sort((a, b) => b.sum.n - a.sum.n).forEach(r => {
    chips.append(el('button', {
      class: 'chip' + (r.key === who ? ' on' : ''),
      text: `${r.code} ${r.bib} ${r.name}（${r.sum.n}本）`,
      onclick: () => { who = r.key; setParam('gk', who); render(); },
    }));
  });
  return el('div', {class: 'card'},
    el('h2', {text: 'GKを選択'}),
    chips);
}

/* ---------- GK個人の内訳 ---------- */
function detailCard(r, ref) {
  const s = r.sum;
  const box = el('div', {class: 'card'},
    el('div', {class: 'row', style: {gap: '10px', marginBottom: '4px'}},
      flagImg(r.code, 'flag sm'), photoImg(r.reg, r.name, 'photo sm'),
      el('h2', {style: {margin: 0}, text: `${r.name} — 内訳`})),
    el('div', {class: 'sub', style: {margin: '0 0 12px'},
      text: `${r.games} 試合 / 被シュート ${s.n} 本（枠内 ${s.onTarget}・枠外/ポスト ${s.off}）`
        + ` / セーブ ${s.saves}・失点 ${s.goals} / GSAA ${(s.gsaa > 0 ? '+' : '') + s.gsaa.toFixed(1)}`}));

  /* 速さの帯別 */
  box.append(el('div', {class: 'sec-title', text: '速さの帯別'}),
    el('div', {class: 'sub', style: {margin: '-6px 0 8px'},
      text: '攻守が切り替わった直後の攻撃を、シュートまでの速さで3つに分けたものです。'
        + '帯が付かないシュート（ハーフ最初の攻撃など）はこの表に入りません。'}),
    el('div', {class: 'tbl-scroll'}, breakTable(
      [['fast', '速攻（FB）'], ['second', '2次速攻（15秒以内）'], ['set', 'セット攻撃（15秒超）'],
        ['none', '帯なし（ハーフ最初の攻撃など）']],
      k => s.band[k])));

  /* ポジション群別 */
  box.append(el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: 'シュート位置別'}),
    el('div', {class: 'tbl-scroll'}, breakTable(
      POS_GROUPS.map(g => [g.key, g.label]), k => s.group[k])));

  /* コース別 */
  const zones = [[], [], []];
  COURSES.forEach((c, i) => {
    const v = s.course[c] || {n: 0, saves: 0, goals: 0};
    zones[Math.floor(i / 3)][i % 3] = {g: v.goals, s: v.goals + v.saves};
  });
  box.append(el('div', {class: 'sec-title', style: {marginTop: '18px'}, text: 'コース別（枠内のみ）'}),
    el('div', {class: 'sub', style: {margin: '-6px 0 8px'},
      text: 'セルは「失点 / 浴びた本数」。色が濃い赤ほど決められている場所です。'}),
    el('div', {class: 'row', style: {gap: '18px', alignItems: 'flex-start'}},
      el('div', {}, goalMap(zones), rampLegend('被決定率')),
      el('div', {style: {flex: '1 1 260px'}},
        el('div', {class: 'sec-title', text: 'ニア／ファー別'}),
        el('div', {class: 'sub', style: {margin: '-6px 0 8px'},
          text: 'シュート位置から見て近いポスト側がニア、遠い側がファー。'
            + '左右のウイング・サイドを合算できるので標本が倍になります。'
            + '中央（センター・7m・速攻）は左右の別が無いため分けています。'}),
        el('div', {class: 'tbl-scroll'}, breakTable(
          NEARFAR.map(x => [x.key, x.label]), k => s.nearfar[k], true)))));

  return box;
}

/* 帯・位置群・ニアファーで共通の内訳表 */
function breakTable(keys, get, onTargetOnly = false) {
  const table = el('table', {});
  const head = onTargetOnly
    ? ['区分', '浴びた', 'セーブ', '失点', 'セーブ率', '期待失点', '差']
    : ['区分', '浴びた', '枠内', 'セーブ', '失点', '枠外・ポスト', 'セーブ率', '期待失点', '差'];
  table.append(el('thead', {}, el('tr', {}, head.map(h => el('th', {class: h === '区分' ? '' : 'num', text: h})))));
  const tb = el('tbody', {});
  const tot = {n: 0, saves: 0, goals: 0, off: 0, xn: 0, xg: 0, xgoals: 0};
  keys.forEach(([k, label]) => {
    const v = get(k) || {n: 0, saves: 0, goals: 0, off: 0, xn: 0, xg: 0, xgoals: 0};
    ['n', 'saves', 'goals', 'off', 'xn', 'xg', 'xgoals'].forEach(f => tot[f] += n(v[f]));
    tb.append(row(label, v));
  });
  tb.append(row('合計', tot, true));
  table.append(tb);
  return table;

  function row(label, v, isTot) {
    const on = v.n - v.off;
    const d = v.xg - v.xgoals;
    const cells = onTargetOnly
      ? [v.n || '', v.saves || '', v.goals || '', on > 0 ? pct(v.saves, on) : '']
      : [v.n || '', on || '', v.saves || '', v.goals || '', v.off || '', on > 0 ? pct(v.saves, on) : ''];
    const tr = el('tr', isTot ? {class: 'total'} : {}, el('td', {text: label}),
      cells.map(c => el('td', {class: 'num', text: c})));
    const xtd = el('td', {class: 'num muted', text: v.xn ? v.xg.toFixed(1) : ''});
    if (v.xn) tip(xtd, `コースが記録されている ${v.xn} 本が対象<br>期待失点 ${v.xg.toFixed(1)} / 実失点 ${v.xgoals}`);
    tr.append(xtd);
    tr.append(el('td', {class: 'num', style: {fontWeight: 700,
      color: d > 0.05 ? 'var(--good)' : (d < -0.05 ? 'var(--bad)' : '')},
      text: v.xn ? (d > 0 ? '+' : '') + d.toFixed(1) : ''}));
    return tr;
  }
}

/* ---------- 位置 × コース ---------- */
function posCourseCard(r, all) {
  const scope = el('div', {class: 'chips'});
  let mode = posCourseCard.mode || 'gk';
  const make = () => {
    const src = mode === 'gk' ? r.shots : all;
    const m = {};
    for (const s of src) {
      if (!ON_TARGET.has(s.result) || !s.goalZone || !s.zone) continue;
      const k = s.zone + '|' + s.goalZone;
      (m[k] = m[k] || {n: 0, g: 0}).n++;
      if (s.result === 'GOAL') m[k].g++;
    }
    return m;
  };
  const host = el('div', {});
  const draw = () => {
    host.innerHTML = '';
    const m = make();
    const table = el('table', {});
    table.append(el('thead', {}, el('tr', {},
      el('th', {text: '位置'}), COURSES.map(c => el('th', {class: 'num', text: COURSE_LABEL[c]})),
      el('th', {class: 'num', text: '計'}))));
    const tb = el('tbody', {});
    const zones = [...new Set(Object.keys(m).map(k => k.split('|')[0]))]
      .sort((a, b) => cnt(b) - cnt(a));
    function cnt(z) { return COURSES.reduce((a, c) => a + (m[z + '|' + c]?.n || 0), 0); }
    zones.forEach(z => {
      const tr = el('tr', {}, el('td', {text: ZONE_LABEL[z] || z}));
      COURSES.forEach(c => {
        const v = m[z + '|' + c];
        const td = el('td', {class: 'num', text: v ? `${v.g}/${v.n}` : '·'});
        if (v) {
          const e = v.g / v.n * 100;
          td.style.background = effColor(e); td.style.color = effInk(e);
          tip(td, `${ZONE_LABEL[z] || z} → ${COURSE_LABEL[c]}<br>失点 ${v.g} / 浴びた ${v.n}`);
        }
        tr.append(td);
      });
      tr.append(el('td', {class: 'num', style: {fontWeight: 700}, text: cnt(z)}));
      tb.append(tr);
    });
    table.append(tb);
    host.append(el('div', {class: 'tbl-scroll'}, table));
    if (mode === 'gk') {
      const total = zones.reduce((a, z) => a + cnt(z), 0);
      host.append(el('div', {class: 'sub', style: {marginTop: '8px'},
        text: `このGKの枠内被シュートは ${total} 本。位置13 × コース9 = 117 セルなので、`
          + '1セルあたり平均1本前後にしかなりません。個人の傾向として読むのは無理があります。'
          + '「大会全体」に切り替えると、どの位置からどのコースを狙うのが定石かが見えます。'}));
    }
  };
  [['gk', 'このGKが浴びた'], ['all', '大会全体']].forEach(([k, label]) => {
    scope.append(el('button', {class: 'chip' + (mode === k ? ' on' : ''),
      text: label,
      onclick: (e) => {
        mode = k; posCourseCard.mode = k;
        [...scope.children].forEach(c => c.className = 'chip');
        e.currentTarget.className = 'chip on';
        draw();
      }}));
  });
  draw();
  return el('div', {class: 'card'},
    el('h2', {text: '位置 × コース'}),
    el('div', {class: 'sub', style: {margin: '-4px 0 10px'},
      text: 'どの位置からどのコースへ打たれているか。セルは「失点 / 浴びた本数」です。'}),
    scope, el('div', {style: {marginTop: '10px'}}, host));
}
