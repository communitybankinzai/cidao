# Phase 3 実装報告（プロフィール生成・版管理・公開承認・人材バンク表示）

実施日: 2026-09-15。対象: `C:\Repos\cidao-talent`（`feature/talent-bank-phase1`）。
実装: Codex（gpt-6-astra）。Codex は実装と自己検証（tsc 0・vitest 0・eslint 0）の直後に ChatGPT の利用上限で停止し、本報告書は未作成だった。以下は Claude がコードを読み、検証を再実行してまとめたもの。

## 実装した内容

- **プロフィール生成**（`src/lib/talent-bank/profile/generate.ts`）：インタビュー `done`＋`profile`・`external_ai` の同意を確認 → `callAI(extract_profile)` で短い紹介（80字）・詳しい紹介（400字）・20項目の整文 → **`collected_json` で `answered` でない項目の値は捨てる**（`groundedFields`。state・evidence・source は AI に決めさせない）→ `callAI(generate_tags)` で既存タグ slug の enum から選択、未登録は `suggested_tags` に退避 → RPC `save_talent_draft` で新版（draft）を保存。
- **本人の確認・修正**（`review.ts`、`/me/talent`）：短い紹介・詳しい紹介・各項目の状態（回答／該当なし／答えない／未回答）と値・タグ・公開範囲を編集。編集した項目は `source:'owner'`。「公開を申請」で `owner_reviewed`。必須 8 項目が `unknown` なら申請不可（`none`／`declined` は可）。公開中の版は不変で、「新しい版を作って編集」で複製する。
- **運営承認**（`publish.ts`、`/admin/talent-bank`）：`owner_reviewed` の版一覧 → 「承認して公開」（確認にかかった分数を必須入力、修正回数は `edited_by_owner_at` の有無で 0/1）→ RPC `publish_talent_version` が旧版 retired・`current_version_id` 更新・`publications` 記録・`work_logs`（kind `profile_review`）記録を1トランザクションで実施。「差し戻し」は理由必須で draft へ戻す。本人・運営の「公開停止」あり。承認・差し戻し・停止で本人へアプリ内通知（メールは送らない）。
- **表示・検索**（`read.ts`、`/talent`、`/talent/[id]`）：published 版があれば新プロフィールを優先表示、無ければ従来の `member_profiles_pr`。一覧はキーワード（表示名・紹介・タグ・同義語の `ilike`）・タグ・活動地域で絞り込み。可視性は RLS と security invoker の RPC `search_talent_profiles` に委ね、アプリ側で二重フィルタしない。
- **DB**（`supabase/migrations/20260915150000_talent_bank_phase3.sql`）：`talent_profiles`／`talent_profile_versions`／`talent_tags`／`tag_synonyms`／`talent_profile_version_tags`／`publications`。RLS：本人・運営・公開条件。**トリガーで REST 直接更新も防御**（`guard_talent_version`：本人は draft／owner_reviewed 以外に変更不可、承認列を書けない、内容を変えると draft に戻る。`valid_talent_fields`：20 キー固定・連絡先キー不可・evidence は UUID のみ）。pg_trgm の GIN を紹介文とタグ label に作成。初期タグ 20 件＋同義語 6 件。
- 完了後の案内（Claude 追加・2026-09-15 中司さんの実機フィードバック「インタビューが終わった後どうすればよいか分からない」への対応）：まとめ欄に次の 4 ステップを明示し、「プロフィール案を作る」をまとめの直下に配置。

## 変更ファイル

既存の変更：`src/app/admin/page.tsx`（カード 1 枚）、`src/app/talent/[id]/page.tsx`、`src/app/talent/interview/page.tsx`、`src/app/talent/page.tsx`、`src/lib/talent-bank/types.ts`、`src/app/talent/interview/_components/InterviewChat.tsx`（完了案内）。
新規：`supabase/migrations/20260915150000_talent_bank_phase3.sql`、`src/lib/talent-bank/profile/{access,generate,publish,read,review,validation}.ts`、同 `__tests__/{mock-db,profile.test}.ts`、`src/app/me/talent/{page,actions}.tsx|ts`、同 `_components/{ActionForm,GenerateForm,ProfileContent}.tsx`、`src/app/admin/talent-bank/{page,actions}.tsx|ts`、本報告書。

## 検証（Claude・2026-09-15）

| コマンド | 結果 |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 10 ファイル・122 件合格（Phase 1・2 の 81 件＋Phase 3 の 41 件） |
| `npx eslint <変更・追加ファイル>` | exit 0 |
| マイグレーションのドライラン（本番 DB・ロールバック） | 成功 |
| `next build` | 本報告書のコミット後に本体リポジトリで実行（結果は worklog に記録） |

## 実 DB で確認すべき RLS の観点（Codex 未実施・Claude が適用後に確認）

1. anon が `talent_profiles`／`talent_profile_versions` を読めるのは `public_scope='public'` かつ published の版だけか。
2. ログイン会員が `registered_only` を読め、`private` は本人のみか。
3. 本人が `talent_profile_versions.status` を `published` に直接 UPDATE できないか（トリガーで拒否されるか）。
4. `search_talent_profiles` が anon で public のみ返すか。

## 未解決・仮定

- 同意文は「要法務監修・仮文面」のまま。
- 実ブラウザでの通し確認（生成 → 修正 → 申請 → 承認 → 公開）は中司さんの実機で行う。
- タグ辞書の追加・同義語の管理画面は Phase 8。
- 修正回数は「本人が1回でも編集したか」の 0/1（詳細な回数は Phase 8 で `work_logs.edit_count` を拡張）。
- 表示名は版の `display_name` を優先し、無ければ `members.display_name`。

## API 費用への影響

実装・検証で 0 円。運用時はプロフィール生成 1 回につき `callAI` が 2 回（抽出＋タグ、いずれも Sonnet 5）。

## Phase 4 で行うこと

写真アップロード（EXIF 除去・非公開バケット・`face_mode`）、動画ジョブと GitHub Actions レンダラー（VOICEVOX Docker・FFmpeg）、本人承認・運営承認、イラスト化画像の差し替え欄（案 D）。
