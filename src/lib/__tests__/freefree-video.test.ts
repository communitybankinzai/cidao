import { describe, expect, it } from 'vitest'
import {
  checkVideoFile,
  MAX_VIDEO_BYTES,
  normalizeVideoUrl,
  videoStoragePath,
  youtubeEmbedUrl,
  youtubeIdOf,
} from '@/lib/freefree-video'

const BASE = 'https://abc.supabase.co'
const OK = `${BASE}/storage/v1/object/public/freefree-videos/pending/u1/1-abc.mp4`

describe('checkVideoFile', () => {
  it('MP4・WebM の20MB以下は通る', () => {
    expect(checkVideoFile({ size: 1000, type: 'video/mp4' })).toBeNull()
    expect(checkVideoFile({ size: MAX_VIDEO_BYTES, type: 'video/webm' })).toBeNull()
  })
  it('20MBを1バイトでも超えたら断る', () => {
    expect(checkVideoFile({ size: MAX_VIDEO_BYTES + 1, type: 'video/mp4' })).toContain('20MB')
  })
  it('動画以外・対象外の形式は断る', () => {
    expect(checkVideoFile({ size: 1000, type: 'image/png' })).toContain('MP4')
    expect(checkVideoFile({ size: 1000, type: 'video/quicktime' })).toContain('MP4')
    expect(checkVideoFile({ size: 1000, type: '' })).toContain('MP4')
  })
  it('空ファイルは断る', () => {
    expect(checkVideoFile({ size: 0, type: 'video/mp4' })).not.toBeNull()
  })
})

describe('normalizeVideoUrl', () => {
  it('自分の freefree-videos バケットの公開URLだけ通す', () => {
    expect(normalizeVideoUrl(OK, BASE)).toBe(OK)
    expect(normalizeVideoUrl(`  ${OK}  `, `${BASE}/`)).toBe(OK)
  })
  it('他サイト・画像バケット・http は通さない', () => {
    expect(normalizeVideoUrl('https://evil.example/storage/v1/object/public/freefree-videos/a.mp4', BASE)).toBeNull()
    expect(normalizeVideoUrl(`${BASE}/storage/v1/object/public/freefree-images/a.webp`, BASE)).toBeNull()
    expect(normalizeVideoUrl(OK.replace('https', 'http'), BASE)).toBeNull()
  })
  it('空・文字列以外・パス欠け・クエリ・上位参照は通さない', () => {
    expect(normalizeVideoUrl('', BASE)).toBeNull()
    expect(normalizeVideoUrl(null, BASE)).toBeNull()
    expect(normalizeVideoUrl(123, BASE)).toBeNull()
    expect(normalizeVideoUrl(`${BASE}/storage/v1/object/public/freefree-videos/`, BASE)).toBeNull()
    expect(normalizeVideoUrl(`${OK}?x=1`, BASE)).toBeNull()
    expect(normalizeVideoUrl(`${BASE}/storage/v1/object/public/freefree-videos/../a.mp4`, BASE)).toBeNull()
  })
  it('Supabase の URL が未設定なら何も通さない', () => {
    expect(normalizeVideoUrl(OK, undefined)).toBeNull()
    expect(normalizeVideoUrl(OK, '')).toBeNull()
  })
})

describe('YouTube のリンク', () => {
  const ID = 'dQw4w9WgXcQ'
  it('watch・youtu.be・shorts・スマホ版から動画IDを取り出す', () => {
    expect(youtubeIdOf(`https://www.youtube.com/watch?v=${ID}&t=10s`)).toBe(ID)
    expect(youtubeIdOf(`https://youtu.be/${ID}?si=x`)).toBe(ID)
    expect(youtubeIdOf(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
    expect(youtubeIdOf(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID)
  })
  it('YouTube 以外・http・IDが不正なものは null', () => {
    expect(youtubeIdOf(`https://vimeo.com/${ID}`)).toBeNull()
    expect(youtubeIdOf(`http://www.youtube.com/watch?v=${ID}`)).toBeNull()
    expect(youtubeIdOf('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(youtubeIdOf('https://www.youtube.com/')).toBeNull()
    expect(youtubeIdOf('https://notyoutube.com/watch?v=' + ID)).toBeNull()
    expect(youtubeIdOf('https://youtube.com.evil.example/watch?v=' + ID)).toBeNull()
    expect(youtubeIdOf('not a url')).toBeNull()
  })
  it('保存する値は正規の watch URL にそろい、埋め込みURLが作れる', () => {
    expect(normalizeVideoUrl(`https://youtu.be/${ID}?si=x`, BASE)).toBe(`https://www.youtube.com/watch?v=${ID}`)
    expect(youtubeEmbedUrl(`https://youtu.be/${ID}`)).toBe(`https://www.youtube-nocookie.com/embed/${ID}`)
    expect(youtubeEmbedUrl('https://example.com/a.mp4')).toBeNull()
  })
  it('YouTube は Supabase の URL が未設定でも通る・Storage のパスは取り出さない', () => {
    expect(normalizeVideoUrl(`https://youtu.be/${ID}`, undefined)).toBe(`https://www.youtube.com/watch?v=${ID}`)
    expect(videoStoragePath(`https://www.youtube.com/watch?v=${ID}`)).toBeNull()
  })
})

describe('videoStoragePath', () => {
  it('URLからパスを取り出す', () => {
    expect(videoStoragePath(OK)).toBe('pending/u1/1-abc.mp4')
  })
  it('バケットのURLでなければ null', () => {
    expect(videoStoragePath('https://example.com/a.mp4')).toBeNull()
  })
})
