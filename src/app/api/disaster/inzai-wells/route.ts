// GET /api/disaster/inzai-wells
// 印西市公式オープンデータ「災害用井戸」（わが街ガイド）を取得して返す。
// 断水時の生活用水の確保先。飲用可否は市の公表情報に含まれないため、
// 「飲用可」と読める表示は行わない（利用者の誤解を避ける）。
// CORS・出典表示の方針は inzai-shelters と同じ。

import { parse } from 'csv-parse/sync'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type SourceRow = Record<string, string>

type Well = {
  id: string
  name: string
  address: string
  category: string
  latitude: number
  longitude: number
}

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
])

const OPEN_DATA_PAGE_URL = 'https://www2.wagmap.jp/inzai/OpenData'
const OPEN_DATA_LICENSE_URL = 'https://www2.wagmap.jp/inzai/OpenDataAgreement'
const CITY_PORTAL_URL = 'https://www.city.inzai.lg.jp/bousaiportal/'
const RESOURCE_URL = 'https://www2.wagmap.jp/inzai/inzai/opendata/map/CSV/opendata_30.csv'

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin)
      ? origin
      : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

function safeNumber(value: string | undefined) {
  const num = Number(String(value ?? '').trim())
  return Number.isFinite(num) ? num : null
}

// 市のCSVはUTF-8(BOM)だが、将来Shift_JISへ変わっても壊れないよう両対応にする
function decodeCsv(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // 文字化け（U+FFFD）が多い場合はShift_JISとして読み直す
  const broken = (utf8.match(/�/g) || []).length
  if (broken > 3) {
    try {
      return new TextDecoder('shift_jis').decode(bytes)
    } catch {
      return utf8
    }
  }
  return utf8
}

export async function GET(request: Request) {
  try {
    const response = await fetch(RESOURCE_URL, { cache: 'no-store' })
    if (!response.ok) {
      return json(request, { error: `オープンデータの取得に失敗しました（HTTP ${response.status}）` }, 502)
    }
    const text = decodeCsv(await response.arrayBuffer())
    const rows = parse(text, { columns: true, skip_empty_lines: true, bom: true }) as SourceRow[]

    const wells: Well[] = []
    rows.forEach((row, index) => {
      const name = String(row['施設名'] ?? '').trim()
      const latitude = safeNumber(row['緯度'])
      const longitude = safeNumber(row['経度'])
      if (!name || latitude === null || longitude === null) return
      wells.push({
        id: `well:${index + 1}`,
        name,
        address: String(row['所在地'] ?? '').trim(),
        category: String(row['分類'] ?? '災害用井戸').trim(),
        latitude,
        longitude,
      })
    })

    return json(request, {
      fetchedAt: new Date().toISOString(),
      wells,
      // 飲用可否は市の公表データに含まれない。表示側でもこの注意を必ず出すこと
      usageNote: '断水時の生活用水を想定した井戸です。飲用の可否は公表されていません。実際の利用可否や開放状況は印西市の発表を確認してください。',
      sources: {
        organization: '印西市 総務部防災課',
        openDataPageUrl: OPEN_DATA_PAGE_URL,
        openDataLicenseUrl: OPEN_DATA_LICENSE_URL,
        cityPortalUrl: CITY_PORTAL_URL,
        resources: [{ resourceName: '災害用井戸', url: RESOURCE_URL }],
        license: 'CC BY 2.1 JP',
      },
    })
  } catch (error) {
    return json(request, { error: `取得中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}` }, 500)
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
