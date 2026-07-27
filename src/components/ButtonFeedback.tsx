'use client'

import { useEffect } from 'react'

/**
 * 押した反応が分かりにくいという指摘への対応。
 * ページ全体のクリックを1箇所で受け、ボタン・リンクに
 *   1. 押した位置から広がる波紋
 *   2. 処理中のスピナー（送信・ページ移動が終わるまで）
 * を付ける。各ページのコードは変更不要。
 */
export function ButtonFeedback() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const targetOf = (e: Event): HTMLElement | null => {
      const el = e.target as HTMLElement | null
      if (!el?.closest) return null
      return el.closest<HTMLElement>(
        'button, a[href], [data-slot="button"], [role="button"]'
      )
    }

    const onPointerDown = (e: PointerEvent) => {
      if (reduce) return
      const btn = targetOf(e)
      if (!btn || btn.hasAttribute('disabled')) return
      const rect = btn.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return

      // 波紋は要素内に収める必要があるため、position/overflow を補う
      const cs = getComputedStyle(btn)
      if (cs.position === 'static') btn.style.position = 'relative'
      if (cs.overflow === 'visible') btn.style.overflow = 'hidden'

      const size = Math.max(rect.width, rect.height) * 2.2
      const ripple = document.createElement('span')
      ripple.className = 'cidao-ripple'
      ripple.style.width = ripple.style.height = `${size}px`
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`
      btn.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove())
    }

    // 「処理中」を出したまま画面が残り続けないよう、必ず一定時間で戻す
    const busy = (el: HTMLElement, ms: number) => {
      if (el.dataset.busy === 'true') return
      el.dataset.busy = 'true'
      window.setTimeout(() => {
        delete el.dataset.busy
      }, ms)
    }

    const onClick = (e: MouseEvent) => {
      const btn = targetOf(e)
      if (!btn || btn.hasAttribute('disabled')) return
      const href = btn.getAttribute('href') ?? ''
      // ページ内リンク・新しいタブで開くリンクは待ち時間がないので出さない
      if (href.startsWith('#') || btn.getAttribute('target') === '_blank') return
      if (href || btn.tagName === 'BUTTON') busy(btn, 6000)
    }

    // フォーム送信（Server Action）では送信ボタンを処理中にする
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement
      const submitter =
        (e as SubmitEvent).submitter ??
        form.querySelector<HTMLElement>('button[type="submit"], button:not([type])')
      if (submitter) busy(submitter, 15000)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('submit', onSubmit, true)
    }
  }, [])

  return null
}
