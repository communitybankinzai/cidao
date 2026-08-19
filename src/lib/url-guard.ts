// 外部URLを取りに行く前の安全確認。
//
// 掲載者が入力した任意のURLをサーバーから fetch するため、社内ネットワークや
// クラウドのメタデータエンドポイントへ踏み台にされないよう弾く（SSRF 対策）。
// DNS リバインディング等の高度な攻撃までは防がない（ログイン必須の入力補助であり、
// 取得結果は本人のフォームに返るだけで第三者へは露出しないため）。
//
// 注: /api/events/scan-url にも同等の判定が直書きされている。あちらは動作中の
//     機能なので触らず、FreeFree 側の新規実装ではこの共通処理を使う。

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  // IPv6 リテラル直指定は一律拒否（公開ページで正当な用途がない）
  if (h.includes(':') || h.startsWith('[')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // クラウドのメタデータ
  }
  return false
}

// 文字列を http/https の URL として検証する。危険・不正なものは null
export function parseSafeUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (isBlockedHost(u.hostname)) return null
  return u
}

// ページ内の相対URLを絶対URLへ直す。安全でないものは除外する
export function toAbsoluteSafe(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (isBlockedHost(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}
