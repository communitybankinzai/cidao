// Step 11b スタブ: メール通知エンドポイント
// 実装時に Resend API に接続
//
// Usage: POST /api/notify/email { to, subject, body }
// 暫定: コンソールにログ出力のみ。Edge Functions / Resend に差替え予定（Step 11d）。

import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { to, subject, body } = await request.json()
  if (!to || !subject || !body) {
    return NextResponse.json({ error: 'to, subject, body required' }, { status: 400 })
  }

  // Phase 0: ログ出力のみ（Resend 接続前）
  console.log('[notify/email][stub]', { to, subject, body_length: body.length })

  return NextResponse.json({
    accepted: false,
    method: 'stub',
    note: 'Resend API キー取得後に実送信に切替予定 (Step 11d)',
  })
}
