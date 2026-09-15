import { redirect } from 'next/navigation'

// 従来の「公開PRの編集」は人材バンクの画面に一本化した（2026-09-15 中司さん決定・案A）。
// 既存の PR は talent_profiles へ移し替え済み。古いリンク・ベル通知からの到達のために転送だけ残す。
export default function LegacyPrPage() {
  redirect('/me/talent')
}
