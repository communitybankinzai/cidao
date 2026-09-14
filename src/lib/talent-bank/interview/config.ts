// Failed AI attempts count too: retrying must not bypass the budget guard.
export const MAX_INTERVIEW_TURNS = 40
export const MAX_USER_TEXT_LENGTH = 4000
export const MAX_ASSISTANT_TEXT_LENGTH = 4000
export const INTERVIEW_RATE_LIMIT = 10
export const INTERVIEW_RATE_WINDOW_MS = 60_000
export const INITIAL_MESSAGE = 'こんにちは。CBIの聞き手として、あなたの活動を一つずつ伺います。該当なし・答えたくない、でも大丈夫です。まず、紹介に使う氏名または表示名を教えてください。'
