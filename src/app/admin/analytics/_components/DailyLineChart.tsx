// アクセス分析の日別折れ線（SVG）。1〜2系列を同じ縦軸で描く。
//
// PV/VV のように「同じ桁で並べて比較したい」ものは2系列で1枚に、
// 3Dワールド/防災MAP のように「桁が違って片方が平坦に潰れる」ものは1系列ずつ別グラフにする。
// 色に加えて実線／破線でも区別できるようにしてある（色が見分けにくい環境向け）。
//
// 外れ値クリップ:
//   2026-08-26 にボット由来で /events だけが 6,043PV 記録され（6,034端末が1PVのみ・
//   12時間ほぼ一定レート）、縦軸が 6,103 に張り付いて通常の40〜80PVが底に潰れて読めなくなった。
//   上位1割の水準（90パーセンタイル）の1.2倍を上限に切り、切った日は上端の▲と
//   グラフ下の注記で実数を示す（値は隠さない）。
//
//   クリップは「1〜2日だけが桁違いに外れている」ときに限る:
//     (1) 上限を超える日が2日以内
//     (2) 最大値が上限の10倍以上
//   両方を満たさなければ素直に最大値を縦軸にする。本物のアクセスの山まで切ってしまうと、
//   見せたい山が上端に張り付いてグラフが無意味になるため。倍率は「桁が違う」の目安で、
//   実データ（2026-09-09 時点・直近30日）では次のように分かれる:
//     PV/VV        上限222 / 最大6,103（27.5倍・ボット由来）→ クリップ有効
//     防災MAP単独   上限 49 / 最大  197（ 4.0倍・9/6-7の本物の山）→ クリップ無効（縦軸197）
//     3Dワールド単独 上限 18 / 最大   24（ 1.3倍）→ クリップ無効（縦軸24）
//
// 呼び出し側は日付が連続した配列を渡すこと（記録のない日は 0 で埋める）。
// 日が飛んだ配列を渡すと、間隔が均等に描かれて推移を読み間違える。

export type Series = {
  label: string
  values: number[]
  color: string
  dashed?: boolean
}

type Props = {
  days: string[]
  series: Series[]
  ariaLabel: string
}

const W = 640
const H = 200
const PAD = { top: 10, right: 10, bottom: 24, left: 40 }

export const CHART_BLUE = '#2563eb'
export const CHART_ORANGE = '#ea580c'

const fmtDay = (d: string) => d.slice(5).replace('-', '/')

export function DailyLineChart({ days, series, ariaLabel }: Props) {
  if (days.length < 2) {
    return <p className="text-sm text-slate-500">グラフはデータが2日分たまると表示されます。</p>
  }

  const values = series.flatMap((s) => s.values)
  const sorted = [...values].sort((x, y) => x - y)
  const peak = Math.max(...values, 1)
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? peak
  const cap = Math.max(Math.round(p90 * 1.2), 10)
  const clippedIdx = days
    .map((_, i) => i)
    .filter((i) => series.some((s) => (s.values[i] ?? 0) > cap))
  const useCap = clippedIdx.length > 0 && clippedIdx.length <= 2 && peak >= cap * 10
  const max = useCap ? cap : peak

  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (days.length - 1)
  const y = (v: number) => H - PAD.bottom - (Math.min(v, max) * (H - PAD.top - PAD.bottom)) / max
  const line = (s: Series) => days.map((_, i) => `${x(i)},${y(s.values[i] ?? 0)}`).join(' ')
  const gridValues = [0, Math.round(max / 2), max]

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
              className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1"
            />
            <text
              x={PAD.left - 6} y={y(v) + 4} textAnchor="end"
              className="fill-slate-500 text-[11px]"
            >
              {v.toLocaleString()}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="fill-slate-500 text-[11px]">{fmtDay(days[0])}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500 text-[11px]">
          {fmtDay(days[days.length - 1])}
        </text>
        {series.map((s) => (
          <polyline
            key={s.label}
            points={line(s)}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeDasharray={s.dashed ? '5 3' : undefined}
          />
        ))}
        {useCap && clippedIdx.map((i) => {
          const cx = x(i)
          return (
            <polygon
              key={days[i]}
              points={`${cx},${PAD.top} ${cx - 4},${PAD.top + 7} ${cx + 4},${PAD.top + 7}`}
              fill="#dc2626"
            />
          )
        })}
      </svg>
      {useCap && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          ▲ 縦軸を {cap.toLocaleString()} で切っています（外れ値で他の日が読めなくなるため）。
          実数：
          {clippedIdx
            .map((i) =>
              `${fmtDay(days[i])} ` +
              series.map((s) => `${s.label} ${(s.values[i] ?? 0).toLocaleString()}`).join('／'),
            )
            .join('、')}
        </p>
      )}
    </>
  )
}

// 凡例。グラフの見出し行に置く
export function DailyLineChartLegend({ series }: { series: Series[] }) {
  return (
    <p className="text-xs text-slate-500">
      {series.map((s, i) => (
        <span key={s.label} className={i > 0 ? 'ml-3' : undefined}>
          <span
            className="inline-block w-4 border-t-2 align-middle mr-1"
            style={{ borderColor: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' }}
          />
          {s.label}
        </span>
      ))}
    </p>
  )
}
