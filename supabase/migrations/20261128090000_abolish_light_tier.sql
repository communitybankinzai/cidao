-- 仮登録（tier='light'）と本登録（tier='email_only'）の区別をやめる（2026-11-28 事業主決定）。
--
-- これまで：LINE で登録した直後は tier='light'（仮登録）で、提案・賛同・コメント・団体への参加申込み・
--           メンバーへの声かけ・掲示板への掲載ができず、投票の重みも 0.1 だった。
--           プロフィール編集で「本登録する」を押すと tier='email_only' になり、全部できるようになった。
-- これから：登録した時点で tier='email_only'。できることと投票の重みに差を付けない。
--           本登録の画面が担っていた「表示名の確認」（LINE の名前＝本名の人が、気づかないまま公開の場に名前が出るのを防ぐ）
--           は残す。確認を済ませたかどうかは、tier ではなく profile_confirmed_at で見る。
--
-- 実行前の本番の状態（2026-11-28）：light 16名・email_only 61名・verified 1名。
--   light の人の投票は 0票（votes・vote_aggregates とも）なので、過去の投票結果は変わらない。
--
-- tier を見ている RLS（comments・freefree_posts・org_interests・organizations・proposals・supports・talent_inquiries）と
-- 関数（calc_vote_weight・dormant_member_count・sync_vote_aggregate・finalize 系）は書き換えない。
-- 全員が email_only 以上になるので、どれも「通る」側になる。列挙型の値 'light' は残る（使わない）。
--
-- 戻し方（必要になったとき）：
--   update public.members set tier = 'light'
--    where profile_confirmed_at is null and tier = 'email_only' and created_at < '2026-11-28 00:00:00+00';
--   （この日より後に登録した人は、もともと仮登録の期間が無いので対象にしない）

begin;

-- 1. 表示名の確認を済ませた日時
alter table public.members add column if not exists profile_confirmed_at timestamptz;
comment on column public.members.profile_confirmed_at is
  '表示名などのプロフィールを本人が確認して保存した日時。null の間は、ログイン直後に確認の画面へ案内する（2026-11-28。以前は tier=light がこの役目だった）';

-- 一括の書き換えで updated_at が全員「いま」になるのを防ぐ（並び順や「最近更新」に使われるため）
alter table public.members disable trigger trg_members_updated;

-- 2. すでに本登録を済ませている人は、確認済みとして扱う（日時は最後に更新した時）
update public.members
   set profile_confirmed_at = coalesce(updated_at, created_at)
 where tier <> 'light' and profile_confirmed_at is null;

-- 3. 仮登録のままの人を、ほかの会員と同じ扱いにする（確認はまだ＝次にログインしたとき確認の画面が出る）
update public.members set tier = 'email_only' where tier = 'light';

alter table public.members enable trigger trg_members_updated;

-- 4. これから登録する人は、最初から同じ扱い
alter table public.members alter column tier set default 'email_only';

-- 5. 本人がログイン直後の案内に使うので、ログイン済みの人に読めるようにする
--    （members の SELECT は列ごとの許可。書き込みは表の UPDATE 許可に含まれる）
grant select (profile_confirmed_at) on public.members to authenticated;

-- 6. 登録の瞬間に作る会員の行（'light' → 'email_only' の1か所だけ変更。ほかは 20260720100000 のまま）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_residency residency_type;
  v_display_name text;
  v_provider text;
begin
  v_residency := coalesce(
    (new.raw_user_meta_data ->> 'residency_type')::residency_type,
    'citizen'
  );
  v_display_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'name',       -- LINE OIDC の表示名クレーム
    new.raw_user_meta_data ->> 'full_name',
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'メンバー'
  );
  -- display_name の check 制約（1〜40字）に合わせて切り詰め
  v_display_name := left(v_display_name, 40);

  v_provider := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  if v_provider like 'custom:%' then
    v_provider := replace(v_provider, 'custom:', '');
  end if;

  insert into public.members (id, display_name, residency_type, tier, auth_provider_id)
  values (new.id, v_display_name, v_residency, 'email_only', v_provider)
  on conflict (id) do nothing;

  return new;
end;
$function$;

commit;
