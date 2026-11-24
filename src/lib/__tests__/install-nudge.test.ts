import { describe, expect, it } from 'vitest'
import {
  INSTALL_GUIDE_PATH,
  decideInstallNudge,
  detectDevice,
  externalBrowserUrl,
  type InstallNudgeEnv,
} from '../install-nudge'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPHONE_LINE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.0'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const ANDROID_LINE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Line/14.19.0/IAB'
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const iphone: InstallNudgeEnv = {
  isIos: true,
  isAndroid: false,
  inLineBrowser: false,
  standalone: false,
  canPrompt: false,
  dismissed: false,
}
const android: InstallNudgeEnv = { ...iphone, isIos: false, isAndroid: true }

describe('decideInstallNudge', () => {
  it('iPhone の Safari には、共有ボタンからの手順を出す', () => {
    expect(decideInstallNudge(iphone)).toBe('ios-steps')
  })

  it('Android で追加の合図を受け取っていれば、ボタンを出す', () => {
    expect(decideInstallNudge({ ...android, canPrompt: true })).toBe('android-prompt')
  })

  it('Android で合図が無ければ、メニューからの手順を出す', () => {
    expect(decideInstallNudge(android)).toBe('android-steps')
  })

  it('LINE の中では、端末にかかわらず「開き直す」を先に出す', () => {
    expect(decideInstallNudge({ ...iphone, inLineBrowser: true })).toBe('line')
    expect(decideInstallNudge({ ...android, inLineBrowser: true, canPrompt: true })).toBe('line')
  })

  it('ホーム画面のアイコンから開いている人（追加済み）には出さない', () => {
    expect(decideInstallNudge({ ...iphone, standalone: true })).toBe('none')
    expect(decideInstallNudge({ ...android, standalone: true, canPrompt: true })).toBe('none')
  })

  it('閉じたことがある人には出さない', () => {
    expect(decideInstallNudge({ ...iphone, dismissed: true })).toBe('none')
    expect(decideInstallNudge({ ...android, canPrompt: true, dismissed: true })).toBe('none')
    expect(decideInstallNudge({ ...iphone, inLineBrowser: true, dismissed: true })).toBe('none')
  })

  it('パソコンには出さない（合図を受け取っていても）', () => {
    expect(decideInstallNudge({ ...iphone, isIos: false, canPrompt: true })).toBe('none')
  })
})

describe('detectDevice', () => {
  it('端末と LINE の中かどうかを見分ける', () => {
    expect(detectDevice(IPHONE_SAFARI)).toEqual({ isIos: true, isAndroid: false, inLineBrowser: false })
    expect(detectDevice(IPHONE_LINE)).toEqual({ isIos: true, isAndroid: false, inLineBrowser: true })
    expect(detectDevice(ANDROID_CHROME)).toEqual({ isIos: false, isAndroid: true, inLineBrowser: false })
    expect(detectDevice(ANDROID_LINE)).toEqual({ isIos: false, isAndroid: true, inLineBrowser: true })
    expect(detectDevice(WINDOWS_CHROME)).toEqual({ isIos: false, isAndroid: false, inLineBrowser: false })
  })
})

describe('externalBrowserUrl', () => {
  const url = 'https://cidao.vercel.app/install'

  it('iPhone は Safari で開く宛先にする', () => {
    expect(externalBrowserUrl(url, IPHONE_LINE)).toBe('x-safari-https://cidao.vercel.app/install')
  })

  it('Android は Chrome で開く宛先にする', () => {
    expect(externalBrowserUrl(url, ANDROID_LINE)).toBe(
      'intent://cidao.vercel.app/install#Intent;scheme=https;package=com.android.chrome;end',
    )
  })

  it('パソコンは null（ふつうのリンクで開く）', () => {
    expect(externalBrowserUrl(url, WINDOWS_CHROME)).toBeNull()
  })
})

describe('案内の行き先', () => {
  it('手順の案内ページは /install', () => {
    expect(INSTALL_GUIDE_PATH).toBe('/install')
  })
})
