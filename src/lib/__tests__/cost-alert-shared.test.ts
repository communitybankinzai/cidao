import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHARED_THRESHOLD_USD,
  buildSharedCreditAlertLines,
  evaluateSharedCredit,
  readSharedCreditConfig,
  startOfUtcDay,
} from '@/lib/cost-alert-shared'

const NOW = new Date('2026-10-20T06:00:00Z')

describe('readSharedCreditConfig', () => {
  it('どちらも未設定なら not_configured（既存の動きを変えない）', () => {
    expect(readSharedCreditConfig({}, NOW)).toEqual({ status: 'not_configured' })
    expect(
      readSharedCreditConfig({ SHARED_CREDIT_BASELINE_USD: ' ', SHARED_CREDIT_BASELINE_AT: '' }, NOW),
    ).toEqual({ status: 'not_configured' })
  })

  it('片方だけ設定されていたら invalid（黙って無効にしない）', () => {
    const a = readSharedCreditConfig({ SHARED_CREDIT_BASELINE_USD: '30' }, NOW)
    const b = readSharedCreditConfig({ SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z' }, NOW)
    expect(a.status).toBe('invalid')
    expect(b.status).toBe('invalid')
  })

  it('正しい設定なら ok。警告ラインの既定は 15', () => {
    const s = readSharedCreditConfig(
      { SHARED_CREDIT_BASELINE_USD: '30.5', SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z' },
      NOW,
    )
    expect(s.status).toBe('ok')
    if (s.status === 'ok') {
      expect(s.config.baselineUsd).toBe(30.5)
      expect(s.config.baselineAt.toISOString()).toBe('2026-10-20T00:00:00.000Z')
      expect(s.config.thresholdUsd).toBe(DEFAULT_SHARED_THRESHOLD_USD)
    }
  })

  it('警告ラインを指定できる', () => {
    const s = readSharedCreditConfig(
      {
        SHARED_CREDIT_BASELINE_USD: '30',
        SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z',
        SHARED_CREDIT_ALERT_THRESHOLD_USD: '25',
      },
      NOW,
    )
    expect(s.status === 'ok' && s.config.thresholdUsd).toBe(25)
  })

  it.each([
    ['基準額が数値でない', { SHARED_CREDIT_BASELINE_USD: 'abc', SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z' }],
    ['基準額がマイナス', { SHARED_CREDIT_BASELINE_USD: '-1', SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z' }],
    ['日時が読めない', { SHARED_CREDIT_BASELINE_USD: '30', SHARED_CREDIT_BASELINE_AT: 'きのう' }],
    ['日時が未来', { SHARED_CREDIT_BASELINE_USD: '30', SHARED_CREDIT_BASELINE_AT: '2027-01-01T00:00:00Z' }],
    [
      '警告ラインが数値でない',
      {
        SHARED_CREDIT_BASELINE_USD: '30',
        SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z',
        SHARED_CREDIT_ALERT_THRESHOLD_USD: 'x',
      },
    ],
  ])('%s → invalid', (_label, env) => {
    expect(readSharedCreditConfig(env, NOW).status).toBe('invalid')
  })
})

describe('evaluateSharedCredit', () => {
  const config = { baselineUsd: 30, baselineAt: new Date('2026-10-20T00:00:00Z'), thresholdUsd: 15 }

  it('残高が警告ラインを上回れば警告しない', () => {
    expect(evaluateSharedCredit(config, 10)).toEqual({ remainingUsd: 20, belowThreshold: false })
  })

  it('ちょうど警告ラインなら警告しない（未満で警告）', () => {
    expect(evaluateSharedCredit(config, 15)).toEqual({ remainingUsd: 15, belowThreshold: false })
  })

  it('警告ライン未満なら警告する', () => {
    const r = evaluateSharedCredit(config, 15.01)
    expect(r.belowThreshold).toBe(true)
    expect(r.remainingUsd).toBeCloseTo(14.99, 5)
  })

  it('1晩で $38 使うような消費も、基準額が十分なら検知できる', () => {
    const r = evaluateSharedCredit({ ...config, baselineUsd: 60 }, 38)
    expect(r.remainingUsd).toBe(22)
    expect(r.belowThreshold).toBe(false)
    expect(evaluateSharedCredit({ ...config, baselineUsd: 60 }, 50).belowThreshold).toBe(true)
  })

  it('推定がマイナスでも警告する', () => {
    expect(evaluateSharedCredit(config, 45)).toEqual({ remainingUsd: -15, belowThreshold: true })
  })
})

describe('buildSharedCreditAlertLines', () => {
  const config = { baselineUsd: 30, baselineAt: new Date('2026-10-20T00:00:00Z'), thresholdUsd: 15 }

  it('残高・警告ライン・基準額・消費・当日分が含まれない旨を書く', () => {
    const text = buildSharedCreditAlertLines(config, 20, 10).join('\n')
    expect(text).toContain('$10.00')
    expect(text).toContain('$15.00')
    expect(text).toContain('$30.00')
    expect(text).toContain('$20.00')
    expect(text).toContain('2026-10-20T00:00:00.000Z')
    expect(text).toContain('当日の消費は含みません')
  })

  it('キー名や N\'s factory のキー別の費用は書かない', () => {
    const text = buildSharedCreditAlertLines(config, 20, 10).join('\n')
    expect(text).not.toMatch(/nsfactory|cidao-|apikey_/)
  })

  it('マイナスのときは基準額の更新漏れの可能性を添える', () => {
    const text = buildSharedCreditAlertLines(config, 45, -15).join('\n')
    expect(text).toContain('マイナス')
    expect(text).toContain('基準額を更新していない')
  })
})

describe('startOfUtcDay', () => {
  it('UTC の日の頭に丸める', () => {
    expect(startOfUtcDay(new Date('2026-10-20T15:30:00Z')).toISOString()).toBe('2026-10-20T00:00:00.000Z')
  })
})
