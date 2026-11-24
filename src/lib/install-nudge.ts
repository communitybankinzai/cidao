// 本登録・保存の直後に出す「ホーム画面に追加」の案内（InstallNudge）を、どの形で出すかの判定。
// 画面（InstallNudge.tsx）と試験が同じ規則を使うため、ここに集める。
//
// 背景（2026-11-24 事業主の依頼）：登録のときにホーム画面への追加を自動にしたい、という相談。
// スマホの決まりで、サイトが勝手にアイコンを置くことはできない。そこで、いちばん操作してもらいやすい
// 本登録の直後に、端末に合った一番短い道を出す。

export type InstallNudgeEnv = {
  isIos: boolean
  isAndroid: boolean
  /** LINE の中の画面で開いている（ここからはホーム画面に追加できない） */
  inLineBrowser: boolean
  /** ホーム画面のアイコンから開いている（追加済み） */
  standalone: boolean
  /** ブラウザから「追加の確認を出せる」合図（beforeinstallprompt）を受け取っている */
  canPrompt: boolean
  /** この端末で、案内を閉じたことがある */
  dismissed: boolean
}

/**
 * line           = LINE の中。先に Safari／Chrome で開き直してもらう
 * android-prompt = Android で合図あり。「ホーム画面に追加する」ボタンを出す（押すと確認が1回出る）
 * android-steps  = Android で合図なし。メニューからの手順を出す
 * ios-steps      = iPhone。共有ボタンからの手順を出す（iPhone にはボタンで追加する仕組みが無い）
 * none           = 何も出さない（追加済み・閉じた人・パソコン）
 */
export type InstallNudgeMode = 'line' | 'android-prompt' | 'android-steps' | 'ios-steps' | 'none'

export function decideInstallNudge(e: InstallNudgeEnv): InstallNudgeMode {
  if (e.standalone || e.dismissed) return 'none'
  if (!e.isIos && !e.isAndroid) return 'none'
  if (e.inLineBrowser) return 'line'
  if (e.isAndroid) return e.canPrompt ? 'android-prompt' : 'android-steps'
  return 'ios-steps'
}

export function detectDevice(ua: string): { isIos: boolean; isAndroid: boolean; inLineBrowser: boolean } {
  return {
    isIos: /iphone|ipad|ipod/i.test(ua),
    isAndroid: /android/i.test(ua),
    inLineBrowser: /\bLine\//i.test(ua),
  }
}

/**
 * LINE の中の画面から、Safari（iPhone）／Chrome（Android）で開き直すための宛先。
 * /install の「外部ブラウザで開く」と同じ作り。パソコンなどは null（ふつうのリンクで開く）
 */
export function externalBrowserUrl(url: string, ua: string): string | null {
  const { isIos, isAndroid } = detectDevice(ua)
  if (isIos) return url.replace(/^https?:\/\//i, 'x-safari-https://')
  if (isAndroid) {
    return `intent://${url.replace(/^https?:\/\//i, '')}#Intent;scheme=https;package=com.android.chrome;end`
  }
  return null
}

/** ホーム画面に追加する手順の案内ページ（動画つき） */
export const INSTALL_GUIDE_PATH = '/install'
/** 案内を閉じたことを、この端末に覚えておく名前 */
export const INSTALL_NUDGE_DISMISS_KEY = 'cidao_install_nudge_dismissed_at'
