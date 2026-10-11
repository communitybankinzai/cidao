'use client'

import { useState } from 'react'
import { DISASTER_CATEGORIES } from '@/lib/disaster-notify-categories'

/**
 * 災害情報の通知設定（2026-10-12）。
 * 「受け取る」スイッチは初期OFF。ONにした人にだけ、受け取る種類のチェックを出す（細かい設定はONの人だけ）。
 * 種類のチェックは、親がONで未設定のときは全部ON。フォームの name は contact_preferences のキーと同じ。
 */
export default function DisasterNotifySettings({ prefs }: { prefs: Record<string, unknown> }) {
  const [on, setOn] = useState(prefs.notify_disaster === true)

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="notify_disaster"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="mt-1"
        />
        <span>
          災害情報の通知を受け取る
          <span className="block text-xs text-slate-500">
            避難情報・警報・通行止めなどをベル🔔でお知らせします（プッシュ通知を許可していればスマホにも届きます）。初期設定ではお知らせしません
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
                name={c.prefKey}
                defaultChecked={prefs[c.prefKey] !== false}
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
