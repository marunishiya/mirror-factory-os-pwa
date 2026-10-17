# PROJECT MIRROR | GitHub OSS調査・採用記録（2026-10-16）

## 恒久ルール
PROJECT MIRROR独自SNS自動投稿システムで機能が不足したら、ChatGPT/CodexはまずGitHubの公開実装を調査し、**公式・ライセンス・更新状況・Cloudflare Worker互換性・費用・SNS規約・回帰テスト**を評価してから導入する。
GitHub Star数だけで採用しない。作業履歴と採否理由をPRに残す。既存MASTER・PWA・保存データを変更しない。

## 今回調査した候補
| リポジトリ | 評価 | 採用判断 |
| --- | --- | --- |
| [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk) | Cloudflare公式、Apache-2.0、継続更新。Wrangler/Miniflare/D1ローカル動作とテスト参照 | **テスト方式を採用済み**：`wrangler d1 execute --local`で一時的なテストDBを作り、`wrangler dev --local`にHTTPを送り実D1相当のSQL経路を確認。コードの丸ごとコピーはせず公式CLIを利用 |
| [bluesky-social/atproto](https://github.com/bluesky-social/atproto) | 公式AT Protocolリファレンス実装、継続更新。新規利用では`@atproto/lex`推奨 | **仕様参照**。現行のBluesky接続は依存ゼロのXRPC直接呼出しを維持。OAuth・画像・動画追加時に必要性を再審査。ライセンスはパッケージ単位で再確認 |
| [neet/masto.js](https://github.com/neet/masto.js) | MIT、Mastodon向けクライアントSDK、最近も保守 | **今回は依存導入見送り**。現行の単一テキスト投稿エンドポイントは少量の標準`fetch`で足りるため、依存と費用を増やさない。メディアアップロード等で増える時に再検討 |
| [googleapis/google-api-nodejs-client](https://github.com/googleapis/google-api-nodejs-client) | Google公式、Apache-2.0、YouTubeのアップロード・OAuth例がある | **YouTube実装の参考**。Node向けの`fs.createReadStream`はCloudflare Workerにそのまま移植不可。動画アップロードはWorkers互換のOAuth/再開可能アップロード、素材の安全な一時保管とAPI審査が必要。未導入 |
| [cloudflare/workers-sdk D1 Vitest examples](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-plugin-examples/d1) | 公式D1 migrations/テスト例、対応ランタイムでSQL実行 | **後続候補**。現行CIのNode＋Wranglerで不足するDB並列・定期イベントの統合検証時に検討 |

## 今回導入したものと証拠
- テスト用ローカルD1設定 `cloudflare-worker/wrangler.local-test.jsonc` は実プロジェクトとは**異なるダミーのDB ID**を使用。GitHub Actionsで使う`--local`、一時データフォルダー、ダミー管理者トークンのみ。Cloudflare API認証情報を渡さない。
- `cloudflare-worker/test/schema.local-test.sql` は **テスト用仮スキーマ**。本番D1の実スキーマと一致する保証なし。本番マイグレーションには転用しない。
- `cloudflare-worker/test/local-d1.test.mjs` は`/health`、liveモード既定拒否、認証拒否、不正JSON、登録、重複防止、取得、キャンセル、再キャンセルを検証。
- GitHub Actions検証は `https://github.com/marunishiya/mirror-factory-os-pwa/actions/runs/38843045469` の **74 JS + 5 SQLite + 10 Cloudflare local D1** PASS。さらにWranglerの`--test-scheduled`を使ってCronイベントを模擬実行し、予定時刻到達ジョブがD1上で`queued`→`simulated`になることを確認。従来のWrangler `--dry-run` ビルド2種類も成功。

## 次に見つけるべき不足機能
1. YouTube/Instagram/TikTokの公式OAuthトークン管理・審査条件と**Workersで扱える動画アップロード**。SNSアカウントの正式連携前に実投稿成功を宣言しない。
2. コンテンツの保管：予約したMP4/画像を公開可能なHTTPSまたは媒体の指定するアップロード方式で受け渡す。非公開MASTERは公開しない。R2等の利用料金・シークレット・無料枠を確認し、ユーザー承認なしに作成しない。
3. Cloudflare Cronと本番D1実スキーマの読み取り専用確認。API Secretの登録・本番デプロイ・本番SNS投稿は明示承認ゲート。
4. D1イベント履歴と実SNS投稿IDの管理、配信後の確認、API制限、予期せぬ失敗時の重複投稿防止。

この文書は外部代行サービスの導入ではない。公式APIに直接アクセスするための自社システムを優先する。
