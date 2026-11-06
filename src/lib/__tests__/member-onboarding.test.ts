import { describe, expect, it } from 'vitest'
import { needsProfileSetup } from '../member-onboarding'

describe('needsProfileSetup（本登録まだの会員か）', () => {
  it('仮登録（light）で興味分野が空なら、本登録画面へ案内する', () => {
    expect(needsProfileSetup({ tier: 'light', interests: [] })).toBe(true)
    expect(needsProfileSetup({ tier: 'light', interests: null })).toBe(true)
  })

  it('本登録を終えた人は、興味分野が空でも案内しない（任意になったため）', () => {
    expect(needsProfileSetup({ tier: 'email_only', interests: [] })).toBe(false)
    expect(needsProfileSetup({ tier: 'verified', interests: [] })).toBe(false)
    expect(needsProfileSetup({ tier: 'email_only', interests: null })).toBe(false)
  })

  it('仮登録のままでも興味分野が入っている人は、これまでどおり案内しない', () => {
    expect(needsProfileSetup({ tier: 'light', interests: ['environment'] })).toBe(false)
  })

  it('会員区分が読めないときは案内しない（読み取り失敗でログインを妨げない）', () => {
    expect(needsProfileSetup({ tier: null, interests: [] })).toBe(false)
    expect(needsProfileSetup({ tier: undefined, interests: [] })).toBe(false)
  })
})
