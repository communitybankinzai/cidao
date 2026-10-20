// 共用クレジット（Anthropic 組織全体の前払い残高）の実残高の推定と警告の判定。
//
// 背景: Anthropic のクレジットは N's factory の組織で前払いされ、CiDAO のキーと N's factory のキーが
//       同じクレジットから引き落とされる。2026-10-11 の決定で、既存の残高判定（CREDIT_BASELINE_*）は
//       「CiDAO のキー分だけ」を引く方式になったため、N's factory 側が大きく使っても警告が出ない。
//       2026-10-09 未明に N's factory 側の一括処理だけで約 $38 を使った（CiDAO 側の判定には出ない）。
//       共用クレジットが尽きると CiDAO の AI 機能も 401 で止まる（2026-07-27 の再発防止）。
//
// そこで「組織全体の消費」を、Console で確かめた実残高（基準額）から引いて、共用クレジットの実残高を推定する。
// 既存の CREDIT_BASELINE_*（CiDAO 分の判定用）には手を付けず、専用の環境変数を使う。
//
// 有効期限つきのクレジット（プロモーションクレジットなど）がある場合:
//   Console の請求画面には「プロモーションクレジット（残高・有効期限）」が別に出る。2026-10-15 に $200 が付与され、
//   2026-11-18 に失効する。失効すると、使い切れなかった分は消え、使える残高は有料分だけになる。
//   しかも実測（付与後の消費 $2.40 に対し、プロモの使用済みは $0.68）で、消費はプロモ分から先に引かれていない。
//   そのため、失効後は「有料分（基準額 − 失効する額）から、基準日以降の消費をすべて引く」最悪側の見積もりで判定する。
//
// 環境変数（すべて任意。SHARED_CREDIT_BASELINE_* が両方そろったときだけ有効になる）:
//   SHARED_CREDIT_BASELINE_USD        : 基準日時の Console の実残高（USD・合計）。補充したら、補充直後の残高に更新する
//   SHARED_CREDIT_BASELINE_AT         : その日時（ISO8601。例 2026-10-20T09:00:00Z）
//   SHARED_CREDIT_ALERT_THRESHOLD_USD : 警告ライン（既定 15）。日次の点検のため、1晩で $40 ほど使う処理もあることを見込む
//   SHARED_CREDIT_EXPIRING_USD        : 基準日時の時点で、期限つきクレジットの残高（USD）。例 199.32
//   SHARED_CREDIT_EXPIRING_AT         : その失効日時（ISO8601。Console は UTC 表示。例 2026-11-18T00:00:00Z）。
//                                       EXPIRING の2つは両方そろえる。失効や補充のあとは、基準値ごと更新する
//
// 注意: cost_report は前日（UTC）までしか返さず、当日の消費は含まれない。実残高は推定よりその分だけ少ない可能性がある。

export const DEFAULT_SHARED_THRESHOLD_USD = 15
/** 失効の何日前に知らせるか（毎日は鳴らさず、この日数の当日だけ） */
export const EXPIRY_MILESTONE_DAYS = [14, 7, 3, 1]

const DAY_MS = 86400_000

export type SharedCreditConfig = {
  baselineUsd: number
  baselineAt: Date
  thresholdUsd: number
  /** 期限つきクレジットの残高（基準日時の時点）。無ければ 0 */
  expiringUsd: number
  /** 期限つきクレジットの失効日時。無ければ null */
  expiringAt: Date | null
}

export type SharedCreditConfigState =
  | { status: 'not_configured' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; config: SharedCreditConfig }

export type SharedCreditEvaluation = {
  /** 判定に使う実残高の推定。失効日を過ぎたら、有料分だけで数える（最悪側） */
  remainingUsd: number
  belowThreshold: boolean
  /** 期限つきクレジットが失効済みか */
  expired: boolean
  /** 失効後に使える見込み（有料分 − 基準日以降の消費）。期限つきクレジットの設定が無ければ null */
  afterExpiryUsd: number | null
  /** 失効までの日数（切り上げ）。失効済み・設定なしは null */
  daysToExpiry: number | null
  /** 失効の 14・7・3・1 日前の当日か */
  expiryMilestone: boolean
}

type EnvLike = Record<string, string | undefined>

/** UTC の日付の 0 時（基準日の消費を取りこぼさないよう、日の頭から数える。二重に数える分は安全側） */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function invalid(reason: string): SharedCreditConfigState {
  return { status: 'invalid', reason }
}

export function readSharedCreditConfig(env: EnvLike, now: Date = new Date()): SharedCreditConfigState {
  const usdRaw = (env.SHARED_CREDIT_BASELINE_USD ?? '').trim()
  const atRaw = (env.SHARED_CREDIT_BASELINE_AT ?? '').trim()
  if (!usdRaw && !atRaw) return { status: 'not_configured' }
  if (!usdRaw || !atRaw) {
    return invalid('SHARED_CREDIT_BASELINE_USD と SHARED_CREDIT_BASELINE_AT は、両方そろえて設定してください')
  }

  const baselineUsd = Number(usdRaw)
  if (!Number.isFinite(baselineUsd) || baselineUsd < 0) {
    return invalid('SHARED_CREDIT_BASELINE_USD が 0 以上の数値ではありません')
  }

  const baselineAt = new Date(atRaw)
  if (Number.isNaN(baselineAt.getTime())) {
    return invalid('SHARED_CREDIT_BASELINE_AT が日時（ISO8601）として読めません')
  }
  if (baselineAt.getTime() > now.getTime() + DAY_MS) {
    return invalid('SHARED_CREDIT_BASELINE_AT が未来の日時です')
  }

  const thRaw = (env.SHARED_CREDIT_ALERT_THRESHOLD_USD ?? '').trim()
  const thresholdUsd = thRaw === '' ? DEFAULT_SHARED_THRESHOLD_USD : Number(thRaw)
  if (!Number.isFinite(thresholdUsd) || thresholdUsd < 0) {
    return invalid('SHARED_CREDIT_ALERT_THRESHOLD_USD が 0 以上の数値ではありません')
  }

  // 期限つきクレジット（任意）。2つそろえて設定する
  const expUsdRaw = (env.SHARED_CREDIT_EXPIRING_USD ?? '').trim()
  const expAtRaw = (env.SHARED_CREDIT_EXPIRING_AT ?? '').trim()
  let expiringUsd = 0
  let expiringAt: Date | null = null
  if (expUsdRaw || expAtRaw) {
    if (!expUsdRaw || !expAtRaw) {
      return invalid('SHARED_CREDIT_EXPIRING_USD と SHARED_CREDIT_EXPIRING_AT は、両方そろえて設定してください')
    }
    expiringUsd = Number(expUsdRaw)
    if (!Number.isFinite(expiringUsd) || expiringUsd < 0) {
      return invalid('SHARED_CREDIT_EXPIRING_USD が 0 以上の数値ではありません')
    }
    if (expiringUsd > baselineUsd) {
      return invalid('SHARED_CREDIT_EXPIRING_USD が、合計の基準額（SHARED_CREDIT_BASELINE_USD）より大きいです')
    }
    expiringAt = new Date(expAtRaw)
    if (Number.isNaN(expiringAt.getTime())) {
      return invalid('SHARED_CREDIT_EXPIRING_AT が日時（ISO8601）として読めません')
    }
    if (expiringAt.getTime() <= baselineAt.getTime()) {
      return invalid('SHARED_CREDIT_EXPIRING_AT が基準日時より前です（失効済みの分は基準額に含めないでください）')
    }
  }

  return { status: 'ok', config: { baselineUsd, baselineAt, thresholdUsd, expiringUsd, expiringAt } }
}

/**
 * 実残高の推定 = 基準額 − 基準日以降の組織全体の消費。警告ライン「未満」で警告する。
 * 期限つきクレジットがあり、失効日を過ぎたら「有料分（基準額 − 失効する額）− 消費」で数える（最悪側）。
 */
export function evaluateSharedCredit(
  config: SharedCreditConfig,
  orgSpentUsd: number,
  now: Date = new Date(),
): SharedCreditEvaluation {
  const hasExpiry = config.expiringAt !== null
  const expired = hasExpiry && now.getTime() >= config.expiringAt!.getTime()
  const afterExpiryUsd = hasExpiry ? config.baselineUsd - config.expiringUsd - orgSpentUsd : null
  const remainingUsd = expired ? afterExpiryUsd! : config.baselineUsd - orgSpentUsd
  const daysToExpiry =
    hasExpiry && !expired ? Math.ceil((config.expiringAt!.getTime() - now.getTime()) / DAY_MS) : null

  return {
    remainingUsd,
    belowThreshold: remainingUsd < config.thresholdUsd,
    expired,
    afterExpiryUsd,
    daysToExpiry,
    expiryMilestone: daysToExpiry !== null && EXPIRY_MILESTONE_DAYS.includes(daysToExpiry),
  }
}

/** 警告メールの本文（HTML の <p> 1つぶんずつ）。キー別・N's factory のキー名は書かない */
export function buildSharedCreditAlertLines(
  config: SharedCreditConfig,
  orgSpentUsd: number,
  ev: SharedCreditEvaluation,
): string[] {
  const since = config.baselineAt.toISOString()
  const lines = [
    '<strong>共用クレジット（組織全体）の実残高が少なくなっています。</strong>',
    `推定の実残高: <strong>$${ev.remainingUsd.toFixed(2)}</strong>（警告ライン $${config.thresholdUsd.toFixed(2)}）`,
    `基準額 $${config.baselineUsd.toFixed(2)}（${since}）から、組織全体で $${orgSpentUsd.toFixed(2)} を消費しました（CiDAO と N's factory の合計）。`,
    '共用クレジットが尽きると、CiDAO のチラシAI抽出・提案分類・団体マッチングもすべて止まります（N\'s factory 側の処理が使っても同じです）。',
    '集計は前日（UTC）までで、当日の消費は含みません。実際の残高はこれより少ない可能性があります。',
  ]
  if (ev.expired && config.expiringAt) {
    lines.splice(
      1,
      0,
      `期限つきクレジット（基準日時で $${config.expiringUsd.toFixed(2)}）は ${config.expiringAt.toISOString()} に失効済みです。失効後は、有料分だけで数えています。`,
    )
  }
  if (ev.remainingUsd < 0) {
    lines.splice(
      1,
      0,
      '推定がマイナスです。補充済みで基準値を更新していない可能性があります（Console の実残高を確認してください）。',
    )
  }
  return lines
}

/** 失効の 14・7・3・1 日前の当日だけ出す、予告のメール本文 */
export function buildSharedCreditExpiryLines(
  config: SharedCreditConfig,
  orgSpentUsd: number,
  ev: SharedCreditEvaluation,
): string[] {
  const at = config.expiringAt!
  const paid = config.baselineUsd - config.expiringUsd
  const after = ev.afterExpiryUsd ?? 0
  const lines = [
    `<strong>期限つきクレジットが、あと ${ev.daysToExpiry} 日（${at.toISOString()}）で失効します。</strong>`,
    `失効後に使える見込みの実残高: <strong>$${after.toFixed(2)}</strong>（有料分 $${paid.toFixed(2)} − 基準日以降の消費 $${orgSpentUsd.toFixed(2)}）。警告ライン $${config.thresholdUsd.toFixed(2)}。`,
    '消費が期限つきクレジットから先に引かれているとは限らないため、失効後は有料分だけで数えた最悪側の見積もりです。',
    '失効後に使える残高が足りない場合は、失効の前にクレジットの補充や自動チャージを検討してください。補充したら、基準値（SHARED_CREDIT_BASELINE_*・EXPIRING_*）を更新してください。',
  ]
  if (after < config.thresholdUsd) {
    lines.splice(
      1,
      0,
      '<strong>このままでは、失効後の実残高が警告ラインを下回ります。</strong>失効後すぐに CiDAO と N\'s factory の AI 機能が止まるおそれがあります。',
    )
  }
  return lines
}
