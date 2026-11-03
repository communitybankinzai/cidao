'use client'

import { useEffect, useRef, useState } from 'react'

const MESSAGE = '興味分野を1つ以上選んでください'

/**
 * 興味分野のチェックボックス群。
 * 1つも選ばれていない間だけ全ボックスを required にし、送信時に日本語の案内を出す
 * （チェックボックス群には標準の「1つ以上必須」属性が無いため）。
 */
export default function InterestsField({
  categories,
  defaultSelected,
}: {
  categories: { key: string; label: string }[]
  defaultSelected: string[]
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected))
  const ref = useRef<HTMLDivElement>(null)
  const none = selected.size === 0

  // カスタムメッセージが残ると required が外れても invalid のままになるため、選択が変わるたび全消去する
  useEffect(() => {
    ref.current?.querySelectorAll('input').forEach((i) => i.setCustomValidity(''))
  }, [selected])

  return (
    <div ref={ref} className="grid grid-cols-2 gap-1">
      {categories.map((c) => (
        <label key={c.key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="interests"
            value={c.key}
            checked={selected.has(c.key)}
            required={none}
            onInvalid={(e) => e.currentTarget.setCustomValidity(MESSAGE)}
            onChange={(e) => {
              const next = new Set(selected)
              if (e.target.checked) next.add(c.key)
              else next.delete(c.key)
              setSelected(next)
            }}
          />
          {c.label}
        </label>
      ))}
    </div>
  )
}
