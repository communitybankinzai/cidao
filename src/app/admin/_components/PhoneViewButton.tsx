'use client'

// 展示（スクリーンへの投影）用：CiDAO のホームを、スマホと同じ幅（390px）の別ウィンドウで開く。
// 別ウィンドウでもこのブラウザのログインはそのまま使える（Cookie が共有されるため）。
// 位置は左上。投影するモニターへは、開いたウィンドウをドラッグして移す。
const PHONE_WINDOW = 'popup=yes,width=390,height=844,left=0,top=0,resizable=yes,scrollbars=yes'

export function PhoneViewButton() {
  function openPhoneView() {
    const w = window.open('/', 'cidao-phone', PHONE_WINDOW)
    if (!w) {
      window.alert('ウィンドウを開けませんでした。ブラウザのアドレスバー右のマークから、このサイトのポップアップを許可してください。')
      return
    }
    w.focus()
  }

  return (
    <button
      type="button"
      onClick={openPhoneView}
      className="block w-full text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 hover:border-slate-400 dark:hover:border-slate-600 transition"
    >
      <h2 className="text-lg font-semibold mb-1">📱 展示用：スマホ表示で開く</h2>
      <p className="text-sm text-slate-500">
        CiDAO のホームを、スマホと同じ幅（390px）の別ウィンドウで開く。会場のスクリーンに映して操作説明するときに使う（ログインはこのブラウザのまま）
      </p>
    </button>
  )
}
