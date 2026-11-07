// ホームに出す「通知を受け取る設定のご案内」（PushNudge）を、どの形で出すかの判定。
// 画面（PushNudge.tsx）と試験が同じ規則を使うため、ここに集める。
//
// 背景（2026-11-07 の実測）：通知を1度も開いていない会員が44名中19名、Webプッシュ許可は6名。
// 従来の帯は「プッシュに対応したブラウザ」にしか出なかったが、iPhone の Safari（ホーム画面に追加する前）は
// PushManager が無く「対応外」と判定されるため、いちばん案内が要る人に出ていなかった。

export type PushNudgeEnv = {
  hasServiceWorker: boolean
  hasPushManager: boolean
  isIos: boolean
  /** ホーム画面から起動している（PWA として開いている） */
  standalone: boolean
  /** すでにプッシュを購読している（対応ブラウザでだけ分かる） */
  subscribed: boolean
}

/**
 * toggle      = プッシュに対応していて未設定。「通知を受け取る」ボタンを出す
 * ios-install = iPhone の Safari（ホーム画面に追加する前）。先に追加の案内を出す
 * none        = 何も出さない（設定済み・対応外のブラウザなど）
 */
export type PushNudgeMode = 'toggle' | 'ios-install' | 'none'

export function decidePushNudge(e: PushNudgeEnv): PushNudgeMode {
  if (e.hasServiceWorker && e.hasPushManager) return e.subscribed ? 'none' : 'toggle'
  if (e.isIos && !e.standalone) return 'ios-install'
  return 'none'
}

/** ヘルプの「スマホにも通知を出したい」の節（動画つき）。帯からここへ案内する */
export const PUSH_HOWTO_PATH = '/help#push-howto'
/** ホーム画面に追加する手順の案内ページ */
export const PUSH_INSTALL_PATH = '/install'
/** 「今は設定しない」を押してから、帯を出さない日数 */
export const PUSH_NUDGE_DISMISS_DAYS = 30
