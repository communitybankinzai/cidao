'use client'

import { useState, useTransition } from 'react'
import { DISASTER_CATEGORIES } from '@/lib/disaster-notify-categories'
import { saveDisasterNotifyPrefs, sendDisasterTestNotification } from '../actions'

/**
 * 災害情報の通知の希望（マイページの通知欄・2026-10-12）。
 * - スイッチは初期OFF。ONにした人にだけ、受け取る種類のチェックと試験送信を出す
 * - 押した時点でその場で保存する（保存ボタンなし）。種類は親がONで未設定なら全部ON
 * - 通知はベル🔔と、プッシュ許可済みの端末へのプッシュ（許可は上の「プッシュ通知設定」で行う）
 */
export default function DisasterNotifySettings({ prefs }: { prefs: Record<string, unknown> }) {
  const [on, setOn] = useState(prefs.notify_disaster === true)
  const [kinds, setKinds] = useState<Record<string, boolean>>(
    () => Object.fromEntries(DISASTER_CATEGORIES.map((c) => [c.prefKey, prefs[c.prefKey] !== false])),
  )
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  function save(nextOn: boolean, nextKinds: Record<string, boolean>) {
    setOn(nextOn)
    setKinds(nextKinds)
    startTransition(async () => setStatus(await saveDisasterNotifyPrefs({ enabled: nextOn, kinds: nextKinds })))
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => save(e.target.checked, kinds)}
          className="mt-1"
        />
        <span>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">🚨 災害情報の通知を受け取る</span>
          <span className="block text-[11px] text-slate-500 mt-0.5">
            避難情報・警報・通行止めなどをベル🔔でお知らせします。初期設定ではお知らせしません
          </span>
        </span>
      </label>

      {on && (
        <div className="ml-6 space-y-1.5 rounded border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500">受け取る種類</p>
          {DISASTER_CATEGORIES.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={kinds[c.prefKey] !== false}
                disabled={pending}
                onChange={(e) => save(on, { ...kinds, [c.prefKey]: e.target.checked })}
              />
              {c.label}
            </label>
          ))}
          <div className="pt-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => setStatus(await sendDisasterTestNotification()))}
              className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              試験通知を自分に送る
            </button>
          </div>
        </div>
      )}

      {status && (
        <p className={`text-[11px] ${status.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}`}>{status.message}</p>
      )}
    </section>
  )
}
