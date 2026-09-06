-- 会員の登録経路（2026-09-06）
-- 印西市３次元MAP（メタバース印西）の入場受付に出す「CiDAO 登録QR」経由で何人が新規登録したかを数えるため、
-- 初回ログイン時に auth/callback が Cookie（cidao_signup_src）の値を書く。形式は "utm_source:utm_medium:utm_campaign"
-- （例 metaverse:reception:entry＝受付画面のQR、metaverse:auth:line＝受付の LINE ボタン）。既存会員は null のまま。
alter table public.members add column if not exists signup_source text check (char_length(signup_source) <= 60);
create index if not exists idx_members_signup_source on public.members(signup_source) where signup_source is not null;
