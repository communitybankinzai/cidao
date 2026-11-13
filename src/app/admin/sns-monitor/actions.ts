'use server'

// 管理画面「SNS モニタ対象」の server actions。
// 対象（sns_monitor_accounts）の追加・有効／無効・削除と、団体の sns_links.instagram の取り込み。
// 団体の分は団体編集の SNS 欄で入れると cron が自動で一覧に写すが、ここでもすぐ写せる。

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { instagramProfileUrl, isAccountChildPlace, parseAccountKeywords, parseInstagramUsername, type AccountChildPlace, type MonitorAccount } from '@/lib/instagram-events/accounts'
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
  child_place: AccountChildPlace | null
  child_place_keywords: string[]
  use_events: boolean
  use_gourmet: boolean
  gourmet_hold: string
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
    .select('id, username, label, kind, org_id, enabled, note, last_checked_at, last_error, last_post_at, created_at, child_place, child_place_keywords, use_events, use_gourmet, gourmet_hold, organizations(name)')
    .eq('platform', 'instagram')
    .order('kind', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as (Omit<MonitorAccountRow, 'org_name' | 'profile_url'> & { organizations: { name: string } | { name: string }[] | null })[]).map((r) => {
    const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
    return {
      ...r, organizations: undefined, org_name: org?.name ?? null, profile_url: instagramProfileUrl(r.username),
      // 列が無い（NULL）ときの扱いは巡回と同じ：イベントは既定で使う・食レポは既定で使わない
      use_events: r.use_events !== false, use_gourmet: r.use_gourmet === true, gourmet_hold: r.gourmet_hold ?? '',
    }
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
  const childPlaceRaw = String(formData.get('child_place') ?? '')
  const childPlace = isAccountChildPlace(childPlaceRaw) ? childPlaceRaw : null
  const keywords = parseAccountKeywords(String(formData.get('keywords') ?? ''))
  const useEvents = formData.get('use_events') === 'on'
  const useGourmet = formData.get('use_gourmet') === 'on'
  const username = parseInstagramUsername(input)
  if (!username) back('Instagram の URL（https://www.instagram.com/xxx/）か @ユーザー名を入れてください', 'error')
  if (!useEvents && !useGourmet) back('使い道（イベント・食レポ）を1つ以上選んでください', 'error')
  const { error } = await serviceClient()
    .from('sns_monitor_accounts')
    .insert({ platform: 'instagram', username, label: label || username, kind, note, created_by: userId, child_place: childPlace, child_place_keywords: keywords, use_events: useEvents, use_gourmet: useGourmet })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) back(`@${username} は登録済みです`, 'error')
    back(`追加に失敗しました：${error.message}`, 'error')
  }
  revalidatePath(PAGE)
  back(`@${username} を追加しました。明朝 06:32 から投稿を読みます（ビジネス／クリエイターアカウントのみ読めます）`)
}

/** 取り込む催しの目印と、取り込む投稿の条件語を変える（form action）。目印が空＝固定しない、条件語が空＝全投稿 */
export async function updateMonitorAccountPlace(id: string, formData: FormData): Promise<void> {
  await requireAdmin()
  const childPlaceRaw = String(formData.get('child_place') ?? '')
  const childPlace = isAccountChildPlace(childPlaceRaw) ? childPlaceRaw : null
  const keywords = parseAccountKeywords(String(formData.get('keywords') ?? ''))
  const { error } = await serviceClient()
    .from('sns_monitor_accounts')
    .update({ child_place: childPlace, child_place_keywords: keywords, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) back(`変更に失敗しました：${error.message}`, 'error')
  revalidatePath(PAGE)
  back('取り込む催しの設定を保存しました（次の朝6:32の読み取りから反映）')
}

/** 使い道（イベントの候補づくり／食レポの候補づくり）を変える（form action）。両方外すことはできない */
export async function updateMonitorAccountUses(id: string, formData: FormData): Promise<void> {
  await requireAdmin()
  const useEvents = formData.get('use_events') === 'on'
  const useGourmet = formData.get('use_gourmet') === 'on'
  if (!useEvents && !useGourmet) back('使い道（イベント・食レポ）を1つ以上選んでください。読ませたくないときは「停止」を使います', 'error')
  const { error } = await serviceClient()
    .from('sns_monitor_accounts')
    .update({ use_events: useEvents, use_gourmet: useGourmet, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) back(`変更に失敗しました：${error.message}`, 'error')
  revalidatePath(PAGE)
  back('使い道を保存しました（次の朝6:32の読み取りから反映）')
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
