// 画像をクライアント側で正方形クロップ + 指定サイズに縮小し、WebP（失敗時 JPEG）の Blob として返す。
// アバター用途: 256×256 まで縮小、品質 0.85。
// 注意: SSR では使えない（document/createElement('canvas') を使う）。

export type ResizeOptions = {
  size?: number             // 出力辺長 (px)
  quality?: number          // 0..1
  preferWebp?: boolean      // 既定 true
}

export type ResizeResult = {
  blob: Blob
  extension: 'webp' | 'jpg'
  width: number
  height: number
  originalBytes: number
  outputBytes: number
}

export async function resizeImageToSquare(file: File, opts: ResizeOptions = {}): Promise<ResizeResult> {
  const size = Math.max(32, Math.floor(opts.size ?? 256))
  const quality = Math.min(1, Math.max(0.1, opts.quality ?? 0.85))
  const preferWebp = opts.preferWebp ?? true

  // createImageBitmap は EXIF orientation を自動補正する（imageOrientation: 'from-image'）
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Safari 古版など fallback: HTMLImageElement 経由（EXIF 回転は失われる可能性あり）
    bitmap = await loadViaImage(file)
  }

  try {
    const srcW = bitmap.width
    const srcH = bitmap.height
    const cropSize = Math.min(srcW, srcH)
    const sx = Math.floor((srcW - cropSize) / 2)
    const sy = Math.floor((srcH - cropSize) / 2)

    // 元画像が出力サイズより小さければ縮小せず元辺長を維持（拡大はしない）
    const outSize = Math.min(size, cropSize)

    const canvas = document.createElement('canvas')
    canvas.width = outSize
    canvas.height = outSize
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context が取得できません')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, sx, sy, cropSize, cropSize, 0, 0, outSize, outSize)

    let blob: Blob | null = null
    let extension: 'webp' | 'jpg' = 'jpg'
    if (preferWebp) {
      blob = await canvasToBlob(canvas, 'image/webp', quality)
      if (blob) extension = 'webp'
    }
    if (!blob) {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality)
      extension = 'jpg'
    }
    if (!blob) throw new Error('画像の変換に失敗しました')

    return {
      blob,
      extension,
      width: outSize,
      height: outSize,
      originalBytes: file.size,
      outputBytes: blob.size,
    }
  } finally {
    if ('close' in bitmap) bitmap.close()
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

function loadViaImage(file: File): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = async () => {
      try {
        const bmp = await createImageBitmap(img)
        URL.revokeObjectURL(url)
        resolve(bmp)
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('画像の読み込みに失敗しました'))
    }
    img.src = url
  })
}
