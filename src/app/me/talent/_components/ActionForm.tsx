'use client'
import { useActionState, type ReactNode } from 'react'
export default function ActionForm({ action, children }: {
  action: (previous: { error: string }, form: FormData) => Promise<{ error: string }>; children: ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, { error: '' })
  return <form action={formAction} className="space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4">{children}</fieldset>
    {pending && <p role="status" className="text-sm">処理しています…</p>}
    {state.error && <p role="alert" className="rounded border p-3 text-sm text-destructive">{state.error}</p>}
  </form>
}
