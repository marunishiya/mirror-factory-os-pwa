# MIRROR SOCIAL ENGINE — Worker v0.5 開発状況

更新: 2026-10-16
対象PR: https://github.com/marunishiya/mirror-factory-os-pwa/pull/2

## 確認済み（ドラフトPR内・本番未反映）
- ZIP原本を保持しつつ、内容を検証してWorkerの通常ソース8ファイルを復元。
- リクエスト本文の上限をUTF-8の実バイト数12KBに変更。超過413・不正JSONやUTF-8は400。
- D1ヘルスチェック失敗時の503応答を実装。
- Workerのジョブ作成と作成履歴をD1の一括トランザクションで更新。
- キャンセルとその履歴も同じトランザクションで更新。
- **DRY-RUNに限り**、予約ジョブを `queued` から `simulated` へ原子的に変更し、`claimed` と `simulated` の2履歴を一括記録。並列実行時の重複イベントを防止。
- 予約のUTC比較は、保存形式に合わせた秒精度の `YYYY-MM-DDTHH:mm:ssZ` に統一。
- 結果: 既存29件、前回追加10件、今回追加6件のJavaScriptテスト **45件成功**。
- 追加でSQLiteの実SQLトランザクション検証5件が成功。ロールバック、冪等性、4並列競合を確認。
- GitHub Actionsでbootstrapとscheduled dry-runの2つを `wrangler deploy --dry-run` ビルド成功。本番にデプロイしていない。

## 安全制約
- `main`、既存PWA/ブラウザ保存データ/正式MASTER/バックアップは変更していない。
- Cloudflare Worker `mirror-social-scheduler` とD1 `mirror-social-db` は本番変更していない。
- SNS公式APIや有料APIへの発信処理は存在しない。11媒体の配信計画と実投稿は別。
- `ADMIN_TOKEN` 不在では、ジョブの登録・操作用APIはロック状態。
- このPRはドラフト。レビュー承認までマージ禁止。

## 未完了・本番移行前の必須ゲート
1. **実D1のスキーマと制約の照合**：テーブル・ユニークインデックス・イベント参照整合性を読み取り専用で確認する。SQLiteでの再現テストはD1本番テストではない。
2. **過去に`processing`で停止したジョブの扱い**：自動復旧・再試行上限・デッドレターを設計し、誤って二重投稿しないテストを作る。現時点のv0.5は新規DRY-RUN実行で一時的なprocessingを使わないが、旧データの復旧機能は未実装。
3. **障害時の再試行方針**：D1書き込みが継続して失敗した時の通知・バックオフ・上限設定は未実装。
4. **D1互換の統合テスト**：SQLiteのSQLテストに加え、CloudflareローカルD1/Miniflareで同じ操作を実行して確認する。まだ実施していない。
5. **本番Cronと認証設定**：Cron・トークン・SNS公式API認証は未完了。11媒体への実投稿は未完成。
6. 本番デプロイ前に、上記をクリアして人手の明示承認を取得する。

## 最新の確認可能なチェック
GitHub Actions: https://github.com/marunishiya/mirror-factory-os-pwa/actions
PR: https://github.com/marunishiya/mirror-factory-os-pwa/pull/2
