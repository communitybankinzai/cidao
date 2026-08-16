# 災害MAP向けSNS巡回 引継ぎ

最終更新: 2026-08-16

このリポジトリは、印西市災害状況整合MAPのSNS自動巡回バックエンドも提供する。MAP側の詳細な引継ぎは `C:\Users\nsfactory\OneDrive\CBI\site\inzai-disaster-map\CLAUDE_HANDOFF.md` を参照。

## 公開・実装状態

- 本番: https://cidao.vercel.app
- API: `GET/POST /api/disaster/sns-monitor`
- 実装コミット: `da6c46d`
- `npm run build`成功、本番GET `200`、GitHub Pages OriginのCORS `204`を確認済み。
- Supabase migration `20260816100000_disaster_sns_monitor.sql` は本番適用済み。
- `pg_cron`から5分ごとに固定検索語を巡回し、候補は自動公開せずレビュー待ちで保存する。

## 主要ファイル

- `src/lib/disaster-sns-monitor.ts`: Threads、Instagram、Blueskyの検索・絞込・保存。
- `src/app/api/disaster/sns-monitor/route.ts`: 日付別公開読取、巡回起動、CORS。
- `src/app/admin/sns/actions.ts`: Threads検索権限の確認、Instagram検索専用認証の検証・保存。
- `src/app/admin/sns/_components/SnsAuthSettings.tsx`: `/admin/sns`の検索用認証UI。
- `supabase/migrations/20260816100000_disaster_sns_monitor.sql`: テーブル、RLS、scan claim、cron、cleanup。

## DBとAPI契約

- `disaster_sns_monitor_rules`: platform、query、enabled、last_scanned_at、status/error。
- `disaster_sns_candidates`: 投稿本文、元URL、写真URL、投稿時刻、候補位置、review_status、raw payload。
- `disaster_sns_scan_runs`: 実行時刻、成功/partial/failed、プラットフォーム別結果。
- GETは`?date=YYYY-MM-DD`の日本時間1日分だけを返し、dismissedは除外する。
- POSTは任意検索語を受け付けず、DBの固定ルールだけを実行する。4分のatomic claimで過剰起動を防ぐ。

## 現在のSNS状態

- Bluesky: `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts`で巡回成功。
- Threads: 既存トークンでは`keyword_search`が500。`threads_keyword_search`権限を含む再認証が必要。
- Instagram: 投稿用Instagram Loginトークンを検索へ流用しない。Facebook Login方式のプロアカウントIDとハッシュタグ検索権限付きユーザートークンを`/admin/sns`で別登録する。現在未設定。
- コメント本文の自動取得は未実装。現状の巡回候補は投稿本文中心で、コメントはMAP側の手動登録・場所確認フローで補う。

## 次に行う場合の優先順

1. ThreadsとInstagramの検索権限を管理画面で設定し、実投稿を使って検索結果を検証する。
2. 管理者向け候補レビュー画面とaccepted/dismissed更新APIを作る。
3. MAP記録の共有保存、利用登録者認証、組織別権限、監査ログをSupabaseで実装する。
4. rate limit、失敗通知、トークン失効通知、検索ルール管理UIを追加する。

## 安全上の要件

- SNS投稿は未確認候補として扱い、自動で公的情報や救助要請として公開しない。
- 位置・写真・個人情報は承認前に公開しない。救助関連は110/119の代替にしない。
- 監視APIに任意クエリ実行やservice role情報を公開しない。
