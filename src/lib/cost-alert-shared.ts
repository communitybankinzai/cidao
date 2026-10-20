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
// 環境変数（すべて任意。SHARED_CREDIT_BASELINE_* が両方そろったときだけ有効になる）:
//   SHARED_CREDIT_BASELINE_USD        : 基準日時の Console の実残高（USD）。補充したら、補充直後の残高に更新する
//   SHARED_CREDIT_BASELINE_AT         : その日時（ISO8601。例 2026-10-20T06:00:00Z）
//   SHARED_CREDIT_ALERT_THRESHOLD_USD : 警告ライン（既定 15）。日次の点検のため、1晩で $40 ほど使う処理もあることを見込む
//
// 注意: cost_report は前日（UTC）までしか返さず、当日の消費は含まれない。実残高は推定よりその分だけ少ない可能性がある。

export const DEFAULT_SHARED_THRESHOLD_USD = 15

const DAY_MS = 86400_000

export type SharedCreditConfig = {
  baselineUsd: number
  baselineAt: Date
  thresholdUsd: number
}

export type SharedCreditConfigState =
  | { status: 'not_configured' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; config: SharedCreditConfig }

export type SharedCreditEvaluation = {
  remainingUsd: number
  belowThreshold: boolean
}

type EnvLike = Record<string, string | undefined>

/** UTC の日付の 0 時（基準日の消費を取りこぼさないよう、日の頭から数える。二重に数える分は安全側） */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function readSharedCreditConfig(env: EnvLike, now: Date = new Date()): SharedCreditConfigState {
  const usdRaw = (env.SHARED_CREDIT_BASELINE_USD ?? '').trim()
  const atRaw = (env.SHARED_CREDIT_BASELINE_AT ?? '').trim()
  if (!usdRaw && !atRaw) return { status: 'not_configured' }
  if (!usdRaw || !atRaw) {
    return {
      status: 'invalid',
      reason: 'SHARED_CREDIT_BASELINE_USD と SHARED_CREDIT_BASELINE_AT は、両方そろえて設定してください',
    }
  }

  const baselineUsd = Number(usdRaw)
  if (!Number.isFinite(baselineUsd) || baselineUsd < 0) {
    return { status: 'invalid', reason: 'SHARED_CREDIT_BASELINE_USD が 0 以上の数値ではありません' }
  }

  const baselineAt = new Date(atRaw)
  if (Number.isNaN(baselineAt.getTime())) {
    return { status: 'invalid', reason: 'SHARED_CREDIT_BASELINE_AT が日時（ISO8601）として読めません' }
  }
  if (baselineAt.getTime() > now.getTime() + DAY_MS) {
    return { status: 'invalid', reason: 'SHARED_CREDIT_BASELINE_AT が未来の日時です' }
  }

  const thRaw = (env.SHARED_CREDIT_ALERT_THRESHOLD_USD ?? '').trim()
  const thresholdUsd = thRaw === '' ? DEFAULT_SHARED_THRESHOLD_USD : Number(thRaw)
  if (!Number.isFinite(thresholdUsd) || thresholdUsd < 0) {
    return { status: 'invalid', reason: 'SHARED_CREDIT_ALERT_THRESHOLD_USD が 0 以上の数値ではありません' }
  }

  return { status: 'ok', config: { baselineUsd, baselineAt, thresholdUsd } }
}

/** 実残高の推定 = 基準額 − 基準日以降の組織全体の消費。警告ライン「未満」で警告する */
export function evaluateSharedCredit(config: SharedCreditConfig, orgSpentUsd: number): SharedCreditEvaluation {
  const remainingUsd = config.baselineUsd - orgSpentUsd
  return { remainingUsd, belowThreshold: remainingUsd < config.thresholdUsd }
}

/** 警告メールの本文（HTML の <p> 1つぶんずつ）。キー別・N's factory のキー名は書かない */
export function buildSharedCreditAlertLines(
  config: SharedCreditConfig,
  orgSpentUsd: number,
  remainingUsd: number,
): string[] {
  const since = config.baselineAt.toISOString()
  const lines = [
    '<strong>共用クレジット（組織全体）の実残高が少なくなっています。</strong>',
    `推定の実残高: <strong>$${remainingUsd.toFixed(2)}</strong>（警告ライン $${config.thresholdUsd.toFixed(2)}）`,
    `基準額 $${config.baselineUsd.toFixed(2)}（${since}）から、組織全体で $${orgSpentUsd.toFixed(2)} を消費しました（CiDAO と N's factory の合計）。`,
    '共用クレジットが尽きると、CiDAO のチラシAI抽出・提案分類・団体マッチングもすべて止まります（N\'s factory 側の処理が使っても同じです）。',
    '集計は前日（UTC）までで、当日の消費は含みません。実際の残高はこれより少ない可能性があります。',
  ]
  if (remainingUsd < 0) {
    lines.splice(
      1,
      0,
      '基準額より消費が大きく、推定がマイナスです。補充済みで基準額を更新していない可能性があります（Console の実残高を確認してください）。',
    )
  }
  return lines
}
