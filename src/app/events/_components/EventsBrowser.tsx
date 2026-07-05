'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { OrgLogo } from '@/components/ui/org-logo'
import { categoryLabel } from '@/lib/categories'
import { TYPE_LABEL } from '@/lib/org-labels'

const JST = 'Asia/Tokyo'
const hmFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: JST, hour: '2-digit', minute: '2-digit', hour12: false })
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' })
function ymdInJst(d: Date): string { return ymdFmt.format(d) }
function jstDayNoonMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 3, 0, 0)
}

export type EventRow = {
  id: string
  title: string
  description: string | null
  category: string
  start_at: string
  end_at: string
  location: string | null
  online_flag: boolean
  organizer_type: 'member' | 'org'
  organizer_id: string
  organizer_name_text: string | null
  flyer_image_url: string | null
}
export type OrgInfo = { id: string; name: string; type: string; legal_form: string | null; logo_url: string | null }

type Props = {
  events: EventRow[]
  orgInfo: Record<string, OrgInfo>  // organizer_id → org info
  cells: string[]                    // 月グリッドの 42 セル（YYYY-MM-DD）
  year: number
  month: number
  today: string
  isLoggedIn: boolean
  view: 'calendar' | 'list'
}

const TYPE_ORDER: Array<'civic_group' | 'business' | 'government'> = ['civic_group', 'business', 'government']

export default function EventsBrowser({ events, orgInfo, cells, year, month, today, isLoggedIn, view }: Props) {
  const [query, setQuery] = useState('')
  const [orgFilter, setOrgFilter] = useState<string>('all')  // 'all' | 'member_only' | orgId
  const [typeFilter, setTypeFilter] = useState<string | null>(null)  // null | 'civic_group' | 'business' | 'government'
  const [onlineOnly, setOnlineOnly] = useState(false)

  // 主催団体ラベル
  function organizerLabel(r: EventRow): string {
    if (r.organizer_type === 'org') return orgInfo[r.organizer_id]?.name ?? '団体'
    if (r.organizer_name_text) return `${r.organizer_name_text}（代理登録）`
    return '個人主催'
  }

  // 主催団体種別（type フィルタ用）
  function organizerType(r: EventRow): 'member' | 'civic_group' | 'business' | 'government' | 'unknown' {
    if (r.organizer_type === 'member') return 'member'
    const info = orgInfo[r.organizer_id]
    return (info?.type as 'civic_group' | 'business' | 'government') ?? 'unknown'
  }

  // 主催別の件数（フィルタチップ用）
  const orgCounts = useMemo(() => {
    const c: Record<string, number> = { all: events.length, member_only: 0 }
    for (const e of events) {
      if (e.organizer_type === 'member') c.member_only++
      else c[e.organizer_id] = (c[e.organizer_id] ?? 0) + 1
    }
    return c
  }, [events])

  // 種別別の件数
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of events) {
      const t = organizerType(e)
      if (t === 'unknown' || t === 'member') continue
      c[t] = (c[t] ?? 0) + 1
    }
    return c
  }, [events, orgInfo])

  // 主催団体のドロップダウン候補（このイベントセットに登場するもののみ、件数降順）
  const orgOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: Array<{ id: string; name: string; type: string; count: number }> = []
    for (const e of events) {
      if (e.organizer_type !== 'org') continue
      if (seen.has(e.organizer_id)) continue
      seen.add(e.organizer_id)
      const info = orgInfo[e.organizer_id]
      if (!info) continue
      opts.push({ id: info.id, name: info.name, type: info.type, count: orgCounts[info.id] ?? 0 })
    }
    return opts.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
  }, [events, orgInfo, orgCounts])

  // フィルタ適用
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      // 種別
      if (typeFilter) {
        if (organizerType(e) !== typeFilter) return false
      }
      // 団体
      if (orgFilter !== 'all') {
        if (orgFilter === 'member_only') {
          if (e.organizer_type !== 'member') return false
        } else {
          if (e.organizer_id !== orgFilter) return false
        }
      }
      // オンライン
      if (onlineOnly && !e.online_flag) return false
      // 検索
      if (q) {
        const orgName = e.organizer_type === 'org' ? (orgInfo[e.organizer_id]?.name ?? '') : (e.organizer_name_text ?? '')
        const hay = `${e.title} ${e.description ?? ''} ${e.location ?? ''} ${orgName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, query, orgFilter, typeFilter, onlineOnly, orgInfo])

  const hasActiveFilter = !!query || orgFilter !== 'all' || typeFilter !== null || onlineOnly

  // 月送り URL（view + 既存フィルタは URL に乗せず client state のみ）
  const monthLabel = `${year}年${month}月`
  const prevYm = (() => { const total = year * 12 + (month - 1) - 1; return `${Math.floor(total / 12)}-${String((total % 12 + 12) % 12 + 1).padStart(2, '0')}` })()
  const nextYm = (() => { const total = year * 12 + (month - 1) + 1; return `${Math.floor(total / 12)}-${String((total % 12 + 12) % 12 + 1).padStart(2, '0')}` })()
  const thisYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const viewSuffix = view === 'list' ? '&view=list' : ''

  // 日付ごと集約（フィルタ後のもの）
  const byDate = useMemo(() => {
    const m = new Map<string, EventRow[]>()
    for (const r of filtered) {
      const endMs = jstDayNoonMs(ymdInJst(new Date(r.end_at)))
      let ms = jstDayNoonMs(ymdInJst(new Date(r.start_at)))
      let guard = 0
      while (ms <= endMs && guard < 62) {
        const key = ymdInJst(new Date(ms))
        const list = m.get(key) ?? []
        list.push(r)
        m.set(key, list)
        ms += 86_400_000
        guard++
      }
    }
    return m
  }, [filtered])

  return (
    <div className="space-y-5">
      {/* 月送り + ビュー切替 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={`/events?ym=${prevYm}${viewSuffix}`}>
            <Button variant="outline" size="sm" aria-label="前の月">‹</Button>
          </Link>
          <span className="px-3 text-lg font-medium tabular-nums">{monthLabel}</span>
          <Link href={`/events?ym=${nextYm}${viewSuffix}`}>
            <Button variant="outline" size="sm" aria-label="次の月">›</Button>
          </Link>
          <Link href={`/events?ym=${thisYm}${viewSuffix}`}>
            <Button variant="ghost" size="sm">今月</Button>
          </Link>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Link href={`/events?ym=${year}-${String(month).padStart(2, '0')}`}>
            <Button variant={view === 'calendar' ? 'default' : 'outline'} size="sm">カレンダー</Button>
          </Link>
          <Link href={`/events?ym=${year}-${String(month).padStart(2, '0')}&view=list`}>
            <Button variant={view === 'list' ? 'default' : 'outline'} size="sm">リスト</Button>
          </Link>
        </div>
      </div>

      {/* 検索 + フィルタ */}
      <div className="space-y-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="イベント名・場所・主催団体・説明で検索"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />

        {/* 種別フィルタ */}
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={typeFilter === null} onClick={() => setTypeFilter(null)}>
            すべての種別
          </FilterChip>
          {TYPE_ORDER.map((t) => {
            const count = typeCounts[t] ?? 0
            if (!count) return null
            return (
              <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}>
                {TYPE_LABEL[t]} <span className="text-slate-400">{count}</span>
              </FilterChip>
            )
          })}
          <FilterChip active={onlineOnly} onClick={() => setOnlineOnly(!onlineOnly)}>
            🌐 オンラインのみ
          </FilterChip>
        </div>

        {/* 主催団体絞り込み（select） */}
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500 text-xs whitespace-nowrap">主催:</label>
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="flex-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm max-w-md"
          >
            <option value="all">すべての主催（{orgCounts.all}件）</option>
            {orgCounts.member_only > 0 && (
              <option value="member_only">個人主催のみ（{orgCounts.member_only}件）</option>
            )}
            <optgroup label="団体">
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}（{o.count}件）</option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* 結果数 + クリア */}
      <div className="text-xs text-slate-500 flex items-center justify-between">
        <span>{filtered.length} / {events.length} 件</span>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setQuery(''); setOrgFilter('all'); setTypeFilter(null); setOnlineOnly(false) }}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
          >
            フィルタを解除
          </button>
        )}
      </div>

      {/* ビュー本体 */}
      {view === 'calendar' ? (
        <>
          <p className="md:hidden text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5 -mt-1">
            <span aria-hidden>📱</span>
            <span>スマホでは画面上の<strong className="text-slate-700 dark:text-slate-300">「リスト」</strong>表示の方が読みやすくなります</span>
          </p>
          <CalendarView cells={cells} byDate={byDate} today={today} year={year} month={month} isLoggedIn={isLoggedIn} orgInfo={orgInfo} organizerLabel={organizerLabel} />
        </>
      ) : (
        <ListView events={filtered} organizerLabel={organizerLabel} orgInfo={orgInfo} />
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border transition ${
        active
          ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-slate-400'
      }`}
    >
      {children}
    </button>
  )
}

function CalendarView({
  cells, byDate, today, year, month, isLoggedIn, orgInfo, organizerLabel,
}: {
  cells: string[]
  byDate: Map<string, EventRow[]>
  today: string
  year: number
  month: number
  isLoggedIn: boolean
  orgInfo: Record<string, OrgInfo>
  organizerLabel: (r: EventRow) => string
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 text-[11px] font-medium border-b border-slate-200 dark:border-slate-800">
        {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (
          <div key={w} className={`px-2 py-1.5 text-center ${i === 0 ? 'text-rose-600 dark:text-rose-400' : i === 6 ? 'text-sky-600 dark:text-sky-400' : 'text-slate-600 dark:text-slate-400'}`}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((ymd, idx) => {
          const [cy, cm, cd] = ymd.split('-').map(Number)
          const inMonth = cy === year && cm === month
          const dow = idx % 7
          const isToday = ymd === today
          const items = byDate.get(ymd) ?? []
          return (
            <div key={ymd} className={`min-h-[92px] md:min-h-[110px] border-r border-b border-slate-100 dark:border-slate-800 last:border-r-0 p-1 flex flex-col gap-1 ${inMonth ? '' : 'bg-slate-50/60 dark:bg-slate-950/40'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs tabular-nums ${isToday ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : !inMonth ? 'text-slate-300 dark:text-slate-700' : dow === 0 ? 'text-rose-600 dark:text-rose-400' : dow === 6 ? 'text-sky-600 dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'}`}>{cd}</span>
                {isLoggedIn && inMonth && (
                  <Link href={`/events/new?date=${ymd}`} aria-label={`${ymd} にイベント登録`} className="opacity-0 hover:opacity-100 focus:opacity-100 text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-1">＋</Link>
                )}
              </div>
              <ul className="flex flex-col gap-0.5 overflow-hidden">
                {items.slice(0, 3).map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} title={`${hmFmt.format(new Date(e.start_at))} ${e.title} / ${organizerLabel(e)}`} className="block truncate text-[11px] px-1 py-0.5 rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/70 text-amber-900 dark:text-amber-100">
                      <span className="tabular-nums mr-1">{hmFmt.format(new Date(e.start_at))}</span>
                      {e.flyer_image_url && <span className="mr-0.5" aria-hidden>📎</span>}
                      {e.title}
                    </Link>
                  </li>
                ))}
                {items.length > 3 && (
                  <li className="text-[10px] text-slate-500 px-1">+{items.length - 3} 件</li>
                )}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DateBadge({ iso }: { iso: string }) {
  const d = new Date(iso)
  const day = Number(new Intl.DateTimeFormat('en-US', { timeZone: JST, day: 'numeric' }).format(d))
  const wd = new Intl.DateTimeFormat('ja-JP', { timeZone: JST, weekday: 'short' }).format(d)
  const isSun = wd === '日'
  const isSat = wd === '土'
  return (
    <div
      className={`shrink-0 w-14 h-16 rounded-lg border flex flex-col items-center justify-center transition-colors ${
        isSun
          ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40'
          : isSat
          ? 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'
      }`}
    >
      <span className={`text-xl font-bold leading-none tabular-nums ${isSun ? 'text-rose-600 dark:text-rose-400' : isSat ? 'text-sky-600 dark:text-sky-400' : 'text-slate-800 dark:text-slate-100'}`}>
        {day}
      </span>
      <span className={`text-[10px] mt-0.5 ${isSun ? 'text-rose-500' : isSat ? 'text-sky-500' : 'text-slate-500'}`}>
        {wd}曜
      </span>
    </div>
  )
}

const SLIDE_DISTANCE_PX = 90

// スクロール位置と連動して左右からスライドイン/アウトさせる。
// 画面下端で0%、画面縦方向中央でちょうど100%になるよう進捗を計算し、
// スクロールを戻せば逆再生される（IntersectionObserverの一発トリガーではなく毎スクロールで再計算）。
function useScrollSlideReveal(
  itemsRef: React.MutableRefObject<Map<string, { el: HTMLLIElement; fromLeft: boolean }>>,
) {
  const rafIdRef = useRef(0)

  const apply = useCallback(() => {
    rafIdRef.current = 0
    const vh = window.innerHeight
    const start = vh          // 画面下端 = 進捗0
    const end = vh / 2        // 画面縦方向中央 = 進捗100%
    itemsRef.current.forEach(({ el, fromLeft }) => {
      const rect = el.getBoundingClientRect()
      if (rect.height === 0) return // <details> が閉じている等
      const itemCenter = rect.top + rect.height / 2
      let progress = (start - itemCenter) / (start - end)
      progress = Math.min(1, Math.max(0, progress))
      const tx = (fromLeft ? -SLIDE_DISTANCE_PX : SLIDE_DISTANCE_PX) * (1 - progress)
      el.style.opacity = String(progress)
      el.style.transform = `translateX(${tx}px)`
    })
  }, [itemsRef])

  // <details>の開閉やウィンドウリサイズ時にも手動で再計算できるようにする
  const requestApply = useCallback(() => {
    if (rafIdRef.current) return
    rafIdRef.current = requestAnimationFrame(apply)
  }, [apply])

  useEffect(() => {
    requestApply()
    window.addEventListener('scroll', requestApply, { passive: true })
    window.addEventListener('resize', requestApply)
    return () => {
      window.removeEventListener('scroll', requestApply)
      window.removeEventListener('resize', requestApply)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [requestApply])

  return requestApply
}

function RevealItem({
  id,
  fromLeft,
  itemsRef,
  children,
}: {
  id: string
  fromLeft: boolean
  itemsRef: React.MutableRefObject<Map<string, { el: HTMLLIElement; fromLeft: boolean }>>
  children: React.ReactNode
}) {
  return (
    <li
      ref={(el) => {
        if (el) itemsRef.current.set(id, { el, fromLeft })
        else itemsRef.current.delete(id)
      }}
      style={{ opacity: 0, transform: `translateX(${fromLeft ? -SLIDE_DISTANCE_PX : SLIDE_DISTANCE_PX}px)` }}
    >
      {children}
    </li>
  )
}

function ListView({ events, organizerLabel, orgInfo }: { events: EventRow[]; organizerLabel: (r: EventRow) => string; orgInfo: Record<string, OrgInfo> }) {
  // 年月ごとにグルーピング（表示順は events の並び = start_at 昇順を維持）
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: EventRow[] }>()
    for (const e of events) {
      const d = new Date(e.start_at)
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit' }).format(d)
      const label = `${new Intl.DateTimeFormat('ja-JP', { timeZone: JST, year: 'numeric', month: 'long' }).format(d)}`
      const g = m.get(key) ?? { label, items: [] }
      g.items.push(e)
      m.set(key, g)
    }
    return Array.from(m.entries())
  }, [events])

  const itemsRef = useRef(new Map<string, { el: HTMLLIElement; fromLeft: boolean }>())
  const requestReveal = useScrollSlideReveal(itemsRef)

  if (events.length === 0) {
    return <p className="text-slate-400 text-center py-12">該当するイベントがありません</p>
  }

  const thisMonthKey = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit' }).format(new Date())

  return (
    <div className="space-y-3">
      {groups.map(([key, g]) => (
        <details
          key={key}
          open={key === thisMonthKey}
          onToggle={() => requestReveal()}
          className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
        >
          <summary className="cursor-pointer select-none px-4 py-2.5 flex items-center justify-between text-sm font-semibold bg-slate-50 dark:bg-slate-950/40 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors">
            <span>{g.label}</span>
            <span className="flex items-center gap-2 text-xs font-normal text-slate-500">
              {g.items.length}件
              <span className="inline-block transition-transform group-open:rotate-180">▾</span>
            </span>
          </summary>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {g.items.map((e) => {
              const info = e.organizer_type === 'org' ? orgInfo[e.organizer_id] : undefined
              return (
                <RevealItem key={e.id} id={e.id} fromLeft={false} itemsRef={itemsRef}>
                  <Link href={`/events/${e.id}`} className="flex gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <DateBadge iso={e.start_at} />
                    {e.flyer_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.flyer_image_url} alt="" className="w-14 h-16 object-cover rounded border border-slate-200 dark:border-slate-700 shrink-0 transition-transform hover:scale-[1.03]" />
                    ) : info ? (
                      <div className="shrink-0"><OrgLogo src={info.logo_url} name={info.name} size="lg" /></div>
                    ) : null}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between mb-1 gap-2">
                        <h2 className="text-base font-semibold truncate">{e.title}</h2>
                        <span className="text-xs text-slate-500 whitespace-nowrap tabular-nums">
                          {hmFmt.format(new Date(e.start_at))}
                        </span>
                      </div>
                      <div className="flex gap-2 text-xs flex-wrap items-center">
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{categoryLabel(e.category)}</span>
                        <span className="text-slate-500">主催: {organizerLabel(e)}</span>
                        {info && info.type !== 'civic_group' && (
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-600">{TYPE_LABEL[info.type] ?? info.type}</span>
                        )}
                        {e.online_flag && <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900 rounded">オンライン</span>}
                        {e.location && <span className="text-slate-500">📍 {e.location}</span>}
                      </div>
                    </div>
                  </Link>
                </RevealItem>
              )
            })}
          </ul>
        </details>
      ))}
    </div>
  )
}
