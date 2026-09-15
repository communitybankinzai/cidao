import { Button } from '@/components/ui/button'
import type { TalentVideo } from '@/lib/talent-bank/types'
import ActionForm from './ActionForm'
import PhotoUploader from './PhotoUploader'
import { videoAction } from '../actions'

const STATUS: Record<TalentVideo['status'], string> = {
  queued: '順番待ち（10〜20分ほどで自動で作ります）', rendering: '作っています…', owner_review: 'できました。確認してください',
  owner_approved: 'あなたが承認済み・運営の掲載待ち', published: '紹介ページに掲載中', failed: 'うまく作れませんでした', retired: '取り下げ',
}
const STYLE: Record<TalentVideo['style'], string> = { oshare: 'ゆったり', cool: 'テンポよく', hands: '顔を出さない（手元と作品）' }

// 「あなたのプロフィール」の紹介動画の欄（2026-09-15）。写真・顔の見せ方を登録すると、公開中のプロフィールから自動で動画ができる。
export default function VideoSection({ photos, faceMode, videos, published }: {
  photos: { id: string; url: string | null }[]; faceMode: 'photo' | 'no_face'; videos: TalentVideo[]; published: boolean
}) {
  const latest = videos.find(v => v.status !== 'retired' && v.status !== 'failed') ?? videos[0]
  const shown = videos.filter(v => ['owner_review', 'owner_approved', 'published'].includes(v.status))
  return <section aria-label="紹介動画" className="space-y-5 rounded-xl border p-4 text-sm">
    <div>
      <h2 className="text-lg font-semibold">紹介動画</h2>
      <p className="text-muted-foreground">登録した写真と公開中のプロフィールから、約1分の縦型動画を自動で作ります。ナレーションの声・曲・映像の型は紹介文に合わせて自動で選びます。できた動画はあなたが確認し、承認したものだけを運営が掲載します。動画はスマホに保存して、ご自身の SNS にも使えます。</p>
    </div>
    <div className="space-y-2">
      <h3 className="font-medium">1. 写真（顔写真・活動や作品の写真）</h3>
      <PhotoUploader photos={photos} />
    </div>
    <ActionForm action={videoAction} successText="顔の見せ方を保存しました。写真とプロフィールが揃っていれば、動画を作り直します。">
      <input type="hidden" name="intent" value="face_mode" />
      <h3 className="font-medium">2. 顔の見せ方</h3>
      <label className="flex items-center gap-2"><input type="radio" name="face_mode" value="photo" defaultChecked={faceMode === 'photo'} />写真をそのまま使う</label>
      <label className="flex items-center gap-2"><input type="radio" name="face_mode" value="no_face" defaultChecked={faceMode === 'no_face'} />顔を出さない（作品・手元の写真と大きな文字で見せる型になります）</label>
      <Button type="submit" variant="outline" size="sm">保存</Button>
    </ActionForm>
    <div className="space-y-3">
      <h3 className="font-medium">3. できた動画</h3>
      {!published && <p className="text-muted-foreground">プロフィールが公開されると、自動で動画を作り始めます。</p>}
      {published && !latest && <p className="text-muted-foreground">まだ動画はありません。写真を登録すると自動で作ります。</p>}
      {latest && !shown.some(v => v.id === latest.id) && <p role="status">{STATUS[latest.status]}{latest.status === 'failed' && latest.error ? `（${latest.error}）` : ''}</p>}
      {shown.map(v => <div key={v.id} className="space-y-3 rounded-lg border p-3">
        <p><span className="rounded-full border px-2 py-0.5 text-xs">{STATUS[v.status]}</span> <span className="text-muted-foreground">{STYLE[v.style]}／声：{v.voice_name}／{v.bgm_credit.replace(/^BGM\s*/, '')}{v.duration_sec ? `／${Math.round(Number(v.duration_sec))}秒` : ''}</span></p>
        <video controls playsInline preload="metadata" poster={`/api/talent-bank/video/${v.id}?thumb=1`} src={`/api/talent-bank/video/${v.id}`} className="w-full max-w-xs rounded-lg bg-black" />
        <p><a href={`/api/talent-bank/video/${v.id}?download=1`} className="underline">スマホに保存する（mp4）</a></p>
        {v.status === 'owner_review' && <>
          <ActionForm action={videoAction} successText="承認しました。運営が確認して掲載します。">
            <input type="hidden" name="intent" value="approve" /><input type="hidden" name="videoId" value={v.id} />
            <Button type="submit" className="w-full">この動画を公開してよい</Button>
          </ActionForm>
          <ActionForm action={videoAction} successText="作り直します（10〜20分ほど）。">
            <input type="hidden" name="intent" value="redo" /><input type="hidden" name="videoId" value={v.id} />
            <label className="block">直してほしい点（任意）<textarea name="comment" maxLength={1000} rows={2} className="mt-1 w-full rounded border bg-background p-2" /></label>
            <Button type="submit" variant="outline">作り直す（声・曲・型は選び直されます）</Button>
          </ActionForm>
        </>}
        {(v.status === 'published' || v.status === 'owner_approved') && <ActionForm action={videoAction} successText="取り下げました。">
          <input type="hidden" name="intent" value="retire" /><input type="hidden" name="videoId" value={v.id} />
          <Button type="submit" variant="outline" size="sm">掲載を取り下げる</Button>
        </ActionForm>}
      </div>)}
      {published && photos.length > 0 && <ActionForm action={videoAction} successText="作り始めました（10〜20分ほど）。">
        <input type="hidden" name="intent" value="request" />
        <Button type="submit" variant="outline">いまの写真とプロフィールで作り直す（1日3回まで）</Button>
      </ActionForm>}
    </div>
  </section>
}
