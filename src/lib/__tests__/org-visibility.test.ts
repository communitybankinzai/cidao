import { describe, expect, it } from 'vitest'
import {
  HIDDEN_REASON_MAX,
  buildVisibilityUpdate,
  orgVisibilityKind,
  shouldDeleteOnReject,
  shouldPublishOnApprove,
} from '../org-visibility'

const PUBLIC = { public_flag: true, hidden_by_admin: false }
const PENDING = { public_flag: false, hidden_by_admin: false }
const HIDDEN = { public_flag: false, hidden_by_admin: true }

describe('orgVisibilityKind', () => {
  it('公開・申告中・運営が非公開を区別する', () => {
    expect(orgVisibilityKind(PUBLIC)).toBe('public')
    expect(orgVisibilityKind(PENDING)).toBe('pending')
    expect(orgVisibilityKind(HIDDEN)).toBe('hidden')
  })

  it('印の列が無い古い行（null・未定義）は申告中として扱う', () => {
    expect(orgVisibilityKind({ public_flag: false })).toBe('pending')
    expect(orgVisibilityKind({ public_flag: false, hidden_by_admin: null })).toBe('pending')
  })
})

describe('shouldPublishOnApprove', () => {
  it('申告中の新しい団体だけ、承認で公開する', () => {
    expect(shouldPublishOnApprove(PENDING)).toBe(true)
  })

  it('運営が非公開にした団体は、代表者の申告を承認しても公開に戻さない', () => {
    expect(shouldPublishOnApprove(HIDDEN)).toBe(false)
  })

  it('すでに公開中の団体は何もしない', () => {
    expect(shouldPublishOnApprove(PUBLIC)).toBe(false)
  })
})

describe('shouldDeleteOnReject', () => {
  it('申告中で、承認済みの会員がいなければ団体ごと削除する', () => {
    expect(shouldDeleteOnReject(PENDING, 0)).toBe(true)
  })

  it('申告中でも、承認済みの会員がいれば残す', () => {
    expect(shouldDeleteOnReject(PENDING, 1)).toBe(false)
  })

  it('運営が非公開にした団体は、会員が0人でも削除しない', () => {
    expect(shouldDeleteOnReject(HIDDEN, 0)).toBe(false)
  })

  it('公開中の団体は削除しない', () => {
    expect(shouldDeleteOnReject(PUBLIC, 0)).toBe(false)
  })
})

describe('buildVisibilityUpdate', () => {
  const now = new Date('2026-11-16T00:00:00.000Z')

  it('非公開にするときは、印・理由・日時をそろえて書く', () => {
    expect(buildVisibilityUpdate(false, '  団体から申し出  ', now)).toEqual({
      ok: true,
      update: {
        public_flag: false,
        hidden_by_admin: true,
        hidden_reason: '団体から申し出',
        hidden_at: '2026-11-16T00:00:00.000Z',
      },
    })
  })

  it('理由が空なら非公開にしない', () => {
    expect(buildVisibilityUpdate(false, '   ', now)).toEqual({ ok: false, error: '非公開にする理由を入れてください' })
  })

  it('理由が長すぎたら断る', () => {
    const r = buildVisibilityUpdate(false, 'あ'.repeat(HIDDEN_REASON_MAX + 1), now)
    expect(r.ok).toBe(false)
  })

  it('公開に戻すときは、印・理由・日時を消す（理由は要らない）', () => {
    expect(buildVisibilityUpdate(true, '', now)).toEqual({
      ok: true,
      update: { public_flag: true, hidden_by_admin: false, hidden_reason: '', hidden_at: null },
    })
  })
})
