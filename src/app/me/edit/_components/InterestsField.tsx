'use client'

import { useState } from 'react'

/**
 * 興味分野のチェックボックス群。
 * 興味分野は任意（2026-11-06）。1つも選ばなくても送信できる。
 */
export default function InterestsField({
  categories,
  defaultSelected,
}: {
  categories: { key: string; label: string }[]
  defaultSelected: string[]
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected))

  return (
    <div className="grid grid-cols-2 gap-1">
      {categories.map((c) => (
        <label key={c.key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="interests"
            value={c.key}
            checked={selected.has(c.key)}
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
