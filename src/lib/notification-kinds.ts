// 通知の種類の表示定義。ベル🔔（NotificationBell）と一覧ページ（/notifications）で共有する。
// kind の値は notifications テーブルの CHECK 制約と同じ。

export const KIND_ICON: Record<string, string> = {
  comment: '💬',
  vote: '🗳️',
  proposal: '📋',
  system: '📣',
  freefree: '🛍',
  event: '📅',
  member: '🙋',
  org: '👥',
}

export const KIND_LABEL: Record<string, string> = {
  comment: 'コメント',
  vote: '投票',
  proposal: '提案',
  system: 'お知らせ',
  freefree: 'FreeFree',
  event: 'イベント',
  member: 'メンバー',
  org: '団体',
}
