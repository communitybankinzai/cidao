import Link from 'next/link'
import { Info } from 'lucide-react'

/**
 * 掲載の条件（2026-11-23 事業主指示）。掲示板・イベントの一覧と投稿画面の上のほうに出す。
 *
 * 中身は、投稿の自動類別（src/lib/content-review.ts）の実際の動きと合わせる：
 *   ・重い区分（反社会的な行為・詐欺や勧誘商法・誹謗中傷・個人情報のさらし・出会い目的）＝公開をいったん止めて運営が確認
 *   ・軽い区分（政治活動・宗教の勧誘・しつこい販売）＝公開したまま運営が確認
 * 区分や扱いを変えたら、ここと「よくある質問」（src/lib/faq.ts の post-review）の文も直す。
 *
 *   line＝一覧用の1行（見るだけの人が多いので、投稿を下へ押しやらない）
 *   full＝投稿画面用の全文
 */
const FAQ_HREF = '/help/faq#post-review'

export function PostingRules({ variant }: { variant: 'line' | 'full' }) {
  if (variant === 'line') {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
        <span>
          <b className="font-semibold text-slate-800 dark:text-slate-100">掲載の条件：</b>
          すべての投稿をAIが読み、反社会的な行為・政治活動・宗教の勧誘などに当たりそうなものは、運営が確認して掲載を判断します。{' '}
          <Link href={FAQ_HREF} className="whitespace-nowrap text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
            くわしく
          </Link>
        </span>
      </p>
    )
  }
  return (
    <section
      aria-label="掲載の条件"
      className="space-y-2 rounded-lg border border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
        <Info aria-hidden className="size-4 shrink-0 text-slate-500" />
        掲載の条件
      </h2>
      <p>
        投稿はすぐ載ります。すべての投稿をAIが読み、次に当たりそうなものは運営が確認して、掲載を続けるか判断します。
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          反社会的な行為への勧誘、詐欺・マルチ商法・投資の勧誘、誹謗中傷・差別、他人の個人情報、出会い目的
          <span className="block text-xs text-slate-500 dark:text-slate-400">公開をいったん止めて確認します（止めたときはお知らせします）</span>
        </li>
        <li>
          政治活動、宗教の勧誘、しつこい販売
          <span className="block text-xs text-slate-500 dark:text-slate-400">公開したまま確認します</span>
        </li>
      </ul>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        議会報告会、寺社の祭り、お店の通常の宣伝などは当たりません。{' '}
        <Link href={FAQ_HREF} className="whitespace-nowrap text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
          くわしく
        </Link>
      </p>
    </section>
  )
}
