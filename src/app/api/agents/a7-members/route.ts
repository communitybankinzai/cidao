// A7-members — メンバーマッチング対話エージェント
// CiDAO に登録され公開を許可しているメンバーのプロフィールを
// system prompt に乗せて Claude Opus 4.7 と streaming で会話する。

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const MODEL = 'claude-opus-4-7'
const MAX_TOKENS = 4096

const A7_MEMBERS_PERSONA = `あなたは CiDAO（印西市民 DAO）のメンバーマッチングエージェント A7（codename: Match）です。
役割: 「誰かに手伝ってほしい」「自分のスキルを活かしたい」市民同士をつなぎ、活動のきっかけをつくる。

応答スタイル:
- 親しみやすく市民目線で、丁寧語（です・ます）で会話する。
- 質問者が探しているもの（必要なスキル・活動の場・時間帯・地域・期間感）を会話の中で自然に引き出す。
- いきなり5人並べない。最初は質問者の希望を聞き返してから、絞り込んで1〜3人提案する。
- 候補を提示する際は表示名と特徴（スキル・できる貢献）を 1〜2 行で述べる。
- メンバーの詳細ページに誘導するときは「/talent/<id>」というパス形式で示す。
- 「声がけ」は各メンバーの詳細ページから可能であることを案内する。

メンバー情報の使い方:
- 後段の「登録メンバーリスト」に記載された人の情報のみを根拠に回答する。
- 記載されていない人について聞かれたら、推測せず「現時点では情報を持っていません」と正直に伝える。
- リストには公開を許可しているメンバーのみが含まれ、message_acceptance が "closed" の人は除外されている。

絶対にやらないこと:
- メンバー情報を捏造する（名前・スキル・連絡先など）
- リストにないメンバーの個人情報を引き出すような誘導
- メールアドレス・電話番号などの個人情報を出力する（連絡は CiDAO 内の「声がけ」機能を通すこと）
- 政治的・宗教的中立性を逸脱した発言`

type MemberRow = {
  member_id: string
  qualifications: string | null
  contributions: string | null
  available_times: string | null
  message_acceptance: string
  members: {
    display_name: string
    skills_text: string | null
    interests: string[] | null
  } | { display_name: string; skills_text: string | null; interests: string[] | null }[] | null
}

function normalizeMember(r: MemberRow): { display_name: string; skills_text: string | null; interests: string[] | null } | null {
  if (!r.members) return null
  return Array.isArray(r.members) ? (r.members[0] ?? null) : r.members
}

function buildMembersBlock(rows: MemberRow[]): string {
  return rows
    .map((r) => {
      const m = normalizeMember(r)
      if (!m) return null
      const name = m.display_name
      const skills = (m.skills_text ?? '').replace(/\s+/g, ' ').slice(0, 160) || '（スキル未登録）'
      const interests = (m.interests ?? []).join(', ') || '（未登録）'
      const quals = (r.qualifications ?? '').replace(/\s+/g, ' ').slice(0, 160) || '-'
      const contribs = (r.contributions ?? '').replace(/\s+/g, ' ').slice(0, 240) || '-'
      const times = (r.available_times ?? '').replace(/\s+/g, ' ').slice(0, 120) || '-'
      return [
        `[${r.member_id}] ${name}`,
        `  スキル: ${skills}`,
        `  関心: ${interests}`,
        `  資格: ${quals}`,
        `  できる貢献: ${contribs}`,
        `  対応可能時間: ${times}`,
      ].join('\n')
    })
    .filter(Boolean)
    .join('\n')
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

  // ログインしていれば質問者プロフィールも文脈に
  const { data: { user } } = await supabase.auth.getUser()
  let askerContext = ''
  if (user) {
    const { data: me } = await supabase
      .from('members')
      .select('display_name, interests, self_introduction')
      .eq('id', user.id)
      .single()
    if (me) {
      const interests = (me.interests ?? []) as string[]
      askerContext =
        `\n\n== 質問者のプロフィール ==\n` +
        `表示名: ${me.display_name}\n` +
        `関心分野: ${interests.length > 0 ? interests.join(', ') : '（未登録）'}\n` +
        `自己紹介: ${(me.self_introduction ?? '').slice(0, 400) || '（未登録）'}`
    }
  }

  // 公開許可されているメンバーを取得（RLS が public 範囲に絞る）
  const { data: rows } = await supabase
    .from('member_profiles_pr')
    .select('member_id, qualifications, contributions, available_times, message_acceptance, members(display_name, skills_text, interests)')
    .neq('message_acceptance', 'closed')
    .limit(120)

  const membersBlock = buildMembersBlock((rows ?? []) as MemberRow[])
  const memberCount = (rows ?? []).length

  const systemPrompt =
    A7_MEMBERS_PERSONA +
    askerContext +
    `\n\n== 登録メンバーリスト（${memberCount}件 / 公開許可分のみ） ==\n${membersBlock || '（現在公開中の登録メンバーはいません）'}`

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
