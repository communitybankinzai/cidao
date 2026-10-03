// OpenPOIインポート管理：選んだ候補をテキスト1つにまとめてコピーするための整形。
// 別セッションでの口コミ収集・AI要約・告知文づくりに貼り付けて使う。
import { freefreeCategoryLabel } from '@/lib/freefree-categories'
import { normalizeDisplayText, openpoiCategoryLabel } from '@/lib/freefree-import-core'

export const COPY_SEPARATOR = '---'

const STATUS_LABEL: Record<string, string> = {
  candidate: '候補', publishing: '登録処理中', imported: '登録済み', excluded: '除外', failed: '失敗',
}
const DUP_LABEL: Record<string, string> = { none: 'なし', possible: '重複の可能性', duplicate: '重複' }

// 一覧に出ている項目だけを使う（CandidateRow の部分集合）
export type CopyRow = {
  name: string
  prefecture: string | null
  city: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  openpoi_category: string | null
  phone: string | null
  website: string | null
  category: string | null
  import_status: string
  duplicate_status: string
  duplicate_reason: string | null
  edits?: { title?: string; category?: string; phone?: string; website?: string } | null
}

// 一覧の表示と同じ優先順（編集値 → 元データ）で値を決める
export function formatCandidateForCopy(r: CopyRow): string {
  const title = r.edits?.title || normalizeDisplayText(r.name)
  const address = normalizeDisplayText(r.address ?? '') || [r.prefecture, r.city].filter(Boolean).join('')
  const catKey = r.edits?.category || r.category
  const phone = r.edits?.phone || r.phone
  const website = r.edits?.website || r.website
  const coords = r.latitude != null && r.longitude != null ? `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}` : ''
  const dup = DUP_LABEL[r.duplicate_status] ?? r.duplicate_status
  const dupText = r.duplicate_reason && r.duplicate_status !== 'none' ? `${dup}（${r.duplicate_reason}）` : dup
  return [
    `店名: ${title}`,
    `住所: ${address}`,
    `FreeFreeカテゴリー: ${catKey ? freefreeCategoryLabel(catKey) : '未分類'}`,
    `OpenPOIカテゴリー: ${openpoiCategoryLabel(r.openpoi_category)}`,
    `電話: ${phone ?? ''}`,
    `URL: ${website ?? ''}`,
    `緯度経度: ${coords}`,
    `重複判定: ${dupText}`,
    `状態: ${STATUS_LABEL[r.import_status] ?? r.import_status}`,
  ].join('\n')
}

// 1店1ブロック。店と店の間は「---」だけの行
export function formatCandidatesForCopy(rows: CopyRow[]): string {
  return rows.map(formatCandidateForCopy).join(`\n${COPY_SEPARATOR}\n`)
}
