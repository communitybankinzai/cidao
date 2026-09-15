import { CONSENT_TEXTS } from '@/lib/consents'
import { Button } from '@/components/ui/button'
import ActionForm from './ActionForm'
import { generateAction } from '../actions'
// again=true は、すでに案がある人向けの「作り直し（任意）」表示。普段は閉じておく。
export default function GenerateForm({ consented, again = false }: { consented: boolean; again?: boolean }) {
  const form = <ActionForm action={generateAction}>
    {!consented && <><p className="text-sm">{CONSENT_TEXTS.profile.text}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" value="yes" required className="mt-1" />プロフィール作成に同意します</label></>}
    <Button type="submit" variant={again ? 'outline' : 'default'}>{again ? '回答から案を作り直す' : 'プロフィール案を作る'}</Button>
  </ActionForm>
  if (again) return <details className="rounded-xl border bg-background p-5 text-sm">
    <summary className="cursor-pointer font-medium">（任意）AIに案を作り直してもらう</summary>
    <div className="mt-3 space-y-3">
      <p className="text-muted-foreground">通常は不要です。上の案を直すだけで公開を申請できます。作り直すと新しい版ができ、上で編集した内容は新しい版には引き継がれません。</p>
      {form}
    </div>
  </details>
  return <section className="space-y-3 rounded-xl border bg-background p-5">
    <h2 className="text-lg font-semibold">次のステップ：回答からプロフィール案を作る</h2>
    <p className="text-sm text-muted-foreground">AIがインタビューの回答だけをもとに紹介文の案を作ります（数十秒かかります）。できた案はあなたが確認・修正してから公開を申請し、運営の確認を経て公開されます。</p>
    {form}
  </section>
}
