-- =============================================================
-- LINEログイン一本化対応（仕様書 v2.1）
-- - LINE OIDC ユーザーは email が null のため、display_name の
--   取得元に LINE の name クレームを追加
-- - auth_provider_id をプロバイダに応じて設定（email / line）
-- =============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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
  values (new.id, v_display_name, v_residency, 'light', v_provider)
  on conflict (id) do nothing;

  return new;
end;
$$;
