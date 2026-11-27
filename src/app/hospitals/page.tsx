import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import type { Metadata } from 'next'
import { HospitalMap } from './_components/HospitalMap'
import { HOSPITALS, HOSPITALS_AS_OF, HOSPITALS_CITY_URL, HOSPITALS_EMERGENCY_URL, HOSPITALS_MHLW_URL } from '@/lib/hospitals'

// 病院マップ（2026-11-23）。休日に病院を探して困っている人を見かけた、という声から作った。
// 印西市には「今日の当番医」の表が無く、市の案内は「先に電話」。そこで、上に電話の案内を固定し、下に医療機関の地図と一覧を置く。
// 電話番号・受付時間は、印西市「急病のときには」（2026年7月31日更新）を 2026-11-23 に確かめたもの。市のページが変わったら、ここも直す。
// ログインしていなくても見られる。サーバーの処理は使わない（静的なページ）。

export const metadata: Metadata = {
  title: '病院マップ（印西市） | CiDAO',
  description: '印西市の病院・診療所・歯科を地図でさがせます。休日・夜間に具合が悪くなったときの電話の案内つき。',
}

type Call = { label: string; tel: string; show: string; note?: string }

function CallButton({ c, strong }: { c: Call; strong?: boolean }) {
  return (
    <a
      href={`tel:${encodeURIComponent(c.tel)}`}
      className={`flex min-h-14 flex-col justify-center rounded-lg px-3 py-2 ${
        strong ? 'bg-rose-600 text-white hover:bg-rose-700' : 'border border-slate-300 bg-white text-slate-900 hover:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
      }`}
    >
      <span className="text-sm font-semibold leading-snug">{c.label}</span>
      <span className={`text-lg font-bold tabular-nums ${strong ? '' : 'text-sky-700 dark:text-sky-300'}`}>📞 {c.show}</span>
      {c.note ? <span className={`text-xs leading-snug ${strong ? 'text-rose-50' : 'text-slate-500 dark:text-slate-400'}`}>{c.note}</span> : null}
    </a>
  )
}

const ASK: Call[] = [
  { label: '大人の急な病気・けがの相談', tel: '#7119', show: '#7119', note: '毎日24時間。看護師が相談にのります。つながらない電話からは 043-216-3668' },
  { label: '子どもの急な病気の相談', tel: '#8000', show: '#8000', note: '月〜土は午後7時〜翌朝8時、日曜・祝日は午前8時〜翌朝8時。つながらない電話からは 043-242-9939' },
  { label: '休日・夜間に診ている所を聞く（印西・白井）', tel: '0476-46-9981', show: '0476-46-9981', note: '印西地区消防組合 指揮指令課の休日診療電話案内' },
]

const VISIT: Call[] = [
  { label: '印西総合病院（休日・夜間の救急外来）', tel: '0476-33-3000', show: '0476-33-3000', note: '医師が交代で対応しています。必ず先に電話を' },
  { label: '日本医科大学千葉北総病院（休日・夜間の救急外来）', tel: '0476-99-1111', show: '0476-99-1111', note: '行く前に電話を' },
  {
    label: '子ども（15歳以下・内科の病気）：印旛市郡小児初期急病診療所（佐倉市）',
    tel: '043-485-3355',
    show: '043-485-3355',
    note: '受付は平日・土曜が午後7時〜10時45分、日曜・祝日・年末年始が午前9時〜午後4時45分と午後7時〜10時45分。必ず先に電話を',
  },
  {
    label: '大人（内科）・日曜と祝日と年末年始の夜：佐倉市休日夜間急病診療所',
    tel: '043-239-2020',
    show: '043-239-2020',
    note: '受付は午後7時〜9時45分。必ず先に電話を',
  },
]

export default function HospitalsPage() {
  const cityCount = HOSPITALS.filter((h) => !h.natOnly).length
  const dentalCount = HOSPITALS.filter((h) => h.kind === '歯科').length
  return (
    <PageShell feature="help">
      <PageHeader
        feature="help"
        title="病院マップ（印西市）"
        back={{ href: '/', label: 'ホーム' }}
        compact
        summary="印西市の病院・診療所・歯科を、地図と一覧でさがせます。休日や夜に具合が悪くなったときは、下の電話の案内を先に見てください。"
      />

      <section aria-labelledby="hospitals-emergency" className="space-y-3 rounded-lg border-2 border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950">
        <h2 id="hospitals-emergency" className="text-lg font-bold text-rose-900 dark:text-rose-100">
          休日・夜間に具合が悪くなったら（先に電話）
        </h2>
        <p className="text-sm leading-relaxed text-rose-900 dark:text-rose-100">
          印西市には「今日の当番の病院」の表はありません。休日・夜間は、行く前に電話で確かめる決まりになっています。ボタンを押すと電話がかかります。
        </p>
        <CallButton strong c={{ label: '意識がない・息が苦しい・強い胸の痛みなど、命にかかわるとき', tel: '119', show: '119', note: '迷わず救急車を' }} />
        <h3 className="pt-1 text-sm font-bold text-slate-800 dark:text-slate-100">行くかどうか迷ったら、電話で相談</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ASK.map((c) => (
            <CallButton key={c.tel} c={c} />
          ))}
        </div>
        <h3 className="pt-1 text-sm font-bold text-slate-800 dark:text-slate-100">休日・夜間に診てもらう</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {VISIT.map((c) => (
            <CallButton key={c.tel} c={c} />
          ))}
        </div>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          出典：印西市
          <a href={HOSPITALS_EMERGENCY_URL} target="_blank" rel="noopener noreferrer" className="mx-1 text-blue-600 hover:underline">
            「急病のときには」
          </a>
          （2026年7月31日更新）を、2026年11月23日に確かめました。受付の時間は変わることがあります。行くときは健康保険証などを持っていってください。
        </p>
      </section>

      <section aria-labelledby="hospitals-map" className="space-y-3">
        <h2 id="hospitals-map" className="text-lg font-bold text-slate-900 dark:text-slate-100">
          地図と一覧でさがす（医科{HOSPITALS.length - dentalCount}件・歯科{dentalCount}件）
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          「土曜午後も診療」「日曜も診療」「祝日も診療」の印は、市の一覧（{HOSPITALS_AS_OF}現在）のとおりに付けています。「要確認」は、日や週によって違う所です。診療の時間は載せていません。診療日は急に変わることがあるので、受診の前に、必ず電話か公式サイトで確かめてください。
        </p>
        <HospitalMap />
      </section>

      <section aria-labelledby="hospitals-source" className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <h2 id="hospitals-source" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          このページのもとの資料
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            名前・電話・所在地・診療科と、土曜午後・日曜・祝日の印（{cityCount}件）：印西市
            <a href={HOSPITALS_CITY_URL} target="_blank" rel="noopener noreferrer" className="mx-1 text-blue-600 hover:underline">
              「印西市内の医療機関」
            </a>
            （{HOSPITALS_AS_OF}現在）。市のホームページでの公開に、医療機関が了解したものが載っています。休診日は、市の一覧をご覧ください。
          </li>
          <li>
            位置・公式サイト・歯科の診療科と、市の一覧に無い{HOSPITALS.length - cityCount}件：厚生労働省
            <a href={HOSPITALS_MHLW_URL} target="_blank" rel="noopener noreferrer" className="mx-1 text-blue-600 hover:underline">
              「医療情報ネット」のオープンデータ
            </a>
            （2026年6月1日時点・CC BY 4.0）をもとに作りました。国のデータに位置が無いものは、国土地理院の住所検索で補っています。
          </li>
          <li>
            このページは、市民活動団体が自主的に作ったもので、印西市や医療機関が作ったものではありません。まちがいを見つけたら
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
