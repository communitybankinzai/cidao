// CBIサイト側コンテンツ（3Dワールド・防災MAP）の利用状況。
//
// 3Dワールドと防災MAP は CBIサイト（communitybankinzai.github.io）の静的ページで、
// CiDAO の PageViewTracker が載っていないため page_views には1件も入らない。
// 代わりに両ページが叩いている /api/metaverse-presence が metaverse_presence_daily に
// 「その日そのモードを開いたセッション」を記録しているので、それを日別に集計して出す。
//
//   mode = 'disaster-map' … 防災MAP（災害状況整合MAP）
//   mode = それ以外        … 3Dワールド（メタバース印西。'event' 等）
//
// 単位は PV ではなく「閲覧セッション数」。同じ端末が同じ日に何度開いても1件。
// 上のPV/VVカードとは数え方が違うので、画面上でも必ず明記する。
//
// 集計は service role で読む（管理画面 /admin/analytics 自体が is_admin を通っている）。
// 先例: /api/metaverse-usage の countVisitorsByDay。
// なお同APIは「タイル課金と無関係」という理由で mode='disaster-map' を除外しているため、
// 管理画面「メタバース」タブのグラフには防災MAPが出てこない。ここで補う。

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

type DayCount = { day: string; threeD: number; bousai: number }

const DAYS = 30
const TABLE_DAYS = 14

function jstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
}

function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function pct(current: number, prev: number): string {
  if (prev === 0) return current === 0 ? '±0%' : '（前週データなし）'
  const p = Math.round(((current - prev) / prev) * 100)
  return p >= 0 ? `+${p}%` : `${p}%`
}

async function fetchDaily(): Promise<DayCount[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  try {
    const supabase = createSupabaseClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase
      .from('metaverse_presence_daily')
      .select('day, mode')
      .gte('day', shiftDate(jstToday(), -(DAYS - 1)))
      .limit(20000)
    if (error) return null

    const map = new Map<string, DayCount>()
    for (const row of data ?? []) {
      const day = String(row.day)
      const cur = map.get(day) ?? { day, threeD: 0, bousai: 0 }
      if (row.mode === 'disaster-map') cur.bousai += 1
      else cur.threeD += 1
      map.set(day, cur)
    }
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day))
  } catch {
    return null
  }
}

export async function SiteContentSection() {
  const daily = await fetchDaily()
  const today = jstToday()

  // 記録のない日も行として出す（0だったのか計測が止まっていたのかを読み手が判断できるように）
  const byDay = new Map((daily ?? []).map((r) => [r.day, r]))
  const recent: DayCount[] = Array.from({ length: TABLE_DAYS }, (_, i) => {
    const day = shiftDate(today, -(TABLE_DAYS - 1 - i))
    return byDay.get(day) ?? { day, threeD: 0, bousai: 0 }
  }).reverse()

  const inRange = (r: DayCount, from: string, to: string) => r.day > from && r.day <= to
  const last7 = (daily ?? []).filter((r) => inRange(r, shiftDate(today, -7), today))
  const prev7 = (daily ?? []).filter((r) => inRange(r, shiftDate(today, -14), shiftDate(today, -7)))
  const sum = (rows: DayCount[], key: 'threeD' | 'bousai') => rows.reduce((a, r) => a + r[key], 0)

  const cards = [
    {
      label: '🌏 3Dワールド 直近7日',
      value: sum(last7, 'threeD'),
      compare: `前週比 ${pct(sum(last7, 'threeD'), sum(prev7, 'threeD'))}`,
    },
    {
      label: '🗺 防災MAP 直近7日',
      value: sum(last7, 'bousai'),
      compare: `前週比 ${pct(sum(last7, 'bousai'), sum(prev7, 'bousai'))}`,
    },
  ]

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
      <h2 className="text-lg font-semibold">CBIサイト側コンテンツ（3Dワールド・防災MAP）</h2>
      <p className="text-sm text-slate-500">
        3Dワールドと防災MAPは CBIサイト（communitybankinzai.github.io）にあり、CiDAO とは別サイトのため
        <strong className="font-semibold">上の PV / VV には含まれません</strong>。
        単位は「閲覧セッション数」（同じ端末が同じ日に何度開いても1件）で、PV とは数え方が違います。
      </p>

      {daily === null ? (
        <p className="text-sm text-red-600 dark:text-red-400">利用状況の取得に失敗しました。</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {cards.map((c) => (
              <div
                key={c.label}
                className="border border-slate-200 dark:border-slate-800 rounded-lg p-4"
              >
                <p className="text-xs text-slate-500">{c.label}</p>
                <p className="text-2xl font-bold text-right tabular-nums">
                  {c.value.toLocaleString()}
                </p>
                <p className="text-xs text-slate-500 text-right">{c.compare}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="text-left py-2 pr-3 font-normal">日付</th>
                  <th className="text-right py-2 px-3 font-normal">3Dワールド</th>
                  <th className="text-right py-2 pl-3 font-normal">防災MAP</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.day} className="border-b border-slate-100 dark:border-slate-800/50">
                    <td className="py-2 pr-3 tabular-nums">{r.day.slice(5).replace('-', '/')}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.threeD.toLocaleString()}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{r.bousai.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            直近{TABLE_DAYS}日。3Dワールドの利用者数（タイル費用の目安）は管理画面「メタバース」タブでも見られますが、
            そちらには防災MAPが含まれていません。
          </p>
        </>
      )}
    </section>
  )
}
