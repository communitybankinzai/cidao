'use server'

// 管理画面「SNS 定期紹介」の下書き作成・承認まわり。
// 開発仕様書 v2.1 §3.11.4「立ち上げ期：運営事前承認」に対応する。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { generateSnsContent } from '@/lib/sns-template'
import { fetchSnsTarget } from '@/lib/sns-target'

type LogRow = {
  id: string
  target_type: 'freefree' | 'event' | 'org' | 'proposal'
  target_id: string
  medium: 'x' | 'facebook' | 'line' | 'threads' | 'instagram'
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) throw new Error('権限がありません')
  return { supabase, user }
}

// テンプレートから下書きを作り直す（掲載内容を直したあとの作り直しにも使う）
export async function regenerateDraft(logId: string) {
  const { supabase } = await requireAdmin()

  const { data: log } = await supabase
    .from('sns_post_logs')
    .select('id, target_type, target_id, medium')
    .eq('id', logId)
    .maybeSingle()
  if (!log) throw new Error('投稿ログが見つかりません')

  const row = log as LogRow
  const target = await fetchSnsTarget(supabase, row.target_type, row.target_id)
  if (!target) throw new Error('紹介対象が削除されたか、公開が終了しています')

  const content = generateSnsContent(target, row.medium)
  const { error } = await supabase
    .from('sns_post_logs')
    // 本文が変わったので承認は取り消す（承認した文面と違うものが飛ばないように）
    .update({ content, approved_at: null, approved_by: null })
    .eq('id', logId)
  if (error) throw new Error(`下書きの保存に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
}

// 運営が手で直した本文を保存する（承認はしない）
export async function saveDraft(logId: string, content: string) {
  const { supabase } = await requireAdmin()
  const text = content.trim()
  if (!text) throw new Error('本文が空です')

  const { error } = await supabase
    .from('sns_post_logs')
    .update({ content: text, approved_at: null, approved_by: null })
    .eq('id', logId)
  if (error) throw new Error(`保存に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
}

// 承認する。承認された行だけが /api/sns/dispatch の配信対象になる
export async function approveDraft(logId: string, content: string) {
  const { supabase, user } = await requireAdmin()
  const text = content.trim()
  if (!text) throw new Error('本文が空のままでは承認できません')

  const { error } = await supabase
    .from('sns_post_logs')
    .update({ content: text, approved_at: new Date().toISOString(), approved_by: user.id })
    .eq('id', logId)
  if (error) throw new Error(`承認に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
}

export async function unapproveDraft(logId: string) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase
    .from('sns_post_logs')
    .update({ approved_at: null, approved_by: null })
    .eq('id', logId)
  if (error) throw new Error(`承認の取り消しに失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
}

// Threads の接続情報を検証して保存する。
// トークンは Vercel の環境変数ではなく DB（app_settings）に保管する。
// 運営が管理画面だけで更新でき、cron の自動リフレッシュも書き戻せるようにするため。
export async function saveThreadsAuth(userIdInput: string, tokenInput: string) {
  const { supabase, user } = await requireAdmin()
  const token = tokenInput.trim()
  const userId = userIdInput.trim()
  if (!token) throw new Error('アクセストークンが空です')

  // 保存前に実際に API を叩いて検証する（貼り間違い・失効トークンの事故防止）。
  // user_id 未入力なら /me から自動取得する
  const r = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.id) {
    throw new Error(`Threads API の検証に失敗しました: ${JSON.stringify(j?.error?.message ?? j).slice(0, 200)}`)
  }
  const resolvedId = userId || String(j.id)

  const { error } = await supabase.from('app_settings').upsert({
    key: 'sns_threads_auth',
    value: {
      user_id: resolvedId,
      access_token: token,
      username: String(j.username ?? ''),
      saved_at: new Date().toISOString(),
      // 長期トークンは60日有効。自動リフレッシュ cron が更新のたびに延長する
      expires_at: new Date(Date.now() + 60 * 86400_000).toISOString(),
    },
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  })
  if (error) throw new Error(`保存に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
  return { username: String(j.username ?? ''), userId: resolvedId }
}

// Facebook ページの接続情報を検証して保存する
export async function saveFacebookAuth(pageIdInput: string, tokenInput: string) {
  const { supabase, user } = await requireAdmin()
  const token = tokenInput.trim()
  const pageId = pageIdInput.trim()
  if (!pageId || !token) throw new Error('ページIDとアクセストークンの両方を入力してください')

  const r = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(pageId)}?fields=id,name&access_token=${encodeURIComponent(token)}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.id) {
    throw new Error(`Facebook API の検証に失敗しました: ${JSON.stringify(j?.error?.message ?? j).slice(0, 200)}`)
  }

  const { error } = await supabase.from('app_settings').upsert({
    key: 'sns_facebook_auth',
    value: {
      page_id: pageId,
      access_token: token,
      page_name: String(j.name ?? ''),
      saved_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  })
  if (error) throw new Error(`保存に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
  return { pageName: String(j.name ?? '') }
}

// 提案告知の全自動モード切替。
// ON: 提案作成と同時に承認なしで各SNSへ即配信する（A4運営ルールの承認を省略
//     する運用になるため、切り替えは管理画面から明示的に行う）
// OFF: 従来どおり承認待ちにして、管理者へ通知だけ飛ばす
export async function setSnsAutoPost(enabled: boolean) {
  const { supabase, user } = await requireAdmin()
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key: 'sns_auto_post',
      value: { enabled },
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
  if (error) throw new Error(`設定の保存に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
}
