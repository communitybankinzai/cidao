import { describe, expect, it } from 'vitest'
import { buildReportMail, monthProgressJst, projectMonthEnd, resultFromRunRow, type ReportResult } from '../report-mail'
import { describePauseState, pausePageUrl, pauseToken, verifyPauseToken } from '../pause'

const base: ReportResult = {
  ok: true, dryRun: false,
  fetched: { list: 30, details: 2, detailFailed: 0, calendar: 3, merged: 2, future: 2 },
  prefilter: { noImage: 5, noDate: 20, noEventWord: 1, notEvent: 1, already: 0, passed: 3 },
  inserted: ['ハロウィンマルシェ（2026-10-12）', '防災講座（2026-10-20）'],
  duplicates: ['防災講座（2026-10-20）= 既存「防災講座（印西市）」'],
  skipped: ['https://www.instagram.com/p/x/ チラシではない／自信度 0.4'],
  errors: [], unchanged: 0, costJpy: 5.9,
  budget: { monthBeforeJpy: 2.9, limitJpy: 500, exhausted: false },
  scanned: ['1', '2'],
}

describe('結果報告メール', () => {
  const started = new Date('2026-10-01T21:35:00Z') // 10/2 06:35 JST
  const finished = new Date('2026-10-01T21:36:02Z')
  const mail = buildReportMail({
    result: base, startedAt: started, finishedAt: finished, model: 'claude-sonnet-5', hashtag: '印西',
    monthCostJpy: 8.8, totalCostJpy: 8.8,
    adminUrl: 'https://cidao.vercel.app/admin/events/import', pauseUrl: 'https://cidao.vercel.app/api/instagram-events/pause?token=abc',
  })

  it('件名に日付・候補数・費用', () => {
    expect(mail.subject).toBe('【CiDAO】Instagram #印西 取り込み 10/2(金) の結果：候補 2 件・費用 5.9 円')
  })

  it('本文に一覧・候補・経費・一時停止ボタンが入る（HTML は値をエスケープ）', () => {
    expect(mail.html).toContain('10/2(金) 06:35（62 秒）')
    expect(mail.html).toContain('30 件')
    expect(mail.html).toContain('日付なし 20')
    expect(mail.html).toContain('<li>ハロウィンマルシェ（2026-10-12）</li>')
    expect(mail.html).toContain('既存「防災講座（印西市）」')
    expect(mail.html).toContain('今月の累計')
    expect(mail.html).toContain('8.8 円 ／ 上限 500 円（残り 491.2 円）')
    expect(mail.html).toContain('月末時点の見込み')
    expect(mail.html).toContain('href="https://cidao.vercel.app/api/instagram-events/pause?token=abc"')
    expect(mail.html).toContain('自動取り込みを一時停止する')
    expect(mail.text).toContain('候補 2 件・読み取り 2 枚・費用 5.9 円')
    expect(mail.text).toContain('■ 自動取り込みを一時停止する')
  })

  it('エラーがあれば件名に ⚠、上限到達なら ⏸', () => {
    const err = buildReportMail({ result: { ...base, ok: false, errors: ['insert x: boom'] }, startedAt: started, finishedAt: finished, model: 'm', hashtag: '印西', monthCostJpy: 0, totalCostJpy: 0, adminUrl: 'a', pauseUrl: 'p' })
    expect(err.subject.startsWith('⚠ ')).toBe(true)
    expect(err.html).toContain('insert x: boom')
    const full = buildReportMail({ result: { ...base, budget: { monthBeforeJpy: 500, limitJpy: 500, exhausted: true } }, startedAt: started, finishedAt: finished, model: 'm', hashtag: '印西', monthCostJpy: 500, totalCostJpy: 500, adminUrl: 'a', pauseUrl: 'p' })
    expect(full.subject.startsWith('⏸ ')).toBe(true)
    expect(full.html).toContain('翌月 1 日まで読み取りを止めています')
  })

  it('月末見込みは 1 日あたり平均 × 日数（JST）', () => {
    expect(monthProgressJst(new Date('2026-10-01T21:35:00Z'))).toEqual({ day: 2, days: 31 })
    expect(projectMonthEnd(6, new Date('2026-10-01T21:35:00Z'))).toBe(93)
    expect(monthProgressJst(new Date('2026-02-28T15:30:00Z'))).toEqual({ day: 1, days: 31 }) // 3/1 00:30 JST
  })

  it('実行記録の行から復元できる（?report=1）', () => {
    const r = resultFromRunRow({
      ok: true, dry_run: false, fetched: { list: 30, details: 1 }, errors: [], unchanged: 0,
      detail: { inserted: [], duplicates: [], skipped: ['a'], scanned: ['1'], costJpy: 2.946, budget: { monthBeforeJpy: 0, limitJpy: 500, exhausted: false }, prefilter: { noImage: 5, noDate: 21, noEventWord: 2, notEvent: 1, already: 0, passed: 1 }, model: 'claude-sonnet-5' },
    })
    expect(r.fetched).toEqual({ list: 30, details: 1, detailFailed: 0, calendar: 0, merged: 0, future: 0 })
    expect(r.costJpy).toBe(2.946)
    expect(r.skipped).toEqual(['a'])
    expect(r.prefilter?.noDate).toBe(21)
    expect(resultFromRunRow({ ok: false, dry_run: false, fetched: null, errors: ['x'], unchanged: null, detail: null }).errors).toEqual(['x'])
  })
})

describe('一時停止のトークン', () => {
  it('CRON_SECRET から決まり、違う値は通らない', () => {
    const t = pauseToken('secret-a')
    expect(t).toHaveLength(64)
    expect(verifyPauseToken('secret-a', t)).toBe(true)
    expect(verifyPauseToken('secret-b', t)).toBe(false)
    expect(verifyPauseToken('secret-a', t.slice(0, 63))).toBe(false)
    expect(verifyPauseToken('secret-a', null)).toBe(false)
    expect(verifyPauseToken('', t)).toBe(false)
    expect(pausePageUrl('https://cidao.vercel.app/', 'secret-a')).toBe(`https://cidao.vercel.app/api/instagram-events/pause?token=${t}`)
  })

  it('状態の説明文', () => {
    expect(describePauseState({ paused: false, changed_at: null, via: null })).toContain('稼働中')
    expect(describePauseState({ paused: true, changed_at: '2026-10-01T22:00:00Z', via: 'email' })).toBe('一時停止中（10/2 07:00 にメールのボタンから停止）。再開するまで朝の取り込みを行いません')
    expect(describePauseState({ paused: true, changed_at: '2026-10-01T22:00:00Z', via: 'admin' })).toContain('管理画面から停止')
  })
})
