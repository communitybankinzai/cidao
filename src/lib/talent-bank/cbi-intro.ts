import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { CONSENT_TEXTS, hasConsent, recordConsent } from '@/lib/consents'
import { insertNotification } from '@/lib/notify'
import { createTalentBankServiceClient } from './db'
import { memberClient } from './interview/access'
import { adminClient } from './profile/access'
import { ProfileError, shortText } from './profile/validation'
import type { CbiIntro } from './types'

// 他己紹介（2026-09-15 中司さん決定）：本人が「CBI が書いてよい」に同意 → 運営が書く → 本人が確認して承認したものだけ載せる。
// 紹介ページで見られるのはログインした会員だけ（RLS）。下書きはまず運営が手で書き、AI の下書きは後で足す（draft_source）。
// 書き込みは service_role で行い、本人・運営かどうかはここで確かめる。記録・通知に本文は残さない。
export const INTRO_MAX = 400
const KIND = 'cbi_intro' as const

async function consentActive(memberId: string) {
  const r = await createTalentBankServiceClient().from('consents').select('id').eq('member_id', memberId)
    .eq('kind', KIND).is('subject_id', null).is('revoked_at', null).limit(1)
  if (r.error) throw new ProfileError('consent_unavailable')
  return !!r.data?.length
}
async function notify(recipientId: string | null, title: string, linkUrl: string, body?: string) {
  if (!recipientId) return
  try { await insertNotification({ recipientId, kind: 'member', title, body, linkUrl }) }
  catch { console.error('[talent-bank] cbi intro notification failed') }
}

// 本人：同意しているかと、運営が確認を依頼した後の他己紹介（書きかけの下書きは見せない）
export async function ownIntroState(memberId: string): Promise<{ consented: boolean; intro: CbiIntro | null }> {
  const consented = await hasConsent({ memberId, kind: KIND, version: CONSENT_TEXTS.cbi_intro.version })
  const row = await createTalentBankServiceClient().from('member_cbi_intros').select('*').eq('member_id', memberId).maybeSingle()
  if (row.error) throw new ProfileError('intro_unavailable')
  return { consented, intro: row.data && row.data.status !== 'draft' ? row.data : null }
}

// 本人：同意する／取り消す。取り消したら掲載・確認待ちも止める（本文は運営のために残す）
export async function setIntroConsent(memberId: string, on: boolean) {
  if (on) {
    if (!await hasConsent({ memberId, kind: KIND, version: CONSENT_TEXTS.cbi_intro.version })) await recordConsent({ memberId, kind: KIND })
    return
  }
  const db = await memberClient(memberId) // 同意の取り消しは本人の権限で行う
  const revoked = await db.from('consents').update({ revoked_at: new Date().toISOString() })
    .eq('member_id', memberId).eq('kind', KIND).is('subject_id', null).is('revoked_at', null)
  if (revoked.error) throw new ProfileError('consent_unavailable')
  const stopped = await createTalentBankServiceClient().from('member_cbi_intros')
    .update({ status: 'draft', published_at: null }).eq('member_id', memberId).neq('status', 'draft')
  if (stopped.error) throw new ProfileError('save_conflict')
}

// 運営：同意している人の一覧（自己紹介文と今の他己紹介）
export async function adminIntroQueue(adminId: string) {
  await adminClient(adminId)
  const service = createTalentBankServiceClient()
  const consents = await service.from('consents').select('member_id').eq('kind', KIND).is('subject_id', null).is('revoked_at', null)
  if (consents.error) throw new ProfileError('consent_unavailable')
  const ids = [...new Set((consents.data ?? []).map(c => c.member_id))]
  if (!ids.length) return []
  const [members, intros] = await Promise.all([
    service.from('members').select('id, display_name, self_introduction').in('id', ids).is('deleted_at', null),
    service.from('member_cbi_intros').select('*').in('member_id', ids),
  ])
  if (members.error || intros.error) throw new ProfileError('intro_unavailable')
  return (members.data ?? []).map(member => ({ member, intro: (intros.data ?? []).find(i => i.member_id === member.id) ?? null }))
}

// 運営：書いて保存する。request=true なら本人に確認を依頼する。書き直すと掲載中でも本人の確認からやり直し
export async function adminSaveIntro({ adminId, memberId, body, minutes, request }: {
  adminId: string; memberId: string; body: string; minutes: number; request: boolean
}) {
  await adminClient(adminId)
  const text = body.trim()
  if (!text || text.length > INTRO_MAX) throw new ProfileError('invalid_text')
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new ProfileError('invalid_work_log')
  if (!await consentActive(memberId)) throw new ProfileError('consent_required')
  const service = createTalentBankServiceClient()
  const now = new Date()
  const saved = await service.from('member_cbi_intros').upsert({
    member_id: memberId, body: text, draft_source: 'manual', written_by: adminId,
    status: request ? 'owner_review' : 'draft', requested_at: request ? now.toISOString() : null,
    owner_approved_at: null, published_at: null,
    // 本人の「直してほしい点」は、確認を依頼し直すまで残す
    ...(request ? { owner_comment: null } : {}),
  }, { onConflict: 'member_id' })
  if (saved.error) throw new ProfileError('save_conflict')
  // 作業時間の記録（本文は残さない）。AI の下書きを足すかどうかの判断材料
  const log = await service.from('work_logs').insert({
    actor_member_id: adminId, kind: 'intro_write', started_at: new Date(now.getTime() - minutes * 60_000).toISOString(),
    ended_at: now.toISOString(), minutes, note: request ? '他己紹介：本人に確認を依頼' : '他己紹介：下書き保存',
  })
  if (log.error) console.error('[talent-bank] intro work log failed')
  if (request) await notify(memberId, 'CBI から他己紹介が届きました。内容を確認してください', '/me/talent',
    '「このまま載せる」か「直してほしい点を書いて戻す」を選べます')
}

// 本人：確認を依頼された他己紹介を承認する／直してほしい点を書いて戻す
export async function ownerRespondIntro({ memberId, approve, comment }: { memberId: string; approve: boolean; comment?: string }) {
  await memberClient(memberId)
  const service = createTalentBankServiceClient()
  const row = await service.from('member_cbi_intros').select('*').eq('member_id', memberId).maybeSingle()
  if (row.error || !row.data || row.data.status !== 'owner_review') throw new ProfileError('stale_version')
  const now = new Date().toISOString()
  let patch: Partial<CbiIntro>
  if (approve) {
    if (!await consentActive(memberId)) throw new ProfileError('consent_required')
    patch = { status: 'published', owner_approved_at: now, published_at: now, owner_comment: null }
  } else {
    const text = shortText(comment ?? '', 1000)
    if (!text) throw new ProfileError('reason_required')
    patch = { status: 'returned', owner_comment: text }
  }
  // 確認待ちのままのときだけ更新する（二重送信・運営の書き直しとぶつかったときは何もしない）
  const updated = await service.from('member_cbi_intros').update(patch).eq('member_id', memberId).eq('status', 'owner_review').select('id')
  if (updated.error || !updated.data?.length) throw new ProfileError('stale_version')
  await notify(row.data.written_by, approve ? '他己紹介が本人に承認され、紹介ページに載りました' : '他己紹介に本人から直してほしい点が届きました',
    '/admin/talent-bank')
}

// 紹介ページ：見る人の権限で読む（未ログイン・同意の取り消し・未掲載は RLS で返らない）
export async function publishedIntro(db: Awaited<ReturnType<typeof createClient>>, memberId: string) {
  const r = await db.from('member_cbi_intros').select('body').eq('member_id', memberId).eq('status', 'published').maybeSingle()
  return r.error || !r.data ? null : (r.data.body as string)
}
