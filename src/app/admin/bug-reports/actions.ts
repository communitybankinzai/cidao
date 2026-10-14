'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { insertNotification } from '@/lib/notify'

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const

export async function updateBugReportStatus(id: string, status: string, adminNote: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')

  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error('不正なステータスです')
  }

  const { error } = await supabase
    .from('bug_reports')
    .update({ status, admin_note: adminNote.trim() || null })
    .eq('id', id)
  if (error) throw new Error(`更新に失敗しました: ${error.message}`)

  revalidatePath('/admin/bug-reports')
}

/**
 * 報告者へ返信する。
 *
 * - admin_note（内部メモ）とは別物。ここに書いた文章だけが本人に届く
 * - 届け方はベル🔔＋Webプッシュ（insertNotification）
 * - 未ログインで報告された場合は reporter_id が無いため送れない（記録だけ残す）
 */
export async function replyToBugReport(id: string, replyText: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')

  const text = replyText.trim()
  if (text.length === 0) throw new Error('返信内容を入力してください')
  if (text.length > 2000) throw new Error('返信は2000字以内にしてください')

  const { data: report } = await supabase
    .from('bug_reports')
    .select('id, reporter_id, description')
    .eq('id', id)
    .single()
  if (!report) throw new Error('報告が見つかりません')

  const { error } = await supabase
    .from('bug_reports')
    .update({ reply_text: text, replied_at: new Date().toISOString(), replied_by: user.id })
    .eq('id', id)
  if (error) throw new Error(`返信の保存に失敗しました: ${error.message}`)

  // bug_reports の返信列は最新1件で上書きされるため、1通ずつ履歴にも積む
  const { error: historyError } = await supabase
    .from('bug_report_replies')
    .insert({ report_id: id, body: text, replied_by: user.id })
  if (historyError) throw new Error(`返信履歴の保存に失敗しました: ${historyError.message}`)

  if (report.reporter_id) {
    await insertNotification({
      recipientId: report.reporter_id,
      actorId: user.id,
      kind: 'system',
      title: 'お寄せいただいたご報告に、運営から返信が届きました',
      body: text,
      linkUrl: '/notifications',
    })
  }

  revalidatePath('/admin/bug-reports')
}
