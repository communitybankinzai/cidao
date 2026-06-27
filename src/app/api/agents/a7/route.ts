// A7 (Match) — マッチング対話エージェント
// 印西市内の市民活動団体 219 件のコンテキストを system prompt に乗せて
// Claude Opus 4.7 と streaming で会話する。

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { TYPE_LABEL } from '@/lib/org-labels'

const MODEL = 'claude-opus-4-7'
const MAX_TOKENS = 4096

const A7_PERSONA = `あなたは CiDAO（印西市民 DAO）のマッチングエージェント A7（codename: Match）です。
役割: 印西市内の市民活動団体と市民をつなぎ、「あなたの出番」をつくる。
パートナー: 会計（中司 祐樹）。

応答スタイル:
- 親しみやすく市民目線で、丁寧語（です・ます）で会話する。
- 質問者の状況（活動可能な時間帯・関心領域・既に持っているスキル・距離感）を会話の中で自然に引き出す。
- いきなり団体を5つ並べない。最初は質問者の関心を聞き返してから、絞り込んで1〜3件提案する。
- 候補を提示する際は団体名と種別を併記し、なぜその団体が合うかを 1〜2 行で述べる。
- 団体の詳細ページに誘導するときは「/orgs/<id>」というパス形式で示す。

団体情報の使い方:
- 後段の「団体リスト」に記載された 219 団体の情報のみを根拠に回答する。
- 記載されていない団体について聞かれたら、推測せず「現時点では情報を持っていません」と正直に伝える。
- カテゴリは PROPOSAL_CATEGORIES（machizukuri / kodomo / fukushi / kankyo / bunka / bosai / tabunka / sangyo / gyosei / other）で分類されている。

絶対にやらないこと:
- 団体情報を捏造する（団体名・連絡先・代表者など）
- ユーザーの個人情報を引き出すような誘導
- 政治的・宗教的中立性を逸脱した発言`

type OrgRow = {
  id: string
  name: string
  type: string
  description: string | null
  recruitment_status: string
  organization_categories: { category: string }[] | null
}

function buildOrgsBlock(orgs: OrgRow[]): string {
  return orgs
    .map((o) => {
      const cats = (o.organization_categories ?? []).map((c) => c.category).join(',') || '-'
      const type = TYPE_LABEL[o.type] ?? o.type
      const desc = (o.description ?? '').replace(/\s+/g, ' ').slice(0, 200) || '（概要未登録）'
      return `[${o.id}] ${o.name} / ${type} / cats=${cats}\n  ${desc}`
    })
    .join('\n')
}

function buildCategoryLegend(): string {
  return PROPOSAL_CATEGORIES.map((c) => `  ${c.key}: ${c.label}`).join('\n')
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  let body: { messages?: { role: 'user' | 'assistant'; content: string }[] }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const messages = body.messages ?? []
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const supabase = await createClient()

  // ログインしていればメンバープロフィールも文脈に
  const { data: { user } } = await supabase.auth.getUser()
  let memberContext = ''
  if (user) {
    const { data: member } = await supabase
      .from('members')
      .select('display_name, interests, self_introduction')
      .eq('id', user.id)
      .single()
    if (member) {
      const interests = (member.interests ?? []) as string[]
      memberContext =
        `\n\n== 質問者のプロフィール ==\n` +
        `表示名: ${member.display_name}\n` +
        `関心分野: ${interests.length > 0 ? interests.join(', ') : '（未登録）'}\n` +
        `自己紹介: ${(member.self_introduction ?? '').slice(0, 400) || '（未登録）'}`
    }
  }

  // 全公開団体 + カテゴリを取得
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, type, description, recruitment_status, organization_categories(category)')
    .eq('public_flag', true)
    .order('name')

  const orgsBlock = buildOrgsBlock((orgs ?? []) as OrgRow[])

  const systemPrompt =
    A7_PERSONA +
    `\n\n== カテゴリ凡例 ==\n${buildCategoryLegend()}` +
    memberContext +
    `\n\n== 団体リスト（${(orgs ?? []).length}件）==\n${orgsBlock}`

  const client = new Anthropic({ apiKey })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        const aStream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        })

        for await (const event of aStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        controller.close()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'stream error'
        controller.enqueue(encoder.encode(`\n\n[エラー: ${msg}]`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-accel-buffering': 'no',
    },
  })
}
