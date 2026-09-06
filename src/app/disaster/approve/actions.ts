'use server'

// 承認ページのボタン処理。トークンだけで実行できるので、
// 「1回しか使えない」「期限を過ぎたら使えない」の2点をサーバー側で必ず確認する。
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { loadSnsCredentials, postToMedium } from '@/lib/sns-dispatch'
import type { SnsMedium } from '@/lib/sns-template'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Approval = {
  text: string
  igText?: string
  imageUrl?: string
  media: string[]
  reason?: string
  createdAt: string
  expiresAt: string
  status: 'pending' | 'posted' | 'declined' | 'expired'
  result?: Record<string, unknown>
}

const MEDIA: SnsMedium[] = ['threads', 'instagram', 'facebook']

async function readApproval(token: string) {
  const supabase = adminClient()
  if (!supabase || !/^[A-Za-z0-9_-]{16,80}$/.test(token)) return { supabase: null, approval: null as Approval | null }
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `disaster_approval:${token}`)
    .maybeSingle()
  return { supabase, approval: (data?.value as Approval | undefined) ?? null }
}

async function save(supabase: NonNullable<ReturnType<typeof adminClient>>, token: string, approval: Approval) {
  await supabase.from('app_settings').upsert({ key: `disaster_approval:${token}`, value: approval })
}

export async function approveAction(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const { supabase, approval } = await readApproval(token)
  if (!supabase || !approval) return
  if (approval.status !== 'pending') return
  if (new Date(approval.expiresAt).getTime() < Date.now()) {
    await save(supabase, token, { ...approval, status: 'expired' })
    revalidatePath('/disaster/approve')
    return
  }

  // 二重投稿を防ぐため、投稿を始める前に状態を進めてから実行する
  await save(supabase, token, { ...approval, status: 'posted', result: { startedAt: new Date().toISOString() } })

  const creds = await loadSnsCredentials(supabase)
  const result: Record<string, unknown> = {}
  for (const medium of MEDIA) {
    if (!approval.media.includes(medium)) continue
    const content = medium === 'instagram' && approval.igText ? approval.igText : approval.text
    try {
      const outcome = await postToMedium(medium, content, creds, { imageUrl: approval.imageUrl })
      result[medium] = outcome
    } catch (error) {
      result[medium] = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  await save(supabase, token, { ...approval, status: 'posted', result })
  revalidatePath('/disaster/approve')
}

export async function declineAction(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const { supabase, approval } = await readApproval(token)
  if (!supabase || !approval || approval.status !== 'pending') return
  await save(supabase, token, { ...approval, status: 'declined' })
  revalidatePath('/disaster/approve')
}
