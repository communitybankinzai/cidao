// 地震情報の取りまとめ（2026-11-26）。防災MAPが20秒ごとに読む。
//
// P2P地震情報の WebSocket は「同じ IP アドレスから2接続まで」（仕様 https://www.p2pquake.net/develop/json_api_v2/）。
// 防災MAPを開いた端末が1台ずつ直接つなぐと、携帯回線（多くの人で同じ IP を共有）や家族・職場の同じ Wi-Fi では
// 3人目以降が断られ、速報が届かない。大勢が一斉に開く大地震のときほど届かない人が増える。
// そこで CiDAO が P2P の履歴（/v2/history・60リクエスト/分/IP）をまとめて読み、配信側（CDN）で15秒まとめて配る。
// 何人が開いても、P2P への取得は1分に数回で済む。
//
// 返すもの：地震情報（code 551）の新しい順12件。中身は P2P のまま（地図の handleQuakeP2P がそのまま読む）。
// ただし「各地の震度（DetailScale）」の観測点は印西市のものだけに絞る（大きな地震では数千地点になり重いため。地図は印西市しか使わない）。

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const SOURCE = 'https://api.p2pquake.net/v2/history?codes=551&limit=12'
const CACHE_MS = 10 * 1000

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8767',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8767',
])

type P2PMessage = {
  id?: string
  _id?: string
  code?: number
  time?: string
  issue?: { type?: string; time?: string }
  earthquake?: unknown
  points?: Array<{ addr?: string; pref?: string; scale?: number; isArea?: boolean }>
}

let cached: { at: number; body: P2PMessage[] } | null = null

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    Vary: 'Origin',
    // 配信側で15秒まとめる。期限切れの直後も30秒は前の中身を返しつつ裏で取り直す
    'Cache-Control': 'public, max-age=10, s-maxage=15, stale-while-revalidate=30',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })
}

function trimMessage(m: P2PMessage): P2PMessage {
  if (m.issue?.type !== 'DetailScale' || !Array.isArray(m.points)) return m
  return { ...m, points: m.points.filter((p) => String(p.addr ?? '').startsWith('印西市')) }
}

export async function GET(request: Request) {
  const headers = corsHeaders(request)
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    try {
      const res = await fetch(SOURCE, {
        headers: { 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`P2P地震情報 HTTP ${res.status}`)
      const list = (await res.json()) as P2PMessage[]
      if (!Array.isArray(list)) throw new Error('P2P地震情報の形が違います')
      cached = { at: Date.now(), body: list.filter((m) => m?.code === 551).map(trimMessage) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[disaster/quake-feed]', message)
      // 取れないときは前回の中身があれば返す（地図は時刻で古い地震を見分ける）
      if (!cached) return NextResponse.json({ error: message }, { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } })
    }
  }
  return NextResponse.json(cached!.body, { headers })
}
