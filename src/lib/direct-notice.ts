// 運営から会員へ1人ずつ送るお知らせ（/admin/members）の入力検査と、送ってよい相手かの判定。
// 画面（DirectNoticeButton）とサーバー側（admin/members/actions.ts）が同じ規則を使うため、ここに集める。
//
// 送り先の考え方（会員の設定「CBIからの連絡を許可」＝運営から個別にお声がけしてよい、という意思表示）:
//   invite  = 活動のお誘い・お知らせ → 連絡を許可している人だけ
//   support = 手続き・サポートの連絡 → 許可に関係なく送れる（登録のお手伝いなど、本人の手続きに関わるもの）
// 一斉お知らせ（/admin/notice）やバグ報告への返信は、これまでも許可に関係なく届いている。それと同じ扱い。

export type DirectNoticePurpose = 'invite' | 'support'

export const DIRECT_NOTICE_PURPOSES: { value: DirectNoticePurpose; label: string; help: string }[] = [
  {
    value: 'invite',
    label: '活動のお誘い・お知らせ',
    help: '「CBIからの連絡を許可」している人だけに送れます',
  },
  {
    value: 'support',
    label: '手続き・サポートの連絡',
    help: '登録のお手伝いなど、本人の手続きに関わる連絡です。連絡許可に関係なく送れます',
  },
]

export const DIRECT_NOTICE_TITLE_MAX = 200
export const DIRECT_NOTICE_BODY_MAX = 1000
export const DIRECT_NOTICE_LINK_MAX = 300

export function isDirectNoticePurpose(v: unknown): v is DirectNoticePurpose {
  return v === 'invite' || v === 'support'
}

export function purposeLabel(purpose: string): string {
  return DIRECT_NOTICE_PURPOSES.find((p) => p.value === purpose)?.label ?? purpose
}

/**
 * サイト内のパスか。通知をタップしたときに開く先なので、外部サイトへは飛ばさない。
 * '/' で始まっても、'//example.com'（プロトコル相対）や '/\example.com' は外部に出るので除く。
 */
export function isSafeInAppPath(path: string): boolean {
  if (path.length === 0 || path.length > DIRECT_NOTICE_LINK_MAX) return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//') || path.startsWith('/\\')) return false
  // 空白・制御文字を含むパスは受け付けない
  if (/[\s\u0000-\u001f\u007f]/.test(path)) return false
  return true
}

export type DirectNoticeInput = { title: string; body?: string; linkUrl?: string }

export type ValidatedDirectNotice =
  | { ok: true; value: { title: string; body?: string; linkUrl?: string } }
  | { ok: false; error: string }

export function validateDirectNotice(input: DirectNoticeInput): ValidatedDirectNotice {
  const title = (input.title ?? '').trim()
  if (title.length < 1) return { ok: false, error: 'お知らせのタイトルを入力してください' }
  if (title.length > DIRECT_NOTICE_TITLE_MAX) {
    return { ok: false, error: `タイトルは${DIRECT_NOTICE_TITLE_MAX}字以内にしてください` }
  }

  const body = input.body?.trim() || undefined
  if (body && body.length > DIRECT_NOTICE_BODY_MAX) {
    return { ok: false, error: `本文は${DIRECT_NOTICE_BODY_MAX}字以内にしてください` }
  }

  const linkUrl = input.linkUrl?.trim() || undefined
  if (linkUrl && !isSafeInAppPath(linkUrl)) {
    return { ok: false, error: 'リンクは「/events」のようにサイト内のパスで入力してください' }
  }

  return { ok: true, value: { title, body, linkUrl } }
}

export type CanSendDirectNotice = { ok: true } | { ok: false; reason: string }

/** この相手に、この目的で送ってよいか。連絡許可の値が読めない（null）ときは許可なしとして扱う。 */
export function canSendDirectNotice(args: {
  contactPermission: boolean | null | undefined
  purpose: DirectNoticePurpose
}): CanSendDirectNotice {
  if (args.purpose === 'support') return { ok: true }
  if (args.contactPermission === true) return { ok: true }
  return {
    ok: false,
    reason:
      'この方は「CBIからの連絡を許可」をオンにしていません。手続き・サポートの連絡として送るか、別の方法でご連絡ください',
  }
}
