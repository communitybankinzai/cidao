import type { createClient } from '@/lib/supabase/server'

type Db = Awaited<ReturnType<typeof createClient>>

export type Footprints = {
  orgs: { id: string; name: string; representative: boolean }[]
  proposals: { id: string; title: string }[]
  commentCount: number
  events: { id: string; title: string; startAt: string | null }[]
}

export const hasFootprints = (f: Footprints) => f.orgs.length > 0 || f.proposals.length > 0 || f.events.length > 0 || f.commentCount > 0

// 紹介ページの「活動の足あと」（2026-09-15 中司さん決定・案A）。
// 見る人の権限（RLS）のまま読むので、その人に見えない記録は返らない＝足あとで新しく公開になる情報はない。
// 投票・閲覧履歴・参加したイベント・貢献ポイント・相談の中身は読まない。
// 本人が隠している（members.show_footprints = false）ときと、設定が読めないときは null（欄を出さない）。
export async function getFootprints(db: Db, memberId: string): Promise<Footprints | null> {
  const setting = await db.from('members').select('show_footprints').eq('id', memberId).maybeSingle()
  if (setting.error || !setting.data || setting.data.show_footprints === false) return null
  const [orgs, proposals, comments, events] = await Promise.all([
    // 団体ページに載せると本人が選んだ所属だけ
    db.from('memberships').select('role, organizations(id, name)').eq('member_id', memberId)
      .eq('status', 'confirmed').eq('display_in_org', true).is('left_at', null),
    db.from('proposals').select('id, title').eq('proposer_id', memberId).neq('status', 'draft')
      .order('created_at', { ascending: false }).limit(5),
    db.from('comments').select('id', { count: 'exact', head: true }).eq('author_id', memberId),
    // 運営の代理登録・自動収集の行事は「主催」に数えない（organizer_id が登録した運営になっているため）
    db.from('events').select('id, title, start_at').eq('organizer_type', 'member').eq('organizer_id', memberId)
      .eq('proxy_registration', false).is('external_source', null).neq('status', 'draft')
      .order('start_at', { ascending: false }).limit(5),
  ])
  type OrgRow = { role: string; organizations: { id: string; name: string } | { id: string; name: string }[] | null }
  return {
    orgs: ((orgs.error ? [] : orgs.data ?? []) as OrgRow[]).flatMap(row => {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations
      return org ? [{ id: org.id, name: org.name, representative: row.role === 'representative' }] : []
    }),
    proposals: proposals.error ? [] : (proposals.data ?? []).map(p => ({ id: p.id, title: p.title })),
    commentCount: comments.error ? 0 : comments.count ?? 0,
    events: events.error ? [] : (events.data ?? []).map(e => ({ id: e.id, title: e.title, startAt: e.start_at })),
  }
}
