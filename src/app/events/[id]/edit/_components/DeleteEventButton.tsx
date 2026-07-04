'use client'

import { Button } from '@/components/ui/button'

// 編集フォーム（<form action={handleUpdate}>）の中に置くため、
// 独自の <form> は作らず formAction で送信先だけ差し替える（フォームの入れ子はHTML上不可）
export function DeleteEventButton({ action }: { action: () => Promise<void> }) {
  return (
    <Button
      type="submit"
      formAction={action}
      formNoValidate
      variant="destructive"
      onClick={(e) => {
        if (!window.confirm('このイベントを削除します。元に戻せません。よろしいですか？')) {
          e.preventDefault()
        }
      }}
    >
      削除
    </Button>
  )
}
