'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Sheet } from '@/components/ui/sheet'

/**
 * 画面下に固定する主要導線のタブ。
 *
 * これまで全ページ共通の導線は左上の「ホーム」ボタンだけで、
 * 団体・イベント・FreeFree へ移るにはいったんトップへ戻る必要があった。
 * 親指の届く下端に常設し、1タップで主要ページへ移れるようにする。
 *
 * 5枠に入りきらないものは「メニュー」のシートへ入れる（Sheet）。
 */
const TABS = [
  { href: '/', icon: '🏠', label: 'ホーム' },
  { href: '/orgs', icon: '🏛', label: '団体' },
  { href: '/events', icon: '📅', label: '予定' },
  { href: '/freefree', icon: '🎁', label: 'ゆずる' },
] as const

/** 「メニュー」を開くと出る導線。下タブに入らないものをここへ集約する */
const MENU_GROUPS: {
  title: string
  items: { href: string; icon: string; label: string; note: string }[]
}[] = [
  {
    title: 'さがす・参加する',
    items: [
      { href: '/proposals', icon: '🗳', label: '提案・投票', note: 'まちへの提案を見る・投票する' },
      { href: '/match', icon: '🤝', label: 'マッチング相談', note: 'AI と話しながら活動先を探す' },
      { href: '/talent', icon: '👥', label: 'メンバー一覧', note: '登録した人のPRを見る' },
      { href: '/ranking', icon: '🏆', label: 'ランキング', note: '活動の貢献度を見る' },
    ],
  },
  {
    title: '自分のこと',
    items: [
      { href: '/me', icon: '🙋', label: 'マイページ', note: '登録内容・受け取った声がけ' },
      { href: '/me/talent', icon: '✍️', label: 'PR（自己紹介）を作る', note: 'できること・興味を登録する' },
      { href: '/notifications', icon: '🔔', label: '通知', note: '届いたお知らせの一覧' },
    ],
  },
  {
    title: '使い方・その他',
    items: [
      { href: '/help', icon: '📖', label: '使い方ヘルプ', note: '通知の受け取り方・止め方' },
      { href: '/install', icon: '📲', label: 'ホーム画面に追加', note: 'アプリのように使う' },
      { href: '/bug-report', icon: '🐛', label: '不具合を知らせる', note: 'おかしい動きを報告する' },
    ],
  },
]

export function BottomNav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  // 管理画面は専用のタブUIを持つため、下タブは出さない
  if (pathname.startsWith('/admin')) return null

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  const menuActive = !TABS.some((t) => isActive(t.href))

  return (
    <>
      <nav
        aria-label="主要メニュー"
        className="fixed bottom-0 inset-x-0 z-50 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto max-w-lg grid grid-cols-5">
          {TABS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={isActive(t.href) ? 'page' : undefined}
                className={
                  'flex flex-col items-center justify-center gap-0.5 h-14 text-[10px] leading-none transition ' +
                  (isActive(t.href)
                    ? 'text-slate-900 dark:text-slate-100 font-semibold'
                    : 'text-slate-500 dark:text-slate-400')
                }
              >
                <span aria-hidden className="text-lg leading-none">
                  {t.icon}
                </span>
                <span>{t.label}</span>
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="そのほかのメニューを開く"
              data-instant="true"
              className={
                'w-full flex flex-col items-center justify-center gap-0.5 h-14 text-[10px] leading-none transition ' +
                (menuActive
                  ? 'text-slate-900 dark:text-slate-100 font-semibold'
                  : 'text-slate-500 dark:text-slate-400')
              }
            >
              <span aria-hidden className="text-lg leading-none">
                ☰
              </span>
              <span>メニュー</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="メニュー">
        <div className="space-y-4">
          {MENU_GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="text-[11px] font-semibold text-slate-400 tracking-wide mb-1.5">{g.title}</h3>
              <ul className="space-y-1">
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                      <span aria-hidden className="text-xl w-7 text-center shrink-0">
                        {it.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{it.label}</span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400">{it.note}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>
    </>
  )
}
