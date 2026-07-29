'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VOTE_CHOICES } from '@/lib/categories'

const TIER_LABEL: Record<string, string> = {
  light: 'ライト登録',
  email_only: '通常登録',
  verified: 'マイナンバー確認済（将来）',
}

const CHOICE_COLORS: Record<string, string> = {
  ...Object.fromEntries(VOTE_CHOICES.map((c) => [c.key, c.color])),
  // 選択肢統一（2026-07-29）以前の諮問的提案で投じられた票の色。
  // 集計には残るため表示だけ維持する
  '協力できる': 'bg-emerald-500',
  '難しい': 'bg-amber-400',
  'わからない': 'bg-slate-400',
}

export type Aggregate = {
  tier: string
  choice: string
  count: number
  weight_total: number | string
}

const sumCount = (rows: Aggregate[]) => rows.reduce((s, a) => s + Number(a.count ?? 0), 0)
const sumWeight = (rows: Aggregate[]) => rows.reduce((s, a) => s + Number(a.weight_total ?? 0), 0)

export function LiveLayerBars({
  proposalId,
  initialAggregates,
  choices,
  liveEnabled,
}: {
  proposalId: string
  initialAggregates: Aggregate[]
  choices: string[]
  liveEnabled: boolean
}) {
  const [aggregates, setAggregates] = useState<Aggregate[]>(initialAggregates)
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    if (!liveEnabled) return

    const supabase = createClient()

    const refetch = async () => {
      const { data } = await supabase
        .from('vote_aggregates')
        .select('tier, choice, count, weight_total')
        .eq('proposal_id', proposalId)
      if (data) {
        setAggregates(data as Aggregate[])
        setPulsing(true)
        setTimeout(() => setPulsing(false), 600)
      }
    }

    const channel = supabase
      .channel(`vote-agg-${proposalId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vote_aggregates',
          filter: `proposal_id=eq.${proposalId}`,
        },
        () => { void refetch() }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [proposalId, liveEnabled])

  const tiers = ['verified', 'email_only', 'light'] as const

  // 現在の選択肢に、選択肢統一より前に投じられた票の選択肢を足したもの。
  // これを描画対象にしないと、票数はあるのに棒が描かれない選択肢が出てしまう
  const legacyChoices = Array.from(new Set(aggregates.map((a) => a.choice)))
    .filter((c) => !choices.includes(c))
  const allChoices = [...choices, ...legacyChoices]

  const totalCount = sumCount(aggregates)
  const totalWeight = sumWeight(aggregates)

  return (
    <div className={`space-y-3 transition ${pulsing ? 'opacity-70' : ''}`}>
      {/* 合算。登録区分をまたぐため個人が特定されにくく、人数によらず内訳を出す */}
      <div className="space-y-1.5 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
          <span>全体</span>
          <span>
            {totalCount === 0 ? '票なし' : `${totalCount}名 / 重み${totalWeight.toFixed(1)}`}
          </span>
        </div>
        <div className="flex h-7 rounded overflow-hidden bg-slate-100 dark:bg-slate-800">
          {totalWeight > 0 && allChoices.map((choice) => {
            const rows = aggregates.filter((a) => a.choice === choice)
            const pct = (sumWeight(rows) / totalWeight) * 100
            if (pct <= 0) return null
            return (
              <div
                key={choice}
                className={`${CHOICE_COLORS[choice] ?? 'bg-slate-500'} text-xs text-white flex items-center justify-center transition-all duration-500`}
                style={{ width: `${pct}%` }}
                title={`${choice}: ${pct.toFixed(0)}%`}
              >
                {pct > 12 ? choice : ''}
              </div>
            )
          })}
        </div>
        {totalCount > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
            {allChoices.map((choice) => {
              const rows = aggregates.filter((a) => a.choice === choice)
              const count = sumCount(rows)
              if (count === 0) return null
              const weight = sumWeight(rows)
              const pct = totalWeight > 0 ? (weight / totalWeight) * 100 : 0
              return (
                <li key={choice} className="flex items-center gap-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${CHOICE_COLORS[choice] ?? 'bg-slate-500'}`} />
                  <span className="text-slate-800 dark:text-slate-200">{choice}</span>
                  <span>{count}名</span>
                  <span className="text-slate-400">
                    （重み{weight.toFixed(1)} / {Math.round(pct)}%）
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {legacyChoices.length > 0 && (
          <p className="text-[10px] text-slate-400">
            ※ 「{legacyChoices.join('・')}」は選択肢を統一する前に投じられた票です。
            賛否の判定には数えず、参加者数（定足数）にのみ数えます
          </p>
        )}
      </div>

      {/* 登録区分ごと */}
      {tiers.map((tier) => {
        const tierAggs = aggregates.filter((a) => a.tier === tier)
        const tierCount = sumCount(tierAggs)
        const tierWeight = sumWeight(tierAggs)
        const hide = tierCount > 0 && tierCount < 5

        return (
          <div key={tier} className="space-y-1">
            <div className="flex justify-between text-xs text-slate-500">
              <span>{TIER_LABEL[tier]}</span>
              <span>
                {tierCount === 0
                  ? '票なし'
                  : hide
                  ? `${tierCount}名（あと${5 - tierCount}名で内訳を表示）`
                  : `${tierCount}名 / 重み${tierWeight.toFixed(1)}`}
              </span>
            </div>
            <div className="flex h-6 rounded overflow-hidden bg-slate-100 dark:bg-slate-800">
              {!hide && tierWeight > 0 && allChoices.map((choice) => {
                const rows = tierAggs.filter((a) => a.choice === choice)
                const pct = (sumWeight(rows) / tierWeight) * 100
                if (pct <= 0) return null
                return (
                  <div
                    key={choice}
                    className={`${CHOICE_COLORS[choice] ?? 'bg-slate-500'} text-xs text-white flex items-center justify-center transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                    title={`${choice}: ${pct.toFixed(0)}%`}
                  >
                    {pct > 12 ? choice : ''}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {tiers.some((tier) => {
        const c = sumCount(aggregates.filter((a) => a.tier === tier))
        return c > 0 && c < 5
      }) && (
        <p className="text-[10px] text-slate-400 pt-1">
          ※ 5名未満の登録区分は、誰がどう投票したか推測されないよう内訳を伏せています（票は集計されています）
        </p>
      )}
      {liveEnabled && (
        <p className="text-[10px] text-slate-400 flex items-center gap-1.5 pt-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          リアルタイム更新中
        </p>
      )}
    </div>
  )
}
