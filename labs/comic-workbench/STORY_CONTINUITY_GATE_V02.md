# STORY CONTINUITY GATE v0.2 — 非Canon・試験

既存PR #8の `page-gate.cjs`（画像生成前の形式証拠）に**物語台帳の検査**を加える実験です。PWA・本番・画像生成ツール・正式Canon・MASTERには接続しません。

## 収録
- `story-continuity-gate.cjs`：時系列／既知情報／自己紹介／場所移動／小道具／因果／6・8コマの右→左読書順／年代・年齢を、**事前に構造化して記録した脚本**上で検査。
- `story-page-preflight.cjs`：`validateStoryContinuity`＋既存`validatePlan`を組み合わせ、SOURCE LOCK SHA と対象ページも一致しない限り`BLOCKED`。問題がなくても`REVIEW_REQUIRED`。
- `story-continuity-gate.test.cjs`：架空人物・架空設定だけの回帰テスト。

## 実行
```bash
node --test labs/comic-workbench/story-continuity-gate.test.cjs
node --test labs/comic-workbench/*.test.cjs
```

## 利用例
```js
const {validateStoryAndPagePlan} = require('./story-page-preflight.cjs');
const verdict = validateStoryAndPagePlan({storyBook, intent:'generate', plan, lock});
if(verdict.status==='BLOCKED') throw new Error(JSON.stringify(verdict.issues));
// REVIEW_REQUIREDでも実画像・尻尾・顔・時系列の編集確認は別途必要
```

`storyBook`は以下を含む必要があります：
- `sourceLockSha256`：既存`lock.sha256`と同値。呼出元が実データから算出・照合する責任を持つ。
- `characters`：固定ID、姓、基準年齢。
- `initialKnowledge`・`initialLocations`・`initialEvents`・`initialObjects`・`objectCanon`・`approvedHistoryIds`。
- `pages: [{id:'CH03-P03',panels:[...]}]`：各コマに番号、段、列、時刻、場所、登場人物、台詞と話者ID、情報取得、移動根拠、小道具状態、事件と先行イベント。
- **各行の位置**：1=右上、2=左上、3=右2段、4=左2段……（6コマ/8コマ）。英語圏の左読み番号は採用しない。

## 防げること／防げないこと
- `KNOWLEDGE_LEAK`：名前の取得記録より前に姓が台詞に出る。
- `UNEXPLAINED_ARRIVAL`：新しい場所への移動の説明が記録されていない。
- `UNAPPROVED_HISTORY`、`AGE_CONFLICT`：未承認年代や年齢の大きな矛盾。
- `OBJECT_COLOR_DRIFT`、`UNEXPLAINED_OBJECT_CHANGE`：赤いリードが青に変わる／抜ける原因なし。
- `MISSING_CAUSE`：音響チェックより前に犬の脱走が起きたというイベント依存の欠落。
- `READING_ORDER`：コマ順が右→左でない。
- **制限**：文章に記載された「情報源」や「原因」が本当に描かれているかは判定できない。省略された場面・暗示された知識・自由文の意味理解には人の編集確認が必要。吹き出し尻尾の**実際の向き**、本人の顔、セリフの画像内表記、画質、感動・面白さを自動認定しない。台帳への虚偽申告は防げない。
- 名字の検出は単純文字列一致。偽陽性を人が確認し、同じ失敗例をテストに追加する。
- `REVIEW_REQUIRED`は**完成判定ではない**。

## 運用
脚本（SOURCE LOCK）→物語整合性検査→既存PAGE GATE→画像生成の接続部分（今は未実装）→画像から独立転記と視覚レビュー→ユーザー承認、の順で実行。検査違反はページID・コマID・不一致コードを保存して再発防止テスト化する。

**安全**：全ファイルは架空のテストデータだけ。承認済みの正式人物画像・原稿をGitHubに追加しない。main・正式Canon・MASTER・公開PWA・Cloudflare・マージ・デプロイを変更しない。
