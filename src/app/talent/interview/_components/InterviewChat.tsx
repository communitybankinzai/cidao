'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { MAX_INTERVIEW_TURNS, MAX_USER_TEXT_LENGTH } from '@/lib/talent-bank/interview/config'
import { interviewErrorMessage } from '@/lib/talent-bank/interview/errors'
import type { InterviewSnapshot } from '@/lib/talent-bank/interview/snapshot'

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null; onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
const subscribe = () => () => {}
function speechAvailable() {
  const w = window as SpeechWindow
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition)
}

export default function InterviewChat({ initial }: { initial: InterviewSnapshot | null }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const speech = useRef<Recognition | null>(null)
  const pending = useRef(false)
  const end = useRef<HTMLDivElement | null>(null)
  const canSpeak = useSyncExternalStore(subscribe, speechAvailable, () => false)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [snapshot?.messages.length, busy])
  useEffect(() => () => {
    if (speech.current) {
      speech.current.onresult = null; speech.current.onerror = null; speech.current.onend = null
      speech.current.abort()
    }
  }, [])
  const stopSpeech = () => {
    if (speech.current) {
      speech.current.onresult = null; speech.current.onerror = null; speech.current.onend = null
      speech.current.abort(); speech.current = null
    }
    setListening(false)
  }
  async function act(action: 'start' | 'turn' | 'pause') {
    if (pending.current || (action === 'turn' && !text.trim())) return
    pending.current = true; setBusy(true); setError(null); stopSpeech()
    try {
      const response = await fetch('/api/talent-bank/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(action === 'turn' ? { text } : {}) }),
      })
      const result = await response.json() as { ok: boolean; reason?: string; data?: InterviewSnapshot | { status: 'paused' } }
      if (result.data && 'messages' in result.data) {
        setSnapshot(result.data); setUncertain(false)
        if (action === 'turn' && (result.ok || result.reason === 'ai_unavailable')) setText('')
      }
      if (!result.ok) {
        setError(interviewErrorMessage(result.reason ?? 'storage_unavailable'))
        if (!result.data && ['storage_unavailable', 'conflict', 'busy'].includes(result.reason ?? '')) setUncertain(true)
      } else if (action === 'pause') {
        setSnapshot(current => current ? { ...current, status: 'paused' } : current)
      }
    } catch {
      setUncertain(true); setError(interviewErrorMessage('storage_unavailable'))
    } finally { pending.current = false; setBusy(false) }
  }
  function toggleMicrophone() {
    if (listening) { speech.current?.stop(); return }
    const w = window as SpeechWindow
    const Constructor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Constructor) return
    const recognition = new Constructor()
    recognition.lang = 'ja-JP'; recognition.continuous = false; recognition.interimResults = false
    recognition.onresult = event => {
      const words = Array.from(event.results).map(result => result[0]?.transcript ?? '').join('')
      setText(current => `${current}${current ? ' ' : ''}${words}`.slice(0, MAX_USER_TEXT_LENGTH))
    }
    recognition.onerror = () => { setError('音声入力を利用できませんでした。マイクの許可を確認するか、文字で入力してください。'); setListening(false) }
    recognition.onend = () => { setListening(false); speech.current = null }
    speech.current = recognition
    try { recognition.start(); setListening(true) } catch { setError('音声入力を開始できませんでした。文字で入力してください。'); setListening(false) }
  }
  const done = snapshot?.status === 'done'
  const paused = snapshot?.status === 'paused'
  const limited = !!snapshot && snapshot.turn_count >= MAX_INTERVIEW_TURNS
  return <section className="space-y-5 pb-72" aria-label="インタビューチャット">
    {snapshot && <div className="sticky top-0 z-10 space-y-2 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-sm">必須 {snapshot.progress.required_done}/{snapshot.progress.required_total}・任意 {snapshot.progress.optional_done}/12</p>
        {!done && !paused && <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('pause')}>後で続ける</Button>}
      </div>
      <progress aria-label="必須項目の進捗" value={snapshot.progress.required_done} max={snapshot.progress.required_total} className="h-2 w-full accent-sky-600" />
    </div>}
    <p className="text-xs text-muted-foreground">住所・電話番号・メールアドレスは入力しないでください。回答は本人と運営が閲覧でき、会話原文は1年間保存されます。</p>
    <div role="log" aria-label="会話" aria-live="polite" className="space-y-4">
      {snapshot?.messages.map(message => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-base leading-relaxed ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'border bg-muted'}`}>
          <p className="mb-1 text-xs opacity-70">{message.role === 'user' ? 'あなた' : 'CBIの聞き手'}</p>{message.content}
        </div>
      </div>)}
      {busy && <p role="status" className="text-sm text-muted-foreground">{snapshot ? '処理しています…' : '準備しています…'}</p>}
    </div>
    {error && <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">{error}</p>}
    {limited && !done && <p role="status" className="rounded-lg border p-3 text-sm">{interviewErrorMessage('turn_limit')}</p>}
    {(!snapshot || paused) && <div className="space-y-3">
      {paused && <p>ここまで保存しました。このページから再開できます。</p>}
      <Button disabled={busy} onClick={() => void act('start')}>{paused ? 'インタビューを再開する' : 'インタビューを始める'}</Button>
      {paused && <Link href="/talent" className="ml-3 text-sm underline">登録メンバーへ戻る</Link>}
    </div>}
    {snapshot && !paused && <Button variant="outline" disabled={busy} onClick={() => void act('start')}>保存内容を読み直す</Button>}
    {(done || limited) && snapshot && <section className="space-y-4 rounded-xl border p-5" aria-label="まとめ">
      <h2 className="text-xl font-semibold">{done ? 'インタビューのまとめ' : 'ここまでのまとめ'}</h2>
      {done ? <div className="space-y-2 rounded-lg border border-sky-600 bg-sky-50 p-4 text-sm dark:bg-sky-950">
        <p className="font-medium">インタビューは完了しました。ありがとうございます。この内容はまだ公開されません。</p>
        <p>次の流れ：</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>この下の「プロフィール案を作る」を押す（AIが回答から紹介文の案を作ります・数十秒）</li>
          <li>できた案を確認して、直したいところを修正する</li>
          <li>公開範囲を選んで「公開を申請」する</li>
          <li>運営（CBI）が確認して公開します。結果はベル通知でお知らせします</li>
        </ol>
      </div> : <p className="text-sm text-muted-foreground">この内容はまだ公開されません。</p>}
      <dl className="space-y-4">{snapshot.summary.map(item => <div key={item.key}><dt className="font-medium">{item.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.text}</dd></div>)}</dl>
    </section>}
    <div ref={end} />
    {snapshot?.status === 'active' && !limited && <form onSubmit={event => { event.preventDefault(); void act('turn') }}
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl space-y-2">
        <label htmlFor="interview-answer" className="text-sm font-medium">あなたの回答</label>
        <textarea id="interview-answer" value={text} onChange={e => setText(e.target.value)} maxLength={MAX_USER_TEXT_LENGTH} rows={3}
          disabled={busy || listening} placeholder="該当なし・答えたくない、でも大丈夫です" className="block w-full resize-none rounded-md border bg-background p-3 text-base" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{text.length}/{MAX_USER_TEXT_LENGTH}</span>
          <div className="flex gap-2">{canSpeak && <Button type="button" variant="outline" aria-pressed={listening} disabled={busy || uncertain} onClick={toggleMicrophone}>{listening ? '音声入力を停止' : 'マイクで入力'}</Button>}
            <Button type="submit" disabled={busy || listening || uncertain || !text.trim()}>送信</Button></div>
        </div>
        {canSpeak && <p className="text-xs text-muted-foreground">音声はブラウザの音声認識サービスで処理されます。入力された文字を確認してから送信してください。</p>}
      </div>
    </form>}
  </section>
}
