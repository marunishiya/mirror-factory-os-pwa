# PROJECT MIRROR｜1本→全SNS コンテンツ生産・配信自動化 v1.0
2026-10-18 / 状態：**設計のみ。SNS認証・Buffer接続・自動投稿は未稼働**
ユーザーから共有された動画の説明文と時刻一覧に基づく機能取り込み案。**実動画の映像・成功実績・収益は未検証。**

## 方針
- 正本: キャラクターCHARACTER MASTER / MOTION MASTER / 台詞正本 / バックアップ / 本編・記事Canon。
- 既存11媒体: YouTube Shorts、Instagram Reels、TikTok、Threads、X、Bluesky、Pinterest、Facebook Page、Mastodon、Tumblr、note。
- 初回はBuffer Freeの3媒体（YouTube Shorts、Instagram Reels、TikTok）。対応する追加6媒体は枠と成果・費用承認の後。Tumblrはネイティブ予約、noteは公式予約機能（有料契約の承認必要）または下書き。
- クリエイティブの生成・検証はChatGPT/Codex/既存ローカルツールで先に実現。Claude Code/Cowork/Browser/Skillsは**導入候補**。追加契約・トークン課金は採算検証後に許可を取る。
- **外部予約時刻の実行はBufferまたはSNS公式予約システムが担う。** ブラウザ操作AIやセッションスコープの定期タスクを時刻指定公開の唯一のエンジンにしない。
- 外部への公開、API権限付与、課金、本番デプロイ、master変更、Canon変更は無断実行しない。

## 1本→11媒体への制作パイプライン
1. ソース登録: campaign_id、SOURCE_CANON_HASH、マスター版、クリップ元、利用許諾、メディア識別子、公開承認状況、ファイル検証SHA256。
2. ストーリープロデューサー: 本編から「どこを見せると続きが気になるか」を選ぶ。犯人や反転の核心、未公開の設定、伏線の答えは**ネタバレしない**。
3. クリップ編集エージェント: 9:16縦動画を複数案生成。Shorts/Reels/TikTok別の秒数/コーデック/メディアサイズを検査。キャラ顔/声/身長/体型/MOTION/吹き出し・台詞・話者の一致をQA。
4. コピーライター: 媒体別本文を独立生成。YouTubeは短いタイトル・説明、Instagramは本文と導線、TikTokはフック、Threads/X/Bluesky/Mastodonは投稿テキスト、Pinterestは画像/ピンの遷移先、Facebook Pageは回遊、Tumblrはネイティブ予約、noteは記事/Magazineの正本。
5. 権利・Canon QAエージェント: キャラクター同一性、実背景、使用音源ライセンス、台詞→話者→相手、字幕の正確性、ネタバレ禁止、公開範囲、プラットフォーム規定、リンク先実在を照合。不一致が1個でもあれば予約登録不可。
6. 承認ゲート: ユーザーの**作品QAとSNS公開明示承認**を記録し、approved_by/approved_at/campaign_hashを固定。AI単独で自己承認しない。
7. 投稿ジョブ化: 各媒体に1ジョブ発行。送信キー (campaign_id,channel,asset_sha256,scheduled_at_utc) を一意化。JST入力→UTC保存、プレビューに両方表示。
8. Buffer手動接続→UIで初回本投稿成功確認後にBuffer API連携。Bufferで投稿してよい媒体/フォーマットのみ schedulingType=automatic。通知方式はmanual_notificationとして区別。
9. Buffer Scheduled確認→時刻後にSent確認→**SNS上の公開URLを実確認**。Buffer受付成功だけでpublic扱いしない。失敗/結果不明なら needs_review、自動再送停止。
10. 1日後/1週後に公式集計（取得可能な実測値のみ）、各媒体の再生/クリック/回遊/note読了を比較。勝ち筋を翌週の企画へ戻す。

## 役割分担・エージェント構成（各プロセスはプロンプト/Skillとして再利用可）
| エージェント | 入力 | 出力 | 絶対禁止 |
|---|---|---|---|
| Planner | 承認済みマスター、視聴実績 | 投稿アイデアと配信仮説3件 | ネタバレ核心を先出し |
| Scene Editor | 元動画の秒数/フレーム、Canon | 9:16候補とシーン構成 | 未確認人物/台詞の生成確定 |
| Copy Adapter | キャンペーン、媒体仕様 | 11媒体別の本文とハッシュタグ | 全媒体同文連投・未承認リンク |
| Canon & Rights QA | MASTER、字幕、音源、権利 | PASS/FAILと局所修正指示 | PASS偽装、疑義を無視した公開 |
| Publisher & Auditor | 承認ハッシュと予約時刻 | Buffer側予約ID、SNS URLと障害記録 | 無断投稿、失敗時無条件再送 |

「複数AIアバター」は自動配信できる技術でも、PROJECT MIRRORの正式キャラクターを別人に変える危険がある。**AIアバター量産を既存キャラの代替とせず**、新しいキャラはCanonの正式承認後にのみ追加。

## 定期タスク案（存在することと実際に動いていることを区別）
- 毎朝: 未公開案3件、前日の公開実績、ネタバレ・権利NG警告。
- 承認時: ジョブ予約・公開前チェック・媒体別プレビュー。**初期段階では外部APIへ送らず承認待ち**。
- 1日ごと: 公開結果の照合、失敗や通知投稿の見落とし、権利差分チェック。
- 毎週: 視聴維持、再生、読者回遊、投稿媒体別の費用対成果で優先度調整。
- 定期タスクは実際に設定・有効化されてからのみ稼働中と報告。Claude Codeのセッション依存/ローカル依存やクラウドルーティン、ChatGPT Automationsを混同しない。Claude Cowork、Claude Code API、Claude Browser Toolの稼働は別途費用や利用環境を確認。

## 投稿ソース／スプレッドシートの1レコード
```json
{
  "campaign_id": "draft-example-only",
  "master_version": "verified-canonic-id",
  "asset_sha256": "not-yet-computed",
  "source_video_ref": "private-controlled-asset",
  "spoil_level": "none",
  "rights_approved": false,
  "canon_qa_pass": false,
  "publish_approved": false,
  "network": "youtube",
  "caption_reviewed": false,
  "scheduled_at_jst": null,
  "scheduled_at_utc": null,
  "delivery_mode": "automatic",
  "provider": "buffer",
  "buffer_post_id": null,
  "public_post_url": null,
  "state": "draft"
}
```
このJSONは構造例であり**実投稿を指示しない**。

## 導入時の重要な制約
- Buffer Free: 接続最大3チャネル、各チャネル同時予約10件、API 1キー・3,000リクエスト/30日。接続と公開の成功は個別検証が必須。
- Buffer APIは無料で使えるが、画像/動画を**直接アップロードできない**。公開到達可能・非失効URLが予約公開まで必要。Google Driveの一般的な共有URLでは失敗しやすい。将来R2/Cloudinary検討時は「正式MASTERを公開しない」「課金承認」を守る。
- Buffer UIからの初期アップロードが先。APIによる媒体別配信は、動画保存先、Bufferアカウント接続、APIキーのSecret安全保管、OAuth許諾と実際の予約成功確認後。
- YouTube Shortsは長編動画の公式投稿器ではない。長尺YouTubeはYouTube Studioで管理し、公開済み動画から短尺を作成する方式を使う。情報解説チャンネルのノウハウと物語ショート動画は混ぜない。
- noteはMIRROR本編正本の確認を必須とし、記事変更/マガジン移動/公開をAIが勝手にしない。
- 実投稿結果不明なら状態needs_review、Provider Idと公開URLを分ける。単純なBrowser Automationで多数アカウントをログインし直して投稿する方式は脆弱であり、規約・2FA・UI変更リスクが高い。
- AI生成キャプションはユーザーの声/文体を尊重し、台本を投稿前に固定する。

## 最短ロードマップ（開始条件あり、期限保証はしない）
1. Buffer無料アカウントに本人がログイン、最初の3SNSを接続。クレカ・有料契約不要。
2. **正式QA済み1本**をBuffer UIでYouTube Shortsに Automatic予約→投稿成功のURLを確認。
3. 同じ動画をReels/TikTok向けにQAし、Automatic/通知方式を明示して予約→SNS URL確認。
4. 公開実績と各SNS文面の実験を開始。失敗/反応の悪い媒体は改善し、未確認媒体へ無条件量産しない。
5. 将来の独立Social OSへBuffer公式GraphQL APIの読み取り専用連携。安全にテストを通した後、承認済み予約の自動書き込みを追加。
6. 成果がある場合のみ有料チャネル追加・Claude固有の追加契約・サーバー費を比較判断。

## 検証済み公式資料
- https://support.buffer.com/en-us/articles/what-is-buffers-api-GtIYIQilz5
- https://buffer.com/pricing
- https://support.buffer.com/en-us/articles/troubleshooting-buffers-api-VgBuQXUCDI
- https://support.buffer.com/en-us/articles/troubleshooting-video-uploads-in-buffer-LK0CldlFNB
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
