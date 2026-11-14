-- コミュニティカフェの目印（2026-11-14）
-- コミュニティカフェ＝地域の「たまり場」「居場所」になっている場の総称（年齢で区切らない）。
-- 子どもの居場所（child_place）・高齢者の居場所（senior_place）とは別の列にして、重ねて付けられるようにする。
--   例：おやこカフェ＝子ども＋カフェ、オレンジカフェ＝高齢者＋カフェ
--   cafe_place = true（コミュニティカフェ・サロン・地域食堂・茶話会など、だれでも立ち寄れる集まりの場）
--   cafe_place_checked = 人が決めた（true）か、題名・主催名からの自動判定のまま（false）か
-- 自動判定は insert のときだけ（人が決めた行は触らない）。既存の行への付け直しは、運営が一覧を確認してから別に行う。

alter table public.events
  add column if not exists cafe_place boolean not null default false,
  add column if not exists cafe_place_checked boolean not null default false;

create index if not exists idx_events_cafe_place
  on public.events (start_at) where cafe_place;

comment on column public.events.cafe_place is 'コミュニティカフェの目印。true＝だれでも立ち寄れる集まりの場（コミュニティカフェ・サロン・地域食堂・茶話会など）';
comment on column public.events.cafe_place_checked is 'true＝人が決めた（運営の確認・登録時の選択）。false＝題名・主催名からの自動判定のまま、または未判定';

-- 題名と主催名から目印を推測する。条件を変えるときはこの関数だけを直す。
--   「サロン」は前がカタカナのもの（ヘアサロン・ネイルサロンなど）を拾わない。集まりの場のサロンは名前で拾う。
create or replace function public.suggest_cafe_place(p_title text, p_organizer text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (coalesce(p_title, '') || E'\n' || coalesce(p_organizer, '')) ~*
    '(カフェ|cafe|café|地域食堂|みんなの食堂|茶話会|お茶会|縁側|たまり場|シニアサロン|コミュニティサロン|(^|[^ァ-ヶー])サロン)'
$$;

create or replace function public.events_set_cafe_place()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.cafe_place and not new.cafe_place_checked then
    new.cafe_place := public.suggest_cafe_place(new.title, new.organizer_name_text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_cafe_place on public.events;
create trigger trg_events_cafe_place
  before insert on public.events
  for each row execute function public.events_set_cafe_place();
