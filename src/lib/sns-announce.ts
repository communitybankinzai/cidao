// 提案（proposals）の SNS 告知下書きを作成する。
// 提案作成のサーバーアクション（after() 内）から呼ばれる。
//
// - 通常（半自動）: sns_post_logs に pending 行を作るだけ。
//   管理画面（/admin/sns）で運営が本文を確認・承認したものだけが配信される。
// - 全自動: app_settings.sns_auto_post.enabled = true のとき、
//   承認済み扱い（approved_at セット）で即配信まで行う。
//
// sns_post_logs への INSERT は一般ユーザーの RLS では許可されていないため、
// service role client で行う（src/lib/notify.ts と同じ方針の best-effort）。

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { generateSnsContent, type SnsMedium, type SnsTarget } from '@/lib/sns-template'
import { fetchSnsTarget } from '@/lib/sns-target'
import { dispatchLogs } from '@/lib/sns-dispatch'
import { insertNotification } from '@/lib/notify'
import { normalizeMailFrom } from '@/lib/mail'
import { canRepostNow, HELD_WITHIN_24H_NOTE, isSameSnsContent } from '@/lib/sns-edit-compare'
import { notifyPendingSnsTakedowns } from '@/lib/sns-takedown'

const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'

// 提案告知に使う媒体。接続済みの媒体だけ下書きを作る
// （未接続媒体の下書きは配信できず「待機」のまま残り続けるため作らない）。
// Facebook はページ未開設で見送り中（2026-08-15）。接続したらここに追加する
const PROPOSAL_MEDIA: SnsMedium[] = ['threads', 'instagram']

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, { auth: { persistSession: false } })
}

export type ProposalAnnounceInput = {
  id: string
  title: string
  body: string
  category: string
}

// 戻り値は記録用。呼び出し側（after()）では失敗しても提案作成自体は成立させる。
export async function announceProposalToSns(
  proposal: ProposalAnnounceInput,
): Promise<{ created: number; dispatched: number; auto: boolean }> {
  const supabase = adminClient()
  if (!supabase) return { created: 0, dispatched: 0, auto: false }

  try {
    // 全自動モードか確認
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'sns_auto_post')
      .maybeSingle()
    const auto = (setting?.value as { enabled?: boolean } | null)?.enabled === true

    const target: SnsTarget = {
      target_type: 'proposal',
      target_id: proposal.id,
      title: proposal.title,
      body: proposal.body,
      category: proposal.category,
      deadline: null, // 作成直後は投票締切が未確定のため文面には入れない
    }

    const now = new Date().toISOString()
    const rows = PROPOSAL_MEDIA.map((medium) => ({
      target_type: 'proposal',
      target_id: proposal.id,
      medium,
      status: 'pending',
      content: generateSnsContent(target, medium),
      // 全自動時はシステム承認扱い（approved_by は人ではないので null のまま）
      approved_at: auto ? now : null,
      error_message: auto ? 'auto post: dispatching' : 'proposal announce: awaiting approval',
    }))

    const { data: inserted, error } = await supabase
      .from('sns_post_logs')
      .insert(rows)
      .select('id, medium, content')
    if (error || !inserted) {
      console.error('[sns-announce] insert failed:', error?.message)
      return { created: 0, dispatched: 0, auto }
    }

    if (!auto) {
      // 管理画面は毎日開かれるとは限らないため、承認待ちができたことを
      // 管理者へ積極的に知らせる（ベル＋Webプッシュ＋メール、いずれも best-effort）
      await notifyAdminsOfPendingDrafts(supabase, `提案「${proposal.title}」`, inserted.length)
      return { created: inserted.length, dispatched: 0, auto }
    }

    const results = await dispatchLogs(
      supabase,
      inserted.map((r) => ({
        id: r.id as string,
        medium: r.medium as SnsMedium,
        content: r.content as string | null,
        target_type: 'proposal',
        target_id: proposal.id,
      })),
    )
    const dispatched = results.filter((r) => r.outcome === 'success').length
    return { created: inserted.length, dispatched, auto }
  } catch (e) {
    // SNS 告知は best-effort。提案作成そのものを失敗させない
    console.error('[sns-announce] failed:', e instanceof Error ? e.message : e)
    return { created: 0, dispatched: 0, auto: false }
  }
}

// 団体の新規登録・紹介内容更新時のSNS告知下書きを作成する（Threads のみ・常に承認制）。
// ローテーション廃止（2026-08-15）に伴い、団体はイベントドリブンで告知する。
// orgs/actions.ts の after() から呼ばれる best-effort。
export async function announceOrgToSns(org: {
  id: string
  name: string
}): Promise<{ created: number }> {
  const supabase = adminClient()
  if (!supabase) return { created: 0 }

  try {
    // 重複抑制：同団体の未配信下書きが残っている、または直近30日に配信済みなら作らない
    // （連続編集や登録→即編集で下書きが積み上がるのを防ぐ）
    const since = new Date(Date.now() - 30 * 86400_000).toISOString()
    const { data: existing } = await supabase
      .from('sns_post_logs')
      .select('id, status, created_at')
      .eq('target_type', 'org')
      .eq('target_id', org.id)
      .or(`status.eq.pending,and(status.eq.success,created_at.gte.${since})`)
      .limit(1)
    if (existing && existing.length > 0) return { created: 0 }

    // 本文は最新のDB内容から生成（更新時は更新後の紹介文で告知するため）
    const { data: row } = await supabase
      .from('organizations')
      .select('name, description')
      .eq('id', org.id)
      .maybeSingle()
    const content = generateSnsContent(
      {
        target_type: 'org',
        target_id: org.id,
        title: String(row?.name ?? org.name),
        body: (row?.description as string | null) ?? null,
      },
      'threads',
    )
    const { error } = await supabase.from('sns_post_logs').insert({
      target_type: 'org',
      target_id: org.id,
      medium: 'threads',
      status: 'pending',
      content,
      approved_at: null,
      error_message: 'org announce: awaiting approval',
    })
    if (error) {
      console.error('[sns-announce] org insert failed:', error.message)
      return { created: 0 }
    }

    await notifyAdminsOfPendingDrafts(supabase, `団体「${org.name}」`, 1)
    return { created: 1 }
  } catch (e) {
    console.error('[sns-announce] org failed:', e instanceof Error ? e.message : e)
    return { created: 0 }
  }
}

// FreeFree の掲載直後に SNS 告知の下書きを作る（2026-09-15・初回は常に承認制）。
// 運営がベル通知で気づいて承認すると、その場で配信される（admin/sns/actions.ts の approveDraft）。
// 2回目以降は定期紹介（run_sns_rotation_cycle）が承認済みで作り、18時台の配信時にカウントダウン付きの本文になる。
// freefree/actions.ts の after() から呼ばれる best-effort。SNS紹介を許可した掲載だけ呼ぶこと。
// Instagram は画像が必須なので、画像のある掲載だけ作る（画像は /api/og/freefree/[id] が JPEG にして渡す）
const FREEFREE_MEDIA: SnsMedium[] = ['threads', 'facebook', 'instagram']

export async function announceFreefreeToSns(
  post: {
    id: string
    title: string
  },
  // forceApproval: 全自動モードでも承認制で作る（編集後の作り直しに使う）。label: 管理者への通知で使う呼び名
  // skipMedia: すでに配信済みの媒体。ここには下書きを作らない（同じ掲載がSNSに2回出るのを防ぐ）
  opts: { forceApproval?: boolean; label?: string; skipMedia?: SnsMedium[] } = {},
): Promise<{ created: number }> {
  const supabase = adminClient()
  if (!supabase) return { created: 0 }

  try {
    // 未配信の下書きが残っていれば作らない（二重作成の防止）
    const { data: existing } = await supabase
      .from('sns_post_logs')
      .select('id')
      .eq('target_type', 'freefree')
      .eq('target_id', post.id)
      .eq('status', 'pending')
      .limit(1)
    if (existing && existing.length > 0) return { created: 0 }

    // 本文は管理画面の「作り直す」・定期紹介と同じ取得ロジックから作る
    const target = await fetchSnsTarget(
      supabase as unknown as Parameters<typeof fetchSnsTarget>[0],
      'freefree',
      post.id,
    )
    if (!target) return { created: 0 }
    const { data: row } = await supabase.from('freefree_posts').select('images, import_source').eq('id', post.id).maybeSingle()
    const isImport = row?.import_source === 'openpoi' || row?.import_source === 'manual'
    // 運営が作った掲載は、写真が無くても画像カード（/api/og/freefree/[id]）を使えるので Instagram にも出せる
    const hasImage = isImport || (Array.isArray(row?.images) && row.images.length > 0)

    // 全自動モード（管理画面「FreeFree 告知の配信モード」＝app_settings.sns_freefree_auto_post）なら
    // 承認済みで作ってその場で配信し、管理者には「配信した」ことを知らせる。既定は承認制
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'sns_freefree_auto_post')
      .maybeSingle()
    const auto = !opts.forceApproval && !isImport && (setting?.value as { enabled?: boolean } | null)?.enabled === true

    const now = new Date().toISOString()
    // 運営が作った掲載は常に承認制。媒体は接続済みの Threads・Instagram だけ（Facebook は未接続で、下書きが待機のまま残るため）
    const media = isImport ? FREEFREE_MEDIA.filter((m) => m !== 'facebook') : FREEFREE_MEDIA
    const skip = new Set(opts.skipMedia ?? [])
    const targets = media.filter((m) => !skip.has(m) && (m !== 'instagram' || hasImage))
    if (targets.length === 0) return { created: 0 }
    const rows = targets.map((medium) => ({
      target_type: 'freefree',
      target_id: post.id,
      medium,
      status: 'pending',
      content: generateSnsContent(target, medium),
      approved_at: auto ? now : null,
      error_message: auto ? 'freefree auto post: dispatching' : 'freefree announce: awaiting approval',
    }))
    const { data: inserted, error } = await supabase
      .from('sns_post_logs')
      .insert(rows)
      .select('id, medium, content')
    if (error || !inserted) {
      console.error('[sns-announce] freefree insert failed:', error?.message)
      return { created: 0 }
    }

    if (!auto) {
      await notifyAdminsOfPendingDrafts(supabase, opts.label ?? `FreeFree「${post.title}」`, inserted.length)
      return { created: inserted.length }
    }

    const results = await dispatchLogs(
      supabase,
      inserted.map((r) => ({
        id: r.id as string,
        medium: r.medium as SnsMedium,
        content: r.content as string | null,
        target_type: 'freefree',
        target_id: post.id,
      })),
    )
    const ok = results.filter((r) => r.outcome === 'success').length
    await notifyAdminsOfAutoPosted(supabase, `FreeFree「${post.title}」`, ok, results.length)
    return { created: inserted.length }
  } catch (e) {
    console.error('[sns-announce] freefree failed:', e instanceof Error ? e.message : e)
    return { created: 0 }
  }
}

// FreeFree の掲載が編集されたとき（2026-09-16）。未送信の下書き（承認待ち・配信待ち）は古い中身なので消し、
// SNS紹介を許可していれば新しい中身で作り直して、運営の承認待ちに戻す。
// 全自動モードでも編集後は承認制にする（編集のたびに勝手に配信されないように）。
// 未送信の下書きがある間は定期紹介（run_sns_rotation_cycle）もこの掲載を候補から外すので、承認されるまで配信は止まる。
// 2026-10-04 修正：
//  - すでに配信済みの媒体には作り直さない（旧版がSNSに出ているのに、承認待ちの下書きが編集のたびに増え、
//    承認すると同じ掲載が2回出ていた）。SNSの文面は古いままだが、掲載ページは常に最新。以後の定期紹介は配信時に最新の中身で本文を作る
//  - 承認から IN_FLIGHT_MINUTES 分以内の行は消さない（配信の最中に消すと、投稿は出るのに記録だけ消える）。
//    消さなかった行が残るので、announceFreefreeToSns の「未配信の下書きが残っていれば作らない」で作り直しも止まる
// 2026-10-05 変更（事業主指示）：配信済みの媒体は「編集しても出さない」をやめ、紹介文が前回から変わっていれば
//   新しい版を自動で出す（repostChangedFreefree）。古い版は SNS 削除待ち（superseded）に載せ、運営がいつでも消せる。
//   中身が同じ・全自動モードがオフ・運営が作った掲載、のときは出さない。前回の配信から24時間以内は、承認待ちの下書きにする
// freefree/actions.ts の updateFreefreePost の after() から呼ばれる best-effort
export const IN_FLIGHT_MINUTES = 10

export async function reannounceFreefreeAfterEdit(post: {
  id: string
  title: string
  snsShare: boolean
}): Promise<void> {
  const supabase = adminClient()
  if (!supabase) return
  try {
    const inFlightSince = new Date(Date.now() - IN_FLIGHT_MINUTES * 60_000).toISOString()
    const { error } = await supabase
      .from('sns_post_logs')
      .delete()
      .eq('target_type', 'freefree')
      .eq('target_id', post.id)
      .eq('status', 'pending')
      .or(`approved_at.is.null,approved_at.lt.${inFlightSince}`)
    if (error) {
      console.error('[sns-announce] freefree edit: old drafts delete failed:', error.message)
      return
    }
    if (!post.snsShare) return

    // 配信済みの記録（媒体ごとに一番新しい1件）。紹介文の比較と、古い版の削除待ちに使う
    const { data: delivered, error: delErr } = await supabase
      .from('sns_post_logs')
      .select('id, medium, content, posted_id, posted_at, created_at')
      .eq('target_type', 'freefree')
      .eq('target_id', post.id)
      .eq('status', 'success')
    if (delErr) {
      console.error('[sns-announce] freefree edit: delivered lookup failed:', delErr.message)
      return
    }
    const latest = new Map<SnsMedium, DeliveredLog>()
    for (const r of (delivered ?? []) as DeliveredLog[]) {
      const cur = latest.get(r.medium)
      if (!cur || (r.posted_at ?? r.created_at) > (cur.posted_at ?? cur.created_at)) latest.set(r.medium, r)
    }

    // 1. まだ配信していない媒体は、これまでどおり承認待ちの下書きを作る
    await announceFreefreeToSns(
      { id: post.id, title: post.title },
      { forceApproval: true, label: `FreeFree「${post.title}」（編集後）`, skipMedia: Array.from(latest.keys()) },
    )

    // 2. 配信済みの媒体は、紹介文が前回から変わっていれば新しい版を自動で出す（古い版は削除待ちに載せる）
    if (latest.size > 0) await repostChangedFreefree(supabase, post, latest)
  } catch (e) {
    console.error('[sns-announce] freefree edit failed:', e instanceof Error ? e.message : e)
  }
}

type DeliveredLog = {
  id: string
  medium: SnsMedium
  content: string | null
  posted_id: string | null
  posted_at: string | null
  created_at: string
}

// 編集後、配信済みの媒体の紹介文が前回から変わっていれば、新しい版を自動で配信する（2026-10-05・事業主指示）。
//  - 比べるのは「前回配信した本文」と「いま作った本文」。カウントダウンの日数・改行の違いは同じとみなす（sns-edit-compare.ts）
//  - 同じ掲載・同じ媒体は、前回の配信から24時間あける。24時間以内に変わった分は、承認待ちの下書き（理由つき）にして運営が判断する
//  - 全自動モードがオフ、または運営が作った掲載のときは出さない（承認が要るのに、承認なしで出さないため）
//  - 配信できたら、古い版を sns_takedowns に reason='superseded' で載せて運営へ知らせる。SNS 上の古い投稿は自動では消さない
async function repostChangedFreefree(
  supabase: SupabaseClient,
  post: { id: string; title: string },
  latest: Map<SnsMedium, DeliveredLog>,
) {
  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sns_freefree_auto_post')
    .maybeSingle()
  const { data: row } = await supabase.from('freefree_posts').select('import_source').eq('id', post.id).maybeSingle()
  const isImport = row?.import_source === 'openpoi' || row?.import_source === 'manual'
  const auto = !isImport && (setting?.value as { enabled?: boolean } | null)?.enabled === true
  if (!auto) return

  const target = await fetchSnsTarget(supabase as unknown as Parameters<typeof fetchSnsTarget>[0], 'freefree', post.id)
  if (!target) return

  const nowMs = Date.now()
  const changed: Array<{ medium: SnsMedium; old: DeliveredLog; content: string }> = []
  const held: Array<{ medium: SnsMedium; old: DeliveredLog; content: string }> = []
  for (const [medium, old] of latest) {
    const content = generateSnsContent(target, medium, nowMs)
    if (isSameSnsContent(old.content, content)) continue
    const item = { medium, old, content }
    if (canRepostNow(old.posted_at ?? old.created_at, nowMs)) changed.push(item)
    else held.push(item)
  }

  // 変わっているが前回の配信から24時間以内の媒体は、自動では出さず、承認待ちの下書きにして理由を残す。
  // 運営が承認して配信できたら、古い版は DB のトリガー（supersedes_log_id）が削除待ちに載せる
  if (held.length > 0) {
    const { data: heldRows, error: heldErr } = await supabase
      .from('sns_post_logs')
      .insert(
        held.map((h) => ({
          target_type: 'freefree',
          target_id: post.id,
          medium: h.medium,
          status: 'pending',
          content: h.content,
          approved_at: null,
          supersedes_log_id: h.old.id,
          error_message: HELD_WITHIN_24H_NOTE,
        })),
      )
      .select('id')
    if (heldErr) console.error('[sns-announce] freefree edit: held draft insert failed:', heldErr.message)
    else await notifyAdminsOfPendingDrafts(supabase, `FreeFree「${post.title}」（編集後・前回の配信から24時間以内）`, heldRows?.length ?? held.length)
  }
  if (changed.length === 0) return

  const now = new Date(nowMs).toISOString()
  const { data: inserted, error } = await supabase
    .from('sns_post_logs')
    .insert(
      changed.map((c) => ({
        target_type: 'freefree',
        target_id: post.id,
        medium: c.medium,
        status: 'pending',
        content: c.content,
        approved_at: now, // 全自動モードのシステム承認（approved_by は人ではないので null のまま）
        error_message: 'freefree edit auto post: dispatching',
      })),
    )
    .select('id, medium, content')
  if (error || !inserted) {
    console.error('[sns-announce] freefree edit repost insert failed:', error?.message)
    return
  }

  const results = await dispatchLogs(
    supabase,
    inserted.map((r) => ({
      id: r.id as string,
      medium: r.medium as SnsMedium,
      content: r.content as string | null,
      target_type: 'freefree',
      target_id: post.id,
    })),
  )

  // 新しい版が出せた媒体だけ、古い版を削除待ちに載せる（出せなかった媒体は古い版が最新のまま）
  const okMedia = new Set(results.filter((r) => r.outcome === 'success').map((r) => r.medium))
  const supersededRows = changed
    .filter((c) => okMedia.has(c.medium))
    .map((c) => ({
      log_id: c.old.id,
      target_id: post.id,
      post_title: post.title,
      medium: c.medium,
      posted_id: c.old.posted_id,
      posted_at: c.old.posted_at,
      reason: 'superseded',
    }))
  if (supersededRows.length > 0) {
    const { error: tdErr } = await supabase
      .from('sns_takedowns')
      .upsert(supersededRows, { onConflict: 'log_id', ignoreDuplicates: true })
    if (tdErr) console.error('[sns-announce] freefree edit: takedown insert failed:', tdErr.message)
    else await notifyPendingSnsTakedowns()
  }
  await notifyAdminsOfAutoPosted(supabase, `FreeFree「${post.title}」（編集後の新しい版）`, okMedia.size, results.length)
}

// 運営が任意のイベントを「イベント紹介」としてSNSへ告知する（イベント詳細ページのボタンから）。
// 常に承認制：下書き（承認待ち）を作るだけで、運営が /admin/sns で本文・画像を確認して承認すると配信される。
// Instagram は画像が必須なので、チラシ画像のあるイベントだけ作る（画像は /api/og/event/[id] が JPEG にして渡す）
const EVENT_MEDIA: SnsMedium[] = ['threads', 'instagram']

export async function announceEventToSns(eventId: string): Promise<
  { ok: true; created: number; media: SnsMedium[] } | { ok: false; error: string }
> {
  const supabase = adminClient()
  if (!supabase) return { ok: false, error: 'サーバー設定が不足しています' }
  try {
    const { data: pending } = await supabase
      .from('sns_post_logs')
      .select('id')
      .eq('target_type', 'event')
      .eq('target_id', eventId)
      .eq('status', 'pending')
      .limit(1)
    if (pending && pending.length > 0) {
      return { ok: false, error: 'このイベントの告知下書きがすでに承認待ちです。管理画面（SNS）で確認してください' }
    }

    const target = await fetchSnsTarget(supabase as unknown as Parameters<typeof fetchSnsTarget>[0], 'event', eventId)
    if (!target) return { ok: false, error: '告知できるのは公開中（open）のイベントだけです' }
    const { data: ev } = await supabase.from('events').select('flyer_image_url').eq('id', eventId).maybeSingle()
    const hasImage = typeof ev?.flyer_image_url === 'string' && ev.flyer_image_url.length > 0

    const media = EVENT_MEDIA.filter((m) => m !== 'instagram' || hasImage)
    const { data: inserted, error } = await supabase
      .from('sns_post_logs')
      .insert(
        media.map((medium) => ({
          target_type: 'event',
          target_id: eventId,
          medium,
          status: 'pending',
          content: generateSnsContent(target, medium),
          approved_at: null,
          error_message: 'event announce: awaiting approval',
        })),
      )
      .select('id')
    if (error || !inserted) return { ok: false, error: `下書きの作成に失敗しました: ${error?.message ?? ''}` }
    return { ok: true, created: inserted.length, media }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 全自動モードで配信したことを管理者全員に知らせる（ベル＋Webプッシュ）。
// 確認なしで公式SNSに出たものを、運営があとから見て必要なら削除できるようにするため
async function notifyAdminsOfAutoPosted(
  supabase: SupabaseClient,
  subjectLabel: string,
  okCount: number,
  total: number,
) {
  try {
    const { data: admins } = await supabase
      .from('members')
      .select('id')
      .not('admin_role', 'is', null)
      .is('deleted_at', null)
    for (const a of admins ?? []) {
      await insertNotification({
        recipientId: a.id as string,
        kind: 'system',
        title: `SNSへ自動配信しました（${okCount}/${total} 件）`,
        body: `${subjectLabel}の告知を全自動モードで配信しました。`
          + (okCount < total ? '配信できなかった分は管理画面の投稿ログから再試行できます。' : '')
          + '内容に問題があれば各SNSで削除してください',
        linkUrl: '/admin/sns',
      })
    }
  } catch (e) {
    console.error('[sns-announce] auto-post notify failed:', e instanceof Error ? e.message : e)
  }
}

// 承認待ちの下書きができたことを管理者全員に知らせる。
// アプリ内通知（ベル＋Webプッシュ）と ADMIN_NOTIFY_EMAIL へのメールの2経路。
// subjectLabel は「提案「◯◯」」「団体「◯◯」」のような対象の呼び名。
async function notifyAdminsOfPendingDrafts(
  supabase: SupabaseClient,
  subjectLabel: string,
  draftCount: number,
) {
  // 1. アプリ内通知：admin_role を持つメンバー全員へ
  try {
    const { data: admins } = await supabase
      .from('members')
      .select('id')
      .not('admin_role', 'is', null)
      .is('deleted_at', null)
    for (const a of admins ?? []) {
      await insertNotification({
        recipientId: a.id as string,
        kind: 'system',
        title: `SNS投稿の承認待ちが ${draftCount} 件あります`,
        body: `${subjectLabel}の告知文が作成されました。管理画面で確認・承認すると配信されます`,
        linkUrl: '/admin/sns',
      })
    }
  } catch (e) {
    console.error('[sns-announce] admin in-app notify failed:', e instanceof Error ? e.message : e)
  }

  // 2. メール通知（bug-report と同じ Resend 経路）
  try {
    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''
    const to = process.env.ADMIN_NOTIFY_EMAIL ?? ''
    if (!apiKey || !from || !to) return
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: normalizeMailFrom(from),
      to,
      subject: `【CiDAO】SNS告知の承認待ち：${subjectLabel}`,
      text: [
        `${subjectLabel}の SNS 告知文（${draftCount} 件）が承認待ちになりました。`,
        ``,
        `管理画面で本文を確認・修正のうえ承認すると、配信されます。`,
        `${SITE_BASE}/admin/sns`,
      ].join('\n'),
    })
  } catch (e) {
    console.error('[sns-announce] admin mail failed:', e instanceof Error ? e.message : e)
  }
}
