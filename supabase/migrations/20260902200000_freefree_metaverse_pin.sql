-- =============================================================
-- FreeFree掲示物を「CBIメタバース印西」のお店ピンとして出す
--
-- 背景（2026-09-02）:
--   お店の場所を3D空間にピンで示し、ホームページ・オンラインショップ・SNSへ
--   飛べるようにしたい。その「権利」は FreeFree掲示板に住所とリンクを貼ることで得る、
--   という運用にする（CBIが手で転記しない）。
--
-- 仕組み:
--   投稿フォームの「🗺 メタバース印西にお店のピンを出す」を選んで住所を入れると、
--   保存時に国土地理院の住所検索APIで緯度経度へ変換して lat/lon に入れる。
--   リンク（ホームページ・オンラインショップ・SNS）は既存の links 列に入れる。
--   ピンは掲載中（status='active' かつ expires_at が未来）の間だけ出て、
--   掲載期間が切れると消える（再投稿が情報更新の動機になる）。
--   公開は /api/metaverse-shops が返す（RLS の freefree_select_active と同じ条件）。
-- =============================================================

alter table public.freefree_posts
  add column if not exists metaverse_pin boolean not null default false,
  add column if not exists address       text,
  add column if not exists lat           double precision,
  add column if not exists lon           double precision;

comment on column public.freefree_posts.metaverse_pin is
  'true ならメタバース印西にお店ピンとして出す（掲載中のあいだだけ）。';
comment on column public.freefree_posts.address is
  'ピンの位置に使う住所（掲載者入力）。lat/lon はこれを国土地理院APIで変換した値。';
comment on column public.freefree_posts.lat is 'お店ピンの緯度（WGS84）。address から変換。';
comment on column public.freefree_posts.lon is 'お店ピンの経度（WGS84）。address から変換。';

-- お店ピンの取り出し用（掲載中のものだけを期限順に）
create index if not exists idx_freefree_metaverse_pin
  on public.freefree_posts (expires_at)
  where metaverse_pin and status = 'active';
