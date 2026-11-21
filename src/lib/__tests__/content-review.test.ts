import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import {
  ALL_CATEGORIES, CATEGORY_LABEL, CLASSIFY_SYSTEM_PROMPT, DEFAULT_DAILY_AI_LIMIT, HEAVY_CATEGORIES, LIGHT_CATEGORIES,
  adminMailText, adminNoticeText, buildReviewText, canHoldTarget, categoryLabels, classifyContent, decideVerdict,
  limitReached, parseSetting, sanitizeCategories, sanitizeConfidence, summarizeOpen, summaryText, targetPath,
  textChanged, titleSnapshot, verdictForTarget,
} from '@/lib/content-review'

describe('区分の決め方（decideVerdict）', () => {
  it('該当なしは ok', () => {
    expect(decideVerdict([], 'high')).toBe('ok')
  })
  it('重い区分は確度 high のときだけ hold', () => {
    for (const c of HEAVY_CATEGORIES) {
      expect(decideVerdict([c], 'high')).toBe('hold')
      expect(decideVerdict([c], 'mid')).toBe('notify')
      expect(decideVerdict([c], 'low')).toBe('notify')
    }
  })
  it('軽い区分は確度が高くても notify（止めない）', () => {
    for (const c of LIGHT_CATEGORIES) expect(decideVerdict([c], 'high')).toBe('notify')
  })
  it('軽い区分と重い区分が混ざり、確度が高ければ hold', () => {
    expect(decideVerdict(['politics', 'fraud'], 'high')).toBe('hold')
    expect(decideVerdict(['politics', 'fraud'], 'low')).toBe('notify')
  })
  it('区分は全部で8つ（重い5・軽い3）', () => {
    expect(HEAVY_CATEGORIES).toHaveLength(5)
    expect(LIGHT_CATEGORIES).toHaveLength(3)
    expect(ALL_CATEGORIES.every((c) => CATEGORY_LABEL[c])).toBe(true)
  })
})

describe('入口ごとの止め方', () => {
  it('止められるのは催し・FreeFree・団体・提案だけ', () => {
    expect(canHoldTarget('event')).toBe(true)
    expect(canHoldTarget('freefree')).toBe(true)
    expect(canHoldTarget('org')).toBe(true)
    expect(canHoldTarget('proposal')).toBe(true)
    expect(canHoldTarget('freefree_comment')).toBe(false)
    expect(canHoldTarget('proposal_comment')).toBe(false)
  })
  it('コメントの hold は notify に落ちる（ok と notify はそのまま）', () => {
    expect(verdictForTarget('hold', 'freefree_comment')).toBe('notify')
    expect(verdictForTarget('hold', 'proposal_comment')).toBe('notify')
    expect(verdictForTarget('hold', 'event')).toBe('hold')
    expect(verdictForTarget('notify', 'event')).toBe('notify')
    expect(verdictForTarget('ok', 'freefree_comment')).toBe('ok')
  })
})

describe('AI の答えの整え方', () => {
  it('知らない区分・重複・配列でないものは捨てる', () => {
    expect(sanitizeCategories(['fraud', 'fraud', 'bogus', 'politics'])).toEqual(['fraud', 'politics'])
    expect(sanitizeCategories('fraud')).toEqual([])
    expect(sanitizeCategories(undefined)).toEqual([])
  })
  it('確度は high/mid/low 以外なら low（止めない側に倒す）', () => {
    expect(sanitizeConfidence('high')).toBe('high')
    expect(sanitizeConfidence('very high')).toBe('low')
    expect(sanitizeConfidence(undefined)).toBe('low')
  })
})

describe('類別する文の組み立て', () => {
  it('空の部分を飛ばして改行でつなぐ', () => {
    expect(buildReviewText(['題名', '', null, undefined, ' 本文 '])).toBe('題名\n本文')
  })
  it('長すぎるときは3000字で切る', () => {
    expect(buildReviewText(['あ'.repeat(5000)])).toHaveLength(3000)
  })
  it('題名の控えは60字まで・題名が無ければ本文の先頭', () => {
    expect(titleSnapshot('あ'.repeat(100))).toHaveLength(60)
    expect(titleSnapshot(null, '本文の\n先頭です')).toBe('本文の 先頭です')
    expect(titleSnapshot('  ', '')).toBe('')
  })
})

describe('編集で類別し直すか（textChanged）', () => {
  it('同じ（前後の空白だけの違い・null と空文字）なら false', () => {
    expect(textChanged(['題', '本文', null], ['題 ', ' 本文', ''])).toBe(false)
  })
  it('題名か本文が変われば true', () => {
    expect(textChanged(['題', '本文'], ['題2', '本文'])).toBe(true)
    expect(textChanged(['題', '本文'], ['題', '本文を足した'])).toBe(true)
  })
})

describe('1日の上限', () => {
  it('行が無い・壊れているときは既定（有効・200）', () => {
    expect(parseSetting(undefined)).toEqual({ enabled: true, dailyLimit: DEFAULT_DAILY_AI_LIMIT })
    expect(parseSetting('x')).toEqual({ enabled: true, dailyLimit: 200 })
    expect(parseSetting({ daily_ai_limit: 'many' })).toEqual({ enabled: true, dailyLimit: 200 })
  })
  it('設定の値を読む（enabled:false なら無効）', () => {
    expect(parseSetting({ enabled: true, daily_ai_limit: 50 })).toEqual({ enabled: true, dailyLimit: 50 })
    expect(parseSetting({ enabled: false })).toEqual({ enabled: false, dailyLimit: 200 })
  })
  it('上限に達したら止める（以上）', () => {
    expect(limitReached(199, 200)).toBe(false)
    expect(limitReached(200, 200)).toBe(true)
    expect(limitReached(0, 0)).toBe(true)
  })
})

describe('classifyContent（AI のクライアントは差し替え）', () => {
  const fake = (text: string) => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 120, output_tokens: 30 } }))
    return { client: { messages: { create } } as unknown as Anthropic, create }
  }
  it('答えを整えて返し、10秒の時間切れ・再試行なしで呼ぶ', async () => {
    const { client, create } = fake(JSON.stringify({ categories: ['fraud', 'nope'], confidence: 'high', reason: '投資の勧誘' }))
    const r = await classifyContent(client, '本文')
    expect(r.result).toEqual({ categories: ['fraud'], confidence: 'high', reason: '投資の勧誘' })
    expect(r.usage).toEqual({ input: 120, output: 30 })
    const [params, opts] = create.mock.calls[0] as unknown as [Record<string, unknown>, { timeout: number; maxRetries: number }]
    expect(params.model).toBe('claude-haiku-4-5')
    expect(opts).toEqual({ timeout: 10_000, maxRetries: 0 })
  })
  it('構造化出力のスキーマに maxItems・anyOf・型の配列を使わない（400 になるため）', async () => {
    const { client, create } = fake(JSON.stringify({ categories: [], confidence: 'low', reason: '' }))
    await classifyContent(client, '本文')
    const schema = JSON.stringify((create.mock.calls[0] as unknown as [{ output_config: unknown }])[0].output_config)
    expect(schema).not.toMatch(/maxItems|anyOf|oneOf|"type":\[/)
  })
  it('JSON が壊れていたら例外（呼び出し側が error として残す）', async () => {
    const { client } = fake('not json')
    await expect(classifyContent(client, '本文')).rejects.toThrow()
  })
  it('指示文に「誤って止めない」例が入っている', () => {
    for (const w of ['議会報告会', '選挙の仕組み', '寺・神社', '教会のコンサート', 'お店の通常の宣伝', '有料の講座']) {
      expect(CLASSIFY_SYSTEM_PROMPT).toContain(w)
    }
    expect(CLASSIFY_SYSTEM_PROMPT).toContain('迷うときは')
  })
})

describe('リンク・文面', () => {
  it('元の投稿へのリンク（コメントは親の投稿へ）', () => {
    expect(targetPath('event', 'e1')).toBe('/events/e1')
    expect(targetPath('freefree_comment', 'c1', 'p1')).toBe('/freefree/p1')
    expect(targetPath('proposal_comment', 'c1', 'q1')).toBe('/proposals/q1')
    expect(targetPath('org', 'o1')).toBe('/orgs/o1')
    expect(categoryLabels(['fraud', 'politics'])).toBe('詐欺・勧誘商法・政治活動')
    expect(categoryLabels([])).toBe('要確認')
  })
  it('運営へのベルの文面：止めた／公開中', () => {
    const held = adminNoticeText({ targetType: 'freefree', title: '副業のご案内', categories: ['fraud'], reason: 'r', held: true })
    expect(held.title).toBe('投稿の審査：詐欺・勧誘商法の疑い（公開を止めました）')
    expect(held.body).toContain('FreeFree掲載「副業のご案内」')
    const open = adminNoticeText({ targetType: 'proposal_comment', title: 'x', categories: ['abuse'], reason: '', held: false })
    expect(open.title).toBe('投稿の審査：誹謗中傷・差別の疑い（公開中です）')
    expect(open.body).toContain('重い区分の疑い') // 重い区分なのに止められなかったコメントは、早めの確認を促す
    const light = adminNoticeText({ targetType: 'event', title: 'x', categories: ['politics'], reason: '', held: false })
    expect(light.body).not.toContain('重い区分')
  })
  it('運営へのメール：件名は止めた／公開中で変わり、名前を含めない', () => {
    const m1 = adminMailText({ targetType: 'event', title: '題', categories: ['antisocial'], reason: '闇バイト', held: true }, 'https://x/admin/review')
    expect(m1.subject).toBe('【CiDAO】投稿の公開を止めました（審査をお願いします）')
    for (const w of ['種類：催し', '題名：題', '区分：反社会的な行為', '理由：闇バイト', 'いまの状態：公開を止めた', 'https://x/admin/review']) {
      expect(m1.text).toContain(w)
    }
    const m2 = adminMailText({ targetType: 'event', title: '題', categories: ['religion'], reason: '', held: false }, 'https://x/admin/review')
    expect(m2.subject).toBe('【CiDAO】投稿の確認をお願いします（公開中）')
    expect(m2.text).toContain('いまの状態：公開中')
  })
})

describe('毎朝のまとめ（summarizeOpen / summaryText）', () => {
  const now = new Date('2026-11-22T00:00:00Z')
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString()
  it('notify・hold・error を数え、止めているものと24時間以上のものを分ける', () => {
    const s = summarizeOpen([
      { verdict: 'hold', held: true, created_at: hoursAgo(30) },
      { verdict: 'hold', held: true, created_at: hoursAgo(2) },
      { verdict: 'notify', held: false, created_at: hoursAgo(50) },
      { verdict: 'error', held: false, created_at: hoursAgo(1) },
      { verdict: 'ok', held: false, created_at: hoursAgo(1) },
    ], now)
    expect(s).toEqual({ total: 4, held: 2, staleHeld: 1 })
  })
  it('0件なら文面を作らない（何も出さない）', () => {
    expect(summaryText({ total: 0, held: 0, staleHeld: 0 }, 'u')).toBeNull()
  })
  it('文面：件数と止めている数・24時間以上止まっている数', () => {
    const t = summaryText({ total: 5, held: 3, staleHeld: 2 }, 'https://x/admin/review')!
    expect(t.title).toBe('投稿の審査待ちが 5 件あります（うち公開を止めているもの 3 件）')
    expect(t.body).toContain('24時間以上止まっている投稿が 2 件あります（投稿者が待っています）')
    expect(t.subject).toBe('【CiDAO】投稿の審査待ちが 5 件あります（うち公開を止めているもの 3 件）')
    expect(t.mail).toContain('https://x/admin/review')
    const none = summaryText({ total: 1, held: 0, staleHeld: 0 }, 'u')!
    expect(none.body).not.toContain('24時間')
  })
})
