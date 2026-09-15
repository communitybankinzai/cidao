-- =============================================================
-- FreeFree：運営者による代理掲載と、掲載終了日の日付指定（2026-09-15 決定）
--
-- 1. 代理掲載
--    運営権限（committee / super）を持つ5名が、他団体からの依頼に基づき
--    その団体として掲載できるようにする。掲示板には「CBIが依頼を受けて掲載」と明示し、
--    誰が代理したかを proxy_posted_by に残す。
--    ・既存の freefree_insert_member は会員区分（email_only/verified）と団体所属を要求するため、
--      所属していない団体や、区分が light の CBI 公式アカウントからは掲載できなかった。
--      運営者専用の INSERT ポリシーを別に足す（ポリシーは OR で評価される）。
--    ・クーポンは coupons_write_poster が「その団体の所属者」しか許可しておらず、
--      代理掲載ではエラーも出ずにクーポンだけが作られない。運営者用を足す。
--    ・「CBIが依頼を受けて掲載」は信頼の印なので偽装できてはいけない。
--      団体の所属者は自団体の掲載を UPDATE できるため、トリガーで proxy_posted_by を守る。
--
-- 2. 掲載終了日の日付指定
--    「1週間／1ヶ月／3ヶ月」をやめ、終了日をカレンダーで選ぶ形に一本化する。
--    上限は掲載日から3ヶ月先まで（開発仕様書 v2.1 で6ヶ月以上は協賛枠のため）。
--    新しい掲載は period = 'p_until_date' とし、実際の期限は expires_at が持つ。
--    既存の 'p_1week' 等は過去の掲載のために残す。
--    上限は画面とサーバーでも検査するが、API を直接叩かれても守れるよう DB にも持たせる。
--    月末の丸め（例: 11/30 + 3ヶ月 → 2/28）でアプリと DB の計算がずれても弾かないよう
--    3日の余裕を持たせる。既存の掲載2件はいずれも約90日で抵触しない（2026-09-15 確認）。
-- =============================================================

alter type public.freefree_period add value if not exists 'p_until_date';

alter table public.freefree_posts
  add column if not exists proxy_posted_by uuid references public.members(id);

comment on column public.freefree_posts.proxy_posted_by is
  '運営者が団体の依頼を受けて代理掲載したとき、その運営者の members.id。本人・所属者による掲載では null。';

alter table public.freefree_posts
  drop constraint if exists freefree_posts_expires_within_3months;
alter table public.freefree_posts
  add constraint freefree_posts_expires_within_3months
  check (expires_at is null or expires_at <= created_at + interval '3 months 3 days');

-- 代理掲載の記録は、運営者が自分の名前でしか付けられず、運営者以外は書き換えられない
create or replace function public.guard_freefree_proxy_posted_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.proxy_posted_by is not null
       and not (public.is_committee_or_super() and new.proxy_posted_by = auth.uid()) then
      raise exception '代理掲載は運営者本人の名前でしか記録できません';
    end if;
  elsif new.proxy_posted_by is distinct from old.proxy_posted_by
        and not public.is_committee_or_super() then
    raise exception '代理掲載の記録は運営者しか変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_freefree_guard_proxy on public.freefree_posts;
create trigger trg_freefree_guard_proxy
  before insert or update on public.freefree_posts
  for each row execute function public.guard_freefree_proxy_posted_by();

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'freefree_posts'
       and policyname = 'freefree_insert_operator_proxy'
  ) then
    create policy freefree_insert_operator_proxy on public.freefree_posts
      for insert with check (
        public.is_committee_or_super()
        and poster_type = 'org'
        and proxy_posted_by = auth.uid()
      );
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'coupons'
       and policyname = 'coupons_write_admin'
  ) then
    create policy coupons_write_admin on public.coupons
      for all using (public.is_committee_or_super())
      with check (public.is_committee_or_super());
  end if;
end $$;
