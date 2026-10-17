# PROJECT MIRROR | 独自SNSエンジン v0.7：動画3媒体の公式API接続（開発版）

作成日：2026-10-16
PR：[独自SNSエンジン #5](https://github.com/marunishiya/mirror-factory-os-pwa/pull/5)

## 目的
**Metricool等を介さず**、MIRRORのCloudflare Worker・D1からYouTube・Instagram・TikTokの**公式APIへ直接投稿する**。現時点では開発コードとモックテストの完了であり、**SNSアカウント認証・審査・実投稿・本番デプロイは未完了**。

## 接続方式
| 媒体 | 正式APIの経路 | 実装したもの | 追加で必須 |
|---|---|---|---|
| YouTube / Shorts | YouTube Data API `videos.insert`、Google OAuth 2.0 `youtube.upload`、再開可能アップロード | オフライン用リフレッシュトークン→アクセストークン更新、R2承認済み動画取得、動画アップロード開始→セッションURL検証→PUT、本体応答ID、未完了308とHTTPエラーの検出 | Google API有効化、OAuth同意・本人認証、秘密情報のCloudflare登録、R2コンテンツ保管、実アップロードテスト、アップロード処理・公開状況の照会、必要なGoogleのAPI審査 |
| Instagram Reels | Instagram Graph API `/{ig-user-id}/media` → `/{creation-id}?fields=status_code` → `/{ig-user-id}/media_publish` | 認証Bearerによる動画コンテナ作成、FINISHEDを確認してからmedia_publish、受領IDの取得 | プロアカウント、Metaアプリ、OAuthと`instagram_content_publish`等の権限、公開HTTPS上の承認済みMP4、実素材エンコード検証、投稿結果照会 |
| TikTok | Content Posting API `/creator_info/query/` → `/video/init/`（PULL_FROM_URL）→ `/status/fetch/` | 最新クリエイター公開範囲情報をAPI照会し、承認済み公開範囲が含まれる場合だけ初期化。AI生成フラグ、publish_id取得・PUBLISH_COMPLETE/FAILED/PROCESSING区分 | TikTok Developerアプリ・`video.publish`のOAuth本人認証、投稿アプリの審査、動画公開URLのドメイン/プレフィックス所有権検証、本人の投稿前同意UI、実投稿結果照会 |

## 実装した防護措置
- `cloudflare-worker/src/video-official.js`：標準Web API（`fetch`、`URL`、`URLSearchParams`）のみで実装。外部投稿管理サービス/任意のGitHub OSSを丸ごと組み込まない。
- **二重オフスイッチ**：`LIVE_PUBLISHING_ENABLED='true'` **かつ** `VIDEO_LIVE_ENABLED='true'` がないとすべての動画投稿API呼出しを拒否する。いずれも未設定＝拒否。
- 各投稿に `qaApproved=true`、`mediaApproved=true`、AI生成を申告する `isAigc` の明示入力が必要。秘密情報はWorkerのSecretで受け取り、ソース/ブラウザ/GitHubに書かない。
- Instagram/TikTokの `videoUrl` は管理者設定`VIDEO_PUBLIC_PREFIX`と完全一致するHTTPSホスト・パス配下、`.mp4`、パラメーターなしに限定。任意サイトのURLや未公開MASTERを転送しない。TikTok側にそのプレフィックスの所有権証明が必要。
- YouTubeの動画は`VIDEO_R2`というPrivate R2 Bucketの`approved-videos/...`.mp4に限定。試験実装の単一PUTは50MiB以下のファイルのみ。画像・動画本体はGitHubに保存しない。
- Instagramのコンテナ作成は**投稿済みではない**。FINISHEDになって初めてmedia_publishできる。
- TikTokの`publish_id`は**受付ID**。`PUBLISH_COMPLETE`以外は公開完了と扱わない。公開閲覧可能になるタイミングは審査に依存する。
- YouTubeのアップロード`id`は**受領ID**。`SUBMITTED`を公開・動画処理完了として扱わない。途中で308/ネットワーク断の場合は不確実扱いとし、無条件の自動再送を行わない。
- `GET /video-readiness`はBearer管理者認証+既存DBの起動確認を通過したときに**不足する設定名だけ**を返す。認証情報そのものを返さず、configuredはverified/connected/publishedを意味しない。
- `social-direct-pilot.html`に接続準備状況ボタンを追加（レビュー用開発ページであり、現時点でGitHub Pages本番に反映されていない）。

## 現時点では**つないでいない**もの
1. v0.6の`processLiveDue`によるD1 Cron配信対象は現在Bluesky/Mastodonテキストのみ。3つの動画公式APIアダプターは**意図的に未接続**。誤った早期有効化を防ぐ。
2. 動画を扱う状態遷移（Instagram: container_id、TikTok: publish_id、YouTube: upload session/video id）は本番D1で未作成。必要な状態遷移と冪等性を設計し、実スキーマ照合の後に別の安全なmigration/PRで追加する。
3. OAuth初回認証のコールバック、TikTokのCreator UX、Google/Meta/TikTokのアプリ審査、動画素材のR2構築/費用承認。
4. YouTubeの中断セッション再開、動画処理状況の確認、Instagram/TikTokの投稿完了までの継続監視と実配信QA。
5. Instagram/YouTube/TikTokでテキスト投稿だけのSNS共通実装を無理に流用しない。

## 設定候補（すべて未登録。実値はGitHub/チャットに貼らない）
- Cloudflare Workers Vars: `VIDEO_LIVE_ENABLED`（初期無効）、`LIVE_PUBLISHING_ENABLED`（初期無効）、`VIDEO_PUBLIC_PREFIX`（TikTok側で所有権確認後のHTTPS URL prefix）
- Cloudflare R2 binding: `VIDEO_R2`（作成・課金・接続は本人の了承が必要）
- Cloudflare Secret: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN`
- Cloudflare Secret: `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_IG_USER_ID` とVar `INSTAGRAM_GRAPH_VERSION`
- Cloudflare Secret: `TIKTOK_USER_ACCESS_TOKEN`
- 確認フラグ（未設定）：`YOUTUBE_PUBLIC_AUDIT_CONFIRMED`、`INSTAGRAM_CONTENT_PUBLISH_SCOPE_CONFIRMED`、`TIKTOK_DOMAIN_VERIFIED`、`TIKTOK_APP_AUDITED`、`TIKTOK_VIDEO_PUBLISH_SCOPE_CONFIRMED`、`YOUTUBE_PUBLIC_ALLOWED`。

## GitHub OSS調査と判断
- `googleapis/google-api-nodejs-client`: Apache-2.0/Google公式。Node専用機能がCloudflare Workerに無条件で使えるわけではないため、今回は**公式REST API仕様の参考**にして依存追加しない。
- `cloudflare/workers-sdk`: Apache-2.0/公式。現在のWranglerローカルD1とCronテストを採用済み。
- `bluesky-social/atproto`, `neet/masto.js`: 開発中のテキスト投稿パスで仕様参照、外部依存は追加せず。

## 公式ドキュメント
- YouTube 再開可能アップロード: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- YouTube OAuth offline: https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- Instagram Meta公式API Postman: https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00
- TikTok Direct Post: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- TikTok Creator Info: https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info
- TikTok status: https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status

## 直近の作業順
1. このモックテストをCIに追加、既存テストやD1 Cron統合が失敗していないことを確認。
2. 事前検査（素材形式、サイズ、字幕、サムネ、SNS別表記、Canon/MASTER一致）を実装。
3. 3媒体の公開審査・本人認証に必要な情報をスマホ画面から**安全に確認**し、認証の本人操作は最低限のみにする。
4. D1の中間状態と成功照合、定期Cronによるステータス照会、非二重投稿を先に実装・検証。
5. **本番Cloudflareデプロイと外部実投稿は本人が明示承認してから**実行する。

完成条件：実SNSに指定時刻で投稿され、実際の動画URL/IDが確認でき、APIエラーにより誤った成功表示や二重投稿が起きないこと。
