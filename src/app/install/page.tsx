'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

type Device = 'ios' | 'android' | 'other'

/**
 * ホーム画面への追加（PWAインストール）手順の案内ページ。
 * DBアクセス不要のためクライアントコンポーネント1枚で完結。
 * 端末をUAで判定し、自分の端末の手順を先頭に開いて表示する。
 */
export default function InstallPage() {
  const [device, setDevice] = useState<Device>('other')
  const [inLineBrowser, setInLineBrowser] = useState(false)
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent || ''
    if (/iphone|ipad|ipod/i.test(ua)) setDevice('ios')
    else if (/android/i.test(ua)) setDevice('android')
    // LINEアプリ内ブラウザでは「ホーム画面に追加」が使えないため警告する
    if (/\bLine\//i.test(ua)) setInLineBrowser(true)
    // すでにホーム画面から起動している場合
    if (window.matchMedia('(display-mode: standalone)').matches) setStandalone(true)
  }, [])

  function openInExternalBrowser() {
    const url = window.location.href
    const ua = navigator.userAgent || ''
    if (/iphone|ipad|ipod/i.test(ua)) {
      window.location.href = url.replace(/^https?:\/\//i, 'x-safari-https://')
    } else if (/android/i.test(ua)) {
      const stripped = url.replace(/^https?:\/\//i, '')
      window.location.href = `intent://${stripped}#Intent;scheme=https;package=com.android.chrome;end`
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/" className="hover:underline">← ホーム</Link>
        </nav>

        <header className="space-y-2">
          <p className="text-xs tracking-[0.3em] text-slate-500 uppercase">Install</p>
          <h1 className="text-2xl font-serif font-bold text-slate-900 dark:text-slate-100">
            📲 CiDAOをアプリとして使う
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            アプリストアからのダウンロードは不要です。スマホの「ホーム画面に追加」をするだけで、
            アイコンから1タップで開けるアプリになります（無料）。
          </p>
        </header>

        {standalone && (
          <div className="bg-emerald-50 dark:bg-emerald-950 border-l-4 border-emerald-500 p-4 rounded">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              ✓ すでにアプリとして起動しています
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
              このまま追加の設定は不要です。通知を受け取りたい場合は
              <Link href="/me" className="underline ml-1">マイページ</Link>
              の「プッシュ通知」を有効にしてください。
            </p>
          </div>
        )}

        {inLineBrowser && (
          <div className="bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-500 p-4 rounded space-y-2">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              ⚠️ LINEのアプリ内でこのページを開いています
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200">
              LINE内のブラウザからは「ホーム画面に追加」ができません。
              下のボタンでSafari（またはChrome）で開き直してから、以下の手順に進んでください。
            </p>
            <Button variant="outline" size="sm" onClick={openInExternalBrowser}
              className="border-amber-400 text-amber-900 dark:text-amber-100">
              外部ブラウザで開く
            </Button>
          </div>
        )}

        {/* できるようになること */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">追加するとできること</h2>
          <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1 list-disc list-inside">
            <li>ホーム画面のアイコンから1タップで起動</li>
            <li>アドレスバーのない、アプリと同じ画面表示</li>
            <li>声がけ・コメントなどのプッシュ通知を待機画面に受け取れる（iPhoneはホーム画面追加が通知の前提条件）</li>
          </ul>
        </section>

        {/* iPhone */}
        <details open={device !== 'android'}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <summary className="cursor-pointer p-5 text-sm font-semibold text-slate-900 dark:text-slate-100">
             iPhone・iPad（Safari）の手順
          </summary>
          <ol className="px-5 pb-5 space-y-3">
            <Step n={1}>
              Safariでこのページ（cidao.vercel.app）を開く
              <span className="block text-xs text-slate-500 mt-0.5">※ LINEから開いた場合は、右下の「…」→「他のアプリで開く」→ Safari</span>
            </Step>
            <Step n={2}>
              画面下（または上）の <Kbd>共有ボタン（□に↑のマーク）</Kbd> をタップ
            </Step>
            <Step n={3}>
              メニューを下にスクロールして <Kbd>ホーム画面に追加</Kbd> をタップ
            </Step>
            <Step n={4}>
              右上の <Kbd>追加</Kbd> をタップ → ホーム画面にCiDAOのアイコンが現れます
            </Step>
          </ol>
        </details>

        {/* Android */}
        <details open={device === 'android'}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <summary className="cursor-pointer p-5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            🤖 Android（Chrome）の手順
          </summary>
          <ol className="px-5 pb-5 space-y-3">
            <Step n={1}>
              Chromeでこのページ（cidao.vercel.app）を開く
              <span className="block text-xs text-slate-500 mt-0.5">※ LINEから開いた場合は、右上の「…」→「他のアプリで開く」→ Chrome</span>
            </Step>
            <Step n={2}>
              右上の <Kbd>メニュー（⋮）</Kbd> をタップ
            </Step>
            <Step n={3}>
              <Kbd>ホーム画面に追加</Kbd>（機種により「アプリをインストール」）をタップ
            </Step>
            <Step n={4}>
              <Kbd>追加</Kbd>（または「インストール」）をタップ → ホーム画面にアイコンが現れます
            </Step>
          </ol>
        </details>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">追加したら</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            ホーム画面のCiDAOアイコンから開き、
            <Link href="/me" className="underline">マイページ</Link>
            の「📲 プッシュ通知」で <strong>通知を受け取る</strong> を押すと、
            声がけやコメントの通知が待機画面に届くようになります。
          </p>
        </section>

        <p className="text-xs text-slate-400 text-center">
          うまくいかない場合は <Link href="/bug-report?source=cidao_app" className="underline">不具合報告</Link> からお知らせください
        </p>
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm text-slate-700 dark:text-slate-300">
      <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <div className="min-w-0 pt-0.5">{children}</div>
    </li>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
      {children}
    </span>
  )
}
