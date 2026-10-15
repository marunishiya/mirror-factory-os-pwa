# MIRROR SOCIAL ENGINE — 安全な開発・検証フロー

対象リポジトリ: `marunishiya/mirror-factory-os-pwa`

**本変更は11媒体への実投稿機能の完成を意味しません。**

## 保護対象
- 既存PWA・GitHub Pages・ブラウザに保存されたデータとバックアップを壊さない。
- 正式CHARACTER MASTER・非公開原稿・制作データ・APIキーを公開リポジトリに追加しない。
- Cloudflare Worker `mirror-social-scheduler` / D1 `mirror-social-db` へ無断デプロイ・変更をしない。

## CIで行うこと
- `.github/workflows/mirror-worker-verify.yml` は関係ファイルへのPR時と手動実行時だけ起動。
- 通常ソース `cloudflare-worker/` があればそれを優先。
- まだ通常ソースがない場合のみ、従来ZIPのSHA-256をチェックして一時チェックアウトへ展開。
- `npm --prefix cloudflare-worker test` でテスト。
- `wrangler deploy --dry-run` によるコンパイル検証のみ。Cloudflare本番デプロイはしない。
- GitHub Secrets・Cloudflare APIキー・SNSのアクセストークンは渡さない。ワークフローの権限は `contents: read` のみ。

## 実績の区分
過去のCodexセットアップは既存Workerの29件のテストと監査・コンパイルの合格を報告している。ただし今回追加したCIの実行結果とは別。新しいPRのチェック結果が確認できるまでは、新CIを合格済みとは扱わない。

## 次の実装段階
1. ZIP原本を保持しながらWorkerソースを通常ディレクトリへ整理。
2. 匿名アクセス・入力・日時・D1既存スキーマ・ジョブ冪等性・並列重複・再試行・失敗監査をテスト。
3. SNS 11媒体の計画機能、DRY-RUN、公式APIによる実投稿を明確に分ける。
4. Codexで別ブランチのPRを作成、レビュー後も無断マージ・本番デプロイ・実投稿しない。
