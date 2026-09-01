// 広報いんざい（PDF）→ Claude で「市民が参加できるイベント」だけを構造化抽出する。
// 管理画面 /admin/events/import の「広報いんざいから取り込む」から呼ばれる。
//
// なぜ PDF をそのまま Claude に渡さないか:
//   当初は PDF を document ブロックで直接渡していたが、11MB・30ページの読み取りに
//   60秒以上かかり、Vercel（Hobby プラン）の実行時間上限で 504 になった（2026-09-01 実測）。
//   unpdf でページ単位のテキストにしてから渡すと入力が約1/5になり、処理時間もコストも下がる。
//   紙面は3段組みだが、pypdf / unpdf いずれでも段ごとの読み順は保たれることを実測で確認している。
//
// なぜ1回で全ページを処理しないか:
//   1号あたりのイベント候補が約70件あり（実測: 令和8年9月号は日時付き記事が77件）、
//   全件を1回で出すと出力トークンだけで60秒を超える。
//   呼び出し側が fromPage/toPage をずらしながら複数回に分けて呼ぶ。
//   総ページ数はこちらが返すので、どこまで読んだかを AI の判断に委ねなくて済む。
//
// env: ANTHROPIC_API_KEY 必須
// 認可: 管理者のみ（is_admin）。取得先は印西市の公式ドメインに限定する（SSRF対策）。

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { extractText } from 'unpdf'
import { createClient } from '@/lib/supabase/server'
import { classifyScanError, type ScanFailReason } from '@/lib/event-scan'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'

export const maxDuration = 60

// 取得を許可するホスト。広報いんざいは印西市公式サイトでのみ配布されている。
const ALLOWED_HOSTS = ['www.city.inzai.lg.jp', 'city.inzai.lg.jp']

const MAX_PDF_BYTES = 20 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

// 1回の呼び出しで読むページ数の上限。呼び出し側は6ページずつ送ってくる。
// ここを増やすと出力トークンが伸びて 504 の危険が戻るので、上限も低く抑えておく。
const MAX_PAGES_PER_CALL = 8
// 念のための文字数上限。1ページ約1,600字なので8ページなら1万3千字前後になる（実測値）。
const MAX_TEXT_CHARS = 40_000

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const

const CATEGORY_KEYS = PROPOSAL_CATEGORIES.map((c) => c.key)
const CATEGORY_GUIDE = PROPOSAL_CATEGORIES.map((c) => `${c.key}=${c.label}`).join(' / ')

type ScanPdfResult =
  | {
      ok: true
      doc_id: string
      total_pages: number
      from_page: number
      to_page: number
      events: unknown[]
      usage: unknown
    }
  | { ok: false; reason: ScanFailReason }

// PDF の URL から安定した紙面ID を作る（例: .../kouhou_2609.pdf → kouhou_2609）。
// 重複排除キー `${doc_id}#p22-<タイトル>` の前半に使うので、同じ号なら常に同じ値になる必要がある。
function docIdFromUrl(url: URL): string {
  const base = url.pathname.split('/').pop() ?? 'kouhou'
  return base.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'kouhou'
}

async function fetchPdf(url: URL): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: ScanFailReason }> {
  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; CiDAO-EventScan/1.0; +https://cidao.jp)',
        accept: 'application/pdf',
      },
    })
  } catch (err) {
    console.warn('[events/scan-pdf] fetch failed:', err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'fetch' }
  }
  if (!res.ok) {
    console.warn('[events/scan-pdf] fetch status:', res.status, url.href)
    return { ok: false, reason: 'fetch' }
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType && !/application\/pdf|application\/octet-stream/i.test(contentType)) {
    console.warn('[events/scan-pdf] unexpected content-type:', contentType)
    return { ok: false, reason: 'fetch' }
  }
  const raw = await res.arrayBuffer()
  if (raw.byteLength === 0) return { ok: false, reason: 'fetch' }
  if (raw.byteLength > MAX_PDF_BYTES) return { ok: false, reason: 'too_large' }
  // 拡張子や content-type を偽られても、PDF でなければここで弾く
  const head = new TextDecoder('latin1').decode(raw.slice(0, 5))
  if (!head.startsWith('%PDF-')) return { ok: false, reason: 'fetch' }

  return { ok: true, bytes: new Uint8Array(raw) }
}

function buildInstruction(fromPage: number, toPage: number, pageText: string): string {
  return [
    'これは千葉県印西市の広報紙「広報いんざい」から取り出した本文です。',
    `${fromPage}〜${toPage}ページ分が「=== Nページ ===」の見出しで区切られています。`,
    'この中から、市民が参加・申込できるイベントだけを抽出してください。',
    '',
    '【抽出するもの】講座・教室・講演会・イベント・催し・体験会・相談会・見学会・健診の集団開催日・',
    'コンサート・展示会・スポーツ教室・ボランティア募集の説明会など、',
    '市民がその日時にその場所へ行って参加できるもの。',
    '',
    '【抽出しないもの】給付金や手当の申請案内、制度・料金改定のお知らせ、税や保険料の納期、',
    '職員採用募集、統計データ、施設の休館案内、注意喚起（防犯・外来生物など）、',
    '窓口業務の変更案内。これらは「参加する場」ではないので除外してください。',
    '',
    '【日時】開催日時が特定できるものだけを対象にします。申込期限しか書かれていない記事は除外。',
    '「9月24日㈭14時～15時30分」のような表記は start_at/end_at に分解してください。',
    '終了時刻の記載がなければ開始の1時間後を入れます。年は紙面の発行年（西暦）で補ってください。',
    '同じイベントが複数日程で開催される場合は occurrences に各回を列挙してください。',
    '',
    '【説明文】紙面の文章をそのまま書き写さず、100〜150字で要約してください。',
    '',
    '【記号の意味】時=日時 / 場=会場 / 内=内容 / 対=対象 / 定=定員 / 費=費用 / 申=申込方法 / 問=問い合わせ先 / 講=講師',
    '',
    `【分野】次のいずれかのキーを選んでください: ${CATEGORY_GUIDE}`,
    '',
    'page には、そのイベントが載っていたページ番号（「=== Nページ ===」の N）を入れてください。',
    '',
    '--- ここから本文 ---',
    pageText,
  ].join('\n')
}

async function extractEvents(
  apiKey: string,
  fromPage: number,
  toPage: number,
  pageText: string,
): Promise<{ ok: true; events: unknown[]; usage: unknown } | { ok: false; reason: ScanFailReason }> {
  const client = new Anthropic({ apiKey })

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 12000,
      output_config: {
        // 60秒以内に応答を返し切る必要があるため、抽出の深さより速度を優先する
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              events: {
                type: 'array',
                description: '市民が参加できるイベント。該当がなければ空配列。',
                items: {
                  type: 'object',
                  properties: {
                    page: { type: 'integer', description: 'このイベントが載っていたページ番号' },
                    title: { type: 'string', description: 'イベント名。80字以内。' },
                    description: { type: 'string', description: 'イベント内容を100〜150字で要約（原文の写しは不可）。' },
                    start_at: { ...nullableString, description: '開始日時。YYYY-MM-DDTHH:MM（JST）。読み取れない場合 null。' },
                    end_at: { ...nullableString, description: '終了日時。YYYY-MM-DDTHH:MM（JST）。記載が無ければ開始の1時間後。' },
                    location: { ...nullableString, description: '会場。例: そうふけ公民館' },
                    online_flag: { type: 'boolean', description: 'オンライン開催なら true' },
                    organizer_name: { ...nullableString, description: '主催・問い合わせ先の課名や団体名。会場とは別物。' },
                    capacity: { ...nullableInteger, description: '定員（人数）。記載なしは null。' },
                    fee: { ...nullableInteger, description: '参加費（円）。無料は 0、記載なしは null。' },
                    category: { type: 'string', enum: CATEGORY_KEYS, description: '市民活動分野のキー' },
                    occurrences: {
                      type: 'array',
                      description: '複数日程で開催される場合の各回。単発なら start_at/end_at と同じ内容を1件だけ入れる。',
                      items: {
                        type: 'object',
                        properties: {
                          start_at: { type: 'string', description: 'YYYY-MM-DDTHH:MM（JST）' },
                          end_at: { type: 'string', description: 'YYYY-MM-DDTHH:MM（JST）' },
                        },
                        required: ['start_at', 'end_at'],
                        additionalProperties: false,
                      },
                    },
                    confidence: { type: 'number', description: '0〜1の抽出自信度' },
                  },
                  required: [
                    'page',
                    'title',
                    'description',
                    'start_at',
                    'end_at',
                    'location',
                    'online_flag',
                    'organizer_name',
                    'capacity',
                    'fee',
                    'category',
                    'occurrences',
                    'confidence',
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ['events'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content: buildInstruction(fromPage, toPage, pageText) }],
    })
  } catch (err) {
    return { ok: false, reason: classifyScanError(err, 'events/scan-pdf') }
  }

  const text = response.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return { ok: false, reason: 'parse' }

  let parsed: { events?: unknown[] }
  try {
    parsed = JSON.parse(text.text)
  } catch {
    console.error('[events/scan-pdf] JSON parse failed')
    return { ok: false, reason: 'parse' }
  }

  return { ok: true, events: Array.isArray(parsed.events) ? parsed.events : [], usage: response.usage }
}

export async function POST(request: Request): Promise<NextResponse<ScanPdfResult>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, reason: 'config' }, { status: 401 })
  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) return NextResponse.json({ ok: false, reason: 'config' }, { status: 403 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, reason: 'config' })

  let body: { url?: string; fromPage?: number; toPage?: number }
  try {
    body = (await request.json()) as { url?: string; fromPage?: number; toPage?: number }
  } catch {
    return NextResponse.json({ ok: false, reason: 'blocked_url' })
  }

  let url: URL
  try {
    url = new URL(body.url ?? '')
  } catch {
    return NextResponse.json({ ok: false, reason: 'blocked_url' })
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
    return NextResponse.json({ ok: false, reason: 'blocked_url' })
  }
  if (!/\.pdf$/i.test(url.pathname)) {
    return NextResponse.json({ ok: false, reason: 'blocked_url' })
  }

  const pdf = await fetchPdf(url)
  if (!pdf.ok) return NextResponse.json(pdf)

  let totalPages: number
  let pages: string[]
  try {
    const extracted = await extractText(pdf.bytes, { mergePages: false })
    totalPages = extracted.totalPages
    pages = extracted.text
  } catch (err) {
    console.error('[events/scan-pdf] text extraction failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, reason: 'parse' })
  }
  if (totalPages === 0) return NextResponse.json({ ok: false, reason: 'parse' })

  // ページ範囲を決める。未指定なら先頭から MAX_PAGES_PER_CALL ページ分。
  const fromPage = Math.min(Math.max(1, Math.floor(body.fromPage ?? 1)), totalPages)
  const requestedTo = Math.floor(body.toPage ?? fromPage + MAX_PAGES_PER_CALL - 1)
  const toPage = Math.min(Math.max(fromPage, requestedTo), fromPage + MAX_PAGES_PER_CALL - 1, totalPages)

  let pageText = ''
  for (let p = fromPage; p <= toPage; p++) {
    const body = (pages[p - 1] ?? '').trim()
    if (!body) continue
    pageText += `=== ${p}ページ ===\n${body}\n\n`
  }
  pageText = pageText.slice(0, MAX_TEXT_CHARS)

  // 本文が実質空なら、テキストを持たない紙面（画像PDF）。AI に投げても意味がない。
  if (pageText.trim().length < 50) {
    return NextResponse.json({
      ok: true,
      doc_id: docIdFromUrl(url),
      total_pages: totalPages,
      from_page: fromPage,
      to_page: toPage,
      events: [],
      usage: null,
    })
  }

  const result = await extractEvents(apiKey, fromPage, toPage, pageText)
  if (!result.ok) return NextResponse.json(result)

  return NextResponse.json({
    ok: true,
    doc_id: docIdFromUrl(url),
    total_pages: totalPages,
    from_page: fromPage,
    to_page: toPage,
    events: result.events,
    usage: result.usage,
  })
}
