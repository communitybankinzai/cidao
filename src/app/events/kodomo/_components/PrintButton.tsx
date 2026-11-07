'use client'

// 申請書の添付などに使えるよう、このページを印刷（またはPDF保存）する。カレンダーは印刷しない（ページ側で隠す）。
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 print:hidden"
    >
      印刷する・PDFで保存
    </button>
  )
}
