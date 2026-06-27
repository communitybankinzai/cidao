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

/** avatar_position 文字列を {x, y} に parse。'50% 70%' / 'center 70%' / 'top' / 'bottom' / null を受け入れる。 */
export function parseAvatarPosition(pos: string | null | undefined): { x: number; y: number } {
  if (!pos) return { x: 50, y: 50 }
  const m = pos.match(/(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/)
  if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) }
  const m2 = pos.match(/center\s+(\d+(?:\.\d+)?)%/)
  if (m2) return { x: 50, y: parseFloat(m2[1]) }
  if (/top/.test(pos)) return { x: 50, y: 0 }
  if (/bottom/.test(pos)) return { x: 50, y: 100 }
  return { x: 50, y: 50 }
}

export function Avatar({
  src,
  name,
  size = 'md',
  className,
  objectPosition,
  zoom,
}: {
  src?: string | null
  name: string
  size?: Size
  className?: string
  /** 'X% Y%' 形式の表示位置。デフォルトは '50% 50%'（中央）。 */
  objectPosition?: string
  /** 拡大率（1.0 = 等倍 / 等しく cover、3.0 = 3 倍）。zoom > 1 でドラッグによる位置調整が効く */
  zoom?: number | null
}) {
  const base = cn(
    'inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800',
    SIZE_CLASS[size],
    className,
  )

  if (src) {
    const z = zoom && zoom > 0 ? zoom : 1
    const { x, y } = parseAvatarPosition(objectPosition)
    // background-image で画像を表示。background-size を 100*z% にして拡大、
    // background-position の 0–100% で枠内のどこを中央に寄せるか調整。
    // ドラッグ等で z=1, x=50, y=50 のときは object-fit: cover + center と同等の見た目。
    return (
      <span
        aria-label={name}
        role="img"
        className={base}
        style={{
          backgroundImage: `url(${src})`,
          backgroundSize: `${(100 * z).toFixed(2)}%`,
          backgroundPosition: `${x.toFixed(2)}% ${y.toFixed(2)}%`,
          backgroundRepeat: 'no-repeat',
        }}
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
