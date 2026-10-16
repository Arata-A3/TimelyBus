# 時刻データの更新手順（ダイヤ改正時）

「バスを調べる」で使う時刻データは、鳴門線の時刻表PDF（平日・土日祝）から `extract-timetable.js` で取り出して `index.html` に埋め込んでいます。

## 必要なもの

- Node.js 18 以上
- poppler の `pdftotext`（`-bbox` が使えるもの）
  - Windows: TeX Live に入っているもの（例 `D:\texlive\2024\bin\windows\pdftotext.exe`）や、[poppler for Windows](https://github.com/oschwartz10612/poppler-windows/releases) が使えます。
  - Git Bash 付属の `pdftotext`（xpdf 版）は `-bbox` が使えないので不可。

## 手順

1. 新しいPDFで `pdf/a1_naruto_weekday.pdf`（平日）と `pdf/a2_naruto_weekend.pdf`（土日祝）を上書きする。
2. スクリプトを実行する。

   ```sh
   # pdftotext が PATH にあれば
   node tools/extract-timetable.js

   # 場所を指定する場合（Git Bash の例）
   PDFTOTEXT=/d/texlive/2024/bin/windows/pdftotext node tools/extract-timetable.js
   ```

   ```powershell
   # PowerShell の例
   $env:PDFTOTEXT = 'D:\texlive\2024\bin\windows\pdftotext.exe'; node tools/extract-timetable.js
   ```

3. `git diff index.html` で変更内容を確認し、何本かの便をPDFと見比べる。
4. `index.html` の改正日の表記（`令和8年4月1日改正` で検索）、`README.md` のデータの説明、`APP_VERSION` を更新する。
5. `sw.js` の `CACHE_VERSION` は `APP_VERSION` から自動で決まるので、`APP_VERSION` を上げれば利用者の端末の保存データも入れ替わる。

## エラーが出たとき

スクリプトは、列の数や時刻の並びがおかしいときは `index.html` を書き換えずに止まります。

- **「時刻の列が N 列見つかりました」**: 表のレイアウト（停留所の数や並び）が変わっています。`index.html` の `STOPS` とスクリプトの `STOP_COUNT` を新しい表に合わせてください。
- **「どの列か判定できません」「時刻の並びがおかしい」**: 一部の時刻の位置がずれています。表示された行をPDFで確認してください。
- 停留所名はPDFから自動では読み取っていません。停留所が変わったら `STOPS` を手で直してください。
