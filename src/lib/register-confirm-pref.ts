// イベント登録の確認通知を、スマホにも鳴らすかの設定（members.contact_preferences）。
//
// サーバー専用の部品（notify・push）に依存しないよう、キーと判定だけをここに分ける。
// マイページの部品（クライアント）・保存処理・確認通知の送信側が、同じ定義を使う。

/** 設定の保存キー */
export const REGISTER_CONFIRM_PUSH_KEY = 'register_confirm_push'

/** 未設定は「スマホにも鳴らす」（従来どおり）。false を選んだ人だけベルのみ */
export function wantsRegisterConfirmPush(prefs: unknown): boolean {
  return ((prefs ?? {}) as Record<string, unknown>)[REGISTER_CONFIRM_PUSH_KEY] !== false
}
