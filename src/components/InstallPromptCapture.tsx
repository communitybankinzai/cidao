'use client'

// 「ホーム画面に追加できます」の合図を、最初の読み込みで受け取っておくための部品。layout.tsx に1つだけ置く。
// 画面には何も出さない。読み込むだけで lib/install-prompt.ts が合図を待ち受ける（理由は同ファイルの説明）。
import { useEffect } from 'react'
import '@/lib/install-prompt'
import { trackInstallOnce } from '@/lib/install-track'

export function InstallPromptCapture() {
  // ホーム画面のアイコンから開いた端末を、初回の1回だけ数える（2026-11-25）。
  // iPhone には「追加できた」の合図が無いので、追加した人はここで数える
  useEffect(() => {
    try {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
      if (standalone) trackInstallOnce('install-standalone')
    } catch {
      // 判定できない端末では数えない
    }
  }, [])
  return null
}
