import { notFound, redirect, unstable_rethrow } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FREEFREE_CATEGORIES } from '@/lib/freefree-categories'
import { jstYmdOf, maxEndDateForEdit } from '@/lib/freefree-dates'
import { canEditFreefreePost } from '@/lib/freefree-permissions'
import { updateFreefreePost } from '../../actions'
import EditFreefreeForm from './_components/EditFreefreeForm'

// FreeFree 掲載の編集画面（2026-09-16）。編集できるのは掲載者本人（団体の掲載なら所属メンバー）と運営者
export default async function EditFreefreePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/freefree/${id}/edit`)

  const { data: post } = await supabase
    .from('freefree_posts')
    .select('id, poster_type, poster_id, created_at, title, body, category, location, images, links, expires_at, event_start_date, sns_share, sns_display_name')
    .eq('id', id)
    .maybeSingle()
  if (!post) notFound()

  if (!(await canEditFreefreePost(supabase, user.id, post))) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
        <div className="max-w-2xl mx-auto space-y-4">
          <nav className="text-xs text-slate-500"><Link href={`/freefree/${id}`} className="hover:underline">← 掲載に戻る</Link></nav>
          <p className="text-sm">この掲載を編集できるのは、掲載した本人（団体の掲載ならその団体のメンバー）と運営者だけです。</p>
        </div>
      </div>
    )
  }

  const maxEnd = maxEndDateForEdit(post.created_at)

  async function handleUpdate(formData: FormData): Promise<{ error: string } | void> {
    'use server'
    // 失敗したときは例外を投げずにエラー文を返す（画面ごと作り直されて入力が消えないように）
    return updateFreefreePost(id, {
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      category: String(formData.get('category') ?? ''),
      location: String(formData.get('location') ?? '').trim() || undefined,
      end_date: String(formData.get('end_date') ?? ''),
      event_start_date: String(formData.get('event_start_date') ?? '') || undefined,
      images: (formData.getAll('images') as string[]).filter((u) => u.length > 0).slice(0, 3),
      links: (formData.getAll('links') as string[])
        .map((s) => {
          try {
            const o = JSON.parse(s) as { label?: unknown; url?: unknown }
            const label = String(o.label ?? '').trim().slice(0, 30)
            const url = String(o.url ?? '').trim()
            return label && /^https?:\/\//i.test(url) ? { label, url } : null
          } catch {
            return null
          }
        })
        .filter((l): l is { label: string; url: string } => l !== null)
        .slice(0, 5),
      sns_share: formData.get('sns_share') === 'on',
      sns_display_name: String(formData.get('sns_display_name') ?? '').trim() || undefined,
    }).catch((e: unknown) => {
      // 保存後に詳細ページへ移る処理（redirect）も例外として届くので、それはそのまま投げ直す
      unstable_rethrow(e)
      console.error('[freefree/edit] 保存に失敗:', e)
      return { error: e instanceof Error ? e.message : String(e) }
    })
  }

  const links = Array.isArray(post.links)
    ? (post.links as { label?: unknown; url?: unknown }[]).map((l) => ({ label: String(l.label ?? ''), url: String(l.url ?? '') }))
    : []

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500"><Link href={`/freefree/${id}`} className="hover:underline">← 掲載に戻る</Link></nav>
        <h1 className="text-3xl font-serif font-bold">掲載を編集</h1>
        <EditFreefreeForm
          action={handleUpdate}
          postId={id}
          userId={user.id}
          categories={FREEFREE_CATEGORIES.map(({ key, label }) => ({ key, label }))}
          initial={{
            title: post.title ?? '',
            body: post.body ?? '',
            category: post.category ?? 'event',
            location: post.location ?? '',
            endDate: post.expires_at ? jstYmdOf(post.expires_at) : maxEnd,
            startDate: post.event_start_date ?? '',
            images: (post.images as string[] | null) ?? [],
            links,
            snsShare: post.sns_share !== false,
            snsDisplayName: post.sns_display_name ?? '',
          }}
          maxEnd={maxEnd}
          isOrgPost={post.poster_type === 'org'}
        />
      </div>
    </div>
  )
}
