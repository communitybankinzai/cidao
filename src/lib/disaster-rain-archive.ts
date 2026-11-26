// 雨の記録を控える（2026-11-26）。/api/disaster/rain-archive が毎時呼ぶ。
//
// 1. 雨雲レーダー（気象庁 高解像度降水ナウキャスト hrpns）の実況の画像を、色から雨の強さの区分に戻し、
//    印西周辺の約1kmごと（0.01度）に disaster_radar_rain へ貯める。気象庁には過去3時間ぶんしか残らないので、
//    毎時呼べば取りこぼさない（呼び出しが2時間遅れても間に合う）。
// 2. アメダスの10分値を disaster_amedas_10min へ貯める（scripts/amedas-backup.py と同じ中身。
//    PC の定期実行が新しい PC へ移していなかったため 11/20〜26 に止まっていた。ここへ移した）。
//
// ⚠ レーダーの値は色の区分（8段階）で、正確な雨量ではない。区分のまま貯め、代表値は使う側で決める。

import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'

const UA = 'cbi-inzai-disaster-map/1.0 (+https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/)'

// ---------------------------------------------------------------- レーダー

export const RADAR_GRID = {
  version: 'inzai-0.01deg-v1',
  north: 35.92,
  south: 35.70,
  west: 140.0,
  east: 140.36,
  step: 0.01,
}
export const RADAR_ROWS = Math.round((RADAR_GRID.north - RADAR_GRID.south) / RADAR_GRID.step) // 22
export const RADAR_COLS = Math.round((RADAR_GRID.east - RADAR_GRID.west) / RADAR_GRID.step) // 36
const RADAR_ZOOM = 10 // 気象庁の配信の最大の細かさ（地図の表示も maxNativeZoom 10）

// 気象庁の凡例の色（2026-11-26 に全国の実際の画像から集めた8色と完全一致）
export const RADAR_CLASSES: { rgb: [number, number, number]; label: string; mid: number }[] = [
  { rgb: [242, 242, 255], label: '1mm/h未満', mid: 0.5 },
  { rgb: [160, 210, 255], label: '1〜5mm/h', mid: 3 },
  { rgb: [33, 140, 255], label: '5〜10mm/h', mid: 7.5 },
  { rgb: [0, 65, 255], label: '10〜20mm/h', mid: 15 },
  { rgb: [250, 245, 0], label: '20〜30mm/h', mid: 25 },
  { rgb: [255, 153, 0], label: '30〜50mm/h', mid: 40 },
  { rgb: [255, 40, 0], label: '50〜80mm/h', mid: 65 },
  { rgb: [180, 0, 104], label: '80mm/h以上', mid: 80 },
]

/** 画素の色 → 区分（1〜8）。透明は0。凡例にない色（境界のにじみなど）は最も近い色、遠すぎれば0 */
export function classOfPixel(r: number, g: number, b: number, a: number): number {
  if (a < 128) return 0
  let best = 0
  let bestD = Infinity
  RADAR_CLASSES.forEach((c, i) => {
    const d = Math.abs(c.rgb[0] - r) + Math.abs(c.rgb[1] - g) + Math.abs(c.rgb[2] - b)
    if (d < bestD) {
      bestD = d
      best = i + 1
    }
  })
  return bestD <= 60 ? best : 0
}

function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const rad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  return { x, y }
}

/** 升目の中心（行・列）。行は北から、列は西から */
export function cellCenter(row: number, col: number) {
  return {
    lat: RADAR_GRID.north - (row + 0.5) * RADAR_GRID.step,
    lon: RADAR_GRID.west + (col + 0.5) * RADAR_GRID.step,
  }
}

type Frame = { basetime: string; validtime: string }

/** 気象庁の時刻（YYYYMMDDhhmmss・UTC）→ ISO */
export function jmaTimeToIso(t: string) {
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00Z`
}

async function fetchTile(frame: Frame, x: number, y: number) {
  const url = `https://www.jma.go.jp/bosai/jmatile/data/nowc/${frame.basetime}/none/${frame.validtime}/surf/hrpns/${RADAR_ZOOM}/${x}/${y}.png`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  if (res.status === 404) return null // その範囲にデータが無い（気象庁はこの範囲を常に配信しているので、実際は起きない想定）
  if (!res.ok) throw new Error(`レーダー画像 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** 1つの時刻の画像を読み、雨の降っていた升目を {"行,列": 区分} で返す */
export async function readRadarFrame(frame: Frame) {
  const nw = tileXY(RADAR_GRID.north, RADAR_GRID.west, RADAR_ZOOM)
  const se = tileXY(RADAR_GRID.south, RADAR_GRID.east, RADAR_ZOOM)
  const tiles = new Map<string, Awaited<ReturnType<typeof fetchTile>>>()
  for (let tx = Math.floor(nw.x); tx <= Math.floor(se.x); tx++) {
    for (let ty = Math.floor(nw.y); ty <= Math.floor(se.y); ty++) {
      tiles.set(`${tx}/${ty}`, await fetchTile(frame, tx, ty))
    }
  }
  const cells: Record<string, number> = {}
  let maxClass = 0
  for (let row = 0; row < RADAR_ROWS; row++) {
    for (let col = 0; col < RADAR_COLS; col++) {
      const c = cellCenter(row, col)
      const p = tileXY(c.lat, c.lon, RADAR_ZOOM)
      const tile = tiles.get(`${Math.floor(p.x)}/${Math.floor(p.y)}`)
      if (!tile) continue
      const px = Math.min(tile.width - 1, Math.floor((p.x - Math.floor(p.x)) * tile.width))
      const py = Math.min(tile.height - 1, Math.floor((p.y - Math.floor(p.y)) * tile.height))
      const i = (py * tile.width + px) * tile.channels
      const k = classOfPixel(tile.data[i], tile.data[i + 1], tile.data[i + 2], tile.data[i + 3])
      if (k > 0) {
        cells[`${row},${col}`] = k
        if (k > maxClass) maxClass = k
      }
    }
  }
  return { cells, maxClass, wetCells: Object.keys(cells).length }
}

/** 気象庁に残っている実況（過去3時間）のうち、10分ちょうどの時刻で、まだ貯めていないものを貯める */
export async function archiveRadar(supabase: SupabaseClient) {
  const res = await fetch('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json', {
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`レーダーの時刻一覧 HTTP ${res.status}`)
  const list = (await res.json()) as (Frame & { elements?: string[] })[]
  const frames = list.filter(
    // 実況（basetime＝validtime）で、分が10の倍数のもの（5分ごとの配信を10分ごとに間引く）
    (f) => f.basetime === f.validtime && !!f.elements?.includes('hrpns') && Number(f.validtime.slice(10, 12)) % 10 === 0,
  )
  if (!frames.length) throw new Error('レーダーの実況の時刻が見つかりません')

  const isoList = frames.map((f) => jmaTimeToIso(f.validtime))
  const { data: have, error } = await supabase.from('disaster_radar_rain').select('observed_at').in('observed_at', isoList)
  if (error) throw new Error(`控えの確認に失敗: ${error.message}`)
  const haveSet = new Set((have ?? []).map((r) => new Date(r.observed_at as string).toISOString()))

  let saved = 0
  let wetFrames = 0
  for (const f of frames) {
    const iso = jmaTimeToIso(f.validtime)
    if (haveSet.has(new Date(iso).toISOString())) continue
    const r = await readRadarFrame(f)
    const { error: upErr } = await supabase.from('disaster_radar_rain').upsert(
      { observed_at: iso, cells: r.cells, wet_cells: r.wetCells, max_class: r.maxClass, grid: RADAR_GRID.version },
      { onConflict: 'observed_at', ignoreDuplicates: true },
    )
    if (upErr) throw new Error(`レーダーの控えの保存に失敗: ${upErr.message}`)
    saved++
    if (r.wetCells) wetFrames++
  }
  return {
    available: frames.length,
    saved,
    wetFrames,
    oldest: isoList[isoList.length - 1] ?? null,
    newest: isoList[0] ?? null,
  }
}

// ---------------------------------------------------------------- アメダス

// scripts/amedas-backup.py の STATIONS と同じ（2026-09-25 に選んだ印旛地区周辺の雨量の観測所）
export const AMEDAS_ARCHIVE_STATIONS = ['45061', '45116', '45121', '45106', '45212', '40426', '45081', '45181']

/** アメダスの値は [数値, 品質フラグ]。フラグ0が正常値で、それ以外は採らない */
export function amedasValue(row: Record<string, unknown>, name: string): number | null {
  const x = row[name]
  if (Array.isArray(x) && x.length >= 2 && x[1] === 0) {
    const n = Number(x[0])
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 3時間ごとのファイル名の時刻（日本時間の 00/03/…/21 時）。新しい順に count 個 */
export function amedasFileTimes(now: Date, count: number) {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000)
  const base = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), Math.floor(jst.getUTCHours() / 3) * 3))
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const t = new Date(base.getTime() - i * 3 * 3600 * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    out.push(`${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}_${p(t.getUTCHours())}`)
  }
  return out
}

/** 直近 files 個（1個＝3時間）のファイルを貯める。毎時呼ぶなら 3（9時間ぶん）で取りこぼしに余裕がある */
export async function archiveAmedas(supabase: SupabaseClient, now = new Date(), files = 3) {
  const rows: Record<string, unknown>[] = []
  let misses = 0
  for (const code of AMEDAS_ARCHIVE_STATIONS) {
    for (const name of amedasFileTimes(now, files)) {
      const res = await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${code}/${name}.json`, {
        headers: { 'User-Agent': UA },
        cache: 'no-store',
      })
      if (res.status === 404) {
        misses++
        continue
      }
      if (!res.ok) throw new Error(`アメダス ${code} HTTP ${res.status}`)
      const data = (await res.json()) as Record<string, Record<string, unknown>>
      for (const [key, row] of Object.entries(data)) {
        const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(key)
        if (!m) continue
        // キーは日本時間
        const observed = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`).toISOString()
        rows.push({
          station_id: code,
          observed_at: observed,
          r10_mm: amedasValue(row, 'precipitation10m'),
          r1h_mm: amedasValue(row, 'precipitation1h'),
          r3h_mm: amedasValue(row, 'precipitation3h'),
          r24h_mm: amedasValue(row, 'precipitation24h'),
        })
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('disaster_amedas_10min')
      .upsert(rows.slice(i, i + 500), { onConflict: 'station_id,observed_at' })
    if (error) throw new Error(`アメダスの控えの保存に失敗: ${error.message}`)
  }
  return { rows: rows.length, misses }
}
