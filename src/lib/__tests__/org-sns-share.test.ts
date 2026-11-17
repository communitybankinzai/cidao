import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { orgSnsShareNote, orgSnsShareOnCreate, shouldAnnounceOrg, orgSnsAutoApprove } from '../org-sns-share'

describe('orgSnsShareOnCreate', () => {
  it('会員が登録したときは、チェックの値をそのまま保存する', () => {
    expect(orgSnsShareOnCreate({ isAdmin: false, asRepresentative: false, checked: true })).toBe(true)
    expect(orgSnsShareOnCreate({ isAdmin: false, asRepresentative: true, checked: false })).toBe(false)
  })

  it('運営が代表者としてではなく登録した団体は「聞いていない」（null）。チェックを入れても希望扱いにしない', () => {
    expect(orgSnsShareOnCreate({ isAdmin: true, asRepresentative: false, checked: true })).toBeNull()
    expect(orgSnsShareOnCreate({ isAdmin: true, asRepresentative: false, checked: false })).toBeNull()
  })

  it('運営でも、自分が代表者の団体ならチェックの値を保存する', () => {
    expect(orgSnsShareOnCreate({ isAdmin: true, asRepresentative: true, checked: true })).toBe(true)
    expect(orgSnsShareOnCreate({ isAdmin: true, asRepresentative: true, checked: false })).toBe(false)
  })
})

describe('shouldAnnounceOrg', () => {
  it('団体が希望しないときだけ、下書きを作らない', () => {
    expect(shouldAnnounceOrg(false)).toBe(false)
    expect(shouldAnnounceOrg(true)).toBe(true)
    expect(shouldAnnounceOrg(null)).toBe(true)
    expect(shouldAnnounceOrg(undefined)).toBe(true)
  })
})

describe('orgSnsShareNote', () => {
  it('希望した団体と、聞いていない団体を見分けられる', () => {
    expect(orgSnsShareNote(true)).toEqual({ text: '団体が紹介を希望', tone: 'ok' })
    expect(orgSnsShareNote(null).tone).toBe('warn')
    expect(orgSnsShareNote(null).text).toContain('団体の依頼ではありません')
    expect(orgSnsShareNote(undefined).text).toContain('団体の依頼ではありません')
    expect(orgSnsShareNote(false).tone).toBe('warn')
  })
})

// 定期紹介の候補を選ぶ関数（pick_next_sns_targets）は、2026-09-15 に古い版から作り直されて
// 8/15 に決めた条件（イベントは対象外・団体は公開中で代表者の関与あり・CBI 自身は対象外）が消えていた。
// いちばん新しい定義に条件が残っていることを、移行ファイルで確かめる。
describe('pick_next_sns_targets のいちばん新しい定義', () => {
  const dir = join(__dirname, '..', '..', '..', 'supabase', 'migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /function\s+(public\.)?pick_next_sns_targets/i.test(readFileSync(join(dir, f), 'utf8')))
  const latest = readFileSync(join(dir, files[files.length - 1]), 'utf8')
  const body = latest.slice(latest.search(/create or replace function\s+(public\.)?pick_next_sns_targets/i))

  it('団体は公開中のものだけ', () => {
    expect(body).toContain('o.public_flag = true')
  })

  it('団体が紹介を希望しないものを外す', () => {
    expect(body).toContain('o.sns_share is distinct from false')
  })

  it('運営元の CBI 自身を外す', () => {
    expect(body).toContain("o.inzai_registration_number is distinct from '08-001'")
  })

  it('代表者の関与が確認できた団体だけ', () => {
    expect(body).toContain("ms.role = 'representative'")
    expect(body).toContain('o.info_verified')
  })

  it('イベントを定期紹介の対象にしない', () => {
    expect(body).not.toMatch(/r\.target_type\s*=\s*'event'/)
  })

  it('FreeFree は紹介を許可した掲載だけ', () => {
    expect(body).toContain('p.sns_share')
  })
  it('承認なしで配信に回すのは、団体が紹介してよいと答えたときだけ', () => {
    expect(orgSnsAutoApprove(true)).toBe(true)
    expect(orgSnsAutoApprove(null)).toBe(false)
    expect(orgSnsAutoApprove(undefined)).toBe(false)
    expect(orgSnsAutoApprove(false)).toBe(false)
  })
})
