'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  saveDisasterSnsMonitorRules,
  type DisasterMonitorPlatform,
  type DisasterMonitorRuleInput,
} from '../actions'

export type DisasterMonitorRule = {
  platform: DisasterMonitorPlatform
  query: string
  enabled: boolean
}

const PLATFORMS: Array<{
  id: DisasterMonitorPlatform
  label: string
  help: string
}> = [
  { id: 'threads', label: 'Threads', help: '投稿本文をキーワード検索します。' },
  { id: 'instagram', label: 'Instagram', help: '公開ハッシュタグを検索します。#は付けずに入力します。' },
  { id: 'bluesky', label: 'Bluesky', help: '投稿本文をキーワード検索します。' },
]

function linesFor(rules: DisasterMonitorRule[], platform: DisasterMonitorPlatform) {
  return rules
    .filter((rule) => rule.platform === platform && rule.enabled)
    .map((rule) => rule.query)
    .join('\n')
}

export default function DisasterSnsMonitorRules({ initialRules }: { initialRules: DisasterMonitorRule[] }) {
  const initialValues = useMemo(() => Object.fromEntries(
    PLATFORMS.map((platform) => [platform.id, linesFor(initialRules, platform.id)]),
  ) as Record<DisasterMonitorPlatform, string>, [initialRules])
  const [values, setValues] = useState(initialValues)
  const [savedValues, setSavedValues] = useState(initialValues)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const dirty = PLATFORMS.some((platform) => values[platform.id] !== savedValues[platform.id])

  function save() {
    const input: DisasterMonitorRuleInput[] = PLATFORMS.map((platform) => ({
      platform: platform.id,
      queries: values[platform.id].split(/\r?\n/).map((query) => query.trim()).filter(Boolean),
    }))
    setMessage('')
    setError('')
    startTransition(async () => {
      const result = await saveDisasterSnsMonitorRules(input)
      if (result.ok) {
        setSavedValues(values)
        setMessage('検索語を保存しました。次回巡回から反映されます。')
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <section id="disaster-monitor-rules" className="bg-white dark:bg-slate-900 border rounded-lg p-5 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold">災害MAP SNS巡回検索語</h2>
          <p className="text-xs text-slate-500 mt-1">
            1行に1語、各SNS最大12件です。対象日と災害語による二次判定は巡回処理側で行います。
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="text-xs px-3 py-2 rounded border border-sky-700 bg-sky-700 text-white disabled:opacity-40"
        >
          {pending ? '保存中...' : '検索語を保存'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLATFORMS.map((platform) => (
          <label key={platform.id} className="block text-sm font-medium">
            {platform.label}
            <textarea
              rows={6}
              value={values[platform.id]}
              onChange={(event) => setValues((current) => ({ ...current, [platform.id]: event.target.value }))}
              className="mt-1 w-full resize-y rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
              placeholder="印西市"
            />
            <span className="mt-1 block text-[11px] font-normal text-slate-500">{platform.help}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 border-t pt-3 text-xs text-slate-600 dark:text-slate-400">
        <strong>Facebook:</strong> 一般公開投稿を任意のキーワードで自動巡回する機能は標準APIでは利用できません。
        MAPの手動検索から投稿URLを登録するか、将来、運用許可を得た特定ページを監視対象に追加します。
      </div>
      {message && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-xs text-red-700 dark:text-red-400">{error}</p>}
    </section>
  )
}
