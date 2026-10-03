// お店が自分で掲載したとき、運営が先に作った取込掲載（同じお店）を自動で非公開にする。
//
// ・「名称と住所が一致」「名称と電話番号が一致」のように、同じお店とほぼ言い切れるものだけを非公開（status='removed'）にする
// ・「名称＋位置が近い」などの可能性は、非公開にせず記録（監査ログ）だけ残す
// ・非公開にするだけで、削除はしない。運営が掲載の管理から戻せる
// ・失敗しても、お店の掲載は成立させる（best-effort）。取込で作った掲載（import_source あり）以外には触れない
// ・掲載の投稿者は団体で、運営でないお店のセッションでは更新できないため、service role で行う

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { recordWrite } from '@/lib/audit'
import { findSupersededImports, postToDedupRecord, type SupersedeInput } from '@/lib/freefree-import-core'

export async function hideSupersededImports(
  post: SupersedeInput & { id: string },
  actorId: string,
): Promise<{ hidden: string[]; maybe: string[] }> {
  const out = { hidden: [] as string[], maybe: [] as string[] }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!url || !key) return out
    const admin = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: imported, error } = await admin
      .from('freefree_posts')
      .select('id, title, body, address, location, lat, lon, links')
      .not('import_source', 'is', null)
      .eq('status', 'active')
      .limit(2000)
    if (error || !imported?.length) return out

    const r = findSupersededImports(post, imported.map((p) => postToDedupRecord(p)))
    if (r.hide.length > 0) {
      const ids = r.hide.map((h) => h.id)
      const { data: done, error: ue } = await admin
        .from('freefree_posts')
        .update({ status: 'removed' })
        .in('id', ids)
        .not('import_source', 'is', null)
        .select('id')
      if (!ue) out.hidden = (done ?? []).map((d) => d.id)
    }
    out.maybe = r.maybe.map((m) => m.id)

    if (out.hidden.length > 0 || out.maybe.length > 0) {
      await recordWrite({
        actorId, action: 'freefree.import', targetType: 'freefree', targetId: post.id,
        detail: { op: 'supersede_imports', hidden: out.hidden, hide_reasons: r.hide, maybe: r.maybe },
      })
    }
  } catch (e) {
    console.warn('[freefree-import-supersede] skipped:', e instanceof Error ? e.message : String(e))
  }
  return out
}
