// チラシの QR コードから読み取った文字列を、催しの登録フォームの「申込フォームリンク」「サイトリンク」に振り分ける（2026-11-22）。
// QR の読み取りそのもの（画像 → 文字列）は画面側（ImageScanField）で行う。ここは依存のない判定だけ。

export type QrPurpose = 'form' | 'website' | 'none'

// 申込・予約・チケットのサービス（ここに当たる URL は、QR のそばの案内に関係なく申込フォームとみなす）
const FORM_HOST_RE = /(^|\.)(forms\.gle|forms\.office\.com|forms\.microsoft\.com|form\.run|formrun\.com|ws\.formzu\.net|formzu\.net|form\.jotform\.com|jotform\.com|typeform\.com|peatix\.com|kokucheese\.com|kokuchpro\.com|eventregist\.com|connpass\.com|passmarket\.yahoo\.co\.jp|tiget\.net|teket\.jp|select-type\.com|airrsv\.net|reserva\.be|coubic\.com|stores\.jp|logoform\.jp|apply\.e-tumo\.jp|shinsei\.e-tumo\.jp|lgpos\.task-asp\.net|s-kantan\.jp|questant\.jp|customform\.jp)$/i

/** QR の中身から、http／https の URL だけを取り出す（前後の空白・全角を除き、同じものは1つに） */
export function qrUrls(texts: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of texts) {
    const t = String(raw ?? '').normalize('NFKC').trim()
    if (!t) continue
    let url: URL
    try {
      url = new URL(t)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    if (url.username || url.password) continue
    const s = url.toString()
    if (s.length > 500 || out.includes(s)) continue
    out.push(s)
  }
  return out
}

/** 申込・予約のサービスの URL か（Google フォームは docs.google.com/forms も） */
export function looksLikeFormUrl(u: string): boolean {
  let url: URL
  try {
    url = new URL(u)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  if (FORM_HOST_RE.test(host)) return true
  if (host === 'docs.google.com' && url.pathname.startsWith('/forms')) return true
  return false
}

/**
 * QR の URL を2つの欄に振り分ける。
 *   ・申込サービスの URL → 申込フォーム
 *   ・QR が1つだけで、チラシに「申込はこちら」などの案内がある（purpose='form'）→ 申込フォーム
 *   ・それ以外 → サイト
 * どちらも最初の1つだけ使う。
 */
export function assignQrUrls(texts: readonly string[], purpose: QrPurpose | null | undefined): { form_url: string | null; website_url: string | null } {
  const urls = qrUrls(texts)
  let form: string | null = null
  let site: string | null = null
  for (const u of urls) {
    const isForm = looksLikeFormUrl(u) || (urls.length === 1 && purpose === 'form')
    if (isForm) form = form ?? u
    else site = site ?? u
  }
  return { form_url: form, website_url: site }
}
