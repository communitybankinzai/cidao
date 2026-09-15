import 'server-only'
import { createHash } from 'node:crypto'
import { createTalentBankClient } from '@/lib/talent-bank/db'
import type { ConsentKind } from '@/lib/talent-bank/types'

const draft = '（要法務監修・仮文面）'
const eligibility = '18歳以上の本人、店舗・団体の場合は代表者本人が操作する場合に限ります。'
const externalPhoto = 'イラスト化のため外部 AI サービスに写真を送ることがあるため、別途 external_ai の同意が必要です。'
export const CONSENT_TEXTS: Record<ConsentKind, { version: string; text: string }> = {
  interview: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}AIインタビューに回答し、会話原文を1年間保存することに同意します。運営（admin_role がある会員）は全件閲覧できます。` },
  profile: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}回答からプロフィール案を作成します。公開には本人承認と運営承認が必要です。` },
  photo: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}権利を確認した写真の利用に同意します。元写真は非公開で保管します。${externalPhoto}` },
  video: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}写真とプロフィールから動画を制作します。公開には本人承認と運営承認が必要です。${externalPhoto}` },
  sns: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}承認した公開範囲で紹介文をSNSへ掲載することに同意します。` },
  bank: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}承認したプロフィールを人材バンクに掲載することに同意します。` },
  matching: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}依頼条件とプロフィールを比較して候補として紹介することに同意します。` },
  external_ai: { version: '2026-09-14-draft-1', text: `${draft}${eligibility}会話・紹介内容を外部AI（Anthropic）で処理することに同意します。イラスト化のため外部 AI サービスに写真を送ることがあることに同意します。手動生成では運営が学習利用をオフにします。` },
  cbi_intro: { version: '2026-09-15-draft-1', text: `${draft}${eligibility}CBI（運営）が自己紹介文やプロフィールを読んで他己紹介を書き、本人が確認して承認したものだけを、紹介ページ（CiDAO にログインした会員だけが見られる）に掲載することに同意します。同意を取り消すと、掲載も止めます。` },
}

async function memberClient(memberId: string) {
  const db = await createTalentBankClient()
  const { data, error } = await db.auth.getUser()
  if (error || data.user?.id !== memberId) throw new Error('Consent authentication required')
  return db
}

export async function recordConsent({ memberId, subjectId, kind }: { memberId: string; subjectId?: string; kind: ConsentKind }) {
  const db = await memberClient(memberId)
  const text = CONSENT_TEXTS[kind]
  if (!text) throw new Error('Unknown consent kind')
  if (subjectId) {
    const { data, error } = await db.from('talent_subjects').select('id').eq('id', subjectId).eq('owner_member_id', memberId).maybeSingle()
    if (error || !data) throw new Error('Consent subject unavailable')
  }
  const { data, error } = await db.from('consents').insert({
    member_id: memberId, subject_id: subjectId ?? null, kind,
    text_version: text.version, text_hash: createHash('sha256').update(text.text, 'utf8').digest('hex'),
  }).select('*').single()
  if (error || !data) throw new Error('Consent could not be recorded')
  return data
}

export async function hasConsent({ memberId, kind, version, subjectId }: {
  memberId: string; kind: ConsentKind; version: string; subjectId?: string
}): Promise<boolean> {
  const db = await memberClient(memberId)
  let query = db.from('consents').select('id').eq('member_id', memberId).eq('kind', kind)
    .eq('text_version', version).is('revoked_at', null)
  // Member-wide and subject-specific consents must not silently authorize each other.
  query = subjectId ? query.eq('subject_id', subjectId) : query.is('subject_id', null)
  const { data, error } = await query.limit(1)
  if (error) throw new Error('Consent could not be checked')
  return !!data?.length
}

export async function revokeConsent({ memberId, consentId }: { memberId: string; consentId: string }): Promise<void> {
  const db = await memberClient(memberId)
  const { error } = await db.from('consents').update({ revoked_at: new Date().toISOString() })
    .eq('id', consentId).eq('member_id', memberId).is('revoked_at', null)
  if (error) throw new Error('Consent could not be revoked')
}

export async function getOrCreateSelfSubject(memberId: string) {
  const db = await memberClient(memberId)
  const find = () => db.from('talent_subjects').select('*').eq('owner_member_id', memberId).eq('subject_type', 'person').maybeSingle()
  const existing = await find()
  if (existing.error) throw new Error('Self subject lookup failed')
  if (existing.data) return existing.data
  const member = await db.from('members').select('display_name').eq('id', memberId).single()
  if (member.error || !member.data) throw new Error('Member unavailable')
  const inserted = await db.from('talent_subjects').insert({
    owner_member_id: memberId, subject_type: 'person', display_name: member.data.display_name,
    // Creating a draft never implies that adult eligibility has been confirmed.
    is_adult_confirmed: false,
  }).select('*').single()
  if (!inserted.error && inserted.data) return inserted.data
  if (inserted.error?.code === '23505') {
    const concurrent = await find()
    if (!concurrent.error && concurrent.data) return concurrent.data
  }
  throw new Error('Self subject could not be created')
}
