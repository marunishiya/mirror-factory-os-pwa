> 更新: 本PRにはYouTube専用のOAuth・動画転送・公開予約・スマホ画面を追加しました。以下は追加実装前に確認した旧v0.4の原因記録です。現在の実装範囲・本番設定・制約は cloudflare-worker/YOUTUBE_SETUP_JA.md を参照してください。新規21件と既存29件の計50テスト、旧監査2チェックがローカルで通過。Wrangler 4.151.1の deploy --dry-run は終了コード0で成功。本番配備・実OAuth・実投稿は未実施です。旧手動ActionsはZIP解凍を廃止し通常ソースを検証するよう修正しましたが、新しいYouTube配備を自動実行する経路は追加していません。\n\n# MIRROR SOCIAL ENGINE 原因調査・改善記録
確認日: 2026-10-16（日本時間）

## 結論
既存v0.4は予約処理の模擬実行専用であり、YouTubeへの実投稿システムは未実装。
本PRは既存ZIPの展開と調査結果の記録のみ。実投稿機能の完成や本番配備を意味しない。

## 現物確認した原因
1. src/dryrun.js: validation()がmode !== 'dry_run'をlive_publishing_disabledで拒否する。
2. processDue()はジョブをsimulatedにするだけ。YouTube OAuth、動画アップロード、公開日時の送信処理はない。
3. wrangler.jsoncにtriggers/cronsの定義なし。既存のCloudflare管理画面に手動設定されたCronの有無は未確認。
4. social-v05.htmlは配信案をlocalStorageへ保存しJSONを出力する。Workerへの予約登録・動画転送は未実装。
5. フロントの出力は{campaignId,mode,qaApproved,targets:[...]}。Worker POST /jobsは単一platform/title/caption/runAtUTC/assetRefを要求する。直接送信しても互換でない。出力targetsには動画参照assetRefもない。
6. WorkerのADMIN_TOKENが32文字以上でなければ予約APIは503で閉じる。ユーザー提供の本番設定画像では変数・シークレット一覧が空だった。
7. 現行Actionsはvalidate/bootstrap/dry-runのみ。validateはコンパイルのみでデプロイしない。bootstrap/dry-runもSNS投稿をしない。

## 確認済みの本番情報（ユーザー提供画像）
- mirror-social-schedulerが存在。現バージョン表示34a19913、トラフィック100%、配備は「2日前」。
- 公開ルートの応答はHello World!。これだけでscheduledハンドラの内容は判断しない。
- D1バインディング名DBが存在。設定画面では接続先DB名は未確認。
- 環境変数・シークレット一覧は空。
- D1の現物スキーマ、Cronの管理画面設定、実際の稼働ログは未確認。
- ZIP設定ではDBはmirror-social-dbを指定しているが、本番の接続先が同一かは未確認。

## 実行した検証
npm --prefix cloudflare-worker test
- dryrun: 23/23 PASS
- bootstrap: 6/6 PASS
- scripts/audit.mjs: 2チェックPASS（設定一致、Cron/APIトークンなし）
- 合計29のユニットテストと2監査チェックを通過。
これらはDRY-RUNの安全性検証であり、実投稿成功の証明ではない。
Cloudflare接続、Wranglerでのコンパイル、実SNS API、実動画アップロードのテストは行っていない。

## 開発接続の改善
現在のGitHub接続ユーザーはmarunishiya。権限表示adminを取得した。
本ブランチへのファイル作成に成功し、書込み可能であることを実確認。
以前のprojectmirrorai-gifの読み取り専用状態は現在のこのGitHub接続には当てはまらない。
これはCodex Cloudの環境作成・接続状態の確認とは別。

## 次の実装順序と完了条件
1. YouTube専用の投稿方式を決める。動画を事前アップロードしてYouTube側へ公開予約を登録する方式をまず検討。時刻到達時にアップロード開始する設計とは分ける。
2. 正しいチャンネルを選ぶOAuth、秘密情報のサーバー保管と更新、失効時の停止を実装。
3. 動画本体の安全な保管・転送経路を実装。ブラウザローカル参照のみで完了扱いにしない。
4. フロントとWorkerのリクエスト形式を揃え、ジョブ状態を予約済み/処理中/YouTube登録済み/失敗/要確認に分ける。
5. D1の既存スキーマと照合。重複登録防止、通信結果不明時の照合、再試行、キャンセル、JST/UTCを検証。
6. 必要な場合にCronを設定し、実行ログと失敗通知を確認。Cronがあれば実投稿済みとは扱わない。
7. 認証済みチャンネル、対象動画、タイトル、日時、費用、本番変更内容をレビュー可能にし、ユーザーの明示承認後に配備・予約する。
8. 予約IDとYouTube側の公開予定日時を読み取りで照合して初めて「予約完了」とする。

## 変更範囲
既存mirror-worker-code-v04.zipの8ファイルをcloudflare-worker/へ内容を変えず展開。
既存ZIP、main、index.html、social-v05.html、sw.js、ブラウザ保存データ、MASTER/Canonを変更していない。
配備、D1本番書込み、Cron変更、SNS投稿、課金は行っていない。
