import { cn } from '@/lib/utils'

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASS: Record<Size, string> = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-2xl',
}

// display_name の頭文字から決まる背景色（HSL ベース、同じ名前は同じ色）
function colorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 55% 60%)`
}

export function Avatar({
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
    'inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700',
    SIZE_CLASS[size],
    className,
  )

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn(base, 'object-cover bg-slate-100 dark:bg-slate-800')}
      />
    )
  }

  const initial = name.trim().slice(0, 1) || '?'
  return (
    <span
      className={cn(base, 'text-white font-semibold')}
      style={{ backgroundColor: colorFromName(name) }}
      aria-label={name}
    >
      {initial}
    </span>
  )
}
