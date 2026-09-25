# アジア大会2026 ハンドボール スタッツダッシュボード

第20回アジア競技大会 愛知・名古屋 2026（ハンドボール）の試合データを
**公式リザルトシステムから自動取得**し、handball.ai のレポートに近い形で可視化する静的サイトです。

- ビルド不要（素の HTML / CSS / ES Modules、外部ライブラリなし）
- データは `data/` 配下の JSON。GitHub Actions が定期的に上書き更新します
- GitHub Pages でそのまま公開できます

---

## 画面

| ページ | 内容 |
|---|---|
| `index.html` | 大会トップ — 日程・結果、グループ順位表、得点/セーブランキング、チーム一覧 |
| `match.html` | 試合レポート — KPI、両チーム比較、攻撃内訳、シュートマップ（コート／ゴールマウス）、GK別セーブマップ、5分ごとの推移、選手別イベント（記号タイムライン）、選手スタッツ |
| `team.html` | チーム分析（攻撃）— 全試合を累積したスカウティングレポート、試合別推移、選手累計 |
| `defense.html` | 守備分析 — 対戦相手の攻撃データを合計した被シュートマップ、失点コース、相手の連携図、相手別守備成績、大会内守備ランキング |
| `situations.html` | 局面分析 — 攻撃回数・攻撃効率・リバウンド、数的状況別（均等/優位/不利）、無人ゴール、大会内効率ランキング |

---

## セットアップ

### 1. GitHub にリポジトリを作る

```bash
git init
git add .
git commit -m "初期コミット: ハンドボールダッシュボード"
git branch -M main
git remote add origin git@github.com:<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

### 2. GitHub Pages を有効にする

リポジトリの **Settings → Pages → Build and deployment**
- Source: `Deploy from a branch`
- Branch: `main` / `/ (root)`

数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。

### 3. 自動更新を有効にする

**Settings → Actions → General → Workflow permissions** で
`Read and write permissions` を選択して保存してください（Actions がデータ更新をコミットするため）。

`.github/workflows/update-data.yml` が定期的に公式APIを取得し、
差分があれば `data/` を更新してコミットします。手動実行は
**Actions → 公式データ自動更新 → Run workflow** から。

### 画面上の「公式データを取り込む」ボタン

全ページのヘッダに更新バーがあります。

| 表示・ボタン | 動作 |
|---|---|
| `データ取得: ○分前` | いま表示しているデータが取得された時刻 |
| **表示を最新にする** | ページを再読み込みして、最新のコミット済みデータを表示 |
| **公式データを取り込む** | GitHub Actions の実行ページを別タブで開く。そこで `Run workflow` を押すと公式から取得が始まり、**完了を検知して元の画面が自動で更新される** |

ブラウザから公式APIを直接叩くことは CORS で拒否されるため、取得そのものは
GitHub のサーバー（Actions）が行います。ボタンはその起動と完了待ちを担当します。
GitHub API（公開リポジトリの参照）は認証不要で 60回/時 まで使えます。

より新しいデータが公開されている場合は、ページを開いた時点で
「より新しいデータがあります」と表示されます。

### 定時実行が動かないときは

GitHub の定時実行（cron）は**保証されていません**。特に `*/5` `*/10` のような
短い間隔は混雑時に丸ごと落とされ、一度も発火しないことがあります。
本リポジトリでは対策として、

- 半端な分にずらした15分おき（`4,19,34,49 1-17 * * *`）
- 毎時1回の保険（`52 * * * *`）

の2本立てにしています。それでも遅れる／動かない場合は、手元から実行してください。

```bash
./update.sh
```

`git pull` → 公式API取得 → PDF取り込み → 差分があればコミットして push まで一気に行います。
試合直後にすぐ反映させたいときはこちらが確実です。

> 大会が終わったら `cron` の行をコメントアウトするか、ワークフローを無効化してください。

---

## データを手元で更新する

Node.js 18 以上が必要です（依存パッケージなし）。

```bash
node scripts/fetch-data.mjs              # 全日程を更新
node scripts/fetch-data.mjs --day 2026-09-25   # 指定日のみ
node scripts/fetch-data.mjs --force      # 差分がなくても書き出す
node scripts/fetch-flags.mjs             # 国旗画像を取得（不足分のみ）
node scripts/fetch-reports.mjs           # 公式PDFレポート（7対6など）を取り込み
node scripts/fetch-photos.mjs            # 選手の顔写真を取得（不足分のみ）
node scripts/fetch-photos.mjs --all      # 出場していない選手も含めて取得
```

`fetch-reports.mjs` は PDF のテキスト化に `pdftotext`（poppler-utils）を使います。

```bash
brew install poppler          # macOS
sudo apt install poppler-utils # Ubuntu
```

ローカルで表示を確認するときは、`file://` ではなく簡易サーバ経由で開いてください。

```bash
python3 -m http.server 8000
# → http://localhost:8000/
```

---

## データ構造

```
data/
├── tournament.json          大会情報・日程・結果・順位表・チーム一覧（自動生成）
├── matches/<試合ID>.json     試合ごとの詳細スタッツ（自動生成）
└── manual/<試合ID>.json      手入力の戦術データ（自動更新で上書きされません）
```

試合ID は公式のユニットキーから生成されます（例: `M-GPB-000400` = 男子・予選グループB・第4試合）。
男子は `M-`、女子は `W-` で始まるため、全ページで男女を切り替えて表示できます。

### 守備データの考え方

守備専用のデータは公式APIに存在しないため、**対戦相手の攻撃データを合計**して守備指標を算出しています。

| 守備指標 | 算出元 |
|---|---|
| 被シュート位置マップ | 相手チームの位置別シュート（`teams.<相手>.shot`）の合計 |
| 失点コース（ゴールマウス） | 相手チームの `shotZone`（= 自GKが受けたコース）の合計 |
| GKセーブコース | 自チームの `gkZone` の合計 |
| 被決定率 | 相手の `GOALS` / `SHOTS` |
| 被速攻G・被BT G | 相手の `FB_GOALS` / `BT_GOALS` |

### `matches/*.json` の主な中身

| キー | 内容 |
|---|---|
| `teams.<略称>.stats` | チーム集計（`GOALS` / `SHOTS` / `EFFICIENCY` / `GK_SAVES` など） |
| `teams.<略称>.shot` | 位置別シュート `{LW,L6,C6,R6,RW,L9,C9,R9,P7,EG,BT,FB,FLY}` → `{g, s}` |
| `teams.<略称>.shotZone` | ゴールマウス 3×3（上→下 × 左→中→右）→ `{g, s}` |
| `teams.<略称>.gk` | GKの位置別被シュート → `{sv, s, g}` |
| `teams.<略称>.gkZone` | GKのコース別セーブ 3×3 → `{sv, s, g}` |
| `teams.<略称>.players[]` | 選手ごとの同じ構造 + `stats`（545項目から抽出） |
| `teams.<略称>.connections[]` | アシスト連携 `{fromBib, fromName, fromRole, toBib, toName, toRole, count, goals, zones}` |
| `teams.<略称>.posLinks[]` | ポジション間の連携 `{from, to, count, goals}`（LW/LB/CB/RB/RW/PV/GK） |
| `teams.<略称>.shots[]` | 1本ごとのシュート `{min, period, bib, name, role, zone, result, goalZone, assistBib, score}` |
| `teams.<略称>.defActs[]` | 守備アクション `{bib, name, blocks, steals, sevenMConceded, twoMin}` |
| `teams.<略称>.possessions` | `{attacks, goals, shots, missed, saves, turnovers, offReb, defReb, eff}` |
| `teams.<略称>.timeline[]` | 5分区切りの集計 `{bucket, attacks, goals, shots, missed, saves, turnovers, ...}` |
| `teams.<略称>.situations` / `situationsDef` | 数的状況別（`equal` / `up` / `down`）の攻撃時・守備時 |
| `teams.<略称>.emptyGoal` | 無人ゴールへのシュート `{shotsFor, goalsFor, shotsAgainst, goalsAgainst}` |

### プレーバイプレーから導出している指標

公式APIの `/{disc}/actions/Total/{ユニットキー}` に入っている
1プレーごとの記録から、以下を計算しています。

| 指標 | 導出方法 | 精度 |
|---|---|---|
| アシスト連携（誰→誰） | `ASS` アクションを、同じチームの次のシュートに結び付ける | 公式のアシスト総数と一致（277本中276本） |
| 攻撃回数 / 守備回数 | `ATTACK` アクションの数 | 公式記録そのもの |
| 攻撃効率 | 得点 ÷ 攻撃回数 | 計算値 |
| オフェンスリバウンド | 同一攻撃内で、セーブ／ポスト／ブロックの後に同じチームが撃った再シュート | **推定** |
| ディフェンスリバウンド | 相手の攻撃がセーブ／ポスト／ブロックで終わった回数 | **推定** |
| 数的優位 / 不利 | `TMS`（2分間退場）の記録時刻から±2分の区間を復元し、攻撃開始時点の人数差で分類 | 退場時刻は公式記録、区間は計算 |
| 5分ごとの推移 | 各アクションのタイムスタンプを5分で区切って集計 | 公式記録そのもの |

### 7対6（エンプティーゴール）

APIには7対6の攻撃回数が入っていませんが、**公式PDFレポート「Empty Goal Analysis」(C77)**
に完全な集計があります。`scripts/fetch-reports.mjs` がこれを取り込み、
`data/reports/<試合ID>.json` に保存します。

| 取り込む内容 | 中身 |
|---|---|
| `emptyGoal.situations` | 7対6 / 6対6 / その他ごとの 攻撃回数・得点・セーブ・ミス・ブロック・ポスト・ターンオーバー・成功率・被無人ゴール |
| `emptyGoal.timeline` | 上記の5分ごとの発生（得点/攻撃） |
| `emptyGoal.duration` | 攻撃時間別（<15秒 〜 >60秒）の 得点/攻撃 |
| `emptyGoal.substitutions` | GK↔コートプレーヤーの交代回数（7人攻撃への切替回数） |
| `teamStats` | 公式の Number of Attacks と Scoring Efficiency（C83） |

公式の攻撃回数とプレーバイプレー由来の攻撃回数は一致することを確認済みです
（KOR-KUW戦: 公式46/47 対 導出46/47）。

### Equality / Superiority / Inferiority

公式PDFには含まれていない指標です（handball.ai のレポート独自）。
本ダッシュボードでは `TMS`（2分間退場）の記録時刻から前後2分の区間を復元し、
各攻撃の開始時点の人数差で分類して同等の表を作っています。

### 手入力データ `manual/*.json`

```json
{
  "id": "M-GPB-000400",
  "note": "全体メモ",
  "teams": [
    {
      "code": "KOR",
      "comment": "チームへのコメント",
      "systems": [
        {"name": "ATTACK 03 - PASIVE", "times": 13, "goals": 4, "saves": 3,
         "postOut": 0, "sevenM": 1, "lost": 0}
      ]
    }
  ]
}
```

このファイルを手で作って `data/manual/` に置き、commit すると試合レポートに追加表示されます。

---

## 取得元について

公式リザルトの内部API（`https://back.results.asiangames2026.org/s/AG2026/en/...`）を利用しています。
レスポンスは zlib deflate ストリームが latin1→utf8 で再エンコードされた形で返るため、
`scripts/fetch-data.mjs` 内でバイト列に戻してから展開しています。

主なエンドポイント:

| パス | 内容 |
|---|---|
| `/HBL/disc/data` | 競技情報・開催日・種目 |
| `/HBL/schedule/daily/<日付>` | 日別の試合一覧（エントリー含む） |
| `/HBL/results/<ユニットキー>` | 試合結果・チーム/選手スタッツ |
| `/HBL/groups/<種目キー>` | グループ順位表 |
| `/HBL/brackets/<種目キー>` | 決勝トーナメント表 |

API 仕様が変わった場合は `scripts/fetch-data.mjs` の該当箇所を調整してください。

---

## 選手別イベント（記号タイムライン）

試合レポートの「選手別イベント」は handball.ai と同じ考え方で、
1行＝1選手、横軸＝試合の経過時間として出来事を記号で並べたものです。

| 記号 | 意味 | 元になる公式データ |
|---|---|---|
| ● 緑 | ゴール | シュートアクションの結果 GOAL |
| ⑦ 緑 | 7mゴール | PTY + GOAL |
| Ⓖ | GKのゴール | GK登録の選手のゴール |
| Ⓐ | アシスト | ASS アクション |
| Ⓧ | ノーゴール（セーブ・ポスト・枠外） | シュートアクションの結果 SAVE / POST / MISS |
| ⑦ 赤 | 7m失敗 | PTY + GOAL以外 |
| ● 黒 | ミス（ロストボール・テクニカル） | TO / TFT |
| Ⓢ 紫 | スティール | ST |
| Ⓑ | ブロック | BLC |
| Ⓟ | 7mを与えた | FRP |
| ② | 2分間退場（帯で2分間を表示） | TMS |
| Ⓢ 緑 / ● 赤 | GKセーブ / GK失点 | 相手のシュートアクションに付く GK 登録番号から復元 |

GKの登録番号は結果JSONの出場選手一覧には入っていないため、
「そのGKが浴びた失点数・セーブ数」を公式の個人スタッツと突き合わせて特定しています
（`gkRegMap()`）。突き合わせ結果は公式値と一致することを確認済みです。

## 選手の顔写真

公式の設定API（`/s/AG2026/en/config`）が返す `photoPath` 配下に
`<選手登録番号>.jpg` として置かれています。
`scripts/fetch-photos.mjs` がこれを `assets/photos/` に取り込み、
`data/entries.json`（エントリー名簿）で氏名 → 登録番号を引いて表示します。
写真が無い選手は頭文字のバッジで代替されます。

---

## KPI（試合レポート上部）

| 指標 | 計算 |
|---|---|
| 攻撃回数 | 公式PDF（C83）の Number of Attacks。無ければプレーバイプレーの `ATTACK` から算出 |
| 得点 | 公式 `GOALS` |
| ターンオーバー | プレーバイプレーの `TO` / `TFT` |
| 攻撃効率 | 得点 ÷ 攻撃回数 |
| ターンオーバー率 | ターンオーバー ÷ 攻撃回数 |
| シュート数 | 公式 `SHOTS` |
| 枠内シュート | プレーバイプレーの結果 GOAL + SAVE |
| 枠外・ポスト | 同 POST + MISS |
| アシスト | `ASS` アクション |
| アシスト率 | アシスト ÷ 得点 |

**枠内 + 枠外 + 被ブロック = 公式のシュート数** になる。
ブロックされたシュートはプレーバイプレーにシュートとして残らないため、
個人スタッツの `BLOCKED` を足して辻褄を合わせている（シュート数タイルの補足に内訳を表示）。

5分ごとの推移にも攻撃効率とアシスト率を入れている。割合は足し算できないので、
区間ごとに分子÷分母で出し、「計」の列だけは合計どうしの比で出している。
分母が0の区間は表では `–`、グラフでは線を切る。
攻撃回数は推定値なので、区間によっては得点が攻撃回数を上回り100%を超えることがある
（縦軸はその場合だけ50%刻みで上に伸ばす）。
