import { describe, expect, it } from 'vitest'
import { COPY_SEPARATOR, formatCandidatesForCopy, formatCandidateForCopy, type CopyRow } from '../openpoi-copy'

const base: CopyRow = {
  name: 'ＡＢＣ食堂', prefecture: '千葉県', city: '印西市', address: '千葉県印西市牧の木戸１－２',
  latitude: 35.8321234, longitude: 140.1456789, openpoi_category: 'restaurant', phone: '0476-00-0000',
  website: 'https://example.com', category: null, import_status: 'candidate', duplicate_status: 'none',
  duplicate_reason: null, edits: null,
}

describe('openpoi-copy', () => {
  it('一覧と同じ値（全角→半角・未分類・緯度経度5桁）で1店ぶんを作る', () => {
    const t = formatCandidateForCopy(base)
    expect(t).toContain('店名: ABC食堂')
    expect(t).toContain('住所: 千葉県印西市牧の木戸1-2')
    expect(t).toContain('FreeFreeカテゴリー: 未分類')
    expect(t).toContain('緯度経度: 35.83212, 140.14568')
    expect(t).toContain('状態: 候補')
  })

  it('編集値があれば編集値を優先し、住所が空なら都道府県+市で補う', () => {
    const t = formatCandidateForCopy({ ...base, address: null, edits: { title: '新店名', phone: '090' } })
    expect(t).toContain('店名: 新店名')
    expect(t).toContain('住所: 千葉県印西市')
    expect(t).toContain('電話: 090')
  })

  it('重複は理由付きで出す', () => {
    const t = formatCandidateForCopy({ ...base, duplicate_status: 'possible', duplicate_reason: '同名あり' })
    expect(t).toContain('重複判定: 重複の可能性（同名あり）')
  })

  it('店と店の間は「---」だけの行で区切る（先頭・末尾には付けない）', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...base, name: `店${i}` }))
    const t = formatCandidatesForCopy(rows)
    const lines = t.split('\n')
    expect(lines.filter((l) => l === COPY_SEPARATOR)).toHaveLength(9)
    expect(lines[0]).toBe('店名: 店0')
    expect(lines.at(-1)).toMatch(/^状態: /)
    expect(formatCandidatesForCopy([])).toBe('')
  })
})
