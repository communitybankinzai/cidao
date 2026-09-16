import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dedupeCandidates, extractCandidates, normalizeJaTime, type GoguynetPost } from '@/lib/goguynet/cosmos'
import { CHIICOMI_MEDIA, buildChiicomiSearchUrl } from '../press'

const posts = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/press-cosmos-2026-09-16.json', import.meta.url)), 'utf-8'),
) as GoguynetPost[]
const byId = (id: number) => posts.find((p) => p.id === id)!

describe('ちいき新聞の記事（実記事4件）', () => {
  it('「日時／7月25日（土）午後3時～午後8時」を読む（年は記事の公開年）', () => {
    const [c] = extractCandidates(byId(2078775), CHIICOMI_MEDIA)
    expect(c).toMatchObject({
      mediaName: 'ちいき新聞',
      title: 'コスモスパレット 夏祭り',
      date: '2026-07-25',
      startAt: '2026-07-25T15:00',
      endAt: '2026-07-25T20:00',
      venue: 'コスモスパレットII、北総花の丘公園Aゾーン',
      sourceId: 'chiicomi:2078775:2026-07-25',
      articleUrl: 'https://chiicomi.com/press/2078775/',
    })
    expect(c.infoLines).toEqual(['日時：7月25日（土）午後3時～午後8時', '会場：コスモスパレットII、北総花の丘公園Aゾーン'])
  })

  it('会場が「コスモスパレット」だけの記事も候補になる（Kid’s marché）', () => {
    const [c] = extractCandidates(byId(2072166), CHIICOMI_MEDIA)
    expect(c.date).toBe('2026-03-28')
    expect(c.startAt).toBe('2026-03-28T10:00')
    expect(c.endAt).toBe('2026-03-28T15:00')
  })

  it('文化ホールのゴスペル記事・施設完成の記事は候補にしない', () => {
    expect(extractCandidates(byId(2059377), CHIICOMI_MEDIA)).toEqual([])
    expect(extractCandidates(byId(2058745), CHIICOMI_MEDIA)).toEqual([])
  })

  it('号外NET と同じ催しは新しい記事だけ残る（媒体をまたいだ重複）', () => {
    const a = extractCandidates(byId(2078775), CHIICOMI_MEDIA) // 2026-07-15 ちいき新聞
    const b = extractCandidates(
      {
        id: 50184, date: '2026-07-22T10:00:00', link: 'https://kamagaya-shiroi-inzai.goguynet.jp/2026/07/22/x/',
        title: { rendered: '【印西市】7月25日（土）「Cosmos Palette 夏祭り 2026」開催！' },
        content: { rendered: '<p>開催時間は15:00～20:00</p>' },
      },
    )
    const kept = dedupeCandidates([...a, ...b])
    expect(kept).toHaveLength(1)
    expect(kept[0].sourceId).toBe('goguynet:50184:2026-07-25')
  })
})

describe('小物', () => {
  it('normalizeJaTime の午前／午後', () => {
    expect(normalizeJaTime('午後3時～午後8時')).toBe('15:00～20:00')
    expect(normalizeJaTime('午前10時～午後3時')).toBe('10:00～15:00')
    expect(normalizeJaTime('午後12時30分')).toBe('12:30')
  })
  it('検索URL', () => {
    expect(buildChiicomiSearchUrl()).toContain('/wp-json/wp/v2/press?search=')
  })
})
