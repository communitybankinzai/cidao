// Supabase Storage の公開URL → バケット名とオブジェクトパスの復元。
//
// DB には公開URL（https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>）
// を保存しているため、消すときは URL からパスを取り出す必要がある。
//
// 削除は戻せない操作なので、URL の形が想定どおりでない場合は「わからない」
// （null）を返して呼び出し側に消させない。バケット名も呼び出し側が期待する
// ものと一致するか必ず突き合わせること。

const PUBLIC_MARKER = '/storage/v1/object/public/'

export type StorageRef = { bucket: string; path: string }

export function parseStoragePublicUrl(url: string): StorageRef | null {
  if (typeof url !== 'string' || !url.startsWith('http')) return null

  const idx = url.indexOf(PUBLIC_MARKER)
  if (idx === -1) return null

  // クエリ（?t=... など）とフラグメントは落とす
  const after = url.slice(idx + PUBLIC_MARKER.length).split(/[?#]/)[0]
  const slash = after.indexOf('/')
  if (slash <= 0) return null

  const bucket = after.slice(0, slash)
  const path = decodeURIComponent(after.slice(slash + 1))
  if (!bucket || !path) return null
  // ディレクトリ遡上のような細工が混ざっていたら扱わない
  if (path.includes('..')) return null

  return { bucket, path }
}

// 指定バケットのものだけを抜き出す。他バケットや解釈できないURLは黙って捨てる
export function pathsInBucket(urls: readonly string[] | null | undefined, bucket: string): string[] {
  return (urls ?? [])
    .map((u) => parseStoragePublicUrl(u))
    .filter((r): r is StorageRef => r !== null && r.bucket === bucket)
    .map((r) => r.path)
}
