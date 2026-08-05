// SNS 実投稿の共通処理。
// /api/sns/dispatch（管理画面からの手動配信）と、提案作成時の全自動配信
// （src/app/proposals/actions.ts）の両方から呼ぶ。二重実装にすると
// 「管理画面からは飛ぶのに自動配信では飛ばない」事故になるため1か所に置く。
//
// 環境変数:
//   FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN
//   LINE_CHANNEL_ACCESS_TOKEN (Messaging API)
//   THREADS_USER_ID + THREADS_ACCESS_TOKEN (Threads API / graph.threads.net)
//   X_BEARER_TOKEN (※ X API 有料化のため Phase 2 で接続予定)
//   Instagram は画像必須（JPEG）のため、画像生成パイプライン整備後に接続する

import type { SnsMedium } from '@/lib/sns-template'

export type PostOutcome = { status: 'success' | 'failed' | 'pending'; message?: string; posted_id?: string }

export async function postToMedium(medium: SnsMedium, content: string): Promise<PostOutcome> {
  if (medium === 'facebook') {
    const pageId = process.env.FACEBOOK_PAGE_ID
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN
    if (!pageId || !token) return { status: 'pending', message: 'credentials missing: FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN' }
    const r = await fetch(`https://graph.facebook.com/v22.0/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: content, access_token: token }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { status: 'failed', message: `FB ${r.status}: ${JSON.stringify(j).slice(0, 200)}` }
    return { status: 'success', posted_id: String(j.id ?? '') }
  }

  if (medium === 'line') {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
    if (!token) return { status: 'pending', message: 'credentials missing: LINE_CHANNEL_ACCESS_TOKEN' }
    // LINE Messaging API broadcast（フォロワー全員に配信）
    const r = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: 'text', text: content.slice(0, 5000) }] }),
    })
    if (!r.ok) {
      const t = await r.text()
      return { status: 'failed', message: `LINE ${r.status}: ${t.slice(0, 200)}` }
    }
    return { status: 'success' }
  }

  if (medium === 'threads') {
    const userId = process.env.THREADS_USER_ID
    const token = process.env.THREADS_ACCESS_TOKEN
    if (!userId || !token) return { status: 'pending', message: 'credentials missing: THREADS_USER_ID / THREADS_ACCESS_TOKEN' }
    // Threads API は 2 ステップ：コンテナ作成 → publish（テキスト投稿は 500 字まで）
    const create = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ media_type: 'TEXT', text: content.slice(0, 500), access_token: token }),
    })
    const cj = await create.json().catch(() => ({}))
    if (!create.ok || !cj.id) return { status: 'failed', message: `Threads create ${create.status}: ${JSON.stringify(cj).slice(0, 200)}` }
    const publish = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: String(cj.id), access_token: token }),
    })
    const pj = await publish.json().catch(() => ({}))
    if (!publish.ok) return { status: 'failed', message: `Threads publish ${publish.status}: ${JSON.stringify(pj).slice(0, 200)}` }
    return { status: 'success', posted_id: String(pj.id ?? cj.id) }
  }

  if (medium === 'instagram') {
    // Instagram Content Publishing は画像（JPEG・公開URL）が必須。
    // 告知カード画像の生成パイプラインを整備してから接続する。
    return { status: 'pending', message: 'Instagram は画像必須のため未接続（告知画像の生成整備後に接続予定）' }
  }

  // x: 有料化のため Phase 2、現状は常に pending
  return { status: 'pending', message: 'X (Twitter) API は有料化により未接続（Phase 2 で接続予定）' }
}

type MinimalSupabase = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function markLog(
  supabase: MinimalSupabase,
  id: string,
  status: 'success' | 'failed' | 'pending',
  message?: string,
  posted_id?: string,
) {
  const payload: Record<string, unknown> = {
    status,
    error_message: status === 'success' ? null : (message ?? null),
  }
  if (status === 'success') {
    payload.posted_at = new Date().toISOString()
    if (posted_id) payload.posted_id = posted_id
  }
  await supabase.from('sns_post_logs').update(payload).eq('id', id)
}

type DispatchableLog = {
  id: string
  medium: SnsMedium
  content: string | null
}

// 承認済み・未送信のログ行を実際に配信して結果を記録する。
export async function dispatchLogs(
  supabase: MinimalSupabase,
  logs: DispatchableLog[],
): Promise<Array<{ id: string; medium: string; outcome: string; message?: string }>> {
  const results: Array<{ id: string; medium: string; outcome: string; message?: string }> = []
  for (const log of logs) {
    // 承認済みの本文をそのまま送る。承認した文面と実際に飛ぶ文面がずれないよう、
    // ここでテンプレートから作り直すことはしない。
    const content = (log.content ?? '').trim()
    if (!content) {
      await markLog(supabase, log.id, 'failed', 'approved but content is empty')
      results.push({ id: log.id, medium: log.medium, outcome: 'failed', message: 'content empty' })
      continue
    }
    try {
      const out = await postToMedium(log.medium, content)
      await markLog(supabase, log.id, out.status, out.message, out.posted_id)
      results.push({ id: log.id, medium: log.medium, outcome: out.status, message: out.message })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await markLog(supabase, log.id, 'failed', msg)
      results.push({ id: log.id, medium: log.medium, outcome: 'failed', message: msg })
    }
  }
  return results
}
