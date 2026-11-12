'use client'

// 食レポの候補 1投稿＝1行。お店ごとにチェックと「選んだお店」（変えられる）を並べ、「選んだものを承認」の1タップで地図に出す
import { useState, useTransition } from 'react'
import { approveSelected, rejectPost, rejectSelected } from '../actions'
import type { StoredShop } from '@/lib/gourmet-candidates'

type Props = {
  id: string
  postUrl: string
  source: string
  authorHandle: string | null
  postedAt: string | null
  moreShops: boolean
  holdReason: string
  shops: StoredShop[]
}

const TONE: Record<string, string> = { positive: '好意的', neutral: '中立', negative: '批判的' }
const CONF: Record<string, string> = { high: '高', mid: '中', low: '低' }

export function CandidateCard(p: Props) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  // お店ごとの選択（チェック・選んだお店の参照）。決まったお店は操作しない
  const [checked, setChecked] = useState<boolean[]>(p.shops.map((s) => !s.decision && Boolean(s.chosen_ref)))
  const [refs, setRefs] = useState<string[]>(p.shops.map((s) => s.chosen_ref ?? s.matches[0]?.ref ?? ''))
  const held = Boolean(p.holdReason)

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => { const r = await fn(); setMsg(r.message) })
  const picks = () => p.shops.map((s, i) => ({ s, i })).filter(({ s, i }) => checked[i] && !s.decision && refs[i]).map(({ i }) => ({ index: i, ref: refs[i] }))

  return (
    <li className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a href={p.postUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 dark:text-sky-400 hover:underline">元の投稿を開く ↗</a>
        <span className="text-slate-500">{p.source === 'instagram-account' ? `@${p.authorHandle ?? '?'}（監視アカウント）` : '#印西 の検索'}</span>
        {p.postedAt && <span className="text-slate-500">{new Date(p.postedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span>}
        {p.shops.length > 1 && <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs">複数店の投稿（{p.shops.length}店）</span>}
      </div>
      {held && <p className="rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">承認できません：{p.holdReason}</p>}
      {p.moreShops && <p className="text-sm text-amber-700 dark:text-amber-300">ほかにもお店があります（11店以上）。元の投稿を見て、必要なら食レポマップから足してください。</p>}
      <ul className="space-y-2">
        {p.shops.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-sm border-t border-slate-100 dark:border-slate-800 pt-2">
            <input type="checkbox" aria-label={`${s.name}を選ぶ`} disabled={Boolean(s.decision)} checked={checked[i]} onChange={(e) => setChecked((c) => c.map((v, k) => (k === i ? e.target.checked : v)))} />
            <span className="font-medium">{s.name || '（店名なし）'}</span>
            <span className="text-slate-500">{s.area_hint}</span>
            <span className="text-xs text-slate-500">論調 {TONE[s.tone] ?? s.tone}・確度 {CONF[s.confidence] ?? s.confidence}</span>
            {s.decision ? (
              <span className={`text-xs font-semibold ${s.decision === 'approved' ? 'text-emerald-700' : 'text-slate-500'}`}>{s.decision === 'approved' ? '承認済み' : '却下'}</span>
            ) : s.matches.length ? (
              <select className="rounded border border-slate-300 dark:border-slate-700 bg-transparent px-1 py-0.5 text-xs" value={refs[i]} onChange={(e) => setRefs((r) => r.map((v, k) => (k === i ? e.target.value : v)))}>
                {s.matches.map((m) => <option key={m.ref} value={m.ref}>{m.name}（{m.municipality ?? ''}{m.area === 'near' ? '・周辺' : ''}）</option>)}
              </select>
            ) : (
              <span className="text-xs text-slate-500">地図にないお店（食レポマップの「地図に無いお店を足す」で足してから）</span>
            )}
            <span className="w-full text-xs text-slate-400">{s.reason}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || held || picks().length === 0} onClick={() => run(() => approveSelected(p.id, picks()))}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">選んだものを承認</button>
        <button type="button" disabled={pending || !checked.some((c, i) => c && !p.shops[i].decision)} onClick={() => run(() => rejectSelected(p.id, checked.map((c, i) => (c ? i : -1)).filter((i) => i >= 0)))}
          className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40">選んだお店を却下</button>
        <button type="button" disabled={pending} onClick={() => run(() => rejectPost(p.id))}
          className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm">投稿ごと却下</button>
      </div>
      {msg && <p className="text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
    </li>
  )
}
