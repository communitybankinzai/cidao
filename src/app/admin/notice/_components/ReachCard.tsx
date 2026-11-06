import { REACH_BASELINE, type ReachSummary } from '@/lib/admin-reach'

type Tile = {
  key: keyof Omit<ReachSummary, 'total'>
  label: string
  hint: string
  /** 増えると良いか、減ると良いか。基準値との差の色分けに使う。null は良し悪しを付けない */
  better: 'up' | 'down' | null
}

const TILES: Tile[] = [
  { key: 'push', label: 'プッシュ購読', hint: 'アプリを閉じていてもスマホに届く人', better: 'up' },
  { key: 'loggedIn14d', label: '14日以内にログイン', hint: 'ベル🔔を見に来ている人', better: 'up' },
  { key: 'neverRead', label: '通知を一度も既読にしていない', hint: '届いているのに、開いたことがない人', better: 'down' },
  { key: 'light', label: '仮登録のまま', hint: '本登録に進んでいない人', better: 'down' },
  { key: 'offEvent', label: 'イベント通知をOFF', hint: '本人の選択。勝手に戻さない', better: null },
  { key: 'offFreeFree', label: 'FreeFree通知をOFF', hint: '本人の選択。勝手に戻さない', better: null },
]

function baselineDate(): string {
  const [, m, d] = REACH_BASELINE.date.split('-')
  return `${Number(m)}/${Number(d)}`
}

function DeltaBadge({ diff, better }: { diff: number; better: Tile['better'] }) {
  if (diff === 0) return <span className="text-slate-500">±0</span>
  const sign = diff > 0 ? '+' : '−'
  const good = better === null ? null : (diff > 0) === (better === 'up')
  const color =
    good === null
      ? 'text-slate-500'
      : good
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400'
  return <span className={color}>{sign}{Math.abs(diff)}</span>
}

export default function ReachCard({ reach }: { reach: ReachSummary }) {
  return (
    <section className="bg-white dark:bg-slate-900 border rounded-lg p-5 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">📡 お知らせは届いているか</h2>
        <p className="text-xs text-slate-500 mt-1">
          在籍 {reach.total}名のうちの人数です（{baselineDate()}時点は {REACH_BASELINE.total}名）。
          ベル🔔に通知を出しても、アプリを開かない人・プッシュを許可していない人には見てもらえません。
          右の数字は {baselineDate()} の実測との差です。
        </p>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TILES.map((t) => {
          const value = reach[t.key]
          const base = REACH_BASELINE[t.key]
          const pct = reach.total > 0 ? Math.round((value / reach.total) * 100) : 0
          return (
            <li key={t.key} className="rounded border border-slate-200 dark:border-slate-700 p-3 space-y-0.5">
              <div className="text-[11px] text-slate-500 leading-snug">{t.label}</div>
              <div className="text-2xl font-bold tabular-nums">
                {value}
                <span className="text-sm font-normal text-slate-500">名（{pct}%）</span>
              </div>
              <div className="text-[11px] tabular-nums">
                {baselineDate()}比 <DeltaBadge diff={value - base} better={t.better} />
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">{t.hint}</div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
