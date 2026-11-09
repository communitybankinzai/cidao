import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// 文化財ガイド帳（cbi-site/metaverse/guide/）・スタンプラリー（rally/）の「その場の翻訳」
// ガイドが日本語で話した補足を英語に、観光客の英語の質問を日本語にする。Gemini を呼ぶ鍵をブラウザに置かないための中継。
//   POST { text, from: 'ja'|'en', to: 'en'|'ja' } → { text: 翻訳文, model }
// 文は 400 文字まで。保存はしない（ログにも本文を書かない）。
// 鍵は Vercel の環境変数 GEMINI_API_KEY（N's factory / CBI 共有の前払いプロジェクト）。モデルは GEMINI_MODEL で差し替え可。

const PUBLIC_ORIGINS = new Set([
  'https://communitybankinzai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8767',
  'http://127.0.0.1:8767',
])

const MAX_CHARS = 400
// 2026-11-09: gemini-2.5-flash-lite は「新規利用者には提供終了」（404）だったので 3.5 の lite に。別名 gemini-flash-lite-latest でも可
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const LANG_NAME: Record<string, string> = { ja: 'Japanese', en: 'English' }

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGINS.has(origin) ? origin : 'https://communitybankinzai.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// 文化財の固有名詞は読みと意味が伝わるように。説明は足さず、訳文だけを返させる
function buildPrompt(text: string, from: string, to: string): string {
  const glossary =
    to === 'en'
      ? 'Keep Japanese proper nouns in romaji followed by a short gloss when it helps, e.g. "Kioroshi Shell Bed", "Musashiya (former inn)". Eras: give the Western year when the source gives one.'
      : '固有名詞（文化財名・地名）は日本語の正式名称にそろえる。敬語は丁寧語（です・ます）。'
  return (
    `You are an interpreter for a volunteer heritage guide in Inzai City, Chiba, Japan. ` +
    `Translate the following ${LANG_NAME[from]} speech into natural spoken ${LANG_NAME[to]} for tourists. ` +
    `Return only the translation, no quotes, no notes. ${glossary}\n\n` +
    `${LANG_NAME[from]}: ${text}`
  )
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY ?? ''
  if (!key) return json(request, { error: 'server not configured' }, 500)
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { return json(request, { error: 'invalid json' }, 400) }
  const text = String(body.text ?? '').replace(/\s+/g, ' ').trim()
  const from = String(body.from ?? 'ja')
  const to = String(body.to ?? 'en')
  if (!text) return json(request, { error: 'text required' }, 400)
  if (text.length > MAX_CHARS) return json(request, { error: `text too long (max ${MAX_CHARS})` }, 413)
  if (!(from in LANG_NAME) || !(to in LANG_NAME) || from === to) return json(request, { error: 'unsupported language pair' }, 400)

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const payload = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(text, from, to) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const status = res.status === 429 ? 429 : 502
      return json(request, { error: `translation service error (${res.status})` }, status)
    }
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }
    // 思考過程の part（thought: true）は訳文に混ぜない
    const out = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim()
    if (!out) return json(request, { error: 'empty translation' }, 502)
    return json(request, { text: out, model })
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return json(request, { error: aborted ? 'translation timed out' : 'translation failed' }, aborted ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
}
