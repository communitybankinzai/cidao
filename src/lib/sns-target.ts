// SNS 投稿対象（freefree / event / org）を DB から読み、テンプレート入力に整える。
//
// 管理画面の下書き生成（/admin/sns）と実配信（/api/sns/dispatch）の両方から呼ぶ。
// 両者が別々に組み立てると「承認した文面と実際に飛ぶ文面が違う」事故になるため、
// 取得ロジックは1か所に置く。

import type { SnsTarget } from '@/lib/sns-template'

type AnySupabase = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>

export async function fetchSnsTarget(
  supabase: AnySupabase,
  target_type: 'freefree' | 'event' | 'org',
  target_id: string,
): Promise<SnsTarget | null> {
  if (target_type === 'freefree') {
    const { data } = await supabase
      .from('freefree_posts')
      .select('id, title, body, category, location, status, poster_type, poster_id, sns_display_name')
      .eq('id', target_id)
      .maybeSingle()
    if (!data || data.status !== 'active') return null

    // 名指しできるのは次の2通りだけ。
    //   団体掲載          → organizations.name（もともと掲示板で公開している名前）
    //   個人・個人事業掲載 → 掲載者が「SNSで出してよい」と自分で入力した表示名
    // members.display_name は掲示板の詳細ページでも出していないため使わない。
    let poster_name: string | null = null
    if (data.poster_type === 'org') {
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', data.poster_id)
        .maybeSingle()
      poster_name = (org?.name as string | undefined) ?? null
    } else {
      poster_name = (data.sns_display_name as string | null) ?? null
    }

    return {
      target_type, target_id,
      title: String(data.title),
      body: data.body as string | null,
      category: data.category as string | null,
      location: data.location as string | null,
      poster_name,
    }
  }

  if (target_type === 'event') {
    const { data } = await supabase
      .from('events')
      .select('id, title, description, location, start_at, organizer_name, status')
      .eq('id', target_id)
      .maybeSingle()
    if (!data || data.status !== 'open') return null
    return {
      target_type, target_id,
      title: String(data.title),
      body: data.description as string | null,
      location: data.location as string | null,
      start_at: data.start_at as string | null,
      organizer_name: data.organizer_name as string | null,
    }
  }

  const { data } = await supabase
    .from('organizations')
    .select('id, name, description')
    .eq('id', target_id)
    .maybeSingle()
  if (!data) return null
  return {
    target_type, target_id,
    title: String(data.name),
    body: data.description as string | null,
  }
}
