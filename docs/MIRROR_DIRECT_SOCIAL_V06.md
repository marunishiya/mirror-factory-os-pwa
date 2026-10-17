# PROJECT MIRROR — 独自SNS自動投稿エンジン v0.6（開発中）

最終更新: 2026-10-16
レビューPR: https://github.com/marunishiya/mirror-factory-os-pwa/pull/5

## 目的と境界
**Metricoolは使用しない。** PROJECT MIRRORが管理する Cloudflare Worker + D1 + GitHub Pages PWA から、各SNSの**公式API**へ直接投稿する。

原則:
- 既存MIRROR FACTORY OS PWA、正式MASTER、ブラウザlocalStorage、バックアップを変更しない。
- 未認証SNSを「接続済み」または「投稿成功」と表示しない。
- 公開承認・API認証なしに、本番SNS投稿・Cloudflareデプロイ・D1書込・課金をしない。
- 既存Worker v0.4/v0.5 ZIP原本とmainを維持し、別ブランチのドラフトPRで検証。

## アーキテクチャ
1. スマホ用の独立ページ `social-direct-pilot.html` からジョブ登録（管理者トークンは端末に保存しない）。
2. Worker `POST /jobs/live` が管理者認証、QA確認、媒体、文字数、予約UTC日時、キャンペーンIDを検証し、D1の`jobs`と`job_events`を原子更新。
3. Cloudflare Cronの`scheduled`イベントが時刻到達ジョブを取得。`queued`から`dispatching`へ条件付き原子更新して多重実行を防ぐ。
4. 投稿元はWorkerのCloudflare Secretを使用し、公式SNS APIへ直接HTTPS送信。
5. 成功時は`published`と媒体側の投稿IDをD1監査ログへ保存。不確定な送信失敗は`needs_review`、DB更新停止時は`dispatching`のまま残し、**自動再投稿しない**（二重投稿防止）。

## 実装済みの投稿アダプター（実SNS認証は未設定）
- **Bluesky**: AT Protocol `com.atproto.server.createSession`、`com.atproto.repo.createRecord`（`app.bsky.feed.post`）。標準`bsky.social` PDSのテキスト投稿専用。
- **Mastodon**: OAuthユーザートークン `write:statuses`、`POST /api/v1/statuses`、`Idempotency-Key`。テキスト投稿専用。インスタンスURLはHTTPSかつ公開ドメイン形式のみ。
- **YouTube / Instagram / TikTok / Threads / X / Pinterest / Tumblr / Facebook / note等**: 公式API・必要な審査・素材アップロード・権限確認が未実装。全11媒体を完成と見なさない。

## 初期設定: 安全のため外部から実投稿不能
- デフォルトの`LIVE_PUBLISHING_ENABLED`は未設定＝**false相当**。
- 本番D1の既存`jobs`テーブルで`mode='live'`を許可しているか、`status`制約と監査用列が一致するか**不明**。本番更新前に読み取り専用で確認する。
- Cronトリガーは未設定。スケジューラーは予約時間に自動起動しない。
- 必要なシークレット（設定作業はまだ行っていない）:
  `ADMIN_TOKEN`（長さ32以上）、`BLUESKY_HANDLE`、`BLUESKY_APP_PASSWORD`、`MASTODON_BASE_URL`、`MASTODON_ACCESS_TOKEN`。
- 1媒体のみの運用なら、該当媒体の認証情報だけでよい。いずれも**GitHubに記録しない**、チャットにも貼らない。
- 読取専用D1スキーマ照合 → ローカルD1統合テスト → 認証設定・スイッチ承認 → Worker設定とCronのレビュー → 本番デプロイの明示承認 → 非公開/限定テスト → 1件の公開投稿確認 → 複数媒体追加の順にする。
- `LIVE_PUBLISHING_ENABLED` は意図的に`true`へ設定したときだけ稼働する二重ガード。単にCronが存在しても投稿しない。

## 現在の検証
- APIアダプターは通信をモック化し、Bluesky認証→Record登録とMastodonのHTTPヘッダー・Idempotency-Keyを確認する。
- D1ジョブの予約登録・重複抑止、複数スケジューラーからの単発処理、失敗時手動確認への移行をモックで検証。
- `cloudflare-worker/src/index.js` が`dryrun.js`を読み込むため、WorkerのEntrypointはソースとして追跡可能。
- `npm --prefix cloudflare-worker test` と`python3 cloudflare-worker/test/sqlite_atomic.py` とWrangler `--dry-run`をCIで走らせる。
- テスト合格は**実SNS投稿や本番D1動作を証明しない**。

## 外部API公式資料
- Bluesky: https://docs.bsky.app/docs/tutorials/creating-a-post
- Mastodon: https://docs.joinmastodon.org/methods/statuses/
- Cloudflare D1 batch: https://developers.cloudflare.com/d1/worker-api/d1-database/

## 本番運用に不可欠な未実装事項
1. CloudflareローカルD1/Miniflareを使ったlive登録・ジョブ処理のSQL統合テスト。本番D1既存スキーマとの差分確認。
2. 1分または5分Cronの設定とWorker本番デプロイ（いずれも未承認）。
3. SNSアカウントの公式認証と非公開試験、ユーザー承認済み実投稿テスト。現在は未接続。
4. 監査UIで`needs_review`と`dispatching`を検出した場合の人間向け通知と再発防止。
5. 残る媒体のAPI規約、画像/動画アップロード、レート制限、審査、費用などの実装と検証。
