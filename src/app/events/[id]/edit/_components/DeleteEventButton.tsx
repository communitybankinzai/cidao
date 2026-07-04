'use client'

import { Button } from '@/components/ui/button'

export function DeleteEventButton({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('このイベントを削除します。元に戻せません。よろしいですか？')) {
          e.preventDefault()
        }
      }}
    >
      <Button type="submit" variant="destructive">削除</Button>
    </form>
  )
}
