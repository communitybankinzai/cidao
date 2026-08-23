// 印西市防災速報（防災行政無線の放送内容）XML の取得。
// inzai-shelters API と災害タイムライン（city-alert-xml）が共用する。
// index JSON（get_bousai_xml.php）→ fname → XML → control.DateTime / homepage.Title / Message の順に辿る。

import { XMLParser } from 'fast-xml-parser'

export type OfficialUpdate = {
  title: string
  message: string
  publishedAt: string
  sourceUrl: string
}

export const CITY_PORTAL_URL = 'https://www.city.inzai.lg.jp/bousaiportal/'
export const CITY_ALERT_INDEX_URL = 'https://www.city.inzai.lg.jp/bousaiinzai/get_bousai_xml.php'
export const CITY_ALERT_BASE_URL = 'https://www.city.inzai.lg.jp/bousaiinzai/'

const USER_AGENT = 'cidao-inzai-disaster-map/1.0'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
})

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

export async function fetchOfficialUpdates(options: {
  indexUrl?: string
  baseUrl?: string
  sourceUrl?: string
} = {}): Promise<OfficialUpdate[]> {
  const indexUrl = options.indexUrl || CITY_ALERT_INDEX_URL
  const baseUrl = options.baseUrl || CITY_ALERT_BASE_URL
  const sourceUrl = options.sourceUrl || CITY_PORTAL_URL

  const indexResponse = await fetch(indexUrl, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    cache: 'no-store',
  })
  if (!indexResponse.ok) throw new Error(`印西市防災速報 HTTP ${indexResponse.status}`)
  const payload = await indexResponse.json().catch(() => [])
  const indexItems = Array.isArray(payload) ? payload : [payload]
  // {"fname":0} は「現在の放送なし」。エラーではなく 0 件として扱う。
  const filenames = indexItems.map((item) => normalizeAlertFilename(item?.fname)).filter(Boolean)
  if (filenames.length === 0) return []

  const xmlDocuments = await Promise.all(filenames.map(async (filename) => {
    const response = await fetch(`${baseUrl}${filename}`, {
      headers: { Accept: 'application/xml,text/xml', 'User-Agent': USER_AGENT },
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
      sourceUrl,
    })).filter((item) => item.title || item.message)
  })
}
