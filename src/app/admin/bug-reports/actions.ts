'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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
