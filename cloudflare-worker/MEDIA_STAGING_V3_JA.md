# PROJECT MIRROR v3.0 — 動画自動受け渡し（レビュー用・未配備）

## 今回実装した内容

- 既存PR #6のYouTube専用Workerへ新規メディアステージングモジュールを追加した。
- QA・投稿承認済みYouTubeジョブの動画を、許可されたHTTPSホストからWorkerが取得する。
- **HTTPS／ホスト名の完全一致許可リスト、リダイレクト拒否、32MiB制限、MIME、サイズ、SHA-256**で実行前後に検証する。
- 検証に成功した動画はCloudflare R2に**非公開・SHA-256キー**で保存。同じ動画を再受信せず、R2の既存データも読み戻して照合する。
- 別エンドポイントでR2に保存済みの動画を読み戻し、**従来のYouTube resumable upload**へ渡せる。
- 既存のSNS公開停止フラグと本人承認・OAuthを維持。R2保存だけではSNSへの公開や予約は発生しない。
- Cloudflare Workersで未サポートのfetch redirect: errorをredirect: manualに変更し、3xx応答を明示的に拒否する。

## 追加API

既存のAdmin Bearer認証と同一オリジン制限の対象。

1. **POST /api/jobs**: 従来どおりキャンペーン、動画のバイト数・SHA-256、未来の投稿予定日時、QA・投稿承認を検証してジョブ作成。
2. **POST /api/jobs/:id/stage**: JSON本文 {"sourceUrl":"https://approved-video-host.example/clip.mp4"}。ジョブがdraftのとき、配信元から取得して非公開R2に保存し、保存状態を返す。SNS投稿は行わない。
3. **POST /api/jobs/:id/upload-staged**: 保存済みR2動画のサイズ・SHA-256を再検査してYouTubeアップロード処理へ受け渡す。**LIVE_PUBLISHING_ENABLED=trueの明示設定が必要**。YouTubeの動画IDと将来公開日時を照合する既存処理を利用。

## 本番前ゲート（いずれも未実行）

- 本人承認後に非公開R2バケットを作成し、無料枠・費用を確認。現在は作成・課金を行っていない。
- 承認したR2バケットへのWorkerバインディング名を **MEDIA_BUCKET** とする。wrangler.youtube.jsoncにr2_buckets配列を追加する。レビュー段階では**実バケット名を推測して既定設定に書き込まない**。
- 環境変数 **MEDIA_SOURCE_HOSTS** に許可したHTTPS配信元のホスト名だけをカンマ区切りで設定。例: videos.example.com。空欄なら必ず拒否。ワイルドカード不可。
- PR #6のD1マイグレーション、Google OAuth、正しいチャンネルID、Secret管理、本番フラグ、本人による最終承認を継承。
- **LIVE_PUBLISHING_ENABLED=false**を維持したまま、R2保存と模擬アップロードだけを確認する。実予約・本番デプロイには別途明示承認が必要。

## 制限と未完成の範囲

- 初回ファイルが制作サービスのHTTPS配信元にある場合は、スマホから手動でファイルを選ばずに取得できる。一方、スマホのローカルにしかない動画を自動で読み取ることはできない。
- APIが使える制作サービスからの完了通知、投稿台帳・制作QA・重複確認との連携、InstagramとTikTokへの展開は未実装。
- 32MiB以下の動画をメモリ内で検証。大型ファイルはストリーミング／分割方式に設計変更する。
- R2の実接続、実動画、YouTube本番OAuth／公開・予約、公開結果照合は未検証。テスト成功を本番成功と混同しない。
- 別のDraft PR #5にInstagram/TikTokエンジンがあるが、今回のブランチに統合していない。無断マージ禁止。
- 既存PWA、main、MASTER、CANON、ユーザー保存データには変更を加えない。

## テスト

- 従来のWorkerテストに、R2への保存→模擬YouTube予約の結合テスト、公開停止フラグの検査を追加。
- 新規テストは悪意あるURL、3xx、MIME・サイズ・ハッシュ不一致、同一動画の二重取得防止、改ざん、32MiB超の不明長動画を検査。
- GitHub Actionsはnpm testとWrangler dry-runビルドのみ。本番配備なし。

## 公式仕様

- https://developers.cloudflare.com/r2/get-started/workers-api/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/workers/runtime-apis/request/
- https://developers.google.com/youtube/data/reference/rest/v3/videos
