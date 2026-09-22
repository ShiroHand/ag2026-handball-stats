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
| `match.html` | 試合レポート — 両チーム比較、攻撃内訳、シュートマップ（コート／ゴールマウス）、GK別セーブマップ、選手スタッツ |
| `team.html` | チーム分析（攻撃）— 全試合を累積したスカウティングレポート、試合別推移、選手累計 |
| `defense.html` | 守備分析 — 対戦相手の攻撃データを合計した被シュートマップ、失点コース、相手別守備成績、大会内守備ランキング |
| `entry.html` | データ入力 — 戦術・システムなど公式データにない情報の手入力、手入力試合の作成 |

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

`.github/workflows/update-data.yml` が **10分ごと**に公式APIを取得し、
差分があれば `data/` を更新してコミットします。手動実行は
**Actions → 公式データ自動更新 → Run workflow** から。

> 大会が終わったら `cron` の行をコメントアウトするか、ワークフローを無効化してください。

---

## データを手元で更新する

Node.js 18 以上が必要です（依存パッケージなし）。

```bash
node scripts/fetch-data.mjs              # 全日程を更新
node scripts/fetch-data.mjs --day 2026-09-25   # 指定日のみ
node scripts/fetch-data.mjs --force      # 差分がなくても書き出す
node scripts/fetch-flags.mjs             # 国旗画像を取得（不足分のみ）
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

`entry.html` の入力画面から JSON をダウンロードして `data/manual/` に置き、commit してください。

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
