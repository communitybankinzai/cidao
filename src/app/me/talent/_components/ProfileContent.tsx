import { INTERVIEW_FIELDS } from '@/lib/talent-bank/interview/fields'
import type { ProfileFields, TalentTag } from '@/lib/talent-bank/types'
export default function ProfileContent({ fields, short, long, tags, provenance = false }: {
  fields: ProfileFields; short: string | null; long: string | null; tags: TalentTag[]; provenance?: boolean
}) {
  return <section className="space-y-5 rounded-xl border bg-background p-5">
    {short && <p className="text-lg font-medium whitespace-pre-wrap break-words">{short}</p>}
    {long && <p className="whitespace-pre-wrap break-words">{long}</p>}
    <ul className="flex flex-wrap gap-2" aria-label="タグ">{tags.map(t => <li key={t.id} className="rounded-full bg-muted px-3 py-1 text-xs">{t.label}</li>)}</ul>
    <dl className="space-y-4">{INTERVIEW_FIELDS.map(f => {
      const item = fields[f.field_key]
      if (!item || (!provenance && (item.state === 'unknown' || item.state === 'declined'))) return null
      return <div key={f.field_key}><dt className="font-medium">{f.label}</dt>
        <dd className="whitespace-pre-wrap break-words text-sm">{item.state === 'answered' ? item.value : item.state === 'none' ? '該当なし' : item.state === 'declined' ? '答えない' : '未回答'}</dd>
        {provenance && <dd className="text-xs text-muted-foreground">{item.source === 'owner' ? '自分で編集' : '回答から'}</dd>}
      </div>
    })}</dl>
  </section>
}
