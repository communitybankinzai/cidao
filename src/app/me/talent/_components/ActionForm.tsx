'use client'
import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react'
export default function ActionForm({ action, children, successText = '保存しました。' }: {
  action: (previous: { error: string }, form: FormData) => Promise<{ error: string }>; children: ReactNode; successText?: string
}) {
  const [state, formAction, pending] = useActionState(action, { error: '' })
  const [submitted, setSubmitted] = useState(false)
  // React 19 の <form action> は送信後に入力欄を初期値へ戻すため、失敗すると書いた内容が消える
  // （2026-09-15 スマホ実機で発生）。onSubmit から送り、自動リセットを起こさない。
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    if (submitter?.name) data.set(submitter.name, submitter.value)
    setSubmitted(true)
    startTransition(() => formAction(data))
  }
  return <form onSubmit={onSubmit} className="space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4">{children}</fieldset>
    {pending && <p role="status" className="text-sm">処理しています…</p>}
    {!pending && state.error && <p role="alert" className="rounded border border-red-500 bg-red-50 p-3 text-sm font-medium text-red-700 dark:bg-red-950">{state.error}書いた内容は画面に残っています。</p>}
    {!pending && submitted && !state.error && <p role="status" className="rounded border border-green-600 bg-green-50 p-3 text-sm font-medium text-green-800 dark:bg-green-950">{successText}</p>}
  </form>
}
