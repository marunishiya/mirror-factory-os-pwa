# Generation Submission Gate v1 — 第4章P06再発防止（非Canon）

既存 `page-gate.cjs` の `validatePlan` を呼び、その後 **最終送信指示** を追加検査する試験用アダプターゲート。既存FACTORY OS・正式Canon・MASTER・main・公開環境には変更なし。

## 停止するもの
- ページID/SOURCE LOCK SHA/右上→左下のコマ番号不一致
- 承認済み指示のSHA256不一致、必須場面の語句欠落、別ページ由来の禁止語混入
- 1枚の文字なし原画以外の生成方式、同じコマの3回目以降の生成
- **実際の送信リクエストに入る指示本文が取得できない経路**、または承認済み本文との差異
- 既存 `page-gate.cjs` のMASTER参照証拠・脚本・演出ゲート不合格

## 呼び出し例

```js
const {validateGenerationSubmission,digest}=require('./generation-submission-gate.cjs');
// lock: existing SOURCE LOCK; plan: existing validated storyboard and MASTER reference evidence
// promptLock: pageId/sourceLockSha256/panel/position/outputMode:
//   'single-text-free-illustration'/approvedPrompt/approvedPromptSha256/
//   requiredPhrases/forbiddenPhrases/attemptNumber
// transport: exactPromptSupported:true, effectivePromptSource:'actual_outbound_request',
//   effectivePrompt: realRequest.prompt
const result=validateGenerationSubmission({intent:'generate',plan,lock,promptLock,transport});
if (result.status!=='REVIEW_REQUIRED') throw new Error(JSON.stringify(result.issues));
// Only here may a trusted provider adapter send THAT SAME outbound request.
// A successful preflight is never a visual QA / Canon / publish PASS.
```

**Important limitations:** `transport` is supplied by the calling adapter; this library cannot independently prove that its source is truthful. To enforce, the adapter must build `transport` directly from the final outbound request and send exactly that request, without further prompt rewriting. Current ChatGPT image generation is not controlled by this module. **Without such a verified adapter, keep actual automated image generation HOLD.** Presence/absence keyword checks are lexical, not semantic. Images/Masters/unpublished scripts must not be committed to GitHub.

## Tests and safety

`node --test labs/comic-workbench/page-gate.test.cjs labs/comic-workbench/generation-submission-gate.test.cjs`

The PR workflow already runs the entire `labs/comic-workbench/*.test.cjs` suite. Fixtures use fictional characters. This is a test branch only; no automatic merge or deployment.
