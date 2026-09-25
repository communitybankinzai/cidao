// 県の道路規制状況図の見張り：県ページの読み取りと、取り込み直す条件。
// 見本の HTML は 2026-09-25 に県ページで実際に見た形を縮めたもの。

import { describe, expect, it } from 'vitest'
import { prefKiseiNeedsRebuild, readPrefKiseiPage } from '@/lib/pref-road-kisei-watch'

const PAGE = `<p>全面通行止73区間（令和8年9月25日（金曜日）午後2時 時点）</p>
<p><a href="/doukan/douroiji/documents/kisei20260925.pdf">令和8年台風25号道路規制・規制解除状況図　千葉県全域（令和8年9月25日（金曜日）午後2時 時点）（PDF：1,770.3KB）</a></p>`
const PDF = 'https://www.pref.chiba.lg.jp/doukan/douroiji/documents/kisei20260925.pdf'
const STAMP = '令和8年9月25日（金曜日）午後2時時点'

describe('readPrefKiseiPage', () => {
  it('PDFのリンクと時点の文字を読む', () => {
    expect(readPrefKiseiPage(PAGE)).toEqual({ pdfUrl: PDF, stamp: STAMP })
  })
  it('ファイル名が変わってもリンクの文字で見つける', () => {
    const renamed = PAGE.replace('kisei20260925.pdf', 'R8taifu25_douro_0926.pdf')
    expect(readPrefKiseiPage(renamed).pdfUrl).toBe(PDF.replace('kisei20260925.pdf', 'R8taifu25_douro_0926.pdf'))
  })
  it('ほかのPDF（様式など）は拾わず、状況図のリンクを選ぶ', () => {
    const withOther = `<a href="/doukan/documents/youshiki.pdf">申請様式（PDF）</a>${PAGE}`
    expect(readPrefKiseiPage(withOther).pdfUrl).toBe(PDF)
  })
  it('リンクの文字が変わっても元のファイル名の形なら見つける', () => {
    const plain = '<a href="/doukan/douroiji/documents/kisei20260926.pdf">PDF（1MB）</a>'
    expect(readPrefKiseiPage(plain).pdfUrl).toBe(PDF.replace('0925', '0926'))
  })
  it('リンクが無ければ掲載なし', () => {
    expect(readPrefKiseiPage('<p>現在、規制情報はありません</p>')).toEqual({ pdfUrl: null, stamp: '' })
  })
})

describe('prefKiseiNeedsRebuild', () => {
  const page = { pdfUrl: PDF, stamp: STAMP }
  const same = { published: true, pdfUrl: PDF, pageStamp: STAMP }
  it('同じなら起動しない', () => {
    expect(prefKiseiNeedsRebuild(page, same)).toBe('')
  })
  it('新しいPDF', () => {
    expect(prefKiseiNeedsRebuild({ ...page, pdfUrl: PDF.replace('0925', '0926') }, same)).toBe('pdf_changed')
  })
  it('同じファイル名で時点だけ変わった', () => {
    expect(prefKiseiNeedsRebuild({ ...page, stamp: STAMP.replace('午後2時', '午後6時') }, same)).toBe('stamp_changed')
  })
  it('掲載が消えた', () => {
    expect(prefKiseiNeedsRebuild({ pdfUrl: null, stamp: '' }, same)).toBe('pdf_removed')
  })
  it('掲載なしのまま', () => {
    expect(prefKiseiNeedsRebuild({ pdfUrl: null, stamp: '' }, { published: false })).toBe('')
  })
  it('掲載が再開した', () => {
    expect(prefKiseiNeedsRebuild(page, { published: false })).toBe('pdf_appeared')
  })
  it('時点の文字を持たない古いJSONは一度だけ取り込み直す', () => {
    expect(prefKiseiNeedsRebuild(page, { published: true, pdfUrl: PDF })).toBe('stamp_changed')
  })
})
