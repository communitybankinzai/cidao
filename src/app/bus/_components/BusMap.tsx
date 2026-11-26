'use client'

// 印西バスマップ（2026-11-27 試作）。
// バスの印の位置は、時刻表（各バス停の時刻）とバス停の位置（あれば路線の形）から計算した「予測」。実際の位置ではない。
// データは public/bus/network.json（scripts/bus/build_bus_data.py が GTFS から作る）。サーバーの処理は使わない。
// 地図は病院マップ（HospitalMap）と同じ Leaflet（CDN）＋国土地理院の標準地図。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Bus3D, type Bus3DBus, type Bus3DLine } from './Bus3D'
import { MAX_TRANSFERS, WALK_MAX_M, buildNeighbors, searchJourneyOptions, type Journey } from './journey'

const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
const CENTER: [number, number] = [35.79, 140.2]
const PALETTE = ['#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f', '#b45309', '#4338ca', '#0f766e', '#a21caf']
const FAV_KEY = 'cidao.bus.favStops'

type LatLon = [number, number]
type LLayer = { addTo(m: LMap): LLayer; remove(): void; on(ev: string, fn: () => void): LLayer; setLatLng(c: LatLon): LLayer; bindPopup(html: string, o?: object): LLayer; setPopupContent(html: string): LLayer; setStyle(o: object): LLayer; bringToFront(): LLayer }
type LMap = { setView(c: LatLon, z: number): unknown; invalidateSize(): unknown; remove(): void; fitBounds(b: LatLon[], o?: object): unknown; panTo(c: LatLon): unknown }
type LLeaflet = {
  map(el: HTMLElement, o?: object): LMap
  tileLayer(url: string, o?: object): LLayer
  polyline(pts: LatLon[], o?: object): LLayer
  circleMarker(c: LatLon, o?: object): LLayer
  marker(c: LatLon, o?: object): LLayer
  divIcon(o: object): object
}

type Route = { id: string; name: string; color: string; agency: string; agencyUrl: string; agencyTel: string; feed: string }
type Stop = { id: string; name: string; lat: number; lon: number; approx?: string } // approx＝位置が目安（町名の代表点など）のときの説明
type StopTime = [string, number, number, number?] // バス停ID, 着く秒, 出る秒, 起点からの距離m
type Trip = { id: string; route: string; service: string; headsign: string; shape: string; st: StopTime[] }
type Service = { days: number[]; start: string; end: string; add: string[]; remove: string[] }
type Source = { key: string; publisher: string; start: string; end: string; version: string }
type Network = { builtAt: string; sources: Source[]; routes: Route[]; stops: Stop[]; shapes: Record<string, number[][]>; trips: Trip[]; services: Record<string, Service> }

let leafletPromise: Promise<LLeaflet> | null = null
function loadLeaflet(): Promise<LLeaflet> {
  const w = window as unknown as { L?: LLeaflet }
  if (w.L) return Promise.resolve(w.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise<LLeaflet>((resolve, reject) => {
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

// いまの日本の日付と時刻。?t=HH:MM と ?d=YYYYMMDD を付けると、その日時で表示する（確認用）
type Clock = { ymd: string; dow: number; sec: number; fixed: boolean }
function readClock(): Clock {
  const q = new URLSearchParams(window.location.search)
  const jst = new Date(Date.now() + 9 * 3600 * 1000)
  let ymd = `${jst.getUTCFullYear()}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`
  let sec = jst.getUTCHours() * 3600 + jst.getUTCMinutes() * 60 + jst.getUTCSeconds()
  let fixed = false
  const d = q.get('d')
  if (d && /^\d{8}$/.test(d)) {
    ymd = d
    fixed = true
  }
  const t = q.get('t')
  if (t && /^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(':').map(Number)
    sec = h * 3600 + m * 60 + (jst.getUTCSeconds() % 60)
    fixed = true
  }
  const dt = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))))
  const dow = (dt.getUTCDay() + 6) % 7 // 月曜=0
  return { ymd, dow, sec, fixed }
}

function serviceRuns(sv: Service | undefined, ymd: string, dow: number): boolean {
  if (!sv) return false
  if (sv.add.includes(ymd)) return true
  if (sv.remove.includes(ymd)) return false
  if (sv.start && ymd < sv.start) return false
  if (sv.end && ymd > sv.end) return false
  return sv.days[dow] === 1
}

// 行き先の書き方。「〜回り」「循環」はそのまま、ふつうの行き先には「行き」を付ける
function dest(h: string): string {
  return /回り$|循環$/.test(h) ? h : `${h} 行き`
}

function hm(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function telShow(tel: string): string {
  // 元のデータで先頭の0が落ちている番号がある（例：434833320）
  const d = tel.replace(/[^0-9]/g, '')
  return d && d[0] !== '0' ? `0${d}` : d
}

// 路線の形の上で、起点から dist メートルの位置
function pointOnShape(shape: number[][], dist: number): LatLon {
  let lo = 0
  let hi = shape.length - 1
  if (dist <= shape[0][2]) return [shape[0][0], shape[0][1]]
  if (dist >= shape[hi][2]) return [shape[hi][0], shape[hi][1]]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (shape[mid][2] <= dist) lo = mid
    else hi = mid
  }
  const a = shape[lo]
  const b = shape[hi]
  const f = b[2] > a[2] ? (dist - a[2]) / (b[2] - a[2]) : 0
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

type BusPos = { trip: Trip; pos: LatLon; nextStop: string; nextSec: number }

// 時刻表とバス停の位置から、この便のいまの位置を計算する（走っていない時間は null）
function tripPosition(trip: Trip, sec: number, stopById: Map<string, Stop>, shapes: Record<string, number[][]>): BusPos | null {
  const st = trip.st
  if (sec < st[0][2] || sec > st[st.length - 1][1]) return null
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i]
    const b = st[i + 1]
    if (sec > b[1]) continue
    const sa = stopById.get(a[0])
    const sb = stopById.get(b[0])
    if (!sa || !sb) return null
    const next = { trip, nextStop: sb.name, nextSec: b[1] }
    if (sec <= a[2]) return { ...next, pos: [sa.lat, sa.lon] } // バス停に止まっている
    const f = b[1] > a[2] ? (sec - a[2]) / (b[1] - a[2]) : 1
    const shape = trip.shape ? shapes[trip.shape] : undefined
    if (shape && a[3] != null && b[3] != null && b[3] >= a[3]) {
      return { ...next, pos: pointOnShape(shape, a[3] + (b[3] - a[3]) * f) }
    }
    return { ...next, pos: [sa.lat + (sb.lat - sa.lat) * f, sa.lon + (sb.lon - sa.lon) * f] }
  }
  return null
}

// よく使うバス停（この端末に覚える）
const favListeners = new Set<() => void>()
function favRead(): string {
  try {
    return window.localStorage.getItem(FAV_KEY) ?? '[]'
  } catch {
    return '[]'
  }
}
function favWrite(names: string[]) {
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(names.slice(0, 8)))
  } catch {
    // 保存できない端末では、覚えないだけにする
  }
  favListeners.forEach((fn) => fn())
}
function favSubscribe(fn: () => void) {
  favListeners.add(fn)
  return () => {
    favListeners.delete(fn)
  }
}

export function BusMap() {
  const [net, setNet] = useState<Network | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [clock, setClock] = useState<Clock | null>(null)
  const [routeId, setRouteId] = useState<string>('all')
  const [stopName, setStopName] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<'flat' | 'solid'>('flat') // 平面（地図）／立体（自作の地形の模型・地図タイルを読まない）
  // 乗り方をさがす（乗るバス停・降りるバス停・出る時刻）
  const [fromName, setFromName] = useState('')
  const [toName, setToName] = useState('')
  const [planTime, setPlanTime] = useState('') // 空＝いま
  const mapEl = useRef<HTMLDivElement>(null)
  const panelEl = useRef<HTMLDivElement>(null)
  const ref = useRef<{ L: LLeaflet; map: LMap; lines: LLayer[]; stops: Map<string, LLayer>; buses: Map<string, LLayer> } | null>(null)

  const favRaw = useSyncExternalStore(favSubscribe, favRead, () => '[]')
  const favs = useMemo<string[]>(() => {
    try {
      const v = JSON.parse(favRaw)
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  }, [favRaw])

  // データを読む
  useEffect(() => {
    let cancelled = false
    fetch('/bus/network.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Network) => {
        if (!cancelled) setNet(d)
      })
      .catch(() => {
        if (!cancelled) setError('バスのデータを読み込めませんでした。時間をおいて開き直してください。')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 時計（1秒ごと）
  useEffect(() => {
    const tick = () => setClock(readClock())
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [])

  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    net?.routes.forEach((r, i) => m.set(r.id, r.color ? `#${r.color}` : PALETTE[i % PALETTE.length]))
    return m
  }, [net])
  const routeById = useMemo(() => new Map(net?.routes.map((r) => [r.id, r]) ?? []), [net])
  const stopById = useMemo(() => new Map(net?.stops.map((s) => [s.id, s]) ?? []), [net])

  // 路線を会社ごとに並べる
  const groups = useMemo(() => {
    const g = new Map<string, Route[]>()
    for (const r of net?.routes ?? []) {
      const k = r.agency || 'その他'
      g.set(k, [...(g.get(k) ?? []), r])
    }
    return [...g.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ja'))
      .map(([agency, routes]) => ({ agency, routes: routes.sort((a, b) => a.name.localeCompare(b.name, 'ja')) }))
  }, [net])

  // その路線が通るバス停
  const stopsOfRoute = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const t of net?.trips ?? []) {
      const set = m.get(t.route) ?? new Set<string>()
      t.st.forEach((s) => set.add(s[0]))
      m.set(t.route, set)
    }
    return m
  }, [net])

  // きょう走る便
  const ymd = clock?.ymd ?? null
  const dow = clock?.dow ?? 0
  const todayTrips = useMemo(() => {
    if (!net || !ymd) return []
    return net.trips.filter((t) => serviceRuns(net.services[t.service], ymd, dow))
  }, [net, ymd, dow])

  // 地図を作る（一度だけ）
  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapEl.current) return
        const map = L.map(mapEl.current, { scrollWheelZoom: false })
        map.setView(CENTER, 12)
        L.tileLayer(TILE_URL, {
          maxZoom: 18,
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
        }).addTo(map)
        ref.current = { L, map, lines: [], stops: new Map(), buses: new Map() }
        ro = new ResizeObserver(() => map.invalidateSize())
        ro.observe(mapEl.current)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setMapError('地図を読み込めませんでした。下のバス停の一覧は使えます。')
      })
    return () => {
      cancelled = true
      ro?.disconnect()
      ref.current?.map.remove()
      ref.current = null
    }
  }, [])

  // 路線の線とバス停を描く（路線を選び直したら描き直す）
  useEffect(() => {
    const m = ref.current
    if (!m || !ready || !net) return
    m.lines.forEach((l) => l.remove())
    m.lines = []
    m.stops.forEach((l) => l.remove())
    m.stops.clear()
    const bounds: LatLon[] = []
    const drawn = new Set<string>()
    for (const t of net.trips) {
      if (routeId !== 'all' && t.route !== routeId) continue
      const key = t.shape || `${t.route}|${t.st.map((s) => s[0]).join('>')}`
      if (drawn.has(key)) continue
      drawn.add(key)
      const pts: LatLon[] = t.shape
        ? net.shapes[t.shape].map((p) => [p[0], p[1]] as LatLon)
        : t.st.map((s) => stopById.get(s[0])).filter((s): s is Stop => !!s).map((s) => [s.lat, s.lon] as LatLon)
      if (pts.length < 2) continue
      m.lines.push(m.L.polyline(pts, { color: '#1e293b', weight: 7, opacity: 0.35, interactive: false }).addTo(m.map))
      m.lines.push(m.L.polyline(pts, { color: colorOf.get(t.route) ?? '#2563eb', weight: 4, opacity: 0.95, interactive: false, dashArray: t.shape ? undefined : '6 6' }).addTo(m.map))
      pts.forEach((p) => bounds.push(p))
    }
    const visible = routeId === 'all' ? null : stopsOfRoute.get(routeId)
    for (const s of net.stops) {
      if (visible && !visible.has(s.id)) continue
      const mk = m.L.circleMarker([s.lat, s.lon], { radius: 7, color: '#0f172a', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
        .addTo(m.map)
        .on('click', () => {
          setStopName(s.name)
          setShowAll(false)
          panelEl.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      m.stops.set(s.id, mk)
    }
    if (bounds.length) m.map.fitBounds(bounds, { padding: [24, 24] })
  }, [ready, net, routeId, colorOf, stopById, stopsOfRoute])

  // 選んだバス停を目立たせる
  useEffect(() => {
    const m = ref.current
    if (!m || !net) return
    for (const s of net.stops) {
      const mk = m.stops.get(s.id)
      if (!mk) continue
      const on = s.name === stopName
      mk.setStyle({ radius: on ? 11 : 7, fillColor: on ? '#facc15' : '#ffffff', weight: on ? 3 : 2 })
      if (on) mk.bringToFront()
    }
  }, [stopName, net, routeId, ready])

  // バスの印を動かす（毎秒）
  const buses = useMemo(() => {
    if (!net || !clock) return []
    const out: BusPos[] = []
    for (const t of todayTrips) {
      if (routeId !== 'all' && t.route !== routeId) continue
      const p = tripPosition(t, clock.sec, stopById, net.shapes)
      if (p) out.push(p)
    }
    return out
  }, [net, clock, todayTrips, routeId, stopById])

  useEffect(() => {
    const m = ref.current
    if (!m || !ready) return
    const seen = new Set<string>()
    for (const b of buses) {
      seen.add(b.trip.id)
      const r = routeById.get(b.trip.route)
      const html = `<div style="font-size:14px;line-height:1.5"><b>${esc(r?.name ?? '')}</b><br>${esc(dest(b.trip.headsign))}<br>次は <b>${esc(b.nextStop)}</b>（${hm(b.nextSec)} の予定）<br><span style="font-size:12px;color:#b45309">位置は時刻表からの予測です</span></div>`
      const cur = m.buses.get(b.trip.id)
      if (cur) {
        cur.setLatLng(b.pos).setPopupContent(html)
      } else {
        const icon = m.L.divIcon({
          className: '',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          html: `<div style="width:34px;height:34px;border-radius:50%;background:${colorOf.get(b.trip.route) ?? '#2563eb'};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:18px">🚌</div>`,
        })
        m.buses.set(b.trip.id, m.L.marker(b.pos, { icon, zIndexOffset: 1000 }).addTo(m.map).bindPopup(html))
      }
    }
    for (const [id, mk] of m.buses) {
      if (!seen.has(id)) {
        mk.remove()
        m.buses.delete(id)
      }
    }
  }, [buses, ready, colorOf, routeById])

  // 立体表示に渡すもの（路線の線・バス停・バス）
  const lines3d = useMemo<Bus3DLine[]>(() => {
    if (!net) return []
    const out: Bus3DLine[] = []
    const drawn = new Set<string>()
    for (const t of net.trips) {
      if (routeId !== 'all' && t.route !== routeId) continue
      const key = t.shape || `${t.route}|${t.st.map((x) => x[0]).join('>')}`
      if (drawn.has(key)) continue
      drawn.add(key)
      const pts: [number, number][] = t.shape
        ? net.shapes[t.shape].map((q) => [q[0], q[1]] as [number, number])
        : t.st.map((x) => stopById.get(x[0])).filter((x): x is Stop => !!x).map((x) => [x.lat, x.lon] as [number, number])
      if (pts.length >= 2) out.push({ route: t.route, color: colorOf.get(t.route) ?? '#2563eb', pts })
    }
    return out
  }, [net, routeId, stopById, colorOf])
  const stops3d = useMemo(() => {
    if (!net) return []
    const visible = routeId === 'all' ? null : stopsOfRoute.get(routeId)
    return net.stops.filter((x) => !visible || visible.has(x.id))
  }, [net, routeId, stopsOfRoute])
  const buses3d = useMemo<Bus3DBus[]>(
    () => buses.map((b) => ({ id: b.trip.id, color: colorOf.get(b.trip.route) ?? '#2563eb', lat: b.pos[0], lon: b.pos[1], label: dest(b.trip.headsign) })),
    [buses, colorOf],
  )

  // 選んだバス停の、きょうの時刻表（同じ名前の乗り場をまとめる。終点に着くだけの便は出さない）
  const departures = useMemo(() => {
    if (!net || !stopName) return []
    const ids = new Set(net.stops.filter((s) => s.name === stopName).map((s) => s.id))
    const out: { sec: number; route: Route | undefined; headsign: string; key: string }[] = []
    for (const t of todayTrips) {
      t.st.forEach((s, i) => {
        if (i < t.st.length - 1 && ids.has(s[0])) out.push({ sec: s[2], route: routeById.get(t.route), headsign: t.headsign, key: `${t.id}-${i}` })
      })
    }
    return out.sort((a, b) => a.sec - b.sec)
  }, [net, stopName, todayTrips, routeById])

  // 乗り方の案（会社をまたいだ乗り継ぎも含む。計算は端末の中だけ）
  const neighbors = useMemo(() => buildNeighbors(net?.stops ?? []), [net])
  const nowMinute = clock ? Math.floor(clock.sec / 60) * 60 : null
  const planDepart = useMemo(() => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(planTime)
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60
    return nowMinute
  }, [planTime, nowMinute])
  const plans = useMemo<Journey[] | null>(() => {
    if (!net || !fromName || !toName || fromName === toName || planDepart == null) return null
    const ids = (name: string) => net.stops.filter((s) => s.name === name).map((s) => s.id)
    return searchJourneyOptions(todayTrips, neighbors, ids(fromName), ids(toName), planDepart, 3)
  }, [net, fromName, toName, planDepart, todayTrips, neighbors])

  const stopNames = useMemo(() => [...new Set(net?.stops.map((s) => s.name) ?? [])].sort((a, b) => a.localeCompare(b, 'ja')), [net])
  const nowSec = clock?.sec ?? 0
  const upcoming = departures.filter((d) => d.sec >= nowSec)
  const isFav = stopName ? favs.includes(stopName) : false

  function pickStop(name: string) {
    setStopName(name || null)
    setShowAll(false)
    const s = net?.stops.find((x) => x.name === name)
    if (s) ref.current?.map.panTo([s.lat, s.lon])
  }

  const chip = (on: boolean) =>
    `min-h-11 rounded-full border px-4 py-2 text-base font-semibold ${on ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-300 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}`

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        🚌 バスの印は、時刻表から計算した「予測の位置」です。実際の遅れは反映されません。
        {clock?.fixed ? `（確認用：${clock.ymd} ${hm(clock.sec)} の表示）` : ''}
      </p>

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}

      <section aria-label="路線をえらぶ" className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(routeId === 'all')} onClick={() => setRouteId('all')}>
            すべての路線
          </button>
        </div>
        {groups.map((g) => (
          <div key={g.agency} className="space-y-1">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{g.agency}</div>
            <div className="flex flex-wrap gap-2">
              {g.routes.map((r) => (
                <button key={r.id} type="button" className={chip(routeId === r.id)} onClick={() => setRouteId(r.id)}>
                  <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: colorOf.get(r.id) }} />
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {mapError ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{mapError}</p> : null}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="地図の見え方">
        <button type="button" className={chip(view === 'flat')} onClick={() => setView('flat')}>
          🗺 平面
        </button>
        <button type="button" className={chip(view === 'solid')} onClick={() => setView('solid')}>
          🏔 立体
        </button>
      </div>
      <div ref={mapEl} className={`h-[55vh] min-h-[320px] w-full overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700${view === 'flat' ? '' : ' hidden'}`} />
      {view === 'solid' ? (
        <Bus3D
          stops={stops3d}
          lines={lines3d}
          buses={buses3d}
          selectedStop={stopName}
          onPickStop={(name) => {
            setStopName(name)
            setShowAll(false)
          }}
        />
      ) : null}
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {clock ? `いま走っている予定のバス：${buses.length}台（${hm(clock.sec)} 現在）。` : ''}{view === 'flat' ? '白い丸がバス停です。押すと、下に時刻表が出ます。' : ''}
      </p>

      <section aria-label="乗り方をさがす" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">🧭 乗り方をさがす</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">乗るバス停と降りるバス停をえらぶと、いちばん早く着く乗り方を出します。バス会社がちがっても、乗り継ぎの案を出します。</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
            乗るバス停
            <select className="mt-1 block min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-950" value={fromName} onChange={(e) => setFromName(e.target.value)}>
              <option value="">（えらぶ）</option>
              {stopNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
            降りるバス停
            <select className="mt-1 block min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-950" value={toName} onChange={(e) => setToName(e.target.value)}>
              <option value="">（えらぶ）</option>
              {stopNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={chip(planTime === '')} onClick={() => setPlanTime('')}>
            いま出る
          </button>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            時刻をえらぶ
            <input
              type="time"
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-base dark:border-slate-700 dark:bg-slate-950"
              value={planTime}
              onChange={(e) => setPlanTime(e.target.value)}
            />
          </label>
          {fromName && toName ? (
            <button
              type="button"
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700"
              onClick={() => {
                setFromName(toName)
                setToName(fromName)
              }}
            >
              ⇅ 入れかえる
            </button>
          ) : null}
        </div>
        {fromName && toName && fromName === toName ? <p className="text-base text-slate-700 dark:text-slate-200">乗るバス停と降りるバス停が同じです。</p> : null}
        {plans && plans.length === 0 ? (
          <p className="text-base text-slate-700 dark:text-slate-200">
            きょうのこの時刻からは、乗り継いでも着ける便が見つかりませんでした（乗り換えは{MAX_TRANSFERS}回まで・歩く乗り換えは{WALK_MAX_M}mまでで調べています）。
          </p>
        ) : null}
        {plans && plans.length ? (
          <ol className="space-y-3" data-testid="bus-plans">
            {plans.map((j, idx) => (
              <li key={j.legs.map((l) => l.tripId + l.fromStop).join('|')} className="rounded-lg border-2 border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {idx === 0 ? '⭐ ' : ''}
                    {hm(j.depSec)} 発 → {hm(j.arrSec)} 着
                  </span>
                  <span className="text-sm font-semibold text-sky-700 dark:text-sky-300">
                    {Math.round((j.arrSec - j.depSec) / 60)}分・{j.transfers === 0 ? '乗り換えなし' : `乗り換え${j.transfers}回`}
                  </span>
                </div>
                <ul className="mt-2 space-y-2">
                  {j.legs.map((l, i) => {
                    const r = routeById.get(l.route)
                    const next = j.legs[i + 1]
                    const w = next ? j.walks[i] : null
                    return (
                      <li key={l.tripId + i} className="text-base leading-relaxed text-slate-800 dark:text-slate-100">
                        <div>
                          <b className="tabular-nums">{hm(l.depSec)}</b> {stopById.get(l.fromStop)?.name} で乗る
                        </div>
                        <div className="ml-3 border-l-4 pl-3 text-sm text-slate-600 dark:text-slate-300" style={{ borderColor: colorOf.get(l.route) ?? '#64748b' }}>
                          {r?.name}（{r?.agency}）{dest(l.headsign)}{l.stopsBetween > 0 ? `・途中${l.stopsBetween}停留所` : ''}
                        </div>
                        <div>
                          <b className="tabular-nums">{hm(l.arrSec)}</b> {stopById.get(l.toStop)?.name} で降りる
                        </div>
                        {next ? (
                          <div className="my-1 rounded bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                            🔁 乗り換え：{w ? `${stopById.get(w.toStop)?.name} まで歩いて約${Math.max(1, w.minutes)}分（約${w.meters}m）・` : '同じバス停で・'}
                            次のバスまで {Math.max(0, Math.round((next.depSec - l.arrSec) / 60))}分
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">時刻表どおりの計算です。バスが遅れると、乗り換えに間に合わないことがあります。きょう運行する便で調べています。歩く乗り換えは、まっすぐ測った距離です。</p>
      </section>

      <section ref={panelEl} aria-label="バス停の時刻表" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {favs.length ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">よく使うバス停</div>
            <div className="flex flex-wrap gap-2">
              {favs.map((n) => (
                <button key={n} type="button" className={chip(stopName === n)} onClick={() => pickStop(n)}>
                  ★ {n}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
          バス停をえらぶ
          <select
            className="mt-1 block min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-950"
            value={stopName ?? ''}
            onChange={(e) => pickStop(e.target.value)}
          >
            <option value="">（地図の白い丸を押すか、ここからえらぶ）</option>
            {stopNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {stopName ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{stopName}</h3>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700"
                onClick={() => favWrite(isFav ? favs.filter((n) => n !== stopName) : [stopName, ...favs])}
              >
                {isFav ? '★ よく使うバス停から外す' : '☆ よく使うバス停に入れる'}
              </button>
            </div>
            {net?.stops.some((x) => x.name === stopName && x.approx) ? (
              <p className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">📍 このバス停の地図上の位置は、おおよそです（新しいバス停で、正確な位置のデータがまだありません）。時刻は市の時刻表のとおりです。</p>
            ) : null}
            {upcoming.length ? (
              <ul className="space-y-2">
                {(showAll ? upcoming : upcoming.slice(0, 3)).map((d) => {
                  const min = Math.max(0, Math.floor((d.sec - nowSec) / 60))
                  return (
                    <li key={d.key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <span className="w-16 shrink-0 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{hm(d.sec)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold text-slate-900 dark:text-slate-100">{dest(d.headsign)}</span>
                        <span className="block text-sm text-slate-600 dark:text-slate-300">
                          <span aria-hidden className="mr-1 inline-block h-3 w-3 rounded-full align-middle" style={{ background: d.route ? colorOf.get(d.route.id) : '#64748b' }} />
                          {d.route?.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-base font-bold text-sky-700 dark:text-sky-300">{min === 0 ? 'まもなく' : `あと${min}分`}</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-base text-slate-700 dark:text-slate-200">きょうは、このあとのバスはありません。</p>
            )}
            {upcoming.length > 3 ? (
              <button type="button" className="min-h-11 w-full rounded-lg border border-slate-300 text-base font-semibold dark:border-slate-700" onClick={() => setShowAll((v) => !v)}>
                {showAll ? '次の3本だけにする' : `このあとのバスを全部見る（${upcoming.length}本）`}
              </button>
            ) : null}
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">時刻表どおりの時刻です。道路の混み具合で遅れることがあります。きょう運行する便だけを出しています。</p>
          </div>
        ) : null}
      </section>

      {net ? (
        <section aria-label="バス会社の連絡先" className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <h3 className="font-semibold">バス会社に聞く</h3>
          <ul className="space-y-1">
            {groups.map((g) => {
              const r = g.routes[0]
              const tel = telShow(r.agencyTel)
              return (
                <li key={g.agency}>
                  {g.agency}
                  {tel ? (
                    <a href={`tel:${tel}`} className="ml-2 font-semibold text-sky-700 underline dark:text-sky-300">
                      📞 {tel}
                    </a>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            データ：{net.sources.map((x) => `${x.publisher}（${x.start.slice(0, 4)}年${Number(x.start.slice(4, 6))}月${Number(x.start.slice(6, 8))}日からの時刻）`).join('、')}／バス停の位置：国土数値情報（バス停留所・国土交通省）ほか／{net.builtAt} 取りこみ
          </p>
        </section>
      ) : null}
    </div>
  )
}
