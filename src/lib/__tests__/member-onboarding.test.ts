import { describe, expect, it } from 'vitest'
import { needsProfileSetup } from '../member-onboarding'

describe('needsProfileSetup（表示名の確認がまだの会員か）', () => {
  it('確認の日時が入っていない人は、確認の画面へ案内する', () => {
    expect(needsProfileSetup({ profile_confirmed_at: null })).toBe(true)
    expect(needsProfileSetup({ profile_confirmed_at: undefined })).toBe(true)
  })

  it('確認を済ませた人は案内しない（興味分野が空でも戻さない）', () => {
    expect(needsProfileSetup({ profile_confirmed_at: '2026-11-28T00:00:00+00:00' })).toBe(false)
  })
})
