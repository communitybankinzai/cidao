-- =============================================================
-- 書き込み操作のIPアドレス記録（audit_logs の実運用開始）
--
-- 背景:
--   悪質な投稿があっても、投稿者の手掛かりが会員ID・LINEアカウント識別子・
--   表示名しかなく、退会されると追跡できなかった。
--   audit_logs テーブルは初期スキーマから存在するが一度も使われていない。
--
-- 決定事項（2026-08-08、CBI側の判断）:
--   ・生のIPアドレスを保存する（ハッシュでは発信者特定に使えないため）
--   ・保存期間は90日。超えた行は pg_cron で自動削除する
--   ・記録対象は書き込み操作（他人の目に触れる内容を作る操作）のみ。
--     閲覧だけの利用者のIPは記録しない
--
-- ⚠ 前提:
--   利用規約 第6条の利用目的は「①マッチング ②運営からの連絡 ③匿名化統計」の
--   限定列挙で、IPアドレスの記録は含まれていない。
--   規約を改定し、ログイン画面の TERMS_VERSION を上げて再同意を得ること。
--   （このマイグレーション単体では規約要件を満たさない）
--
-- RLS:
--   INSERT ポリシーは作らない＝書込は service_role のみ（既存方針を踏襲）。
--   SELECT は既存の audit_select_self（本人）と audit_select_admin（運営）のまま。
-- =============================================================

alter table public.audit_logs
  add column if not exists ip         inet,
  add column if not exists user_agent text;

comment on column public.audit_logs.ip is
  '書き込み時の送信元IPアドレス（生値）。90日で自動削除。利用規約に基づき取得。';
comment on column public.audit_logs.user_agent is
  '書き込み時の User-Agent。端末・ブラウザの特定補助。90日で自動削除。';

-- 90日を超えた行の削除。監査目的でも必要最小限にとどめる
create or replace function public.cleanup_old_audit_logs()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.audit_logs
   where timestamp < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'cidao_audit_cleanup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'cidao_audit_cleanup',
  '0 1 * * *',  -- 毎日 1:00 UTC = JST 10:00
  $$select public.cleanup_old_audit_logs();$$
);
