/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import { Button } from '@/components/ui/button'

// お店・教室・団体向けのご利用ガイド（2026-10-04）。ログイン不要で誰でも見られる。
// 書いてある入力項目・上限は FreeFree の掲載フォーム（/freefree/new）に実在するものだけ。フォームを変えたら、この文面も直す。
// 「お店の方へ」（/freefree/for-shops）が入口の案内、こちらは掲載から取り下げまでの手順。
// バナー・動画・ポスターは public/freefree/（素材の元は CBI\branding\freefree\）。

const CONTACT_EMAIL = 'communitybankinzai@gmail.com'

export const metadata = {
  title: 'ご利用ガイド | FreeFree 地域応援掲示板',
  description: '印西のお店・教室・団体向けに、FreeFree 地域応援掲示板の説明、掲載するメリット、掲載から取り下げまでの手順をまとめました。',
}

const FACTS = [
  { title: '掲載は無料', body: '登録も掲載も、費用はかかりません' },
  { title: 'ご自身で書ける', body: '写真・PR文・リンクを自分で登録' },
  { title: 'いつでも取り下げ', body: 'CBIにお知らせください' },
]

// 「掲載すると、こうなります」。for-shops ページと同じ、実在する機能だけ。集客などの効果は約束しない。
const MERITS = [
  { title: 'お店の魅力を、ご自身の言葉と写真で伝えられる', body: '運営が作った掲載は、名前・住所・種別などの基本情報だけです。ご自身で登録すると、写真（最大3枚）とPR文で、こだわりや雰囲気を載せられます。' },
  { title: '見た人を、お店の窓口へつなげられる', body: 'ホームページ・Instagram・予約やオンラインショップへのリンクを、掲載ページに並べられます。' },
  { title: 'クーポンで、来店のきっかけを作れる', body: '掲載にクーポンを付けられます。使われた回数も見られます。' },
  { title: '営業時間や臨時休業を、すぐ直せる', body: '変わった情報は、ご自身でいつでも書き換えられます。運営に連絡して待つ必要はありません。' },
  { title: '3D地図「メタバース印西」にお店のピンが立つ', body: '住所を入れて希望すると、印西の3D地図の上にお店が出ます。' },
  { title: 'CBI公式SNSで紹介されることがある', body: '紹介を許可した掲載は、運営が内容を確認したうえで、公式SNS（Threads・Facebook・Instagram）で紹介する場合があります。紹介をお約束するものではありません。' },
]

const FIELDS: Array<[string, string]> = [
  ['タイトル', '40字まで。お店・教室・団体の名前や、催しの名前。'],
  ['本文', '1000字まで。こだわり、メニュー、場所、時間など。'],
  ['カテゴリ', '一覧から選びます。'],
  ['掲載終了日', '最長で、掲載日から3か月先まで。期間を過ぎたら、いつでも再掲載できます。'],
  ['写真', '最大3枚。'],
  ['リンク', 'ホームページ、オンラインショップ、InstagramなどのSNS。'],
  ['住所', '入れて希望すると、メタバース印西にお店のピンが出ます。ピンは掲載期間のあいだだけ出て、期限が切れると消えます。'],
  ['クーポン', '任意。内容（80字まで）、使う条件、使える回数の上限を決められます。有効期限は掲載期間と同じです。'],
  ['SNSでの紹介', '任意。許可すると、CBI公式SNSで紹介されることがあります。名前（屋号）を出す場合は、40字までで入力します。'],
]

function Num({ n }: { n: number }) {
  return <span className="shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm font-bold flex items-center justify-center mt-0.5">{n}</span>
}

export default function FreefreeGuidePage() {
  const mail = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('FreeFree掲載の取り下げ')}`
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <article className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/freefree/for-shops" className="hover:underline">← お店の方へ</Link></nav>

        <img src="/freefree/banner.png" width={1500} height={500} alt="FreeFree 地域応援掲示板　みんなで印西市をもりあげよう　フレー！フレー！" className="w-full h-auto rounded-lg border bg-white" />

        <header className="space-y-2">
          <h1 className="text-2xl font-serif font-bold">お店・教室・団体の方へ ご利用ガイド</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">掲載の仕方、直し方、やめ方をまとめました。登録も掲載も無料です。</p>
        </header>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">FreeFree 地域応援掲示板とは？</h2>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px] items-start">
            <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300 min-w-0">
              <p>印西の小さなお店・個人事業・団体・企業・行政を応援する、インターネット上の掲示板です。お店の紹介、教室や催しの案内、クーポンなどを載せて、地域の人に知ってもらうことができます。</p>
              <p>運営は、コミュニティバンク印西（CBI）です。「みんなで印西市をもりあげよう」を合言葉に、市民のデジタル参加の仕組み「CiDAO」の中で運営しています。</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {FACTS.map((f) => (
                  <div key={f.title} className="rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs leading-relaxed">
                    <b className="block text-sm">{f.title}</b>{f.body}
                  </div>
                ))}
              </div>
            </div>
            <div className="max-w-[220px] mx-auto sm:max-w-none">
              <video className="w-full aspect-[9/16] rounded-lg border bg-black" controls playsInline preload="metadata" poster="/freefree/promo-poster.jpg" aria-label="FreeFree の紹介動画（約13秒）">
                <source src="/freefree/promo.mp4" type="video/mp4" />
                お使いのブラウザでは動画を再生できません。
              </video>
              <p className="text-[11px] text-slate-500 mt-1">紹介動画（約13秒・音が出ます）</p>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">掲載すると、こうなります</h2>
          <ul className="space-y-3">
            {MERITS.map((m) => (
              <li key={m.title} className="flex gap-3">
                <span className="shrink-0 text-emerald-600" aria-hidden="true">✓</span>
                <div>
                  <p className="font-medium">{m.title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{m.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">口コミ・評価の掲載は行っていません。集客などの効果をお約束するものでもありません。</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/login?next=/freefree/new"><Button>CiDAOに登録して掲載する</Button></Link>
            <Link href="/freefree"><Button variant="outline">掲載の例を見る</Button></Link>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-5">
          <h2 className="text-lg font-semibold">掲載から取り下げまで</h2>

          <div className="flex gap-3">
            <Num n={1} />
            <div className="space-y-1">
              <p className="font-medium">CiDAOに登録する（無料）</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">上の「CiDAOに登録して掲載する」から、メールアドレスなどで登録します。</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Num n={2} />
            <div className="space-y-2 min-w-0">
              <p className="font-medium">掲載フォームに入力する</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">お店のホームページやSNSのURLを貼る、またはチラシの写真を読み込むと、AIが入力の案を作ります。<strong>内容は必ずご自身で確認して、直してから</strong>公開してください。</p>
              <dl className="text-sm divide-y border-y">
                {FIELDS.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[6.5em_minmax(0,1fr)] gap-2 py-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="flex gap-3">
            <Num n={3} />
            <div className="space-y-1">
              <p className="font-medium">公開する</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">入力を確認して公開すると、FreeFree の一覧に載ります。SNSでの紹介を許可した場合は、紹介する前にCBI運営が内容を確認します。</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Num n={4} />
            <div className="space-y-2">
              <p className="font-medium">内容を直す</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">営業時間や臨時休業など、変わった情報は、ご自身でいつでも書き換えられます。</p>
              <p className="text-sm rounded-md bg-sky-50 dark:bg-sky-950/40 px-3 py-2">SNSでの紹介を許可している掲載を書き換えると、運営があらためて内容を確認します。</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Num n={5} />
            <div className="space-y-2">
              <p className="font-medium">取り下げる（やめる）</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">掲載の取り下げは、<strong>いつでも自由</strong>です。理由の説明は要りません。</p>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                <li>下のメールアドレスに、取り下げたい掲載の名前をお知らせください。</li>
                <li>CBIが、掲示板から掲載を非公開（または削除）にします。</li>
                <li>SNSで紹介された投稿があれば、<strong>CBIが削除します。</strong>ご自身で各SNSに連絡する必要はありません。</li>
              </ol>
              <p className="text-sm">連絡先（CBI）：<a className="text-sky-700 dark:text-sky-400 hover:underline" href={mail}>{CONTACT_EMAIL}</a></p>
              <p className="text-sm rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 px-3 py-2">いまは、お店ご自身が掲示板から掲載を消す操作はできません。取り下げはメールでのお知らせになります。SNSの投稿は自動では消えないため、CBIが手作業で削除します。</p>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-semibold">運営が先に作った掲載があるお店へ</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">公開されているデータをもとに、運営が先に掲載を作っているお店があります。その場合は、次のどちらでも構いません。</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <li>ご自身で新しく掲載してください。お知らせいただければ、運営が作った掲載を非公開にして、ご自身の掲載に入れ替えます。</li>
            <li>内容の訂正や、掲載の削除をご希望の場合も、上の連絡先までお知らせください。</li>
          </ul>
        </section>

        <p className="text-xs text-slate-500">FreeFree 地域応援掲示板（CiDAO）／運営：コミュニティバンク印西（CBI）</p>
      </article>
    </div>
  )
}
