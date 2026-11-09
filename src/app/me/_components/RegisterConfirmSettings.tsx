'use client'

import { useState, useTransition } from 'react'
import { REGISTER_CONFIRM_PUSH_KEY, wantsRegisterConfirmPush } from '@/lib/register-confirm-pref'
import { saveRegisterConfirmPref } from '../actions'

/**
 * イベントを登録したときの確認通知の届け方（マイページの通知欄・2026-11-09）。
 * - 初期はON（スマホにも鳴らす）。外すと、アプリ内のベル🔔にだけ届く
 * - 押した時点でその場で保存する（保存ボタンなし）。災害情報の通知の設定（DisasterNotifySettings）と同じ作り
 * - 確認通知は、イベントを登録した本人にだけ届く「N人にお知らせしました」の知らせ
 */
export default function RegisterConfirmSettings({ prefs }: { prefs: Record<string, unknown> }) {
  const [push, setPush] = useState(wantsRegisterConfirmPush(prefs))
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  function save(next: boolean) {
    const before = push
    setPush(next)
    startTransition(async () => {
      const r = await saveRegisterConfirmPref({ push: next })
      setStatus(r)
      if (!r.ok) setPush(before) // 保存できなかったら表示を元に戻す（見た目と実際をずらさない）
    })
  }

  return (
    <section
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2"
      data-pref-key={REGISTER_CONFIRM_PUSH_KEY}
    >
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={push}
          disabled={pending}
          onChange={(e) => save(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            📝 イベントを登録したときの確認を、スマホにも通知する
          </span>
          <span className="block text-[11px] text-slate-500 mt-0.5">
            イベントを登録すると、あなたにだけ「N人にお知らせしました」という確認が届きます。
            スマホが鳴るのがうるさいときは、チェックを外すとアプリ内のベル🔔にだけ届きます
          </span>
        </span>
      </label>
      {status && (
        <p className={`text-[11px] ${status.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}`}>{status.message}</p>
      )}
    </section>
  )
}
