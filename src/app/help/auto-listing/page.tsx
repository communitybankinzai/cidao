import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '催しをカレンダーに載せるには（団体の方へ） | 使い方ヘルプ | CiDAO',
  description:
    'Instagram の告知をイベントカレンダーへ自動で載せるための条件（プロアカウント）と、自分で登録する方法の説明。',
}

const card =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3 scroll-mt-16'
const body = 'text-sm leading-relaxed text-slate-600 dark:text-slate-400'
const link = 'text-blue-600 hover:underline'

// 団体の運営担当の方へ：催しがイベントカレンダーに自動で載る条件と、載っていないときの2つの方法。
// Instagram の仕様は公式ヘルプ（プロアカウントの設定）で 2026-11-14 に確認した内容だけを書いている。
export default function HelpAutoListingPage() {
  return (
    <PageShell feature="help" width="narrow">
      <PageHeader
        feature="help"
        title="催しをカレンダーに載せるには（団体の方へ）"
        back={{ href: '/help', label: '使い方ヘルプ' }}
        description="Instagram でお知らせしている催しを、イベントカレンダーに載せる2つの方法を説明します。"
      />

      <section className={card}>
        <h2 className="text-lg font-semibold">📅 自動で載る催しと、載らない催しがあります</h2>
        <p className={body}>
          CiDAO は、運営が登録した Instagram アカウントの告知を毎朝読み取り、催しをイベントカレンダーに載せています。
        </p>
        <p className={body}>
          この読み取りができるのは、<strong>プロアカウント（ビジネスまたはクリエイター）</strong>だけです。
          個人用のアカウントは、Instagram の仕組みのうえで、自動の読み取りの対象になりません。
          そのため、告知をしていてもカレンダーに載っていない催しがあります。
        </p>
        <p className={body}>掲載を希望される団体の運営担当の方は、次のどちらかをお選びください。</p>
      </section>

      <section id="pro" className={card}>
        <h2 className="text-lg font-semibold">① Instagram をプロアカウントにして、運営に知らせる</h2>
        <ol className={`${body} list-decimal pl-5 space-y-1`}>
          <li>Instagram のプロフィールを開き、右上のメニューから「設定とアクティビティ」を開きます。</li>
          <li>「アカウントの種類とツール」→「プロアカウントに切り替える」を選びます。</li>
          <li>「クリエイター」か「ビジネス」のどちらかを選びます。</li>
          <li>
            <Link href="/bug-report?source=cidao_app&category=question" className={link}>運営に相談</Link>
            から、アカウント名をお知らせください。運営が読み取りの対象に加えます。
          </li>
        </ol>
        <div className="rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">切り替える前に知っておきたいこと</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
            <li>非公開のアカウントは、切り替えると公開になります。</li>
            <li>いつでも個人用のアカウントに戻せます。</li>
            <li>プロフィールに出る分野の表示（カテゴリラベル）は、隠すことができます。</li>
          </ul>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          手順と注意点は、
          <a
            href="https://help.instagram.com/502981923235522"
            target="_blank"
            rel="noopener noreferrer"
            className={link}
          >
            Instagram ヘルプセンター「プロアカウントを設定する」
          </a>
          の内容です（2026年11月14日に確認）。画面の名前は変わることがあります。
        </p>
      </section>

      <section id="direct" className={card}>
        <h2 className="text-lg font-semibold">② アカウントはそのままで、自分で登録する</h2>
        <p className={body}>
          アカウントの種類を変えたくないときは、イベントカレンダーに直接登録できます。
          チラシや告知の画像を読み込ませると、題名や日時が自動で入ります。
        </p>
        <p className={body}>
          <Link href="/events/new" className={link}>新しいイベントを登録する</Link>
          （ログインが必要です）
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">どちらも選ばない場合</h2>
        <p className={body}>
          公開されている告知を運営が見つけたときに、手で載せることがあります。すべてを拾うことはできません。
          載せてほしい催し、載せてほしくない催しがあるときは、
          <Link href="/bug-report?source=cidao_app&category=question" className={`mx-1 ${link}`}>運営に相談</Link>
          からお知らせください。
        </p>
      </section>
    </PageShell>
  )
}
