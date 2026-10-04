// FreeFree 掲載の取り下げ（非公開・削除）で生じた「SNS 紹介投稿の削除待ち」を運営へ知らせる。
//
// 削除待ちの行（sns_takedowns）は DB トリガー freefree_withdrawn_to_takedowns が作る
// （supabase/migrations/20261003230000_freefree_sns_takedowns.sql）。ここは通知だけを担う。
// SNS の投稿は自動では消さない。運営が各 SNS で削除し、管理画面で「削除済み」にする。
// 通知経路は notifyAdminsOfPendingDrafts（sns-announce.ts）と同じ：ベル＋Webプッシュ、ADMIN_NOTIFY_EMAIL へのメール。

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { insertNotification } from '@/lib/notify'
import { normalizeMailFrom } from '@/lib/mail'

const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'

export type TakedownRow = {
  id: string
  post_title: string
  medium: string
  posted_id: string | null
  withdrawn_at: string
  // hidden=非公開／deleted=完全削除／superseded=編集して新しい版を出したため古い版の削除待ち
  reason?: string
}

const MEDIUM_LABEL: Record<string, string> = {
  threads: 'Threads',
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  line: 'LINE',
}

export function mediumLabel(medium: string): string {
  return MEDIUM_LABEL[medium] ?? medium
}

// 投稿のURL。Facebook は投稿ID（ページID_投稿ID）から組み立てられる。
// Threads・Instagram は API が返すのが内部IDで、公開URLには直せないため null（IDで探してもらう）
export function postUrlOf(medium: string, postedId: string | null): string | null {
  if (!postedId) return null
  if (medium === 'facebook') return `https://www.facebook.com/${postedId}`
  return null
}

function jst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' })
}

// 1 行ぶんの説明（通知本文・メール本文で共通）
export function describeTakedown(r: TakedownRow): string {
  const url = postUrlOf(r.medium, r.posted_id)
  const where = url ?? (r.posted_id ? `投稿ID ${r.posted_id}` : '投稿IDなし（各SNSで掲載名を探してください）')
  return `${mediumLabel(r.medium)}：${where}`
}

export function groupByPost(rows: TakedownRow[]): Map<string, TakedownRow[]> {
  const m = new Map<string, TakedownRow[]>()
  for (const r of rows) {
    const list = m.get(r.post_title) ?? []
    list.push(r)
    m.set(r.post_title, list)
  }
  return m
}

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, { auth: { persistSession: false } })
}

// 未通知の削除待ちを運営（管理者全員）へ知らせる。best-effort：失敗しても取り下げ操作は成立させる。
// 先に notified_at を刻んでから送る（同時に呼ばれても二重通知にならない）。
// 戻り値は通知した投稿数
export async function notifyPendingSnsTakedowns(): Promise<number> {
  const supabase = adminClient()
  if (!supabase) return 0
  try {
    const { data: claimed, error } = await supabase
      .from('sns_takedowns')
      .update({ notified_at: new Date().toISOString() })
      .is('notified_at', null)
      .select('id, post_title, medium, posted_id, withdrawn_at, reason')
    if (error || !claimed?.length) return 0
    const rows = claimed as TakedownRow[]
    const groups = groupByPost(rows)

    // 1. ベル＋Webプッシュ：掲載ごとに 1 通
    try {
      const { data: admins } = await supabase
        .from('members')
        .select('id')
        .not('admin_role', 'is', null)
        .is('deleted_at', null)
      for (const [title, list] of groups) {
        for (const a of admins ?? []) {
          const old = list[0].reason === 'superseded'
          await insertNotification({
            recipientId: a.id as string,
            kind: 'system',
            title: old
              ? `SNSの古い紹介投稿の削除をお願いします（${list.length} 件）`
              : `SNSの紹介投稿の削除をお願いします（${list.length} 件）`,
            body: (old
              ? `FreeFree「${title}」を編集し、新しい版を投稿しました（${jst(list[0].withdrawn_at)}）。古い版：`
              : `FreeFree「${title}」が取り下げられました（${jst(list[0].withdrawn_at)}）。`)
              + list.map(describeTakedown).join(' / ')
              + ' 各SNSで削除し、管理画面で「削除済み」にしてください',
            linkUrl: '/admin/sns',
          })
        }
      }
    } catch (e) {
      console.error('[sns-takedown] admin in-app notify failed:', e instanceof Error ? e.message : e)
    }

    // 2. メール（bug-report と同じ Resend 経路）
    try {
      const apiKey = process.env.RESEND_API_KEY ?? ''
      const from = process.env.MAIL_FROM ?? ''
      const to = process.env.ADMIN_NOTIFY_EMAIL ?? ''
      if (apiKey && from && to) {
        const { Resend } = await import('resend')
        const resend = new Resend(apiKey)
        const lines: string[] = []
        for (const [title, list] of groups) {
          lines.push(list[0].reason === 'superseded'
            ? `■ ${title}（編集して新しい版を投稿 ${jst(list[0].withdrawn_at)}・古い版）`
            : `■ ${title}（取り下げ ${jst(list[0].withdrawn_at)}）`)
          for (const r of list) lines.push(`  ・${describeTakedown(r)}`)
          lines.push('')
        }
        await resend.emails.send({
          from: normalizeMailFrom(from),
          to,
          subject: `【CiDAO】SNSの紹介投稿の削除待ち：${[...groups.keys()].join('、')}`,
          text: [
            'FreeFree の掲載の取り下げ、または編集で、SNS に出ている古い紹介投稿が残っています。各SNSで削除してください。',
            '削除したら、管理画面で「削除済み」にします。',
            '',
            ...lines,
            `${SITE_BASE}/admin/sns`,
          ].join('\n'),
        })
      }
    } catch (e) {
      console.error('[sns-takedown] admin mail failed:', e instanceof Error ? e.message : e)
    }
    return rows.length
  } catch (e) {
    console.error('[sns-takedown] notify failed:', e instanceof Error ? e.message : e)
    return 0
  }
}
