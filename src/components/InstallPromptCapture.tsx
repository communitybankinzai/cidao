'use client'

// 「ホーム画面に追加できます」の合図を、最初の読み込みで受け取っておくための部品。layout.tsx に1つだけ置く。
// 画面には何も出さない。読み込むだけで lib/install-prompt.ts が合図を待ち受ける（理由は同ファイルの説明）。
import '@/lib/install-prompt'

export function InstallPromptCapture() {
  return null
}
