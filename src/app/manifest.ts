import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CiDAO - 市民DAO',
    short_name: 'CiDAO',
    description: '印西市民による提案・投票・貢献度プラットフォーム',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf8f3',
    theme_color: '#1e3a5f',
    lang: 'ja',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  }
}
