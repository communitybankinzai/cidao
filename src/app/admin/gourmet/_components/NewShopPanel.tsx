'use client'

// 食レポの候補：地図にないお店を足して、そのまま承認する小窓（2026-11-13）。
// 位置は運営が確かめる：住所から探す（国土地理院）→ 地図のピンを動かす → 位置を決めるまで確定できない。
// 地図は食レポマップと同じ Leaflet（CDN）と国土地理院の標準地図。範囲（印西市＋周辺6市町）の検査はサーバー側で行う。
import { useEffect, useRef, useState, useTransition } from 'react'
import { addShopAndApproveAction } from '../actions'

const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_IMAGES = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/'
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
const CENTER: [number, number] = [35.8, 140.13] // 千葉ニュータウンのあたり

type LatLng = { lat: number; lng: number }
type LMap = { invalidateSize(): unknown; setView(c: [number, number], z: number): unknown; on(ev: string, fn: (e: { latlng: LatLng }) => void): unknown; remove(): void; getZoom(): number }
type LMarker = { setLatLng(c: [number, number]): unknown; on(ev: string, fn: () => void): unknown; getLatLng(): LatLng; addTo(m: LMap): LMarker }
type LNs = {
  map(el: HTMLElement): LMap
  tileLayer(url: string, o?: object): { addTo(m: LMap): unknown }
  marker(c: [number, number], o?: object): LMarker
  Icon: { Default: { mergeOptions(o: object): void } }
}
declare global { interface Window { L?: LNs } }

let leafletPromise: Promise<LNs> | null = null
function loadLeaflet(): Promise<LNs> {
  if (window.L) return Promise.resolve(window.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise<LNs>((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = LEAFLET_CSS
      document.head.appendChild(l)
    }
    const s = document.createElement('script')
    s.src = LEAFLET_JS
    s.onload = () => (window.L ? resolve(window.L) : reject(new Error('地図を読めません')))
    s.onerror = () => reject(new Error('地図を読めません'))
    document.head.appendChild(s)
  })
  leafletPromise.catch(() => { leafletPromise = null })
  return leafletPromise
}

type Hit = { title: string; lat: number; lon: number }
async function searchAddress(q: string): Promise<Hit[]> {
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error('住所を検索できませんでした')
  const j = (await res.json()) as Array<{ geometry: { coordinates: [number, number] }; properties: { title: string } }>
  return j.slice(0, 6).map((x) => ({ title: x.properties.title, lat: x.geometry.coordinates[1], lon: x.geometry.coordinates[0] }))
}

type Pin = { lat: number; lon: number; recenter: boolean }

export function NewShopPanel(p: { candidateId: string; index: number; initialName: string; onClose: () => void }) {
  const [name, setName] = useState(p.initialName)
  const [address, setAddress] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [pin, setPin] = useState<Pin | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const mapEl = useRef<HTMLDivElement>(null)
  const ref = useRef<{ L: LNs; map: LMap; marker: LMarker | null } | null>(null)

  // 地図を作る（一度だけ）
  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    loadLeaflet().then((L) => {
      if (cancelled || !mapEl.current) return
      L.Icon.Default.mergeOptions({ imagePath: LEAFLET_IMAGES })
      const map = L.map(mapEl.current)
      map.setView(CENTER, 12)
      L.tileLayer(TILE_URL, { maxZoom: 18, attribution: '地理院タイル' }).addTo(map)
      map.on('click', (e) => setPin({ lat: e.latlng.lat, lon: e.latlng.lng, recenter: false }))
      ref.current = { L, map, marker: null }
      // 小窓を開いた直後は大きさが決まりきっていないので、大きさが変わるたびに地図を合わせ直す（タイルが一部しか出ない対策）
      ro = new ResizeObserver(() => map.invalidateSize())
      ro.observe(mapEl.current)
      setMapReady(true)
    }).catch((e) => setMsg(e instanceof Error ? e.message : '地図を読めません'))
    return () => { cancelled = true; ro?.disconnect(); ref.current?.map.remove(); ref.current = null }
  }, [])

  // ピンの位置を地図に反映（ドラッグで動かしたときは、もう合っているので何も変わらない）
  useEffect(() => {
    const r = ref.current
    if (!r || !mapReady || !pin) return
    if (!r.marker) {
      r.marker = r.L.marker([pin.lat, pin.lon], { draggable: true }).addTo(r.map)
      r.marker.on('dragend', () => {
        const q = r.marker!.getLatLng()
        setPin({ lat: q.lat, lon: q.lng, recenter: false })
      })
    } else r.marker.setLatLng([pin.lat, pin.lon])
    if (pin.recenter) r.map.setView([pin.lat, pin.lon], 17)
  }, [pin, mapReady])

  const search = () => start(async () => {
    setMsg(null)
    try {
      const q = address.trim()
      if (!q) { setMsg('住所を入れてください（例：印西市牧の原2丁目）'); return }
      const r = await searchAddress(q)
      setHits(r)
      if (r.length === 0) setMsg('見つかりませんでした。地図をタップしてピンを置いてください')
      else if (r.length === 1) setPin({ lat: r[0].lat, lon: r[0].lon, recenter: true })
    } catch (e) { setMsg(e instanceof Error ? e.message : '検索できませんでした') }
  })

  const confirm = () => start(async () => {
    if (!pin) return
    const r = await addShopAndApproveAction(p.candidateId, p.index, { name, address, lat: pin.lat, lon: pin.lon })
    setMsg(r.message)
    if (r.ok) p.onClose()
  })

  return (
    <div className="w-full space-y-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3">
      <p className="text-xs text-slate-500">お店の位置を、元の投稿やお店の公式の情報で確かめてから決めてください。位置を決めるまで確定できません。</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">お店の名前
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="ml-1 w-56 rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">住所
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={100} placeholder="印西市牧の原2丁目" className="ml-1 w-56 rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
        </label>
        <button type="button" disabled={pending} onClick={search} className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs">住所から位置を探す</button>
      </div>
      {hits && hits.length > 1 && (
        <ul className="flex flex-wrap gap-1 text-xs">
          {hits.map((h, i) => (
            <li key={i}><button type="button" onClick={() => setPin({ lat: h.lat, lon: h.lon, recenter: true })} className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800">{h.title}</button></li>
          ))}
        </ul>
      )}
      <div ref={mapEl} className="h-64 w-full rounded border border-slate-200 dark:border-slate-700 z-0" />
      <p className="text-xs text-slate-500">{pin ? `位置：${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}（ピンをドラッグ、または地図をタップで動かせます）` : '位置は未決定です（住所から探すか、地図をタップしてピンを置いてください）'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || !pin || !name.trim()} onClick={confirm} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">この位置で地図に足して承認</button>
        <button type="button" disabled={pending} onClick={p.onClose} className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm">閉じる</button>
        {msg && <span className="text-xs text-slate-600 dark:text-slate-300">{msg}</span>}
      </div>
    </div>
  )
}
