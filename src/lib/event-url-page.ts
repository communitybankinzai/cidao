// サイト URL からの読み取り（/api/events/scan-url）で、ページの HTML から
// 「AI に渡す本文」と「本文の中のチラシ画像」を取り出す。外部ライブラリなしの素朴な処理。
//
// 2026-11-27：印西市立図書館のページ（3つの館のクリスマス会）が「イベント0件」になった。
// 取り出した 1,351 文字のうち催しの説明は約300文字で、残りはメニューが2回分だった。
// → ヘッダー・メニュー・フッターを先に外す。あわせて、本文中の画像に番号の印を付け、
//   AI が「どの催しのチラシか」を番号で答えられるようにする。

import { toAbsoluteSafe } from '@/lib/url-guard'

export type PageImage = {
  /** 絶対 URL（安全確認済み） */
  url: string
  /** ファイル名（日本語は読める形に戻す） */
  name: string
  alt: string
}

export type ExtractedPage = {
  /** AI に渡す本文。画像の位置には「[画像0: ファイル名]」の印が入る */
  text: string
  images: PageImage[]
}

const MAX_IMAGES = 8

// 飾り・部品の画像（ロゴ・ボタン・アイコンなど）。チラシの候補にしない
const DECORATION_RE = /(^|[\/_.-])(logo|icon|btn|button|banner|bnr|spacer|arrow|bg|sprite|loading|avatar|emoji)([\/_.-]|\d|$)/i
const PHOTO_EXT_RE = /\.(jpe?g|png|webp|gif)$/i

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return decodeEntities((m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim())
}

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    try {
      return decodeURIComponent(last)
    } catch {
      return last
    }
  } catch {
    return ''
  }
}

/** メニュー・ヘッダー・フッターなど、本文でない部分を外す */
function stripChrome(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
}

function toText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|td|th|dd|dt|h[1-6]|section|article|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/**
 * HTML から本文と画像を取り出す。
 * 本文を外しすぎて短くなったとき（本文まで header などに入っているページ）は、外さない版に戻す。
 */
export function extractPage(html: string, base: URL, minChars = 50): ExtractedPage {
  const run = (source: string): ExtractedPage => {
    const images: PageImage[] = []
    const seen = new Set<string>()
    const marked = source.replace(/<img\b[^>]*>/gi, (tag) => {
      const src = attr(tag, 'src') || attr(tag, 'data-src')
      if (!src || src.startsWith('data:')) return ' '
      const url = toAbsoluteSafe(src, base)
      if (!url) return ' '
      let path = ''
      try {
        path = new URL(url).pathname
      } catch {
        return ' '
      }
      if (!PHOTO_EXT_RE.test(path) || DECORATION_RE.test(path)) return ' '
      // 幅・高さが小さいと書いてある画像は部品
      const w = Number(attr(tag, 'width'))
      const h = Number(attr(tag, 'height'))
      if ((w > 0 && w < 120) || (h > 0 && h < 120)) return ' '
      const alt = attr(tag, 'alt')
      const name = fileName(url)
      let idx = images.findIndex((i) => i.url === url)
      if (idx < 0) {
        if (seen.size >= MAX_IMAGES) return ' '
        seen.add(url)
        idx = images.push({ url, name, alt }) - 1
      }
      return ` [画像${idx}: ${name}${alt ? `／${alt}` : ''}] `
    })
    return { text: toText(marked), images }
  }

  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const stripped = run(stripChrome(html))
  if (stripped.text.length >= minChars) return stripped
  return run(noScripts)
}

/** AI が答えた画像の番号を URL に直す。範囲外・番号なしは null */
export function flyerUrlAt(images: PageImage[], index: unknown): string | null {
  if (typeof index !== 'number' || !Number.isInteger(index)) return null
  return images[index]?.url ?? null
}
