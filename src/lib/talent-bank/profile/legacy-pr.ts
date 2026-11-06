import 'server-only'
import type { createTalentBankServiceClient } from '../db'
import type { PublicScope } from '../types'

type ServiceClient = ReturnType<typeof createTalentBankServiceClient>

// 人材バンクの公開範囲 → 旧表（member_profiles_pr）の公開範囲。
// 旧表は声がけの送信可否・掲載人数・AI の紹介一覧が今も読んでいて、読める人は旧表の公開範囲（RLS）で決まる：
//   public = 誰でも / registered_only = ログインした人 / consent_only = 本人だけ
const LEGACY_SCOPE = { public: 'public', registered_only: 'registered_only', private: 'consent_only' } as const

/**
 * 旧表の公開範囲を、人材バンクの今の公開範囲に合わせる（2026-11-06）。
 * 2026-09-15 の一本化以降、範囲の変更や取り下げが旧表に反映されず、本人が狭めても旧表だけ広いまま残る人がいた。
 * - scope に範囲を渡す：旧表の公開範囲をそれに合わせる。旧表に行が無い人には、画面の既定と同じ「おすすめ経由のみ」の行を作る
 *   （行が無いと声がけが「受け付けていません」になる）。非公開の人には行を作らない
 * - scope に null を渡す：公開していない状態（取り下げ後）。旧表は本人だけが読める範囲にする
 * 声がけ受付の設定（message_acceptance）や旧表の本文欄は変えない。失敗しても呼び出し元の処理は成功させる。
 */
export async function syncLegacyPr(db: ServiceClient, memberId: string, scope: PublicScope | null) {
  try {
    const target = scope ? LEGACY_SCOPE[scope] : 'consent_only'
    const updated = await db.from('member_profiles_pr').update({ public_scope: target }).eq('member_id', memberId).select('member_id')
    if (updated.error) throw new Error('legacy scope update failed')
    if ((updated.data ?? []).length > 0 || (target !== 'public' && target !== 'registered_only')) return
    const created = await db.from('member_profiles_pr').upsert(
      { member_id: memberId, message_acceptance: 'recommended_only', public_scope: target },
      { onConflict: 'member_id', ignoreDuplicates: true },
    )
    if (created.error) throw new Error('legacy row create failed')
  } catch { console.error('[talent-bank] legacy pr sync failed') }
}
