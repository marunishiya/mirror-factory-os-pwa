# PROJECT MIRROR｜再生成の実証型改善ゲート v3（非Canon・試験導入）

失敗した画像を繰り返し生成する問題への対策。page-gate.cjs の validatePlan は、plan.previousFailedCandidate が真のとき assessRetry を必ず呼び、問題が残れば BLOCKED とする。

## 合格の意味
- SINGLE_TRIAL_ALLOWED は「次の1回の試験が許可可能」という意味だけ。完成・画質・同一人物性を認定しない。
- REVIEW_REQUIRED はシステムの形式要件を満たした状態だけ。実画像・編集QAは必要。
- 再試行は1コマ最大2回／1ページ最大8回。承認済みページ・コマ、同じ入力、原稿の旧バージョン、根本原因不明、修正箇所不明、実画像と結びつかない失敗記録を停止する。
- nextCorrection は原因を1点だけ選ぶ。修正の効果は別途、前後の実画像から測る。

## テスト
node --test labs/comic-workbench/retry-controller.test.cjs labs/comic-workbench/retry-integration.test.cjs

## 実稼働に必要な残工程
この試験コードは外部AI生成APIを直接呼ばない。今後の生成オーケストレーターは以下を必須にする。

1. 確認済みSOURCE LOCK、本人承認済みMASTERの原本ファイルとSHA-256の比較を行う（テキスト申告フラグを信用しない）。
2. 生成前に validatePlan を呼び、BLOCKED ならAI作画を呼ばない。
3. 試行入力の実データからSHA256を計算し、失敗履歴へ不変追記。
4. 生成後の出力画像からSHA256とピクセル寸法を実測。assessResult を呼ぶ。
5. 台詞・話者・吹き出し・人物・構図は独立した画像QAを実施。判定が不明なら完成扱いにしない。
6. 原稿やCanonを無断変更せず、承認済み画像は永続保存・保護する。
7. 前回との差分、追加費用、作画時間、失敗原因、修正後の検証を記録する。

まだできないこと: 高品質な絵の自律作画、第三者の初見テストの代行、顔一致の自動認定、無人の定期制作。有料APIを勝手に起動しない。

## 安全・変更範囲
既存Draft PR #8のさらに先の試験ブランチ。正式MASTER画像・未公開画像・原稿自体はGitHubへ追加していない。main、公開PWA、Cloudflare、正式Canonは未変更。PRマージ・本番公開には明示承認が必要。
