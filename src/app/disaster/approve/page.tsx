// 災害時の速報SNS投稿を、スマホから1タップで承認する画面。
// PCの管理画面に入れない場面（外出中・夜間）でも承認できるようにするためのもの。
// ログインは求めず、メールに書かれた推測不可能なトークンだけで開ける。
// 承認データは専用テーブルを作らず app_settings（service_role のみ読み書き可）に置く。
import { createClient } from '@supabase/supabase-js'
import { approveAction, declineAction } from './actions'

export const dynamic = 'force-dynamic'

type Approval = {
  text: string
  igText?: string
  imageUrl?: string
  media: string[]
  reason?: string
  createdAt: string
  expiresAt: string
  status: 'pending' | 'posted' | 'declined' | 'expired'
  result?: Record<string, unknown>
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function loadApproval(token: string): Promise<Approval | null> {
  const supabase = adminClient()
  if (!supabase || !/^[A-Za-z0-9_-]{16,80}$/.test(token)) return null
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `disaster_approval:${token}`)
    .maybeSingle()
  return (data?.value as Approval | undefined) ?? null
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '20px 16px 48px',
        fontFamily: 'system-ui, -apple-system, "Hiragino Sans", sans-serif',
        lineHeight: 1.7,
        color: '#16324f',
      }}
    >
      {children}
    </main>
  )
}

export default async function ApprovePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams
  const approval = await loadApproval(token)

  if (!approval) {
    return (
      <Frame>
        <h1 style={{ fontSize: 20 }}>この承認リンクは使えません</h1>
        <p>リンクの有効期限が切れたか、すでに処理済みです。管理画面から操作してください。</p>
      </Frame>
    )
  }

  const expired = new Date(approval.expiresAt).getTime() < Date.now()

  if (approval.status === 'posted') {
    return (
      <Frame>
        <h1 style={{ fontSize: 20 }}>✅ 投稿しました</h1>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f7fa', padding: 12, borderRadius: 8, fontSize: 14 }}>{approval.text}</pre>
        <p style={{ fontSize: 13, color: '#5a6675' }}>結果: {JSON.stringify(approval.result ?? {})}</p>
      </Frame>
    )
  }
  if (approval.status === 'declined') {
    return (
      <Frame>
        <h1 style={{ fontSize: 20 }}>見送りにしました</h1>
        <p>この内容は投稿していません。</p>
      </Frame>
    )
  }
  if (expired) {
    return (
      <Frame>
        <h1 style={{ fontSize: 20 }}>有効期限が切れています</h1>
        <p>災害情報は時間とともに変わるため、古い内容をそのまま投稿しない設計にしています。最新の内容で作り直してください。</p>
      </Frame>
    )
  }

  const remainMin = Math.max(0, Math.round((new Date(approval.expiresAt).getTime() - Date.now()) / 60000))

  return (
    <Frame>
      <p style={{ fontSize: 12, color: '#5a6675', margin: 0 }}>CBI 災害情報の速報投稿</p>
      <h1 style={{ fontSize: 20, margin: '4px 0 12px' }}>この内容で投稿しますか？</h1>
      {approval.reason ? (
        <p style={{ background: '#fff6e5', border: '1px solid #f0c36d', borderRadius: 8, padding: '8px 10px', fontSize: 14 }}>
          {approval.reason}
        </p>
      ) : null}
      <p style={{ fontSize: 13, color: '#5a6675' }}>
        送信先: {approval.media.join(' / ')}　残り約{remainMin}分で無効になります
      </p>
      {approval.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={approval.imageUrl} alt="投稿予定の画像" style={{ width: '100%', borderRadius: 8, border: '1px solid #d5dbe4' }} />
      ) : null}
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          background: '#f5f7fa',
          border: '1px solid #d5dbe4',
          padding: 12,
          borderRadius: 8,
          fontSize: 14,
          marginTop: 12,
        }}
      >
        {approval.text}
      </pre>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <form action={approveAction} style={{ flex: 1 }}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            style={{
              width: '100%',
              minHeight: 52,
              fontSize: 16,
              fontWeight: 700,
              color: '#fff',
              background: '#c0392b',
              border: 'none',
              borderRadius: 10,
            }}
          >
            ▶ 投稿する
          </button>
        </form>
        <form action={declineAction} style={{ flex: 1 }}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            style={{
              width: '100%',
              minHeight: 52,
              fontSize: 16,
              color: '#16324f',
              background: '#fff',
              border: '1px solid #b9c4d3',
              borderRadius: 10,
            }}
          >
            ✕ 見送る
          </button>
        </form>
      </div>
      <p style={{ fontSize: 12, color: '#5a6675', marginTop: 14 }}>
        押すとすぐに公開されます。内容は公式発表の引用のみで構成されています。
      </p>
    </Frame>
  )
}
