'use server'

// 管理画面「SNS モニタ対象」の server actions。
// 対象（sns_monitor_accounts）の追加・有効／無効・削除と、団体の sns_links.instagram の取り込み。
// 団体の分は団体編集の SNS 欄で入れると cron が自動で一覧に写すが、ここでもすぐ写せる。

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { instagramProfileUrl, parseInstagramUsername, type MonitorAccount } from '@/lib/instagram-events/accounts'
import { syncOrgAccountsIntoList } from '@/lib/instagram-events/db-supabase'

const PAGE = '/admin/sns-monitor'
const KINDS: MonitorAccount['kind'][] = ['団体', '企業', '行政', 'その他']

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) throw new Error('service role が設定されていません')
  return createSupabaseAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function requireAdmin(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { data: isAdmin, error } = await supabase.rpc('is_admin')
  if (error || !isAdmin) throw new Error('権限がありません')
  return user.id
}

export type MonitorAccountRow = {
  id: string
  username: string
  label: string
  kind: MonitorAccount['kind']
  org_id: string | null
  org_name: string | null
  enabled: boolean
  note: string
  last_checked_at: string | null
  last_error: string | null
  last_post_at: string | null
  created_at: string
  profile_url: string
}

/** 一覧（団体の分を先に写してから返す） */
export async function listMonitorAccounts(): Promise<MonitorAccountRow[]> {
  await requireAdmin()
  const service = serviceClient()
  try {
    await syncOrgAccountsIntoList(service)
  } catch (e) {
    console.error('[sns-monitor] syncOrgAccountsIntoList failed:', e instanceof Error ? e.message : String(e))
  }
  const { data, error } = await service
    .from('sns_monitor_accounts')
    .select('id, username, label, kind, org_id, enabled, note, last_checked_at, last_error, last_post_at, created_at, organizations(name)')
    .eq('platform', 'instagram')
    .order('kind', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as (Omit<MonitorAccountRow, 'org_name' | 'profile_url'> & { organizations: { name: string } | { name: string }[] | null })[]).map((r) => {
    const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
    return { ...r, organizations: undefined, org_name: org?.name ?? null, profile_url: instagramProfileUrl(r.username) }
  })
}

function back(message: string, kind: 'error' | 'ok' = 'ok'): never {
  redirect(`${PAGE}?${kind}=${encodeURIComponent(message)}`)
}

/** 追加（form action）。input は URL／@ユーザー名／ユーザー名のどれでも */
export async function addMonitorAccount(formData: FormData): Promise<void> {
  const userId = await requireAdmin()
  const input = String(formData.get('input') ?? '')
  const label = String(formData.get('label') ?? '').trim().slice(0, 80)
  const kindRaw = String(formData.get('kind') ?? 'その他')
  const kind = (KINDS as string[]).includes(kindRaw) ? (kindRaw as MonitorAccount['kind']) : 'その他'
  const note = String(formData.get('note') ?? '').trim().slice(0, 500)
  const username = parseInstagramUsername(input)
  if (!username) back('Instagram の URL（https://www.instagram.com/xxx/）か @ユーザー名を入れてください', 'error')
  const { error } = await serviceClient()
    .from('sns_monitor_accounts')
    .insert({ platform: 'instagram', username, label: label || username, kind, note, created_by: userId })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) back(`@${username} は登録済みです`, 'error')
    back(`追加に失敗しました：${error.message}`, 'error')
  }
  revalidatePath(PAGE)
  back(`@${username} を追加しました。明朝 06:32 から投稿を読みます（ビジネス／クリエイターアカウントのみ読めます）`)
}

export async function setMonitorAccountEnabled(id: string, enabled: boolean): Promise<void> {
  await requireAdmin()
  const { error } = await serviceClient().from('sns_monitor_accounts').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) back(`変更に失敗しました：${error.message}`, 'error')
  revalidatePath(PAGE)
  redirect(PAGE)
}

export async function deleteMonitorAccount(id: string): Promise<void> {
  await requireAdmin()
  const { error } = await serviceClient().from('sns_monitor_accounts').delete().eq('id', id)
  if (error) back(`削除に失敗しました：${error.message}`, 'error')
  revalidatePath(PAGE)
  back('削除しました（既に登録した候補はそのまま残ります）')
}
