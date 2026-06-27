-- =============================================================
-- members.avatar_zoom — CSS transform scale factor for the avatar.
-- 1.0 = no zoom (default), 1.5 = 1.5x, etc. Range 0.5 ~ 3.0 in UI.
-- Combined with avatar_position for fine-grained avatar cropping.
-- =============================================================

alter table public.members
  add column if not exists avatar_zoom numeric(4, 2) default 1.0;
