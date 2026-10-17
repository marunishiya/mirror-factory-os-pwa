# PROJECT MIRROR｜11媒体統合予約投稿アーキテクチャ v1.0（2026-10-18）
状態：**設計・公式資料調査済／Buffer接続と11媒体の実投稿は未完了**。ユーザーがBuffer先行方式を採用。
変更対象は開発ブランチの本設計文書とプラットフォーム台帳のみ。main、現在のPWA/localStorage、D1、Worker、既存投稿、正式MASTERは変更しない。

## 正式な11媒体（既存social-v05.htmlのCHANNELSから抽出）
| キー | チャネル | 推奨配信エンジン | 自動化上の条件 | 第1段階 |
|---|---|---|---|---|
| youtube | YouTube Shorts | Buffer | 動画・自動公開可能な形式・正しいYouTubeチャンネル | **先行3媒体** |
| instagram | Instagram Reels | Buffer | Professional（Business/Creator）・音源や機能により通知方式 | **先行3媒体** |
| tiktok | TikTok | Buffer | 自動公開可能な動画のみ。ネイティブ音源・編集機能は通知方式 | **先行3媒体** |
| threads | Threads | Buffer | 対応投稿形式、本人アカウント接続 | 拡張候補 |
| x | X | Buffer | Xアカウント接続、投稿形式/制限の確認 | 拡張候補 |
| bluesky | Bluesky | Buffer | テキスト/画像/動画の仕様制約 | 拡張候補 |
| pinterest | Pinterest | Buffer | 適切なボード・画像/動画・リンク先 | 拡張候補 |
| facebook | Facebook Pages | Buffer | **個人プロフィールではなくページ**、ページ権限 | 拡張候補 |
| mastodon | Mastodon | Buffer | サーバーごとの文字数・動画40MB制限など | 拡張候補 |
| tumblr | Tumblr | **Tumblr公式予約** | Buffer非対応。ブログ管理者がTumblr標準予約画面で設定 | 独立導線 |
| note | note | **note公式予約 or 下書き** | Buffer非対応。noteプレミアム（月額500円）が必要。未契約時は手動公開 | 本編の正本を保護 |

Bufferは9媒体対応でも無料プランでは**合計3チャネルまで同時接続**。Freeはチャネルごとに予約10件（公開で枠が空く）／1 API key／API 3000リクエスト/月。
Paid Essentialsは最初の10媒体が月払いUSD $6/チャネル、年払いUSD $5/チャネル/月相当（年払いは先払い）。9媒体月払いなら計USD $54/月（為替・税別、実際の契約前に現行料金を再確認）。**無断アップグレード・課金・トライアル登録をしない**。
無料チャネル枠を繰り返し入れ替える運用は接続上限などの罠があるため、3媒体固定で初期検証を優先。

## 目的と実際の構造
```text
正式CHARACTER/MASTER + 承認済みコンテンツ
     │ 変形禁止・メディア別権利/映像QA（MIRROR基準）
     ▼
MIRROR Publication Hub（将来の独立PWA/OS統合機能）
     │ 共通campaign_id / asset hash / 出稿先 / timeJST / captions / approval
     │ provider adapter registry
     ├── BUFFER adapter（9媒体） → Buffer OAuth済みチャネル → 各公式SNS
     ├── TUMBLR_NATIVE adapter → Tumblr公式の予約操作/結果登録
     └── NOTE_NATIVE adapter → note公式予約（契約要）または下書き確認
                  ↓
       各媒体の公開URL・Buffer Sent・SNS実表示を突合
             → 監査ログ・再生/流入/売上を分析
```

### 最優先：機能を増やす前に1本の実投稿証明
- Buffer公式無料プランに本人がログインし、YouTube、Instagram、TikTokを接続。
- QA承認済み・公開承認済みの縦型動画を1本選択。素材は日本語台詞とMASTER照合を通過したもののみ。
- Buffer側で確実に **Automatic** を選択。Notify me/notificationは「未完成/手動介入が必要」と表示。
- 未来日時で予約し、scheduled確認 → 時刻後にsent確認 → 公式SNS上で公開URL/メディアを検査。
- 公開ID・時刻・媒体・実際の公開URLが揃うまでは成功と報告しない。外部プラットフォームが拒否したときは原因記録、無条件再送なし。

## 共通キャンペーン・ジョブのデータ設計
**1 campaign : 多 platform jobs**。本文は一律コピーせず、媒体ごとの文脈・上限・リンク/ハッシュタグ・縦横比に合わせた版を持つ。
最小フィールド:
- `campaignId`（決定的なUUID）、`canonRef`（正式MASTER版）、`mediaSha256`、`contentAssetRef`（秘密URLではない識別子）、`rightsApproved`、`qaApproved`、`publishApproved`。
- `channelKey`、`bufferChannelId`（Bufferの場合）、`dispatchMode`（buffer_api/buffer_ui/native_scheduler/manual）、`deliveryMode`（automatic/notification/native_schedule/manual）、`captionForChannel`、`linkTarget`。
- `plannedAtJST`、`plannedAtUTC`、`providerScheduleId`、`scheduledAckAt`、`providerStatus`、`publishedAt`、`publicPostUrl`、`lastCheckedAt`、`errorCode`。
- `dedupeKey = campaignId+channelKey+mediaSha256+plannedAtUTC`。同じキャンペーンの別媒体は別ジョブ、同一媒体の再操作は予約を重複させない。
- 秘密情報やチャネルアクセストークンをlocalStorage、公開GitHub、スクリーンショット、CSV出力に入れない。将来のBuffer APIキーはWorker Secret等へ。
- 一覧APIでユーザーが媒体/予約/例外を確認できる。状態は
  `draft → qa_passed → approved → scheduling → scheduled → verification_pending → published`
  または `notification_required / needs_review / failed / cancelled / verified_nonpublic`。
- 外部POSTの結果が不明なら`needs_review`で停止。実投稿の存在確認なしに再送しない。
- JST/UTCを明示変換し、夏時間の地域・媒体別タイムゾーンに注意。公開予定日は過去日時禁止、予定時刻は明示確認。
- 分析ではSNS上の公開URL/実測値のみを公開成功と記録。Buffer側のScheduled/Sentは補助的な証拠。

## Buffer API統合の実装順
**Phase 1 / ネットワーク送信なし**: 公式のBuffer UIで手動予約、各媒体の投稿結果を確認。1媒体PASSまでAPI実装を急がない。
**Phase 2 / 読み取り専用**: Buffer GraphQL `https://api.buffer.com` の本人発行キーで`organizations/channels/posts`を照会。接続済み媒体、予約残数、失敗・Sentを一覧化。3,000リクエスト/月を超えないキャッシュ・ポーリング頻度。実キーはブラウザ/PWAへ置かずSecretへ。
**Phase 3 / 明示公開承認後の書き込み**: `createPost`、`mode: customScheduled`、`dueAt` ISO UTC、`schedulingType: automatic`を使い未来日時を登録。動画は公開到達可能なURLが必要（**非公開MASTERを直接外部に公開しない**）。安全な配信元/R2と公開範囲・費用承認の後に導入。
**Phase 4 / 9媒体拡張**: Threads、Bluesky、Mastodon、Facebookページ、Pinterest、Xのうち効果の高い順にチャネル拡張。有料チャネル追加は試算とユーザー承認を毎回ゲートにする。
**Phase 5 / 11媒体**: Tumblr公式予約を外部連携結果として追跡。noteは現在の本編マガジン/記事の正本を守り、プレミアム契約・日時指定の本人承認がある場合のみ公式予約。noteの非公開APIや規約を逸脱するブラウザー自動投稿は行わない。

## 各媒体で公開制御を分ける
- 自動公開 `automatic` は「メディア形式・接続状態・Buffer設定」確認後のみPASS候補。
- 投稿内容がネイティブ編集必須なら`notification_required`で要操作表示。「予約時間に公開された」と誤報告しない。
- Tumblr/noteはBuffer送信の成功率集計に混ぜない。外部の予約と投稿確認を別々に記録。
- 同じ映像の音楽ライセンスがSNS間で共通利用可能とは限らない。権利が未確認なら媒体別にブロック。
- 投稿1本からnote読了・マガジン・有料記事等への動線を媒体別UTM付きで計測。ただし各SNSのリンクのクリック可能性は個別確認。
- 自動連投・重複スパム・未承認MASTER公開は禁止。ガードは「承認→予約→SNS公開照合」の3点。

## QAゲート
1. 媒体カタログ11件か、キー重複なし。
2. Buffer対応9件＋Tumblr/native＋note/nativeの漏れなし。
3. 予約時間と公開時間のタイムゾーン一致。
4. Canon/文字数/音楽・権利/画角/メディア形式のチェック。
5. provider scheduled ID≠published IDの区別。
6. 受信不明で自動再送・二重投稿が起きない。
7. 料金の新規発生前に停止し確認。
8. 本番Worker、D1、既存PWAや公開作品の一切の無断変更なし。

## 一次資料
- Buffer料金・API料金枠: https://buffer.com/pricing
- Buffer対応媒体: https://support.buffer.com/articles/supported-channels-LM3P7Y4zsp
- Buffer無料予約数: https://support.buffer.com/articles/how-many-posts-can-i-schedule-in-advance-Kmy2IEecqm
- Buffer API媒体と限界: https://support.buffer.com/en-us/articles/what-is-buffers-api-GtIYIQilz5
- Buffer API予約方式: https://developers.buffer.com/guides/posts-and-scheduling.html
- Buffer API動画URL: https://developers.buffer.com/examples/create-video-post.html
- 各SNS動画制限: https://support.buffer.com/en-us/articles/sharing-videos-through-buffer-LOe2p2rnAI
- Tumblr公式予約: https://help.tumblr.com/ja/予約投稿保存/ 
- note公式会員機能: https://www.help-note.com/hc/ja/articles/360000279862-noteプレミアム会員でできること
