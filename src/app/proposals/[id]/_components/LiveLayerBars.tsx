'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const TIER_LABEL: Record<string, string> = {
  light: 'ライト登録',
  email_only: 'メール登録',
  verified: '住所確認済',
}

const CHOICE_COLORS: Record<string, string> = {
  '賛成': 'bg-emerald-500',
  '反対': 'bg-rose-500',
  '保留': 'bg-slate-400',
  '協力できる': 'bg-emerald-500',
  '難しい': 'bg-rose-500',
  'わからない': 'bg-slate-400',
}

export type Aggregate = {
  tier: string
  choice: string
  count: number
  weight_total: number | string
}

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

  return (
    <div className={`space-y-3 transition ${pulsing ? 'opacity-70' : ''}`}>
      {tiers.map((tier) => {
        const tierAggs = aggregates.filter((a) => a.tier === tier)
        const totalCount = tierAggs.reduce((s, a) => s + Number(a.count ?? 0), 0)
        const totalWeight = tierAggs.reduce((s, a) => s + Number(a.weight_total ?? 0), 0)
        const hide = totalCount > 0 && totalCount < 5

        return (
          <div key={tier} className="space-y-1">
            <div className="flex justify-between text-xs text-slate-500">
              <span>{TIER_LABEL[tier]}</span>
              <span>
                {totalCount === 0 ? '票なし' : hide ? '-（5名未満）' : `${totalCount}名 / 重み${totalWeight.toFixed(1)}`}
              </span>
            </div>
            <div className="flex h-6 rounded overflow-hidden bg-slate-100 dark:bg-slate-800">
              {!hide && totalWeight > 0 && choices.map((choice) => {
                const agg = tierAggs.find((a) => a.choice === choice)
                const pct = agg ? (Number(agg.weight_total ?? 0) / totalWeight) * 100 : 0
                if (pct === 0) return null
                return (
                  <div
                    key={choice}
                    className={`${CHOICE_COLORS[choice] ?? 'bg-slate-500'} text-xs text-white flex items-center justify-center transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                    title={`${choice}: ${pct.toFixed(0)}%`}
                  >
                    {pct > 10 ? choice : ''}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {liveEnabled && (
        <p className="text-[10px] text-slate-400 flex items-center gap-1.5 pt-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          リアルタイム更新中
        </p>
      )}
    </div>
  )
}
