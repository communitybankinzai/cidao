import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import type { Metadata } from 'next'
import { BusMap } from './_components/BusMap'

// 印西バスマップ（2026-11-27 試作）。
// 「本数が少なく待つのが大変。今どこを走っているか見えれば安心」「バス停がどこにあり、どこを走るか分かればもっと利用する」という
// 市民アンケートの声から作った。バスの印は、時刻表とバス停の位置から計算した予測（実際の位置ではない）。
// ログインしていなくても見られる。サーバーの処理は使わない（データは public/bus/network.json）。

export const metadata: Metadata = {
  title: '印西バスマップ | CiDAO',
  description: '印西市内のバスが、いまどのあたりを走っている予定かを地図で見られます。バス停を押すと、次のバスまでの時間と時刻表が出ます。',
}

export default function BusPage() {
  return (
    <PageShell feature="help">
      <PageHeader
        feature="help"
        title="印西バスマップ（試作）"
        back={{ href: '/', label: 'ホーム' }}
        description="バス停を押すと、次のバスまでの時間が出ます。"
      />
      <BusMap />
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <ul className="list-disc space-y-1 pl-5">
          <li>いま載せているのは、ふれあいバス（7ルート・令和8年2月1日改正の時刻表）と、宗像路線（赤ルート・青ルート）・六合路線です。京成バスの路線は、順に追加します。</li>
          <li>ふれあいバスは、市が公開している時刻表をもとに、この地図の運営が時刻を写したものです。路線の線とバスの動きは、バス停からバス停までを道路に沿ってたどって作っています（実際に通る道と違う所があるかもしれません）。</li>
          <li>
            このページは、市民活動団体が自主的に作ったもので、印西市やバス会社が作ったものではありません。まちがいを見つけたら
            <a href="/bug-report?source=cidao_app&category=question" className="mx-1 text-blue-600 hover:underline">
              運営に相談・不具合を知らせる
            </a>
            からお知らせください。
          </li>
        </ul>
      </section>
    </PageShell>
  )
}
