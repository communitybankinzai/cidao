// サイト URL から読んだ複数の催しを、まとめて登録するときの「受け取った内容の検査」（2026-11-27）。
// 画面（ImageScanField）から届く値は信用せず、ここで形をそろえてから登録する。

export const SCAN_BULK_MAX = 20

export type ScanBulkItem = {
  title: string
  description: string
  /** 'YYYY-MM-DDTHH:MM'（日本時間の壁掛け時計） */
  start_at: string
  end_at: string
  /** 終了時刻は未定（ページに終了の記載が無い） */
  end_time_unknown: boolean
  location?: string
  online_flag: boolean
  capacity?: number
  fee?: number
  category?: string
  /** AI が読んだ主催者名。無ければ空 */
  organizer_name?: string
  /** event-flyers に写したあとの画像の URL。自分たちの保管場所のものだけ通す */
  flyer_image_url?: string
}

export type ScanBulkCheck = { ok: true; items: ScanBulkItem[] } | { ok: false; error: string }

const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function nonNegInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000_000 ? v : undefined
}

/**
 * @param storageBase 自分たちの保管場所の公開 URL の先頭（例: https://xxxx.supabase.co/storage/v1/object/public/event-flyers/）
 * @param categoryKeys 使える分野のキー
 */
export function checkScanBulkItems(raw: unknown, storageBase: string, categoryKeys: readonly string[]): ScanBulkCheck {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: '登録する催しが選ばれていません' }
  if (raw.length > SCAN_BULK_MAX) return { ok: false, error: `まとめて登録できるのは${SCAN_BULK_MAX}件までです` }

  const items: ScanBulkItem[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>
    const no = `${i + 1}件目`
    const title = str(r.title, 120)
    if (!title) return { ok: false, error: `${no}：題名がありません` }
    const start_at = str(r.start_at, 16)
    const end_time_unknown = r.end_time_unknown === true
    // 未定のときは、終了日時が無くても通す（保存のときに開始の1時間後を入れる）
    const end_at = str(r.end_at, 16) || (end_time_unknown ? start_at : '')
    if (!LOCAL_RE.test(start_at)) return { ok: false, error: `${no}「${title}」：開始日時が読み取れていません。1件ずつ反映して、日時を入れてから登録してください` }
    if (!LOCAL_RE.test(end_at)) return { ok: false, error: `${no}「${title}」：終了日時が読み取れていません。1件ずつ反映して、日時を入れてから登録してください` }
    if (end_at < start_at) return { ok: false, error: `${no}「${title}」：終了が開始より前になっています` }

    const flyer = str(r.flyer_image_url, 500)
    const category = str(r.category, 40)
    items.push({
      title,
      description: str(r.description, 4000) || title,
      start_at,
      end_at,
      end_time_unknown,
      location: str(r.location, 200) || undefined,
      online_flag: r.online_flag === true,
      capacity: nonNegInt(r.capacity),
      fee: nonNegInt(r.fee),
      category: categoryKeys.includes(category) ? category : undefined,
      organizer_name: str(r.organizer_name, 120) || undefined,
      // よその URL をそのまま入れさせない（自分たちの保管場所に写したものだけ）
      flyer_image_url: storageBase && flyer.startsWith(storageBase) ? flyer : undefined,
    })
  }
  return { ok: true, items }
}

/** 全会員への知らせの題名と本文（1通にまとめる） */
export function buildScanBulkNotice(titles: string[]): { title: string; body: string } {
  const n = titles.length
  const head = titles.slice(0, 3).map((t) => `「${t.length > 24 ? `${t.slice(0, 24)}…` : t}」`).join('')
  return {
    title: n === 1 ? `新しいイベント「${titles[0]}」が登録されました` : `新しいイベントが${n}件登録されました`,
    body: n > 3 ? `${head} ほか${n - 3}件` : head,
  }
}
