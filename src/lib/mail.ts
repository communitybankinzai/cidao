// メール送信の共通ヘルパー。
//
// メールヘッダ（From の表示名など）は RFC 2047 の MIME encoded-word にしないと
// 日本語が文字化けする。MAIL_FROM に「CBI通知 <noreply@example.com>」のように
// 非ASCIIの表示名が入っていても正しく表示されるよう、送信直前に変換する。

/**
 * From ヘッダを RFC 2047 準拠に整える。
 * - 表示名が ASCII のみ、または既に encoded-word ならそのまま返す
 * - 非ASCII を含む場合のみ =?UTF-8?B?...?= に変換する
 * - アドレスのみ（表示名なし）もそのまま返す
 */
export function normalizeMailFrom(from: string): string {
  const src = from.trim()
  if (!src) return src

  // "表示名 <local@domain>" 形式のみ対象。<> が無ければアドレスのみとみなす
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(src)
  if (!m) return src

  const display = m[1].trim().replace(/^"(.*)"$/, '$1')
  const address = m[2].trim()
  if (!display) return address
  // 既に encoded-word になっているものは二重変換しない
  if (/^=\?.+\?=$/.test(display)) return `${display} <${address}>`
  if (/^[\x20-\x7E]*$/.test(display)) return `${display} <${address}>`

  const encoded = `=?UTF-8?B?${Buffer.from(display, 'utf8').toString('base64')}?=`
  return `${encoded} <${address}>`
}
