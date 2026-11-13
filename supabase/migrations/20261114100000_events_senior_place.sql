-- 高齢者の居場所の目印（2026-11-14）
-- 子どもの居場所（events.child_place）とは別の列にする。
--   ・コミュニティカフェや地域食堂のように、子どもと高齢者の両方が集まる催しに、両方の目印を付けられるようにするため
--   ・種別（events.category）は登録フォームの初期値や取り込みの固定値で当てにならないので使わない（child_place と同じ理由）
--   senior_place = true（高齢者の居場所・集まる場：オレンジカフェ・コミュニティカフェ・サロン・介護予防教室など）
--   senior_place_checked = 人が決めた（true）か、題名・主催名からの自動判定のまま（false）か
-- 自動判定は insert のときだけ（人が決めた行は触らない）。既存の行への付け直しは、運営が一覧を確認してから別に行う。
-- 健診・入会説明会のような「集まる場」でないものは条件に入れていない。

alter table public.events
  add column if not exists senior_place boolean not null default false,
  add column if not exists senior_place_checked boolean not null default false;

create index if not exists idx_events_senior_place
  on public.events (start_at) where senior_place;

comment on column public.events.senior_place is '高齢者の居場所の目印。true＝高齢者の居場所・集まる場（オレンジカフェ・コミュニティカフェ・サロン・介護予防教室など）';
comment on column public.events.senior_place_checked is 'true＝人が決めた（運営の確認・登録時の選択）。false＝題名・主催名からの自動判定のまま、または未判定';

-- 題名と主催名から目印を推測する。条件を変えるときはこの関数だけを直す。
create or replace function public.suggest_senior_place(p_title text, p_organizer text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (coalesce(p_title, '') || E'\n' || coalesce(p_organizer, '')) ~*
    '(オレンジカフェ|認知症カフェ|コミュニティカフェ|コミュニティーカフェ|地域食堂|みんなの食堂|介護予防|健康ちょきん|百歳体操|フレイル|通いの場|ふれあいサロン|いきいきサロン|高齢者サロン|シニアサロン|茶話会|老人福祉センター|老人クラブ|シニアクラブ|高齢者の居場所|高齢者のための|高齢者向け|シニアのための|シニア向け|認知症の人と家族)'
    -- 「Lien／リアン」は印西介護リアン（高齢者対象の事業）の催しに付く名前（リアンカフェ・リアンカフェの台所など）。もれなく拾う。
    -- 前の文字を見て、イタリアン・client・alien などの別の語は拾わない。
    or (coalesce(p_title, '') || E'\n' || coalesce(p_organizer, '')) ~*
    '((^|[^a-zａ-ｚ])(lien|ｌｉｅｎ)([^a-zａ-ｚ]|$)|(^|[^ァ-ヶー])リアン)'
$$;

-- 新しく入るイベントに自動で目印を付ける（人が決めていないときだけ）。取り込みの全経路に効く。
create or replace function public.events_set_senior_place()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.senior_place and not new.senior_place_checked then
    new.senior_place := public.suggest_senior_place(new.title, new.organizer_name_text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_senior_place on public.events;
create trigger trg_events_senior_place
  before insert on public.events
  for each row execute function public.events_set_senior_place();
