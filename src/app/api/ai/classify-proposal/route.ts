// Step 11b スタブ: AI 提案カテゴリ分類
// 実装時に LLM API（OpenAI / Claude）に置換える
// 入力 title + body → PROPOSAL_CATEGORIES のいずれか
//
// TODO: credentials.md §3 で API キー取得後に実装。
// 一時的に "other" を返すか、key-based heuristic を仕込む。

import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { title, body } = await request.json()
  if (typeof title !== 'string' || typeof body !== 'string') {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 })
  }

  // 暫定: キーワードベースの簡易分類（AI実装後に差替え）
  const text = `${title} ${body}`.toLowerCase()
  let category = 'other'
  if (/教育|子ども|学校|塾|不登校/.test(text)) category = 'kodomo'
  else if (/福祉|医療|健康|介護/.test(text)) category = 'fukushi'
  else if (/環境|自然|里山|清掃|エコ/.test(text)) category = 'kankyo'
  else if (/防災|防犯|災害|避難/.test(text)) category = 'bosai'
  else if (/文化|芸術|スポーツ|音楽/.test(text)) category = 'bunka'
  else if (/まちづくり|地域|商店街|駅前/.test(text)) category = 'machizukuri'
  else if (/起業|経済|産業|しごと/.test(text)) category = 'sangyo'
  else if (/市政|行政|議会/.test(text)) category = 'gyosei'
  else if (/多文化|人権|共生/.test(text)) category = 'tabunka'

  return NextResponse.json({
    category,
    confidence: 0.5,
    method: 'keyword_heuristic',
    note: 'AI API キー取得後に LLM 分類に置換予定 (Step 11c)',
  })
}
