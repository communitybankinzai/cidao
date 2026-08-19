# 災害MAP向けSNS巡回 引継ぎ

最終更新: 2026-08-19

このリポジトリは、印西市災害状況整合MAPのSNS自動巡回バックエンドも提供する。MAP側の詳細な引継ぎは `C:\Users\nsfactory\OneDrive\CBI\site\inzai-disaster-map\CLAUDE_HANDOFF.md` を参照。

## 公開・実装状態

- 本番: https://cidao.vercel.app
- API: `GET/POST /api/disaster/sns-monitor`（GETは検索ルール一覧も返す）／`GET /api/disaster/inzai-shelters`（印西市公式避難所55施設・防災速報照合つき）
- 実装コミット: `da6c46d` → `429e717`（避難所API＋検索ルール管理UI）
- 検索ルールの編集は `/admin/sns` の「災害SNS巡回の検索語」（媒体ごと1行1語・各12件・2〜50文字）。Facebookは公開投稿検索APIがないため自動巡回対象外（MAP側の手動検索＋URL登録で補完する仕様）。
- `npm run build`成功、本番GET `200`、GitHub Pages OriginのCORS `204`を確認済み。
- Supabase migration `20260816100000_disaster_sns_monitor.sql` は本番適用済み。
- `pg_cron`から5分ごとに固定検索語を巡回し、候補は自動公開せずレビュー待ちで保存する。

## 主要ファイル

- `src/lib/disaster-sns-monitor.ts`: Threads、Instagram、Blueskyの検索・絞込・保存。
- `src/app/api/disaster/sns-monitor/route.ts`: 日付別公開読取、巡回起動、CORS。
- `src/app/admin/sns/actions.ts`: Threads検索権限の確認、Instagram検索専用認証・Bluesky検索用認証（App Password）の検証・保存。
- `src/app/admin/sns/_components/SnsAuthSettings.tsx`: `/admin/sns`の検索用認証UI。
- `supabase/migrations/20260816100000_disaster_sns_monitor.sql`: テーブル、RLS、scan claim、cron、cleanup。

## DBとAPI契約

- `disaster_sns_monitor_rules`: platform、query、enabled、last_scanned_at、status/error。
- `disaster_sns_candidates`: 投稿本文、元URL、写真URL、投稿時刻、候補位置、review_status、raw payload。
- `disaster_sns_scan_runs`: 実行時刻、成功/partial/failed、プラットフォーム別結果。
- GETは`?date=YYYY-MM-DD`の日本時間1日分だけを返し、dismissedは除外する。
- POSTは任意検索語を受け付けず、DBの固定ルールだけを実行する。4分のatomic claimで過剰起動を防ぐ。

## 現在のSNS状態（2026-08-19時点：3媒体すべて稼働中）

- Bluesky: 稼働中（認証付き検索）。`api.bsky.app`の未認証`searchPosts`は2026-08から403（HTML応答）で拒否されるため、`/admin/sns`で登録したApp Password（`sns_bluesky_search_auth`）でPDS（`bsky.social`）経由の認証付き検索に切替済み（コミット`f38a0ae`）。セッションは`sns_bluesky_search_session`に60分キャッシュし、`refreshSession`で延命・失敗時は`createSession`で再ログイン・401時はキャッシュ破棄して次回巡回で自己回復する。App Passwordをbsky.app側で削除すると巡回が失敗するので、その場合は`/admin/sns`で再登録する。
- Threads: 稼働中。検索専用Threadsアプリのトークン（`sns_threads_discovery_auth`）で`keyword_search`成功。投稿用トークンとは分離。
- Instagram: 稼働中。Facebook Login方式のプロアカウントID＋ハッシュタグ検索権限付きユーザートークン（`sns_instagram_discovery_auth`）を設定済み。投稿用Instagram Loginトークンとは分離。
- 各SNSのHTMLエラー応答（非JSON）はHTTPステータス付きで`last_error`に記録される（「Unexpected token '<'」問題は解消済み）。
- Bluesky上の印西関連アカウントはごく少数（市公式なし。市公式SNSはX・LINE・Instagram・YouTube）。巡回は低コストで維持するが、拾える投稿は少ない想定。
- コメント本文の自動取得は未実装。現状の巡回候補は投稿本文中心で、コメントはMAP側の手動登録・場所確認フローで補う。

## 次に行う場合の優先順

1. 管理者向け候補レビュー画面とaccepted/dismissed更新APIを作る。
2. MAP記録の共有保存、利用登録者認証、組織別権限、監査ログをSupabaseで実装する。
3. rate limit、失敗通知、トークン失効通知を追加する。

## 安全上の要件

- SNS投稿は未確認候補として扱い、自動で公的情報や救助要請として公開しない。
- 位置・写真・個人情報は承認前に公開しない。救助関連は110/119の代替にしない。
- 監視APIに任意クエリ実行やservice role情報を公開しない。
