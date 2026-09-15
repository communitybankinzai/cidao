'use client'

// 写真・ファイルを選ぶボタン（2026-09-16）。
// ブラウザ標準の「ファイルを選択」は小さな灰色の文字で見つけにくい（事業主が画像の差し替えで探し回った）。
// 本物の入力欄は見えなくして、はっきりしたボタンを押すと選択画面が開くようにする。
// 入力欄は label の中に置くので、押した先は本物の入力欄のまま。form の name 送信・ref・disabled・accept もそのまま効く
import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  label?: string // ボタンの文字
  showFileName?: boolean // 選んだファイル名をボタンの横に出す（選んですぐ処理しない画面で使う）
  className?: string // 外側の枠
}

export const FilePickButton = forwardRef<HTMLInputElement, Props>(function FilePickButton(
  { label = '📷 画像を選ぶ', showFileName = false, className, onChange, disabled, ...rest },
  ref,
) {
  const [picked, setPicked] = useState('')
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <label
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-sky-700 bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm',
          'cursor-pointer hover:bg-sky-700 focus-within:ring-2 focus-within:ring-sky-400 focus-within:ring-offset-1',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {label}
        <input
          ref={ref}
          type="file"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const files = e.target.files
            setPicked(!files || files.length === 0 ? '' : files.length === 1 ? files[0].name : `${files.length}件のファイル`)
            onChange?.(e)
          }}
          {...rest}
        />
      </label>
      {showFileName && (
        <span className="min-w-0 max-w-full truncate text-xs text-slate-500">{picked || 'まだ選ばれていません'}</span>
      )}
    </div>
  )
})
