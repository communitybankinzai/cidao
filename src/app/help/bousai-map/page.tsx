import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import Link from 'next/link'
import type { Metadata } from 'next'
import { DISASTER_MAP_URL } from '@/lib/cbi-site-urls'

export const metadata: Metadata = {
  title: '防災MAP 冠水した道の記録のしかた・直し方 | 使い方ヘルプ | CiDAO',
  description:
    'CBIの防災MAP（印西市 災害状況整合マップ）で、通れなかった道・通れた道を記録する方法と、送ったあとに直す方法の説明（動画つき）。',
}

const card =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3 scroll-mt-16'
const body = 'text-sm leading-relaxed text-slate-600 dark:text-slate-400'
const link = 'text-blue-600 hover:underline'

// 動画と表紙は防災MAPと同じ GitHub Pages に置く（CiDAO の配信量を増やさないため・2026-11-24）
const VIDEO_BASE = 'https://communitybankinzai.github.io/cbi-site/assets/help'
const MAP_RAIN_URL = `${DISASTER_MAP_URL}?mode=rain`

// 防災MAPの「冠水した道」の記録のしかたと直し方（2026-11-24 の更新：時刻の指定・送ったあと24時間は本人が直せる）。
// 書いてあることは防災MAP（cbi-site の inzai-disaster-map）の実装と、本番で確かめた動きだけ
export default function HelpBousaiMapPage() {
  return (
    <PageShell feature="help" width="narrow">
      <PageHeader
        feature="help"
        title="防災MAP 冠水した道の記録のしかた・直し方"
        back={{ href: '/help', label: '使い方ヘルプ' }}
        description="大雨のときに通れなかった道・通れた道を、地図の道をなぞって匿名で記録できます。送ったあと24時間は、ご本人が直せます。"
      />

      <section className={card} aria-label="使い方の動画">
        <h2 className="text-lg font-semibold">🎬 動画で見る</h2>
        <video
          controls
          playsInline
          preload="none"
          poster={`${VIDEO_BASE}/bousai-road-record.jpg`}
          className="w-full max-h-[70vh] rounded-md bg-black"
        >
          <source src={`${VIDEO_BASE}/bousai-road-record.mp4`} type="video/mp4" />
          お使いのブラウザでは動画を再生できません。下の文章をご覧ください。
        </video>
        <p className="text-xs text-slate-500 dark:text-slate-400">字幕つき。音を出さずに見られます。</p>
      </section>

      <section id="record" className={card}>
        <h2 className="text-lg font-semibold">記録のしかた</h2>
        <ol className={`${body} list-decimal pl-5 space-y-1`}>
          <li>
            <a href={MAP_RAIN_URL} target="_blank" rel="noopener noreferrer" className={link}>防災MAP（冠水の用途）↗</a>
            を開き、「🚫 通れない道」か「🔵 通れた道」を押します。
          </li>
          <li>地図の道を、始まり → 曲がり角 → 終わりの順にタップしてなぞります。点は指で動かせ、点の間の「＋」で経過点を足せます。</li>
          <li>
            「いつの状況？」で、通った時刻を選びます。「🕐 時刻を指定」なら、24時間以内の○時○分ごろを入れられます。
          </li>
          <li>「完了」を押すと、匿名の記録として地図に載ります。</li>
        </ol>
        <p className={body}>
          記録は、その時刻のアメダス（我孫子・佐倉・船橋・成田の平均）の雨量と一緒に残ります。
          通った時刻を入れていただくほど、「どれくらい降ると、どの道が通れなくなるか」の目安が正確になります。
        </p>
      </section>

      <section id="edit" className={card}>
        <h2 className="text-lg font-semibold">送ったあとに直す（24時間以内）</h2>
        <ol className={`${body} list-decimal pl-5 space-y-1`}>
          <li>地図の、自分が送った線を押します。</li>
          <li>吹き出しの「✏ この記録を直す」を押します。</li>
          <li>点を指で動かす・「＋」で経過点を足す・時刻とメモを直す、ができます。</li>
          <li>「完了（直した内容を保存）」を押します。時刻を直したときは、その時刻の雨量を取り直します。</li>
        </ol>
        <div className="rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
            <li>直せるのは、記録を送ったスマホ・ブラウザからだけです（ほかの人の記録は直せません）。</li>
            <li>送ってから10分以内なら、記録ごと取り消すこともできます。</li>
            <li>写真の差し替えはできません。間違えた写真は、記録ごと取り消してください。</li>
            <li>「✏ この記録を直す」が出ないときは、防災MAPを一度閉じて開き直してください。</li>
          </ul>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">ご注意</h2>
        <p className={body}>
          市民の記録は、いまの通行を保証するものではありません。通行止め・避難の情報は、印西市・千葉県などの公式発表を優先してください。
          防災MAPは CBI（Community Bank Inzai）の試作で、印西市の公式情報ではありません。
        </p>
        <p className={body}>
          うまく使えないときは
          <Link href="/bug-report?source=cidao_app&category=question" className={`${link} mx-1`}>運営に相談・不具合を知らせる</Link>
          からお知らせください。
        </p>
      </section>
    </PageShell>
  )
}
