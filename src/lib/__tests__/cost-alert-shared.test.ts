import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHARED_THRESHOLD_USD,
  buildSharedCreditAlertLines,
  buildSharedCreditExpiryLines,
  evaluateSharedCredit,
  readSharedCreditConfig,
  startOfUtcDay,
  type SharedCreditConfig,
} from '@/lib/cost-alert-shared'

const NOW = new Date('2026-10-20T06:00:00Z')

const BASE_ENV = { SHARED_CREDIT_BASELINE_USD: '30', SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z' }

describe('readSharedCreditConfig', () => {
  it('どちらも未設定なら not_configured（既存の動きを変えない）', () => {
    expect(readSharedCreditConfig({}, NOW)).toEqual({ status: 'not_configured' })
    expect(
      readSharedCreditConfig({ SHARED_CREDIT_BASELINE_USD: ' ', SHARED_CREDIT_BASELINE_AT: '' }, NOW),
    ).toEqual({ status: 'not_configured' })
  })

  it('片方だけ設定されていたら invalid（黙って無効にしない）', () => {
    expect(readSharedCreditConfig({ SHARED_CREDIT_BASELINE_USD: '30' }, NOW).status).toBe('invalid')
    expect(readSharedCreditConfig({ SHARED_CREDIT_BASELINE_AT: '2026-10-20T00:00:00Z' }, NOW).status).toBe('invalid')
  })

  it('正しい設定なら ok。警告ラインの既定は 15、期限つきクレジットは無し', () => {
    const s = readSharedCreditConfig({ ...BASE_ENV, SHARED_CREDIT_BASELINE_USD: '30.5' }, NOW)
    expect(s.status).toBe('ok')
    if (s.status === 'ok') {
      expect(s.config.baselineUsd).toBe(30.5)
      expect(s.config.baselineAt.toISOString()).toBe('2026-10-20T00:00:00.000Z')
      expect(s.config.thresholdUsd).toBe(DEFAULT_SHARED_THRESHOLD_USD)
      expect(s.config.expiringUsd).toBe(0)
      expect(s.config.expiringAt).toBeNull()
    }
  })

  it('警告ラインを指定できる', () => {
    const s = readSharedCreditConfig({ ...BASE_ENV, SHARED_CREDIT_ALERT_THRESHOLD_USD: '25' }, NOW)
    expect(s.status === 'ok' && s.config.thresholdUsd).toBe(25)
  })

  it.each([
    ['基準額が数値でない', { ...BASE_ENV, SHARED_CREDIT_BASELINE_USD: 'abc' }],
    ['基準額がマイナス', { ...BASE_ENV, SHARED_CREDIT_BASELINE_USD: '-1' }],
    ['日時が読めない', { ...BASE_ENV, SHARED_CREDIT_BASELINE_AT: 'きのう' }],
    ['日時が未来', { ...BASE_ENV, SHARED_CREDIT_BASELINE_AT: '2027-01-01T00:00:00Z' }],
    ['警告ラインが数値でない', { ...BASE_ENV, SHARED_CREDIT_ALERT_THRESHOLD_USD: 'x' }],
  ])('%s → invalid', (_label, env) => {
    expect(readSharedCreditConfig(env, NOW).status).toBe('invalid')
  })
})

describe('readSharedCreditConfig: 期限つきクレジット（プロモーションクレジットなど）', () => {
  const ENV = {
    SHARED_CREDIT_BASELINE_USD: '216.04',
    SHARED_CREDIT_BASELINE_AT: '2026-10-20T09:00:00Z',
    SHARED_CREDIT_EXPIRING_USD: '199.32',
    SHARED_CREDIT_EXPIRING_AT: '2026-11-18T00:00:00Z',
  }
  const NOW2 = new Date('2026-10-20T10:00:00Z')

  it('2つそろえれば ok', () => {
    const s = readSharedCreditConfig(ENV, NOW2)
    expect(s.status).toBe('ok')
    if (s.status === 'ok') {
      expect(s.config.expiringUsd).toBe(199.32)
      expect(s.config.expiringAt?.toISOString()).toBe('2026-11-18T00:00:00.000Z')
    }
  })

  it('片方だけなら invalid', () => {
    expect(readSharedCreditConfig({ ...ENV, SHARED_CREDIT_EXPIRING_AT: '' }, NOW2).status).toBe('invalid')
    expect(readSharedCreditConfig({ ...ENV, SHARED_CREDIT_EXPIRING_USD: '' }, NOW2).status).toBe('invalid')
  })

  it.each([
    ['失効額が数値でない', { SHARED_CREDIT_EXPIRING_USD: 'x' }],
    ['失効額がマイナス', { SHARED_CREDIT_EXPIRING_USD: '-5' }],
    ['失効額が合計の基準額より大きい', { SHARED_CREDIT_EXPIRING_USD: '300' }],
    ['失効日時が読めない', { SHARED_CREDIT_EXPIRING_AT: 'らいげつ' }],
    ['失効日時が基準日時より前', { SHARED_CREDIT_EXPIRING_AT: '2026-10-01T00:00:00Z' }],
  ])('%s → invalid', (_label, patch) => {
    expect(readSharedCreditConfig({ ...ENV, ...patch }, NOW2).status).toBe('invalid')
  })
})

describe('evaluateSharedCredit（期限つきクレジットなし）', () => {
  const config: SharedCreditConfig = {
    baselineUsd: 30,
    baselineAt: new Date('2026-10-20T00:00:00Z'),
    thresholdUsd: 15,
    expiringUsd: 0,
    expiringAt: null,
  }

  it('残高が警告ラインを上回れば警告しない', () => {
    expect(evaluateSharedCredit(config, 10, NOW)).toMatchObject({ remainingUsd: 20, belowThreshold: false })
  })

  it('ちょうど警告ラインなら警告しない（未満で警告）', () => {
    expect(evaluateSharedCredit(config, 15, NOW)).toMatchObject({ remainingUsd: 15, belowThreshold: false })
  })

  it('警告ライン未満なら警告する', () => {
    const r = evaluateSharedCredit(config, 15.01, NOW)
    expect(r.belowThreshold).toBe(true)
    expect(r.remainingUsd).toBeCloseTo(14.99, 5)
  })

  it('1晩で $38 使うような消費も、基準額が十分なら検知できる', () => {
    const c = { ...config, baselineUsd: 60 }
    expect(evaluateSharedCredit(c, 38, NOW)).toMatchObject({ remainingUsd: 22, belowThreshold: false })
    expect(evaluateSharedCredit(c, 50, NOW).belowThreshold).toBe(true)
  })

  it('推定がマイナスでも警告する', () => {
    expect(evaluateSharedCredit(config, 45, NOW)).toMatchObject({ remainingUsd: -15, belowThreshold: true })
  })

  it('期限つきクレジットが無ければ、失効まわりの値は空', () => {
    expect(evaluateSharedCredit(config, 10, NOW)).toMatchObject({
      expired: false,
      afterExpiryUsd: null,
      daysToExpiry: null,
      expiryMilestone: false,
    })
  })
})

describe('evaluateSharedCredit（期限つきクレジットあり）: 2026-11-18 に $199.32 が失効・有料分は $16.72', () => {
  const config: SharedCreditConfig = {
    baselineUsd: 216.04,
    baselineAt: new Date('2026-10-20T09:00:00Z'),
    thresholdUsd: 15,
    expiringUsd: 199.32,
    expiringAt: new Date('2026-11-18T00:00:00Z'),
  }

  it('失効前は合計で数える。失効後の見込みも出す（有料分 − 消費）', () => {
    const r = evaluateSharedCredit(config, 2, new Date('2026-10-25T06:00:00Z'))
    expect(r.remainingUsd).toBeCloseTo(214.04, 5)
    expect(r.belowThreshold).toBe(false)
    expect(r.expired).toBe(false)
    expect(r.afterExpiryUsd).toBeCloseTo(14.72, 5)
    expect(r.daysToExpiry).toBe(24)
    expect(r.expiryMilestone).toBe(false)
  })

  it.each([
    ['14日前', '2026-11-04T00:00:00Z', 14, true],
    ['7日前', '2026-11-11T00:00:00Z', 7, true],
    ['3日前', '2026-11-15T00:00:00Z', 3, true],
    ['1日前', '2026-11-17T00:00:00Z', 1, true],
    ['13日前（予告の日ではない）', '2026-11-05T00:00:00Z', 13, false],
    ['2日前（予告の日ではない）', '2026-11-16T00:00:00Z', 2, false],
  ])('失効の%s → 日数 %i・予告 %s', (_label, now, days, milestone) => {
    const r = evaluateSharedCredit(config, 5, new Date(now))
    expect(r.daysToExpiry).toBe(days)
    expect(r.expiryMilestone).toBe(milestone)
  })

  it('失効の日時を過ぎたら、有料分だけで判定する（最悪側）', () => {
    const r = evaluateSharedCredit(config, 14.5, new Date('2026-11-18T00:00:00Z'))
    expect(r.expired).toBe(true)
    expect(r.remainingUsd).toBeCloseTo(2.22, 5)
    expect(r.belowThreshold).toBe(true)
    expect(r.daysToExpiry).toBeNull()
    expect(r.expiryMilestone).toBe(false)
  })

  it('失効後でも、有料分が十分にあれば警告しない', () => {
    const r = evaluateSharedCredit({ ...config, baselineUsd: 266.04 }, 5, new Date('2026-11-20T00:00:00Z'))
    expect(r.remainingUsd).toBeCloseTo(61.72, 5)
    expect(r.belowThreshold).toBe(false)
  })
})

describe('buildSharedCreditAlertLines', () => {
  const config: SharedCreditConfig = {
    baselineUsd: 30,
    baselineAt: new Date('2026-10-20T00:00:00Z'),
    thresholdUsd: 15,
    expiringUsd: 0,
    expiringAt: null,
  }

  it('残高・警告ライン・基準額・消費・当日分が含まれない旨を書く', () => {
    const text = buildSharedCreditAlertLines(config, 20, evaluateSharedCredit(config, 20, NOW)).join('\n')
    expect(text).toContain('$10.00')
    expect(text).toContain('$15.00')
    expect(text).toContain('$30.00')
    expect(text).toContain('$20.00')
    expect(text).toContain('2026-10-20T00:00:00.000Z')
    expect(text).toContain('当日の消費は含みません')
  })

  it("キー名や N's factory のキー別の費用は書かない", () => {
    const text = buildSharedCreditAlertLines(config, 20, evaluateSharedCredit(config, 20, NOW)).join('\n')
    expect(text).not.toMatch(/nsfactory|cidao-|apikey_/)
  })

  it('マイナスのときは基準値の更新漏れの可能性を添える', () => {
    const text = buildSharedCreditAlertLines(config, 45, evaluateSharedCredit(config, 45, NOW)).join('\n')
    expect(text).toContain('マイナス')
    expect(text).toContain('基準値を更新していない')
  })

  it('失効済みなら、失効後は有料分だけで数えていることを添える', () => {
    const c: SharedCreditConfig = {
      baselineUsd: 216.04,
      baselineAt: new Date('2026-10-20T09:00:00Z'),
      thresholdUsd: 15,
      expiringUsd: 199.32,
      expiringAt: new Date('2026-11-18T00:00:00Z'),
    }
    const ev = evaluateSharedCredit(c, 14.5, new Date('2026-11-19T00:00:00Z'))
    const text = buildSharedCreditAlertLines(c, 14.5, ev).join('\n')
    expect(text).toContain('失効済み')
    expect(text).toContain('有料分だけで数えています')
  })
})

describe('buildSharedCreditExpiryLines', () => {
  const config: SharedCreditConfig = {
    baselineUsd: 216.04,
    baselineAt: new Date('2026-10-20T09:00:00Z'),
    thresholdUsd: 15,
    expiringUsd: 199.32,
    expiringAt: new Date('2026-11-18T00:00:00Z'),
  }

  it('失効までの日数・失効後の見込み・最悪側の見積もりであることを書く', () => {
    const ev = evaluateSharedCredit(config, 5, new Date('2026-11-04T00:00:00Z'))
    const text = buildSharedCreditExpiryLines(config, 5, ev).join('\n')
    expect(text).toContain('あと 14 日')
    expect(text).toContain('2026-11-18T00:00:00.000Z')
    expect(text).toContain('$11.72') // 16.72 − 5
    expect(text).toContain('最悪側')
  })

  it('失効後の見込みが警告ライン未満なら、強い言葉で知らせる', () => {
    const ev = evaluateSharedCredit(config, 5, new Date('2026-11-04T00:00:00Z'))
    const text = buildSharedCreditExpiryLines(config, 5, ev).join('\n')
    expect(text).toContain('警告ラインを下回ります')
  })

  it('失効後の見込みが十分なら、強い言葉は付けない', () => {
    const c = { ...config, baselineUsd: 266.04 } // 有料分 $66.72
    const ev = evaluateSharedCredit(c, 5, new Date('2026-11-04T00:00:00Z'))
    const text = buildSharedCreditExpiryLines(c, 5, ev).join('\n')
    expect(text).not.toContain('警告ラインを下回ります')
    expect(text).toContain('$61.72')
  })
})

describe('startOfUtcDay', () => {
  it('UTC の日の頭に丸める', () => {
    expect(startOfUtcDay(new Date('2026-10-20T15:30:00Z')).toISOString()).toBe('2026-10-20T00:00:00.000Z')
  })
})
