import { parse } from 'csv-parse/sync'
import { XMLParser } from 'fast-xml-parser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type ShelterKind = 'specified' | 'special' | 'wide-area'
type OpeningStatus = 'open' | 'closed' | 'not-announced'

type SourceRow = Record<string, string>

type OfficialUpdate = {
  title: string
  message: string
  publishedAt: string
  sourceUrl: string
}

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

const CITY_PORTAL_URL = 'https://www.city.inzai.lg.jp/bousaiportal/'
const CITY_ALERT_INDEX_URL = 'https://www.city.inzai.lg.jp/bousaiinzai/get_bousai_xml.php'
const CITY_ALERT_BASE_URL = 'https://www.city.inzai.lg.jp/bousaiinzai/'
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

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
})

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

function collectNodes(value: unknown, key: string, results: Record<string, unknown>[] = []) {
  if (!value || typeof value !== 'object') return results
  if (Array.isArray(value)) {
    value.forEach((item) => collectNodes(item, key, results))
    return results
  }
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (entryKey.toLowerCase() === key.toLowerCase()) {
      const entries = Array.isArray(entryValue) ? entryValue : [entryValue]
      entries.forEach((entry) => {
        if (entry && typeof entry === 'object') results.push(entry as Record<string, unknown>)
      })
    }
    collectNodes(entryValue, key, results)
  }
  return results
}

function stringValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  return ''
}

function normalizeAlertFilename(value: unknown) {
  const filename = stringValue(value)
  return /^[a-zA-Z0-9_.-]+\.xml$/.test(filename) ? filename : ''
}

async function fetchOfficialUpdates(): Promise<OfficialUpdate[]> {
  const indexResponse = await fetch(CITY_ALERT_INDEX_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'cidao-inzai-disaster-map/1.0' },
    cache: 'no-store',
  })
  if (!indexResponse.ok) throw new Error(`印西市防災速報 HTTP ${indexResponse.status}`)
  const payload = await indexResponse.json().catch(() => [])
  const indexItems = Array.isArray(payload) ? payload : [payload]
  const filenames = indexItems.map((item) => normalizeAlertFilename(item?.fname)).filter(Boolean)
  if (filenames.length === 0) return []

  const xmlDocuments = await Promise.all(filenames.map(async (filename) => {
    const response = await fetch(`${CITY_ALERT_BASE_URL}${filename}`, {
      headers: { Accept: 'application/xml,text/xml', 'User-Agent': 'cidao-inzai-disaster-map/1.0' },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`印西市防災速報XML HTTP ${response.status}`)
    return xmlParser.parse(await response.text()) as Record<string, unknown>
  }))

  return xmlDocuments.flatMap((document) => {
    const publishedAt = collectNodes(document, 'control')
      .map((node) => stringValue(node.DateTime))
      .find(Boolean) ?? ''
    return collectNodes(document, 'homepage').map((node) => ({
      title: stringValue(node.Title),
      message: stringValue(node.Message),
      publishedAt,
      sourceUrl: CITY_PORTAL_URL,
    })).filter((item) => item.title || item.message)
  })
}

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
    const shelters = datasetResults.flat().map((shelter) => ({
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
