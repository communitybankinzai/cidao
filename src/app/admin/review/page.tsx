import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { serviceClient } from '@/lib/content-review-run'
import { CATEGORY_LABEL, TARGET_LABEL, categoryLabels, isHeavy, targetPath, type ContentCategory, type ReviewTargetType } from '@/lib/content-review'
import { clearReview, removeReview } from './actions'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  target_type: ReviewTargetType
  target_id: string
  parent_id: string | null
  action: string
  author_id: string | null
  verdict: 'notify' | 'hold' | 'error'
  categories: string[]
  confidence: string | null
  reason: string | null
  title_snapshot: string | null
  held: boolean
  created_at: string
}

const LIMIT = 100
const PREVIEW_MAX = 500

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 元の投稿の、いまの中身（運営でも催し・団体の非公開は画面で開けないことがあるので、ここで読む。本文は保存していない） */
async function loadPreview(db: SupabaseClient, r: Row): Promise<string> {
  const q = async (table: string, cols: string): Promise<Record<string, unknown> | null> => {
    const { data } = await db.from(table).select(cols).eq('id', r.target_id).maybeSingle()
    return (data as unknown as Record<string, unknown> | null) ?? null
  }
  let parts: unknown[] = []
  if (r.target_type === 'event') {
    const d = await q('events', 'title, description, location')
    parts = d ? [d.title, d.description, d.location] : []
  } else if (r.target_type === 'freefree') {
    const d = await q('freefree_posts', 'title, body, location')
    parts = d ? [d.title, d.body, d.location] : []
  } else if (r.target_type === 'freefree_comment') {
    const d = await q('supports', 'body')
    parts = d ? [d.body] : []
  } else if (r.target_type === 'org') {
    const d = await q('organizations', 'name, description, activity_detail')
    parts = d ? [d.name, d.description, d.activity_detail] : []
  } else if (r.target_type === 'proposal') {
    const d = await q('proposals', 'title, body')
    parts = d ? [d.title, d.body] : []
  } else {
    const d = await q('comments', 'body')
    parts = d ? [d.body] : []
  }
  const text = parts.map((p) => String(p ?? '').trim()).filter(Boolean).join('\n')
  return text.slice(0, PREVIEW_MAX) + (text.length > PREVIEW_MAX ? '…' : '')
}

export default async function AdminReviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: isAdmin, error: adminErr } = await supabase.rpc('is_admin')
  if (adminErr || !isAdmin) redirect('/')
  // 非公開の投稿は RLS で運営にも見えないため、権限を確かめたうえで service_role で読む。操作できるのは運営委員・統括だけ
  const { data: canAct } = await supabase.rpc('is_committee_or_super')

  const db = serviceClient()
  const { data, error } = db
    ? await db
        .from('content_reviews')
        .select('id, target_type, target_id, parent_id, action, author_id, verdict, categories, confidence, reason, title_snapshot, held, created_at')
        .eq('status', 'open')
        .in('verdict', ['notify', 'hold', 'error'])
        .order('created_at', { ascending: false })
        .limit(LIMIT)
    : { data: null, error: { message: 'サーバー設定エラー（service role 未設定）' } }
  const rows = (data ?? []) as Row[]

  // 投稿者の表示名・元の投稿の中身
  const names = new Map<string, string>()
  const previews = new Map<string, string>()
  if (db && rows.length > 0) {
    const ids = [...new Set(rows.map((r) => r.author_id).filter((v): v is string => !!v))]
    if (ids.length > 0) {
      const { data: ms } = await db.from('members').select('id, display_name').in('id', ids)
      for (const m of ms ?? []) names.set(m.id as string, String(m.display_name ?? ''))
    }
    await Promise.all(rows.map(async (r) => { previews.set(r.id, await loadPreview(db, r).catch(() => '')) }))
  }

  const heldCount = rows.filter((r) => r.verdict === 'hold' && r.held).length

  async function handleClear(formData: FormData) {
    'use server'
    const id = String(formData.get('review_id') ?? '')
    if (id) await clearReview(id)
  }
  async function handleRemove(formData: FormData) {
    'use server'
    const id = String(formData.get('review_id') ?? '')
    if (id) await removeReview(id)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">投稿の審査</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            催し・FreeFree・団体の紹介・提案・コメントを、AI が自動で確認します。問題がありそうなものだけがここに並びます。
            確かな疑いのあるものは、公開を止めてここに回します（投稿者には「確認中です」と知らせています）。
            「問題なし」を押すと、止めている投稿は公開に戻ります（全会員への新着通知は出し直しません）。
          </p>
          <p className="text-xs text-slate-500">確認待ち {rows.length}件（うち公開を止めているもの {heldCount}件）</p>
          {!canAct && <p className="text-xs text-amber-700">操作できるのは運営委員・統括です（この画面は見るだけです）。</p>}
        </header>

        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-4">
            審査の一覧を読めませんでした：{error.message}
          </p>
        )}

        {!error && rows.length === 0 && (
          <p className="text-sm text-slate-500 bg-white dark:bg-slate-900 border rounded-lg p-6">確認待ちの投稿はありません。</p>
        )}

        <ul className="space-y-3">
          {rows.map((r) => {
            const heavy = r.categories.some((c) => isHeavy(c as ContentCategory))
            const stateLabel = r.verdict === 'error' ? '類別できませんでした（公開のまま）' : r.held ? '公開を止めています' : '公開中です'
            const stateClass = r.verdict === 'error'
              ? 'bg-slate-200 dark:bg-slate-800'
              : r.held ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
            const href = targetPath(r.target_type, r.target_id, r.parent_id)
            const preview = previews.get(r.id) ?? ''
            const isComment = r.target_type === 'freefree_comment' || r.target_type === 'proposal_comment'
            return (
              <li key={r.id} className="bg-white dark:bg-slate-900 border rounded-lg p-4 space-y-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5">{TARGET_LABEL[r.target_type]}{r.action === 'update' ? '（編集）' : ''}</span>
                  <span className={`text-xs rounded px-2 py-0.5 ${stateClass}`}>{stateLabel}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(r.created_at)}</span>
                </div>
                <p className="font-medium">
                  <Link href={href} className="text-sky-700 dark:text-sky-400 hover:underline">{r.title_snapshot || '（題名なし）'}</Link>
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  投稿者：{r.author_id ? (names.get(r.author_id) || '（名前なし）') : '（不明）'}
                </p>
                {r.verdict !== 'error' && (
                  <p className="text-xs">
                    区分：
                    {r.categories.map((c) => (
                      <span key={c} className={`mr-1 inline-block rounded px-2 py-0.5 ${isHeavy(c as ContentCategory) ? 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200' : 'bg-slate-100 dark:bg-slate-800'}`}>
                        {CATEGORY_LABEL[c as ContentCategory] ?? c}
                      </span>
                    ))}
                    {!r.categories.length && categoryLabels([])}
                    {r.confidence && <span className="ml-1 text-slate-500">（確かさ：{r.confidence === 'high' ? '高い' : r.confidence === 'mid' ? '中くらい' : '低い'}）</span>}
                  </p>
                )}
                {isComment && heavy && !r.held && (
                  <p className="text-xs text-rose-700">重い区分の疑いがあります。コメントは自動では止められないため、公開のままです。早めに確認してください。</p>
                )}
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">理由：{r.reason || '（記入なし）'}</p>
                {preview && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500">いまの投稿の中身を見る</summary>
                    <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 dark:bg-slate-950 p-2 leading-relaxed">{preview}</p>
                  </details>
                )}
                {r.held && (r.target_type === 'event' || r.target_type === 'org') && (
                  <p className="text-[11px] text-slate-500">公開を止めているため、上のリンクは運営でも開けないことがあります。中身は上の「いまの投稿の中身を見る」で確認できます。</p>
                )}
                {canAct && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <form action={handleClear}>
                      <input type="hidden" name="review_id" value={r.id} />
                      <Button type="submit" size="sm" variant="outline">{r.held ? '問題なし（公開に戻す）' : '問題なし'}</Button>
                    </form>
                    <form action={handleRemove}>
                      <input type="hidden" name="review_id" value={r.id} />
                      <Button type="submit" size="sm" variant="outline" className="text-rose-700">
                        {isComment ? 'コメントを削除する' : r.held ? '非公開のままにする' : '非公開にする'}
                      </Button>
                    </form>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {rows.length >= LIMIT && <p className="text-xs text-slate-500">新しい順に {LIMIT} 件まで表示しています。</p>}
      </div>
    </div>
  )
}
