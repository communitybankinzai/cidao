// 市「災害時の公共交通のご案内」が書き換わったら、運営へメールで知らせる。
//
// 地図の運休区間を「増やす」のは人の手で行っている（誤った区間を自動で赤くしないため）。
// ところが 2026-09-21 の台風25号では、市のページが 12:00 → 18:00 と更新されても
// 事業主に指摘されるまで地図が古いままだった。ページの変化そのものは巡回で検知できているので、
// 変化した瞬間に「市の最新の文面」と「地図がいま出している内容」の食い違いを添えて知らせる。
//
// 判定（compareCityTransit）は純粋関数でテストあり。送信は失敗しても巡回を止めない。

import type { SupabaseClient } from '@supabase/supabase-js'
import { isCitySourced, type BusEntry, type RailEntry, type RailStatus } from '@/lib/disaster-rail-status'

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
  for (const entry of (status.railways ?? []).filter(isCitySourced)) {
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

// ---------------------------------------------------------------------------
// 市の文面を読み取って、地図に入れる形にする（2026-09-21 A案）
//   路線バス：地図には文字で出すだけなので、読み取れたらその場で自動反映する
//   鉄道　　：線を赤く塗るため、人が承認リンクを押したときだけ反映する
// ---------------------------------------------------------------------------

/** 地図の路線データ（site/inzai-disaster-map/rail-segments.json）にある駅。ここに無い駅名は採用しない */
const LINE_STATIONS: Record<string, string[]> = {
  'jr-narita-abiko': ['我孫子', '東我孫子', '湖北', '新木', '布佐', '木下', '小林', '安食', '下総松崎', '成田'],
  hokuso: ['京成高砂', '新柴又', '矢切', '北国分', '秋山', '東松戸', '松飛台', '大町', '新鎌ヶ谷', '西白井', '白井', '小室', '千葉ニュータウン中央', '印西牧の原', '印旛日本医大'],
}

export type ParsedTransit = {
  railways: RailEntry[]
  buses: BusEntry[]
  /** 運休らしい記述があるのに、地図に入れられる形で読み取れなかった文 */
  unparsed: string[]
}

function railStateOf(text: string): string | null {
  if (/再開|平常/.test(text) && !/見合わせ|運休/.test(text)) return null
  if (/見合わせ|運転を取りやめ/.test(text)) return 'suspended'
  const stop = /運休/.test(text)
  const late = /遅れ|送れ|遅延/.test(text) // 市の文面に「送れ」の誤字があった（2026-09-21）
  if (stop && late) return 'disrupted'
  if (stop) return 'suspended'
  if (late) return 'delayed'
  return null
}

/** 市の「災害時の公共交通のご案内」の本文から、地図に入れる鉄道・路線バスを読み取る */
export function parseCityTransit(pageText: string, announcedAt: string): ParsedTransit {
  const out: ParsedTransit = { railways: [], buses: [], unparsed: [] }
  const flat = pageText.replace(/\s+/g, ' ')

  // 路線バス：「・六合路線（小林駅～…）【注意】区間運休」
  for (const raw of pageText.split(/\n|(?=・)/)) {
    const line = raw.trim()
    const m = line.match(/^・\s*([^\s（(【】〜～]{2,10}?(?:線|路線))\s*([（(][^）)]*[）)])?\s*(.*)$/)
    if (!m) continue
    // 駅名の並び（「木下駅から成田駅」等）は路線名ではない
    if (/駅|から|間/.test(m[1])) continue
    const rest = m[3] ?? ''
    const detail = /区間運休/.test(rest) ? '区間運休です。' : /全線/.test(m[2] ?? '') ? '全線で運休しています。' : '運休しています。'
    out.buses.push({ name: `路線バス ${m[1]}${m[2] ?? ''}`, state: 'suspended', detail, announcedAt })
  }

  // 鉄道：文ごとに路線名・区間・状態を読む
  for (const sentence of flat.split(/。/)) {
    const rail = RAIL_LINES.find((r) => r.pattern.test(sentence))
    if (!rail) continue
    const state = railStateOf(sentence)
    if (!state) continue
    const stations = rail.lineId ? LINE_STATIONS[rail.lineId] ?? [] : []
    // 「〇〇駅～〇〇駅間」の前後を、地図の駅名一覧と突き合わせて決める。
    // 正規表現で名前を切り出すと「線路冠水のため新鎌ヶ谷」のように前の語まで取り込むため。
    // 区切りに「ー」は使わない（千葉ニュータウン中央 の中にあるため）
    const pair = sentence.match(/(.*?)\s*(?:[～〜~－]|から)\s*(.*?)間/)
    const longest = (list: string[]) => list.sort((a, b) => b.length - a.length)[0]
    const before = (pair?.[1] ?? '').replace(/駅$/, '')
    const after = pair?.[2] ?? ''
    const from = longest(stations.filter((st) => before.endsWith(st)))
    const to = longest(stations.filter((st) => after.startsWith(st)))
    if (!rail.lineId || !from || !to) {
      out.unparsed.push(`${sentence.trim()}。`)
      continue
    }
    out.railways.push({ line: rail.lineId, from, to, state, detail: `${sentence.trim()}。`, announcedAt })
  }
  return out
}

function sameRailways(a: RailEntry[], b: RailEntry[]) {
  const key = (r: RailEntry) => `${r.line}:${[r.from, r.to].sort().join('-')}:${r.state}`
  const ka = a.map(key).sort().join('|')
  const kb = b.map(key).sort().join('|')
  return ka === kb
}

function railLabel(r: RailEntry) {
  const state = { suspended: '運休・見合わせ', disrupted: '遅れ・運休', delayed: '遅れ', restored: '再開' }[String(r.state)] ?? String(r.state)
  return `${r.from}〜${r.to}（${state}）`
}

/**
 * 市の公共交通の案内が書き換わったときに呼ぶ（巡回から）。
 * 路線バスは自動で反映し、鉄道は今の地図と違えば承認リンクを作ってメールする。例外は投げない。
 */
export async function handleCityTransitChange(
  supabase: SupabaseClient,
  item: { title: string; body: string; url: string | null; occurredAt: string },
): Promise<string> {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
    const status = (data?.value ?? {}) as RailStatus
    const parsed = parseCityTransit(item.body, item.occurredAt)

    // 1) 路線バス：自動で反映する。ただし「路線バス」「運休」と書いてあるのに1件も読めないときは、
    //    読み取りの失敗とみなして今の登録を消さない
    const mentionsBus = /路線バス/.test(item.body) && /運休/.test(item.body)
    let busesApplied = false
    if (parsed.buses.length || !mentionsBus) {
      const before = (status.buses ?? []).map((b) => b.name).sort().join('|')
      const after = parsed.buses.map((b) => b.name).sort().join('|')
      // 路線が同じでも、発表時刻（地図の「〇時 市発表」）を新しくするため毎回書き込む
      const next: RailStatus = { ...status, buses: parsed.buses, updatedAt: item.occurredAt, checkedAt: new Date().toISOString() }
      await supabase.from('app_settings').upsert({ key: SETTINGS_KEY, value: next })
      busesApplied = before !== after
    } else {
      parsed.unparsed.push('（路線バスの運休が書かれていますが、路線名を読み取れませんでした）')
    }

    // 2) 鉄道：読み取れた区間はその場で反映する（2026-09-23 事業主判断＝A案）。
    // 以前は承認リンクを押すまで反映しなかったが、夜間や不在のあいだ地図が古いままになった。
    // 区間は地図の路線データの駅名と照合してから塗るので、誤った区間を塗る危険は小さい。
    // 読み取れなかった文があるときは、市がまだ何か書いていると考えて今の登録を消さない。
    const railUnreadable = parsed.unparsed.some((s) => RAIL_LINES.some((r) => r.pattern.test(s)))
    const cityRails = (status.railways ?? []).filter(isCitySourced)
    const railChanged = !railUnreadable && !sameRailways(cityRails, parsed.railways)
    if (railChanged) {
      const kept = (status.railways ?? []).filter((r) => !isCitySourced(r))
      const next: RailStatus = {
        ...status,
        railways: [...parsed.railways, ...kept],
        buses: parsed.buses.length || !mentionsBus ? parsed.buses : status.buses,
        updatedAt: item.occurredAt,
        checkedAt: new Date().toISOString(),
      }
      await supabase.from('app_settings').upsert({ key: SETTINGS_KEY, value: next })
    }

    return await sendTransitMail({ item, status, parsed, busesApplied, railChanged, railUnreadable })
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function sendTransitMail(args: {
  item: { body: string; url: string | null }
  status: RailStatus
  parsed: ParsedTransit
  busesApplied: boolean
  railChanged: boolean
  railUnreadable: boolean
}): Promise<string> {
  const { item, status, parsed, busesApplied, railChanged, railUnreadable } = args
  const apiKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.MAIL_FROM ?? ''
  const to = process.env.DISASTER_NOTIFY_TO ?? process.env.COST_ALERT_TO ?? ''
  if (!apiKey || !from || !to) return 'skipped: RESEND_API_KEY / MAIL_FROM / 通知先 が未設定'

  // 人の手が要るのは「読み取れなかった文があるとき」だけ。反映そのものは自動で終わっている
  const needsHuman = parsed.unparsed.length > 0
  const lines: string[] = []

  if (railChanged) {
    const before = (status.railways ?? []).filter(isCitySourced).map(railLabel)
    const after = parsed.railways.map(railLabel)
    lines.push(
      '<b>🚃 鉄道の運休を市の発表に合わせて自動で反映しました</b><br>' +
      `前：${before.length ? before.map(escapeHtml).join('、') : '（なし）'}<br>` +
      `後：${after.length ? after.map(escapeHtml).join('、') : '（なし＝地図から外しました）'}`,
    )
  }
  if (railUnreadable) {
    lines.push('<b>⚠ 鉄道の文を読み取れなかったため、地図の鉄道は変えていません。</b>下の文面を見て、必要なら Claude Code に伝えてください。')
  }
  if (parsed.unparsed.length) {
    lines.push(`<b>⚠ 読み取れなかった記述（地図には入れていません。必要なら Claude Code に伝えてください）</b><br>${parsed.unparsed.map(escapeHtml).join('<br>')}`)
  }
  if (busesApplied) {
    lines.push(`<b>🚌 路線バスは自動で反映しました</b><br>${parsed.buses.length ? parsed.buses.map((b) => escapeHtml(String(b.name))).join('<br>') : '（運休の路線はなくなりました）'}`)
  }
  if (!needsHuman && !busesApplied) lines.push('地図の内容は市の発表と一致しています。対応は不要です。')

  lines.push(`<b>市の最新の文面</b><br>${escapeHtml(item.body).replace(/\n/g, '<br>')}`)
  lines.push(
    `市のページ：<a href="${escapeHtml(item.url ?? '')}">${escapeHtml(item.url ?? '')}</a><br>` +
    `防災MAP：<a href="${MAP_URL}">${MAP_URL}</a>`,
  )

  // CBI公式メールの自動仕分け（gas-mail-share/MailTriage.gs の RE_ACTION）は「警告」を含む件名を
  // 「要対応＋★」にする。GAS はCBI公式アカウントの持ち物で手元から書き換えられないため、件名側で合わせる
  const subject = needsHuman
    ? '【要対応・更新漏れ警告】防災MAP：市の発表を読み取れなかった文があります'
    : railChanged || busesApplied
      ? '防災MAP：運行情報を市の発表に合わせて自動更新しました'
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
}

// ---------------------------------------------------------------------------
// 取り込みが止まっていないかの見張り（2026-09-23 A案）
// ---------------------------------------------------------------------------
// 2026-09-22 に市の案内ページが 404 になり、取り込みが失敗し続けたのに誰も気づかず、
// 地図に古い内容が残った。取れない状態が続いたらメールで知らせる。

const WATCHDOG_HOURS = 6
const WATCHDOG_STATE_KEY = 'disaster_rail_watchdog'

/** 市の案内が長く取れていないときに知らせる。巡回のたびに呼ぶ。例外は投げない。 */
export async function checkCityPageHealth(
  supabase: SupabaseClient,
  source: { label: string; url: string },
  ok: boolean,
  errorMessage?: string,
): Promise<string> {
  try {
    const now = Date.now()
    const { data } = await supabase.from('app_settings').select('value').eq('key', WATCHDOG_STATE_KEY).maybeSingle()
    const state = (data?.value ?? {}) as { lastOkAt?: string; notifiedAt?: string }

    if (ok) {
      if (!state.lastOkAt || Date.parse(state.lastOkAt) < now) {
        await supabase.from('app_settings').upsert({
          key: WATCHDOG_STATE_KEY,
          value: { lastOkAt: new Date(now).toISOString() },
        })
      }
      return 'ok'
    }

    const lastOk = state.lastOkAt ? Date.parse(state.lastOkAt) : NaN
    const downMs = Number.isFinite(lastOk) ? now - lastOk : Infinity
    if (downMs < WATCHDOG_HOURS * 3600 * 1000) return 'failing (まだ通知しない)'
    // 同じ障害で何度も送らない（1日1通まで）
    const notified = state.notifiedAt ? Date.parse(state.notifiedAt) : 0
    if (now - notified < 24 * 3600 * 1000) return 'failing (通知済み)'

    const sent = await sendPlainMail(
      '【要対応・更新漏れ警告】防災MAP：市の公共交通の案内が取り込めていません',
      [
        `<b>${escapeHtml(source.label)} を ${Math.floor(downMs / 3600000)} 時間取り込めていません。</b>`,
        `ページが消えた・場所が変わった可能性があります。地図の運休は古いまま残ります。`,
        `直前のエラー：${escapeHtml(errorMessage ?? '（不明）')}`,
        `市のページ：<a href="${escapeHtml(source.url)}">${escapeHtml(source.url)}</a>`,
        `対応：ページの場所が変わっていれば、Claude Code に「運行情報の情報源のURLを直して」と伝えてください。`,
      ],
    )
    await supabase.from('app_settings').upsert({
      key: WATCHDOG_STATE_KEY,
      value: { ...state, notifiedAt: new Date(now).toISOString() },
    })
    return `notified: ${sent}`
  } catch (error) {
    return `watchdog failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function sendPlainMail(subject: string, lines: string[]): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.MAIL_FROM ?? ''
  const to = process.env.DISASTER_NOTIFY_TO ?? process.env.COST_ALERT_TO ?? ''
  if (!apiKey || !from || !to) return 'skipped: 送信設定なし'
  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: from.includes('<') ? from : `CBI <${from}>`,
    to,
    subject,
    html: `<p>${lines.join('</p><p>')}</p>`,
  })
  return error ? `send failed: ${error.message}` : 'sent'
}
