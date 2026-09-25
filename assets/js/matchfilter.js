/* ==========================================================================
   matchfilter.js — 対象試合を複数選べるフィルター

   選択は URL の m= に入れる（例 m=M-GPA-000100,M-GPA-000300）ので、
   絞り込んだ状態のままリンクを共有できる。空なら全試合。
   ========================================================================== */
import {el, flagImg, jpDate, params, setParam, t} from './core.js';

/* URL から選択中の試合IDを読む。指定が無ければ null（= 全試合）。 */
export function selectedFromUrl() {
  const raw = (params.get('m') || '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

/* 実際に集計する試合を返す。選択が空になったときは全試合に戻す。 */
export function applyFilter(all, sel) {
  if (!sel) return all;
  const out = all.filter(f => sel.has(f.id));
  return out.length ? out : all;
}

export function writeSelection(all, sel) {
  if (!sel || sel.size === 0 || sel.size === all.length) setParam('m', null);
  else setParam('m', [...sel].join(','));
}

/* ---------- 大会全体の試合フィルター ----------
   チーム単位ではなく「この大会のどの試合を使うか」を選ぶ版。
   日付ごとにまとめて並べ、日付見出しをクリックするとその日をまとめて出し入れできる。 */
export function allMatchFilterCard(all, selected, onChange) {
  const sel = selected ? new Set(selected) : new Set(all.map(f => f.id));
  const countLabel = el('span', {class: 'mf-count'});
  const refresh = () => {
    countLabel.textContent = t(sel.size === all.length
      ? `全${all.length}試合` : `${sel.size} / ${all.length} 試合を分析中`);
    countLabel.className = 'mf-count' + (sel.size === all.length ? '' : ' on');
  };
  const commit = () => {
    if (!sel.size) return;
    writeSelection(all, sel);
    onChange(sel.size === all.length ? null : new Set(sel));
  };

  const byDay = new Map();
  all.forEach(f => {
    if (!byDay.has(f.date)) byDay.set(f.date, []);
    byDay.get(f.date).push(f);
  });

  const body = el('div', {class: 'mf-days'});
  const btns = new Map();
  [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([day, games]) => {
    const row = el('div', {class: 'mf-day'});
    row.append(el('button', {
      class: 'mf-daylabel', text: jpDate(day),
      title: 'この日の試合をまとめて出し入れ',
      onclick: () => {
        const allOn = games.every(f => sel.has(f.id));
        games.forEach(f => {
          if (allOn) { if (sel.size > 1) sel.delete(f.id); } else sel.add(f.id);
          btns.get(f.id)?.classList.toggle('on', sel.has(f.id));
        });
        refresh(); commit();
      },
    }));
    const wrap = el('div', {class: 'mf-chips'});
    games.forEach(f => {
      const b = el('button', {class: 'mf-chip' + (sel.has(f.id) ? ' on' : ''),
        title: f.phaseDesc || ''});
      b.append(flagImg(f.home, 'flag sm'));
      b.append(el('span', {class: 'mf-main'},
        el('b', {text: `${f.home} ${f.teams[f.home]?.score}-${f.teams[f.away]?.score} ${f.away}`})));
      b.append(flagImg(f.away, 'flag sm'));
      b.onclick = () => {
        if (sel.has(f.id)) { if (sel.size === 1) return; sel.delete(f.id); b.classList.remove('on'); }
        else { sel.add(f.id); b.classList.add('on'); }
        refresh(); commit();
      };
      btns.set(f.id, b);
      wrap.append(b);
    });
    row.append(wrap);
    body.append(row);
  });

  const setAll = (on) => {
    sel.clear();
    (on ? all : all.slice(-4)).forEach(f => sel.add(f.id));
    btns.forEach((b, id) => b.classList.toggle('on', sel.has(id)));
    refresh(); commit();
  };

  refresh();
  return el('div', {class: 'card mf-card'},
    el('div', {class: 'row', style: {gap: '10px', marginBottom: '8px'}},
      el('span', {class: 'mf-title', text: '分析に使う試合'}),
      countLabel,
      el('div', {style: {flex: '1'}}),
      el('button', {class: 'btn ghost sm', text: '全選択', onclick: () => setAll(true)}),
      el('button', {class: 'btn ghost sm', text: '直近4試合', onclick: () => setAll(false)})),
    body,
    el('div', {class: 'sub', style: {margin: '8px 0 0'},
      text: '試合または日付をクリックして絞り込みます。選んだ状態はURLに残るので共有できます。'}));
}

/* ---------- フィルターのカード ----------
   all:      そのチームの全試合（古い順）
   selected: Set または null
   oppOf:    その試合の相手コードを返す関数
   onChange: 新しい Set を受け取って再描画する
*/
export function matchFilterCard(all, selected, oppOf, onChange) {
  const sel = selected ? new Set(selected) : new Set(all.map(f => f.id));
  const allOn = sel.size === all.length;

  const chips = el('div', {class: 'mf-chips'});
  const countLabel = el('span', {class: 'mf-count'});
  const refreshCount = () => {
    countLabel.textContent = t(sel.size === all.length
      ? `全${all.length}試合`
      : `${sel.size} / ${all.length} 試合を集計中`);
    countLabel.className = 'mf-count' + (sel.size === all.length ? '' : ' on');
  };

  const commit = () => {
    if (sel.size === 0) return;          // 0件は許さない（全解除は「全選択」で戻す）
    writeSelection(all, sel);
    onChange(sel.size === all.length ? null : new Set(sel));
  };

  all.forEach(f => {
    const opp = oppOf(f);
    const me = f.teams[Object.keys(f.teams).find(k => k !== opp)] || {};
    const mine = f.home === opp ? f.away : f.home;
    const myScore = f.teams[mine]?.score, opScore = f.teams[opp]?.score;
    const won = Number(myScore) > Number(opScore);
    const btn = el('button', {
      class: 'mf-chip' + (sel.has(f.id) ? ' on' : ''),
      title: `${f.date} ${f.phaseDesc || ''}`,
    });
    btn.append(flagImg(opp, 'flag sm'));
    btn.append(el('span', {class: 'mf-main'},
      el('b', {text: opp}),
      el('span', {class: 'mf-score', text: `${myScore}-${opScore}`})));
    btn.append(el('span', {class: 'mf-date', text: jpDate(f.date)}));
    btn.append(el('span', {class: 'mf-wl' + (won ? ' w' : ' l'), text: won ? 'W' : 'L'}));
    btn.onclick = () => {
      if (sel.has(f.id)) {
        if (sel.size === 1) return;      // 最後の1件は外させない
        sel.delete(f.id); btn.classList.remove('on');
      } else {
        sel.add(f.id); btn.classList.add('on');
      }
      refreshCount();
      commit();
    };
    chips.append(btn);
  });

  const setAll = (on) => {
    sel.clear();
    if (on) all.forEach(f => sel.add(f.id));
    else all.slice(-1).forEach(f => sel.add(f.id));   // 「直近1試合」を最小選択とする
    [...chips.children].forEach((c, i) => c.classList.toggle('on', sel.has(all[i].id)));
    refreshCount();
    commit();
  };

  refreshCount();
  return el('div', {class: 'card mf-card'},
    el('div', {class: 'row', style: {gap: '10px', marginBottom: '8px'}},
      el('span', {class: 'mf-title', text: '対象試合'}),
      countLabel,
      el('div', {style: {flex: '1'}}),
      el('button', {class: 'btn ghost sm', text: '全選択', onclick: () => setAll(true)}),
      el('button', {class: 'btn ghost sm', text: '直近1試合', onclick: () => setAll(false)})),
    chips,
    el('div', {class: 'sub', style: {margin: '8px 0 0'},
      text: allOn ? '試合をクリックすると、そのぶんだけを集計します（選んだ状態はURLに残るので共有できます）。'
        : '一部の試合だけを集計しています。「全選択」で元に戻せます。'}));
}
