'use server'

// 管理画面「SNS 定期紹介」の下書き作成・承認まわり。
// 開発仕様書 v2.1 §3.11.4「立ち上げ期：運営事前承認」に対応する。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { generateSnsContent } from '@/lib/sns-template'
import { fetchSnsTarget } from '@/lib/sns-target'
import { dispatchLogs } from '@/lib/sns-dispatch'

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

// Server Action の throw は本番ビルドでメッセージがマスクされ
// 「An error occurred in the Server Components render」としか表示されない。
// 運営が原因を読めるよう、下書き系のエラーはすべて戻り値で返す。
export type DraftResult = { ok: true; content?: string } | { ok: false; error: string }

// テンプレートから下書きを作り直す（掲載内容を直したあとの作り直しにも使う）。
// 生成した本文を content で返す。呼び出し側の textarea は制御コンポーネントで、
// revalidatePath による再描画では state が初期化されないため、
// 戻り値を使って画面へ反映させる必要がある。
export async function regenerateDraft(logId: string): Promise<DraftResult> {
  try {
    const { supabase } = await requireAdmin()

    const { data: log } = await supabase
      .from('sns_post_logs')
      .select('id, target_type, target_id, medium')
      .eq('id', logId)
      .maybeSingle()
    if (!log) return { ok: false, error: '投稿ログが見つかりません' }

    const row = log as LogRow
    const target = await fetchSnsTarget(supabase, row.target_type, row.target_id)
    if (!target) return { ok: false, error: '紹介対象が見つかりません（削除・公開終了、または取得エラー）' }

    const content = generateSnsContent(target, row.medium)
    const { error } = await supabase
      .from('sns_post_logs')
      // 本文が変わったので承認は取り消す（承認した文面と違うものが飛ばないように）
      .update({ content, approved_at: null, approved_by: null })
      .eq('id', logId)
    if (error) return { ok: false, error: `下書きの保存に失敗しました: ${error.message}` }

    revalidatePath('/admin/sns')
    return { ok: true, content }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 運営が手で直した本文を保存する（承認はしない）
export async function saveDraft(logId: string, content: string): Promise<DraftResult> {
  try {
    const { supabase } = await requireAdmin()
    const text = content.trim()
    if (!text) return { ok: false, error: '本文が空です' }

    const { error } = await supabase
      .from('sns_post_logs')
      .update({ content: text, approved_at: null, approved_by: null })
      .eq('id', logId)
    if (error) return { ok: false, error: `保存に失敗しました: ${error.message}` }

    revalidatePath('/admin/sns')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 承認する。承認された行だけが /api/sns/dispatch の配信対象になる
export async function approveDraft(logId: string, content: string): Promise<DraftResult> {
  try {
    const { supabase, user } = await requireAdmin()
    const text = content.trim()
    if (!text) return { ok: false, error: '本文が空のままでは承認できません' }

    const { error } = await supabase
      .from('sns_post_logs')
      .update({ content: text, approved_at: new Date().toISOString(), approved_by: user.id })
      .eq('id', logId)
    if (error) return { ok: false, error: `承認に失敗しました: ${error.message}` }

    revalidatePath('/admin/sns')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function unapproveDraft(logId: string): Promise<DraftResult> {
  try {
    const { supabase } = await requireAdmin()
    const { error } = await supabase
      .from('sns_post_logs')
      .update({ approved_at: null, approved_by: null })
      .eq('id', logId)
    if (error) return { ok: false, error: `承認の取り消しに失敗しました: ${error.message}` }

    revalidatePath('/admin/sns')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 承認して今すぐ投稿する（18時台の自動配信を待たない）。
// イベント当日など急ぎの告知用。承認セット→この1件だけを即時配信する
export async function approveAndDispatchDraft(logId: string, content: string): Promise<DraftResult> {
  try {
    const { supabase, user } = await requireAdmin()
    const text = content.trim()
    if (!text) return { ok: false, error: '本文が空のままでは投稿できません' }

    const { data: log, error: upErr } = await supabase
      .from('sns_post_logs')
      .update({ content: text, approved_at: new Date().toISOString(), approved_by: user.id })
      .eq('id', logId)
      .eq('status', 'pending')
      .select('id, medium, content, target_type, target_id')
      .maybeSingle()
    if (upErr) return { ok: false, error: `承認に失敗しました: ${upErr.message}` }
    if (!log) return { ok: false, error: '対象が見つかりません（配信済みの可能性）' }

    const results = await dispatchLogs(supabase, [{
      id: log.id,
      medium: log.medium,
      content: log.content as string | null,
      target_type: log.target_type,
      target_id: log.target_id,
    }])
    const r = results[0]
    revalidatePath('/admin/sns')
    if (r?.outcome === 'success') return { ok: true }
    return { ok: false, error: `配信できませんでした（${r?.outcome ?? '不明'}）: ${r?.message ?? ''}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 却下：配信しないと決めた下書きをリストから消す（行ごと削除）。
// 未配信（pending）の行だけが対象。配信済み・失敗のログは監査のため消せない。
// 却下してもローテーション対象からは外れないので、いずれ順番が回ってくれば再度候補になる
export async function dismissDraft(logId: string): Promise<DraftResult> {
  try {
    const { supabase } = await requireAdmin()
    const { error } = await supabase
      .from('sns_post_logs')
      .delete()
      .eq('id', logId)
      .eq('status', 'pending')
    if (error) return { ok: false, error: `却下に失敗しました: ${error.message}` }

    revalidatePath('/admin/sns')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
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

  const keywordParams = new URLSearchParams({
    q: '印西市',
    search_type: 'RECENT',
    fields: 'id',
    limit: '1',
    access_token: token,
  })
  const keywordResponse = await fetch(`https://graph.threads.net/keyword_search?${keywordParams}`)
  const keywordSearchReady = keywordResponse.ok

  const { error } = await supabase.from('app_settings').upsert({
    key: 'sns_threads_auth',
    value: {
      user_id: resolvedId,
      access_token: token,
      username: String(j.username ?? ''),
      saved_at: new Date().toISOString(),
      // 長期トークンは60日有効。自動リフレッシュ cron が更新のたびに延長する
      expires_at: new Date(Date.now() + 60 * 86400_000).toISOString(),
      keyword_search_ready: keywordSearchReady,
      keyword_search_checked_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  })
  if (error) throw new Error(`保存に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
  return { username: String(j.username ?? ''), userId: resolvedId, keywordSearchReady }
}

// Instagram の接続情報を検証して保存する（Instagram Login 方式・graph.instagram.com）
export async function saveInstagramAuth(tokenInput: string) {
  const { supabase, user } = await requireAdmin()
  const token = tokenInput.trim()
  if (!token) throw new Error('アクセストークンが空です')

  const r = await fetch(`https://graph.instagram.com/v22.0/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !(j.user_id ?? j.id)) {
    throw new Error(`Instagram API の検証に失敗しました: ${JSON.stringify(j?.error?.message ?? j).slice(0, 200)}`)
  }

  const { error } = await supabase.from('app_settings').upsert({
    key: 'sns_instagram_auth',
    value: {
      user_id: String(j.user_id ?? j.id),
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
  return { username: String(j.username ?? ''), userId: String(j.user_id ?? j.id) }
}

// Instagramの公開ハッシュタグ検索は、投稿用のInstagram Loginトークンとは
// 認証方式が異なる。Facebook Loginで取得したIGプロアカウントIDとトークンを
// 専用設定として分離し、誤って投稿処理へ流用しない。
export async function saveInstagramDiscoveryAuth(userIdInput: string, tokenInput: string) {
  const { supabase, user } = await requireAdmin()
  const userId = userIdInput.trim()
  const token = tokenInput.trim()
  if (!userId || !token) throw new Error('InstagramプロアカウントIDとアクセストークンを入力してください')

  const profileResponse = await fetch(
    `https://graph.facebook.com/v22.0/${encodeURIComponent(userId)}?fields=id,username&access_token=${encodeURIComponent(token)}`,
  )
  const profile = await profileResponse.json().catch(() => ({}))
  if (!profileResponse.ok || !profile.id) {
    throw new Error(`Instagram検索用認証の検証に失敗しました: ${JSON.stringify(profile?.error?.message ?? profile).slice(0, 200)}`)
  }

  const searchParams = new URLSearchParams({
    user_id: userId,
    q: '印西市',
    access_token: token,
  })
  const searchResponse = await fetch(`https://graph.facebook.com/v22.0/ig_hashtag_search?${searchParams}`)
  const searchResult = await searchResponse.json().catch(() => ({}))
  if (!searchResponse.ok) {
    throw new Error(`ハッシュタグ検索権限の確認に失敗しました: ${JSON.stringify(searchResult?.error?.message ?? searchResult).slice(0, 200)}`)
  }

  const { error } = await supabase.from('app_settings').upsert({
    key: 'sns_instagram_discovery_auth',
    value: {
      user_id: String(profile.id),
      access_token: token,
      username: String(profile.username ?? ''),
      saved_at: new Date().toISOString(),
      auth_mode: 'facebook_login',
    },
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  })
  if (error) throw new Error(`保存に失敗しました: ${error.message}`)

  revalidatePath('/admin/sns')
  return { username: String(profile.username ?? ''), userId: String(profile.id) }
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

// 定期紹介ローテーションの実行間隔を変更する。
// 自由な cron 式は受け付けず、プリセットだけを DB 関数
// set_sns_rotation_schedule（security definer・管理者チェック内蔵）に渡す。
export type RotationPreset = 'daily' | 'every2days' | 'weekly' | 'monthly' | 'off'

const ROTATION_PRESETS: RotationPreset[] = ['daily', 'every2days', 'weekly', 'monthly', 'off']

export async function setRotationSchedule(preset: RotationPreset): Promise<DraftResult> {
  try {
    const { supabase } = await requireAdmin()
    if (!ROTATION_PRESETS.includes(preset)) {
      return { ok: false, error: `不正なプリセットです: ${preset}` }
    }
    const { error } = await supabase.rpc('set_sns_rotation_schedule', { p_preset: preset })
    if (error) return { ok: false, error: `間隔の変更に失敗しました: ${error.message}` }
    revalidatePath('/admin/sns')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
