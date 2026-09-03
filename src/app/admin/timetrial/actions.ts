'use server'

// 管理画面「タイムトライアル記録」の削除・リセット操作。
// 記録テーブル metaverse_tt_trials は service_role のみアクセス可のため、
// 管理者確認のうえ service クライアントで操作する。

import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')
  return user
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('サーバー接続が未設定です')
  return createSupabaseAdmin(url, key, { auth: { persistSession: false } })
}

export type TtActionResult = { ok: true } | { ok: false; error: string }

// 参加要件（クイズ正答率・最低解答数）を保存する。イベントごとに変更できる。
// サイト側とAPIの両方がこの値を参照する（app_settings key: metaverse_tt_requirements）
export async function saveTtRequirements(minRatePct: number, minAnswers: number): Promise<TtActionResult> {
  try {
    await requireAdmin()
    const rate = Math.round(Number(minRatePct))
    const answers = Math.round(Number(minAnswers))
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: '正答率は0〜100で指定してください' }
    if (!Number.isFinite(answers) || answers < 0 || answers > 500) return { ok: false, error: '最低解答数は0〜500で指定してください' }
    const { error } = await serviceClient()
      .from('app_settings')
      .upsert({ key: 'metaverse_tt_requirements', value: { minRatePct: rate, minAnswers: answers } })
    if (error) throw new Error(error.message)
    revalidatePath('/admin/timetrial')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// イベント期間（名前・開始・終了）を保存する。期間内はメタバース側のランキング既定が「イベント」になり、
// ゴール時にイベント期間内の順位も返る（app_settings key: metaverse_tt_event）。
// 空の名前で保存すると解除（通常運用＝期間で選ぶだけ）
export async function saveTtEvent(name: string, from: string, to: string): Promise<TtActionResult> {
  try {
    await requireAdmin()
    const n = String(name ?? '').trim().slice(0, 40)
    const svc = serviceClient()
    if (!n) {
      const { error } = await svc.from('app_settings').delete().eq('key', 'metaverse_tt_event')
      if (error) throw new Error(error.message)
      revalidatePath('/admin/timetrial')
      return { ok: true }
    }
    const f = new Date(from)
    const t = new Date(to)
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return { ok: false, error: '開始・終了の日時を指定してください' }
    if (t.getTime() <= f.getTime()) return { ok: false, error: '終了は開始より後にしてください' }
    const { error } = await svc
      .from('app_settings')
      .upsert({ key: 'metaverse_tt_event', value: { name: n, from: f.toISOString(), to: t.toISOString() } })
    if (error) throw new Error(error.message)
    revalidatePath('/admin/timetrial')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 3Dワールドの描画精度（Cesium の maximumScreenSpaceError）を保存する。
// 値が小さいほど細かいタイルを読むため鮮明になるが、取得数が増えて Google 側の
// renderer 1日上限に早く達する（達すると429で詳細タイルが止まる）。課金は root
// リクエスト単位なのでこの値を変えても費用は増えない。
// サイト側は /api/metaverse-usage 経由で受け取り、開いたままの画面にも5分以内に反映される。
// 目安: 8=鮮明（既定）／16=Cesium標準・粗め／32=かなり粗いが上限に強い
// （app_settings key: metaverse_render_quality）
export async function saveRenderQuality(maximumScreenSpaceError: number): Promise<TtActionResult> {
  try {
    await requireAdmin()
    const sse = Math.round(Number(maximumScreenSpaceError))
    if (!Number.isFinite(sse) || sse < 2 || sse > 64) {
      return { ok: false, error: '描画精度は2〜64で指定してください（小さいほど鮮明）' }
    }
    const { error } = await serviceClient()
      .from('app_settings')
      .upsert({ key: 'metaverse_render_quality', value: { maximumScreenSpaceError: sse } })
    if (error) throw new Error(error.message)
    revalidatePath('/admin/timetrial')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 記録を1件削除する
export async function deleteTrial(id: string): Promise<TtActionResult> {
  try {
    await requireAdmin()
    const { error } = await serviceClient()
      .from('metaverse_tt_trials')
      .delete()
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/admin/timetrial')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 全記録をリセットする（デモイベントのやり直し用）。取り消しはできない
export async function resetAllTrials(): Promise<TtActionResult> {
  try {
    await requireAdmin()
    const { error } = await serviceClient()
      .from('metaverse_tt_trials')
      .delete()
      .not('id', 'is', null)
    if (error) throw new Error(error.message)
    revalidatePath('/admin/timetrial')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
