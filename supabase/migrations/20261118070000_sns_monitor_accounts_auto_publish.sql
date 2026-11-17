-- 巡回先（Instagram アカウント）ごとに、取り込んだ催しを自動で公開するかを持つ（2026-11-18 事業主決定A）。
-- 既定は true（公開情報をもとに先に載せ、望まれないものを外す方針）。
-- false の先は、これまでどおり下書きで入り、運営が公開するまで会員に見えない。
-- 自動で公開するのは、読み取りに欠けがない催しだけ（判定は src/lib/instagram-events/auto-publish.ts）。
alter table public.sns_monitor_accounts add column if not exists auto_publish boolean not null default true;

comment on column public.sns_monitor_accounts.auto_publish is
  '取り込んだ催しを自動で公開する（既定 true）。false＝下書きのまま（運営が公開するまで見えない）';

-- だがしや あめちゃん：面談で判断をいただくまで、取り込みは続けるが公開しない（2026-11-16 事業主指示）。
update public.sns_monitor_accounts
   set auto_publish = false, updated_at = now()
 where platform = 'instagram' and username = 'dagashiya.amechan';
