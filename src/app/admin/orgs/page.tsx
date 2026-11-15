import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { HIDDEN_REASON_MAX, orgVisibilityKind } from '@/lib/org-visibility'
import { setOrgVisibility } from './actions'

export const dynamic = 'force-dynamic'

type OrgRow = {
  id: string
  name: string
  public_flag: boolean
  hidden_by_admin: boolean
  hidden_reason: string
  hidden_at: string | null
}

const SEARCH_LIMIT = 30

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' })
}

export default async function AdminOrgsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim().slice(0, 50)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 切り替えの処理（actions.ts）と同じ権限で入口も閉じる
  const { data: ok, error: rpcErr } = await supabase.rpc('is_committee_or_super')
  if (rpcErr || !ok) redirect('/')

  // 非公開の団体は RLS で運営にも見えないため、権限を確かめたうえで service_role で読む
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const admin = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin
    .from('organizations')
    .select('id, name, public_flag, hidden_by_admin, hidden_reason, hidden_at')
    .order('name')
  const orgs = (data ?? []) as OrgRow[]

  const hidden = orgs.filter((o) => orgVisibilityKind(o) === 'hidden')
  const pending = orgs.filter((o) => orgVisibilityKind(o) === 'pending')
  const publicOrgs = orgs.filter((o) => orgVisibilityKind(o) === 'public')
  const matched = q ? publicOrgs.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : []

  async function handleHide(formData: FormData) {
    'use server'
    const orgId = String(formData.get('org_id') ?? '')
    const reason = String(formData.get('reason') ?? '')
    if (orgId) await setOrgVisibility(orgId, false, reason)
  }

  async function handleShow(formData: FormData) {
    'use server'
    const orgId = String(formData.get('org_id') ?? '')
    if (orgId) await setOrgVisibility(orgId, true, '')
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
          <h1 className="text-3xl font-serif font-bold">団体の公開・非公開</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            団体から「載せないでほしい」と申し出があったときなどに、団体のページを非公開にします。
            非公開にしても削除はされず、あとで公開に戻せます。
            非公開の団体は、団体一覧・団体のページ・団体マッチングに出ません（その団体に所属する会員には見えます）。
            この画面で変わるのは団体のページだけです。その団体の催しは、催しの側で別に扱います。
          </p>
          <p className="text-xs text-slate-500">
            公開中 {publicOrgs.length}件／運営が非公開 {hidden.length}件／申告中（承認待ち） {pending.length}件
          </p>
        </header>

        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-4">
            団体の一覧を読めませんでした：{error.message}
          </p>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">運営が非公開にした団体（{hidden.length}件）</h2>
          {hidden.length === 0 && (
            <p className="text-sm text-slate-500 bg-white dark:bg-slate-900 border rounded-lg p-6">
              非公開にした団体はありません。
            </p>
          )}
          {hidden.map((o) => (
            <div key={o.id} className="bg-white dark:bg-slate-900 border rounded-lg p-4 space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{o.name}</span>
                <span className="text-xs rounded bg-slate-200 dark:bg-slate-800 px-2 py-0.5">非公開</span>
                {o.hidden_at && <span className="text-xs text-slate-500">{formatDate(o.hidden_at)} から</span>}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">理由：{o.hidden_reason || '（記入なし）'}</p>
              <form action={handleShow} className="pt-1 border-t border-slate-100 dark:border-slate-800">
                <input type="hidden" name="org_id" value={o.id} />
                <Button type="submit" size="sm" variant="outline">公開に戻す</Button>
              </form>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">公開中の団体を非公開にする</h2>
          <form method="get" className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="団体名の一部を入れて探す"
              maxLength={50}
              className="flex-1 text-sm border rounded px-3 py-2 bg-white dark:bg-slate-900"
            />
            <Button type="submit" size="sm">探す</Button>
          </form>
          {q && matched.length === 0 && (
            <p className="text-sm text-slate-500 bg-white dark:bg-slate-900 border rounded-lg p-6">
              「{q}」を含む公開中の団体はありません。
            </p>
          )}
          {q && matched.length > SEARCH_LIMIT && (
            <p className="text-xs text-slate-500">
              {matched.length}件あります。先頭の{SEARCH_LIMIT}件を出しています。団体名をもう少し長く入れてください。
            </p>
          )}
          {matched.slice(0, SEARCH_LIMIT).map((o) => (
            <div key={o.id} className="bg-white dark:bg-slate-900 border rounded-lg p-4 space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <Link href={`/orgs/${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                <span className="text-xs rounded bg-emerald-100 text-emerald-800 px-2 py-0.5">公開中</span>
              </div>
              <form action={handleHide} className="flex flex-wrap gap-2 items-center pt-1 border-t border-slate-100 dark:border-slate-800">
                <input type="hidden" name="org_id" value={o.id} />
                <input
                  type="text"
                  name="reason"
                  required
                  maxLength={HIDDEN_REASON_MAX}
                  placeholder="非公開にする理由（例：団体から申し出）"
                  className="flex-1 min-w-48 text-sm border rounded px-3 py-1.5 bg-white dark:bg-slate-900"
                />
                <Button type="submit" size="sm" variant="outline">非公開にする</Button>
              </form>
            </div>
          ))}
        </section>

        {pending.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">申告中の団体（{pending.length}件）</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              会員が登録して、運営の承認を待っている団体です。公開するかどうかは
              <Link href="/admin/claims" className="underline mx-1">所属申告・新規団体キュー</Link>
              で決めます。
            </p>
            <ul className="text-sm bg-white dark:bg-slate-900 border rounded-lg p-4 space-y-1">
              {pending.map((o) => (
                <li key={o.id}>{o.name}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
