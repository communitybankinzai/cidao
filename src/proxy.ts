import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // api/version は「いまの版の番号」を返すだけの固定の応答（VersionRefresher が画面に戻るたびに読む）。
    // ログインの確認は要らないので、ここを通さない（通すと、読むたびに入口の処理が動いて使用量が増える）
    '/((?!_next/static|_next/image|favicon.ico|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)',
  ],
}
