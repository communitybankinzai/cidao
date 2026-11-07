import { describe, expect, it } from 'vitest'
import {
  DIRECT_NOTICE_BODY_MAX,
  DIRECT_NOTICE_TITLE_MAX,
  canSendDirectNotice,
  isDirectNoticePurpose,
  isSafeInAppPath,
  purposeLabel,
  validateDirectNotice,
} from '../direct-notice'

describe('isSafeInAppPath', () => {
  it('サイト内のパスは通す', () => {
    expect(isSafeInAppPath('/events')).toBe(true)
    expect(isSafeInAppPath('/me/edit')).toBe(true)
    expect(isSafeInAppPath('/events/abc?x=1#remind-1d')).toBe(true)
  })

  it('外部サイトへ出るものは弾く', () => {
    expect(isSafeInAppPath('https://example.com')).toBe(false)
    expect(isSafeInAppPath('//example.com')).toBe(false)
    expect(isSafeInAppPath('/\\example.com')).toBe(false)
    expect(isSafeInAppPath('javascript:alert(1)')).toBe(false)
    expect(isSafeInAppPath('events')).toBe(false)
  })

  it('空・空白・制御文字・長すぎるものは弾く', () => {
    expect(isSafeInAppPath('')).toBe(false)
    expect(isSafeInAppPath('/a b')).toBe(false)
    expect(isSafeInAppPath('/a\nb')).toBe(false)
    expect(isSafeInAppPath('/' + 'a'.repeat(300))).toBe(false)
  })
})

describe('validateDirectNotice', () => {
  it('前後の空白を取り、空の本文・リンクは無いものとして扱う', () => {
    const r = validateDirectNotice({ title: '  こんにちは  ', body: '   ', linkUrl: '' })
    expect(r).toEqual({ ok: true, value: { title: 'こんにちは', body: undefined, linkUrl: undefined } })
  })

  it('タイトルが空なら弾く', () => {
    const r = validateDirectNotice({ title: '   ' })
    expect(r.ok).toBe(false)
  })

  it('長さの上限を超えたら弾く', () => {
    expect(validateDirectNotice({ title: 'あ'.repeat(DIRECT_NOTICE_TITLE_MAX + 1) }).ok).toBe(false)
    expect(validateDirectNotice({ title: 'あ'.repeat(DIRECT_NOTICE_TITLE_MAX) }).ok).toBe(true)
    expect(validateDirectNotice({ title: 'a', body: 'あ'.repeat(DIRECT_NOTICE_BODY_MAX + 1) }).ok).toBe(false)
    expect(validateDirectNotice({ title: 'a', body: 'あ'.repeat(DIRECT_NOTICE_BODY_MAX) }).ok).toBe(true)
  })

  it('リンクは外部URL・プロトコル相対を弾く', () => {
    expect(validateDirectNotice({ title: 'a', linkUrl: '/me/edit' }).ok).toBe(true)
    expect(validateDirectNotice({ title: 'a', linkUrl: 'https://example.com' }).ok).toBe(false)
    expect(validateDirectNotice({ title: 'a', linkUrl: '//example.com' }).ok).toBe(false)
  })
})

describe('canSendDirectNotice', () => {
  it('お誘いは連絡許可がある人だけ', () => {
    expect(canSendDirectNotice({ contactPermission: true, purpose: 'invite' }).ok).toBe(true)
    expect(canSendDirectNotice({ contactPermission: false, purpose: 'invite' }).ok).toBe(false)
  })

  it('連絡許可が読めない（null・未定義）ときは許可なしとして止める', () => {
    expect(canSendDirectNotice({ contactPermission: null, purpose: 'invite' }).ok).toBe(false)
    expect(canSendDirectNotice({ contactPermission: undefined, purpose: 'invite' }).ok).toBe(false)
  })

  it('手続き・サポートの連絡は許可に関係なく送れる', () => {
    expect(canSendDirectNotice({ contactPermission: false, purpose: 'support' }).ok).toBe(true)
    expect(canSendDirectNotice({ contactPermission: null, purpose: 'support' }).ok).toBe(true)
  })

  it('止めるときは理由の文を返す', () => {
    const r = canSendDirectNotice({ contactPermission: false, purpose: 'invite' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('連絡を許可')
  })
})

describe('目的の種類', () => {
  it('invite と support だけが目的として使える', () => {
    expect(isDirectNoticePurpose('invite')).toBe(true)
    expect(isDirectNoticePurpose('support')).toBe(true)
    expect(isDirectNoticePurpose('other')).toBe(false)
    expect(isDirectNoticePurpose(undefined)).toBe(false)
  })

  it('画面に出す名前を引ける', () => {
    expect(purposeLabel('invite')).toBe('活動のお誘い・お知らせ')
    expect(purposeLabel('support')).toBe('手続き・サポートの連絡')
    expect(purposeLabel('unknown')).toBe('unknown')
  })
})
