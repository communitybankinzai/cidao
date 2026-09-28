// 防災MAPの「押された機能の回数」（/api/cbi-site-features）の検査。route.ts から分けたのはテストのため

const MAX_KEYS = 120
const MAX_KEY_LEN = 80
const MAX_LABEL_LEN = 40
const MAX_COUNT = 5000

// 制御文字を含まない短い文字列だけ通す
const cleanText = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null

/** 送られた回数と表示名を検査して、通るものだけを残す */
export function sanitizeFeatureCounts(countsIn: unknown, labelsIn: unknown) {
  const counts: Record<string, number> = {}
  const labels: Record<string, string> = {}
  if (!countsIn || typeof countsIn !== 'object' || Array.isArray(countsIn)) return null
  const entries = Object.entries(countsIn as Record<string, unknown>)
  if (entries.length > MAX_KEYS) return null
  for (const [key, value] of entries) {
    if (!cleanText(key, MAX_KEY_LEN)) return null
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_COUNT) return null
    counts[key] = value as number
  }
  if (labelsIn && typeof labelsIn === 'object' && !Array.isArray(labelsIn)) {
    for (const [key, value] of Object.entries(labelsIn as Record<string, unknown>)) {
      if (!(key in counts)) continue
      const label = cleanText(value, MAX_LABEL_LEN)
      if (label) labels[key] = label
    }
  }
  return { counts, labels }
}
