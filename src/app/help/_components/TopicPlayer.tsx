'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HelpClip } from '@/lib/help-guide'

/**
 * 機能ごとの使い方：画面の写真・説明文・音声。
 * 音声は1つの audio を使い回す（スマホで次の説明へ自動で進むため）。
 * 「続けて聞く」は最初の説明から順に、最後まで流す。各説明の「聞く」はその1つだけ。
 */
export function TopicPlayer({ clips }: { clips: HelpClip[] }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [cur, setCur] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [continuous, setContinuous] = useState(false)
  const [error, setError] = useState('')
  const cardRefs = useRef<(HTMLElement | null)[]>([])

  const start = useCallback((i: number, cont: boolean) => {
    const a = audioRef.current
    if (!a) return
    setError('')
    setCur(i)
    setContinuous(cont)
    a.src = clips[i].audio
    a.play().then(() => setPlaying(true)).catch(() => {
      setPlaying(false)
      setError('音声を再生できませんでした。端末の音量・マナーモードを確かめて、もう一度押してください。')
    })
  }, [clips])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    setPlaying(false)
    setContinuous(false)
  }, [])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onEnded = () => {
      setPlaying(false)
      if (continuous && cur !== null && cur < clips.length - 1) start(cur + 1, true)
      else setContinuous(false)
    }
    a.addEventListener('ended', onEnded)
    return () => a.removeEventListener('ended', onEnded)
  }, [continuous, cur, clips.length, start])

  // 続けて聞くとき、いま話している説明が見えるように画面を動かす
  useEffect(() => {
    if (cur !== null && continuous) cardRefs.current[cur]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [cur, continuous])

  // ページを離れるときは止める
  useEffect(() => () => audioRef.current?.pause(), [])

  return (
    <div className="space-y-4">
      <audio ref={audioRef} preload="none" className="sr-only" />
      {clips.length > 1 && (
        <button
          type="button"
          onClick={() => (playing && continuous ? stop() : start(0, true))}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white shadow hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          {playing && continuous ? '⏸ 止める' : '▶ 最初から続けて聞く'}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

      <ol className="space-y-4">
        {clips.map((c, i) => {
          const active = cur === i && playing
          return (
            <li
              key={c.audio}
              ref={(el) => { cardRefs.current[i] = el }}
              className={`overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-slate-900 ${
                active ? 'border-sky-500 ring-2 ring-sky-300 dark:ring-sky-700' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              {c.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.image}
                  alt={`${c.title}の画面`}
                  loading="lazy"
                  className="mx-auto max-h-96 w-full bg-slate-100 object-contain dark:bg-slate-800"
                />
              )}
              <div className="space-y-2 p-4">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{c.title}</h2>
                <p className="text-sm leading-7 text-slate-700 dark:text-slate-300">{c.text}</p>
                <button
                  type="button"
                  onClick={() => (active && !continuous ? stop() : start(i, false))}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-sky-600 px-4 text-sm font-medium text-sky-700 hover:bg-sky-50 dark:border-sky-400 dark:text-sky-300 dark:hover:bg-slate-800"
                >
                  {active && !continuous ? '⏸ 止める' : '🔊 この説明を聞く'}
                  <span className="text-xs text-slate-500">（{c.seconds}秒）</span>
                </button>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
