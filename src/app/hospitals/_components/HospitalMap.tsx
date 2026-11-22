'use client'

// 病院マップ（2026-11-23）。印西市の医療機関（医科・歯科）を地図と一覧で出す。
// 地図は食レポの候補画面（NewShopPanel）と同じ Leaflet（CDN）＋国土地理院の標準地図。サーバーの処理は使わない（データは src/lib/hospitals.ts）。
// 同じ建物に入っている医療機関は、1つのピンにまとめて出す（重なって押せなくなるため）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { HOSPITALS, HOSPITAL_FILTERS, matchesHospitalFilter, type Hospital } from '@/lib/hospitals'

const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_IMAGES = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/'
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
const CENTER: [number, number] = [35.8, 140.15]

type HMarker = { addTo(m: HMap): HMarker; bindPopup(html: string, o?: object): HMarker; openPopup(): unknown; remove(): void }
type HMap = { setView(c: [number, number], z: number): unknown; invalidateSize(): unknown; remove(): void; fitBounds(b: [number, number][], o?: object): unknown }
type HLeaflet = {
  map(el: HTMLElement, o?: object): HMap
  tileLayer(url: string, o?: object): { addTo(m: HMap): unknown }
  marker(c: [number, number], o?: object): HMarker
  Icon: { Default: { mergeOptions(o: object): void } }
}

let leafletPromise: Promise<HLeaflet> | null = null
function loadLeaflet(): Promise<HLeaflet> {
  const w = window as unknown as { L?: HLeaflet }
  if (w.L) return Promise.resolve(w.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise<HLeaflet>((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = LEAFLET_CSS
      document.head.appendChild(l)
    }
    const s = document.createElement('script')
    s.src = LEAFLET_JS
    s.onload = () => (w.L ? resolve(w.L) : reject(new Error('地図を読めません')))
    s.onerror = () => reject(new Error('地図を読めません'))
    document.head.appendChild(s)
  })
  leafletPromise.catch(() => {
    leafletPromise = null
  })
  return leafletPromise
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function telHref(tel: string): string {
  return `tel:${tel.replace(/[^0-9]/g, '')}`
}

function placeKey(h: Hospital): string {
  return `${h.lat.toFixed(5)},${h.lon.toFixed(5)}`
}

// ピンを押したときの吹き出し（同じ場所の医療機関を全部並べる）
function popupHtml(list: Hospital[]): string {
  const rows = list.map((h) => {
    const tel = h.tel
      ? `<a href="${telHref(h.tel)}" style="display:inline-block;margin-top:4px;padding:6px 10px;border-radius:8px;background:#0369a1;color:#fff;font-weight:700;text-decoration:none">📞 ${esc(h.tel)}</a>`
      : ''
    const site = h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer" style="margin-left:8px">公式サイト</a>` : ''
    return `<div style="padding:6px 0;border-top:1px solid #e2e8f0"><div style="font-weight:700;font-size:14px">${esc(h.name)}</div><div style="font-size:12px;color:#475569">${esc(h.dept.join('、'))}</div><div>${tel}${site}</div></div>`
  })
  const head = list[0]
  const approx = list.some((h) => h.approx) ? '<div style="font-size:11px;color:#b45309">※ピンの位置はおおよそです</div>' : ''
  return `<div style="min-width:200px;max-width:260px;max-height:260px;overflow:auto"><div style="font-size:12px;color:#475569">${esc(head.addr)}${head.bld ? `（${esc(head.bld.replace(/ ?[0-9]F$/, ''))}）` : ''}</div>${approx}${rows.join('')}</div>`
}

export function HospitalMap() {
  const [filter, setFilter] = useState<string>('all')
  const [mapError, setMapError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const mapEl = useRef<HTMLDivElement>(null)
  const ref = useRef<{ L: HLeaflet; map: HMap; markers: Map<string, HMarker> } | null>(null)

  const shown = useMemo(() => HOSPITALS.filter((h) => filter === 'all' || matchesHospitalFilter(h, filter)), [filter])

  // 地図を作る（一度だけ）
  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapEl.current) return
        L.Icon.Default.mergeOptions({ imagePath: LEAFLET_IMAGES })
        const map = L.map(mapEl.current, { scrollWheelZoom: false })
        map.setView(CENTER, 12)
        L.tileLayer(TILE_URL, {
          maxZoom: 18,
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
        }).addTo(map)
        ref.current = { L, map, markers: new Map() }
        ro = new ResizeObserver(() => map.invalidateSize())
        ro.observe(mapEl.current)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setMapError('地図を読み込めませんでした。下の一覧は使えます。')
      })
    return () => {
      cancelled = true
      ro?.disconnect()
      ref.current?.map.remove()
      ref.current = null
    }
  }, [])

  // 絞り込みに合わせてピンを置き直す
  useEffect(() => {
    const r = ref.current
    if (!ready || !r) return
    r.markers.forEach((m) => m.remove())
    r.markers.clear()
    const groups = new Map<string, Hospital[]>()
    for (const h of shown) {
      const k = placeKey(h)
      groups.set(k, [...(groups.get(k) ?? []), h])
    }
    const pts: [number, number][] = []
    groups.forEach((list, k) => {
      const c: [number, number] = [list[0].lat, list[0].lon]
      pts.push(c)
      const title = list.length > 1 ? `${list[0].name} ほか${list.length - 1}件` : list[0].name
      r.markers.set(k, r.L.marker(c, { title, alt: title }).addTo(r.map).bindPopup(popupHtml(list), { maxWidth: 280 }))
    })
    if (pts.length > 1) r.map.fitBounds(pts, { padding: [24, 24], maxZoom: 15 })
    else if (pts.length === 1) r.map.setView(pts[0], 15)
  }, [shown, ready])

  function showOnMap(h: Hospital) {
    const r = ref.current
    if (!r) return
    r.map.setView([h.lat, h.lon], 16)
    r.markers.get(placeKey(h))?.openPopup()
    mapEl.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const btn = (active: boolean) =>
    `min-h-10 rounded-full border px-3 text-sm font-medium transition ${
      active
        ? 'border-sky-600 bg-sky-600 text-white'
        : 'border-slate-300 bg-white text-slate-700 hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
    }`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="診療科でしぼる">
        <button type="button" className={btn(filter === 'all')} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          すべて
        </button>
        {HOSPITAL_FILTERS.map((f) => (
          <button key={f.key} type="button" className={btn(filter === f.key)} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
        <div ref={mapEl} className="h-[420px] w-full bg-slate-100 dark:bg-slate-900" aria-label="医療機関の地図" />
      </div>
      {mapError ? <p className="text-sm text-amber-700 dark:text-amber-300">{mapError}</p> : null}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        ピンを押すと、名前・診療科・電話が出ます。同じ建物の医療機関は1つのピンにまとめています。地図は指2本（パソコンは＋−のボタン）で大きくできます。
      </p>

      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200" aria-live="polite">
        {shown.length}件
      </p>
      <ul className="space-y-2">
        {shown.map((h) => (
          <li key={h.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {h.name}
              {h.kind === '病院' ? <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900 dark:text-rose-200">病院</span> : null}
              {h.kind === '歯科' ? <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900 dark:text-teal-200">歯科</span> : null}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{h.dept.join('、')}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {h.addr}
              {h.bld ? `（${h.bld}）` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {h.tel ? (
                <a href={telHref(h.tel)} className="inline-flex min-h-10 items-center rounded-lg bg-sky-700 px-3 text-sm font-bold text-white hover:bg-sky-800">
                  📞 {h.tel}
                </a>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">電話番号は公式サイトでご確認ください</span>
              )}
              <button
                type="button"
                onClick={() => showOnMap(h)}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                地図で見る
              </button>
              {h.url ? (
                <a href={h.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center px-1 text-sm text-blue-600 hover:underline">
                  公式サイト
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
