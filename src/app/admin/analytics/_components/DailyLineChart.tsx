// アクセス分析の日別折れ線（SVG・2系列）。
//
// a = 青の実線、b = 橙の破線。色以外（実線／破線）でも区別できるようにしてある。
// PV/VV でも 3Dワールド/防災MAP でも同じ部品で描く（凡例は呼び出し側が出す）。
//
// 外れ値クリップ:
//   2026-08-26 にボット由来で /events だけが 6,043PV 記録され（6,034端末が1PVのみ・
//   12時間ほぼ一定レート）、縦軸が 6,103 に張り付いて通常の40〜80PVが底に潰れて読めなくなった。
//   上位1割の水準（90パーセンタイル）の1.2倍を上限に切り、切った日は上端の▲と
//   グラフ下の注記で実数を示す（値は隠さない）。
//
//   クリップは「1〜2日だけが桁違いに外れている」ときに限る:
//     (1) 上限を超える日が2日以内
//     (2) 最大値が上限の3倍以上
//   両方を満たさなければ素直に最大値を縦軸にする。3Dワールド/防災MAP のように
//   「0の日が多く、たまに大きい値が出る」分布まで切ってしまうと、山そのものが
//   上端に張り付いてグラフが無意味になるため。
//   実データでの挙動（2026-09-09 時点・直近30日）:
//     PV/VV        → p90=185・上限222・超過2日（8/25・8/26）→ クリップ有効
//     3D/防災MAP   → p90=15・上限18・超過4日 → クリップ無効（縦軸197のまま）
//
// 呼び出し側は日付が連続した配列を渡すこと（記録のない日は 0 で埋める）。
// 日が飛んだ配列を渡すと、間隔が均等に描かれて推移を読み間違える。

export type DailyPoint = { day: string; a: number; b: number }

type Props = {
  rows: DailyPoint[]
  labels: { a: string; b: string }
  ariaLabel: string
}

const W = 640
const H = 200
const PAD = { top: 10, right: 10, bottom: 24, left: 40 }

const fmtDay = (d: string) => d.slice(5).replace('-', '/')

export function DailyLineChart({ rows, labels, ariaLabel }: Props) {
  if (rows.length < 2) {
    return <p className="text-sm text-slate-500">グラフはデータが2日分たまると表示されます。</p>
  }

  const values = rows.flatMap((r) => [r.a, r.b])
  const sorted = [...values].sort((x, y) => x - y)
  const peak = Math.max(...values, 1)
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? peak
  const cap = Math.max(Math.round(p90 * 1.2), 10)
  const clipped = rows.filter((r) => r.a > cap || r.b > cap)
  const useCap = clipped.length > 0 && clipped.length <= 2 && peak >= cap * 3
  const max = useCap ? cap : peak

  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (rows.length - 1)
  const y = (v: number) => H - PAD.bottom - (Math.min(v, max) * (H - PAD.top - PAD.bottom)) / max
  const line = (key: 'a' | 'b') => rows.map((r, i) => `${x(i)},${y(r[key])}`).join(' ')
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
        <text x={PAD.left} y={H - 6} className="fill-slate-500 text-[11px]">{fmtDay(rows[0].day)}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500 text-[11px]">
          {fmtDay(rows[rows.length - 1].day)}
        </text>
        <polyline points={line('a')} fill="none" stroke="#2563eb" strokeWidth="2" />
        <polyline points={line('b')} fill="none" stroke="#ea580c" strokeWidth="2" strokeDasharray="5 3" />
        {useCap && clipped.map((r) => {
          const cx = x(rows.indexOf(r))
          return (
            <polygon
              key={r.day}
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
          {clipped
            .map((r) => `${fmtDay(r.day)} ${labels.a} ${r.a.toLocaleString()}／${labels.b} ${r.b.toLocaleString()}`)
            .join('、')}
        </p>
      )}
    </>
  )
}

// 凡例（実線＝a／破線＝b）。グラフの見出し行に置く
export function DailyLineChartLegend({ labels }: { labels: { a: string; b: string } }) {
  return (
    <p className="text-xs text-slate-500">
      <span className="inline-block w-4 border-t-2 border-[#2563eb] align-middle mr-1" />
      {labels.a}
      <span className="inline-block w-4 border-t-2 border-dashed border-[#ea580c] align-middle ml-3 mr-1" />
      {labels.b}
    </p>
  )
}
