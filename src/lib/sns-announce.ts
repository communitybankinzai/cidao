// 提案（proposals）の SNS 告知下書きを作成する。
// 提案作成のサーバーアクション（after() 内）から呼ばれる。
//
// - 通常（半自動）: sns_post_logs に pending 行を作るだけ。
//   管理画面（/admin/sns）で運営が本文を確認・承認したものだけが配信される。
// - 全自動: app_settings.sns_auto_post.enabled = true のとき、
//   承認済み扱い（approved_at セット）で即配信まで行う。
//
// sns_post_logs への INSERT は一般ユーザーの RLS では許可されていないため、
// service role client で行う（src/lib/notify.ts と同じ方針の best-effort）。

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { generateSnsContent, type SnsMedium, type SnsTarget } from '@/lib/sns-template'
import { dispatchLogs } from '@/lib/sns-dispatch'
import { insertNotification } from '@/lib/notify'
import { normalizeMailFrom } from '@/lib/mail'

const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'

// 提案告知に使う媒体。LINE broadcast はローテーション紹介で使用中のため、
// 提案告知では運営の指定どおり Threads / Facebook / Instagram に限定する。
const PROPOSAL_MEDIA: SnsMedium[] = ['threads', 'facebook', 'instagram']

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, { auth: { persistSession: false } })
}

export type ProposalAnnounceInput = {
  id: string
  title: string
  body: string
  category: string
}

// 戻り値は記録用。呼び出し側（after()）では失敗しても提案作成自体は成立させる。
export async function announceProposalToSns(
  proposal: ProposalAnnounceInput,
): Promise<{ created: number; dispatched: number; auto: boolean }> {
  const supabase = adminClient()
  if (!supabase) return { created: 0, dispatched: 0, auto: false }

  try {
    // 全自動モードか確認
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'sns_auto_post')
      .maybeSingle()
    const auto = (setting?.value as { enabled?: boolean } | null)?.enabled === true

    const target: SnsTarget = {
      target_type: 'proposal',
      target_id: proposal.id,
      title: proposal.title,
      body: proposal.body,
      category: proposal.category,
      deadline: null, // 作成直後は投票締切が未確定のため文面には入れない
    }

    const now = new Date().toISOString()
    const rows = PROPOSAL_MEDIA.map((medium) => ({
      target_type: 'proposal',
      target_id: proposal.id,
      medium,
      status: 'pending',
      content: generateSnsContent(target, medium),
      // 全自動時はシステム承認扱い（approved_by は人ではないので null のまま）
      approved_at: auto ? now : null,
      error_message: auto ? 'auto post: dispatching' : 'proposal announce: awaiting approval',
    }))

    const { data: inserted, error } = await supabase
      .from('sns_post_logs')
      .insert(rows)
      .select('id, medium, content')
    if (error || !inserted) {
      console.error('[sns-announce] insert failed:', error?.message)
      return { created: 0, dispatched: 0, auto }
    }

    if (!auto) {
      // 管理画面は毎日開かれるとは限らないため、承認待ちができたことを
      // 管理者へ積極的に知らせる（ベル＋Webプッシュ＋メール、いずれも best-effort）
      await notifyAdminsOfPendingDrafts(supabase, proposal.title, inserted.length)
      return { created: inserted.length, dispatched: 0, auto }
    }

    const results = await dispatchLogs(
      supabase,
      inserted.map((r) => ({ id: r.id as string, medium: r.medium as SnsMedium, content: r.content as string | null })),
    )
    const dispatched = results.filter((r) => r.outcome === 'success').length
    return { created: inserted.length, dispatched, auto }
  } catch (e) {
    // SNS 告知は best-effort。提案作成そのものを失敗させない
    console.error('[sns-announce] failed:', e instanceof Error ? e.message : e)
    return { created: 0, dispatched: 0, auto: false }
  }
}

// 承認待ちの下書きができたことを管理者全員に知らせる。
// アプリ内通知（ベル＋Webプッシュ）と ADMIN_NOTIFY_EMAIL へのメールの2経路。
async function notifyAdminsOfPendingDrafts(
  supabase: SupabaseClient,
  proposalTitle: string,
  draftCount: number,
) {
  // 1. アプリ内通知：admin_role を持つメンバー全員へ
  try {
    const { data: admins } = await supabase
      .from('members')
      .select('id')
      .not('admin_role', 'is', null)
      .is('deleted_at', null)
    for (const a of admins ?? []) {
      await insertNotification({
        recipientId: a.id as string,
        kind: 'system',
        title: `SNS投稿の承認待ちが ${draftCount} 件あります`,
        body: `提案「${proposalTitle}」の告知文が作成されました。管理画面で確認・承認すると配信されます`,
        linkUrl: '/admin/sns',
      })
    }
  } catch (e) {
    console.error('[sns-announce] admin in-app notify failed:', e instanceof Error ? e.message : e)
  }

  // 2. メール通知（bug-report と同じ Resend 経路）
  try {
    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''
    const to = process.env.ADMIN_NOTIFY_EMAIL ?? ''
    if (!apiKey || !from || !to) return
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: normalizeMailFrom(from),
      to,
      subject: `【CiDAO】SNS告知の承認待ち：提案「${proposalTitle}」`,
      text: [
        `新しい提案の SNS 告知文（${draftCount} 件）が承認待ちになりました。`,
        ``,
        `提案: ${proposalTitle}`,
        ``,
        `管理画面で本文を確認・修正のうえ承認すると、各SNSに配信されます。`,
        `${SITE_BASE}/admin/sns`,
      ].join('\n'),
    })
  } catch (e) {
    console.error('[sns-announce] admin mail failed:', e instanceof Error ? e.message : e)
  }
}
