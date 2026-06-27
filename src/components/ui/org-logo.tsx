import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASS: Record<Size, string> = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-12 h-12 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
}

// 団体名から決まる背景色（HSL、同じ名前は同じ色）
function colorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 50% 55%)`
}

// 団体ロゴ表示。Avatar と違って rounded（角丸正方形）。
// src があれば画像、なければ団体名先頭文字のモノグラム。
export function OrgLogo({
  src,
  name,
  size = 'md',
  className,
}: {
  src?: string | null
  name: string
  size?: Size
  className?: string
}) {
  const base = cn(
    'inline-flex items-center justify-center rounded-md overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700',
    SIZE_CLASS[size],
    className,
  )

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={cn(base, 'object-contain bg-white dark:bg-slate-100')} />
    )
  }

  const initial = name.trim().slice(0, 1) || '?'
  return (
    <span
      className={cn(base, 'text-white font-bold')}
      style={{ backgroundColor: colorFromName(name) }}
      aria-label={name}
    >
      {initial}
    </span>
  )
}
