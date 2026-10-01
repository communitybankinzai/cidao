import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { addMonitorAccount, deleteMonitorAccount, listMonitorAccounts, setMonitorAccountEnabled } from './actions'

// 管理画面「SNS モニタ対象」：Instagram のイベント告知を自動で候補にするアカウントの一覧。
// 団体は団体編集の SNS 欄（Instagram URL）で入れると自動でここに載る（種別「団体」・団体名つき）。
// 企業・行政など CiDAO に登録されないものはここで追加する。読むのは毎朝 06:32。

const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default async function AdminSnsMonitorPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: isAdmin, error: rpcErr } = await supabase.rpc('is_admin')
  if (rpcErr || !isAdmin) redirect('/')

  const sp = await searchParams
  const rows = await listMonitorAccounts()
  const enabledCount = rows.filter((r) => r.enabled).length

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <nav className="text-xs text-slate-500 flex gap-3">
          <Link href="/" className="hover:underline">← ホーム</Link>
          <Link href="/admin" className="hover:underline">管理</Link>
          <Link href="/admin/events/import" className="hover:underline">イベント一括取り込み</Link>
        </nav>

        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Admin</p>
          <h1 className="text-3xl font-serif font-bold">SNS モニタ対象（Instagram）</h1>
          <p className="text-xs text-slate-500">
            ここに載ったアカウントの投稿を毎朝 06:32 に読み、チラシ画像から催しを読み取って「イベント一括取り込み」の候補（下書き）にします。
            団体は<Link href="/orgs" className="underline">団体検索</Link>から団体ページ →「編集」の SNS 欄に Instagram の URL を入れると、自動でここに載ります（種別「団体」）。
            企業・行政など CiDAO に登録されないものは下のフォームで追加してください。
            読めるのは Instagram のビジネス／クリエイターアカウントだけです（個人アカウントは「見つからない」になります）。
            有効 {enabledCount} ／ 全 {rows.length} 件
          </p>
        </header>

        {sp.ok && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{sp.ok}</p>}
        {sp.error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">{sp.error}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold mb-2">追加する</h2>
          <form action={addMonitorAccount} className="grid gap-3 md:grid-cols-[1fr_1fr_auto_1fr_auto] md:items-end">
            <label className="text-xs text-slate-600 dark:text-slate-300">
              Instagram の URL か @ユーザー名
              <input name="input" required placeholder="https://www.instagram.com/inzai_shokokai/" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="text-xs text-slate-600 dark:text-slate-300">
              表示名
              <input name="label" placeholder="印西市商工会" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="text-xs text-slate-600 dark:text-slate-300">
              種別
              <select name="kind" defaultValue="企業" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="企業">企業</option>
                <option value="行政">行政</option>
                <option value="団体">団体</option>
                <option value="その他">その他</option>
              </select>
            </label>
            <label className="text-xs text-slate-600 dark:text-slate-300">
              メモ（任意）
              <input name="note" placeholder="例：セミナー・相談会の告知が多い" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">追加</button>
          </form>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">一覧</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">まだありません。</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left">アカウント</th>
                    <th className="px-3 py-2 text-left">種別</th>
                    <th className="px-3 py-2 text-left">団体</th>
                    <th className="px-3 py-2 text-left">直近の確認</th>
                    <th className="px-3 py-2 text-left">状態</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 ${r.enabled ? '' : 'opacity-60'}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.label || r.username}</div>
                        <a href={r.profile_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline dark:text-blue-300">@{r.username} ↗</a>
                        {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.kind}</td>
                      <td className="px-3 py-2">
                        {r.org_id ? <Link href={`/orgs/${r.org_id}`} className="text-blue-700 hover:underline dark:text-blue-300">{r.org_name ?? '団体ページ'}</Link> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {r.last_checked_at ? fmt.format(new Date(r.last_checked_at)) : <span className="text-slate-400">まだ</span>}
                        {r.last_post_at && <div className="text-slate-500">最新投稿 {fmt.format(new Date(r.last_post_at))}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {!r.enabled ? (
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">停止中</span>
                        ) : r.last_error ? (
                          <span className="text-rose-700 dark:text-rose-300">⚠ {r.last_error}</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-300">OK</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex gap-2">
                          <form action={setMonitorAccountEnabled.bind(null, r.id, !r.enabled)}>
                            <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
                              {r.enabled ? '停止' : '再開'}
                            </button>
                          </form>
                          <form action={deleteMonitorAccount.bind(null, r.id)}>
                            <button type="submit" className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-900/30">
                              削除
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">
            「停止」は読みに行かなくなるだけで、既に候補にしたものは残ります。団体の行を削除しても、団体編集の SNS 欄に URL が残っていれば翌朝また載ります（止めたいときは「停止」）。
          </p>
        </section>
      </div>
    </div>
  )
}
