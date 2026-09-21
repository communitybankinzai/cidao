// 市「災害時の公共交通のご案内」が書き換わったら、運営へメールで知らせる。
//
// 地図の運休区間を「増やす」のは人の手で行っている（誤った区間を自動で赤くしないため）。
// ところが 2026-09-21 の台風25号では、市のページが 12:00 → 18:00 と更新されても
// 事業主に指摘されるまで地図が古いままだった。ページの変化そのものは巡回で検知できているので、
// 変化した瞬間に「市の最新の文面」と「地図がいま出している内容」の食い違いを添えて知らせる。
//
// 判定（compareCityTransit）は純粋関数でテストあり。送信は失敗しても巡回を止めない。

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RailStatus } from '@/lib/disaster-rail-status'

const SETTINGS_KEY = 'disaster_rail_status'
const MAP_URL = 'https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/'

/** 市の文面に出てくる鉄道の路線名 → 地図の路線ID（rail-segments.json の lines[].id） */
const RAIL_LINES: Array<{ pattern: RegExp; name: string; lineId: string | null }> = [
  { pattern: /JR\s*成田線|成田線/, name: 'JR成田線', lineId: 'jr-narita-abiko' },
  { pattern: /北総線/, name: '北総線', lineId: 'hokuso' },
  // スカイアクセス線は北総線と同じ線路を走る。地図は北総線の形で塗る
  { pattern: /成田スカイアクセス|スカイアクセス線/, name: '成田スカイアクセス線', lineId: 'hokuso' },
  { pattern: /京成本線|京成線/, name: '京成線', lineId: null },
]

const SUSPENDED_WORDS = /見合わせ|運休|運転を取りやめ/
const DELAY_WORDS = /遅れ|遅延/

export type TransitDiff = {
  /** 市の文面にあるが、地図に登録されていない路線バス */
  missingBuses: string[]
  /** 市の文面に出てくるが、地図に登録されていない鉄道 */
  missingRailways: string[]
  /** 地図では「遅れ」扱いだが、市は「見合わせ・運休」と書いている鉄道 */
  railwayStateChanged: string[]
  /** 地図に出ているが、市の文面から消えた項目（次の読み込みで自動的に外れる） */
  goneFromPage: string[]
}

/** 「・六合路線（小林駅～…）」のような行から路線名を取り出す */
export function busNamesInPage(pageText: string): string[] {
  const names: string[] = []
  for (const raw of pageText.split(/\n|(?=・)/)) {
    const line = raw.trim()
    const m = line.match(/^・\s*([^\s（(【]+?(?:線|路線))\s*[（(]/)
    if (m) names.push(m[1])
  }
  return [...new Set(names)]
}

function busKey(name: string) {
  return name.replace(/^路線バス\s*/, '').split(/[（(]/)[0].trim()
}

export function compareCityTransit(pageText: string, status: RailStatus): TransitDiff {
  const diff: TransitDiff = { missingBuses: [], missingRailways: [], railwayStateChanged: [], goneFromPage: [] }

  // 路線バス
  const registeredBuses = new Set((status.buses ?? []).map((b) => busKey(String(b.name ?? ''))))
  for (const name of busNamesInPage(pageText)) {
    if (!registeredBuses.has(name)) diff.missingBuses.push(name)
  }
  for (const bus of status.buses ?? []) {
    const key = busKey(String(bus.name ?? ''))
    if (key && !pageText.includes(key)) diff.goneFromPage.push(`路線バス ${key}`)
  }

  // 鉄道
  const sentences = pageText.split(/[。\n]/)
  for (const rail of RAIL_LINES) {
    const about = sentences.filter((s) => rail.pattern.test(s))
    if (!about.length) continue
    const text = about.join('。')
    const disrupted = SUSPENDED_WORDS.test(text) || DELAY_WORDS.test(text)
    if (!disrupted) continue
    const entries = (status.railways ?? []).filter((r) => rail.lineId && r.line === rail.lineId)
    if (!entries.length) {
      diff.missingRailways.push(rail.lineId ? rail.name : `${rail.name}（地図に路線データなし）`)
      continue
    }
    if (SUSPENDED_WORDS.test(text) && /見合わせ/.test(text) && entries.every((e) => e.state === 'delayed')) {
      diff.railwayStateChanged.push(`${rail.name}：市は「運転見合わせ」、地図は「遅れ」`)
    }
  }
  for (const entry of status.railways ?? []) {
    const from = String(entry.from ?? '')
    const to = String(entry.to ?? '')
    if (from && to && !(pageText.includes(from) && pageText.includes(to))) {
      diff.goneFromPage.push(`${from}〜${to}`)
    }
  }
  return diff
}

export function hasTransitDiff(diff: TransitDiff) {
  return diff.missingBuses.length + diff.missingRailways.length + diff.railwayStateChanged.length + diff.goneFromPage.length > 0
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** 本文が変わった公共交通ページについて、運営へメールを送る。例外は投げない。 */
export async function notifyCityTransitChange(
  supabase: SupabaseClient,
  item: { title: string; body: string; url: string | null },
): Promise<string> {
  try {
    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''
    const to = process.env.DISASTER_NOTIFY_TO ?? process.env.COST_ALERT_TO ?? ''
    if (!apiKey || !from || !to) return 'skipped: RESEND_API_KEY / MAIL_FROM / 通知先 が未設定'

    const { data } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
    const status = (data?.value ?? {}) as RailStatus
    const diff = compareCityTransit(item.body, status)

    const lines: string[] = []
    if (hasTransitDiff(diff)) {
      lines.push('<b>地図と市の発表に食い違いがあります。地図の更新をお願いします。</b>')
      if (diff.missingRailways.length) lines.push(`🚃 地図にない鉄道：${diff.missingRailways.map(escapeHtml).join('、')}`)
      if (diff.railwayStateChanged.length) lines.push(`🚃 状態が違う：${diff.railwayStateChanged.map(escapeHtml).join('、')}`)
      if (diff.missingBuses.length) lines.push(`🚌 地図にない路線バス：${diff.missingBuses.map(escapeHtml).join('、')}`)
      if (diff.goneFromPage.length) lines.push(`✅ 市の文面から消えた（地図からは自動で外れます）：${diff.goneFromPage.map(escapeHtml).join('、')}`)
    } else {
      lines.push('地図の内容は市の発表と一致しています（念のため文面をご確認ください）。')
    }
    const current = [
      ...(status.railways ?? []).map((r) => `鉄道 ${r.from}〜${r.to}（${r.state}）`),
      ...(status.buses ?? []).map((b) => String(b.name ?? '')),
    ]
    lines.push(`<b>地図がいま出している内容</b><br>${current.length ? current.map(escapeHtml).join('<br>') : '（なし）'}`)
    lines.push(`<b>市の最新の文面</b><br>${escapeHtml(item.body).replace(/\n/g, '<br>')}`)
    lines.push(
      `更新のしかた：Claude Code に「運行情報を市の最新発表に合わせて」と伝えてください。<br>` +
      `市のページ：<a href="${escapeHtml(item.url ?? '')}">${escapeHtml(item.url ?? '')}</a><br>` +
      `防災MAP：<a href="${MAP_URL}">${MAP_URL}</a>`,
    )

    const subject = hasTransitDiff(diff)
      ? '【要対応】防災MAP：市の公共交通の案内が更新されました（地図と食い違いあり）'
      : '防災MAP：市の公共交通の案内が更新されました（地図と一致）'

    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: from.includes('<') ? from : `CBI <${from}>`,
      to,
      subject,
      html: `<p>${lines.join('</p><p>')}</p>`,
    })
    return error ? `send failed: ${error.message}` : 'sent'
  } catch (error) {
    return `send failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
