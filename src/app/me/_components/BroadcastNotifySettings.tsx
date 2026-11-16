'use client'

import { useState, useTransition } from 'react'
import {
  BROADCAST_CHANNEL_LABEL,
  BROADCAST_TOPICS,
  broadcastChannel,
  type BroadcastChannel,
  type BroadcastTopicKey,
} from '@/lib/broadcast-notify-prefs'
import { saveBroadcastNotifyPref } from '../actions'

/**
 * 全会員向けの自動通知（新しい団体・提案・会員の本登録など）の届け方を、種類ごとに選ぶ（マイページの通知欄・2026-11-16）。
 * - 「ベルとスマホ」「ベルだけ」「受け取らない」から選ぶ。初期はこれまでの動きのまま
 * - 押した時点でその場で保存する（保存ボタンなし）。災害情報の通知の設定（DisasterNotifySettings）と同じ作り
 * - あなた本人あての通知（申告の承認・コメントなど）は、ここで止まらない
 */
export default function BroadcastNotifySettings({ prefs }: { prefs: Record<string, unknown> }) {
  const [values, setValues] = useState<Record<BroadcastTopicKey, BroadcastChannel>>(
    () =>
      Object.fromEntries(BROADCAST_TOPICS.map((t) => [t.key, broadcastChannel(prefs, t.key)])) as Record<
        BroadcastTopicKey,
        BroadcastChannel
      >,
  )
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  function save(key: BroadcastTopicKey, next: BroadcastChannel) {
    const before = values[key]
    if (before === next) return
    setValues((v) => ({ ...v, [key]: next }))
    startTransition(async () => {
      const r = await saveBroadcastNotifyPref({ key, channel: next })
      setStatus(r)
      if (!r.ok) setValues((v) => ({ ...v, [key]: before })) // 保存できなかったら表示を元に戻す（見た目と実際をずらさない）
    })
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">🔔 お知らせの届け方</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          会員みんなに届くお知らせを、種類ごとに選べます。「ベルだけ」にすると、アプリ内のベル🔔にだけ届き、スマホは鳴りません。
          あなた本人あてのお知らせ（申請の結果やコメントなど）は、ここの設定にかかわらず届きます
        </p>
      </div>
      <ul className="space-y-3">
        {BROADCAST_TOPICS.map((t) => (
          <li key={t.key} data-pref-key={t.key} className="space-y-1">
            <p className="text-sm text-slate-900 dark:text-slate-100">{t.label}</p>
            <p className="text-[11px] text-slate-500">{t.hint}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label={t.label}>
              {t.channels.map((ch) => (
                <label key={ch} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={t.key}
                    value={ch}
                    checked={values[t.key] === ch}
                    disabled={pending}
                    onChange={() => save(t.key, ch)}
                  />
                  {BROADCAST_CHANNEL_LABEL[ch]}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {status && (
        <p className={`text-[11px] ${status.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}`}>{status.message}</p>
      )}
    </section>
  )
}
