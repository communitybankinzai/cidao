import { PageShell } from '@/components/layout/PageShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { PushHowtoVideo } from '@/components/PushHowtoVideo'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '使い方ヘルプ | CiDAO',
  description: 'CiDAOの使い方。通知の仕組みと、受け取り方・止め方の説明。',
}

// 目次。項目が増えたらここに追記する
const TOC = [
  { id: 'notifications', label: '通知について（届くもの・止め方）' },
  { id: 'proposals', label: '提案の出し方（迷ったら運営に相談）' },
]

export default function HelpPage() {
  return (
    <PageShell feature="help" width="narrow">
      <PageHeader feature="help"
        title="使い方ヘルプ"
        description={
          <>
            CiDAOの使い方を説明します。わからないことや困ったことがあれば
            <Link href="/bug-report?source=cidao_app&category=question" className="mx-1 text-blue-600 hover:underline">運営に相談・不具合を知らせる</Link>
            からお知らせください。返事は画面右上のベル🔔に届きます。
          </>
        }
      />

      <nav className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
        <p className="text-xs font-semibold text-slate-500 mb-2">もくじ</p>
        <ul className="space-y-1 text-sm">
          {TOC.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="text-blue-600 hover:underline">{t.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section
        id="notifications"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5 scroll-mt-16"
      >
        <div>
          <h2 className="text-lg font-semibold">🔔 通知について</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            みんなに関わる出来事があったとき、画面右上のベル🔔でお知らせします。
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">どんなときに届くか</h3>
          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-5">
            <li>新しいイベントが登録されたとき</li>
            <li>FreeFree掲示板に新しい掲載があったとき</li>
            <li>新しい提案が出されたとき</li>
            <li>新しいメンバーが登録したとき</li>
            <li>あなたの人材バンクの紹介文が運営に承認され、「登録メンバー」一覧に載ったとき</li>
            <li>団体が登録されたとき・情報が更新されたとき</li>
            <li>運営からのお知らせがあったとき</li>
          </ul>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            このほか、自分の提案にコメントや投票があったときなど、
            自分に直接関わることも同じベルに届きます。
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">どこで読むか</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            画面右上のベル🔔を押すと、新しいものから順に表示されます。
            長い文章は途中までしか出ないので、
            ベルの一番下にある「すべての通知を見る」から
            <Link href="/notifications" className="text-blue-600 hover:underline mx-1">通知の一覧</Link>
            を開いてください。過去の通知もここで読めます。
          </p>
        </div>

        <div id="push-howto" className="space-y-2 scroll-mt-20">
          <h3 className="text-sm font-semibold">スマホにも通知を出したい</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            設定すると、CiDAOを開いていないときでもスマホの画面にお知らせが出ます。
          </p>
          <PushHowtoVideo className="py-1" />
          <ol className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-decimal pl-5">
            <li>
              <Link href="/me" className="text-blue-600 hover:underline">マイページ</Link>
              を開く
            </li>
            <li>「スマホ・PCへのプッシュ通知」の欄で、通知を有効にする</li>
            <li>スマホやパソコンから「通知を許可しますか」と聞かれたら「許可」を選ぶ</li>
          </ol>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <strong>iPhone・iPadの方は先にホーム画面への追加が必要です。</strong>
            <Link href="/install" className="text-blue-600 hover:underline mx-1">こちらの手順</Link>
            でホーム画面に追加してから、追加したアイコンで開いて設定してください。
            これはiPhoneの仕組み上の制限です。
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">通知を減らしたい・止めたい</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <Link href="/me/edit" className="text-blue-600 hover:underline">プロフィール編集</Link>
            の「通知の受け取り」で、種類ごとに切り替えられます。
          </p>
          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-5">
            <li>「新しいイベントのお知らせ」で「毎日18時にまとめて」を選ぶ → 新しいイベントを、毎日18時に1通でお知らせします（登録のたびのお知らせは届かなくなります）</li>
            <li>「新しいイベントのお知らせ」で「受け取らない」を選ぶ → 新しいイベントのお知らせと、参加登録・「行く予定」にしたイベントの前日のお知らせが止まります</li>
            <li>「FreeFree通知を受け取る」のチェックを外す → 新しい掲載の通知が止まります</li>
            <li>「提案・投票のメール通知を受け取る」のチェックを外す → 投票のご案内メールが止まります</li>
          </ul>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            スマホへの通知だけをやめたいときは、マイページの「スマホ・PCへのプッシュ通知」を
            無効にしてください。ベルには引き続き届きます。
          </p>
          <p className="text-xs text-slate-500">
            ※ 提案・メンバー登録・団体・運営からのお知らせは、現在オフにできません。
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">通知の内容に意見がある・うまく動かない</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <Link href="/notifications" className="text-blue-600 hover:underline">通知の一覧</Link>
            で、それぞれの通知の下にある「この件について意見・不具合を送る」から運営に送れます。
            どの通知についてのご連絡かは自動で運営に伝わります。
            運営が返信すると、その返事もベル🔔に届きます。
          </p>
        </div>
      </section>

      <section
        id="proposals"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5 scroll-mt-16"
      >
        <div>
          <h2 className="text-lg font-semibold">📮 提案の出し方</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            「こんなことをやってみたい」「こうなったらいいのに」を、みんなに聞いてみる仕組みです。
            まず気軽に出して、反応を見るための場なので、完成した企画書である必要はありません。
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">手順</h3>
          <ol className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-decimal pl-5">
            <li>
              ログインして
              <Link href="/proposals" className="text-blue-600 hover:underline mx-1">提案一覧</Link>
              を開き、「提案する」を押す
            </li>
            <li>タイトル（60字まで）と本文（2000字まで）を書く。本文は「なぜやりたいか」「何をするか」「費用の目安」があれば十分です</li>
            <li>カテゴリ・予算規模・拘束力の種類・実施予定日を選ぶ。関連するページがあればリンクを3つまで添える</li>
            <li>投稿すると、48時間の議論期間のあと自動で投票が始まります。投票の締切は四半期の末日（自分で日付を指定することもできます）</li>
          </ol>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">書き方に迷ったら</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <Link href="/bug-report?source=cidao_app&category=question&about=proposal" className="text-blue-600 hover:underline">運営に相談する</Link>
            から、考えていることをそのままの言葉で送ってください。運営が文を整えて、あなたの名前で提案として載せることもできます。
            返事は画面右上のベル🔔に届きます。
          </p>
          <p className="text-xs text-slate-500">
            ※ 道路の修繕など市に直接届けたほうが早いものは、提案を書く画面の「市の制度との使い分け」に窓口をまとめています。
          </p>
        </div>
      </section>

      <p className="text-xs text-slate-500 text-center">
        この先、FreeFree掲示板の使い方も順次ここに追加していきます。
      </p>
    </PageShell>
  )
}
