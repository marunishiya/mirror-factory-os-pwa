# Comic Workbench v0.1 — 試験導入（非Canon）

これは **marunishiya/mirror-factory-os-pwa の既存アプリから分離した試験用サブアプリ** です。
`main`、既存の`index.html`、サービスワーカー、ローカルストレージ、
正式CHARACTER MASTER、MIRROR SOCIAL ENGINE、Cloudflare環境には変更を加えません。

## 操作

- `labs/comic-workbench/index.html` をブラウザで開き、MIRRORデモ／卑弥呼デモから開始します。
- デモは**実際のCanon・制作済み画像を含まないテストデータ**です。
- 対象コマを選び、人物ID・セリフ（`話者ID | 相手ID | 台詞`）・必要な小道具・確認済みの手掛かりを編集し「このコマだけ保存」。
- 「QA再実行」で、データ上の不足・セリフ話者不一致・伏線早期露出・考証出典未設定を確認。
- 画像を見て目視確認した後に、完成画像の参照IDと4つの人間によるチェックを記録できます。
- ERRORがない場合だけ「検査済みとして承認・ロック」。承認したコマは改変せず、必要なら別IDの草稿を作ります。
- JSON保存／読込でデータを管理します。データは自動保存しません。別フォルダの正式MASTERは更新しません。

### 実行

静的ファイルのみで動作します。ブラウザが`file://`上のスクリプト読込を許可する場合、`index.html`を直接開けます。
GitHub Pages等の静的ホスティングにも対応していますが、**このブランチからの自動公開・自動デプロイは構成していません**。

テスト: `node --test labs/comic-workbench/engine.test.cjs`

## 今回の実装範囲

| テーマ | 実装 | 制約 |
| --- | --- | --- |
| AI Comic Generator（②） | JSONによるページ・コマ・人物定義 | ストーリー自動分解、AI画像生成は未実装 |
| StoryDiffusion（③） | 参照MASTERの記録と同一人物性の**目視チェック**項目 | モデル・GPU推論・自動顔照合は未接続 |
| ComicCrafter（④） | コマ単位の変更・差分監査・直前の編集取り消し | 外部画像の自動再描画は未接続 |
| comic-maker（⑤） | JSON出力と作画用プロンプト作成 | CBZ/PDF合成は将来検証 |
| ComicStudio（⑥） | 台詞、キャスト、小道具、証拠、考証の決定論的QA | Vision LLMによる画像検査は未接続 |
| AI Comic Factory（①） | 構想・UX参考のみ | 本体はアーカイブ済み |
| MangaNinja（⑦） | 統合せず保留 | 非商用ライセンスに注意 |

**外部GitHubリポジトリのコード・モデル・画像・フォントは一切コピーしていません。**
設計上の着想のみで独立実装しています。追加APIキー・課金・外部画像転送はありません。

### 作品別の安全ガード

- PROJECT MIRROR：`requiredClues` ／`visibleClues`／`hiddenClues`で伏線提示時期の形式的チェック。キャストと吹き出しは登録データに基づきチェック。人物画像の真偽を判定したとは**主張しません**。
- 卑弥呼の声：考証を`primary_source`（原典）、`archaeology`（考古学）、`reconstruction`（復元仮説）、`fiction`（ゲーム創作）の4区分に登録。出典が空ならWARNING。**研究資料の実物照合は未実施**。
- `canon.reference` は参照ラベルであり、正式MASTERの内容そのものではありません。既存ユーザー承認済みMASTERを勝手に補完・更新しません。
- 「承認」はこの試験ワークフロー内のコマロックです。**正式Canonの変更承認を意味しません**。

## セキュリティ・データ保持

- 静的アプリ・API呼び出しなし。`localStorage`、IndexedDB、Cookieには一切触れません。
- JSONを最大1MBに制限して読み込み、スキーマを検証。文字情報の描画は`textContent`で実施し、ユーザー入力をHTMLとして実行しません。
- 画像そのものは管理・添付されません。`assetRef`は記録用の文字列です。
- ページはブラウザ更新で未出力内容が消えるため、作業後にJSONファイルへ保存してください。
- 人による目視チェックの記録は自己申告。視覚QA・同一人物性の客観検査ではありません。
- 一度承認したコマは変更不可。変更したい場合は新しい下書きを作成し、旧コマを保持します。
- 各コマの差分監査ログは最新500件まで。過剰に溜まる前にJSONを書き出してください。

## 次の段階（**未実装**）

1. 既存FACTORY OSの正式MASTERから、ユーザーが承認した項目だけを**読み取り専用インポート**。
2. 画像のバージョン付き保存・ハッシュ検査・比較（可能なら顔・衣装一貫性の品質ベンチ）。
3. セリフと吹き出しの実画像QA、改変箇所のピクセル差分と局所再描画。無料方式とのコスト比較。
4. ユーザー承認後に既存の制作パイプラインへ段階統合。mainマージや本番デプロイは別途承認が必要。

## 参考技術（設計調査）

- https://github.com/jbilcke-hf/ai-comic-factory
- https://github.com/Dapeng960208/AI-Comic-Generator
- https://github.com/HVision-NKU/StoryDiffusion
- https://github.com/Balajee2k/AI-Comic-Crafter
- https://github.com/AskAillex/comic-maker
- https://github.com/CallmeTruong/Comic_Studio
- https://github.com/ali-vilab/MangaNinjia

これらのソフトウェアを**インストール済み**とは扱いません。商用利用許諾、生成モデルの規約、GPU・API費用、品質評価が済むまで、本体への組み込みは保留します。
