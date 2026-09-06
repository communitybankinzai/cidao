import { parse } from 'csv-parse/sync'
import { NextResponse } from 'next/server'
import { CITY_PORTAL_URL, fetchOfficialUpdates, type OfficialUpdate } from '@/lib/inzai-city-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type ShelterKind = 'specified' | 'special' | 'wide-area'
type OpeningStatus = 'open' | 'closed' | 'not-announced'

type SourceRow = Record<string, string>

type Shelter = {
  id: string
  kind: ShelterKind
  kindLabel: string
  name: string
  address: string
  phone: string
  district: string
  latitude: number
  longitude: number
  suitableFor: {
    earthquake: boolean
    windFlood: boolean
    landslide: boolean
  }
  openingStatus: OpeningStatus
  openingEvidence: OfficialUpdate | null
}

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
])

const OPEN_DATA_PAGE_URL = 'https://www2.wagmap.jp/inzai/OpenData'
const OPEN_DATA_LICENSE_URL = 'https://www2.wagmap.jp/inzai/OpenDataAgreement'

const DATASETS: Array<{
  kind: ShelterKind
  kindLabel: string
  resourceName: string
  url: string
}> = [
  {
    kind: 'specified',
    kindLabel: '指定避難所',
    resourceName: '指定避難所',
    url: 'https://www2.wagmap.jp/inzai/inzai/opendata/map/CSV/opendata_25.csv',
  },
  {
    kind: 'special',
    kindLabel: '特別避難所',
    resourceName: '特別避難所',
    url: 'https://www2.wagmap.jp/inzai/inzai/opendata/map/CSV/opendata_26.csv',
  },
  {
    kind: 'wide-area',
    kindLabel: '広域避難場所',
    resourceName: '広域避難場所',
    url: 'https://www2.wagmap.jp/inzai/inzai/opendata/map/CSV/opendata_24.csv',
  },
]

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

function isAvailable(value: string | undefined) {
  return value === '○' || value === '〇'
}

function safeNumber(value: string | undefined) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function fetchShelterDataset(dataset: typeof DATASETS[number]): Promise<Shelter[]> {
  const response = await fetch(dataset.url, {
    headers: { Accept: 'text/csv,*/*;q=0.8', 'User-Agent': 'cidao-inzai-disaster-map/1.0' },
    next: { revalidate: 24 * 60 * 60 },
  })
  if (!response.ok) throw new Error(`${dataset.resourceName} CSV HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const csvText = new TextDecoder(hasUtf8Bom ? 'utf-8' : 'shift_jis').decode(bytes)
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  }) as SourceRow[]

  return rows.flatMap((row, index) => {
    const latitude = safeNumber(row['緯度'])
    const longitude = safeNumber(row['経度'])
    if (latitude === null || longitude === null || !row['名称']) return []
    return [{
      id: `${dataset.kind}:${row.OBJHTMID || row.OBJUJPID || index + 1}`,
      kind: dataset.kind,
      kindLabel: dataset.kindLabel,
      name: row['名称'].trim(),
      address: row['所在地']?.trim() ?? '',
      phone: row['電話番号']?.trim() ?? '',
      district: row['カルテ地区']?.trim() ?? '',
      latitude,
      longitude,
      suitableFor: {
        earthquake: isAvailable(row['震災']),
        windFlood: isAvailable(row['風水害']),
        landslide: isAvailable(row['土砂']),
      },
      openingStatus: 'not-announced' as const,
      openingEvidence: null,
    }]
  })
}

// 市の公開CSV（わが街ガイド55施設）に載っていないが、実際に避難所として開設される施設。
// 2026-09-06の大雨で印旛公民館が防災行政無線と市ホームページで開設と発表されたのに
// CSVに無く、地図から抜け落ちた。市の発表と地図が食い違う方が危険なので補う。
// 座標は国土地理院の住所検索、風水害・土砂への対応は市が特別避難所として開設した実績による。
const SUPPLEMENTAL_SHELTERS = [
  {
    id: 'supplemental-inba-kominkan',
    kind: 'special' as const,
    kindLabel: '特別避難所（市公表・公開データ未収載）',
    name: '印旛公民館',
    address: '印西市瀬戸1518番地',
    phone: '',
    district: '印旛',
    latitude: 35.780167,
    longitude: 140.224731,
    suitableFor: { earthquake: false, windFlood: true, landslide: true },
    openingStatus: 'not-announced' as const,
    openingEvidence: null,
  },
]

function normalizeMatchText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\s　()（）・･\-ー]/g, '')
    .toLowerCase()
}

function classifyOpeningStatus(shelterName: string, updates: OfficialUpdate[]) {
  const normalizedName = normalizeMatchText(shelterName)
  const relevant = updates.filter((update) => {
    const text = normalizeMatchText(`${update.title}\n${update.message}`)
    return text.includes(normalizedName)
  })
  for (const update of relevant) {
    const text = `${update.title}\n${update.message}`
    if (/閉鎖|閉所|開設.{0,8}(終了|取りやめ)|受入.{0,6}終了/.test(text)) {
      return { openingStatus: 'closed' as const, openingEvidence: update }
    }
  }
  for (const update of relevant) {
    const text = `${update.title}\n${update.message}`
    if (/開設|開放|受け入れ|受入れ|受入開始/.test(text)) {
      return { openingStatus: 'open' as const, openingEvidence: update }
    }
  }
  return { openingStatus: 'not-announced' as const, openingEvidence: null }
}

export async function GET(request: Request) {
  try {
    const [datasetResults, officialUpdates] = await Promise.all([
      Promise.all(DATASETS.map(fetchShelterDataset)),
      fetchOfficialUpdates(),
    ])
    const base = datasetResults.flat()
    const supplemental = SUPPLEMENTAL_SHELTERS.filter(
      (extra) => !base.some((shelter) => shelter.name === extra.name),
    )
    const shelters = [...base, ...supplemental].map((shelter) => ({
      ...shelter,
      ...classifyOpeningStatus(shelter.name, officialUpdates),
    }))
    return json(request, {
      fetchedAt: new Date().toISOString(),
      shelters,
      officialUpdates,
      openingInformation: officialUpdates.length
        ? '印西市防災速報の施設名と開設・閉鎖表現を照合しました。'
        : '現在、印西市防災速報に避難所開設情報は掲載されていません。',
      sources: {
        organization: '印西市 総務部防災課',
        openDataPageUrl: OPEN_DATA_PAGE_URL,
        openDataLicenseUrl: OPEN_DATA_LICENSE_URL,
        cityPortalUrl: CITY_PORTAL_URL,
        resources: DATASETS.map(({ resourceName, url }) => ({ resourceName, url })),
        license: 'CC BY 2.1 JP',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/inzai-shelters]', message)
    return json(request, { error: message }, 502)
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}
