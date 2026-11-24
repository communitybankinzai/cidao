// ブラウザの「ホーム画面に追加できます」の合図（beforeinstallprompt）を取っておく置き場。
//
// 合図は、ページを最初に開いたときに1回だけ来る。本登録の保存のあとはページを開き直さずに
// 次の画面へ移るので、案内（InstallNudge）が現れた時にはもう合図が過ぎている。
// そこで、最初の読み込みで動く部品（layout.tsx の InstallPromptCapture）からこのファイルを読み込み、
// 合図を先に受け取って取っておく。
//
// preventDefault はしない。Chrome が自分で出す案内（小さな帯やメニュー）の動きを変えないため。
// 取っておいた合図は、止めていなくても prompt() で確認を出せる（2026-11-24 Chrome で確認）。
// 対応は Android の Chrome など。iPhone にはこの仕組みが無い。

import { trackInstallOnce } from './install-track'

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let saved: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    saved = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    saved = null
    installed = true
    // 追加できた回数を数える（端末ごとに1回。iPhone にはこの合図が無い）
    trackInstallOnce('install-added')
    emit()
  })
}

/** 追加の確認を出せるか（合図を受け取っていて、まだ使っていない） */
export function canPromptInstall(): boolean {
  return saved !== null
}

/** この画面を開いている間に、追加が済んだか */
export function wasInstalled(): boolean {
  return installed
}

/** 合図が届いた・追加が済んだときに呼ばれる。戻り値は解除の関数 */
export function subscribeInstallPrompt(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 追加の確認を出す。ボタンを押した処理の中から呼ぶこと（押していないと、ブラウザが断る）。
 * 合図は1回しか使えないので、使ったら捨てる。
 * 戻り値：accepted＝追加した／dismissed＝やめた／unavailable＝合図が無い・出せなかった
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = saved
  if (!ev) return 'unavailable'
  saved = null
  try {
    await ev.prompt()
    const { outcome } = await ev.userChoice
    emit()
    return outcome
  } catch {
    emit()
    return 'unavailable'
  }
}
