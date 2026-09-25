/* ==========================================================================
   boot.js — 読み込み失敗時の自動復旧

   サイトを更新した直後は、ブラウザのキャッシュに残った古いファイルと
   新しいファイルが混ざって、モジュールの読み込みに失敗することがある
   （画面が真っ白になる）。そのときは自動でキャッシュを取り直して開き直す。

   このファイル自体は各HTMLから直接読み込む。1回だけ再読み込みし、
   それでも駄目なら画面にメッセージを出す（無限ループを避ける）。
   ========================================================================== */
(function () {
  var KEY = 'hbl-cache-reload';
  var FILES = [
    'assets/js/core.js', 'assets/js/charts.js', 'assets/js/connections.js',
    'assets/js/eventgrid.js', 'assets/js/refresh.js', 'assets/js/kpi.js',
    'assets/js/stats.js', 'assets/js/matchfilter.js', 'assets/js/transitions.js',
    'assets/css/app.css',
  ];

  function message(text) {
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'notice';
    box.textContent = text;
    app.appendChild(box);
  }

  function recover() {
    if (sessionStorage.getItem(KEY)) {
      message('画面を読み込めませんでした。ブラウザの再読み込み'
        + '（Mac: ⌘+Shift+R / Windows: Ctrl+F5）をお試しください。');
      return;
    }
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* プライベートモード等 */ }
    message('更新を取り込んでいます…');
    var page = document.currentScript || null;
    var todo = FILES.slice();
    var entry = document.querySelector('script[type=module][src]');
    if (entry) todo.push(entry.getAttribute('src'));
    Promise.all(todo.map(function (f) {
      return fetch(f, {cache: 'reload'}).catch(function () {});
    })).then(function () { location.reload(); });
  }

  /* モジュールの解決・実行に失敗すると window にエラーが上がる */
  addEventListener('error', function (e) {
    var t = e && e.target;
    var isScript = t && t.tagName === 'SCRIPT';
    var msg = String((e && e.message) || '');
    if (isScript || /module|import|export|Unexpected/i.test(msg)) recover();
  }, true);

  /* 念のため: 一定時間たっても描画されていなければ同じ処理を走らせる */
  addEventListener('load', function () {
    setTimeout(function () {
      var app = document.getElementById('app');
      if (app && app.children.length === 0) recover();
    }, 4000);
  });

  /* ---- 古いキャッシュの自動検知 ----
     サイトを更新しても、ブラウザが保持している JS が期限内だとそのまま使われ、
     エラーも出ないまま「更新が反映されない」状態になる（新しいメニューが出ないなど）。

     同じファイルを「キャッシュを無視して」と「キャッシュ優先で」の2通りで取得し、
     中身が違えば手元が古いと判断して、取り直してから1回だけ開き直す。
     バージョン番号を人手で管理しなくてよいのが利点。 */
  addEventListener('load', function () {
    setTimeout(function () {
      if (sessionStorage.getItem(KEY)) return;        // すでに1回やり直している
      var probe = ['assets/js/core.js', 'assets/js/charts.js'];
      Promise.all(probe.map(function (f) {
        return Promise.all([
          fetch(f, {cache: 'no-store'}).then(function (r) { return r.ok ? r.text() : null; }),
          fetch(f, {cache: 'force-cache'}).then(function (r) { return r.ok ? r.text() : null; }),
        ]).then(function (pair) {
          return pair[0] !== null && pair[1] !== null && pair[0] !== pair[1];
        }).catch(function () { return false; });
      })).then(function (stale) {
        if (stale.some(Boolean)) recover();
      });
    }, 1500);
  });

  /* 正常に描画できたらフラグを消す */
  addEventListener('load', function () {
    setTimeout(function () {
      var app = document.getElementById('app');
      if (app && app.children.length > 0) {
        try { sessionStorage.removeItem(KEY); } catch (e) { /* noop */ }
      }
    }, 5000);
  });
})();
