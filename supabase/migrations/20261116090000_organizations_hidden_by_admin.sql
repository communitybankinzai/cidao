-- 団体の「運営が非公開にした」印（2026-11-16）
-- 掲載は「公開情報をもとに先に載せ、望まれないものを外す」方針。外す操作を運営の画面からできるようにする。
-- public_flag = false には2つの意味が混ざっていた：
--   (a) 会員が申告したばかりで、運営の承認を待っている新しい団体
--   (b) 運営が、団体からの申し出などで非公開にした団体  ← これを hidden_by_admin で区別する
-- (b) の団体には、(a) 向けの自動の動きを働かせない：
--   ・代表者の所属申告を承認しても、自動で公開に戻さない（approveClaim）
--   ・所属申告を却下しても、団体ごと削除しない（rejectClaim）
-- 切り替えは /admin/orgs から（運営委員・統括のみ）。

alter table public.organizations
  add column if not exists hidden_by_admin boolean not null default false,
  add column if not exists hidden_reason text not null default '',
  add column if not exists hidden_at timestamptz;

comment on column public.organizations.hidden_by_admin is 'true＝運営が非公開にした（public_flag も false）。申告中の新しい団体（承認待ち）と区別する印';
comment on column public.organizations.hidden_reason is '運営が非公開にした理由（運営の画面にだけ出す）';
comment on column public.organizations.hidden_at is '運営が非公開にした日時';

-- 2026-11-15〜16 に手で非公開にした3件（同じ団体の重複登録）に印を付ける。
update public.organizations
   set hidden_by_admin = true,
       hidden_reason = '団体から「相談なく載せてほしくなかった」と申し出あり。面談で可否を決めてもらうまで非公開（2026-11-16）',
       hidden_at = now()
 where id in (
         'd506f2ab-0ec0-461c-b048-bab384d89f66',
         'f54e74af-b25e-4dc4-baba-1c4506b3ac6f',
         '86a472cf-e39a-4e0b-b9ca-0b9ed9440a91'
       )
   and public_flag = false
   and hidden_by_admin = false;
