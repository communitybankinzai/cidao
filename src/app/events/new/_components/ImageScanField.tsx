'use client'

import { useRef, useState } from 'react'
import { FilePickButton } from '@/components/ui/file-pick-button'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { assignQrUrls, type QrPurpose } from '@/lib/flyer-qr'
import { resizeImagePreserveAspect } from '@/lib/image-resize'
import { createEventsFromScan } from '../../actions'

type Occurrence = { start_at: string; end_at: string }

type Extracted = {
  title?: string
  description?: string
  start_at?: string | null
  end_at?: string | null
  end_time_unknown?: boolean
  location?: string | null
  online_flag?: boolean
  organizer_name?: string | null
  capacity?: number | null
  fee?: number | null
  occurrences?: Occurrence[]
  flyer_image_url?: string | null
  category?: string
  qr_purpose?: QrPurpose
  // QR コードから読んだリンク（画面側で読み取って足す）
  form_url?: string | null
  website_url?: string | null
  confidence?: number
  // サイト URL から読んだとき、ページ内にあった「この催しのチラシ」の画像（まだ保存していない。付けるかは本人が決める）
  flyer_source_url?: string | null
}

// チラシの画像から QR コードを読み取る（端末の中だけで行い、どこにも送らない）。
// 小さな QR は全体では読めないことがあるので、全体 → 4分割 → 9分割の順に探す。読めなければ空の配列。
async function readQrCodes(file: File): Promise<string[]> {
  try {
    const { default: jsQR } = await import('jsqr')
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const found: string[] = []
    const scan = (x: number, y: number, cw: number, ch: number) => {
      if (cw < 40 || ch < 40) return
      const img = ctx.getImageData(x, y, cw, ch)
      const r = jsQR(img.data, cw, ch)
      const text = r?.data?.trim()
      if (text && !found.includes(text)) found.push(text)
    }
    scan(0, 0, w, h)
    for (const n of [2, 3]) {
      // 区切りの上にある QR も拾えるよう、半分ずつ重ねてずらす
      const cw = Math.floor(w / n)
      const ch = Math.floor(h / n)
      for (let iy = 0; iy <= (n - 1) * 2; iy++) {
        for (let ix = 0; ix <= (n - 1) * 2; ix++) {
          scan(Math.floor((ix * cw) / 2), Math.floor((iy * ch) / 2), cw, ch)
        }
      }
    }
    return found
  } catch {
    return []
  }
}

// "YYYY-MM-DDTHH:MM" → "YYYY/MM/DD HH:MM"（表示用の軽い整形。パースできなければそのまま返す）
function formatOcc(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  if (!m) return s
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`
}

// notice: AI 抽出が使えなかった等のお知らせ（エラー色ではなくグレー地で表示）
type Status = 'idle' | 'loading' | 'done' | 'notice'

// サーバー（/api/events/scan, /api/events/scan-url）が返す reason ごとの市民向けメッセージ。
// HTTP ステータス番号は表示しない
const REASON_MESSAGES: Record<string, string> = {
  quota: 'AI抽出が一時的に利用できません。お手数ですが下の項目を手入力でご登録ください。',
  busy: 'AIが混み合っています。数分後に再度お試しいただくか、手入力でご登録ください。',
  too_large: '画像サイズが大きすぎます。5MB以下に縮小してからお試しください。',
  parse: 'チラシの読み取りに失敗しました。お手数ですが手入力でご登録ください。',
  fetch: 'ページを取得できませんでした。URLをご確認いただくか、手入力でご登録ください。',
  blocked_url: 'このURLは読み取れません。公開Webページ（http/https）のURLを指定してください。',
  no_events:
    'このページからイベント情報を見つけられませんでした。JavaScriptで表示されるページは読み取れないことがあります。お手数ですが手入力でご登録ください。',
  unknown: 'チラシの読み取りに失敗しました。お手数ですが手入力でご登録ください。',
}

export function ImageScanField({
  initialFlyerUrl = null,
  defaultScan = true,
}: {
  initialFlyerUrl?: string | null
  // 画像を選んだときに AI で内容も読み取るかどうかの初期値。
  // 新規登録は true（自動入力が主目的）、編集画面は false（既にある本文を上書きしないため）。
  defaultScan?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')
  const [flyerUrl, setFlyerUrl] = useState<string | null>(initialFlyerUrl)
  const [dragOver, setDragOver] = useState(false)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [checkedOcc, setCheckedOcc] = useState<boolean[]>([])
  const [urlValue, setUrlValue] = useState('')
  const [candidates, setCandidates] = useState<Extracted[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [scanWithAi, setScanWithAi] = useState(defaultScan)
  // サイト URL から複数の催しを読んだときの、まとめて登録（2026-11-27）
  const [candChecked, setCandChecked] = useState<boolean[]>([])
  const [candFlyer, setCandFlyer] = useState<boolean[]>([])
  const [sourceUrl, setSourceUrl] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDone, setBulkDone] = useState<{ id: string; title: string }[]>([])
  const [bulkError, setBulkError] = useState('')
  // 1件だけ反映したときの、ページ内のチラシ（付けるボタンを出す）
  const [pageFlyer, setPageFlyer] = useState<string | null>(null)
  const [pageFlyerBusy, setPageFlyerBusy] = useState(false)

  // ページ内の画像を、自分たちの保管場所へ写す。写せなければ null
  async function importFlyer(url: string): Promise<string | null> {
    try {
      const res = await fetch('/api/events/import-flyer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string }
      return res.ok && data.ok && data.url ? data.url : null
    } catch {
      return null
    }
  }

  async function attachPageFlyer() {
    if (!pageFlyer) return
    setPageFlyerBusy(true)
    const saved = await importFlyer(pageFlyer)
    setPageFlyerBusy(false)
    if (saved) {
      setFlyerUrl(saved)
      setPageFlyer(null)
    } else {
      setStatus('notice')
      setMessage('ページ内の画像を保存できませんでした。画像を保存してから「チラシ画像を選ぶ」で付けてください。')
    }
  }

  // チェックした催しを、まとめて登録する。主催者は、フォームで選んであればそれを、無ければ読み取った主催者名を使う
  async function handleBulk() {
    const form = inputRef.current?.closest('form')
    const picked = candidates.map((c, i) => ({ c, i })).filter(({ i }) => candChecked[i])
    if (picked.length === 0 || bulkBusy) return
    setBulkBusy(true)
    setBulkError('')
    try {
      const items = []
      let flyerFailed = 0
      for (const { c, i } of picked) {
        let flyer_image_url: string | undefined
        if (c.flyer_source_url && candFlyer[i]) {
          const saved = await importFlyer(c.flyer_source_url)
          if (saved) flyer_image_url = saved
          else flyerFailed++
        }
        items.push({ ...c, flyer_image_url })
      }
      const val = (name: string) =>
        (form?.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? ''
      const res = await createEventsFromScan({
        items,
        organizer_choice: val('organizer_choice') || '__member__',
        organizer_name_text: val('organizer_name_text') || undefined,
        source_url: sourceUrl || undefined,
      })
      if (!res.ok) {
        setBulkError(res.error)
        return
      }
      setBulkDone(res.events)
      setCandidates([])
      setCandChecked([])
      setCandFlyer([])
      setStatus('done')
      setMessage(
        `${res.events.length}件を登録しました。` +
          (flyerFailed > 0 ? `チラシ画像を保存できなかった催しが${flyerFailed}件あります（編集から付けられます）。` : ''),
      )
    } catch {
      setBulkError('登録に失敗しました。通信の状態を確かめて、もう一度お試しください。')
    } finally {
      setBulkBusy(false)
    }
  }

  // 抽出結果1件をフォームへ反映する（画像スキャン・URL スキャン共通）。
  // 複数日程（occurrences）があれば既存の日程チェック UI に流す
  function applyCandidate(d: Extracted, prefix: string, suffix: string) {
    const occ = Array.isArray(d.occurrences) ? d.occurrences : []
    if (occ.length > 1) {
      setOccurrences(occ)
      setCheckedOcc(occ.map(() => true))
    } else {
      setOccurrences([])
      setCheckedOcc([])
    }
    const filled = fillForm(d)
    setStatus('done')
    const pct = Math.round((d.confidence ?? 0) * 100)
    setMessage(`${prefix}（自信度 ${pct}%、${filled}項目に反映）。${suffix}内容を確認してから登録してください。`)
  }

  async function handleUrl() {
    const u = urlValue.trim()
    if (!u) return
    setStatus('loading')
    setMessage('ページを取得 + AI 読み取り中…')
    setCandidates([])
    setSelectedIdx(null)
    setBulkDone([])
    setBulkError('')
    setPageFlyer(null)
    try {
      const res = await fetch('/api/events/scan-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: u }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        reason?: string
        events?: Extracted[]
        source_url?: string
      }
      const events = Array.isArray(data.events) ? data.events : []
      setSourceUrl(data.source_url ?? u)
      if (!res.ok || data.ok === false || events.length === 0) {
        setStatus('notice')
        setMessage(REASON_MESSAGES[data.reason ?? 'unknown'] ?? REASON_MESSAGES.unknown)
        return
      }
      if (events.length === 1) {
        applyCandidate(events[0], '読み取り完了', '')
        setPageFlyer(events[0].flyer_source_url ?? null)
      } else {
        setCandidates(events)
        // 日時まで読めた催しだけ、はじめからチェックを入れる（読めていないものは、1件ずつ反映して直してもらう）
        setCandChecked(events.map((e) => !!e.start_at && (!!e.end_at || !!e.end_time_unknown)))
        setCandFlyer(events.map((e) => !!e.flyer_source_url))
        setStatus('done')
        setMessage(`${events.length}件のイベントを検出しました。まとめて登録するか、1件ずつフォームに反映してください。`)
      }
    } catch {
      setStatus('notice')
      setMessage(REASON_MESSAGES.unknown)
    }
  }

  async function handleFile(file: File) {
    setStatus('loading')
    setMessage(
      scanWithAi
        ? `「${file.name}」をアップロード + AI 読み取り中…`
        : `「${file.name}」をアップロード中…`,
    )
    try {
      // QR コードの読み取りは、アップロードと並行して端末の中で行う（AI を使うときだけ。失敗しても登録は続ける）
      const qrPromise: Promise<string[]> = scanWithAi ? readQrCodes(file) : Promise.resolve([])
      // 送れるのは 5MB まで。カメラで撮ったままの写真は超えることが多いので、大きいときだけ先に縮める
      // （QR コードは上で元の写真から読むので、縮めても読み取りには影響しない）
      let upload: File = file
      if (file.size > 4_500_000) {
        try {
          const r = await resizeImagePreserveAspect(file, { maxEdge: 2400, quality: 0.85, preferWebp: false })
          upload = new File([r.blob], `flyer.${r.extension}`, { type: r.extension === 'webp' ? 'image/webp' : 'image/jpeg' })
        } catch {
          // 縮められなければ元のまま送る（大きすぎるときはサーバーが案内を返す）
        }
      }
      const fd = new FormData()
      fd.append('image', upload)
      // AI を使わないときはサーバー側で抽出を行わない（本文が上書きされず、AI 利用料もかからない）
      if (!scanWithAi) fd.append('skip_ai', '1')
      const res = await fetch('/api/events/scan', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as Extracted & {
        ok?: boolean
        reason?: string
        error?: string
        skipped_ai?: boolean
      }
      // 画像アップロード自体は成功している可能性があるので flyer_image_url が来ていれば反映
      if (data.flyer_image_url) setFlyerUrl(data.flyer_image_url)

      // AI を通していない場合はフォームの他項目に一切触れずに終える
      if (data.skipped_ai) {
        setStatus(data.flyer_image_url ? 'done' : 'notice')
        setMessage(
          data.flyer_image_url
            ? '画像を添付しました。ほかの項目は変更していません。'
            : '画像を保存できませんでした。もう一度お試しください。',
        )
        return
      }
      if (!res.ok || data.ok === false) {
        // AI 抽出は入力補助。失敗してもエラーにせず「お知らせ」として案内し、手入力を促す
        const reason = data.reason ?? (res.status === 413 ? 'too_large' : 'unknown')
        const attached = data.flyer_image_url
          ? '（チラシ画像は添付済みです。そのまま登録できます）'
          : ''
        setStatus('notice')
        setMessage((REASON_MESSAGES[reason] ?? REASON_MESSAGES.unknown) + attached)
        return
      }
      // QR コードのリンクを、申込フォーム／サイトの欄へ（チラシの案内が「申込」なら申込フォームへ）
      const qr = assignQrUrls(await qrPromise, data.qr_purpose)
      const qrNote = qr.form_url
        ? 'QRコードのリンクを「申込フォームリンク」に入れました。'
        : qr.website_url
          ? 'QRコードのリンクを「サイトリンク」に入れました。'
          : data.qr_purpose && data.qr_purpose !== 'none'
            ? 'QRコードは読み取れませんでした。リンクは手で入れてください。'
            : ''
      applyCandidate({ ...data, ...qr }, '保存完了', `チラシ画像はイベントに添付されました。${qrNote}`)
    } catch {
      // 通信断など。エラー表示ではなくお知らせとして手入力を促す
      setStatus('notice')
      setMessage(REASON_MESSAGES.unknown)
    }
  }

  function fillForm(d: Extracted): number {
    const form = inputRef.current?.closest('form')
    if (!form) return 0
    let count = 0
    const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
      const proto = Object.getPrototypeOf(el) as object
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, value)
      else el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const setField = (name: string, value: string | null | undefined) => {
      if (value == null || value === '') return
      const el = form.querySelector(`[name="${name}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null
      if (!el) return
      setNativeValue(el, value)
      count++
    }
    // 「（読み取り失敗）」は反映しない（モデルが意図的に返す sentinel）
    if (d.title && d.title !== '（読み取り失敗）') setField('title', d.title)
    setField('description', d.description)
    setField('start_at', d.start_at ?? undefined)
    setField('end_at', d.end_at ?? undefined)
    // 「終了時刻は未定」のチェック欄を、読み取った結果に合わせる（React の状態が変わるよう click で切り替える）
    const unknownCb = form.querySelector('[name="end_time_unknown"]') as HTMLInputElement | null
    if (unknownCb && unknownCb.checked !== !!d.end_time_unknown) unknownCb.click()
    setField('location', d.location ?? undefined)
    // 分野（AI がチラシから読んだもの。一覧にある値のときだけ）
    if (d.category && PROPOSAL_CATEGORIES.some((c) => c.key === d.category)) setField('category', d.category)
    // QR コードのリンク（すでに入っている欄は上書きしない）
    for (const name of ['form_url', 'website_url'] as const) {
      const cur = (form.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value?.trim()
      if (!cur) setField(name, d[name] ?? undefined)
    }
    if (d.capacity != null) setField('capacity', String(d.capacity))
    if (d.fee != null) setField('fee', String(d.fee))

    if (d.online_flag) {
      const cb = form.querySelector('[name="online_flag"]') as HTMLInputElement | null
      if (cb) {
        cb.checked = true
        cb.dispatchEvent(new Event('change', { bubbles: true }))
        count++
      }
    }

    if (d.organizer_name) {
      const sel = form.querySelector('select[name="organizer_choice"]') as HTMLSelectElement | null
      const target = d.organizer_name.trim()
      let matched = false
      if (sel && target) {
        for (const opt of Array.from(sel.options)) {
          if (opt.value !== '__member__' && opt.value !== '__external__' && opt.text.trim() === target) {
            setNativeValue(sel, opt.value)
            matched = true
            count++
            break
          }
        }
      }
      if (!matched) {
        setField('organizer_choice', '__external__')
        setTimeout(() => {
          const el = form.querySelector('[name="organizer_name_text"]') as HTMLInputElement | null
          if (el) setNativeValue(el, target)
        }, 0)
      }
    }

    return count
  }

  function clearFlyer() {
    setFlyerUrl(null)
    setMessage('')
    setStatus('idle')
    setOccurrences([])
    setCheckedOcc([])
    if (inputRef.current) inputRef.current.value = ''
    if (cameraRef.current) cameraRef.current.value = ''
  }

  const statusColor =
    status === 'done' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'

  return (
    <div className={`bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4 space-y-2 transition-shadow ${status === 'loading' ? 'ring-2 ring-amber-400 dark:ring-amber-600' : ''}`}>
      <input type="hidden" name="flyer_image_url" value={flyerUrl ?? ''} />
      <div
        className={`flex flex-wrap items-center gap-3 rounded border border-dashed p-2 transition-colors ${
          dragOver
            ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40'
            : 'border-transparent'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void handleFile(f)
        }}
      >
        <label className="text-sm font-medium flex items-center gap-1">
          <span aria-hidden>📷</span>
          {scanWithAi
            ? 'チラシ画像（アップロード + AI 自動入力、ドラッグ&ドロップ可）'
            : 'チラシ画像（アップロードのみ、ドラッグ&ドロップ可）'}
        </label>
        {/* カメラで撮ってそのまま登録・読み取り（2026-11-22）。スマホではカメラが直接開く */}
        <FilePickButton
          ref={cameraRef}
          label="📸 カメラで撮る"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
          disabled={status === 'loading'}
        />
        <FilePickButton
          ref={inputRef}
          label="📷 チラシ画像を選ぶ"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
          disabled={status === 'loading'}
        />
        {flyerUrl && (
          <button
            type="button"
            onClick={clearFlyer}
            className="text-xs text-slate-500 hover:text-rose-600 underline"
          >
            画像を外す
          </button>
        )}
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 w-full">
          <input
            type="checkbox"
            checked={scanWithAi}
            onChange={(e) => setScanWithAi(e.target.checked)}
            disabled={status === 'loading'}
          />
          画像からAIで内容も読み取る（タイトル・日時・場所などが上書きされます／AI利用料がかかります）
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="scan-url-input" className="text-sm font-medium flex items-center gap-1">
          <span aria-hidden>🔗</span>
          サイトURLから読み取り
        </label>
        <input
          id="scan-url-input"
          type="url"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter でイベント登録フォーム自体が送信されるのを防ぎ、読み取りを実行する
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleUrl()
            }
          }}
          placeholder="https://…（イベント案内・一覧ページのURL）"
          className="flex-1 min-w-[220px] rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
          disabled={status === 'loading'}
        />
        <button
          type="button"
          onClick={() => void handleUrl()}
          disabled={status === 'loading' || !urlValue.trim()}
          className="text-xs py-1 px-2 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 disabled:opacity-50"
        >
          読み取る
        </button>
      </div>
      {candidates.length > 1 && (
        <div className="rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-2 space-y-2">
          <p className="text-xs font-medium">
            {candidates.length}件のイベントを検出しました。チェックした催しを、まとめて登録できます
          </p>
          <ul className="space-y-2">
            {candidates.map((c, i) => {
              const ready = !!c.start_at && (!!c.end_at || !!c.end_time_unknown)
              return (
                <li key={i} className="flex items-start gap-2 rounded border border-slate-200 dark:border-slate-700 p-2 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`「${c.title ?? ''}」をまとめて登録に入れる`}
                    className="mt-0.5"
                    checked={candChecked[i] ?? false}
                    disabled={!ready || bulkBusy}
                    onChange={(e) => setCandChecked(candChecked.map((v, j) => (j === i ? e.target.checked : v)))}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{c.title}</p>
                    <p className="text-slate-500">
                      {c.start_at ? formatOcc(c.start_at) : '日時を読み取れませんでした'}
                      {c.start_at && c.end_time_unknown ? '〜（終了時刻は未定）' : ''}
                      {(c.occurrences?.length ?? 0) > 1 ? ` ほか全${c.occurrences?.length}回` : ''}
                      {c.location ? `・${c.location}` : ''}
                    </p>
                    {c.organizer_name && <p className="text-slate-500">主催：{c.organizer_name}</p>}
                    {c.flyer_source_url && (
                      <label className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={candFlyer[i] ?? false}
                          disabled={bulkBusy}
                          onChange={(e) => setCandFlyer(candFlyer.map((v, j) => (j === i ? e.target.checked : v)))}
                        />
                        このチラシ画像を付ける
                      </label>
                    )}
                    <button
                      type="button"
                      className="underline text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      disabled={bulkBusy}
                      onClick={() => {
                        setSelectedIdx(i)
                        applyCandidate(c, `「${c.title ?? ''}」を反映しました`, '')
                        setPageFlyer(c.flyer_source_url ?? null)
                      }}
                    >
                      {selectedIdx === i ? '下のフォームに反映済み（もう一度反映）' : 'この1件だけ下のフォームに反映して直す'}
                    </button>
                  </div>
                  {c.flyer_source_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.flyer_source_url}
                      alt=""
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="h-20 w-16 shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-white object-cover"
                    />
                  )}
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => void handleBulk()}
            disabled={bulkBusy || candChecked.filter(Boolean).length === 0}
            className="w-full min-h-11 rounded-lg bg-accent-strong px-3 text-sm font-semibold text-accent-strong-fg disabled:opacity-50"
          >
            {bulkBusy ? '登録しています…' : `チェックした ${candChecked.filter(Boolean).length} 件をまとめて登録`}
          </button>
          {bulkError && (
            <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              {bulkError}
            </p>
          )}
          <p className="text-[10px] text-slate-500 leading-relaxed">
            まとめて登録では、主催者は下のフォームで選んであればそれを、選んでいなければ読み取った主催者名（代理登録）を使います。
            題名・日時・場所は読み取ったままで登録されるので、上の内容を確かめてください。登録したあとも、各イベントの「編集」で直せます。
            チラシ画像は、掲載してよいものだけ付けてください。
          </p>
        </div>
      )}
      {bulkDone.length > 0 && (
        <div className="rounded border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-2 space-y-1">
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">{bulkDone.length}件を登録しました</p>
          <ul className="space-y-0.5">
            {bulkDone.map((e) => (
              <li key={e.id} className="text-xs">
                <a href={`/events/${e.id}`} className="text-sky-700 underline dark:text-sky-300">{e.title}</a>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-500">下のフォームは使わずに、このまま閉じてかまいません。</p>
        </div>
      )}
      {pageFlyer && !flyerUrl && (
        <div className="flex items-center gap-3 rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pageFlyer} alt="" referrerPolicy="no-referrer" className="h-20 w-16 shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-white object-cover" />
          <div className="space-y-1">
            <p className="text-xs">ページ内に、この催しのチラシ画像がありました。</p>
            <button
              type="button"
              onClick={() => void attachPageFlyer()}
              disabled={pageFlyerBusy}
              className="rounded bg-amber-200 px-2 py-1 text-xs text-amber-900 disabled:opacity-50 dark:bg-amber-800 dark:text-amber-100"
            >
              {pageFlyerBusy ? '保存しています…' : 'このチラシ画像を付ける'}
            </button>
          </div>
        </div>
      )}
      {flyerUrl && (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={flyerUrl}
            alt="チラシプレビュー"
            className="max-w-[160px] max-h-[200px] rounded border border-amber-200 dark:border-amber-900 bg-white object-contain"
          />
          <p className="text-[10px] text-slate-500 break-all flex-1">
            添付済み。登録後はイベント詳細ページに大きく表示されます。
          </p>
        </div>
      )}
      {occurrences.length > 1 && (
        <div className="rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-2 space-y-1">
          <input
            type="hidden"
            name="occurrences_json"
            value={JSON.stringify(occurrences.filter((_, i) => checkedOcc[i]))}
          />
          <p className="text-xs font-medium">
            複数日程を検出しました。登録する回にチェックを入れてください（{checkedOcc.filter(Boolean).length}件選択中）
          </p>
          {occurrences.map((occ, i) => (
            <label key={i} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={checkedOcc[i] ?? true}
                onChange={(e) => {
                  const next = [...checkedOcc]
                  next[i] = e.target.checked
                  setCheckedOcc(next)
                }}
              />
              {formatOcc(occ.start_at)} 〜 {formatOcc(occ.end_at)}
            </label>
          ))}
          <p className="text-[10px] text-slate-500">
            チェックした回数分、同内容のイベントがまとめて登録されます。
          </p>
        </div>
      )}
      {status === 'loading' ? (
        // AI 読み取り中はテキストだけでは気づきにくいため、スピナー＋進捗バーで処理中を明示する
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded border border-amber-400 dark:border-amber-700 bg-amber-100/80 dark:bg-amber-900/40 p-3">
          <span className="cidao-scan-spinner shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{message}</p>
            <div className="mt-1.5 h-1.5 rounded-full bg-amber-200 dark:bg-amber-800 overflow-hidden">
              <div className="cidao-scan-progress h-full w-1/3 rounded-full bg-amber-500 dark:bg-amber-400" />
            </div>
            <p className="mt-1 text-[10px] text-amber-800/80 dark:text-amber-200/80">
              AIが読み取り中です。数十秒かかることがあります。このまましばらくお待ちください。
            </p>
          </div>
        </div>
      ) : message && status === 'notice' ? (
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">お知らせ</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">{message}</p>
        </div>
      ) : (
        message && <p className={`text-xs ${statusColor}`}>{message}</p>
      )}
      <p className="text-[10px] text-slate-500">
        チラシ画像またはサイトURLから タイトル / 日時 / 場所 / 主催団体名 などを抽出してフォームに反映します。AI
        の抽出結果には誤りが含まれることがあります。必ず確認・修正してください。
        画像本体は Supabase Storage に保存され、来訪した市民が詳細ページで閲覧できます。
      </p>
    </div>
  )
}
