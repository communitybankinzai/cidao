import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { freefreeCategoryLabel } from '@/lib/freefree-categories'
import { likeFreefree, commentFreefree } from '../actions'

export default async function FreefreeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: post } = await supabase.from('freefree_posts').select('*').eq('id', id).single()
  if (!post) notFound()

  const { data: supports } = await supabase
    .from('supports')
    .select('id, kind, body, created_at, members(display_name)')
    .eq('post_id', id)
    .order('created_at', { ascending: false })

  const likes = supports?.filter((s) => s.kind === 'like') ?? []
  const comments = supports?.filter((s) => s.kind === 'comment') ?? []

  async function handleLike() { 'use server'; await likeFreefree(id) }
  async function handleComment(formData: FormData) {
    'use server'
    await commentFreefree(id, String(formData.get('body') ?? ''))
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/freefree" className="hover:underline">← FreeFree</Link></nav>

        <header className="space-y-2">
          <div className="text-xs text-slate-500">{freefreeCategoryLabel(post.category)}</div>
          <h1 className="text-3xl font-serif font-bold">{post.title}</h1>
          {post.location && <p className="text-sm text-slate-500">📍 {post.location}</p>}
        </header>

        <div className="bg-white dark:bg-slate-900 border rounded-lg p-6">
          <p className="whitespace-pre-wrap">{post.body}</p>
        </div>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm">応援 {likes.length} / コメント {comments.length}</span>
            {user && (
              <form action={handleLike}>
                <Button type="submit" size="sm">👍 応援する</Button>
              </form>
            )}
          </div>

          {user && (
            <form action={handleComment} className="space-y-2">
              <textarea name="body" rows={2} placeholder="応援メッセージを書く" className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
              <div className="flex justify-end">
                <Button type="submit" size="sm" variant="outline">コメント送信</Button>
              </div>
            </form>
          )}

          {comments.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              {comments.slice(0, 20).map((c) => {
                const mem = Array.isArray(c.members) ? c.members[0] : c.members
                return (
                  <div key={c.id} className="text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{mem?.display_name ?? '匿名'}</span>
                    <span className="text-xs text-slate-400 ml-2">{new Date(c.created_at).toLocaleDateString('ja-JP')}</span>
                    <p className="text-slate-600 dark:text-slate-400 mt-0.5">{c.body}</p>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </article>
    </div>
  )
}
