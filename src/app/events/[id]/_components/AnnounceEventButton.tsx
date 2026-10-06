'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createEventAnnounceDraft } from '@/app/admin/sns/actions'

// 運営専用：このイベントを「イベント紹介」としてSNSに告知する下書きを作る。
// 押しても配信はされない。管理画面（SNS）で本文・画像を確認して承認すると出る
export function AnnounceEventButton({ eventId, hasFlyer }: { eventId: string; hasFlyer: boolean }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function run() {
    setMsg(null)
    start(async () => {
      const r = await createEventAnnounceDraft(eventId)
      setMsg(r.ok
        ? { ok: true, text: '告知の下書きを作りました。管理画面で確認・承認すると配信されます。' }
        : { ok: false, text: r.error })
    })
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={pending}>
        {pending ? '作成中…' : '📣 SNSで告知'}
      </Button>
      {!hasFlyer && <p className="text-[11px] text-slate-500">チラシ画像が無いため、Instagram は対象外（Threads のみ）です</p>}
      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          {msg.text}{' '}
          <Link href="/admin/sns" className="underline">SNS管理画面へ</Link>
        </p>
      )}
    </div>
  )
}
