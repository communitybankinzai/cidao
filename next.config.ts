import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    workerThreads: true,
  },
  // ネイティブバイナリを含むパッケージはバンドルせず実行時に require させる
  // （sharp は SNS 告知カード画像の生成で使用）
  serverExternalPackages: ["sharp"],
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
    ];
  },
};

export default nextConfig;
