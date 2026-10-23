# PROJECT MIRROR｜生成画像ワンコマンド受入・隔離 v1（非Canon／試験）

作画AIから返った画像を受け取るとき、再生成の前後で手動チェックを忘れないようにする。**作画AIを動かす機能ではない**。外部送信や追加課金は行わない。

## 実行方法
1. 外部AI生成コマの画像を、PNG RGB/RGBAとしてローカルに保存（原本は読み取り専用）。
2. 入力契約 job.json に、SOURCE LOCKのJSON絶対パス、計画plan、承認済みMASTER原本ファイルのパス、登録済みSHA-256および承認記録、試行履歴、パネルID、生成指示、期待形状を指定する。
3. コマンドを実行:
   ```bash
   node labs/comic-workbench/image-handoff-cli.cjs /absolute/job.json /absolute/candidate.png /absolute/qa-result.json
   ```
4. QA結果:
   - QUARANTINED：ソース/Master/承認済み保護/再試行証拠/PNG構造などの不合格。**終了コード2**。生成キューへ戻す（自動再生成はしない）。
   - REVIEW_REQUIRED：少なくとも明らかな2×3構造を検出しない。**終了コード0だが完成品ではない**。
5. 元画像とMASTERは変更しない。レポート既存名は上書きせず終了コード2にする。

### job.jsonの例（実MASTERのファイル名やハッシュを偽装して使用しない）
```json
{
  "sourceLockFile": "/secure/chapter4-p10-source.json",
  "masterFiles": {
    "K": "/secure/approved-kenta-original.jpg",
    "M": "/secure/approved-mina-original.png"
  },
  "approvedRegistry": {
    "K": {"sha256": "<REAL_ORIGINAL_FILE_SHA256>", "confirmedByUser": true},
    "M": {"sha256": "<REAL_ORIGINAL_FILE_SHA256>", "confirmedByUser": true}
  },
  "plan": {
    "pageId": "CH04_P10",
    "sourceLockSha256": "<REAL_SOURCE_JSON_SHA256>",
    "requiredCharacterIds": ["K", "M"],
    "storyboard": []
  },
  "panelId": 6,
  "prompt": "正式プロンプト",
  "expectedOutput": "single_panel",
  "approvedAssets": [],
  "history": []
}
```
実際のstoryboardは6コマの構図と演出、元原稿の各コマ・位置と一致していなければBLOCKEDになる。登録内容がユーザー承認済みであることの最終確認は別途必要。

## 技術的な保護
- source JSONバイトのSHA-256と、承認済みMASTERの実バイトSHA-256を再計算して比較。
- 既存retry-controllerで承認済みコマ、重複入力、原因不明、上限超過を拒否。既存page-gateで原稿、画角、感情の構造化必須要件を検査。
- 実画像のCRC/ピクセルをPython検査し、2×3の白/黒/灰白の仕切りを認識。6コマ全体を1コマとして誤受入した場合QUARANTINED。
- 画像が単独コマとして明らかに失敗していなくても**人物・セリフ・画質の目視検査が終わるまで未完成**。出力形式検査が正しいことだけを検査する。
- 組み上がった**ページ**にだけ2048×3072pxのページ解像度QAを適用。単独コマにはこのページ閾値を誤適用しない。最終画素のネイティブな詳細も別途評価。
- 候補画像・MASTER・原稿はrepoへコミットせず、一時ファイルは削除する。JSONレポートは新規作成のみ、原画像の上書き禁止。
- PNG形式に限定。JPEGなどは検査専用PNGに変換してから使用し、原本のSHAと変換コピーのSHAを混同しない。

## 未実装・リスク
- 現在は **post-generation ingestion**。有料画像生成APIを起動するprovider adapterは未接続。ユーザーの明示した予算・入力画像の外部送信許可がない状態で外部APIを使わない。
- 2×3の明確な仕切り検出は限定的で、コマ番号・全セリフ・顔一致・吹き出し尻尾の自動認定にはならない。複雑な分割、JPEG劣化、余白のないコマ割りは見逃す可能性がある。
- 登録済みSHAとフラグはローカルの自己申告資料であり、Canon Authorityの真正性をそれだけで認定できない。MASTERは読み取り専用で扱う。
- パネル単位の原画解像度基準、本人同一性の客観計測、実Android端末による評価、完成ページへの自動貼付、実画像出力の無人生成は未完成。
- この試験コードはDraft PR #9のみ。main、公開PWA、Cloudflare、正式Canon/MASTERには変更しない。

## テスト
```bash
node --test labs/comic-workbench/image-handoff.test.cjs
```
CIのComic Workbench QA + Offline Package (no deploy)でも実行される。実作品画像を公共GitHub CIへアップロードしない。
