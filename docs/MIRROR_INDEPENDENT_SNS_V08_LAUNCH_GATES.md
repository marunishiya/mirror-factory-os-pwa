# PROJECT MIRROR｜独自SNS予約自動投稿 v0.8 本番導入ゲート

作成：2026-10-16 / 対象PR #5（ドラフト） / OWNER承認まで実投稿・Cloudflareデプロイ禁止。

## 開発版で完成した経路
- スマホ専用画面 `social-direct-pilot.html` で3つの媒体の動画予約・承認・投稿状況照会。
- 管理者認証 `POST /video/jobs`、`GET /video/jobs`、`POST /video/jobs/:id/cancel`。
- 専用D1テーブル `video_jobs`、`video_job_events` で予約時刻・媒体・動画ID・公開結果・障害情報を追跡。既存jobs/job_eventsとは物理的に分離。
- Cron 1分間隔設定を `wrangler.jsonc` に追記（**設定ファイルのみ**、Cloudflare側へデプロイ未実施）。
- 予約時刻にCASで一度だけdispatchし、YouTubeはPrivate R2→再開可能アップロード、InstagramはReelコンテナ、TikTokはDirect Postへ送信。
- 受付ID≠公開成功。Cronが次回以降に公式APIへ読取照会し、YouTubeの処理完了・Instagramパーマリンク・TikTok `PUBLISH_COMPLETE`を確認して記録。
- 非公開動画を`published`扱いしない。送信結果不明は`needs_review`。ステータス照会は最大288回・5分ごとの想定で打切り後に要確認（自動再送禁止）。
- GitHub ActionsでCloudflare **ローカルD1** に動画予約9テストを追加。JavaScriptモックテストで3媒体の送信→処理状況→確認を検証。

## 重要：まだ実SNSで予約自動投稿は成功していない
- Cloudflare本番のD1スキーマは**未照合**。ここに入れた`cloudflare-worker/migrations/0002_video_reservations.sql`はあくまで**未適用の提案**であり、`test/schema.local-test.sql`とは目的が異なる。DDL確認・バックアップと承認が必要。
- `wrangler.jsonc`にCron設定が存在しても**本番デプロイされていない限り起動しない**。
- `wrangler.jsonc`の4スイッチはすべて`false`。スマホ予約APIを使用するにはD1動画テーブルが存在して`VIDEO_QUEUE_ENABLED=true`が必要。実SNS送信には追加で`LIVE_PUBLISHING_ENABLED=true`、`VIDEO_LIVE_ENABLED=true`、`VIDEO_DISPATCH_APPROVED=true`と個別認証が必要。
- YouTube：本人のGoogle OAuthアプリ、有効な`youtube.upload`スコープ、承認済み動画素材用R2 `VIDEO_R2`、API審査と公開権限の確認。試験用アップロードは50MiB以下。
- Instagram：プロアカウントとMetaアプリの`instagram_content_publish`等の権限、`INSTAGRAM_ACCESS_TOKEN`、`INSTAGRAM_IG_USER_ID`、Graph APIバージョンと公開HTTPS動画URL。
- TikTok：DeveloperアプリのContent Posting API、`video.publish` scope、アプリ審査、公開配布URLのドメイン所有権確認、投稿時の公開範囲・AI申告・Creator Infoチェック。
- SNSへの接続やCloudflare R2の利用が必要になれば、課金条件確認と本人ログインが必要。チャットやGitHubにアクセストークンを貼らない。
- **残る媒体（Threads、X、Pinterest、Facebook等）の公式API接続は未完成**。既に実装済みのBluesky/Mastodonテキスト経路の認証も未完了。

## 開発側の次の優先順位
1. Cloudflare本番D1のテーブル・既存コードを**読み取り専用**で照合。既存ブラウザ保存や本編Canonは触らない。
2. Google/Meta/TikTokそれぞれの開発者アプリ・必要権限と利用可能なアカウント状態を調べる。権限不足があれば個別に報告。
3. Cloudflareプレビュー環境と本番環境を明確に分離。スマホ管理画面のプレビュー確認（現時点で本番GitHub Pagesには反映していない）。
4. 本人によるログイン・秘密情報の安全な登録・ストレージ利用承認・明示的な本番デプロイ承認。
5. プライベート/限定可視のテスト投稿→結果を人間が確認→1媒体ずつ公開試験。投稿成功IDをD1に記録。
6. 初回公開成功の検証後に11媒体へ拡張し、本番監視・二重投稿防止・事後検証を強化。

## 非破壊の戻し方
問題発生時はCloudflare Worker vars の`VIDEO_DISPATCH_APPROVED=false`または`LIVE_PUBLISHING_ENABLED=false`に戻し、Cronによる外部APIへの送信を停止。D1ジョブや公開中の過去のSNS投稿は勝手に削除しない。先にユーザー承認を得る。

## 検証ログ
GitHub Actions `https://github.com/marunishiya/mirror-factory-os-pwa/actions` で当該PRの最新HEADに対する成功を確認。成功は本番SNS公開成功を意味しない。
