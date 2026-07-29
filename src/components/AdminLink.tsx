import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

/**
 * 全ページ右上（通知ベルの左隣）に固定表示する管理画面への入口。
 *
 * - 管理者（is_admin）にだけ描画する。未ログイン・一般メンバーには何も出さない
 * - 隠すこと自体は防御ではない（/admin 側でも is_admin で弾いている）。
 *   一般メンバーの画面に運営用の導線を出さないための表示制御
 */
export async function AdminLink() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) return null

  return (
    <Link
      href="/admin"
      aria-label="管理画面"
      title="管理画面"
      // 通知ベル（right-3・幅40px）の左隣に8pxの間隔で並べる
      className="fixed top-3 right-[60px] z-50 flex items-center justify-center w-10 h-10 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 shadow hover:bg-slate-50 dark:hover:bg-slate-800 transition"
    >
      <span aria-hidden className="text-lg">⚙</span>
    </Link>
  )
}
