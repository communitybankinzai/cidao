// Step 11d: メール通知エンドポイント（Resend）
// Usage: POST /api/notify/email { to, subject, body, replyTo? }
// body は plain text を想定。HTML が必要になったら html フィールドを追加する。
//
// env:
//   RESEND_API_KEY  必須
//   MAIL_FROM       送信元（例: 'CiDAO <noreply@cidao.example.jp>'）

import { NextResponse } from 'next/server'
import { Resend } from 'resend'

export async function POST(request: Request) {
  const { to, subject, body, replyTo } = await request.json()
  if (!to || !subject || !body) {
    return NextResponse.json({ error: 'to, subject, body required' }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!apiKey || !from) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY or MAIL_FROM not configured' },
      { status: 503 },
    )
  }

  const resend = new Resend(apiKey)

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    text: body,
    ...(replyTo ? { replyTo } : {}),
  })

  if (error) {
    return NextResponse.json(
      { error: error.message ?? 'resend send failed', method: 'resend' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    accepted: true,
    method: 'resend',
    message_id: data?.id,
  })
}
