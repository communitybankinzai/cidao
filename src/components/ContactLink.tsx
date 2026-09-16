import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

/**
 * 全ページ右上に固定表示する、運営への連絡の入口（2026-09-16 事業主決定・案B）。
 *
 * - ログインしている人にだけ出す（未ログインでも /bug-report 自体は送れるが、常設の導線は置かない）
 * - 運営（is_admin）には管理画面の⚙が並ぶため、その左隣に置く。一般メンバーは⚙が出ないのでベルの左隣
 * - これまで運営への連絡は /bug-report を直接開くか、通知ごとの「この件について意見・不具合を送る」しかなく、
 *   どの画面からでも届く道が無かった
 */
export async function ContactLink() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: isAdmin } = await supabase.rpc('is_admin')

  // 通知ベル（right-3・幅40px）→ 管理画面の⚙（right-[60px]）の順に 8px 間隔で並ぶ。その左隣に置く
  return (
    <Link
      href="/bug-report?source=cidao_app"
      aria-label="運営に連絡する"
      title="運営に連絡する（不具合・ご要望・質問）"
      className={`fixed top-3 ${isAdmin ? 'right-[108px]' : 'right-[60px]'} z-50 flex items-center justify-center w-10 h-10 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 shadow hover:bg-slate-50 dark:hover:bg-slate-800 transition`}
    >
      <span aria-hidden className="text-lg">💬</span>
    </Link>
  )
}
