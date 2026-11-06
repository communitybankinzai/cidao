// robots.txt（2026-11-06）。
// CiDAO は全ページをサーバーで描画しているため、クローラーの巡回がそのまま関数の呼び出し（Vercel の Active CPU）になる。
// 検索（Google・Bing）と SNS のリンク見出し（facebook・X・LINE・Slack 等）だけ許し、
// AI の学習用クローラーと SEO 業者の巡回ツール、その他の名乗らない巡回は断る。
// API・管理画面・本人の画面はどのクローラーにも読ませない。

import type { MetadataRoute } from 'next'

const PRIVATE_PATHS = ['/api/', '/admin/', '/me', '/me/', '/auth/', '/login', '/notifications', '/bug-report', '/disaster/']

const SEARCH_AND_PREVIEW = [
  'Googlebot',
  'Googlebot-Image',
  'Bingbot',
  'DuckDuckBot',
  'Applebot',
  'facebookexternalhit',
  'Twitterbot',
  'LinkedInBot',
  'Slackbot',
  'Discordbot',
  'Line',
  'Threads',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: SEARCH_AND_PREVIEW, allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: '*', disallow: '/' },
    ],
  }
}
