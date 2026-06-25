'use client'

import { useState } from 'react'

type OrgRef = { id: string; name: string }

export const ORGANIZER_MEMBER = '__member__'
export const ORGANIZER_EXTERNAL = '__external__'

export function OrganizerPicker({
  memberOrgs,
  allOrgs,
  initialChoice,
}: {
  memberOrgs: OrgRef[]
  allOrgs: OrgRef[]
  initialChoice?: string
}) {
  // 所属団体があれば1番目を初期選択。なければ「未登録」を初期選択（個人を回避）。
  const defaultChoice =
    initialChoice ??
    (memberOrgs[0]?.id ?? (allOrgs.length > 0 ? ORGANIZER_EXTERNAL : ORGANIZER_MEMBER))

  const [choice, setChoice] = useState<string>(defaultChoice)
  const memberOrgIds = new Set(memberOrgs.map((o) => o.id))
  const otherOrgs = allOrgs.filter((o) => !memberOrgIds.has(o.id))

  return (
    <>
      <div className="space-y-1">
        <label className="text-sm font-medium">
          主催<span className="text-red-500 ml-0.5">*</span>
        </label>
        <select
          name="organizer_choice"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
        >
          {memberOrgs.length > 0 && (
            <optgroup label="自分が代表・役員の団体">
              {memberOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          )}
          {otherOrgs.length > 0 && (
            <optgroup label="登録済みの団体（代理登録）">
              {otherOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="その他">
            <option value={ORGANIZER_EXTERNAL}>他の団体（未登録・自由入力）</option>
            <option value={ORGANIZER_MEMBER}>個人として</option>
          </optgroup>
        </select>
      </div>

      {choice === ORGANIZER_EXTERNAL && (
        <div className="space-y-1">
          <label className="text-sm font-medium">団体名（未登録）</label>
          <input
            name="organizer_name_text"
            maxLength={80}
            placeholder="例: 「木下音頭」愛好会"
            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500">
            CiDAO に未登録の団体イベントを代理登録するときに記入。後日その団体が登録された際に紐づけ直します。
          </p>
        </div>
      )}

      {choice !== ORGANIZER_EXTERNAL && choice !== ORGANIZER_MEMBER && !memberOrgIds.has(choice) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          ※ あなたはこの団体のメンバーではないため、代理登録（proxy_registration）として記録されます。
        </p>
      )}
    </>
  )
}
