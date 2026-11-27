import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { NotificationBell } from '@/components/NotificationBell'
import { TopBarSpacer } from '@/components/TopBarSpacer'
import { BottomNav } from '@/components/BottomNav'
import { AdminLink } from '@/components/AdminLink'
import { ContactLink } from '@/components/ContactLink'
import { ButtonFeedback } from '@/components/ButtonFeedback'
import { PageViewTracker } from '@/components/PageViewTracker'
import { VersionRefresher } from '@/components/VersionRefresher'
import { InstallPromptCapture } from '@/components/InstallPromptCapture'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cidao.vercel.app'),
  title: 'CiDAO - 市民DAO',
  description: '印西市民による提案・投票・貢献度プラットフォーム',
  applicationName: 'CiDAO',
  // 検索結果のサイト名に「Vercel」と出るのを防ぐ（2026-11-28）。サイト名の手がかりは、下の構造化データとこの og:site_name
  openGraph: { siteName: 'CiDAO', locale: 'ja_JP', type: 'website' },
  appleWebApp: {
    capable: true,
    title: 'CiDAO',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
}

// 検索エンジンに伝えるサイト名（Google の「サイト名」の決まり：WebSite の構造化データをホームに置く）。
// これが無いと、アドレスの後ろ半分（vercel.app）から「Vercel」と表示される（2026-11-28 会員の指摘）
const SITE_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'CiDAO',
  alternateName: ['CiDAO（シダオ）', 'CiDAO 市民DAO', 'シダオ'],
  url: 'https://cidao.vercel.app/',
  publisher: { '@type': 'Organization', name: 'Community Bank Inzai（CBI）' },
})

export const viewport: Viewport = {
  themeColor: '#1e3a5f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ja"
      translate="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* ブラウザの自動翻訳がReactのDOMを書き換えてクラッシュするため翻訳対象外にする */}
      <head>
        <meta name="google" content="notranslate" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: SITE_JSON_LD }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ButtonFeedback />
        <PageViewTracker />
        <VersionRefresher />
        <InstallPromptCapture />
        <TopBarSpacer />
        <ContactLink />
        <AdminLink />
        <NotificationBell />
        {children}
        <BottomNav />
      </body>
    </html>
  )
}
