// 食レポの SNS 巡回の実行（2026-11-13 事業主決定 A案）。毎朝の Instagram の同期（#印西・監視アカウント）から呼ばれる。
// 取得済みの投稿を受け取り、AI で読んで「候補」（gourmet_candidates）にためる。公開は運営の承認（/admin/gourmet）の後だけ。
//   - スイッチ app_settings.gourmet_crawl.enabled が false なら何もしない（既定 false）
//   - 1日の AI 呼び出しは daily_ai_limit まで（日本時間の0時で数え直す）。1回の実行では PER_RUN 件まで
//   - 同じ投稿は二度読まない（post_id で判定。食レポでなかった投稿も status=skipped で印を残す）
//   - 本文は保存しない（caption_hash だけ）。写真は読まない
//   - 新しい候補ができた日は、運営に1日1回だけまとめて知らせる（ベル・Webプッシュ・メール）

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropicClient, needsWorkspaceHeader } from '@/lib/disaster-sns-road-ai'
import { estimateCost, unavailableCost } from '@/lib/ai/pricing'
import { recordApiUsage } from '@/lib/talent-bank/usage'
import { insertNotification } from '@/lib/notify'
import { normalizeMailFrom } from '@/lib/mail'
import { GOURMET_MAP_URL } from '@/lib/cbi-site-urls'
import type { IgMedia } from '@/lib/instagram-events/hashtag'
import type { GourmetHookSummary } from '@/lib/instagram-events/sync'
import {
  DEFAULT_DAILY_AI_LIMIT, GOURMET_CRAWL_MODEL, GOURMET_CRAWL_PURPOSE, GOURMET_CRAWL_SETTING,
  buildCandidateShops, captionHash, extractGourmet, shopEntriesFrom, type ShopEntry,
} from '@/lib/gourmet-crawl'

const PER_RUN = 12
const SITE_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'

type Setting = { enabled?: boolean; daily_ai_limit?: number; last_notified_on?: string }

function jstDate(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

async function readSetting(db: SupabaseClient): Promise<Setting> {
  const { data } = await db.from('app_settings').select('value').eq('key', GOURMET_CRAWL_SETTING).maybeSingle()
  return ((data?.value as Setting | null) ?? {}) as Setting
}

async function usedToday(db: SupabaseClient): Promise<number> {
  const since = new Date(`${jstDate()}T00:00:00+09:00`).toISOString()
  const { count } = await db.from('api_usage').select('id', { count: 'exact', head: true }).eq('purpose', GOURMET_CRAWL_PURPOSE).gte('created_at', since)
  return count ?? 0
}

async function loadShops(db: SupabaseClient): Promise<ShopEntry[]> {
  const res = await fetch(`${GOURMET_MAP_URL}osm-shops.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`osm-shops ${res.status}`)
  const osm = ((await res.json()) as { shops: Parameters<typeof shopEntriesFrom>[0] }).shops
  const { data } = await db.from('gourmet_shops').select('id, name, address, lat, lon').eq('hidden', false).limit(5000)
  return shopEntriesFrom(osm, (data ?? []) as Parameters<typeof shopEntriesFrom>[1])
}

export async function runGourmetCrawl(
  db: SupabaseClient,
  posts: IgMedia[],
  source: 'instagram-hashtag' | 'instagram-account',
  opts: { dryRun?: boolean; botMemberId: string },
): Promise<GourmetHookSummary> {
  const setting = await readSetting(db)
  if (setting.enabled !== true) return { enabled: false, read: 0, created: 0, skipped: 0, costJpy: 0, note: 'スイッチが切れている' }
  const limit = Number.isFinite(setting.daily_ai_limit) ? Number(setting.daily_ai_limit) : DEFAULT_DAILY_AI_LIMIT
  const remaining = Math.max(0, limit - (await usedToday(db)))
  if (remaining === 0) return { enabled: true, read: 0, created: 0, skipped: 0, costJpy: 0, note: `1日の上限（${limit} 回）に達した` }

  // 二度読まない
  const ids = [...new Set(posts.map((p) => p.id))]
  const known = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('gourmet_candidates').select('post_id').in('post_id', ids.slice(i, i + 200))
    for (const r of data ?? []) known.add(String(r.post_id))
  }
  const fresh = posts
    .filter((p, i, a) => !known.has(p.id) && (p.caption ?? '').trim() && a.findIndex((x) => x.id === p.id) === i)
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, Math.min(PER_RUN, remaining))
  if (fresh.length === 0) return { enabled: true, read: 0, created: 0, skipped: 0, costJpy: 0 }

  const shops = await loadShops(db)
  let client = anthropicClient()
  let read = 0, created = 0, skipped = 0, costJpy = 0
  for (const m of fresh) {
    let r: Awaited<ReturnType<typeof extractGourmet>>
    try {
      try { r = await extractGourmet(client, m.caption) } catch (e) {
        if (!needsWorkspaceHeader(e)) throw e
        client = anthropicClient(true)
        r = await extractGourmet(client, m.caption)
      }
    } catch (e) {
      console.warn('[gourmet-crawl] 読み取り失敗', m.permalink, e instanceof Error ? e.message.slice(0, 120) : '')
      continue
    }
    read++
    const usage = { input_tokens: r.usage.input, output_tokens: r.usage.output, cache_creation_tokens: 0, cache_read_tokens: 0 }
    const cost = await estimateCost({ model: GOURMET_CRAWL_MODEL, usage }).catch(() => unavailableCost())
    costJpy += Number(cost.est_cost_jpy ?? 0)
    // 候補に残すのは「地図のお店と照合できた（ok）」「地図にないお店（unmatched）」だけ。批判的・範囲外は外す
    const keep = buildCandidateShops(r.extraction, shops).filter((s) => s.status === 'ok' || s.status === 'unmatched')
    const row = {
      source, platform: 'instagram', post_id: m.id, post_url: m.permalink,
      author_handle: source === 'instagram-account' ? m.account?.username ?? null : null,
      posted_at: m.timestamp ? new Date(m.timestamp.replace(/(\d{2})(\d{2})$/, '$1:$2')).toISOString() : null,
      caption_hash: captionHash(m.caption),
      shops: keep.map((s) => ({ ...s, decision: null, report_id: null })),
      more_shops: r.extraction.more_than_10 === true,
      hold_reason: source === 'instagram-account' ? (m.account?.gourmetHold ?? '') : '',
      status: keep.length ? 'pending' : 'skipped',
      model: GOURMET_CRAWL_MODEL, input_tokens: r.usage.input, output_tokens: r.usage.output, est_cost_jpy: cost.est_cost_jpy ?? null,
    }
    if (keep.length) created++; else skipped++
    if (opts.dryRun) continue
    await recordApiUsage({
      run_id: randomUUID(), case_id: null, subject_id: null, member_id: opts.botMemberId,
      provider: 'anthropic', model: GOURMET_CRAWL_MODEL, purpose: GOURMET_CRAWL_PURPOSE,
      input_tokens: r.usage.input, output_tokens: r.usage.output, cache_creation_tokens: 0, cache_read_tokens: 0, ...cost, error: null,
    })
    const { error } = await db.from('gourmet_candidates').insert(row)
    if (error && error.code !== '23505') console.warn('[gourmet-crawl] 候補を保存できない', error.message)
  }
  if (created > 0 && !opts.dryRun) await notifyDaily(db, setting)
  return { enabled: true, read, created, skipped, costJpy }
}

// 新しい候補ができた日に1回だけ、運営に知らせる（同じ日の2回目以降は知らせない）
async function notifyDaily(db: SupabaseClient, setting: Setting) {
  const today = jstDate()
  if (setting.last_notified_on === today) return
  await db.from('app_settings').update({ value: { ...setting, last_notified_on: today } }).eq('key', GOURMET_CRAWL_SETTING)
  const { count } = await db.from('gourmet_candidates').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  const title = `食レポの候補が ${count ?? 0} 件あります（SNS 巡回）`
  const body = 'SNS 巡回で見つけた食レポの候補です。管理画面で、お店ごとに確認・承認すると地図に出ます（承認するまで公開されません）'
  try {
    const { data: admins } = await db.from('members').select('id').not('admin_role', 'is', null).is('deleted_at', null)
    for (const a of admins ?? []) await insertNotification({ recipientId: a.id as string, kind: 'system', title, body, linkUrl: '/admin/gourmet' })
  } catch (e) { console.error('[gourmet-crawl] ベル通知に失敗', e instanceof Error ? e.message : e) }
  try {
    const apiKey = process.env.RESEND_API_KEY ?? ''
    const from = process.env.MAIL_FROM ?? ''
    const to = process.env.ADMIN_NOTIFY_EMAIL ?? ''
    if (!apiKey || !from || !to) return
    const { Resend } = await import('resend')
    await new Resend(apiKey).emails.send({
      from: normalizeMailFrom(from), to, subject: `【食レポマップ】${title}`,
      text: `${body}。\n\n${SITE_BASE}/admin/gourmet`,
    })
  } catch (e) { console.error('[gourmet-crawl] メールに失敗', e instanceof Error ? e.message : e) }
}
