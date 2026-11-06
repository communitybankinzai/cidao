// サービスロール（RLS を通らない）クライアント。サーバー側だけで使う。
// 用途：ログイン済みの本人の行を、会員向けには読ませない列（通知設定など）まで含めて読むとき。
// 必ず先に auth.getUser() で本人確認し、.eq('id', user.id) を付けて使うこと。
// 2026-11-06: members の列ごとの権限を絞った（会員同士は通知設定・公開設定・認証方式を読めない）ため、
// マイページの本人表示はこのクライアントで読む。

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

export function createServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
