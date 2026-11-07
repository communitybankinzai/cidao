-- 子どもの居場所の目印（2026-11-08）
-- events.category（まちづくり・子ども…の10分類）は居場所の判定に使えなかった：
--   ・登録フォームの種別は先頭の「まちづくり」が最初から選ばれていて、手入力の約75%がそのまま
--   ・取り込み（Instagram・goguynet は『まちづくり』、文化ホールは『文化』、市カレンダーは『その他』）が固定値
-- そこで種別は変えずに、別の列で「子どもの居場所」を持つ。
--   child_place = 'ibasho'（居場所型：食堂・プレーパーク・おやこカフェなど）
--               | 'oyako' （親子が集まる場：おはなし会・親子講座・子育て講座など）
--               | null    （どちらでもない／まだ決めていない）
--   child_place_checked = 人が決めた（true）か、題名・主催名からの自動判定のまま（false）か
-- 自動判定は insert のときだけ（既に人が決めた行は触らない）。既存の行への付け直しは、運営が一覧を確認してから別に行う。

alter table public.events
  add column if not exists child_place text
    check (child_place is null or child_place in ('ibasho', 'oyako')),
  add column if not exists child_place_checked boolean not null default false;

create index if not exists idx_events_child_place
  on public.events (child_place) where child_place is not null;

comment on column public.events.child_place is '子どもの居場所の目印。ibasho＝居場所型、oyako＝親子が集まる場、null＝どちらでもない';
comment on column public.events.child_place_checked is 'true＝人が決めた（運営の確認・登録時の選択）。false＝題名・主催名からの自動判定のまま、または未判定';

-- 題名と主催名から目印を推測する（居場所型を先に見る）。条件を変えるときはこの関数だけを直す。
create or replace function public.suggest_child_place(p_title text, p_organizer text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (coalesce(p_title, '') || E'\n' || coalesce(p_organizer, '')) ~*
         '(食堂|居場所|プレーパーク|プレイパーク|冒険遊び場|おやこカフェ|親子カフェ|ここのわ|こっ?トン|学習支援|無料塾|寺子屋|私たちの保健室|ユースセンター|フリースペース)'
      then 'ibasho'
    when (coalesce(p_title, '') || E'\n' || coalesce(p_organizer, '')) ~*
         '(おはなし会|読み聞かせ|絵本de|親子|おやこ|子育て|乳幼児|ベビー|baby|ＢＡＢＹ|ママ|mahalo|産前産後|孫育て|里親)'
      then 'oyako'
    else null
  end
$$;

-- 新しく入るイベントに自動で目印を付ける（人が決めていないときだけ）。取り込み9経路すべてに効く。
create or replace function public.events_set_child_place()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.child_place is null and not new.child_place_checked then
    new.child_place := public.suggest_child_place(new.title, new.organizer_name_text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_child_place on public.events;
create trigger trg_events_child_place
  before insert on public.events
  for each row execute function public.events_set_child_place();
