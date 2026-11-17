import { describe, expect, it } from 'vitest'
import { eventSourceLabel, groupByEventName, isSameEventName, memberSourceLinks, normalizeEventName, sourcesOf } from '../event-name-groups'

describe('isSameEventName（同じ催しの名称か）', () => {
  it('記号・空白の違いだけなら同じ', () => {
    expect(isSameEventName('いんざい手仕事工房 手仕事を楽しむ4つの講座', 'いんざい手仕事工房 〜手仕事を楽しむ4つの講座〜')).toBe(true)
  })

  it('年度の有無、子ども／こども の違いは同じとみなす', () => {
    expect(isSameEventName(
      '令和8年度乳幼児期子育て連続講座「乳幼児の子どもの心のコーチング」（全6回）',
      '乳幼児期子育て連続講座「乳幼児のこどもの心のコーチング」（全6回）',
    )).toBe(true)
  })

  it('周年の冠・西暦・「開催！」の違いは同じとみなす', () => {
    expect(isSameEventName('イルミライ★INZAI2026', '市制施行30周年記念 イルミライ★INZAI 開催！')).toBe(true)
    expect(isSameEventName('文化財講演会 「運慶の手腕と『写実』」を開催します', '文化財講演会「運慶の手腕と写実」')).toBe(true)
  })

  it('先頭の印（【講座】★満員御礼★）は外して比べる', () => {
    expect(isSameEventName('★満員御礼★【講座】「パパと一緒にカフェタイム」', '「パパと一緒にカフェタイム」')).toBe(true)
  })

  it('片方がもう片方を含むなら同じ（副題つき）', () => {
    expect(isSameEventName('フライデーナイトコンサート Vol.15', 'フライデーナイトコンサート Vol.15 『星の王子さま』')).toBe(true)
  })

  it('頭が同じでも、中身が違う催しはまとめない', () => {
    expect(isSameEventName('高齢者のための講習会 ヨガ（全4回）', '高齢者のための講習会 ピラティス（全4回）')).toBe(false)
    expect(isSameEventName('シルバー人材センター入会説明会（パレットⅠ会場）', 'シルバー人材センター入会説明会（中央公民館会場）')).toBe(false)
  })

  it('短い名称は、完全に同じときだけ', () => {
    expect(isSameEventName('献血', '献血')).toBe(true)
    expect(isSameEventName('献血', '献血にご協力ください')).toBe(false)
    expect(isSameEventName('', '')).toBe(false)
  })
})

describe('groupByEventName（名称でまとめる）', () => {
  const rows = [
    { id: 'a', title: 'イルミライ★INZAI2026', external_source: null, flyer_image_url: null },
    { id: 'b', title: 'ヨガ教室', external_source: null, flyer_image_url: null },
    { id: 'c', title: '市制施行30周年記念 イルミライ★INZAI 開催！', external_source: 'inzai-city-calendar', flyer_image_url: 'https://x/y.jpg' },
  ]

  it('同じ名称は1つにまとまり、並び順は最初の1件の位置を保つ', () => {
    const g = groupByEventName(rows)
    expect(g.map((x) => x.members.map((m) => m.id))).toEqual([['a', 'c'], ['b']])
  })

  it('代表は、画像つきを優先する（どちらも無ければ CiDAOへの登録）', () => {
    expect(groupByEventName(rows)[0].main.id).toBe('c')
    const noImg = rows.map((r) => ({ ...r, flyer_image_url: null }))
    expect(groupByEventName(noImg)[0].main.id).toBe('a')
  })

  it('情報元は重複なしで、代表の情報元が先頭', () => {
    const g = groupByEventName([...rows, { id: 'd', title: 'イルミライ★INZAI', external_source: 'inzai-city-calendar', flyer_image_url: null }])[0]
    expect(sourcesOf(g)).toEqual([{ label: '印西市のカレンダー', id: 'c' }, { label: 'CiDAOへの登録', id: 'a' }])
  })

  it('1件だけなら、そのまま1つのまとまり', () => {
    const g = groupByEventName([rows[1]])
    expect(g).toHaveLength(1)
    expect(g[0].main.id).toBe('b')
  })
})

describe('eventSourceLabel / normalizeEventName', () => {
  it('情報元の表示名', () => {
    expect(eventSourceLabel(null)).toBe('CiDAOへの登録')
    expect(eventSourceLabel('cbi-kouhou-import')).toBe('広報いんざい')
    expect(eventSourceLabel('instagram-hashtag')).toBe('Instagram')
    expect(eventSourceLabel('未知')).toBe('その他の情報元')
  })
  it('内訳のリンク：同じ情報元が複数あれば番号を付ける', () => {
    expect(memberSourceLinks([
      { id: 'a', title: 'x', external_source: null },
      { id: 'b', title: 'x', external_source: 'inzai-city-calendar' },
      { id: 'c', title: 'x', external_source: null },
    ])).toEqual([{ id: 'a', label: 'CiDAOへの登録' }, { id: 'b', label: '印西市のカレンダー' }, { id: 'c', label: 'CiDAOへの登録 2' }])
  })
  it('そろえた形', () => {
    expect(normalizeEventName('市制施行30周年記念 イルミライ★INZAI 開催！')).toBe('イルミライinzai')
  })
})
