// 食レポの登録実績：日別の棒グラフ（自動／手動の積み上げ）。依存なしの SVG（サーバー部品）
import type { DayCount } from '@/lib/gourmet-stats'
import { totals } from '@/lib/gourmet-stats'

const W = 720
const H = 160
const PAD = { l: 28, r: 8, t: 8, b: 22 }

export function RegistrationChart({ series, title }: { series: DayCount[]; title: string }) {
  const t = totals(series)
  const max = Math.max(1, ...series.map((d) => d.auto + d.manual))
  const top = Math.ceil(max / 2) * 2 // 目盛りは偶数に丸める
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const slot = innerW / series.length
  const bar = Math.max(2, slot * 0.7)
  const y = (v: number) => PAD.t + innerH - (v / top) * innerH
  const ticks = [0, top / 2, top]
  const label = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-slate-500">合計 {t.all} 件（自動 {t.auto}・手動 {t.manual}）</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}。合計${t.all}件、自動${t.auto}件、手動${t.manual}件`} className="w-full h-auto">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
            <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} className="fill-slate-500">{v}</text>
          </g>
        ))}
        {series.map((d, i) => {
          const x = PAD.l + slot * i + (slot - bar) / 2
          const hAuto = (d.auto / top) * innerH
          const hManual = (d.manual / top) * innerH
          return (
            <g key={d.day}>
              <title>{`${label(d.day)}：自動 ${d.auto}・手動 ${d.manual}`}</title>
              <rect x={x} y={y(d.manual)} width={bar} height={hManual} className="fill-sky-600" />
              <rect x={x} y={y(d.manual) - hAuto} width={bar} height={hAuto} className="fill-emerald-600" />
              {(i === 0 || i === series.length - 1 || i % 7 === 0) && (
                <text x={x + bar / 2} y={H - 6} textAnchor="middle" fontSize={9} className="fill-slate-500">{label(d.day)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" />自動（住所調べ・自動承認）</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-600" />手動（管理画面で承認）</span>
      </p>
    </section>
  )
}
