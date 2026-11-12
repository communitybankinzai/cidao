// CBI サイト（GitHub Pages）にある、CiDAO の外の機能の URL（2026-11-13）。
// 画面側の部品（下のメニュー BottomNav など）からも読めるよう、サーバー専用の処理を読み込まないこの1か所に置く。
// disaster-notify.ts・sns-template.ts はここから読み込んで、同じ名前で出し直している。

/** 防災マップ（CBI の試作） */
export const DISASTER_MAP_URL = 'https://communitybankinzai.github.io/cbi-site/inzai-disaster-map/'

/** 印西 食レポマップ（CiDAO の中では「ぐるめ」）。CiDAO ではないので utm は付けない */
export const GOURMET_MAP_URL = 'https://communitybankinzai.github.io/cbi-site/gourmet-map/'
