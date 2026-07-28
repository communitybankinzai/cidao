/**
 * WEB 公開情報から取得したデータで団体を一括登録したとき、
 * organizations.representative_id を埋めるために使われたダミーアカウント。
 * 実在の人物ではなく、代表者による claim を待っている印として入っている。
 */
export const PLACEHOLDER_REPRESENTATIVE_ID = '943a665e-474d-46da-9f2d-a8cfa0f1bcaa'

/** イベント取り込みバッチが使うシステムアカウント。 */
export const INGEST_BOT_MEMBER_ID = '31f6bcf1-ce27-4825-a11c-591c5d3cd729'

/** 登録者数の集計から除くシステムアカウント。 */
export const SYSTEM_MEMBER_IDS = [PLACEHOLDER_REPRESENTATIVE_ID, INGEST_BOT_MEMBER_ID]

/**
 * 実在の代表者がまだ本登録（claim）していない団体か。
 * representative_id が空の場合に加え、プレースホルダーが入ったままの場合も「未確定」とみなす。
 */
export function isAwaitingRepresentative(representativeId: string | null | undefined): boolean {
  return !representativeId || representativeId === PLACEHOLDER_REPRESENTATIVE_ID
}
