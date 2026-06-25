-- members の SELECT を anon にも開放する。
-- 経緯: 既存の members_select_others が `id <> auth.uid()` 条件を含むため、
-- anon ユーザー（auth.uid() が NULL）では `id <> NULL` が NULL となり該当行を返せない。
-- 結果: /orgs カードのメンバー表示で members の embed が常に null になる。
--
-- 設計方針: members レコード自体は誰でも閲覧可（公開項目の細かい制御は public_settings に
-- 基づきアプリ層で行う想定。初期 migration のコメント参照）。

drop policy if exists members_select_others on public.members;

create policy members_select_anyone on public.members
  for select using (deleted_at is null);
