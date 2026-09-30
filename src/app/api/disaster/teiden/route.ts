// 印西市の停電情報（東京電力パワーグリッド「停電情報」の印西市 XML）を防災MAPへ返す。
//
// 【東電PGとの約束（2026-09-30 高田氏の回答で4条件とも了承）】
//   1. 取得するのは印西市のデータファイル（flash/xml/12231000000.xml）1件のみ
//   2. 防災MAPの利用者が「停電」を選んだときだけ取得し、常時の巡回はしない（⛔ cron・定期実行を足さないこと）
//   3. 取得した内容は10分保存して使い回し、取得は多くとも10分に1回（下の CACHE_SECONDS と s-maxage）
//   4. 読み込みには、東電のページが表示の際に設定するのと同じ Cookie（teideninfo-auth）を付ける
// 表示の条件（2026-09-28 回答）：出典は「東京電力パワーグリッド株式会社」、復旧見込みは東電の掲載があるときだけ。
// 経緯は保管庫 調整経緯/2026-09-21_東京電力_停電情報の申請記入案.md。中止の連絡があれば当日中に止めること。
//
// Cookie の値は東電の公開 JavaScript にある固定の文字列だが、コードには書かず環境変数 TEPCO_TEIDEN_AUTH に置く。
// Cookie が合わないと東電は 302 で別のページへ飛ばす → auth_rejected を返す（値が変わった合図）。
import { NextResponse } from 'next/server'
import { parseTeidenXml } from '@/lib/tepco-teiden'

const CACHE_SECONDS = 600
const XML_URL = 'https://teideninfo.tepco.co.jp/flash/xml/12231000000.xml'
const PAGE_URL = 'https://teideninfo.tepco.co.jp/html/12231000000.html'
const SOURCE_NAME = '東京電力パワーグリッド株式会社「停電情報」'

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export async function GET(request: Request) {
  const auth = process.env.TEPCO_TEIDEN_AUTH
  if (!auth) {
    return NextResponse.json({ error: 'server_not_configured' }, { status: 503, headers: corsHeaders(request) })
  }
  let xml: string
  try {
    const response = await fetch(XML_URL, {
      headers: {
        Cookie: `teideninfo-auth=${auth}`,
        'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)',
      },
      redirect: 'manual',
      next: { revalidate: CACHE_SECONDS },
    })
    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json({ error: 'auth_rejected' }, { status: 502, headers: corsHeaders(request) })
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    xml = await response.text()
  } catch (error) {
    return NextResponse.json(
      { error: `fetch_failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502, headers: corsHeaders(request) },
    )
  }
  let parsed
  try {
    parsed = parseTeidenXml(xml)
  } catch {
    return NextResponse.json({ error: 'unexpected_format' }, { status: 502, headers: corsHeaders(request) })
  }
  return NextResponse.json(
    {
      sample: false,
      fetchedAt: new Date().toISOString(),
      updatedAt: parsed.updatedAt,
      source: { name: SOURCE_NAME, url: PAGE_URL },
      total: parsed.total,
      areas: parsed.areas.map(area => ({
        city: '印西市',
        district: area.district,
        code: area.code,
        households: area.households,
        display: area.display,
      })),
    },
    { headers: { ...corsHeaders(request), 'Cache-Control': `public, max-age=60, s-maxage=${CACHE_SECONDS}` } },
  )
}
