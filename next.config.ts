import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ネイティブバイナリを含むパッケージはバンドルせず実行時に require させる
  // （@resvg/resvg-js は SNS 告知カード画像の生成で使用。バンドルすると
  //  プラットフォーム別 .node の解決に失敗する）
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
};

export default nextConfig;
