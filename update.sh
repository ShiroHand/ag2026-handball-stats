#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# 手元から即座にデータを更新して公開するスクリプト。
# GitHub Actions の定時実行を待てないとき（試合直後など）に使う。
#
#   ./update.sh
#
# pdftotext（7対6のPDF解析に使用）が無い場合はその部分だけスキップする。
#   macOS: brew install poppler
# ----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ 最新のリモートを取り込みます"
git pull --rebase --quiet

echo "▶ 公式APIから取得します"
node scripts/fetch-data.mjs

if command -v pdftotext >/dev/null 2>&1; then
  echo "▶ 公式PDFレポート（7対6など）を取り込みます"
  node scripts/fetch-reports.mjs || true
else
  echo "… pdftotext が無いので7対6のPDF取り込みはスキップします（brew install poppler で導入できます）"
fi

echo "▶ 国旗画像を確認します"
node scripts/fetch-flags.mjs || true

echo "▶ 選手の顔写真を確認します"
node scripts/fetch-photos.mjs || true

if git diff --quiet -- data assets/flags assets/photos; then
  echo "✔ 変更はありませんでした（すでに最新です）"
  exit 0
fi

git add data assets/flags assets/photos
git commit --quiet -m "データ更新: $(date '+%Y-%m-%d %H:%M JST')"
git push --quiet
echo "✔ 更新して公開しました。1〜2分でサイトに反映されます。"
echo "   https://shirohand.github.io/ag2026-handball-stats/"
