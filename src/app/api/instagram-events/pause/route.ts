// GET/POST /api/instagram-events/pause?token=<署名>
//
// 朝の結果報告メールの「一時停止」ボタンの行き先。ログイン無しで押せるよう、CRON_SECRET から導いた署名トークンで守る。
// GET は確認ページ（現在の状態と「停止する／再開する」ボタン）を出すだけで、状態は POST でしか変えない
// （メールのリンクを機械的に開く保護ソフトが誤って止めないように）。
// 状態は app_settings（key=instagram_events_sync）。cron（/api/cron/instagram-events-sync）は実行前にこれを見る。

import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { describePauseState, readPauseState, verifyPauseToken, writePauseState, type PauseState } from '@/lib/instagram-events/pause'

export const dynamic = 'force-dynamic'

const SITE_BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app').replace(/\/$/, '')

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function html(body: string, status = 200): NextResponse {
  const doc =
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Instagram #印西 取り込みの一時停止</title>' +
    '<style>body{font-family:-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;color:#222;margin:0;padding:24px;background:#f8fafc}' +
    '.card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px}' +
    'h1{font-size:18px;margin:0 0 10px}p{line-height:1.6}.state{padding:10px 12px;border-radius:8px;background:#f1f5f9;font-size:14px}' +
    '.msg{padding:10px 12px;border-radius:8px;background:#ecfdf5;color:#065f46;font-size:14px}' +
    'button{font-size:16px;padding:12px 20px;border:0;border-radius:8px;color:#fff;cursor:pointer;width:100%}' +
    '.pause{background:#b45309}.resume{background:#047857}small{color:#64748b}a{color:#1d4ed8}</style></head><body>' +
    `<div class="card">${body}</div></body></html>`
  return new NextResponse(doc, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

function pageFor(state: PauseState, token: string, message: string | null): NextResponse {
  const next = state.paused ? 'resume' : 'pause'
  const label = state.paused ? '▶ 自動取り込みを再開する' : '⏸ 自動取り込みを停止する'
  const note = state.paused
    ? '再開すると、次の朝 06:35 から取り込みを行います。'
    : '停止すると、次の朝から取り込みを行わず、費用も発生しません。候補として登録済みのものはそのまま残ります。'
  return html(
    '<h1>Instagram #印西 取り込みの一時停止</h1>' +
      (message ? `<p class="msg">${esc(message)}</p>` : '') +
      `<p class="state">現在：${esc(describePauseState(state))}</p>` +
      `<p>${note}</p>` +
      `<form method="post"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="${next}">` +
      `<button type="submit" class="${next}">${label}</button></form>` +
      `<p><small>このページは結果報告メールのボタンから開きます。管理画面「<a href="${SITE_BASE}/admin/events/import">イベント一括取り込み</a>」からも同じ操作ができます。</small></p>`,
  )
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function invalid(): NextResponse {
  return html('<h1>リンクが無効です</h1><p>このリンクは古いか、正しくありません。最新の結果報告メールのボタンから開き直してください。</p>', 403)
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!verifyPauseToken(process.env.CRON_SECRET ?? '', token)) return invalid()
  const supabase = serviceClient()
  if (!supabase) return html('<h1>設定エラー</h1><p>サーバーの設定が不足しています。</p>', 503)
  try {
    return pageFor(await readPauseState(supabase), token, null)
  } catch (e) {
    return html(`<h1>読み込みに失敗しました</h1><p>${esc(e instanceof Error ? e.message : String(e))}</p>`, 500)
  }
}

export async function POST(request: Request) {
  let token = ''
  let action = ''
  try {
    const form = await request.formData()
    token = String(form.get('token') ?? '')
    action = String(form.get('action') ?? '')
  } catch {
    return invalid()
  }
  if (!verifyPauseToken(process.env.CRON_SECRET ?? '', token)) return invalid()
  if (action !== 'pause' && action !== 'resume') return invalid()
  const supabase = serviceClient()
  if (!supabase) return html('<h1>設定エラー</h1><p>サーバーの設定が不足しています。</p>', 503)
  try {
    const state = await writePauseState(supabase, action === 'pause', 'email')
    console.log(`[instagram-events-pause] ${action} via email`)
    return pageFor(state, token, action === 'pause' ? '一時停止しました。次の朝から取り込みを行いません。' : '再開しました。次の朝 06:35 から取り込みを行います。')
  } catch (e) {
    return html(`<h1>変更に失敗しました</h1><p>${esc(e instanceof Error ? e.message : String(e))}</p>`, 500)
  }
}
