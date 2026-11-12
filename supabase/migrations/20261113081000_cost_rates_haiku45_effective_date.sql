-- 20261113080000 の修正（2026-11-13）。単価の有効日を 2026-11-13 にしたが、料金の計算は UTC の日付で単価を探すため、
-- 日本時間の朝（UTC ではまだ前日）は単価が見つからず「算出不能」のままだった。
-- 有効日を、ほかの Claude の初期単価と同じ 2026-09-14 にそろえる（追加した直後の行の直しで、過去の単価の上書きではない）。
delete from public.cost_rates where provider = 'anthropic' and model = 'claude-haiku-4-5' and effective_from = '2026-11-13';
insert into public.cost_rates (provider, model, unit, rate_per_unit, currency, effective_from, note) values
  ('anthropic', 'claude-haiku-4-5', 'input_tokens',          0.000001,   'USD', '2026-09-14', 'Haiku 4.5 公開価格 $1/MTok（食レポの SNS 巡回で使用）'),
  ('anthropic', 'claude-haiku-4-5', 'output_tokens',         0.000005,   'USD', '2026-09-14', 'Haiku 4.5 公開価格 $5/MTok'),
  ('anthropic', 'claude-haiku-4-5', 'cache_creation_tokens', 0.00000125, 'USD', '2026-09-14', 'Haiku 4.5 ephemeral 5分キャッシュ書き込み $1.25/MTok'),
  ('anthropic', 'claude-haiku-4-5', 'cache_read_tokens',     0.0000001,  'USD', '2026-09-14', 'Haiku 4.5 キャッシュ読み $0.10/MTok')
on conflict (provider, model, unit, effective_from) do nothing;
update public.api_usage set rate_version = replace(rate_version, '@2026-11-13', '@2026-09-14') where model = 'claude-haiku-4-5' and rate_version like '%@2026-11-13%';
