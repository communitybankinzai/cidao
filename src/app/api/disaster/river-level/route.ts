// 手賀沼の水位（千葉県 水防情報「水位グラフ:手賀沼」）を読み取り、最新値と警戒段階を返す。
//
// 千葉県のページは http のみ・Shift_JIS の HTML で、閲覧者のブラウザ（https の防災MAP）からは直接読めない。
// ここで受けて 10 分キャッシュする。**定期巡回はしない**（MAP が開かれたときだけ取りにいく）ので、
// 閲覧者が何人でも県への取得は 10 分に 1 回まで＝1日最大 144 回。
//
// 利根川（国の観測所）はここで取得しない。国の「川の防災情報」は利用規約で
// 「定期的・定常的なデータ収集は控え、データ配信（有償）を使う」よう求めているため（2026-09-21 確認）。
// MAP 側では利根川は基準値と公式ページへのリンクだけを出す。
//
// ⚠ 県のページには 0.00（深夜に連続して出た・実際にはあり得ない値）と ***（欠測）が混ざる。
//    どちらも欠測として扱い、最新の有効な値を採る。
// ⚠ 県の利用条件は未確認（2026-09-21 時点）。問い合わせ中。停止の要請があれば直ちに止めること。
import { NextResponse } from 'next/server'

const SOURCE_URL = 'http://suibo.bousai.pref.chiba.lg.jp/bousaip/river/graph_90_0.html'
const SOURCE_PAGE = 'http://suibo.bousai.pref.chiba.lg.jp/bousaip/river/graph_90_0.html'
const CACHE_SECONDS = 600

// ページから読めなかったときの基準値（2026-09-21 に県ページと国の観測所情報の両方で確認）
const DEFAULT_LEVELS = { standby: 2.4, caution: 2.6, danger: 2.8 }

const ALLOWED_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:4173',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://localhost:8791',
  'http://localhost:8792',
  'http://localhost:8793',
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

type Reading = { time: string; level: number }

function readLevel(html: string, label: string): number | null {
  const m = html.match(new RegExp(`${label}[\\s\\S]{0,120}?([0-9]+\\.[0-9]+)m`))
  return m ? Number(m[1]) : null
}

// 表は1行に「HH時の6値（00〜50分）」を左右2つ（0〜11時・12〜23時）並べている
function parseTeganuma(html: string) {
  const dateMatch = html.match(/(\d{4})年(\d{2})月(\d{2})日/)
  if (!dateMatch) throw new Error('観測日が読めません')
  const [, y, mo, d] = dateMatch

  const readings: Reading[] = []
  const block = /class="title">(\d{2})<\/th>((?:\s*<td[^>]*>[^<]*<\/td>){6})/g
  for (const m of html.matchAll(block)) {
    const hour = m[1]
    const cells = [...m[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1].replace(/&nbsp;/g, '').trim())
    cells.forEach((text, i) => {
      if (!/^\d+\.\d+$/.test(text)) return // 空欄（未受信）・***（欠測）・---（無効）
      const level = Number(text)
      if (!(level > 0)) return // 0.00 は欠測扱い
      readings.push({ time: `${y}-${mo}-${d}T${hour}:${String(i * 10).padStart(2, '0')}:00+09:00`, level })
    })
  }
  readings.sort((a, b) => a.time.localeCompare(b.time))

  const levels = {
    standby: readLevel(html, '水防団待機水位') ?? DEFAULT_LEVELS.standby,
    caution: readLevel(html, 'はん濫注意水位') ?? DEFAULT_LEVELS.caution,
    danger: readLevel(html, 'はん濫危険水位') ?? DEFAULT_LEVELS.danger,
  }
  return { readings, levels }
}

function stageOf(level: number, levels: { standby: number; caution: number; danger: number }) {
  if (level >= levels.danger) return 'danger'
  if (level >= levels.caution) return 'caution'
  if (level >= levels.standby) return 'standby'
  return 'normal'
}

export async function GET(request: Request) {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)' },
      next: { revalidate: CACHE_SECONDS },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = new TextDecoder('shift_jis').decode(await response.arrayBuffer())
    const { readings, levels } = parseTeganuma(html)
    const latest = readings.at(-1) ?? null
    // 1時間前（6つ前の有効値ではなく、時刻で60分前に最も近い値）との差
    let change1h: number | null = null
    if (latest) {
      const target = new Date(latest.time).getTime() - 3600_000
      const past = readings.filter((r) => new Date(r.time).getTime() <= target).at(-1)
      if (past) change1h = Math.round((latest.level - past.level) * 100) / 100
    }

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        stations: [
          {
            id: 'teganuma',
            name: '手賀沼',
            river: '手賀沼',
            manager: '千葉県（柏土木事務所）',
            latest,
            change1h,
            stage: latest ? stageOf(latest.level, levels) : 'unknown',
            levels,
            recent: readings.slice(-18),
          },
        ],
        source: { name: '千葉県 水防情報「水位グラフ:手賀沼」', url: SOURCE_PAGE },
        note: '千葉県の観測値をCBIが読み取って表示しています。0.00と欠測は除いています。避難の判断は市の避難情報に従ってください。',
      },
      { headers: { ...corsHeaders(request), 'Cache-Control': `public, max-age=300, s-maxage=${CACHE_SECONDS}` } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[disaster/river-level]', message)
    return NextResponse.json({ error: message }, { status: 502, headers: corsHeaders(request) })
  }
}
