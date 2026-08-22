// GET /api/disaster/inzai-opendata?set=<キー>
// 印西市公式オープンデータ（わが街ガイド）のうち、避難所・井戸以外をまとめて配信する。
// 個別APIを増やさず1本にしているのは、どれもCSVの点データで処理が共通のため。
// 出典・ライセンス（CC BY 2.1 JP）は必ずレスポンスに含め、表示側でも明示する。

import { parse } from 'csv-parse/sync'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type SourceRow = Record<string, string>

type Feature = {
  id: string
  name: string
  address: string
  phone: string
  category: string
  // 土砂災害区域のみ：告示情報と現象種別（急傾斜地の崩壊など）
  detail: string
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
const CSV_BASE = 'https://www2.wagmap.jp/inzai/inzai/opendata/map/CSV'

// 名前列がデータセットごとに違う（名称/箇所名/NAME）ため個別に指定する
const DATASETS: Record<string, {
  file: number
  label: string
  nameColumn: string
  fallbackName: string
  note?: string
}> = {
  landslideWarning: {
    file: 21,
    label: '土砂災害警戒区域（印西市公表）',
    nameColumn: '箇所名',
    fallbackName: '警戒区域',
    note: '千葉県が指定した区域の代表点です。区域の正確な範囲は印西市・千葉県の公表資料を確認してください。',
  },
  landslideSpecial: {
    file: 22,
    label: '土砂災害特別警戒区域（印西市公表）',
    nameColumn: '箇所名',
    fallbackName: '特別警戒区域',
    note: '千葉県が指定した区域の代表点です。区域の正確な範囲は印西市・千葉県の公表資料を確認してください。',
  },
  cityOffice: { file: 27, label: '市役所・支所', nameColumn: 'NAME', fallbackName: '市の施設' },
  police: { file: 28, label: '警察機関', nameColumn: '名称', fallbackName: '警察機関' },
  fire: { file: 29, label: '消防署', nameColumn: '名称', fallbackName: '消防署' },
  emergencyRoute: {
    file: 31,
    label: '緊急輸送路',
    nameColumn: '名称',
    fallbackName: '緊急輸送路',
    note: '災害時の輸送に使われる主要路線の代表点です。通行可否を示すものではありません。',
  },
  railway: {
    file: 32,
    label: '鉄道',
    nameColumn: '名称',
    fallbackName: '鉄道施設',
    note: '公表データに名称が含まれないため、地点のみ表示しています。',
  },
}

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

// 市のCSVは現在UTF-8(BOM)。将来Shift_JISへ変わっても壊れないよう両対応にする
function decodeCsv(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if ((utf8.match(/�/g) || []).length > 3) {
    try {
      return new TextDecoder('shift_jis').decode(bytes)
    } catch {
      return utf8
    }
  }
  return utf8
}

export async function GET(request: Request) {
  const setKey = new URL(request.url).searchParams.get('set') ?? ''
  const dataset = DATASETS[setKey]
  if (!dataset) {
    return json(request, { error: `不明なデータセットです。set= に ${Object.keys(DATASETS).join(' / ')} のいずれかを指定してください。` }, 400)
  }

  try {
    const url = `${CSV_BASE}/opendata_${dataset.file}.csv`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      return json(request, { error: `オープンデータの取得に失敗しました（HTTP ${response.status}）` }, 502)
    }
    const rows = parse(decodeCsv(await response.arrayBuffer()), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as SourceRow[]

    const features: Feature[] = []
    rows.forEach((row, index) => {
      const latitude = safeNumber(row['緯度'])
      const longitude = safeNumber(row['経度'])
      if (latitude === null || longitude === null) return
      const rawName = String(row[dataset.nameColumn] ?? '').trim()
      // 土砂災害は「急傾斜地の崩壊」等の現象と告示日を補足として持たせる
      const phenomenon = String(row['現象'] ?? '').trim()
      const notice = String(row['告示年月日'] ?? '').trim()
      features.push({
        id: `${setKey}:${index + 1}`,
        name: rawName || dataset.fallbackName,
        address: String(row['住所'] ?? row['所在地'] ?? '').trim(),
        phone: String(row['電話番号'] ?? '').trim(),
        category: String(row['分類'] ?? dataset.label).trim(),
        detail: [phenomenon, notice ? `告示 ${notice}` : ''].filter(Boolean).join(' / '),
        latitude,
        longitude,
      })
    })

    return json(request, {
      fetchedAt: new Date().toISOString(),
      set: setKey,
      label: dataset.label,
      note: dataset.note ?? '',
      features,
      sources: {
        organization: '印西市',
        openDataPageUrl: OPEN_DATA_PAGE_URL,
        openDataLicenseUrl: OPEN_DATA_LICENSE_URL,
        resources: [{ resourceName: dataset.label, url }],
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
