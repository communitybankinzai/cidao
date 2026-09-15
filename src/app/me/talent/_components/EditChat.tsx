'use client'
import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { editChatAction } from '../chat-actions'

type Line = { role: 'user' | 'assistant'; text: string }
type Recognition = {
  lang: string; interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void
}
function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const EXAMPLES = ['短い紹介をもっと親しみやすくして', '得意なことを足したい', '活動地域を直したい', '料金のことは載せないで']

// 確認画面の「話しかけて直す」欄。フォームの代わりに、直したいことを言葉で伝える。
export default function EditChat({ versionId, missing }: { versionId: string; missing: string[] }) {
  const first = 'どこを直しますか？ 言葉で書いてもらえれば、上のプロフィールに反映します。' +
    (missing.length ? `まだ話していない「${missing.slice(0, 3).join('」「')}」なども、ここで話すと紹介が充実します。` : '')
  const [lines, setLines] = useState<Line[]>([{ role: 'assistant', text: first }])
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const [listening, setListening] = useState(false)
  const [pending, startTransition] = useTransition()
  const recognition = useRef<Recognition | null>(null)

  function send(raw: string) {
    const message = raw.trim()
    if (!message || pending) return
    setLines(current => [...current, { role: 'user', text: message }])
    setText('')
    startTransition(async () => {
      const result = await editChatAction(versionId, message)
      setLines(current => [...current, { role: 'assistant', text: result.ok ? result.reply : result.error }])
      if (!result.ok) setText(message) // 失敗したら書いた文を入力欄に戻す
    })
  }

  function toggleMic() {
    if (listening) { recognition.current?.stop(); return }
    const Ctor = recognitionCtor()
    if (!Ctor) { setNotice('このブラウザは音声入力に対応していません。文字で入力してください。'); return }
    const r = new Ctor()
    r.lang = 'ja-JP'
    r.interimResults = false
    r.onresult = event => {
      const said = Array.from(event.results).map(result => result[0]?.transcript ?? '').join('')
      setText(current => (current ? `${current}${said}` : said))
    }
    r.onend = () => setListening(false)
    recognition.current = r
    setNotice('')
    setListening(true)
    r.start()
  }

  return <section aria-label="話しかけて直す" className="space-y-3 rounded-xl border bg-background p-4">
    <h2 className="text-lg font-semibold">直したいところを話しかけてください</h2>
    <div className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
      {lines.map((line, i) => <div key={i} className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <p className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm leading-relaxed ${line.role === 'user' ? 'bg-primary text-primary-foreground' : 'border bg-muted'}`}>{line.text}</p>
      </div>)}
      {pending && <p role="status" className="text-sm text-muted-foreground">直しています…（数秒〜十数秒）</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      {EXAMPLES.map(example => <button key={example} type="button" disabled={pending} onClick={() => setText(example)}
        className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{example}</button>)}
    </div>
    <form onSubmit={event => { event.preventDefault(); send(text) }} className="space-y-2">
      <textarea value={text} onChange={event => setText(event.target.value)} maxLength={1000} rows={3} disabled={pending}
        placeholder="例：得意なことに「革の縫製が早い」を足して" className="block w-full resize-none rounded-md border bg-background p-3 text-base" />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} aria-pressed={listening} onClick={toggleMic}>{listening ? '音声入力を止める' : 'マイクで話す'}</Button>
        <Button type="submit" disabled={pending || listening || !text.trim()}>送って直す</Button>
      </div>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      <p className="text-xs text-muted-foreground">住所・電話番号・メールアドレスは載せません。連絡は声がけ機能で届きます。</p>
    </form>
  </section>
}
