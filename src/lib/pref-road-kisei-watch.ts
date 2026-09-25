// 千葉県「県管理道路の通行規制情報」の状況図（PDF）が差し替わった・消えたときに、
// 防災MAP（cbi-site）の取り込み（.github/workflows/pref-road-kisei.yml）を起動する。
//
// 取り込みそのもの（PDFの画像を地理院地図と照合して赤線を線に直す）は重いので GitHub Actions で行う。
// Actions の定期実行は GitHub に間引かれ最長12時間ほど空くため、ここで県ページだけを見て、
// 公開中の pref-road-kisei.json と食い違うときだけ repository_dispatch で呼ぶ（2026-09-25 事業主決定）。
// 呼び出しは pg_cron `cidao_pref_road_kisei`（30分ごと・POST /api/disaster/pref-road-kisei。2026-09-26 事業主指示）。
//
// 記録は持たない。比べる相手は公開中の JSON なので、取り込みが失敗して JSON が古いままなら次の回にまた呼ぶ。
// 読む規則（PDFリンク・時点の文字）は site/inzai-disaster-map/pipeline/build_pref_road_kisei.py と揃えること。

const PAGE_URL = 'https://www.pref.chiba.lg.jp/doukan/douroiji/kiseijyouhou.html'
const PUBLISHED_JSON = 'https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/pref-road-kisei.json'
// PDF はファイル名（今は kisei<日付>.pdf）に頼らず、リンクの文字で見つける。
// 「規制」か「状況図」を含むリンクを先に、無ければ元のファイル名の形、それも無ければ掲載なし
const PDF_LINK_RE = /<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi
const PDF_TEXT_RE = /規制|状況図/
const PDF_NAME_RE = /documents\/kisei[^"]*\.pdf$/i
const STAMP_RE = /令和[^<>]{0,40}?時\s*時点/
const UA = 'CBI-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)'

export type PrefKiseiWatchResult = {
  dispatched: boolean
  reason: string
  pdfUrl?: string | null
  stamp?: string
}

type PageState = { pdfUrl: string | null; stamp: string }

export function findPrefKiseiPdf(html: string): string | null {
  const links = [...html.matchAll(PDF_LINK_RE)].map((m) => ({
    href: m[1],
    text: m[2].replace(/<[^>]*>/g, ''),
  }))
  const hit = links.find((l) => PDF_TEXT_RE.test(l.text)) ?? links.find((l) => PDF_NAME_RE.test(l.href))
  return hit ? new URL(hit.href, PAGE_URL).toString() : null
}

export function readPrefKiseiPage(html: string): PageState {
  const pdfUrl = findPrefKiseiPdf(html)
  if (!pdfUrl) return { pdfUrl: null, stamp: '' }
  const stamp = STAMP_RE.exec(html)?.[0].replace(/\s+/g, '') ?? ''
  return { pdfUrl, stamp }
}

// 取り込み直すべきか。理由の文字列（空なら不要）
export function prefKiseiNeedsRebuild(
  page: PageState,
  published: { published?: boolean; pdfUrl?: string; pageStamp?: string } | null,
): string {
  if (!published) return 'no_published_json'
  if (!page.pdfUrl) return published.published ? 'pdf_removed' : ''
  if (!published.published) return 'pdf_appeared'
  if (published.pdfUrl !== page.pdfUrl) return 'pdf_changed'
  if (page.stamp && published.pageStamp !== page.stamp) return 'stamp_changed'
  return ''
}

async function fetchPage(): Promise<PageState> {
  const res = await fetch(PAGE_URL, { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(8000) })
  // ページごと消えた＝掲載終了。それ以外の失敗は例外（一時的な不調で線を消さない）
  if (res.status === 404) return { pdfUrl: null, stamp: '' }
  if (!res.ok) throw new Error(`県ページ HTTP ${res.status}`)
  return readPrefKiseiPage(await res.text())
}

async function fetchPublished() {
  // GitHub Pages は10分キャッシュするので、毎回違う問い合わせ文字列で最新を取る
  const res = await fetch(`${PUBLISHED_JSON}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`公開中の JSON HTTP ${res.status}`)
  return (await res.json()) as { published?: boolean; pdfUrl?: string; pageStamp?: string }
}

export async function watchPrefRoadKisei(): Promise<PrefKiseiWatchResult> {
  const [page, published] = await Promise.all([fetchPage(), fetchPublished()])
  const reason = prefKiseiNeedsRebuild(page, published)
  if (!reason) return { dispatched: false, reason: 'unchanged', pdfUrl: page.pdfUrl, stamp: page.stamp }

  const token = process.env.GITHUB_DISPATCH_TOKEN
  const repo = process.env.GITHUB_DISPATCH_REPO ?? 'communitybankinzai/cbi-site'
  if (!token) return { dispatched: false, reason: `${reason} / GITHUB_DISPATCH_TOKEN not configured`, pdfUrl: page.pdfUrl, stamp: page.stamp }
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'pref-road-kisei', client_payload: { reason } }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    return { dispatched: false, reason: `${reason} / GitHub ${res.status} ${(await res.text()).slice(0, 120)}`, pdfUrl: page.pdfUrl, stamp: page.stamp }
  }
  return { dispatched: true, reason, pdfUrl: page.pdfUrl, stamp: page.stamp }
}
