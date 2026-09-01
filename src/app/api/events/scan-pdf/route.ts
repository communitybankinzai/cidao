// 広報いんざい（PDF）→ Claude で「市民が参加できるイベント」だけを構造化抽出する。
// 管理画面 /admin/events/import の「広報いんざい取り込み」タブから呼ばれる。
//
// なぜ PDF を直接 Claude に渡すか:
//   紙面は3段組みで、テキスト抽出ライブラリでは欄をまたいだ誤結合が起きる。
//   Claude の document 入力はレイアウトを保ったまま読めるので、抽出ライブラリを足さずに済む。
//
// なぜ1回で全ページを処理しないか:
//   1号あたりのイベント候補が約70件あり（実測: 令和8年9月号は日時付き記事が77件）、
//   全件を1回で出すと出力トークンが Vercel の実行時間上限に収まらない。
//   afterPage を進めながら複数回に分けて呼び、そのたび最大 MAX_EVENTS_PER_CALL 件だけ返す。
//   PDF 本体は cache_control でキャッシュするため、2回目以降の入力コストは約1/10になる。
//
// env: ANTHROPIC_API_KEY 必須
// 認可: 管理者のみ（is_admin）。取得先は印西市の公式ドメインに限定する（SSRF対策）。

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { classifyScanError, type ScanFailReason } from '@/lib/event-scan'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'

export const maxDuration = 60

// 取得を許可するホスト。広報いんざいは印西市公式サイトでのみ配布されている。
const ALLOWED_HOSTS = ['www.city.inzai.lg.jp', 'city.inzai.lg.jp']

// Anthropic の PDF 入力上限はリクエスト32MB。base64 は約4/3に膨らむため元データで20MBを上限とする。
const MAX_PDF_BYTES = 20 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000
const MAX_EVENTS_PER_CALL = 25

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const

const CATEGORY_KEYS = PROPOSAL_CATEGORIES.map((c) => c.key)
const CATEGORY_GUIDE = PROPOSAL_CATEGORIES.map((c) => `${c.key}=${c.label}`).join(' / ')

type ScanPdfResult =
  | { ok: true; doc_id: string; events: unknown[]; last_page: number; has_more: boolean; usage: unknown }
  | { ok: false; reason: ScanFailReason }

// PDF の URL から安定した紙面ID を作る（例: .../kouhou_2609.pdf → kouhou_2609）。
// 重複排除キー `${doc_id}#p22-<タイトル>` の前半に使うので、同じ号なら常に同じ値になる必要がある。
function docIdFromUrl(url: URL): string {
  const base = url.pathname.split('/').pop() ?? 'kouhou'
  return base.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'kouhou'
}

async function fetchPdf(url: URL): Promise<{ ok: true; base64: string } | { ok: false; reason: ScanFailReason }> {
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

  return { ok: true, base64: Buffer.from(raw).toString('base64') }
}

function buildInstruction(afterPage: number): string {
  const from = afterPage > 0 ? `${afterPage + 1}ページ以降` : '最初のページから'
  return [
    'これは千葉県印西市の広報紙「広報いんざい」のPDFです。',
    `PDFの${from}を順に読み、市民が参加・申込できるイベントだけを抽出してください。`,
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
    `【分野】次のいずれかのキーを選んでください: ${CATEGORY_GUIDE}`,
    '',
    `【出力量】1回の応答で最大${MAX_EVENTS_PER_CALL}件までにしてください。`,
    `${MAX_EVENTS_PER_CALL}件に達したらそこで止め、has_more を true、last_page に最後に読み終えたページ番号を入れます。`,
    'PDFの最後まで読み切った場合は has_more を false、last_page にPDFの総ページ数を入れてください。',
    'page には、そのイベントが載っているPDFのページ番号（1始まり）を必ず入れてください。',
  ].join('\n')
}

async function extractEvents(
  apiKey: string,
  pdfBase64: string,
  afterPage: number,
): Promise<
  | { ok: true; events: unknown[]; last_page: number; has_more: boolean; usage: unknown }
  | { ok: false; reason: ScanFailReason }
> {
  const client = new Anthropic({ apiKey })

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: {
        effort: 'medium',
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
                    page: { type: 'integer', description: 'このイベントが載っているPDFのページ番号（1始まり）' },
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
              last_page: { type: 'integer', description: '今回読み終えたページ番号（1始まり）' },
              has_more: { type: 'boolean', description: 'まだ読んでいないページが残っていれば true' },
            },
            required: ['events', 'last_page', 'has_more'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: buildInstruction(afterPage) },
          ],
        },
      ],
    })
  } catch (err) {
    return { ok: false, reason: classifyScanError(err, 'events/scan-pdf') }
  }

  const text = response.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return { ok: false, reason: 'parse' }

  let parsed: { events?: unknown[]; last_page?: number; has_more?: boolean }
  try {
    parsed = JSON.parse(text.text)
  } catch {
    console.error('[events/scan-pdf] JSON parse failed')
    return { ok: false, reason: 'parse' }
  }

  const events = Array.isArray(parsed.events) ? parsed.events : []
  return {
    ok: true,
    events,
    last_page: typeof parsed.last_page === 'number' ? parsed.last_page : afterPage,
    // 1件も取れなかった回で続きを促すと無限ループになるため、件数が0なら打ち切る
    has_more: parsed.has_more === true && events.length > 0,
    usage: response.usage,
  }
}

export async function POST(request: Request): Promise<NextResponse<ScanPdfResult>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, reason: 'config' }, { status: 401 })
  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) return NextResponse.json({ ok: false, reason: 'config' }, { status: 403 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, reason: 'config' })

  let body: { url?: string; afterPage?: number }
  try {
    body = (await request.json()) as { url?: string; afterPage?: number }
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

  const afterPage = Number.isFinite(body.afterPage) ? Math.max(0, Math.floor(body.afterPage as number)) : 0

  const pdf = await fetchPdf(url)
  if (!pdf.ok) return NextResponse.json(pdf)

  const result = await extractEvents(apiKey, pdf.base64, afterPage)
  if (!result.ok) return NextResponse.json(result)

  return NextResponse.json({
    ok: true,
    doc_id: docIdFromUrl(url),
    events: result.events,
    last_page: result.last_page,
    has_more: result.has_more,
    usage: result.usage,
  })
}
