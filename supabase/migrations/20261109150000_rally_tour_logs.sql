-- =============================================================
-- rally_tour_logs — 文化財ガイドツアーの「発話と質問の記録」
--
-- 背景: ガイド付きツアー（cbi-site/metaverse/rally/）で、ガイドの説明（say）・
--       観光客の質問（ask）・質問への回答（answer）を残し、あとから見返せるようにする（2026-11-09）。
--       名前・連絡先・位置情報は保存しない。ガイド育成の資料（よくある質問）に使う。
--
-- 読み書きは /api/rally-log（service_role）だけ。anon / authenticated には権限を与えない
-- （2026-10-30 以降の新テーブルは Data API の権限が自動で付かないので、明示的に revoke しておく）。
-- =============================================================

create table if not exists public.rally_tour_logs (
  id          uuid primary key default gen_random_uuid(),
  tour        text not null check (tour ~ '^[A-Z0-9]{4,12}$'),   -- ツアーコード
  spot        text check (spot ~ '^[a-z0-9-]{3,60}$'),           -- 文化財の reportId（無いこともある）
  kind        text not null check (kind in ('say', 'ask', 'answer')),
  ja          text check (char_length(ja) <= 600),
  en          text check (char_length(en) <= 1200),
  reply_to    uuid references public.rally_tour_logs(id) on delete set null,  -- answer が答えた ask の id
  created_at  timestamptz not null default now(),
  check (ja is not null or en is not null)
);

comment on table public.rally_tour_logs is '文化財ガイドツアーの発話と質問の記録（名前・連絡先・位置情報は保存しない。ガイド育成の資料＝よくある質問に使う）。API: /api/rally-log';
comment on column public.rally_tour_logs.kind is 'say=ガイドの説明 / ask=観光客の質問 / answer=質問への回答';
comment on column public.rally_tour_logs.reply_to is 'answer が答えた ask の id';

create index if not exists idx_rally_tour_logs_spot on public.rally_tour_logs(spot, created_at desc);
create index if not exists idx_rally_tour_logs_tour on public.rally_tour_logs(tour, created_at);

alter table public.rally_tour_logs enable row level security;

revoke all on public.rally_tour_logs from anon;
revoke all on public.rally_tour_logs from authenticated;
-- service_role は RLS を通らないので、API（adminClient）からだけ読み書きできる
