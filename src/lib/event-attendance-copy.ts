// イベント詳細の「参加」欄の文言。
// 外部の情報から取り込んだイベント（代理登録）は、主催者への参加申し込みではなく
// 「自分の予定に入れて、前日の朝にCiDAOから知らせてもらう」使い方になる。
// その違いを画面に正しく出すため、文言を純粋な関数に切り出して試せるようにする。

export type AttendanceCopy = {
  heading: string
  loginButton: string
  loginLeadTitle: string
  /** ログイン前の案内。strong の部分だけ太字で出す */
  loginLead: { before: string; strong: string; after: string }
  loginNote: string
  joinButton: string
  /** 押す前に見せる補足（押すとどうなるか）。無いときは null */
  joinHint: string | null
  cancelButton: string
  /** 登録済みの自分の状態 */
  statusLine: (role: string) => string
  /** 人数の一行。出さないときは null */
  countLine: (counts: { organizer: number; staff: number; participant: number }) => string | null
}

const ROLE_LABEL: Record<string, string> = {
  organizer: '主催者',
  staff: 'スタッフ',
  participant: '参加者',
}

/** 外部から取り込んだイベント（代理登録）のときの「行く予定」 */
const PLAN_COPY: AttendanceCopy = {
  heading: '行く予定',
  loginButton: 'ログインして行く予定にする',
  loginLeadTitle: 'はじめての方へ',
  loginLead: {
    before:
      '「行く予定」にしておくと、前日の朝にCiDAO（シダオ）からお知らせが届きます。使うには、印西市の市民参加アプリ「CiDAO」への登録が必要です。',
    strong: 'LINEでワンタップ、登録も利用も無料',
    after: '。ニックネームで登録でき、メールアドレスや電話番号の入力もいりません。',
  },
  loginNote: 'イベントを見るだけなら、登録は不要です。',
  joinButton: '行く予定にする',
  joinHint:
    '前日の朝8時ごろ、CiDAOからお知らせします（直前に追加した場合は届かないことがあります）。主催者への申し込みではありません。申し込みが必要な催しは、掲載元の案内に従ってください。',
  cancelButton: '予定をやめる',
  statusLine: (role) =>
    role === 'participant' ? 'あなたは「行く予定」に入れています' : `あなたは ${ROLE_LABEL[role] ?? '参加者'} として登録中`,
  countLine: ({ participant }) => (participant > 0 ? `行く予定 ${participant}人` : null),
}

/** CiDAO内で作られたイベントの「参加登録」（従来どおり） */
const JOIN_COPY: AttendanceCopy = {
  heading: '参加',
  loginButton: 'ログインして参加',
  loginLeadTitle: 'はじめての方へ',
  loginLead: {
    before: '参加の申し込みには、印西市の市民参加アプリ「CiDAO（シダオ）」への登録が必要です。',
    strong: 'LINEでワンタップ、登録も利用も無料',
    after: '。ニックネームで登録でき、メールアドレスや電話番号の入力もいりません。',
  },
  loginNote: 'イベントを見るだけなら、登録は不要です。',
  joinButton: '参加する',
  joinHint: null,
  cancelButton: 'キャンセル',
  statusLine: (role) => `あなたは ${ROLE_LABEL[role] ?? '参加者'} として登録中`,
  countLine: ({ organizer, staff, participant }) => `主催 ${organizer} / スタッフ ${staff} / 参加 ${participant}`,
}

export function attendanceCopy(event: { proxy_registration: boolean }): AttendanceCopy {
  return event.proxy_registration ? PLAN_COPY : JOIN_COPY
}

/**
 * 定員いっぱいで参加を締め切るか。
 * 「行く予定」は席の予約ではない（主催者に届かない）ので、外部イベントでは締め切らない。
 */
export function isEventFull(
  event: { proxy_registration: boolean; capacity: number | null },
  participantCount: number,
): boolean {
  if (event.proxy_registration) return false
  return event.capacity != null && participantCount >= event.capacity
}

/** 定員の一行。外部イベントでは「現在N名」を付けない（行く予定の人数は申込者数ではないため） */
export function capacityLine(
  event: { proxy_registration: boolean; capacity: number | null },
  participantCount: number,
): string | null {
  if (event.capacity == null) return null
  return event.proxy_registration
    ? `定員: ${event.capacity} 名`
    : `定員: ${event.capacity} 名（現在 ${participantCount} 名）`
}
