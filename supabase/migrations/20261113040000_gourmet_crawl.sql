-- 食レポの SNS 巡回（2026-11-13 事業主決定 A案）。目的は「地域の飲食店の応援」。
-- 毎朝の Instagram の取得（#印西 のハッシュタグ・監視アカウント）が持っている本文を、その場で AI が読んで「候補」にためる。
-- 運営が /admin/gourmet で承認したお店だけ gourmet_reports に入る（自動公開しない）。本文は保存しない（重複判定のハッシュだけ）。

-- 1. 監視アカウント：イベントに使うか・食レポに使うか・食レポの保留の理由
alter table public.sns_monitor_accounts add column if not exists use_events boolean not null default true;
alter table public.sns_monitor_accounts add column if not exists use_gourmet boolean not null default false;
alter table public.sns_monitor_accounts add column if not exists gourmet_hold text not null default '';
comment on column public.sns_monitor_accounts.use_events is 'イベントの候補づくりに使う（既定 true。食レポだけのアカウントは false）';
comment on column public.sns_monitor_accounts.use_gourmet is '食レポの候補づくりに使う（既定 false）';
comment on column public.sns_monitor_accounts.gourmet_hold is '空でなければ、この理由の確認が済むまで、このアカウント由来の食レポの候補は承認できない';

-- 2. 食レポの候補（1投稿＝1行。お店ごとの判定は shops の配列）
create table if not exists public.gourmet_candidates (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('instagram-hashtag', 'instagram-account')),
  platform text not null default 'instagram',
  post_id text not null unique,                  -- 媒体の投稿ID（同じ投稿を二度読まない）
  post_url text not null check (char_length(post_url) <= 500),
  author_handle text,                            -- 監視アカウント由来のときだけ（ハッシュタグ検索では投稿者名が取れない）
  posted_at timestamptz,
  caption_hash text not null,                    -- 本文の SHA-256（本文そのものは保存しない）
  shops jsonb not null default '[]'::jsonb,      -- [{name, area_hint, tone, confidence, reason, matches[], chosen_ref, status, decision, report_id}]
  more_shops boolean not null default false,     -- 11店以上を紹介している（最初の10店だけ読んだ）
  hold_reason text not null default '',          -- 空でなければ承認できない（ちばモグ＝らいさんの確認待ち）
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected', 'skipped')),
  model text,
  input_tokens integer,
  output_tokens integer,
  est_cost_jpy numeric,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.members(id) on delete set null
);
create index if not exists gourmet_candidates_status on public.gourmet_candidates (status, created_at desc);
alter table public.gourmet_candidates enable row level security;
revoke all on public.gourmet_candidates from anon, authenticated;
grant all on public.gourmet_candidates to service_role;
comment on table public.gourmet_candidates is '食レポの SNS 巡回の候補（運営が承認したお店だけ gourmet_reports へ。本文は保存しない）。status=skipped は食レポでなかった投稿の印（二度読まないため）';

-- 3. 食レポ：出どころ・複数店の投稿・元の候補
alter table public.gourmet_reports add column if not exists source text not null default 'user';
alter table public.gourmet_reports add column if not exists multi_shop boolean not null default false;
alter table public.gourmet_reports add column if not exists candidate_id uuid references public.gourmet_candidates(id) on delete set null;
do $$ begin
  alter table public.gourmet_reports add constraint gourmet_reports_source check (source in ('user', 'crawl'));
exception when duplicate_object then null; end $$;
comment on column public.gourmet_reports.source is 'user＝利用者が貼った／crawl＝SNS 巡回で見つけ、運営が承認した';
comment on column public.gourmet_reports.multi_shop is '1つの投稿で複数のお店を紹介している（カードに注意を出す）';

-- 4. スイッチ（既定オフ。事業主が OK を出すまで切ったまま）
insert into public.app_settings (key, value)
values ('gourmet_crawl', '{"enabled": false, "daily_ai_limit": 40}'::jsonb)
on conflict (key) do nothing;

-- 5. ちばモグ（食レポだけ・イベント側には入れない・らいさんの確認待ち）
insert into public.sns_monitor_accounts (platform, username, label, kind, enabled, use_events, use_gourmet, gourmet_hold, note)
values ('instagram', 'chiba_mogu', 'ちばモグ（千葉北部のグルメ）', 'その他', true, false, true,
        'らいさんの確認待ち（リンク・アカウント名・写真・おすすめの印の可否）',
        '2026-11-13 事業主決定：食レポだけに使う（イベント側には入れない）。FreeFree でコラボ。らいさんの返事が来るまで候補は承認できない')
on conflict (platform, username) do update set use_events = false, use_gourmet = true, gourmet_hold = excluded.gourmet_hold, note = excluded.note;
