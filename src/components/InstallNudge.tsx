'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  INSTALL_GUIDE_PATH,
  INSTALL_NUDGE_DISMISS_KEY,
  decideInstallNudge,
  detectDevice,
  externalBrowserUrl,
  type InstallNudgeMode,
} from '@/lib/install-nudge'
import { canPromptInstall, promptInstall, subscribeInstallPrompt, wasInstalled } from '@/lib/install-prompt'
import { trackInstall, trackInstallOnce } from '@/lib/install-track'

/**
 * 本登録・保存の直後に出す「ホーム画面に追加」の案内（2026-11-24 事業主決定・A案）。
 *
 * サイトが自動でアイコンを置くことはできない（スマホの決まり）ので、端末に合った一番短い道を出す。
 *   ・Android（Chrome）：「ホーム画面に追加する」ボタン。押すと確認が1回出て終わり
 *   ・iPhone：共有ボタンからの3手順（iPhone にはボタンで追加する仕組みが無い）
 *   ・LINE の中の画面：ここからは追加できないので、先に Safari／Chrome で開き直すボタン
 * 出さない人：ホーム画面のアイコンから開いている人（追加済み）・閉じたことがある人・パソコン。
 * どの形で出すかの規則は lib/install-nudge.ts にある。
 */
export function InstallNudge() {
  const [mode, setMode] = useState<InstallNudgeMode>('none')
  const [added, setAdded] = useState(false)
  const [isIos, setIsIos] = useState(false)

  useEffect(() => {
    const decide = () => {
      try {
        if (wasInstalled()) {
          setAdded(true)
          return
        }
        const ua = navigator.userAgent || ''
        const device = detectDevice(ua)
        const standalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
        setIsIos(device.isIos)
        setMode(
          decideInstallNudge({
            ...device,
            standalone,
            canPrompt: canPromptInstall(),
            dismissed: !!localStorage.getItem(INSTALL_NUDGE_DISMISS_KEY),
          }),
        )
      } catch {
        // 保存領域が使えない等のときは、案内自体を出さない
      }
    }
    const t = setTimeout(decide, 0)
    // 合図があとから届いたとき・追加が済んだときに、出し方を決め直す
    const unsubscribe = subscribeInstallPrompt(decide)
    return () => {
      clearTimeout(t)
      unsubscribe()
    }
  }, [])

  // 案内が出た回数を数える（端末ごとに1回。保存のたびに増えないように）
  useEffect(() => {
    if (mode !== 'none') trackInstallOnce('install-shown')
  }, [mode])

  if (added) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-3 rounded text-sm text-emerald-900 dark:text-emerald-100">
        ✓ ホーム画面に追加しました。次からは、CiDAOのアイコンから開けます。
      </div>
    )
  }
  if (mode === 'none') return null

  const dismiss = () => {
    try {
      localStorage.setItem(INSTALL_NUDGE_DISMISS_KEY, String(Date.now()))
    } catch {
      // 覚えられなくても、この画面からは消す
    }
    setMode('none')
  }

  const openOutside = () => {
    const url = `${window.location.origin}${INSTALL_GUIDE_PATH}`
    const target = externalBrowserUrl(url, navigator.userAgent || '')
    if (target) window.location.href = target
    else window.open(url, '_blank')
  }

  const add = async () => {
    trackInstall('install-tap')
    const outcome = await promptInstall()
    if (outcome === 'accepted') setAdded(true)
    // やめた・出せなかったときは、合図を使い切っているので、手順の表示に切り替わる（decide が決め直す）
  }

  return (
    <section
      aria-label="ホーム画面に追加のご案内"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3"
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          📲 CiDAOをホーム画面に追加しませんか
        </p>
        <p className="text-xs text-slate-500">
          アイコンから1回で開けるようになります（無料・アプリストアからの入手は不要）。
        </p>
      </div>

      {mode === 'line' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            LINEの中の画面からは追加できません。先に{isIos ? 'Safari' : 'Chrome'}で開き直します。
          </p>
          <Button type="button" onClick={openOutside}>
            {isIos ? 'Safari' : 'Chrome'}で開く
          </Button>
          <p className="text-[11px] text-slate-500">
            開かないときは、画面の{isIos ? '右下' : '右上'}の「…」→「他のアプリで開く」を押してください。
          </p>
        </div>
      )}

      {mode === 'android-prompt' && (
        <div className="space-y-2">
          <Button type="button" onClick={add}>
            ホーム画面に追加する
          </Button>
          <p className="text-[11px] text-slate-500">押すと確認が1回出ます。「インストール」を押すと終わりです。</p>
        </div>
      )}

      {mode === 'android-steps' && (
        <ol className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-decimal list-inside">
          <li>画面の右上のメニュー（⋮）を押す</li>
          <li>「ホーム画面に追加」（機種により「アプリをインストール」）を押す</li>
          <li>「追加」（または「インストール」）を押す</li>
        </ol>
      )}

      {mode === 'ios-steps' && (
        <div className="space-y-2">
          <ol className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-decimal list-inside">
            <li>画面の下（または上）の共有ボタン（□に↑のマーク）を押す</li>
            <li>出てきた一覧を下へ送り、「ホーム画面に追加」を押す</li>
            <li>右上の「追加」を押す</li>
          </ol>
          <p className="text-[11px] text-slate-500">
            iPhoneでは、追加したアイコンから開くと、スマホへのお知らせも受け取れるようになります。
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={INSTALL_GUIDE_PATH} className="text-xs font-semibold text-blue-600 hover:underline">
          ▶ 動画つきの手順を見る
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-[11px] text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300"
        >
          閉じる（次からは表示しません）
        </button>
      </div>
    </section>
  )
}
