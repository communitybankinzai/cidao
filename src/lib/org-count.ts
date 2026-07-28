import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * 画面表示用の「団体数」。
 * 企業（business）・行政（government）は含めず、市民活動団体（civic_group）だけを数える。
 * 数字を出す画面はこの関数だけを使い、件数のハードコードはしない。
 */
export async function getCivicGroupCount(supabase: Supabase): Promise<number | null> {
  const { count } = await supabase
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .eq('public_flag', true)
    .eq('type', 'civic_group')
  return count ?? null
}
