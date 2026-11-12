-- Claude Haiku 4.5 の単価を料金表に足す（2026-11-13）。
-- 食レポの SNS 巡回（claude-haiku-4-5）の費用が、料金表に単価が無いため「算出不能（0円）」と記録されていた。
-- 単価は Anthropic の公開価格（USD / 100万トークン：入力 1・出力 5・キャッシュ書き込み 1.25・キャッシュ読み 0.10）。
-- 改定時は有効日を変えて追加し、過去の単価を上書きしない（cost_rates の運用どおり）。
insert into public.cost_rates (provider, model, unit, rate_per_unit, currency, effective_from, note) values
  ('anthropic', 'claude-haiku-4-5', 'input_tokens',          0.000001,   'USD', '2026-11-13', 'Haiku 4.5 公開価格 $1/MTok（食レポの SNS 巡回で使用）'),
  ('anthropic', 'claude-haiku-4-5', 'output_tokens',         0.000005,   'USD', '2026-11-13', 'Haiku 4.5 公開価格 $5/MTok'),
  ('anthropic', 'claude-haiku-4-5', 'cache_creation_tokens', 0.00000125, 'USD', '2026-11-13', 'Haiku 4.5 ephemeral 5分キャッシュ書き込み $1.25/MTok'),
  ('anthropic', 'claude-haiku-4-5', 'cache_read_tokens',     0.0000001,  'USD', '2026-11-13', 'Haiku 4.5 キャッシュ読み $0.10/MTok')
on conflict (provider, model, unit, effective_from) do nothing;
