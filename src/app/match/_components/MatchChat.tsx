'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Message = { role: 'user' | 'assistant'; content: string }

export type MatchMode = 'orgs' | 'members'

const CONFIG: Record<MatchMode, {
  apiPath: string
  placeholder: string
  suggestions: string[]
  linkRegex: RegExp
  footerNote: string
}> = {
  orgs: {
    apiPath: '/api/agents/a7',
    placeholder: 'A7（団体マッチング）に質問する…',
    suggestions: [
      '平日の昼間に1〜2時間だけ動けます。何ができそう？',
      '子ども向けの活動を手伝える団体はある？',
      '環境保全・里山に関わる団体を教えて',
      'ボーイスカウト印西第1団について教えて',
    ],
    linkRegex: /\/orgs\/([0-9a-f-]{8,})/g,
    footerNote: 'A7 は印西市内 219 団体の概要のみを根拠に回答します。詳しい連絡先や直近の予定は各団体ページ・公式 SNS をご確認ください。',
  },
  members: {
    apiPath: '/api/agents/a7-members',
    placeholder: 'A7（メンバーマッチング）に質問する…',
    suggestions: [
      'Webサイト制作を手伝ってくれる人はいますか？',
      '子育て支援イベントに協力できる人を探しています',
      '広報・SNS運用が得意な人とつながりたい',
      '休日の地域活動に参加したい人と会いたい',
    ],
    linkRegex: /\/talent\/([0-9a-f-]{8,})/g,
    footerNote: 'A7 は CiDAO に登録され公開を許可しているメンバーのプロフィールのみを根拠に回答します。具体的な連絡は各メンバーのページから「声がけ」ボタンでお願いします。',
  },
}

function linkify(text: string, re: RegExp): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  // 各 send 毎に新規 regex を使うため lastIndex を 0 に
  re.lastIndex = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <a key={i++} href={m[0]} target="_blank" rel="noreferrer noopener" className="underline text-sky-700 dark:text-sky-300">
        {m[0]}
      </a>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export default function MatchChat({ mode = 'orgs' }: { mode?: MatchMode }) {
  const config = CONFIG[mode]
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // モード切替時は会話をリセット
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [mode])

  async function send(content: string) {
    if (!content.trim() || streaming) return
    setError(null)
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setInput('')
    setStreaming(true)

    const ac = new AbortController()
    abortRef.current = ac

    try {
      const res = await fetch(config.apiPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next }),
        signal: ac.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(`API ${res.status}: ${text.slice(0, 200) || 'no body'}`)
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: acc }
          return copy
        })
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        setError('応答を中断しました')
      } else {
        setError(e instanceof Error ? e.message : 'unknown error')
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function reset() {
    setMessages([])
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg min-h-[280px] max-h-[60vh] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-sm text-slate-500 space-y-2">
            <p>例えばこんな質問から始められます:</p>
            <ul className="space-y-1.5">
              {config.suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => send(s)}
                    className="text-left underline hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ' +
                  (m.role === 'user'
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100')
                }
              >
                {m.role === 'assistant' ? linkify(m.content || (streaming ? '...' : ''), config.linkRegex) : m.content}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-900 rounded-lg p-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={config.placeholder}
          disabled={streaming}
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
        />
        {streaming ? (
          <Button type="button" variant="outline" onClick={stop}>停止</Button>
        ) : (
          <Button type="submit" disabled={!input.trim()}>送信</Button>
        )}
        {messages.length > 0 && !streaming && (
          <Button type="button" variant="outline" onClick={reset}>リセット</Button>
        )}
      </form>

      <p className="text-[11px] text-slate-400">
        {config.footerNote}
      </p>
    </div>
  )
}
