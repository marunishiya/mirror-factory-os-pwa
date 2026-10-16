# YouTube公開予約 v0.5 — 実装済み・本番検証前

## 今回の方式
当システムから動画を事前転送し、YouTubeのstatus.publishAtに公開日時を登録する。
YouTube側の動画ID、チャンネルID、非公開状態、公開予定日時を照合してから予約完了と表示する。
転送完了まではブラウザを開いておく。確認済み予約の公開時刻には端末やCronの稼働は不要。
Cloudflareで毎時刻アップロードを開始する方式や、スマホが閉じている間に素材を転送する方式ではない。

## 実装範囲
- 同一Worker上のスマホ用投稿画面。既存Factory OSとsocial-v05.htmlの保存形式は変更しない。
- Google OAuth（upload + readonly）、10分のstate、HttpOnly Cookieによるブラウザ照合、一度のみ使用。
- 予定チャンネルへの接続を認証時と転送時に検証。リフレッシュトークンとアップロードURLはAES-GCMで暗号化。
- 動画SHA-256、サイズ、MIME、公開日時、作品QA、公開承認、子ども向け・合成メディアの明示申告。
- 同じ動画SHA-256と公開日時から画面が安定したcampaignIdを生成。再操作しても同じジョブに戻す。
- Google resumable upload。中断時はGoogleの受信位置を問い合わせ、同じ動画の続きのみ転送。
- 最終応答不明時はprobeで結果を照合。session作成応答が不明なら自動再挿入せず要確認とする。
- D1の新規3テーブルのみ。旧jobs/job_eventsは書き換えない。

## 制約・未検証事項
- 動画は1本32MiBまで。初回アップロードと再開時に、元動画をスマホで選択する。
- 指定日時はUTCで10分以上先。画面の入力は常に日本時間として変換する。
- 実YouTube OAuth、実転送、公開予約、Cloudflare D1、実Worker上の動作は未検証。
- 本版は既存フロントの11媒体送信機能ではない。YouTube専用画面を先に完成させる。
- 登録後の予定変更・YouTube予約取消をこの画面からは行わない。必要時はYouTube Studioで操作する。
- 問合せ中や転送中のleaseは120秒。処理中表示ならすぐ再送せず、解放後に照合する。
- 予約のAPI受付を確認するもので、将来の公開成功・動画処理成功・権利審査通過を保証しない。
- 実API側で非公開固定などの制限がある場合は迂回せず、実レスポンスと公開条件を確認する。
- Google OAuth Testing状態のトークン寿命やプロジェクト利用上限も本番投入前に確認する。
- API応答不明でsessionが保存されていないジョブは手動照合が必要。単に新campaignIdで再投稿しない。

## 本番設定（まだ実行しない）
ユーザー承認後、現在のCloudflareアカウント・DB ID・チャンネルを現物と照合する。
このファイル自体はデプロイ権限や公開承認ではない。

1. 既存Google Cloudプロジェクトを選び、YouTube Data API v3の有効化状況を確認。
2. Web application型OAuthクライアントと同意画面を設定する。新しいアクセス許可はユーザーが確認する。
3. 許可済みリダイレクトURIを次に完全一致させる。

   https://mirror-social-scheduler.projectmirror-ai.workers.dev/oauth/youtube/callback

4. WorkerのSecretにADMIN_TOKEN（32文字以上のランダム値）、TOKEN_ENCRYPTION_KEY（32ランダムバイトのBase64）、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRETを安全な設定画面/CLIで登録する。
   パスワード・トークンをチャット、公開GitHub、スクリーンショット、フロントコードに置かない。
   TOKEN_ENCRYPTION_KEYを変更すると既存の暗号データを復号できなくなるためバックアップと鍵管理が必要。
5. wrangler.youtube.jsoncのYOUTUBE_CHANNEL_IDを本人のYouTubeチャンネルIDと照合する。
   現在の値は接続済みMetricoolのメタデータから得たIDであり、Google OAuthで再照合する。
6. 承認後に追加migrationを適用する。既存DBのバックアップ/復元手段とスキーマを先に確認する。

   npx wrangler@4 d1 migrations apply mirror-social-db --remote --config wrangler.youtube.jsonc

7. LIVE_PUBLISHING_ENABLED=falseのまま、承認後に明示的に配備する。

   npx wrangler@4 deploy --config wrangler.youtube.jsonc

8. Workerトップ画面で管理トークンを入力し、接続状態を確認。Google OAuthで本人が投稿先チャンネルを選択する。
9. 公開先・動画・日時・費用・変更差分を確認し、最終承認後にLIVE_PUBLISHING_ENABLED=trueへ変更して再配備する。
10. QA済み動画1本を選択し、未来日時を指定して公開予約を登録する。
11. 返却された動画IDと公開予定日時をYouTube側でも読み取りで確認する。

本変更は新規ストレージサービス、課金プラン、Cronを追加しない。
既存プランのWorker/D1リクエスト使用量やGoogle API利用上限は別途確認が必要。
旧bootstrap/dry-run用Actionsは本実装を配備しない。既存Actionsから本番送信を有効化しない。

## ローカル検証
Node.js 24を使用。npm testで旧29テスト、新21テスト、旧監査チェック2件を実行。
新テストはSQLiteの実SQLと模擬Googleレスポンスを使い、ネットワークへの書込みなしで実施する。
実APIに対するend-to-end成功を意味しない。

## 一次資料
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.google.com/youtube/data/reference/rest/v3/videos
- https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/data/guides/auth/server-side-web-apps

2026-10-16確認。publishAtはprivateかつ未公開動画に設定する。過去日時で即時公開される挙動を避けるため、サーバー側でも転送直前に日時を検証する。
