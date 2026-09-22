/* ==========================================================================
   refresh.js — データ更新バー
   ・いま表示しているデータの鮮度を出す
   ・「表示を最新にする」で再読み込み
   ・「公式データを取り込む」で GitHub Actions の実行ページを開き、
     新しいデータが commit されたら自動でページを更新する

   公式APIはブラウザから直接叩けない（CORS拒否）ため、取得そのものは
   GitHub Actions（GitHubのサーバー）に任せる。ここはその起動と待機を担う。
   ========================================================================== */
import {el, q} from './core.js';

const WORKFLOW = 'update-data.yml';
const POLL_MS = 20000;         // 20秒ごとに確認
const POLL_LIMIT = 30;         // 最大10分

/* github.io のURLから owner/repo を推測する（ローカルでは null） */
export function detectRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const seg = location.pathname.split('/').filter(Boolean);
  if (!seg.length) return null;
  return {owner: m[1], repo: seg[0]};
}

const api = (r, p) => `https://api.github.com/repos/${r.owner}/${r.repo}${p}`;

async function latestCommit(r) {
  const res = await fetch(api(r, '/commits?per_page=1'), {cache: 'no-store'});
  if (!res.ok) return null;
  const j = await res.json();
  if (!Array.isArray(j) || !j.length) return null;
  return {sha: j[0].sha, date: j[0].commit.author.date, msg: j[0].commit.message.split('\n')[0]};
}

function ago(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間${m % 60}分前`;
  return `${Math.floor(h / 24)}日前`;
}

export function refreshBar(tournament) {
  const repo = detectRepo();
  const bar = el('div', {class: 'refresh-bar'});
  const status = el('span', {class: 'refresh-status'});
  const setStatus = (text, tone = '') => {
    status.textContent = text;
    status.className = 'refresh-status' + (tone ? ' ' + tone : '');
  };
  setStatus(tournament?.updatedAt
    ? `データ取得: ${ago(tournament.updatedAt)}`
    : 'データ取得時刻: 不明');

  const reloadBtn = el('button', {
    class: 'btn ghost sm', text: '表示を最新にする',
    onclick: () => { setStatus('読み込み中…'); location.reload(); },
  });

  bar.append(el('span', {class: 'refresh-title', text: 'データ'}), status, reloadBtn);

  if (!repo) {
    bar.append(el('span', {class: 'refresh-note', text: 'ローカル表示中（公式取り込みはGitHub上でのみ動作します）'}));
    return bar;
  }

  let polling = false;
  const fetchBtn = el('button', {class: 'btn sm', text: '公式データを取り込む'});
  const cancelBtn = el('button', {class: 'btn ghost sm', text: '待機をやめる', style: {display: 'none'}});
  bar.append(fetchBtn, cancelBtn);

  let timer = null, tries = 0, baseSha = null;

  const stop = (msg, tone) => {
    polling = false;
    clearTimeout(timer);
    fetchBtn.disabled = false;
    fetchBtn.textContent = '公式データを取り込む';
    cancelBtn.style.display = 'none';
    if (msg) setStatus(msg, tone);
  };

  const poll = async () => {
    if (!polling) return;
    tries++;
    const c = await latestCommit(repo).catch(() => null);
    if (c && baseSha && c.sha !== baseSha) {
      setStatus('新しいデータを取得しました。表示を更新します…', 'ok');
      setTimeout(() => location.reload(), 900);
      return;
    }
    if (tries >= POLL_LIMIT) {
      stop('時間内に更新を確認できませんでした。Actions の実行結果をご確認ください。', 'warn');
      return;
    }
    setStatus(`取り込みを待っています…（${Math.round(tries * POLL_MS / 60000 * 10) / 10}分経過）`, 'busy');
    timer = setTimeout(poll, POLL_MS);
  };

  fetchBtn.onclick = async () => {
    const c = await latestCommit(repo).catch(() => null);
    baseSha = c?.sha || null;
    window.open(`https://github.com/${repo.owner}/${repo.repo}/actions/workflows/${WORKFLOW}`, '_blank', 'noopener');
    polling = true; tries = 0;
    fetchBtn.disabled = true;
    fetchBtn.textContent = '取り込み中…';
    cancelBtn.style.display = '';
    setStatus('別タブで「Run workflow」を押してください。完了したらこの画面が自動で更新されます。', 'busy');
    timer = setTimeout(poll, POLL_MS);
  };
  cancelBtn.onclick = () => stop('待機をやめました。', '');

  /* 読み込み時に一度だけ、より新しいデータが出ていないか確認する */
  (async () => {
    if (!tournament?.updatedAt) return;
    const c = await latestCommit(repo).catch(() => null);
    if (!c) return;
    const newer = new Date(c.date).getTime() - new Date(tournament.updatedAt).getTime();
    if (newer > 3 * 60 * 1000 && /データ更新/.test(c.msg)) {
      setStatus(`より新しいデータがあります（${ago(c.date)}の更新）`, 'warn');
      reloadBtn.classList.remove('ghost');
    }
  })();

  return bar;
}
