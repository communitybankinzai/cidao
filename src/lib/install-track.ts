// 「ホーム画面に追加」の案内が、どれだけ出て・押されて・追加されたかを数える（2026-11-25 事業主決定）。
//
// 置き場は閲覧数と同じ（/api/track/view → page_views）。ホーム下段の回数（HomeTileEffects の trackGo）と
// 同じやり方で、/go/<名前> という仮のパスで1件入れる。新しい表は作らない。
// 管理画面の「アクセス分析」のページ別に、/go/install-shown などの行として出る。
//
//   install-shown      案内（保存直後のカード）が出た。端末ごとに1回
//   install-tap        保存直後の案内の「ホーム画面に追加する」ボタンが押された（Android）
//   install-tap-guide  案内ページ（/install）の同じボタンが押された（Android）
//   install-added      追加できた合図（appinstalled）が来た。Android とパソコンの Chrome。端末ごとに1回
//   install-standalone ホーム画面のアイコンから開いた。端末ごとに初回の1回だけ
//
// iPhone には「追加できた」の合図が無い。iPhone で追加した人は install-standalone で数える。
// install-standalone には、数え始める前から追加していた人の初回も入る（最初の数日は多めに出る）。

export const INSTALL_TRACK_NAMES = [
  'install-shown',
  'install-tap',
  'install-tap-guide',
  'install-added',
  'install-standalone',
] as const

export type InstallTrackName = (typeof INSTALL_TRACK_NAMES)[number]

/** 端末の匿名ID。PageViewTracker が作るものと同じ置き場・同じ形 */
const VISITOR_KEY = 'cidao_visitor_id'
/** 「この端末ではもう数えた」の印 */
export const INSTALL_TRACK_ONCE_PREFIX = 'cidao_install_tracked:'

export function installTrackPath(name: InstallTrackName): string {
  return `/go/${name}`
}

/** 1件数える。数えられなくても、画面の動きは止めない */
export function trackInstall(name: InstallTrackName): void {
  try {
    // /me は閲覧数を数えないページなので、匿名IDがまだ無いことがある。無ければ同じ形で作る
    let visitorId = localStorage.getItem(VISITOR_KEY)
    if (!visitorId) {
      visitorId = crypto.randomUUID()
      localStorage.setItem(VISITOR_KEY, visitorId)
    }
    void fetch('/api/track/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: installTrackPath(name), visitorId }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 保存領域が使えない端末では数えない
  }
}

/**
 * 端末ごとに1回だけ数える。
 * 印を覚えられない端末では数えない（開くたびに増えてしまうため）。
 * 戻り値：数えたら true
 */
export function trackInstallOnce(name: InstallTrackName): boolean {
  const key = INSTALL_TRACK_ONCE_PREFIX + name
  try {
    if (localStorage.getItem(key)) return false
    localStorage.setItem(key, String(Date.now()))
  } catch {
    return false
  }
  trackInstall(name)
  return true
}
