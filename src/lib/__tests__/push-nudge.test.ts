import { describe, expect, it } from 'vitest'
import { PUSH_HOWTO_PATH, PUSH_INSTALL_PATH, decidePushNudge, type PushNudgeEnv } from '../push-nudge'

const base: PushNudgeEnv = {
  hasServiceWorker: true,
  hasPushManager: true,
  isIos: false,
  standalone: false,
  subscribed: false,
}

describe('decidePushNudge', () => {
  it('プッシュに対応していて未設定なら、通知を受け取るボタンを出す', () => {
    expect(decidePushNudge(base)).toBe('toggle')
  })

  it('すでに購読している人には出さない', () => {
    expect(decidePushNudge({ ...base, subscribed: true })).toBe('none')
  })

  it('iPhone の Safari（ホーム画面に追加する前・PushManager なし）には、追加の案内を出す', () => {
    expect(decidePushNudge({ ...base, hasPushManager: false, isIos: true, standalone: false })).toBe('ios-install')
  })

  it('iPhone でホーム画面から開いていて対応していれば、ボタンを出す', () => {
    expect(decidePushNudge({ ...base, isIos: true, standalone: true })).toBe('toggle')
  })

  it('iPhone でホーム画面から開いていて設定済みなら、何も出さない', () => {
    expect(decidePushNudge({ ...base, isIos: true, standalone: true, subscribed: true })).toBe('none')
  })

  it('対応外のブラウザ（iPhone 以外）には何も出さない', () => {
    expect(decidePushNudge({ ...base, hasPushManager: false })).toBe('none')
    expect(decidePushNudge({ ...base, hasServiceWorker: false, hasPushManager: false })).toBe('none')
  })

  it('iPhone で ServiceWorker も PushManager も無い古い環境でも、追加の案内を出す', () => {
    expect(decidePushNudge({ ...base, hasServiceWorker: false, hasPushManager: false, isIos: true })).toBe('ios-install')
  })
})

describe('案内先のパス', () => {
  it('サイト内のパスで、ヘルプの動画の節とホーム画面の案内ページを指す', () => {
    expect(PUSH_HOWTO_PATH).toBe('/help#push-howto')
    expect(PUSH_INSTALL_PATH).toBe('/install')
  })
})
