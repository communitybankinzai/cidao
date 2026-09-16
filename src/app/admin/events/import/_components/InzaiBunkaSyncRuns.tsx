// 文化ホール自動取り込み（/api/cron/inzai-bunka-sync）の実行記録。event_sync_runs を新しい順に表示する。
// 「今朝動いたか」「何件見て何件入れたか」「失敗していないか」をひと目で分かるようにする。

export type SyncRunRow = {
  id: string
  started_at: string
  finished_at: string
  ok: boolean
  dry_run: boolean
  fetched: { list?: number; details?: number; detailFailed?: number; calendar?: number; merged?: number; future?: number } | null
  inserted: number
  updated: number
  unchanged: number
  duplicates: number
  skipped: number
  errors: string[] | null
  detail: { inserted?: string[]; updated?: string[]; duplicates?: string[]; skipped?: string[] } | null
}

const fmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short',
})

function ageLabel(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}分前`
  if (hours < 48) return `${Math.round(hours)}時間前`
  return `${Math.round(hours / 24)}日前`
}

/** 最新の本実行（確認のみは除く）と、その経過時間。現在時刻の参照はコンポーネント本体の外で行う */
function summarize(runs: SyncRunRow[]) {
  const latest = runs.find((r) => !r.dry_run) ?? runs[0]
  const hours = latest ? (Date.now() - new Date(latest.started_at).getTime()) / 3_600_000 : Infinity
  return { latest, hours, stale: hours > 30 }
}

export function InzaiBunkaSyncRuns({ runs, subject = '文化ホール', unit = '件' }: { runs: SyncRunRow[]; subject?: string; unit?: string }) {
  const { latest, hours, stale } = summarize(runs)

  return (
    <div className="space-y-3">
      {/* 最新の1行を大きく */}
      {latest ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            !latest.ok
              ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
              : stale
                ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                : 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
          }`}
        >
          <p className="font-medium">
            {!latest.ok ? '⚠️ 最後の実行は失敗しました' : stale ? '⚠️ 30時間以上 実行されていません' : '✅ 動いています'}
            <span className="ml-2 font-normal text-slate-600 dark:text-slate-300">
              最終実行 {fmt.format(new Date(latest.started_at))}（{ageLabel(hours)}）
              {latest.dry_run && '・確認のみ'}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {subject}で {latest.fetched?.merged ?? 0} {unit}を見て、今日以降 {latest.fetched?.future ?? 0} {unit}のうち
            新規 {latest.inserted}・更新 {latest.updated}・変更なし {latest.unchanged}・手動登録と重複 {latest.duplicates}・除外 {latest.skipped}
          </p>
          {latest.errors && latest.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-red-700 dark:text-red-300">
              {latest.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          ⚠️ まだ一度も実行記録がありません（2026-09-16 導入。初回の記録は次の朝の定期実行以降に入ります）
        </div>
      )}

      {runs.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 hover:underline">直近 {runs.length} 回の記録</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="py-1 pr-3 font-normal">実行</th>
                  <th className="py-1 pr-3 font-normal">結果</th>
                  <th className="py-1 pr-3 font-normal text-right">見た</th>
                  <th className="py-1 pr-3 font-normal text-right">新規</th>
                  <th className="py-1 pr-3 font-normal text-right">更新</th>
                  <th className="py-1 pr-3 font-normal text-right">変更なし</th>
                  <th className="py-1 pr-3 font-normal text-right">重複</th>
                  <th className="py-1 pr-3 font-normal text-right">除外</th>
                  <th className="py-1 pr-3 font-normal text-right">秒</th>
                  <th className="py-1 font-normal">内訳</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const sec = Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)
                  const lines = [
                    ...(r.detail?.inserted ?? []).map((t) => `＋ ${t}`),
                    ...(r.detail?.updated ?? []).map((t) => `↻ ${t}`),
                    ...(r.errors ?? []).map((t) => `✕ ${t}`),
                  ]
                  return (
                    <tr key={r.id} className="border-b border-slate-100 align-top dark:border-slate-900">
                      <td className="py-1 pr-3 whitespace-nowrap">{fmt.format(new Date(r.started_at))}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">
                        {r.ok ? '成功' : <span className="text-red-600 dark:text-red-400">失敗</span>}
                        {r.dry_run && <span className="ml-1 text-slate-400">(確認のみ)</span>}
                      </td>
                      <td className="py-1 pr-3 text-right">{r.fetched?.merged ?? 0}</td>
                      <td className="py-1 pr-3 text-right">{r.inserted}</td>
                      <td className="py-1 pr-3 text-right">{r.updated}</td>
                      <td className="py-1 pr-3 text-right">{r.unchanged}</td>
                      <td className="py-1 pr-3 text-right">{r.duplicates}</td>
                      <td className="py-1 pr-3 text-right">{r.skipped}</td>
                      <td className="py-1 pr-3 text-right">{Number.isFinite(sec) ? sec : '-'}</td>
                      <td className="py-1 text-slate-600 dark:text-slate-300">
                        {lines.length === 0 ? <span className="text-slate-400">変更なし</span> : lines.map((l, i) => <div key={i}>{l}</div>)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
