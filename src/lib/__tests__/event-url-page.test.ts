import { describe, expect, it } from 'vitest'
import { extractPage, flyerUrlAt } from '../event-url-page'

const BASE = new URL('https://www.example.lg.jp/8850/')

const PAGE = `<!doctype html><html><head><title>クリスマス会</title><style>.a{}</style></head><body>
<header><img src="/_img/_shared/logo_site_name.svg" alt="図書館"><nav><ul><li>蔵書検索・予約</li><li>雑誌一覧</li></ul></nav></header>
<main>
<h1>図書館クリスマス会の開催について</h1>
<p>大型絵本の読み聞かせなど楽しい企画が盛りだくさん！</p>
<p><img src="https://www.example.lg.jp/wp-content/uploads/R81116_3%E9%A4%A8%E5%90%88%E5%90%8C.jpg" alt=""></p>
<h2>小林図書館</h2><p>日程：12月6日（日） 10時30分～</p>
<p><img src="/wp-content/uploads/R81116_%E5%B0%8F%E6%9E%97.jpg" alt="小林のチラシ"></p>
<h2>大森図書館</h2><p>日程：12月12日（土） 11時～</p>
<p><img src="/wp-content/uploads/R81116_%E5%A4%A7%E6%A3%AE.jpg"></p>
<p><img src="/_img/_shared/btn_returnTop.png"></p>
</main>
<footer><ul><li>サイトマップ</li><li>蔵書検索・予約</li></ul></footer>
<script>var x = '<img src="/evil.jpg">'</script>
</body></html>`

describe('extractPage', () => {
  const page = extractPage(PAGE, BASE)

  it('メニュー・ヘッダー・フッターの文字を本文に入れない', () => {
    expect(page.text).not.toContain('蔵書検索')
    expect(page.text).not.toContain('サイトマップ')
    expect(page.text).toContain('小林図書館')
    expect(page.text).toContain('12月6日')
  })

  it('本文の中の写真だけを、出てきた順に拾う（ロゴ・ボタン・script の中は拾わない）', () => {
    expect(page.images.map((i) => i.name)).toEqual(['R81116_3館合同.jpg', 'R81116_小林.jpg', 'R81116_大森.jpg'])
    expect(page.images[1].url).toBe('https://www.example.lg.jp/wp-content/uploads/R81116_%E5%B0%8F%E6%9E%97.jpg')
    expect(page.images[1].alt).toBe('小林のチラシ')
  })

  it('画像の位置に、番号と名前の印を入れる（どの見出しの下かが分かる）', () => {
    const kobayashi = page.text.indexOf('小林図書館')
    const mark = page.text.indexOf('[画像1: R81116_小林.jpg／小林のチラシ]')
    const omori = page.text.indexOf('大森図書館')
    expect(mark).toBeGreaterThan(kobayashi)
    expect(mark).toBeLessThan(omori)
  })

  it('本文まで header に入っているページは、外さない版に戻す', () => {
    const p = extractPage('<body><header><h1>夏まつり</h1><p>8月1日（土）10時から中央公園で開きます。どなたでも参加できます。申し込みは不要です。</p></header></body>', BASE)
    expect(p.text).toContain('夏まつり')
  })

  it('小さいと書いてある画像と、危ない URL の画像は拾わない', () => {
    const p = extractPage('<main><p>本文です。本文です。本文です。本文です。本文です。本文です。本文です。本文です。本文です。本文です。</p><img src="/a.jpg" width="40" height="40"><img src="http://localhost/b.jpg"><img src="javascript:alert(1)"><img src="/c.png"></main>', BASE)
    expect(p.images.map((i) => i.name)).toEqual(['c.png'])
  })

  it('同じ画像が2回出ても1つに数え、8枚までにする', () => {
    const imgs = Array.from({ length: 12 }, (_, i) => `<img src="/p${i}.jpg"><img src="/p${i}.jpg">`).join('')
    const p = extractPage(`<main><p>${'本文です。'.repeat(20)}</p>${imgs}</main>`, BASE)
    expect(p.images).toHaveLength(8)
  })
})

describe('flyerUrlAt', () => {
  const images = [{ url: 'https://x/a.jpg', name: 'a.jpg', alt: '' }]
  it('番号を URL に直す', () => {
    expect(flyerUrlAt(images, 0)).toBe('https://x/a.jpg')
  })
  it('範囲外・番号でないものは null', () => {
    expect(flyerUrlAt(images, 3)).toBeNull()
    expect(flyerUrlAt(images, null)).toBeNull()
    expect(flyerUrlAt(images, '0')).toBeNull()
    expect(flyerUrlAt(images, 0.5)).toBeNull()
  })
})
