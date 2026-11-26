// いまの雨（印西市の中心）。防災MAPの冠水の用途の帯・段階ボタンが読む（2026-11-26）。
// 記録ごとの判定（passed-roads の rainAt・判定 v2.1）と同じ式・同じ観測所の重み付けで、
// 「ここ数日の雨（古い雨ほど小さく数えた合計・48時間で半分）」＝ api を返す。
// 地図側の物差しを、記録の判定と同じ1つにそろえるため（それまでは帯が「3日間の単純な合計」を使っていた）。

import { NextResponse } from 'next/server'
import { rainAt } from '@/lib/disaster-amedas-rain'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// 防災MAPの INZAI_CENTER と同じ点
const INZAI_CENTER: [number, number] = [35.805, 140.15]
const CACHE_MS = 5 * 60 * 1000 // アメダスは10分ごとの更新。関数の中で5分使い回す

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8767',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8767',
])

let cached: { at: number; body: unknown } | null = null

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    Vary: 'Origin',
    'Cache-Control': 'public, max-age=60, s-maxage=300',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })
}

export async function GET(request: Request) {
  const headers = corsHeaders(request)
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const rain = await rainAt(INZAI_CENTER, new Date())
    if (rain.verdict === 'unknown' && rain.api == null) {
      return NextResponse.json({ error: 'rain_unavailable', station: rain.station }, { status: 502, headers })
    }
    cached = {
      at: Date.now(),
      body: {
        at: rain.at,
        station: rain.station,
        r1h: rain.r1h,
        r24h: rain.r24h,
        r72h: rain.r72h ?? null,
        api: rain.api ?? null, // ここ数日の雨（割り引いた合計・mm）
        verdict: rain.verdict,
        basis: rain.basis ?? null,
        halfLifeHours: 48,
      },
    }
  }
  return NextResponse.json(cached.body, { headers })
}
