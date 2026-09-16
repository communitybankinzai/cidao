'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import { Sheet } from '@/components/ui/sheet'
import {
  FREEFREE_CATEGORIES,
  FREEFREE_POSTER_KINDS,
  freefreeCategoryLabel,
  freefreePosterKindMeta,
  type FreefreePosterKind,
} from '@/lib/freefree-categories'

export type FreefreeRow = {
  id: string
  title: string
  body: string
  category: string
  location: string | null
  created_at: string
  expires_at: string | null
  posterKind: FreefreePosterKind
  orgName: string | null
  proxied: boolean // 運営者が団体の依頼を受けて代理掲載したもの
  images: string[] | null
  hasCoupon: boolean
}

type SortKey = 'newest' | 'expiring_soon'

const SORT_LABEL: Record<SortKey, string> = {
  newest: '新着順',
  expiring_soon: '締切が近い順',
}

/** 一度に描画する件数。スマホで縦に積みすぎないよう区切る */
const PAGE_SIZE = 20

export default function FreefreeBrowser({ rows }: { rows: FreefreeRow[] }) {
  const [posterFilter, setPosterFilter] = useState<FreefreePosterKind | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    const now = Date.now()
    let r = rows
    if (posterFilter !== 'all') r = r.filter((p) => p.posterKind === posterFilter)
    if (categoryFilter !== 'all') r = r.filter((p) => p.category === categoryFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        (p.location ?? '').toLowerCase().includes(q) ||
        (p.orgName ?? '').toLowerCase().includes(q),
      )
    }
    if (sort === 'expiring_soon') {
      r = [...r].sort((a, b) => {
        const ea = a.expires_at ? new Date(a.expires_at).getTime() : Number.POSITIVE_INFINITY
        const eb = b.expires_at ? new Date(b.expires_at).getTime() : Number.POSITIVE_INFINITY
        return ea - eb
      }).filter((p) => !p.expires_at || new Date(p.expires_at).getTime() > now)
    }
    return r
  }, [rows, posterFilter, categoryFilter, search, sort])

  const posterCounts = useMemo(() => {
    const c: Record<string, number> = {}
    rows.forEach((p) => { c[p.posterKind] = (c[p.posterKind] ?? 0) + 1 })
    return c
  }, [rows])

  const hasActiveFilter = posterFilter !== 'all' || categoryFilter !== 'all' || search.trim().length > 0 || sort !== 'newest'

  const resetFilters = () => {
    setPosterFilter('all')
    setCategoryFilter('all')
    setSearch('')
    setSort('newest')
  }

  // 適用中の条件。シートを閉じたあとも一覧の上に残して、何で絞ったか分かるようにする
  const activeChips: { label: string; clear: () => void }[] = []
  if (posterFilter !== 'all') {
    activeChips.push({
      label: freefreePosterKindMeta(posterFilter).badge,
      clear: () => setPosterFilter('all'),
    })
  }
  if (categoryFilter !== 'all') {
    activeChips.push({
      label: freefreeCategoryLabel(categoryFilter),
      clear: () => setCategoryFilter('all'),
    })
  }

  // 条件を変えたら先頭から見せ直す。
  // effect で setState するとレンダーが二重に走るため、React 公式の
  // 「前回値をレンダー中に比べる」書き方でリセットする
  const filterKey = [posterFilter, categoryFilter, search, sort].join('')
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    setVisible(PAGE_SIZE)
  }

  const shown = filtered.slice(0, visible)
  const rest = filtered.length - shown.length

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input
          type="search"
          placeholder="🔍 タイトル・本文・場所・組織名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            data-instant="true"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm hover:border-slate-400 dark:hover:border-slate-500 transition"
          >
            <span aria-hidden>⚙️</span>
            <span>絞り込み・並び替え</span>
            {activeChips.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-bold flex items-center justify-center">
                {activeChips.length}
              </span>
            )}
          </button>
          <span className="ml-auto text-xs text-slate-500 shrink-0">
            {filtered.length} / {rows.length} 件
          </span>
        </div>

        {(activeChips.length > 0 || sort !== 'newest') && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.clear}
                data-instant="true"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              >
                {c.label}
                <span aria-hidden className="opacity-70">✕</span>
              </button>
            ))}
            {sort !== 'newest' && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {SORT_LABEL[sort]}
              </span>
            )}
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                data-instant="true"
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
              >
                すべて解除
              </button>
            )}
          </div>
        )}
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="絞り込み・並び替え"
        footer={
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            data-instant="true"
            className="w-full h-11 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold"
          >
            {filtered.length} 件を見る
          </button>
        }
      >
        <div className="space-y-4">
          <section>
            <h3 className="text-[11px] font-semibold text-slate-400 tracking-wide mb-1.5">掲載者</h3>
            <div className="flex flex-wrap gap-2">
              <Chip active={posterFilter === 'all'} onClick={() => setPosterFilter('all')} label={`すべて (${rows.length})`} />
              {FREEFREE_POSTER_KINDS.filter((k) => (posterCounts[k.key] ?? 0) > 0).map((k) => (
                <Chip
                  key={k.key}
                  active={posterFilter === k.key}
                  onClick={() => setPosterFilter(k.key)}
                  label={`${k.badge} (${posterCounts[k.key] ?? 0})`}
                  className={posterFilter === k.key ? '' : k.badgeClass}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold text-slate-400 tracking-wide mb-1.5">カテゴリ</h3>
            <div className="flex flex-wrap gap-2">
              <Chip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} label="すべて" />
              {FREEFREE_CATEGORIES.map((c) => (
                <Chip key={c.key} active={categoryFilter === c.key} onClick={() => setCategoryFilter(c.key)} label={c.label} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold text-slate-400 tracking-wide mb-1.5">並び替え</h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <Chip key={k} active={sort === k} onClick={() => setSort(k)} label={SORT_LABEL[k]} />
              ))}
            </div>
          </section>
        </div>
      </Sheet>

      {filtered.length === 0 ? (
        <p className="text-slate-400 text-center py-12">該当する掲載はありません</p>
      ) : (
        <ul className="grid md:grid-cols-2 gap-3">
          {shown.map((p) => {
            const meta = freefreePosterKindMeta(p.posterKind)
            const daysLeft = p.expires_at
              ? Math.ceil((new Date(p.expires_at).getTime() - Date.now()) / 86400_000)
              : null
            const expiringSoon = daysLeft !== null && daysLeft <= 3 && daysLeft >= 0
            return (
              <li key={p.id}>
                <Link href={`/freefree/${p.id}`} className="block bg-white dark:bg-slate-900 border rounded-lg overflow-hidden hover:border-slate-400 dark:hover:border-slate-600 transition">
                  {p.images && p.images.length > 0 && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.images[0]} alt={p.title} className="w-full h-32 object-cover" />
                  )}
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.badgeClass}`}>{meta.badge}</span>
                        {p.hasCoupon && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">🎟 クーポン</span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500">{freefreeCategoryLabel(p.category)}</span>
                    </div>
                    <div className="font-semibold mb-1">{p.title}</div>
                    {p.orgName && (
                      <div className="text-xs text-slate-500 mb-1">
                        by {p.orgName}
                        {p.proxied && <span className="ml-1 text-slate-400">（CBIが依頼を受けて掲載）</span>}
                      </div>
                    )}
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{p.body}</p>
                    <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                      {p.location ? <span>📍 {p.location}</span> : <span />}
                      {expiringSoon && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          ⏰ あと{daysLeft === 0 ? '本日まで' : `${daysLeft}日`}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          data-instant="true"
          className="w-full h-12 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium hover:border-slate-400 dark:hover:border-slate-500 transition"
        >
          もっと見る（残り {rest} 件）
        </button>
      )}
    </div>
  )
}

function Chip({ active, onClick, label, className }: { active: boolean; onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-instant="true"
      className={
        active
          ? 'px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-white dark:bg-white dark:text-slate-900'
          : `px-3 py-1 rounded-full text-xs border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 ${className ?? 'bg-slate-50 dark:bg-slate-800'}`
      }
    >
      {label}
    </button>
  )
}
