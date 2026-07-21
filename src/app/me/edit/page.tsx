import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PROPOSAL_CATEGORIES } from '@/lib/categories'
import { updateProfile } from '../actions'
import { claimMemberships, leaveOrg, type OrgClaim } from '../../orgs/actions'
import OrgClaimPicker, { type OrgOption } from './_components/OrgClaimPicker'
import AvatarUpload from './_components/AvatarUpload'

export default async function EditProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>
}) {
  const { welcome } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/me/edit')

  const { data: member } = await supabase
    .from('members')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!member) redirect('/me')

  // 実名（非公開・受付用）。RLS で本人のみ読める
  const { data: privateInfo } = await supabase
    .from('member_private')
    .select('real_name')
    .eq('member_id', user.id)
    .maybeSingle()

  const wasLight = member.tier === 'light'

  // 所属団体 picker 用データ
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, type')
    .eq('public_flag', true)
    .order('name')

  const { data: myMemberships } = await supabase
    .from('memberships')
    .select('org_id, role, status, organizations(name)')
    .eq('member_id', user.id)
    .is('left_at', null)

  const alreadyJoinedIds = (myMemberships ?? []).map((m) => m.org_id)

  async function handleSubmit(formData: FormData) {
    'use server'

    // 1. プロフィール更新
    const interests = formData.getAll('interests').map(String)
    await updateProfile({
      display_name: String(formData.get('display_name') ?? ''),
      real_name: (formData.get('real_name') as string | null) ?? null,
      residency_type: String(formData.get('residency_type') ?? 'citizen') as 'citizen' | 'related_population',
      relation_type: (formData.get('relation_type') as string | null) || null,
      interests,
      self_introduction: (formData.get('self_introduction') as string | null) || null,
      skills_text: (formData.get('skills_text') as string | null) || null,
      contact_permission: formData.get('contact_permission') === 'on',
      collaboration_consent: formData.get('collaboration_consent') === 'on',
      ranking_opt_in: formData.get('ranking_opt_in') === 'on',
      proposal_email: formData.get('proposal_email') === 'on',
      upgradeToEmailOnly: formData.get('upgrade') === 'on',
    })

    // 2. 所属団体申告（あれば）
    const raw = String(formData.get('org_claims') ?? '[]')
    let parsed: OrgClaim[] = []
    try {
      const arr = JSON.parse(raw) as unknown
      if (Array.isArray(arr)) {
        parsed = arr
          .filter((x): x is { org_id: unknown; as_representative: unknown } => typeof x === 'object' && x !== null)
          .map((x) => ({
            org_id: String((x as { org_id: unknown }).org_id),
            as_representative: Boolean((x as { as_representative: unknown }).as_representative),
          }))
      }
    } catch {
      parsed = []
    }

    let claimsResult: { inserted: number; skipped?: number } | null = null
    if (parsed.length > 0) {
      claimsResult = await claimMemberships(parsed)
    }

    // 3. リダイレクト（クエリで結果を区別）
    const params = new URLSearchParams({ updated: '1' })
    if (claimsResult && claimsResult.inserted > 0) {
      params.set('claims', String(claimsResult.inserted))
    }
    redirect(`/me?${params.toString()}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-12">
      <form action={handleSubmit} className="max-w-3xl mx-auto space-y-6">
        <nav className="text-xs text-slate-500">
          <Link href="/me" className="hover:underline">← マイページ</Link>
        </nav>
        <header>
          <h1 className="text-3xl font-serif font-bold text-slate-900 dark:text-slate-100">
            {wasLight ? '本登録（プロフィール完成）' : 'プロフィール編集'}
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            {wasLight
              ? '完成後、投票重みが市民 0.1 → 0.3 に上がり、提案・拘束的投票・コメントが可能になります'
              : '内容を更新できます'}
          </p>
        </header>

        {welcome === '1' && (
          <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-4 space-y-1.5">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              ようこそ！まず「表示名」をご確認ください
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
              現在、LINEに登録されているお名前がそのまま表示名になっています。
              表示名はCiDAO内で<strong>他の参加者に公開されます</strong>ので、
              実名を出したくない場合は、公開してもよいニックネームに変更して保存してください（あとからいつでも変更できます）。
            </p>
          </div>
        )}

        <div className="space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <Field label="プロフィール画像（任意）">
            <AvatarUpload
              userId={user.id}
              initialUrl={member.avatar_url ?? null}
              initialPosition={member.avatar_position ?? null}
              initialZoom={member.avatar_zoom ?? null}
              displayName={member.display_name}
            />
          </Field>

          <Field label="表示名" required>
            <input
              name="display_name"
              required
              maxLength={40}
              defaultValue={member.display_name}
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-500 mt-1">サイト上で公開される名前です。ニックネーム可。</p>
          </Field>

          <Field label="実名（非公開・受付用）">
            <input
              name="real_name"
              maxLength={50}
              defaultValue={privateInfo?.real_name ?? ''}
              placeholder="例: 印西 太郎"
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-500 mt-1">
              サイト上には公開されません。イベント等の受付で、団体の受付担当者が本人確認に使います（実名でも検索できるようになります）。
            </p>
          </Field>

          <Field label="居住区分" required>
            <div className="space-y-2">
              <Radio name="residency_type" value="citizen"            current={member.residency_type} label="印西市民" />
              <Radio name="residency_type" value="related_population" current={member.residency_type} label="関係人口（在勤・在学・出身等）" />
            </div>
          </Field>

          <Field label="関係人口の場合の詳細（任意）">
            <input
              name="relation_type"
              defaultValue={member.relation_type ?? ''}
              placeholder="例: 印西市内の企業に勤務 / 印西市出身で隣接市在住"
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="興味分野（複数選択可、最低1つ）" required>
            <div className="grid grid-cols-2 gap-1">
              {PROPOSAL_CATEGORIES.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="interests"
                    value={c.key}
                    defaultChecked={(member.interests ?? []).includes(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </Field>

          <Field label="自己紹介（400字以内）">
            <textarea
              name="self_introduction"
              rows={4}
              maxLength={400}
              defaultValue={member.self_introduction ?? ''}
              placeholder="例: 印西市木下在住。環境問題に関心があり、子どもと一緒に里山保全に関わりたいと考えています。動画編集スキルがあり、団体の活動記録づくりにも貢献できます。"
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-500 mt-1.5">
              💡 詳しく書くほど、AI があなたの関心に合う団体を見つけやすくなります。活動歴・関心の背景・期待する活動形態（定例会型／プロジェクト型など）・活かせるスキルを書くと効果的です。
            </p>
          </Field>

          <Field label="スキル・できそうなこと">
            <textarea
              name="skills_text"
              rows={2}
              defaultValue={member.skills_text ?? ''}
              placeholder="例: 動画編集 / イベント運営 / 翻訳"
              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="同意・設定">
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" name="contact_permission" defaultChecked={member.contact_permission} className="mt-1" />
                <span>
                  CBI からの連絡を許可
                  <span className="block text-xs text-slate-500">運営からの重要連絡・依頼を受け取ります</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="collaboration_consent" defaultChecked={member.collaboration_consent ?? false} className="mt-1" />
                <span>
                  街活性室等への情報連携に同意
                  <span className="block text-xs text-slate-500">CBI が連携する地域組織への情報共有を許可</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="ranking_opt_in" defaultChecked={member.ranking_opt_in ?? false} className="mt-1" />
                <span>
                  ランキングに参加する
                  <span className="block text-xs text-slate-500">表示名と貢献度ポイントが /ranking に公開されます。活動の励みにどうぞ</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="proposal_email"
                  defaultChecked={((member.contact_preferences ?? {}) as Record<string, unknown>).proposal_email !== false}
                  className="mt-1"
                />
                <span>
                  提案・投票のメール通知を受け取る
                  <span className="block text-xs text-slate-500">投票開始・締切前・結果確定のお知らせが届きます</span>
                </span>
              </label>
              {wasLight && (
                <label className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded">
                  <input type="checkbox" name="upgrade" defaultChecked className="mt-1" />
                  <span>
                    <strong className="text-emerald-900 dark:text-emerald-100">本登録に昇格</strong>
                    <span className="block text-xs text-emerald-700 dark:text-emerald-300">
                      興味分野と上記設定で本登録完了。投票重みが上がり、提案・拘束的投票・コメントが可能になります
                    </span>
                  </span>
                </label>
              )}
            </div>
          </Field>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">所属団体（任意）</h2>
            <p className="text-xs text-slate-500 mt-1">
              既に印西市内の団体に所属している場合はここから申告できます。代表者として申告した場合、管理者の承認後に <code className="text-[10px]">organizations.representative_id</code> が更新されます。
            </p>
          </div>

          {alreadyJoinedIds.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-3 space-y-1.5">
              <p className="text-xs text-slate-500">既に申告 / 所属済の団体</p>
              <ul className="space-y-1 text-sm">
                {(myMemberships ?? []).map((m) => (
                  <li key={m.org_id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {(m.organizations as unknown as { name?: string } | null)?.name ?? '(団体名取得不可)'}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300">
                        {m.role === 'representative' ? '代表者' : m.role === 'officer' ? '役員' : '会員'}
                        {' / '}
                        {m.status === 'confirmed' ? '承認済' : '申請中'}
                      </span>
                      <button
                        type="submit"
                        formNoValidate
                        formAction={async () => {
                          'use server'
                          await leaveOrg(m.org_id)
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        脱退
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <OrgClaimPicker
            orgs={(orgs ?? []) as OrgOption[]}
            alreadyJoinedIds={alreadyJoinedIds}
            initial={[]}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Link href="/me">
            <Button type="button" variant="outline">キャンセル</Button>
          </Link>
          <Button type="submit">{wasLight ? '本登録する' : '保存'}</Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

function Radio({ name, value, current, label }: { name: string; value: string; current: string; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name={name} value={value} defaultChecked={current === value} />
      {label}
    </label>
  )
}
