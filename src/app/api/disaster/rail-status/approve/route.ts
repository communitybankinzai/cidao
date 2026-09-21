// 鉄道の運休を、市の発表どおりに地図へ反映するための承認ページ。
//
// 市の公共交通の案内が書き換わると、巡回（disaster-rail-watch.ts）が読み取った鉄道の運休を
// app_settings の `disaster_rail_approval:<token>` に置き、運営へ承認リンクをメールする。
// GET は内容を見せるだけで何も変えない（メールソフトのリンク事前確認で勝手に反映させないため）。
// 画面のボタン（POST）を押したときだけ、地図の運休（disaster_rail_status）を書き換える。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { RailApproval } from '@/lib/disaster-rail-watch'
import { isCitySourced, type RailEntry, type RailStatus } from '@/lib/disaster-rail-status'

export const dynamic = 'force-dynamic'

const SETTINGS_KEY = 'disaster_rail_status'
const MAP_URL = 'https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/'

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function esc(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

const STATE_LABEL: Record<string, string> = { suspended: '運休・見合わせ', disrupted: '遅れ・運休', delayed: '遅れ', restored: '再開' }
const LINE_LABEL: Record<string, string> = { 'jr-narita-abiko': 'JR成田線（我孫子支線）', hokuso: '北総線' }

function railList(rows: RailEntry[]) {
  if (!rows.length) return '<li>（なし）</li>'
  return rows.map((r) =>
    `<li><b>${esc(LINE_LABEL[String(r.line)] ?? String(r.line))}</b> ${esc(`${r.from}〜${r.to}`)}：${esc(STATE_LABEL[String(r.state)] ?? String(r.state))}` +
    (r.detail ? `<br><small>${esc(String(r.detail))}</small>` : '') + '</li>').join('')
}

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;line-height:1.6;color:#1f2933}` +
    `h1{font-size:20px}ul{padding-left:20px}button{font-size:17px;padding:12px 20px;background:#b91c1c;color:#fff;border:0;border-radius:8px}` +
    `.box{border:1px solid #d0d7de;border-radius:8px;padding:10px 14px;margin:12px 0}small{color:#57606a}</style></head>` +
    `<body><h1>${esc(title)}</h1>${body}</body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

async function load(token: string) {
  const supabase = serviceClient()
  if (!supabase) return { error: 'サーバーの設定が不足しています。' as const }
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return { error: 'リンクが正しくありません。' as const }
  const key = `disaster_rail_approval:${token}`
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  const approval = data?.value as RailApproval | undefined
  if (!approval) return { error: 'この承認リンクは見つかりません。' as const }
  if (approval.status === 'applied') return { error: 'この内容はすでに反映済みです。' as const }
  if (Date.parse(approval.expiresAt) < Date.now()) return { error: '承認リンクの有効期限（12時間）が切れています。新しい発表のメールを待つか、Claude Code に伝えてください。' as const }
  const { data: cur } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  return { supabase, key, approval, status: (cur?.value ?? {}) as RailStatus }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  const r = await load(token)
  if ('error' in r) return page('反映できません', `<p>${esc(r.error ?? '')}</p><p><a href="${MAP_URL}">防災MAPを開く</a></p>`, 400)
  return page('鉄道の運休を地図に反映しますか？',
    `<div class="box"><b>いまの地図</b><ul>${railList(r.status.railways ?? [])}</ul></div>` +
    `<div class="box"><b>市の発表（反映後）</b><ul>${railList(r.approval.railways)}</ul></div>` +
    `<p><small>市の「災害時の公共交通のご案内」から自動で読み取った内容です。区間（駅名）と状態が発表と合っているか確かめてから押してください。</small></p>` +
    `<form method="post"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">この内容で地図に反映する</button></form>`)
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const token = String(form?.get('token') ?? '')
  const r = await load(token)
  if ('error' in r) return page('反映できません', `<p>${esc(r.error ?? '')}</p>`, 400)
  const next: RailStatus = {
    ...r.status,
    // 市の発表の分だけ入れ替え、運営が確認して登録した事業者発表の項目は残す
    railways: [...r.approval.railways, ...(r.status.railways ?? []).filter((x) => !isCitySourced(x))],
    updatedAt: r.approval.announcedAt,
    checkedAt: new Date().toISOString(),
  }
  const { error } = await r.supabase.from('app_settings').upsert({ key: SETTINGS_KEY, value: next })
  if (error) return page('反映できませんでした', `<p>${esc(error.message)}</p>`, 500)
  await r.supabase.from('app_settings').upsert({ key: r.key, value: { ...r.approval, status: 'applied', appliedAt: new Date().toISOString() } })
  return page('反映しました',
    `<p>防災MAPの鉄道の運休を、市の発表どおりに更新しました。地図は開き直すと新しい内容になります。</p>` +
    `<div class="box"><ul>${railList(r.approval.railways)}</ul></div>` +
    `<p><a href="${MAP_URL}">防災MAPを開く</a></p>` +
    `<p><small>対応が済んだら、CBI公式メールのこのメールの★を外してください。</small></p>`)
}
