-- =============================================================
-- members.avatar_position — CSS object-position value for the avatar.
-- E.g. 'center 70%' to show the lower part of the source image inside
-- the circular avatar crop. NULL means default (center).
-- Edited from /me/edit by dragging on the circular preview.
-- =============================================================

alter table public.members
  add column if not exists avatar_position text;
