import { createHmac, timingSafeEqual } from 'node:crypto'

// メタバース印西へ渡す「CiDAO ログイン済み」の署名トークン（/api/metaverse-auth が発行、/api/metaverse-tt が検証）。
// 形式: base64url(JSON) + "." + base64url(HMAC-SHA256)。鍵はサーバーだけが持つ SUPABASE_SERVICE_ROLE_KEY を流用する
// （Vercel の環境変数を増やさないため。鍵をローテーションすると発行済みトークンは無効になる＝再ログインで足りる）。
export type MetaverseTokenPayload = { uid: string; nick: string; exp: number }

function key(): string {
  return process.env.METAVERSE_TOKEN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
}
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function sign(body: string): string {
  return b64url(createHmac('sha256', key()).update(body).digest())
}

export function signMetaverseToken(payload: MetaverseTokenPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return body + '.' + sign(body)
}

export function verifyMetaverseToken(token: unknown): MetaverseTokenPayload | null {
  if (typeof token !== 'string' || !key()) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(body)
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as MetaverseTokenPayload
    if (!p || typeof p.uid !== 'string' || typeof p.nick !== 'string' || typeof p.exp !== 'number') return null
    if (p.exp < Date.now()) return null
    return p
  } catch {
    return null
  }
}
