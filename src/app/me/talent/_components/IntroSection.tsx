import { Button } from '@/components/ui/button'
import type { CbiIntro } from '@/lib/talent-bank/types'
import ActionForm from './ActionForm'
import { introAction } from '../actions'

// 「あなたのプロフィール」の他己紹介の欄（2026-09-15）。運営が確認を依頼した後だけ表示される
export default function IntroSection({ intro }: { intro: CbiIntro | null }) {
  if (!intro) return null
  return <section aria-label="他己紹介" className="space-y-3 rounded-xl border p-4 text-sm">
    <h2 className="text-lg font-semibold">CBI からの他己紹介</h2>
    <p className="text-muted-foreground">CBI の運営が、あなたの公開プロフィールを読んで書いた紹介文です。あなたが承認したものだけを、紹介ページ（CiDAO にログインした会員だけが見られます）に載せます。</p>
    <p className="whitespace-pre-wrap rounded border bg-muted/40 p-3">{intro.body}</p>
    {intro.status === 'owner_review' && <>
      <ActionForm key={`ok:${intro.updated_at}`} action={introAction} successText="承認しました。紹介ページに載ります。">
        <input type="hidden" name="intent" value="approve" />
        <Button type="submit" className="w-full">このまま載せてよい</Button>
      </ActionForm>
      <ActionForm key={`ng:${intro.updated_at}`} action={introAction} successText="運営に戻しました。">
        <input type="hidden" name="intent" value="return" />
        <label className="block">直してほしい点<textarea name="comment" required maxLength={1000} rows={3} className="mt-1 w-full rounded border bg-background p-2" /></label>
        <Button type="submit" variant="outline">直してほしい点を書いて戻す</Button>
      </ActionForm>
    </>}
    {intro.status === 'published' && <ActionForm key={`retire:${intro.updated_at}`} action={introAction} successText="取り下げました。">
      <input type="hidden" name="intent" value="retire" />
      <p className="text-muted-foreground">掲載中です。</p>
      <Button type="submit" variant="outline" size="sm">掲載を取り下げる</Button>
    </ActionForm>}
    {intro.status === 'returned' && <p className="text-muted-foreground">運営に戻しています。直したものが届くとまたここに出ます。</p>}
  </section>
}
