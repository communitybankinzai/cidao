import Link from 'next/link'
import { Button } from '@/components/ui/button'

// お店の方へ（2026-10-03）。ログイン不要で誰でも見られる案内ページ。
// 取込掲載の注意書き・SNS の投稿・店頭のチラシの QR コードは、すべてここに向ける。
// 書いてある機能（URL・チラシからの自動入力、写真3枚、クーポン、メタバースのお店ピン）は
// FreeFree の掲載フォーム（/freefree/new）に実在するものだけ。増減したら、この文面も直す。

const CONTACT_EMAIL = 'communitybankinzai@gmail.com'

export const metadata = {
  title: 'お店の方へ | FreeFree 地域応援掲示板',
  description: '印西のお店・教室・団体を無料で掲載できます。写真とPR文を、ご自身で登録できます。',
}

const STEPS = [
  { n: '1', title: 'CiDAOに登録（無料）', body: 'メールアドレスなどで登録します。登録は無料です。' },
  { n: '2', title: '掲載フォームに入力', body: 'お店のホームページやSNSのURLを貼る、またはチラシの写真を読み込むと、AIが入力の案を作ります。内容を確認して直してください。' },
  { n: '3', title: '公開', body: '掲載終了日（最長3か月先）を選んで公開します。期間を過ぎたら、いつでも再掲載できます。' },
]

const FEATURES = [
  '写真（最大3枚）とPR文を、ご自身の言葉で載せられます',
  'ホームページ・オンラインショップ・SNSへのリンクを付けられます',
  'クーポンを付けられます',
  '住所を入れると、3D地図「メタバース印西」にお店のピンを出せます',
]

export default function ForShopsPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-2xl mx-auto space-y-8">
        <nav className="text-xs text-slate-500"><Link href="/freefree" className="hover:underline">← FreeFree</Link></nav>

        <header className="space-y-3">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">For Shops</p>
          <h1 className="text-3xl font-serif font-bold">お店の方へ</h1>
          <p className="text-slate-700 dark:text-slate-300">
            FreeFree 地域応援掲示板は、印西の小さなお店・教室・団体を応援する掲示板です。
            <strong>無料で掲載できます。</strong>写真とPR文は、ご自身で登録できます。
          </p>
        </header>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">掲載までの3ステップ</h2>
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-bold flex items-center justify-center">{s.n}</span>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link href="/login?next=/freefree/new"><Button>CiDAOに登録して掲載する</Button></Link>
            <Link href="/freefree"><Button variant="outline">掲載の例を見る</Button></Link>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-semibold">できること</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            {FEATURES.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-semibold">すでに運営が作った掲載がある場合</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            公開されているデータをもとに、運営が先に掲載を作っているお店があります。そのお店は、次のどちらでも構いません。
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <li>ご自身で新しく掲載してください。お知らせいただければ、運営が作った掲載を、ご自身の掲載に入れ替えます（非公開にします）。</li>
            <li>内容の訂正や、掲載の削除をご希望の場合も、下の連絡先までお知らせください。</li>
          </ul>
          <p className="text-sm">
            連絡先：<a className="text-sky-700 dark:text-sky-400 hover:underline" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('FreeFree掲載について')}`}>{CONTACT_EMAIL}</a>（CBI）
          </p>
        </section>

        <p className="text-xs text-slate-500">
          現在、口コミ・評価の掲載は行っていません。掲載内容の責任は、掲載者（ご自身で登録した場合は、お店）にあります。
        </p>
      </article>
    </div>
  )
}
