# FreeFree × OpenPOI 一括登録

最終更新: 2026-10-02

地域の店舗・施設を OpenPOI API から取り込み、運営が確認してから FreeFree に登録する機能。

## 流れ

OpenPOI 取得 → 整形 → 重複判定 → `freefree_import_candidates`（候補）→ 運営が確認・修正 → FreeFree 投稿として公開

取得しただけでは何も公開されない。公開は運営が選んだ候補だけ。

## 画面・主要ファイル

- 管理画面: `/admin/freefree/openpoi`（committee / super のみ。`FreeFree掲示板の管理` からもリンク）
- `src/lib/freefree-import-core.ts`: 純粋ロジック（正規化・重複判定・カテゴリー変換・bbox分割取得・投稿内容の組み立て）。他モジュールを import しない
- `src/lib/openpoi.ts`: OpenPOI API クライアント（サーバー専用）
- `src/app/admin/freefree/openpoi/actions.ts`: 取得(Dry Run/保存)・編集・除外・登録の Server Actions
- `src/app/freefree/_components/OpenpoiAttribution.tsx`: 出典表示（FreeFree詳細・管理プレビュー共通）
- migration: `supabase/migrations/20261002100000_freefree_openpoi_import.sql`（**適用は手動**。冪等）
- テスト: `npm test`（vitest。`src/lib/__tests__/freefree-import-core.test.ts`）

## OpenPOI API の実際の仕様（2026-10-02 公式ドキュメントで確認）

- 認証不要。`GET https://api.openpoiapi.com/v1/search`（`q` / `center`+`radius` / `bbox` / `limit` 1〜200）、`/v1/suggest`
- **ページ送り（offset）は無い**。1回200件まで → 件数が200に達した範囲を4分割して再検索する（`collectByBbox`）
- **固有IDは無い**。`source_id` は「正規化した名称＋座標（小数5桁）」のハッシュ（`opoi-…`）
- **電話・URL・営業時間は返さない**。候補の `phone` / `website` / `opening_hours` は運営が詳細画面で補う欄
- レート制限は API 全体で定常200req/s。利用者ごとの制限なし（同時4本・波ごとに100ms空けて取得）
- 商用利用可。保存可（`licenses` / `attributions` を配列のまま保存）。**画面に出すときは「OpenPOI API」を出典として記載し https://openpoiapi.com/attribution.html へリンク**、加工して公開する場合は加工した旨と主体を記載

## 安全設計

- 候補・履歴テーブルは RLS で committee / super のみ
- Dry Run は DB に一切書かない（取得件数・新規候補・重複・未分類・登録予定件数だけ返す）
- 重複判定は `none / possible / duplicate`。自動マージはしない。`duplicate` は明示チェックが無いと登録できない
- カテゴリー未分類（`category IS NULL`）は、運営が選ぶまで登録できない
- 二重登録防止: `import_status` を条件にした UPDATE で `publishing` を取れた1回だけが進める＋ `freefree_post_id` の一意インデックス
- 登録は25件ずつのチャンクで実行し、チャンクごとに成功/スキップ/失敗を表示。途中で失敗してもそこまでの結果が残る
- 取込投稿は `sns_share=false`、メンバーへの新着通知なし。投稿者は操作した運営本人の個人掲載（`poster_type='member'`）として作成
- 既存の `freefree_posts` 行は変更しない（列追加のみ）
- 運営が編集した内容は `edits` に別保存。OpenPOI の再取得では上書きされない。登録済み/編集済みの候補にOpenPOI側の更新があれば `update_available` の印と差分だけ付ける

## 既知の制約

- 掲載終了日（最長3か月先・初期値は3か月先）を過ぎると FreeFree 側の既存の仕組みで非公開になる。登録時は `period=p_until_date`・`expires_at` は終了日の23:59:59(JST)
- `publishing` のまま止まった候補（登録処理中にプロセスが落ちた場合）の自動復旧は無い。FreeFree 側に掲載が無いことを確認してから DB で `failed` に戻す
- 名称か座標が変わるとハッシュが変わり、OpenPOI側の更新ではなく「別の施設」として現れる（重複判定が `possible` で拾う）
- Dry Run の連打防止はインスタンス単位（best-effort）。通常取得は `freefree_import_runs` を使う

## 地図・位置情報の出典（2026-10-03 規約確認）

- **地理院タイル**（画像カードの地図）: 国土地理院コンテンツ利用規約。営利・非営利の区別なし・申請不要（ウェブでその場で読み込む場合）。出典として「国土地理院」または「地理院タイル」と書き、[地理院タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)へのリンクを付け、加工したことも書く。画像にはリンクを付けられないので、SNS の投稿文に `gsiCreditLine()` の1行を添える。
- **国土地理院の住所検索**（`msearch.gsi.go.jp`・FreeFreeのお店ピンの住所→座標）: 国土地理院自身の規約は無い。中身は東京大学CSISの「シンプルジオコーディング実験」で、商用を禁じる条文は無いが、提供の保証がなく無断で停止・制限することがある。地図等に使うときは「CSISシンプルジオコーディング実験（街区レベル位置参照情報）による」の表記が求められる（`GEOCODE_CREDIT`）。メタバース（cbi-site）でお店ピンを表示する画面にも、この表記が必要。
- 取込掲載の座標は OpenPOI のもの（住所検索は使っていない）。住所検索を使うのは、お店が自分でピンを出すとき（`createFreefreePost`）だけで、登録時に1回だけ変換して保存する。
- 有料化する場合は、国土地理院への確認（測量法に基づく承認の要否）と、住所検索に依存しない手段（運営が地図で位置を決める等）を用意しておく。
