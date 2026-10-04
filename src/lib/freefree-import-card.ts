// 取込掲載（OpenPOI由来・写真なし）の SNS 用画像カード（JPEG・1080x1350 = 4:5）を作る。
//
// 方針（2026-10-03 運営決定）: お店の写真は無断で使わない。お店から写真が届くまでは、
//   店名・エリア・カテゴリー・地図・お店の方への呼びかけのカードで代用する。
// 地図は国土地理院の標準地図タイル（出典「国土地理院」を画像に明記）。取れなければ地図なしで作る。
// 他のモジュールを import しない（パッケージのみ）。画像の見た目を node だけで確認できるようにするため。

import { createElement as h } from 'react'

export const CARD_W = 1080
export const CARD_H = 1350

export type CardInput = {
  name: string
  categoryLabel: string
  accent: string        // カテゴリーの色
  area: string | null   // 「印西市武西」
  lat: number | null
  lon: number | null
}

const NAVY = '#1e3a5f'
const YELLOW = '#f0c040'
const MAP_W = 952
const MAP_H = 560
const Z = 17
const TILE = 256
const COLS = 4
const ROWS = 3

async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`
    const css = await (await fetch(cssUrl)).text()
    const m = css.match(/src:\s*url\((https:[^)]+)\)\s*format\('(?:opentype|truetype)'\)/)
    if (!m) return null
    return await (await fetch(m[1])).arrayBuffer()
  } catch {
    return null
  }
}

// 緯度経度 → タイル座標（小数）
function toTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const rad = (lat * Math.PI) / 180
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n }
}

/** 地理院タイルを並べて、ピンを中心に近い 952x560 の地図（PNG）を作る。失敗したら null */
export async function buildMapPng(lat: number, lon: number): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default
    const t = toTile(lat, lon, Z)
    const tx0 = Math.floor(t.x) - 2
    const ty0 = Math.floor(t.y) - 1
    const jobs: Promise<{ input: Buffer; left: number; top: number }>[] = []
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const url = `https://cyberjapandata.gsi.go.jp/xyz/std/${Z}/${tx0 + c}/${ty0 + r}.png`
        jobs.push(
          fetch(url, { signal: AbortSignal.timeout(8000) }).then(async (res) => {
            if (!res.ok) throw new Error(`tile ${res.status}`)
            return { input: Buffer.from(await res.arrayBuffer()), left: c * TILE, top: r * TILE }
          }),
        )
      }
    }
    const tiles = await Promise.all(jobs)
    const px = (t.x - tx0) * TILE
    const py = (t.y - ty0) * TILE
    const left = Math.round(Math.min(Math.max(px - MAP_W / 2, 0), COLS * TILE - MAP_W))
    const top = Math.round(Math.min(Math.max(py - MAP_H / 2, 0), ROWS * TILE - MAP_H))
    const pinX = Math.round(px - left)
    const pinY = Math.round(py - top)
    const pin = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_W}" height="${MAP_H}">` +
        `<circle cx="${pinX}" cy="${pinY}" r="26" fill="rgba(229,57,53,0.25)"/>` +
        `<circle cx="${pinX}" cy="${pinY}" r="15" fill="#e53935" stroke="#ffffff" stroke-width="5"/></svg>`,
    )
    return await sharp({ create: { width: COLS * TILE, height: ROWS * TILE, channels: 3, background: '#ffffff' } })
      .composite(tiles)
      .png()
      .toBuffer()
      .then((full) =>
        sharp(full)
          .extract({ left, top, width: MAP_W, height: MAP_H })
          .composite([{ input: pin }])
          .png()
          .toBuffer(),
      )
  } catch (e) {
    console.error('[freefree-import-card] map failed:', e instanceof Error ? e.message : e)
    return null
  }
}

/** カード本体（JPEG）。フォントが取れなければ null（呼び出し側で 503 などにする） */
export async function renderImportCard(input: CardInput): Promise<Buffer | null> {
  const heading = 'CiDAOに載りました'
  const callTitle = 'お店の方へ'
  const call1 = '写真・PR文・クーポンを、ご自身で載せられます'
  const call2 = 'CiDAOに登録（無料）してください'
  const credit = '地図：地理院タイルを加工して作成（国土地理院）'
  const brand = 'CiDAO - 印西の市民DAO'
  const font = await loadFont([heading, callTitle, call1, call2, credit, brand, input.name, input.categoryLabel, input.area ?? ''].join(''))
  if (!font) return null

  const mapPng = input.lat != null && input.lon != null ? await buildMapPng(input.lat, input.lon) : null
  const satori = (await import('satori')).default
  const sharp = (await import('sharp')).default

  const name = input.name
  const nameSize = name.length > 22 ? 62 : name.length > 14 ? 76 : 92

  const children = [
    h('div', { key: 'top', style: { display: 'flex', alignItems: 'center', gap: '20px' } },
      h('div', { style: { width: '18px', height: '52px', backgroundColor: YELLOW, borderRadius: '4px' } }),
      h('div', { style: { fontSize: '44px', opacity: 0.95 } }, heading)),
    h('div', { key: 'name', style: { display: 'flex', flexDirection: 'column', gap: '26px' } },
      h('div', { style: { fontSize: `${nameSize}px`, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-all' } }, name),
      h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center' } },
        h('div', { style: { display: 'flex', fontSize: '32px', backgroundColor: input.accent, color: '#ffffff', borderRadius: '9999px', padding: '8px 28px' } }, input.categoryLabel),
        input.area ? h('div', { style: { display: 'flex', fontSize: '34px', opacity: 0.95 } }, input.area) : null)),
    mapPng
      ? h('div', { key: 'map', style: { display: 'flex', position: 'relative', width: `${MAP_W}px`, height: `${MAP_H}px`, borderRadius: '20px', overflow: 'hidden' } },
          h('img', { src: `data:image/png;base64,${mapPng.toString('base64')}`, width: MAP_W, height: MAP_H }),
          h('div', { style: { position: 'absolute', right: '0px', bottom: '0px', display: 'flex', fontSize: '20px', color: '#333333', backgroundColor: 'rgba(255,255,255,0.85)', padding: '4px 12px' } }, credit))
      : null,
    h('div', { key: 'call', style: { display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: '20px', padding: '26px 34px' } },
      h('div', { style: { fontSize: '30px', color: YELLOW } }, callTitle),
      h('div', { style: { fontSize: '35px', fontWeight: 700 } }, call1),
      h('div', { style: { fontSize: '28px', opacity: 0.95 } }, call2)),
    h('div', { key: 'brand', style: { display: 'flex', fontSize: '26px', opacity: 0.8 } }, brand),
  ].filter(Boolean)

  const svg = await satori(
    h('div', { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', backgroundColor: NAVY, color: '#ffffff', padding: '64px', fontFamily: 'NotoSansJP' } }, ...children),
    { width: CARD_W, height: CARD_H, fonts: [{ name: 'NotoSansJP', data: font, weight: 700, style: 'normal' }] },
  )
  return await sharp(Buffer.from(svg)).flatten({ background: NAVY }).jpeg({ quality: 88 }).toBuffer()
}

// 写真つき掲載の Instagram 画像の上に付ける見出しの帯。プロフィールの一覧で何の投稿か分かるようにする
export const HEADLINE_BAND_H = 300
const HEADLINE_LABEL = 'FreeFree 地域応援掲示板'
const HEADLINE_MAX_CHARS = 44

/** 見出しの帯（PNG・1080x300）。フォントが取れなければ null（呼び出し側は帯なしで続ける） */
export async function renderHeadlineBand(title: string): Promise<Buffer | null> {
  const chars = Array.from(title.trim())
  const text = chars.length > HEADLINE_MAX_CHARS ? `${chars.slice(0, HEADLINE_MAX_CHARS - 1).join('')}…` : chars.join('')
  const font = await loadFont(HEADLINE_LABEL + text)
  if (!font) return null
  const size = chars.length <= 14 ? 84 : chars.length <= 24 ? 68 : 56
  const satori = (await import('satori')).default
  const sharp = (await import('sharp')).default
  const svg = await satori(
    h('div', { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '14px', backgroundColor: NAVY, color: '#ffffff', padding: '0px 48px', fontFamily: 'NotoSansJP' } },
      h('div', { key: 'label', style: { display: 'flex', fontSize: '30px', color: YELLOW } }, HEADLINE_LABEL),
      h('div', { key: 'title', style: { display: 'flex', fontSize: `${size}px`, fontWeight: 700, lineHeight: 1.25, wordBreak: 'break-all' } }, text)),
    { width: CARD_W, height: HEADLINE_BAND_H, fonts: [{ name: 'NotoSansJP', data: font, weight: 700, style: 'normal' }] },
  )
  return await sharp(Buffer.from(svg)).flatten({ background: NAVY }).png().toBuffer()
}
