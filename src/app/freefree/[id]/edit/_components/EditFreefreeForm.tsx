'use client'

// FreeFree 掲載の編集フォーム（2026-09-16）。入力欄は新規掲載（NewFreefreeForm）と同じ並び・同じ上限。
// 掲載者は変えられない。クーポンとお店のピンはこの画面では扱わない
import Link from 'next/link'
import { useState, useTransition, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import FreefreeImagesUpload from '@/app/freefree/new/_components/FreefreeImagesUpload'
import { jstToday } from '@/lib/freefree-dates'

const MAX_IMAGES = 3
const MAX_LINKS = 5

type LinkRow = { label: string; url: string }
type Opt = { key: string; label: string }

export type EditInitial = {
  title: string
  body: string
  category: string
  location: string
  endDate: string
  startDate: string
  images: string[]
  links: LinkRow[]
  snsShare: boolean
  snsDisplayName: string
}

export default function EditFreefreeForm({
  action,
  postId,
  userId,
  categories,
  initial,
  maxEnd,
  isOrgPost,
}: {
  action: (formData: FormData) => Promise<{ error: string } | void>
  postId: string
  userId: string
  categories: Opt[]
  initial: EditInitial
  maxEnd: string // 掲載終了日の上限（掲載した日から3ヶ月）
  isOrgPost: boolean // 団体の掲載なら SNS では団体名で紹介される
}) {
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [category, setCategory] = useState(initial.category)
  const [location, setLocation] = useState(initial.location)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [startDate, setStartDate] = useState(initial.startDate)
  const [keptImages, setKeptImages] = useState<string[]>(initial.images)
  const [links, setLinks] = useState<LinkRow[]>(initial.links)
  const [snsShare, setSnsShare] = useState(initial.snsShare)
  const [snsDisplayName, setSnsDisplayName] = useState(initial.snsDisplayName)

  // 失敗しても入力を消さないよう、form の action 属性ではなく自前で送る（NewFreefreeForm と同じ理由）
  const [submitting, startSubmit] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSubmitError(null)
    startSubmit(async () => {
      try {
        const r = (await action(fd)) as { error?: string } | undefined
        if (r?.error) setSubmitError(r.error)
      } catch (e) {
        // 保存に成功すると、サーバーの redirect() が「エラーの形」で届く（Next.js の仕様）。失敗ではない
        const digest = (e as { digest?: unknown } | null)?.digest
        if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return
        setSubmitError('送信できませんでした（サイトの更新直後や、通信が不安定なときに起きます）。入力はこの画面に残っています。もう一度「保存する」を押してください。直らないときは、入力した文章を控えてからページを再読み込みしてください。')
      }
    })
  }

  function updateLink(i: number, patch: Partial<LinkRow>) {
    setLinks((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
        <L label="タイトル（40字）" req>
          <input name="title" required maxLength={40} value={title} onChange={(e) => setTitle(e.target.value)} className={inp} />
        </L>
        <L label="本文（1000字、Markdown 可）" req>
          <textarea name="body" required maxLength={1000} rows={8} value={body} onChange={(e) => setBody(e.target.value)} className={inp} />
          <p className="mt-1 text-[11px] text-slate-500 text-right">{body.length} / 1000</p>
        </L>
        <div className="grid md:grid-cols-2 gap-3">
          <L label="カテゴリ" req>
            <select name="category" required value={category} onChange={(e) => setCategory(e.target.value)} className={inp}>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </L>
          <L label="掲載終了日" req>
            <input
              type="date"
              name="end_date"
              required
              min={jstToday()}
              max={maxEnd}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inp}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              掲載した日から3ヶ月（{maxEnd}）まで延ばせます。イベントなら開催最終日を選んでください。
            </p>
          </L>
          {category === 'event' && (
            <L label="開催日（初日）">
              <input
                type="date"
                name="event_start_date"
                max={endDate}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inp}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                SNSの告知で「開催まであと◯日！」と数えるのに使います。1日だけのイベントなら掲載終了日と同じ日にしてください。
              </p>
            </L>
          )}
        </div>
        <L label="場所">
          <input name="location" placeholder="例: 印西市草深" value={location} onChange={(e) => setLocation(e.target.value)} className={inp} />
        </L>

        {keptImages.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">いま掲載している画像（{keptImages.length}枚）</label>
            <ul className="grid grid-cols-3 gap-2">
              {keptImages.map((u, i) => (
                <li key={u} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`掲載中の画像 ${i + 1}`} className="w-full aspect-square object-cover rounded border border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    onClick={() => setKeptImages((prev) => prev.filter((x) => x !== u))}
                    className="absolute top-1 right-1 bg-red-500 text-white text-xs px-2 py-0.5 rounded"
                  >
                    外す
                  </button>
                  <input type="hidden" name="images" value={u} />
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500">「外す」は保存したときに反映されます。</p>
          </div>
        )}
        {keptImages.length < MAX_IMAGES && (
          <FreefreeImagesUpload userId={userId} maxImages={MAX_IMAGES - keptImages.length} />
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">参考リンク（最大{MAX_LINKS}件）</label>
          {links.length > 0 && (
            <ul className="space-y-2">
              {links.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    value={l.label}
                    required
                    maxLength={30}
                    placeholder="表示名"
                    aria-label={`リンク${i + 1}の表示名`}
                    onChange={(e) => updateLink(i, { label: e.target.value })}
                    className="w-32 shrink-0 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                  />
                  <input
                    type="url"
                    value={l.url}
                    required
                    pattern="https?://.+"
                    placeholder="https://"
                    aria-label={`リンク${i + 1}のURL`}
                    onChange={(e) => updateLink(i, { url: e.target.value })}
                    className="flex-1 min-w-48 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                  />
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 text-xs text-red-600 hover:underline"
                  >
                    外す
                  </button>
                  <input type="hidden" name="links" value={JSON.stringify({ label: l.label.trim(), url: l.url.trim() })} />
                </li>
              ))}
            </ul>
          )}
          {links.length < MAX_LINKS && (
            <button
              type="button"
              onClick={() => setLinks((prev) => [...prev, { label: '', url: '' }])}
              className="text-xs text-sky-700 dark:text-sky-400 hover:underline"
            >
              ＋ リンクを追加
            </button>
          )}
          <p className="text-[11px] text-slate-500">
            リンク先が開けるか、保存したあと詳細ページで一度押して確かめてください。
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="sns_share" checked={snsShare} onChange={(e) => setSnsShare(e.target.checked)} className="mt-1" />
          <span>
            SNSでの紹介を許可する
            <span className="block text-xs text-slate-500">CBI公式SNS（Instagram等）でこの掲示物が紹介されることがあります</span>
          </span>
        </label>
        {snsShare && !isOrgPost && (
          <div className="pl-6 border-l-2 border-sky-200 dark:border-sky-800">
            <L label="SNSで名前・屋号を出す場合（任意・40字）">
              <input
                name="sns_display_name"
                maxLength={40}
                placeholder="例: 印西バレエスタジオ"
                value={snsDisplayName}
                onChange={(e) => setSnsDisplayName(e.target.value)}
                className={inp}
              />
            </L>
          </div>
        )}
        {snsShare && isOrgPost && (
          <p className="pl-6 text-[11px] text-slate-500">団体としての掲載のため、SNSでは団体名で紹介されます。</p>
        )}
      </div>

      <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 rounded p-3 space-y-1">
        <p>保存しても、全メンバーへの新着通知は出ません。詳細ページに「◯月◯日更新」と表示されます。</p>
        {snsShare && (
          <p>CBI公式SNSでの紹介は、運営が新しい内容を確認してから配信されます（確認が済むまで、定期の紹介も止まります）。</p>
        )}
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded p-3">
          保存できませんでした：{submitError}
          <span className="block mt-1 text-xs">入力した内容はそのまま残っています。直してから、もう一度「保存する」を押してください。</span>
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Link href={`/freefree/${postId}`}><Button type="button" variant="outline">キャンセル</Button></Link>
        <Button type="submit" disabled={submitting}>{submitting ? '保存中…' : '保存する'}</Button>
      </div>
    </form>
  )
}

const inp = "w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
function L({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-sm font-medium">{label}{req && <span className="text-red-500 ml-0.5">*</span>}</label>{children}</div>
}
