-- 証拠保全用バケット moderation-evidence の1ファイル上限を 10MB → 20MB に上げる（2026-10-05・事業主決定）。
--
-- 理由: FreeFree 掲載に動画（20MBまで）を載せられるようにした（20261005100000_freefree_video.sql）。
--       掲載を完全削除するときは、画像と同じく動画も証拠用バケットへ複製してから消す決まりだが、
--       上限が 10MB のままだと 10MB 超の動画を複製できず、削除が証拠保全の失敗で中断してしまう。
-- 非公開バケットのまま（public は変えない）。

update storage.buckets
   set file_size_limit = 20971520 -- 20MB
 where id = 'moderation-evidence';
