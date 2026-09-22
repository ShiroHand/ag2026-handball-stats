import {loadJSON, el, q, n, renderChrome, renderFoot, setError, params, setParam,
        POSITIONS, flagImg} from './core.js';

const app = q('#app');
let T = null, tab = params.get('tab') || 'manual';

init();
async function init() {
  try { T = await loadJSON('data/tournament.json'); }
  catch (e) { renderChrome('entry', null); setError(app, e); return; }
  renderChrome('entry', T);
  renderFoot();
  render();
}

function render() {
  app.innerHTML = '';
  app.append(el('div', {class: 'row', style: {justifyContent: 'space-between', marginBottom: '14px'}},
    el('h1', {style: {margin: 0, fontSize: '20px', color: 'var(--navy)'}, text: 'データ入力'}),
    el('div', {class: 'chips'},
      chip('manual', '戦術・システム（公式試合に追加）'),
      chip('custom', '試合を手入力で作成'))));
  app.append(el('div', {class: 'notice'},
    '入力した内容は JSON としてダウンロードされます。リポジトリの ',
    el('code', {text: 'data/manual/'}), ' または ', el('code', {text: 'data/matches/'}),
    ' に置いて commit すると、ダッシュボードに反映されます（公式データの自動更新では上書きされません）。'));
  (tab === 'manual' ? manualForm : customForm)();
}
function chip(k, label) {
  return el('button', {class: 'chip' + (tab === k ? ' on' : ''),
    onclick: () => { tab = k; setParam('tab', k); render(); }, text: label});
}

/* ---------- 共通: ダウンロード ---------- */
function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], {type: 'application/json'});
  const a = el('a', {href: URL.createObjectURL(blob), download: name});
  document.body.append(a); a.click(); a.remove();
}
function copyJSON(obj) {
  navigator.clipboard?.writeText(JSON.stringify(obj, null, 1));
}

/* ---------- 編集可能テーブル ---------- */
function editTable(cols, rows, {onChange} = {}) {
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {}, cols.map(c => el('th', {text: c.label})), el('th', {text: ''}))));
  const tb = el('tbody', {});
  const draw = () => {
    tb.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = el('tr', {});
      cols.forEach(c => {
        const input = el('input', {
          type: c.type || 'text', value: r[c.key] ?? '',
          style: {width: c.w || (c.type === 'number' ? '72px' : '160px'), textAlign: c.type === 'number' ? 'right' : 'left'},
          oninput: (e) => { r[c.key] = c.type === 'number' ? n(e.target.value) : e.target.value; onChange?.(); },
        });
        tr.append(el('td', {}, input));
      });
      tr.append(el('td', {}, el('button', {class: 'btn ghost sm', text: '削除',
        onclick: () => { rows.splice(i, 1); draw(); onChange?.(); }})));
      tb.append(tr);
    });
  };
  draw();
  table.append(tb);
  return {node: el('div', {}, el('div', {class: 'tbl-scroll'}, table),
    el('button', {class: 'btn ghost sm', style: {marginTop: '8px'}, text: '＋ 行を追加',
      onclick: () => { rows.push(Object.fromEntries(cols.map(c => [c.key, c.type === 'number' ? 0 : '']))); draw(); onChange?.(); }})),
    redraw: draw};
}

/* ================================================================ 戦術データ */
function manualForm() {
  const done = T.matches.filter(m => (T.detailIds || []).includes(m.id));
  let cur = done.find(m => m.id === params.get('id')) || done[done.length - 1];
  if (!cur) { app.append(el('div', {class: 'empty', text: '対象の試合がありません。'})); return; }

  const state = {id: cur.id, note: '', teams: []};
  const host = el('div', {});
  app.append(host);

  const sel = el('select', {onchange: (e) => { cur = done.find(m => m.id === e.target.value); setParam('id', cur.id); build(); }});
  done.forEach(m => sel.append(el('option', {value: m.id, selected: m.id === cur.id ? 'selected' : null,
    text: `${m.date} ${m.home.code} ${m.home.score}-${m.away.score} ${m.away.code}`})));

  async function build() {
    host.innerHTML = '';
    const existing = await loadJSON(`data/manual/${cur.id}.json`, {optional: true});
    state.id = cur.id;
    state.note = existing?.note || '';
    state.teams = existing?.teams || [cur.home.code, cur.away.code].map(c => ({code: c, systems: [], comment: ''}));

    const card = el('div', {class: 'card'},
      el('h2', {text: '戦術・システム入力'}),
      el('div', {class: 'row', style: {gap: '10px', marginBottom: '12px'}},
        el('span', {class: 'muted', style: {fontSize: '12px'}, text: '対象試合'}), sel,
        el('span', {class: 'tag', text: `保存先: data/manual/${cur.id}.json`})),
      el('label', {class: 'sub', text: '試合全体のメモ'}),
      el('textarea', {rows: 2, style: {width: '100%'}, value: state.note,
        oninput: (e) => state.note = e.target.value}));

    state.teams.forEach(t => {
      const cols = [
        {key: 'name', label: 'システム / アクション', w: '230px'},
        {key: 'times', label: '回数', type: 'number'},
        {key: 'goals', label: 'ゴール', type: 'number'},
        {key: 'saves', label: 'セーブ', type: 'number'},
        {key: 'postOut', label: 'ポスト/アウト', type: 'number'},
        {key: 'sevenM', label: '7m獲得', type: 'number'},
        {key: 'lost', label: 'ロスト', type: 'number'},
      ];
      if (!t.systems.length) {
        ['ATTACK 03 - PASIVE', '1x1 SITUATIONS - WEAK SIDE', '1x1 SITUATIONS - STRONG SIDE']
          .forEach(name => t.systems.push({name, times: 0, goals: 0, saves: 0, postOut: 0, sevenM: 0, lost: 0}));
      }
      const et = editTable(cols, t.systems);
      card.append(el('div', {class: 'sec-title', style: {marginTop: '16px'}}, `${t.code} の攻撃システム`),
        et.node,
        el('label', {class: 'sub', style: {marginTop: '8px', display: 'block'}, text: 'チームへのコメント'}),
        el('input', {type: 'text', style: {width: '100%'}, value: t.comment || '',
          oninput: (e) => t.comment = e.target.value}));
    });

    card.append(el('div', {class: 'row', style: {marginTop: '18px', gap: '8px'}},
      el('button', {class: 'btn', text: 'JSONをダウンロード', onclick: () => download(`${cur.id}.json`, clean(state))}),
      el('button', {class: 'btn ghost', text: 'クリップボードにコピー', onclick: () => copyJSON(clean(state))}),
      el('a', {class: 'btn ghost', href: `match.html?id=${cur.id}`, text: '試合レポートを開く'})));
    host.append(card);
  }
  function clean(s) {
    return {
      id: s.id, note: s.note,
      teams: s.teams.map(t => ({code: t.code, comment: t.comment || '',
        systems: (t.systems || []).filter(x => x.name && (n(x.times) || n(x.goals)))})),
      updatedAt: new Date().toISOString(),
    };
  }
  build();
}

/* ================================================================ 試合を手入力 */
function customForm() {
  const S = {
    id: 'CUSTOM-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    date: new Date().toISOString().slice(0, 10),
    time: '10:00', venue: '', phaseDesc: '練習試合', gender: 'M',
    home: 'JPN', away: 'OPP',
    teams: {},
  };
  const mkTeam = (code) => ({
    code, name: code, nameS: code, score: 0,
    players: [],
    shot: Object.fromEntries(POSITIONS.map(p => [p.key, {g: 0, s: 0}])),
  });
  S.teams[S.home] = mkTeam(S.home);
  S.teams[S.away] = mkTeam(S.away);

  const host = el('div', {});
  app.append(host);

  function build() {
    host.innerHTML = '';
    const meta = el('div', {class: 'card'},
      el('h2', {text: '試合の基本情報'}),
      el('div', {class: 'grid g4'},
        field('試合ID（ファイル名）', S.id, v => S.id = v),
        field('日付', S.date, v => S.date = v, 'date'),
        field('開始時刻', S.time, v => S.time = v, 'time'),
        field('会場', S.venue, v => S.venue = v),
        field('カテゴリ / ラウンド', S.phaseDesc, v => S.phaseDesc = v),
        field('ホームチーム略称', S.home, v => { renameTeam(S.home, v); S.home = v; build(); }),
        field('アウェイチーム略称', S.away, v => { renameTeam(S.away, v); S.away = v; build(); }),
        el('label', {class: 'kpi'}, el('div', {class: 'k', text: '男女'}),
          el('select', {style: {width: '100%'}, onchange: (e) => S.gender = e.target.value},
            el('option', {value: 'M', selected: S.gender === 'M' ? 'selected' : null, text: '男子'}),
            el('option', {value: 'W', selected: S.gender === 'W' ? 'selected' : null, text: '女子'})))));
    host.append(meta);

    [S.home, S.away].forEach(code => {
      const t = S.teams[code];
      const cols = [
        {key: 'bib', label: '#', type: 'number', w: '54px'},
        {key: 'nameS', label: '選手名', w: '180px'},
        {key: 'role', label: 'Pos', w: '64px'},
        {key: 'timeMin', label: '出場(分)', type: 'number'},
        {key: 'goals', label: '得点', type: 'number'},
        {key: 'shots', label: 'シュート', type: 'number'},
        {key: 'assists', label: 'アシスト', type: 'number'},
        {key: 'blocks', label: 'ブロック', type: 'number'},
        {key: 'twoMin', label: '2分', type: 'number'},
        {key: 'saves', label: 'セーブ', type: 'number'},
        {key: 'gkShots', label: '被シュート', type: 'number'},
      ];
      const et = editTable(cols, t.players, {onChange: () => { syncScore(t); scoreBadge.textContent = `得点 ${t.score}`; }});
      const scoreBadge = el('span', {class: 'tag', text: `得点 ${t.score}`});

      const shotCols = el('div', {class: 'grid g4'},
        POSITIONS.map(p => el('div', {class: 'kpi'},
          el('div', {class: 'k', text: `${p.label}（${p.en}）`}),
          el('div', {class: 'row', style: {gap: '6px'}},
            el('input', {type: 'number', style: {width: '64px'}, value: t.shot[p.key].g,
              oninput: (e) => t.shot[p.key].g = n(e.target.value)}),
            el('span', {class: 'muted', text: '/'}),
            el('input', {type: 'number', style: {width: '64px'}, value: t.shot[p.key].s,
              oninput: (e) => t.shot[p.key].s = n(e.target.value)})))));

      host.append(el('div', {class: 'card'},
        el('div', {class: 'row', style: {gap: '10px'}}, flagImg(code, 'flag sm'),
          el('h2', {style: {margin: 0}, text: `${code} — 選手スタッツ`}), scoreBadge),
        et.node,
        el('div', {class: 'sec-title', style: {marginTop: '16px'}, text: '位置別シュート（ゴール / シュート）'}),
        shotCols));
    });

    host.append(el('div', {class: 'card'},
      el('div', {class: 'row', style: {gap: '8px'}},
        el('button', {class: 'btn', text: 'JSONをダウンロード', onclick: () => download(`${S.id}.json`, toMatchFile())}),
        el('button', {class: 'btn ghost', text: 'クリップボードにコピー', onclick: () => copyJSON(toMatchFile())}),
        el('label', {class: 'btn ghost', style: {cursor: 'pointer'}}, '既存JSONを読み込む',
          el('input', {type: 'file', accept: '.json', style: {display: 'none'},
            onchange: (e) => loadFile(e.target.files[0])}))),
      el('div', {class: 'sub', style: {marginTop: '8px'}},
        'ダウンロードした JSON を data/matches/ に置き、data/tournament.json の detailIds に ID を追加すると一覧に出ます。')));
  }

  function renameTeam(oldC, newC) {
    if (!newC || oldC === newC) return;
    const t = S.teams[oldC]; delete S.teams[oldC];
    t.code = newC; t.name = newC; t.nameS = newC; S.teams[newC] = t;
  }
  function syncScore(t) { t.score = t.players.reduce((a, p) => a + n(p.goals), 0); }
  function field(label, value, set, type = 'text') {
    return el('label', {class: 'kpi'}, el('div', {class: 'k', text: label}),
      el('input', {type, value, style: {width: '100%'}, oninput: (e) => set(e.target.value)}));
  }

  function toMatchFile() {
    const teams = {};
    for (const code of [S.home, S.away]) {
      const t = S.teams[code];
      syncScore(t);
      const sum = (k) => t.players.reduce((a, p) => a + n(p[k]), 0);
      teams[code] = {
        code, name: t.name, nameS: t.nameS, score: t.score, wlt: '', rank: '',
        stats: {
          GOALS: String(sum('goals')), SHOTS: String(sum('shots')),
          EFFICIENCY: sum('shots') ? String(Math.round(sum('goals') / sum('shots') * 100)) : '0',
          GK_SAVES: String(sum('saves')), GK_SHOTS: String(sum('gkShots')),
          GK_SAVES_PERCENT: sum('gkShots') ? String(Math.round(sum('saves') / sum('gkShots') * 100)) : '0',
          '2MINUTES': String(sum('twoMin')),
          '7M_GOALS': String(t.shot.P7.g), '7M_SHOTS': String(t.shot.P7.s),
        },
        shot: t.shot,
        gk: Object.fromEntries(POSITIONS.map(p => [p.key, {sv: 0, s: 0, g: 0}])),
        gkZone: zeros(['sv', 's', 'g']), shotZone: zeros(['g', 's']), concededZone: zeros(['g', 's']),
        halves: [], derived: {assists: sum('assists'), steals: 0, blocks: sum('blocks'), blocked: 0,
          turnovers: 0, twoMin: sum('twoMin'), yc: 0, rc: 0},
        players: t.players.map(p => ({
          bib: String(p.bib), name: p.nameS, nameS: p.nameS, role: p.role, func: '', captain: false,
          isGK: /gk/i.test(p.role || '') || n(p.gkShots) > 0,
          time: '', stats: {
            GOALS: String(n(p.goals)), SHOTS: String(n(p.shots)), ASSISTS: String(n(p.assists)),
            BLOCKS: String(n(p.blocks)), '2MINUTES': String(n(p.twoMin)),
            GK_SAVES: String(n(p.saves)), GK_SHOTS: String(n(p.gkShots)),
            GK_SAVES_PERCENT: n(p.gkShots) ? String(Math.round(n(p.saves) / n(p.gkShots) * 100)) : '0',
            TIME_PLAYED: String(n(p.timeMin) * 60),
          },
          shot: Object.fromEntries(POSITIONS.map(x => [x.key, {g: 0, s: 0}])),
          gk: Object.fromEntries(POSITIONS.map(x => [x.key, {sv: 0, s: 0, g: 0}])),
          gkZone: zeros(['sv', 's', 'g']), concededZone: zeros(['g', 's']),
        })),
      };
    }
    return {
      id: S.id, key: S.id, status: 'OFFICIAL', statusDesc: '手入力',
      dateTime: `${S.date}T${S.time}:00+09:00`, date: S.date,
      venue: S.venue, location: S.venue, event: S.gender + '.CUSTOM', eventDesc: S.phaseDesc,
      gender: S.gender, phase: 'CUSTOM', phaseDesc: S.phaseDesc, unitDesc: S.phaseDesc, unitNum: '',
      duration: '', periods: [], officials: [],
      home: S.home, away: S.away, teams,
      manual: true, updatedAt: new Date().toISOString(),
    };
  }
  function zeros(keys) {
    return [0, 1, 2].map(() => [0, 1, 2].map(() => Object.fromEntries(keys.map(k => [k, 0]))));
  }
  async function loadFile(file) {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      S.id = d.id; S.date = d.date; S.time = (d.dateTime || '').slice(11, 16) || '10:00';
      S.venue = d.venue || ''; S.phaseDesc = d.phaseDesc || ''; S.gender = d.gender || 'M';
      S.home = d.home; S.away = d.away; S.teams = {};
      for (const [code, t] of Object.entries(d.teams || {})) {
        S.teams[code] = {
          code, name: t.name, nameS: t.nameS, score: n(t.score),
          shot: Object.fromEntries(POSITIONS.map(p => [p.key, {g: n(t.shot?.[p.key]?.g), s: n(t.shot?.[p.key]?.s)}])),
          players: (t.players || []).map(p => ({
            bib: p.bib, nameS: p.nameS, role: p.role,
            timeMin: Math.round(n(p.stats?.TIME_PLAYED) / 60),
            goals: n(p.stats?.GOALS), shots: n(p.stats?.SHOTS), assists: n(p.stats?.ASSISTS),
            blocks: n(p.stats?.BLOCKS), twoMin: n(p.stats?.['2MINUTES']),
            saves: n(p.stats?.GK_SAVES), gkShots: n(p.stats?.GK_SHOTS),
          })),
        };
      }
      build();
    } catch (e) { alert('読み込めませんでした: ' + e.message); }
  }

  build();
}
