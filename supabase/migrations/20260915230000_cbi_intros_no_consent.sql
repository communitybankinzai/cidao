-- 他己紹介の方式変更（2026-09-15 夜 中司さん決定）：事前の同意欄は置かず、AI 下書き→運営が一読→本人が確認して承認したものを載せる。
-- 紹介ページで読めるのは、ログインした会員に対して「掲載中」のものだけ。
drop policy if exists cbi_intros_select_published on public.member_cbi_intros;
create policy cbi_intros_select_published on public.member_cbi_intros for select to authenticated using (status = 'published');
drop function if exists public.cbi_intro_consented(uuid);
