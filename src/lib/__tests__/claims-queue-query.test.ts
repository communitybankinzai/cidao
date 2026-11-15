import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 2026-11-16：/admin/claims の問い合わせがエラーになり、そのエラーが表示されず
// 「承認待ちの申告はありません」と出ていた。新しい団体の申告3件が17〜33日のあいだ、だれにも見えなかった。
// 原因は、memberships から members への関係が2本（member_id・approved_by）あるのに、どちらか指定していなかったこと。
// 同じ形に戻らないよう、画面のソースを直接確かめる。
const SRC = join(__dirname, '..', '..', 'app')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

describe('所属申告キュー（/admin/claims）の問い合わせ', () => {
  const page = read('admin/claims/page.tsx')

  it('members への関係を member_id の側に指定している', () => {
    expect(page).toContain('members!memberships_member_id_fkey(')
  })

  it('関係を指定しない members( の埋め込みを使っていない', () => {
    expect(page).not.toMatch(/[\s,]members\(/)
  })

  it('読み込みのエラーを受け取り、画面に出している（0件に見せない）', () => {
    expect(page).toContain('error: claimsError')
    expect(page).toMatch(/claimsError \?/)
  })
})

describe('管理トップの承認待ちの件数', () => {
  const page = read('admin/page.tsx')

  it('所属申告の承認待ちを数えて出している', () => {
    expect(page).toContain("eq('status', 'claimed')")
    expect(page).toContain('承認待ち {pendingClaims}件')
  })

  it('数えられなかったときに0件扱いにしない', () => {
    expect(page).toContain('件数を確認できません')
  })
})

describe('団体の新規登録（createOrganization）', () => {
  const actions = read('orgs/actions.ts')
  const start = actions.indexOf('export async function createOrganization')
  const end = actions.indexOf('export async function', start + 10)
  const body = actions.slice(start, end)

  it('登録した団体をその場で公開する（承認待ちにしない）', () => {
    expect(body).toContain('public_flag: true')
    expect(body).not.toContain('public_flag: isAdmin')
  })

  it('登録した本人の所属を承認済みで作る', () => {
    expect(body).toContain("status: 'confirmed'")
    expect(body).not.toContain("'claimed'")
  })

  it('一般の会員の登録でも、全会員への新着通知を出す', () => {
    expect(body).toContain('notifyAllMembers')
    expect(body).not.toMatch(/if \(isAdmin\) \{\s*after\(/)
  })
})
