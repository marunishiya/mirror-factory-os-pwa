# PROJECT MIRROR｜Buffer先行稼働方針（2026-10-18）

状態：**ユーザー採用済み／Bufferアカウント接続・実SNS予約投稿は未実施**。

## 決定と保護
- 目的は「スマホから予約→指定時刻の自動公開→SNS上の公開URLを確認」。DRY-RUNやAPI認証設定だけでは完成と呼ばない。
- 第1段階はBuffer Freeを利用し、YouTube Shorts、Instagram Reels、TikTokの3チャネルをSNS公式OAuthでBufferに接続。各チャネル10件までの同時予約、合計30件の範囲で運用。
- 既存のPROJECT MIRROR PWA、main、正式MASTER、ブラウザ保存領域、D1、Worker、バックアップ、ドラフトPR #1/#2/#5/#6を改変・削除・無断マージしない。独自API接続の**新規開発は一時停止**するが既存資産を保護。
- 本番SNS投稿・Cloudflareデプロイ・有料プラン契約・課金は明示的承認があるまで実施しない。
- 登録用メールアドレスの選択・サインイン・YouTube/Instagram/TikTokのOAuth許可はアカウント所有者が行う。パスワード・SNSトークンをGitHubやチャットに記録しない。

## すぐ動かす作業
1. 公式 https://login.buffer.com/signup からBuffer無料プランに登録（既存アカウントがあればサインイン）。クレジットカードは不要。支払画面に進まず、Freeを確認。
2. https://account.buffer.com/channels からYouTube（**チャンネル所有者として**接続）、Instagram BusinessまたはCreator、TikTokの順に接続。最初はYouTubeだけでも可。
3. QA済みで公開承認済みの縦型動画1本と投稿本文を選択。公開していないMASTER・試作品は使用しない。
4. 全媒体で予約画面の「Automatic」設定を必ず確認。「Notify Me」や橙色の電話アイコンの投稿は自動公開ではない。事前アップロードされた音源・権利確認済みの動画を利用する。
5. 指定時刻に公開されたURLをSNSで確認し、BufferのSent履歴、SNS表示、予定時間、例外・失敗を記録。実証前は運用完了と報告しない。

## 各社の基本制約
- YouTube Shorts: 1本・最大3分、推奨9:16。YouTube標準ライブラリの音源を後付けする場合などは通知方式に切替。Buffer FAQ: https://support.buffer.com/articles/using-youtube-shorts-with-buffer-Jl8iR6jIck
- Instagram Reels: Business/Creatorアカウントが必要。動画仕様に外れると通知方式となる場合あり。 https://support.buffer.com/en-us/articles/scheduling-instagram-posts-reels-stories-and-notifications-3XA98S9Q5p
- TikTok: AutomaticとNotify Meを区別。トレンド音源、アプリ特有のエフェクト等は通知方式が必要な場合あり。 https://support.buffer.com/articles/using-tiktok-with-buffer-oGEroY9Of2
- 無料プラン: https://buffer.com/pricing （2026-10-18確認）。新規3チャネル、各10件の予約同時保持。
- 自社管理画面への将来の連携: https://buffer.com/api 。無料でもBuffer API（GraphQL）利用可能。SNS APIの独自実装より先に、Bufferアカウントと媒体の接続・1本の実公開実証を優先する。

## 完成条件と次フェーズ
Phase 1 PASS: 1媒体以上の「Automatic」予約が実際に指定時刻に投稿され、公開URL・Buffer結果が照合できる。
Phase 2 PASS: Shorts/Reels/TikTokの3媒体すべてで実投稿を確認。
Phase 3: 承認済みコンテンツのみをMIRROR Factory OSからBuffer公式API経由で予約する、投稿ID・エラー・二重登録防止・公開結果収集を追加。認証鍵はサーバー秘密情報で管理。実行コードは別ブランチ・テスト・明示承認後に導入。
