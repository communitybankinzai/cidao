import Link from 'next/link'
import MatchChat from './_components/MatchChat'

export default function MatchPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500"><Link href="/" className="hover:underline">← ホーム</Link></nav>
        <header className="space-y-1">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Agent A7 · Match</p>
          <h1 className="text-3xl font-serif font-bold">マッチング相談</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            印西市内の市民活動団体 219 件を把握したマッチングエージェントが、あなたに合う活動を一緒に探します。
            「平日昼間しか動けない」「子ども向けの活動に興味」「環境保全に関わりたい」など、状況や関心を会話で伝えてください。
          </p>
        </header>
        <MatchChat />
      </div>
    </div>
  )
}
