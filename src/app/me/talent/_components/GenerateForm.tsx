import { CONSENT_TEXTS } from '@/lib/consents'
import { Button } from '@/components/ui/button'
import ActionForm from './ActionForm'
import { generateAction } from '../actions'
export default function GenerateForm({ consented }: { consented: boolean }) {
  return <section className="space-y-3 rounded-xl border bg-background p-5">
    <h2 className="text-lg font-semibold">次のステップ：回答からプロフィール案を作る</h2>
    <p className="text-sm text-muted-foreground">AIがインタビューの回答だけをもとに紹介文の案を作ります（数十秒かかります）。できた案はあなたが確認・修正してから公開を申請し、運営の確認を経て公開されます。生成するたびに新しい版ができます。</p>
    <ActionForm action={generateAction}>
      {!consented && <><p className="text-sm">{CONSENT_TEXTS.profile.text}</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" value="yes" required className="mt-1" />プロフィール作成に同意します</label></>}
      <Button type="submit">プロフィール案を作る</Button>
    </ActionForm>
  </section>
}
