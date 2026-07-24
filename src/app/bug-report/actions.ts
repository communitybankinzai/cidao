'use server'

import { randomUUID } from 'crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * 不具合・要望レポートを受け付ける。
 *
 * - bug_reports に1行 INSERT（RLS: anon/authenticated どちらも可、reporter_idは自分のみ）
 * - 管理者メール(ADMIN_NOTIFY_EMAIL)へ Resend で通知
 * - 通知結果の書き戻しはUPDATE policyがadmin限定のため service_role 経由（best-effort）
 */
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL ?? 'communitybankinzai@gmail.com'

const SOURCES = ['cbi_site', 'cidao_app'] as const
const CATEGORIES = ['bug', 'feature_request', 'other'] as const
type Source = (typeof SOURCES)[number]
type Category = (typeof CATEGORIES)[number]

const CATEGORY_LABEL: Record<Category, string> = {
  bug: '不具合',
  feature_request: '要望',
  other: 'その他',
}
const SOURCE_LABEL: Record<Source, string> = {
  cbi_site: 'CBIサイト',
  cidao_app: 'CiDAOアプリ',
}

export async function submitBugReport(input: {
  source: Source
  category: Category
  description: string
  pageUrl?: string
  reporterEmail?: string
  reporterName?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const description = input.description.trim()
  if (description.length < 1 || description.length > 2000) {
    throw new Error('内容は1〜2000字で入力してください')
  }
  if (!SOURCES.includes(input.source)) {
    throw new Error('不正な送信元です')
  }
  if (!CATEGORIES.includes(input.category)) {
    throw new Error('不正な種別です')
  }

  const reporterEmail = input.reporterEmail?.trim() || user?.email || null
  const reporterName = input.reporterName?.trim() || null

  // 未ログイン投稿者にはSELECT policyがなく、insert().select()のRETURNINGでRLS違反になるため
  // idを事前生成してinsertのみ行う（RETURNING不要）
  const reportId = randomUUID()

  const { error: insertErr } = await supabase
    .from('bug_reports')
    .insert({
      id: reportId,
      reporter_id: user?.id ?? null,
      reporter_email: reporterEmail,
      reporter_name: reporterName,
      source: input.source,
      page_url: input.pageUrl ?? null,
      category: input.category,
      description,
    })
  if (insertErr) throw new Error(`報告の保存に失敗しました: ${insertErr.message}`)

  let emailSentAt: string | null = null
  let emailError: string | null = null

  try {
    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''
    if (!apiKey || !from) {
      emailError = 'RESEND_API_KEY or MAIL_FROM not configured'
    } else {
      const { Resend } = await import('resend')
      const resend = new Resend(apiKey)

      const { error: sendErr } = await resend.emails.send({
        from,
        to: ADMIN_NOTIFY_EMAIL,
        subject: `【${SOURCE_LABEL[input.source]}】${CATEGORY_LABEL[input.category]}の報告が届きました`,
        text: [
          `${SOURCE_LABEL[input.source]} から新しい報告が届きました。`,
          ``,
          `─────────────────────────────`,
          `種別: ${CATEGORY_LABEL[input.category]}`,
          `報告者: ${reporterName ?? '(未入力)'}`,
          `連絡先: ${reporterEmail ?? '(連絡先なし)'}`,
          `ページ: ${input.pageUrl ?? '(不明)'}`,
          `─────────────────────────────`,
          `内容:`,
          ``,
          description,
          ``,
          `─────────────────────────────`,
          `管理画面: https://cidao.vercel.app/admin/bug-reports`,
        ].join('\n'),
        replyTo: reporterEmail ?? undefined,
      })
      if (sendErr) {
        emailError = sendErr.message ?? 'resend send failed'
      } else {
        emailSentAt = new Date().toISOString()
      }
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e)
  }

  try {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (supaUrl && serviceKey) {
      const admin = createSupabaseClient(supaUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      await admin
        .from('bug_reports')
        .update({ email_sent_at: emailSentAt, email_error: emailError })
        .eq('id', reportId)
    }
  } catch {
    // best-effort。通知の書き戻し失敗は投稿自体の成否に影響させない
  }

  return { ok: true, id: reportId, emailSent: !!emailSentAt }
}
