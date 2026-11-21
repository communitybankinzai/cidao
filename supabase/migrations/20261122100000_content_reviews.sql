-- =============================================================
-- content_reviews — 投稿の自動類別と、運営の審査の記録（2026-11-22）
--
-- 背景: 催し・FreeFree・団体の紹介・提案・コメントは、投稿するとすぐ公開される。
--       AI が投稿を読み、問題のありそうなものだけを運営の審査に回す。
--   verdict
--     ok     = 問題なし（この表には行を作らない。費用の記録は api_usage に残る）
--     notify = 公開したまま運営に知らせる（政治・宗教・しつこい勧誘、または確度が高くない重い区分）
--     hold   = 自動で公開を止めて審査へ（確度が高い重い区分）。止める前の状態を prev_state に残す
--     error  = 類別できなかった（AI の障害・上限・時間切れ）。投稿は止めない。運営の一覧で分かるように残す
--   status
--     open    = 運営の確認待ち
--     cleared = 「問題なし」とした（止めていれば公開に戻した）
--     removed = 非公開にした／コメントを削除した
--
-- 本文全体は保存しない（title_snapshot は題名か先頭60字だけ）。
-- 読み書きは service_role だけ（運営の画面は、権限を確かめたうえでサーバーから読む）。
-- 2026-10-30 以降の新テーブルは Data API の権限が自動で付かないため、ロール分を明示する。
-- =============================================================

create table if not exists public.content_reviews (
  id             uuid primary key default gen_random_uuid(),
  -- 投稿は削除されうるので FK は張らない（消えたあとも記録を残すため）
  target_type    text not null check (target_type in ('event', 'freefree', 'freefree_comment', 'org', 'proposal', 'proposal_comment')),
  target_id      uuid not null,
  -- コメントのときの親（FreeFree の掲載 id／提案 id）。運営の画面から元の投稿へ飛ぶために使う
  parent_id      uuid,
  action         text not null check (action in ('create', 'update')),
  author_id      uuid references public.members(id) on delete set null,
  verdict        text not null check (verdict in ('ok', 'notify', 'hold', 'error')),
  categories     text[] not null default '{}',
  confidence     text check (confidence is null or confidence in ('high', 'mid', 'low')),
  reason         text,
  title_snapshot text,
  held           boolean not null default false,
  -- 止める前の状態（元に戻すときに使う）。催しは {status, ids?}、FreeFree は {status}、団体は {public_flag, hidden_by_admin, hidden_reason, hidden_at}、提案は {status}
  prev_state     jsonb,
  status         text not null default 'open' check (status in ('open', 'cleared', 'removed')),
  model          text,
  decided_at     timestamptz,
  decided_by     uuid references public.members(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_content_reviews_target
  on public.content_reviews(target_type, target_id);

create index if not exists idx_content_reviews_open
  on public.content_reviews(created_at desc)
  where status = 'open';

alter table public.content_reviews enable row level security;

-- ポリシーは作らない（service_role だけが読み書きする）
revoke all on public.content_reviews from anon;
revoke all on public.content_reviews from authenticated;
grant all on table public.content_reviews to service_role;

comment on table public.content_reviews is
  '投稿の自動類別と運営の審査の記録。notify・hold・error だけを作る。service_role のみ。本文は保存しない';
