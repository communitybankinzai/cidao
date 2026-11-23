import type { NextConfig } from "next";

// 版の番号（ビルドのたびに変わる）。画面側（VersionRefresher）とサーバー側（/api/version）の両方に同じ値が埋め込まれ、
// 開いたままの画面が古い版かどうかを比べるのに使う（2026-11-23）。
// Vercel ではコミットの番号。取れないとき・手元では固定の 'dev'（番号がいつも同じ＝読み直しは起きない。
// 時刻を使うと、この設定が読まれるたびに値が変わり、画面側とサーバー側で食い違って読み直しが起きてしまう）
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  // ネイティブバイナリを含むパッケージはバンドルせず実行時に require させる
  // （sharp は SNS 告知カード画像の生成で使用）
  serverExternalPackages: ["sharp", "satori"],
  async redirects() {
    return [
      // 利用規約はCBIサイト側に置いている。お知らせ配信のリンク先が
      // サイト内パス限定（SWのclient.navigateが同一オリジン限定）のため、
      // /terms を内部パスとして受けて転送する
      {
        source: "/terms",
        destination: "https://communitybankinzai.github.io/cbi-site/terms/",
        permanent: false,
      },
      // 木製看板などに載せる短いQR用の転送先（2026-09-04）。
      // QRを英数モード（大文字のみ）で最小にするため /CBI（大文字）も受ける
      {
        source: "/:slug(cbi|CBI)",
        destination: "https://communitybankinzai.github.io/cbi-site/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
