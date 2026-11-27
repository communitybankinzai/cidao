// 全会員向けの自動通知を、会員が種類ごとに選べるようにする設定（依存なし。画面・サーバー・テストから読める）。
//
// 保存先は members.contact_preferences（jsonb）。値は 'push' | 'bell' | 'off'。
//   push … アプリ内のベル🔔に届き、スマホにも通知する
//   bell … アプリ内のベル🔔にだけ届く（スマホは鳴らさない）
//   off  … 届かない
// 未設定は、その種類の「初期の届け方」（これまでの動きのまま）。
//
// 対象は「全会員に一斉に出す自動通知」だけ。次のものはここに入れない：
//   ・本人あての通知（申告の承認、コメント、参加登録の確認など）… 本人に必要なので選ばせない
//   ・運営からのお知らせ（/admin/notice）… 送る側がスマホに鳴らすかを決める
//   ・新着イベント（event_notify_mode）・FreeFree（notify_freefree）・災害情報 … それぞれ専用の設定がある

export type BroadcastChannel = 'push' | 'bell' | 'off'

export type BroadcastTopicKey =
  | 'notify_org_new'
  | 'notify_org_update'
  | 'notify_proposal'
  | 'notify_member_new'

export type BroadcastTopic = {
  key: BroadcastTopicKey
  label: string
  hint: string
  /** 未設定のときの届け方（これまでの動き） */
  defaultChannel: BroadcastChannel
  /** この種類で選べる届け方。'push' を含まない種類は、もともとスマホを鳴らさない通知 */
  channels: readonly BroadcastChannel[]
}

export const BROADCAST_TOPICS: readonly BroadcastTopic[] = [
  {
    key: 'notify_org_new',
    label: '新しい団体の登録',
    hint: '団体が新しく登録されたときのお知らせです',
    defaultChannel: 'push',
    channels: ['push', 'bell', 'off'],
  },
  {
    key: 'notify_org_update',
    label: '団体の情報の更新',
    hint: '登録済みの団体が、紹介文などを書きかえたときのお知らせです（スマホは鳴りません）',
    defaultChannel: 'bell',
    channels: ['bell', 'off'],
  },
  {
    key: 'notify_proposal',
    label: '新しい提案・投票の再開や延長',
    hint: '提案が投稿されたとき、投票が再開・延長されたときのお知らせです',
    defaultChannel: 'push',
    channels: ['push', 'bell', 'off'],
  },
  {
    key: 'notify_member_new',
    label: '新しい会員の登録',
    hint: '会員が新しく登録したときのお知らせです',
    defaultChannel: 'push',
    channels: ['push', 'bell', 'off'],
  },
]

export const BROADCAST_CHANNEL_LABEL: Record<BroadcastChannel, string> = {
  push: 'ベルとスマホ',
  bell: 'ベルだけ',
  off: '受け取らない',
}

export function findBroadcastTopic(key: string): BroadcastTopic | undefined {
  return BROADCAST_TOPICS.find((t) => t.key === key)
}

/** その会員の、その種類の届け方。未設定・その種類で選べない値は初期の届け方にする */
export function broadcastChannel(prefs: unknown, key: BroadcastTopicKey): BroadcastChannel {
  const topic = findBroadcastTopic(key)
  if (!topic) return 'push'
  const v = ((prefs ?? {}) as Record<string, unknown>)[key]
  return topic.channels.includes(v as BroadcastChannel) ? (v as BroadcastChannel) : topic.defaultChannel
}

/**
 * 宛先を「ベルに届ける人」と「スマホにも鳴らす人」に分ける。
 * pushAllowed=false（送る側がベルのみと決めた通知）のときは、だれのスマホも鳴らさない。
 */
export function splitBroadcastRecipients(
  members: readonly { id: string; contact_preferences: unknown }[],
  key: BroadcastTopicKey,
  pushAllowed = true,
): { bellIds: string[]; pushIds: string[] } {
  const bellIds: string[] = []
  const pushIds: string[] = []
  for (const m of members) {
    const ch = broadcastChannel(m.contact_preferences, key)
    if (ch === 'off') continue
    bellIds.push(m.id)
    if (ch === 'push' && pushAllowed) pushIds.push(m.id)
  }
  return { bellIds, pushIds }
}
