// チラシの QR コードのリンクの振り分け（2026-11-22）
import { describe, expect, it } from 'vitest'
import { assignQrUrls, looksLikeFormUrl, qrUrls } from '@/lib/flyer-qr'

describe('QR の中身から URL を取り出す', () => {
  it('http／https だけを残し、同じものは1つにする', () => {
    expect(qrUrls([' https://forms.gle/abc ', 'https://forms.gle/abc', 'tel:0476000000', 'こんにちは', 'javascript:alert(1)'])).toEqual(['https://forms.gle/abc'])
  })
  it('ユーザー名つき・長すぎる URL は使わない', () => {
    expect(qrUrls(['https://user:pass@example.com/', 'https://example.com/' + 'a'.repeat(600)])).toEqual([])
  })
})

describe('申込のサービスの見分け', () => {
  it('Google フォーム・Peatix などは申込', () => {
    for (const u of ['https://forms.gle/x', 'https://docs.google.com/forms/d/e/xxx/viewform', 'https://peatix.com/event/1', 'https://forms.office.com/r/x', 'https://ws.formzu.net/fgen/S1/']) expect(looksLikeFormUrl(u)).toBe(true)
  })
  it('ふつうのサイト・Google ドキュメントは申込ではない', () => {
    for (const u of ['https://www.city.inzai.lg.jp/0000022679.html', 'https://docs.google.com/document/d/x', 'https://www.instagram.com/x/']) expect(looksLikeFormUrl(u)).toBe(false)
  })
})

describe('欄への振り分け', () => {
  it('申込のサービスは、案内に関係なく申込フォームへ', () => {
    expect(assignQrUrls(['https://forms.gle/x'], 'none')).toEqual({ form_url: 'https://forms.gle/x', website_url: null })
  })
  it('QR が1つで「申込はこちら」の案内があれば、市のページでも申込フォームへ', () => {
    expect(assignQrUrls(['https://www.city.inzai.lg.jp/apply.html'], 'form')).toEqual({ form_url: 'https://www.city.inzai.lg.jp/apply.html', website_url: null })
  })
  it('案内が申込でなければサイトへ', () => {
    expect(assignQrUrls(['https://www.city.inzai.lg.jp/x.html'], 'website')).toEqual({ form_url: null, website_url: 'https://www.city.inzai.lg.jp/x.html' })
    expect(assignQrUrls(['https://www.city.inzai.lg.jp/x.html'], undefined)).toEqual({ form_url: null, website_url: 'https://www.city.inzai.lg.jp/x.html' })
  })
  it('QR が2つあるときは、申込のサービスを申込へ・もう一方をサイトへ', () => {
    expect(assignQrUrls(['https://example.org/info', 'https://forms.gle/x'], 'form')).toEqual({ form_url: 'https://forms.gle/x', website_url: 'https://example.org/info' })
  })
  it('URL でない QR は何も入れない', () => {
    expect(assignQrUrls(['WIFI:S:abc;;'], 'form')).toEqual({ form_url: null, website_url: null })
  })
})
