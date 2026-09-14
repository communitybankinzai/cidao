'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { confirmEligibility, consentAndStart } from '../actions'

export function EligibilityForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(confirmEligibility, { error: null })
  const [type, setType] = useState('person')
  return <form action={action} className="space-y-5 rounded-xl border bg-background p-5">
    <h2 className="text-xl font-semibold">1. 受付確認</h2>
    <p className="text-sm text-muted-foreground">18歳以上のご本人が対象です。店舗・団体の場合は代表者ご本人が操作してください。</p>
    <label className="block space-y-2"><span>登録する対象</span>
      <select name="subject_type" value={type} onChange={e => setType(e.target.value)} className="block w-full rounded-md border bg-background p-3 text-base">
        <option value="person">個人</option><option value="shop">店舗</option><option value="org">団体</option>
      </select>
    </label>
    <label className="block space-y-2"><span>表示名・屋号</span>
      <input name="display_name" defaultValue={displayName} required maxLength={100} className="w-full rounded-md border bg-background p-3 text-base" />
    </label>
    <label className="flex items-start gap-3"><input type="checkbox" name="adult" required className="mt-1 size-5" /><span>18歳以上の本人です</span></label>
    <label className="flex items-start gap-3"><input type="checkbox" name="representative" required={type !== 'person'} className="mt-1 size-5" /><span>店舗・団体の場合は代表者本人が操作しています（個人はチェック不要）</span></label>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <Button type="submit" disabled={pending}>{pending ? '保存中…' : '確認して同意へ'}</Button>
  </form>
}

export function ConsentForm({ texts }: { texts: { label: string; version: string; text: string }[] }) {
  const [state, action, pending] = useActionState(consentAndStart, { error: null })
  return <form action={action} className="space-y-5 rounded-xl border bg-background p-5">
    <h2 className="text-xl font-semibold">2. インタビューへの同意</h2>
    {texts.map(text => <section key={text.label} className="space-y-2">
      <h3 className="font-semibold">{text.label}</h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text.text}</p>
      <p className="text-xs text-muted-foreground">文面の版：{text.version}</p>
    </section>)}
    <label className="flex items-start gap-3"><input name="agree" type="checkbox" required className="mt-1 size-5" /><span>上の2つの内容に同意します</span></label>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <Button type="submit" disabled={pending}>{pending ? '保存中…' : '同意して始める'}</Button>
  </form>
}
