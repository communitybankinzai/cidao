import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import Link from 'next/link'
import type { Metadata } from 'next'
import { faqByGroup } from '@/lib/faq'
import { OpenDetailsFromHash } from '@/components/OpenDetailsFromHash'

// よくある質問（Q&A）。利用者からいただいた質問・要望と解決策をまとめる（2026-11-22）。
// 中身は src/lib/faq.ts に1件ずつ足す。ログインしていなくても読める（LINE ログインでつまずいた人が見るため）。

export const metadata: Metadata = {
  title: 'よくある質問（Q&A） | 使い方ヘルプ | CiDAO',
  description: 'CiDAOの使い方でよくいただく質問と、その解決策のまとめ。ログイン、イベントの登録、地域応援掲示板、団体さがし、投稿のルール、通知。',
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${y}年${m}月${d}日`
}

export default function HelpFaqPage() {
  const groups = faqByGroup()
  return (
    <PageShell feature="help" width="narrow">
      <PageHeader
        feature="help"
        title="よくある質問（Q&A）"
        back={{ href: '/help', label: '使い方ヘルプ' }}
        compact
        summary="みなさんからいただいた質問・ご要望と、その解決策をまとめています。"
        description={
          <>
            ここに無いことは
            <Link href="/bug-report?source=cidao_app&category=question" className="mx-1 text-blue-600 hover:underline">
              運営に相談・不具合を知らせる
            </Link>
            からお知らせください。いただいた声は、このページに足していきます。
          </>
        }
      />

      <OpenDetailsFromHash />

      <nav className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
        <p className="text-xs font-semibold text-slate-500 mb-2">もくじ</p>
        <ul className="space-y-1 text-sm">
          {groups.map((g) => (
            <li key={g.key}>
              <a href={`#${g.key}`} className="text-blue-600 hover:underline">
                {g.emoji} {g.label}（{g.items.length}件）
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {groups.map((g) => (
        <section
          key={g.key}
          id={g.key}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3 scroll-mt-16"
        >
          <h2 className="text-lg font-semibold">
            {g.emoji} {g.label}
          </h2>
          <div className="space-y-3">
            {g.items.map((item) => (
              <details
                key={item.id}
                id={item.id}
                className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 scroll-mt-16"
              >
                <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100 leading-relaxed">
                  Q. {item.q}
                </summary>
                <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {item.a.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  {item.link && (
                    <p>
                      <Link href={item.link.href} className="text-blue-600 hover:underline">
                        → {item.link.label}
                      </Link>
                    </p>
                  )}
                  <p className="text-xs text-slate-500">{formatDate(item.added)} に追加</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  )
}
