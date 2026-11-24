import { describe, expect, it } from 'vitest'
import {
  cityDepartment,
  organizerDisplayName,
  organizerKey,
  phoneticSkeleton,
  stripAnnotations,
} from '../organizer-names'

describe('organizerKey（本番の表記ゆれの実例）', () => {
  it('末尾の「（…の記事より）」「（…の投稿より）」を落として同じ団体にする', () => {
    expect(organizerKey('コスモスパレット（号外NET の記事より）')).toBe(organizerKey('コスモスパレット'))
    expect(organizerKey('印西市商工会（Instagram @inzai_shokokai の投稿より）')).toBe(organizerKey('印西市商工会'))
    expect(organizerKey('主催者不明（Instagram #印西 の投稿より）')).toBe(organizerKey('主催者不明'))
  })

  it('英字は大文字小文字・空白・全角半角の違いだけまとめる', () => {
    expect(organizerKey('Cosmos Palette')).toBe(organizerKey('CosmosPalette'))
    expect(organizerKey('Ｃｏｓｍｏｓ　Ｐａｌｅｔｔｅ')).toBe('cosmospalette')
  })

  it('カナと英字は自動ではまとまらない（名寄せ表で手作業）', () => {
    expect(organizerKey('コスモスパレット')).not.toBe(organizerKey('Cosmos Palette'))
  })

  it('文化ホールの指定管理者の注記（全角・半角・コロンなし・改行入り）を落とす', () => {
    const base = organizerKey('印西市文化ホール')
    expect(organizerKey('印西市文化ホール（指定管理者：株式会社ケイミックスパブリックビジネス）')).toBe(base)
    expect(organizerKey('印西市文化ホール(指定管理者 株式会社ケイミックスパブリックビジネス)')).toBe(base)
    expect(organizerKey('印西市文化ホール\n（指定管理者：株式会社ケイミックスパブリックビジネス）')).toBe(base)
    expect(organizerKey('印西市文化ホール（指定管理者：(株)ケイミックスパブリックビジネス）')).toBe(base)
  })

  it('注記でない括弧は残す', () => {
    expect(stripAnnotations('みんなのおにわ（印西）')).toBe('みんなのおにわ（印西）')
  })

  it('法人格・空白は既存の名寄せと同じ扱い', () => {
    expect(organizerKey('NPO法人 Shake Hands Japan')).toBe('shakehandsjapan')
    expect(organizerKey('特定非営利活動法人　Ｓｈａｋｅ Ｈａｎｄｓ Ｊａｐａｎ')).toBe('shakehandsjapan')
  })

  it('空・null でも落ちない', () => {
    expect(organizerKey('')).toBe('')
    expect(organizerKey(null)).toBe('')
    expect(organizerKey('（Instagram #印西 の投稿より）')).not.toBe('')
  })
})

describe('市の部署は「課」の単位', () => {
  it('文化振興課', () => {
    const k = organizerKey('印西市 教育委員会 生涯学習部文化振興課文化財係')
    expect(k).toBe('印西市文化振興課')
    expect(organizerKey('文化振興課文化振興係')).toBe(k)
    expect(organizerKey('印西市教育委員会 生涯学習部 文化振興課')).toBe(k)
  })

  it('スポーツ振興課', () => {
    const k = organizerKey('スポーツ振興課振興係')
    expect(organizerKey('印西市 健康子ども部 スポーツ振興課 振興係')).toBe(k)
    expect(k).toBe('印西市スポーツ振興課')
  })

  it('都市計画課（「都市」の市を他の市と見ない）', () => {
    expect(organizerKey('都市計画課計画係')).toBe(organizerKey('印西市都市建設部都市計画課計画係'))
    expect(organizerKey('都市計画課計画係')).toBe('印西市都市計画課')
  })

  it('高齢者福祉課（地域包括支援センターとの並記も）', () => {
    const k = organizerKey('印西市 福祉部 高齢者福祉課 包括支援係')
    expect(k).toBe('印西市高齢者福祉課')
    expect(organizerKey('印西市各地域包括支援センター／高齢者福祉課包括支援係')).toBe(k)
  })

  it('表示名は「印西市 ○○課」', () => {
    expect(organizerDisplayName('印西市 教育委員会 生涯学習部文化振興課文化財係')).toBe('印西市 文化振興課')
    expect(organizerDisplayName('印西市文化ホール\n（指定管理者：株式会社ケイミックスパブリックビジネス）')).toBe('印西市文化ホール')
    expect(organizerDisplayName('コスモスパレット（号外NET の記事より）')).toBe('コスモスパレット')
  })

  it('控えめに判定する：課のない名前・他の市県・法人は部署にしない', () => {
    expect(cityDepartment('印西市商工会')).toBeNull()
    expect(cityDepartment('印西市文化ホール')).toBeNull()
    expect(cityDepartment('印西市 ○○係')).toBeNull()
    expect(cityDepartment('千葉県 環境課')).toBeNull()
    expect(cityDepartment('白井市 生涯学習課')).toBeNull()
    expect(cityDepartment('印西市社会福祉協議会 地域福祉課')).toBeNull()
    expect(cityDepartment('コスモスパレット')).toBeNull()
  })

  it('印西市で始まらない名前は、課・係・室で終わるときだけ部署にする', () => {
    expect(cityDepartment('市民活動推進課')).toBe('市民活動推進課')
    expect(cityDepartment('課のおはなし会')).toBeNull()
  })
})

describe('phoneticSkeleton（カナ⇔英字の候補用）', () => {
  it('コスモスパレットと Cosmos Palette は同じ並びになる', () => {
    const a = phoneticSkeleton(organizerKey('コスモスパレット'))
    expect(a).toBe('ksmsprt')
    expect(phoneticSkeleton(organizerKey('Cosmos Palette'))).toBe(a)
    expect(phoneticSkeleton(organizerKey('CosmosPalette'))).toBe(a)
  })

  it('漢字を含む名前・短い名前は対象外', () => {
    expect(phoneticSkeleton('印西市商工会')).toBeNull()
    expect(phoneticSkeleton('abc')).toBeNull()
  })
})
