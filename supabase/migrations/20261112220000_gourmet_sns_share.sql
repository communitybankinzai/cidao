-- 食レポマップ：登録した人が「CBIのSNSで紹介してよい」に同意したかを持つ（2026-11-12 事業主決定）
--   sns_ok = true の食レポだけ、SNS 告知の下書き（sns_post_logs・target_type='gourmet'）を作る。
--   下書きは常に承認制（全自動モードでも運営が承認するまで配信しない）。
alter table public.gourmet_reports add column if not exists sns_ok boolean not null default false;

comment on column public.gourmet_reports.sns_ok is '登録した人が「CBIのSNSで紹介してよい」に同意した（同意つきだけ SNS 告知の下書きを作る）';

-- SNS 告知の対象に食レポを足す
alter type public.sns_target_type add value if not exists 'gourmet';
