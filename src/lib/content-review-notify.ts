// 投稿の審査の通知（2026-11-22）。運営へ「ベル＋スマホのプッシュ＋メール1通」、投稿者へ「確認中です」のベル。
// どれも best-effort（失敗しても投稿・審査の本体は止めない）。メールの作法は sns-announce.ts の notifyAdminsOfPendingDrafts と同じ
// （Resend・宛先 ADMIN_NOTIFY_EMAIL・From は normalizeMailFrom）。

import type { SupabaseClient } from '@supabase/supabase-js'
import { insertNotification } from '@/lib/notify'
import { normalizeMailFrom } from '@/lib/mail'
import {
  HOLD_AUTHOR_NOTICE, adminMailText, adminNoticeText, summarizeOpen, summaryText,
  type OpenReviewRow, type ReviewNoticeInput,
} from '@/lib/content-review'

const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'
export const REVIEW_PATH = '/admin/review'
/** まとめの再通知を同じ日に二重に出さない（手で cron を叩き直したときの重なり防止） */
const SUMMARY_DEDUPE_HOURS = 12

async function sendAdminMail(subject: string, text: string): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''
    const to = process.env.ADMIN_NOTIFY_EMAIL ?? ''
    if (!apiKey || !from || !to) return
    const { Resend } = await import('resend')
    await new Resend(apiKey).emails.send({ from: normalizeMailFrom(from), to, subject, text })
  } catch (e) {
    console.error('[content-review] admin mail failed:', e instanceof Error ? e.message : e)
  }
}

async function adminIds(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from('members').select('id').not('admin_role', 'is', null).is('deleted_at', null)
  return (data ?? []).map((a) => a.id as string)
}

/** notify・hold が出たとき、運営全員へ（ベル＋プッシュ）と、運営あてのメール1通 */
export async function notifyAdminsOfReview(db: SupabaseClient, r: ReviewNoticeInput): Promise<void> {
  try {
    const msg = adminNoticeText(r)
    for (const id of await adminIds(db)) {
      await insertNotification({ recipientId: id, kind: 'system', title: msg.title, body: msg.body, linkUrl: REVIEW_PATH })
    }
  } catch (e) {
    console.error('[content-review] admin in-app notify failed:', e instanceof Error ? e.message : e)
  }
  const mail = adminMailText(r, `${SITE_BASE}${REVIEW_PATH}`)
  await sendAdminMail(mail.subject, mail.text)
}

/** 止めたとき、投稿者へ（理由の区分は書かない） */
export async function notifyAuthorOfHold(authorId: string, linkUrl: string): Promise<void> {
  try {
    await insertNotification({ recipientId: authorId, kind: 'system', title: HOLD_AUTHOR_NOTICE.title, body: HOLD_AUTHOR_NOTICE.body, linkUrl })
  } catch (e) {
    console.error('[content-review] author notify failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * 審査待ち（open の notify・hold・error）が残っているあいだ、毎朝1回まとめて運営に知らせる。
 * 新しい定期実行は足さず、毎朝動いている /api/cron/notify から呼ぶ。0件なら何も出さない。
 * 読めなかったとき・通知に失敗したときも例外は投げない。
 */
export async function notifyAdminsOfOpenReviews(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<{ notified: boolean; total: number; held: number; staleHeld: number; note?: string }> {
  const none = { notified: false, total: 0, held: 0, staleHeld: 0 }
  try {
    const { data, error } = await db
      .from('content_reviews')
      .select('verdict, held, created_at')
      .eq('status', 'open')
      .in('verdict', ['notify', 'hold', 'error'])
      .limit(2000)
    if (error) return { ...none, note: '審査待ちを読めなかった' }
    const s = summarizeOpen((data ?? []) as OpenReviewRow[], now)
    const msg = summaryText(s, `${SITE_BASE}${REVIEW_PATH}`)
    if (!msg) return { ...none, note: '審査待ちは0件' }

    // 同じ日に二重に出さない
    const since = new Date(now.getTime() - SUMMARY_DEDUPE_HOURS * 3600_000).toISOString()
    const { data: recent } = await db
      .from('notifications')
      .select('id')
      .eq('link_url', REVIEW_PATH)
      .like('title', '投稿の審査待ちが%')
      .gte('created_at', since)
      .limit(1)
    if (recent && recent.length > 0) return { ...s, notified: false, note: '直近に通知済み' }

    for (const id of await adminIds(db)) {
      await insertNotification({ recipientId: id, kind: 'system', title: msg.title, body: msg.body, linkUrl: REVIEW_PATH })
    }
    await sendAdminMail(msg.subject, msg.mail)
    return { ...s, notified: true }
  } catch (e) {
    console.error('[content-review] daily summary failed:', e instanceof Error ? e.message : e)
    return { ...none, note: '通知に失敗した' }
  }
}
