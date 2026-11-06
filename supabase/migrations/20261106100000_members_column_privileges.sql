-- =============================================================
-- members の列ごとの読み取り権限（2026-11-06）
--
-- 背景:
--   members_select_anyone（deleted_at is null）で、未ログイン（anon キーはアプリに埋め込まれ公開）でも
--   28列すべてを全会員分まとめて読める状態だった。本名・メールは別テーブル／Auth 側にあるが、
--   通知の設定・最終アクセス日時・運営かどうか・登録経路・認証方式まで誰でも取れた。
--   GMO の不正アクセス、マネーフォワードの GitHub 流出（2026）を受けた点検で是正。
--
-- 方針:
--   ・行の条件（RLS）は変えない。列の権限（GRANT ... (列)）で絞る
--   ・未ログイン（anon）: 公開プロフィールとして画面に出している列だけ
--   ・ログイン会員（authenticated）: 上に加えて、画面・ポリシーが使う列。
--     通知設定・公開設定・認証方式・サブジェクトハッシュは本人にも RLS 経由では読ませない
--     （本人の画面はサーバー側がサービスロールで読む: src/lib/supabase/service.ts）
--   ・service_role は変更なし（全列）
--   ・INSERT/UPDATE の権限は変えない（本人の行の更新はこれまでどおり）
--
-- 確認済み:
--   ・RLS ポリシーが members の列を参照するのは tier / admin_role / deleted_at / id のみ（authenticated に残す）
--   ・is_admin など補助関数はすべて SECURITY DEFINER（列権限の影響を受けない）
--   ・ビュー・invoker 関数で絞る列を参照するものは無い
-- =============================================================

revoke select on public.members from anon;
revoke select on public.members from authenticated;

grant select (
  id, display_name, avatar_url, avatar_position, avatar_zoom,
  tier, residency_type, interests, preferred_activity_forms, preferred_activity_areas,
  self_introduction, skills_text, officer_role, ranking_opt_in,
  deleted_at, created_at
) on public.members to anon;

grant select (
  id, display_name, avatar_url, avatar_position, avatar_zoom,
  tier, residency_type, relation_type, interests, preferred_activity_forms, preferred_activity_areas,
  self_introduction, skills_text, officer_role, ranking_opt_in,
  contact_permission, collaboration_consent, residence_verified_at,
  admin_role, last_active_at, signup_source, show_footprints,
  deleted_at, created_at, updated_at
) on public.members to authenticated;

comment on column public.members.contact_preferences is
  '通知の希望（jsonb）。2026-11-06 から anon/authenticated は SELECT 不可。本人の画面はサービスロールで読む';
comment on column public.members.public_settings is
  '項目別の公開範囲（jsonb）。2026-11-06 から anon/authenticated は SELECT 不可';
