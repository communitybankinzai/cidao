import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'CiDAO - 市民DAO',
  description: '印西市民による提案・投票・貢献度プラットフォーム',
  applicationName: 'CiDAO',
  appleWebApp: {
    capable: true,
    title: 'CiDAO',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
}

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
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
