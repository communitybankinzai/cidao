// 「通知の受け取り方」の動画（約40秒）。ヘルプとホーム画面に追加の案内ページに置く。
// 動画は public/videos/push-howto.mp4（縦 1080x1920・声は圭太・BGM つき）。
// 開くまで読み込まない（preload="none"）。表紙は poster の画像。
// 動画の作り方は CBI の scripts/promo/push_howto/README.md。

export function PushHowtoVideo({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <video
        controls
        playsInline
        preload="none"
        poster="/videos/push-howto-poster.jpg"
        className="w-full max-w-[300px] mx-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-900"
        aria-label="通知の受け取り方（約40秒の動画）"
      >
        <source src="/videos/push-howto.mp4" type="video/mp4" />
        お使いのブラウザでは動画を再生できません。下の手順をご覧ください。
      </video>
      <figcaption className="text-[11px] text-slate-500 text-center mt-1.5">
        ▶ 通知の受け取り方（約40秒・音が出ます／画面はイメージです）
      </figcaption>
    </figure>
  )
}
