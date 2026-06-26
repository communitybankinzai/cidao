import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { canUserEditEvent } from '@/lib/event-permissions'
import { updateEvent } from '../../actions'
import { ImageScanField } from '../../new/_components/ImageScanField'
import { OrganizerPicker, ORGANIZER_EXTERNAL, ORGANIZER_MEMBER } from '../../new/_components/OrganizerPicker'

// JST datetime-local 用の文字列（YYYY-MM-DDTHH:MM）に変換
function toLocalDatetime(iso: string): string {
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/events/${id}/edit`)

  const { data: event } = await supabase.from('events').select('*').eq('id', id).single()
  if (!event) notFound()

  // 編集権限の事前チェック（UPDATE RLS で結局弾かれるが、ボタン押下後に
  // 失敗してから気付くのは UX が悪いので server で先に判定し、無権限なら詳細へ）
  const canEdit = await canUserEditEvent(supabase, event, user.id, user.email ?? null)
  if (!canEdit) redirect(`/events/${id}?error=forbidden`)

  // 所属団体（officer 以上 / confirmed）
  const { data: memberRows } = await supabase
    .from('memberships')
    .select('org_id, organizations(id, name)')
    .eq('member_id', user.id)
    .in('role', ['representative', 'officer'])
    .eq('status', 'confirmed')

  const memberOrgs = (memberRows ?? [])
    .map((r) => {
      const o = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
      return o ? { id: o.id, name: o.name } : null
    })
    .filter((x): x is { id: string; name: string } => x !== null)

  const { data: allOrgRows } = await supabase
    .from('organizations')
    .select('id, name')
    .order('name', { ascending: true })
    .limit(500)
  const allOrgs = (allOrgRows ?? []) as { id: string; name: string }[]

  // 既存値から OrganizerPicker の初期選択を決定
  let initialChoice: string
  let initialNameText: string | undefined
  if (event.organizer_type === 'org') {
    initialChoice = event.organizer_id
  } else if (event.organizer_name_text) {
    // proxy 登録：名前一致する登録済み団体があればそれを選択、無ければ自由入力モード
    const matched = allOrgs.find((o) => o.name === event.organizer_name_text)
    if (matched) {
      initialChoice = matched.id
    } else {
      initialChoice = ORGANIZER_EXTERNAL
      initialNameText = event.organizer_name_text
    }
  } else {
    initialChoice = ORGANIZER_MEMBER
  }

  async function handleUpdate(formData: FormData) {
    'use server'
    const organizer_choice = String(formData.get('organizer_choice') ?? '__member__')
    const organizer_name_text = organizer_choice === '__external__'
      ? String(formData.get('organizer_name_text') ?? '').trim() || undefined
      : undefined
    // 編集ページでは hidden input が常に存在する。"" のときは null クリア扱い、
    // フィールド自体が無い場合のみ undefined（＝触らない）。
    const flyerRaw = formData.get('flyer_image_url')
    const flyer_image_url = flyerRaw === null ? undefined : String(flyerRaw)
    await updateEvent({
      id,
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? ''),
      category: String(formData.get('category') ?? 'other'),
      start_at: String(formData.get('start_at') ?? ''),
      end_at: String(formData.get('end_at') ?? ''),
      location: (formData.get('location') as string | null) || undefined,
      online_flag: formData.get('online_flag') === 'on',
      capacity: formData.get('capacity') ? Number(formData.get('capacity')) : undefined,
      fee: formData.get('fee') ? Number(formData.get('fee')) : undefined,
      organizer_choice,
      organizer_name_text,
      flyer_image_url,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleUpdate} className="max-w-2xl mx-auto space-y-4">
        <nav className="text-xs text-slate-500">
          <Link href={`/events/${id}`} className="hover:underline">← イベント詳細</Link>
        </nav>
        <h1 className="text-3xl font-serif font-bold">イベントを編集</h1>

        <ImageScanField initialFlyerUrl={event.flyer_image_url ?? null} />

        <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
          <L label="タイトル" req>
            <input name="title" required maxLength={80} defaultValue={event.title} className={inp} />
          </L>
          <L label="説明" req>
            <textarea name="description" required rows={4} defaultValue={event.description} className={inp} />
          </L>
          <L label="カテゴリ" req>
            <select name="category" required defaultValue={event.category} className={inp}>
              {PROPOSAL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </L>
          <OrganizerPicker
            memberOrgs={memberOrgs}
            allOrgs={allOrgs}
            initialChoice={initialChoice}
            initialNameText={initialNameText}
          />
          <div className="grid md:grid-cols-2 gap-3">
            <L label="開始" req>
              <input type="datetime-local" name="start_at" required defaultValue={toLocalDatetime(event.start_at)} className={inp} />
            </L>
            <L label="終了" req>
              <input type="datetime-local" name="end_at" required defaultValue={toLocalDatetime(event.end_at)} className={inp} />
            </L>
          </div>
          <L label="場所">
            <input name="location" placeholder="例: 印西市役所 会議室" defaultValue={event.location ?? ''} className={inp} />
          </L>
          <div className="grid md:grid-cols-3 gap-3">
            <L label="オンライン">
              <label className="flex gap-2 items-center text-sm">
                <input type="checkbox" name="online_flag" defaultChecked={event.online_flag} /> オンライン開催
              </label>
            </L>
            <L label="定員（任意）">
              <input type="number" name="capacity" min="1" defaultValue={event.capacity ?? ''} className={inp} />
            </L>
            <L label="参加費（円、任意）">
              <input type="number" name="fee" min="0" defaultValue={event.fee ?? ''} className={inp} />
            </L>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Link href={`/events/${id}`}><Button variant="outline" type="button">キャンセル</Button></Link>
          <Button type="submit">更新</Button>
        </div>
      </form>
    </div>
  )
}

const inp = 'w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm'

function L({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}{req && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}
