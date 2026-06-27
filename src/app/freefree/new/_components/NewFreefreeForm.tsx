'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import FreefreeImagesUpload from './FreefreeImagesUpload'

type PosterKindOpt = { key: string; label: string; needsOrg: boolean }
type EditableOrg = { id: string; name: string; type: 'civic_group' | 'business' | 'government' }
type Opt = { key: string; label: string }

export default function NewFreefreeForm({
  action,
  userId,
  editableOrgs,
  posterKinds,
  categories,
  periods,
}: {
  action: (formData: FormData) => Promise<void>
  userId: string
  editableOrgs: EditableOrg[]
  posterKinds: PosterKindOpt[]
  categories: Opt[]
  periods: Opt[]
}) {
  const [posterKind, setPosterKind] = useState<string>('member')
  const [couponEnabled, setCouponEnabled] = useState(false)
  const currentKindMeta = posterKinds.find((k) => k.key === posterKind)
  const needsOrg = !!currentKindMeta?.needsOrg

  const orgsForCurrentKind = useMemo(
    () => (needsOrg ? editableOrgs.filter((o) => o.type === posterKind) : []),
    [needsOrg, posterKind, editableOrgs],
  )
  const hasUsableOrg = !needsOrg || orgsForCurrentKind.length > 0

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-3 bg-white dark:bg-slate-900 border rounded-lg p-6">
        <L label="掲載者" req>
          <select
            name="poster_kind"
            required
            value={posterKind}
            onChange={(e) => setPosterKind(e.target.value)}
            className={inp}
          >
            {posterKinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          {needsOrg && (
            orgsForCurrentKind.length > 0 ? (
              <>
                <select name="org_id" required className={`${inp} mt-2`}>
                  {orgsForCurrentKind.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">あなた個人のアカウントから「団体として」投稿します（団体メアドへの切替は不要）</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded p-2">
                該当する組織の代表者・編集権者として登録されていません。<br />
                先に <Link href="/orgs" className="underline">団体ページ</Link> で代表者登録を済ませてください。
              </p>
            )
          )}
        </L>
        <L label="タイトル（40字）" req><input name="title" required maxLength={40} className={inp} /></L>
        <L label="本文（1000字、Markdown 可）" req>
          <textarea name="body" required maxLength={1000} rows={6} className={inp} />
        </L>
        <div className="grid md:grid-cols-2 gap-3">
          <L label="カテゴリ" req>
            <select name="category" required className={inp}>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </L>
          <L label="掲載期間" req>
            <select name="period" required className={inp} defaultValue="p_1month">
              {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </L>
        </div>
        <L label="場所"><input name="location" placeholder="例: 印西市草深" className={inp} /></L>
        <FreefreeImagesUpload userId={userId} />
      </div>

      <div className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={couponEnabled}
            onChange={(e) => setCouponEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm font-medium">🎟 クーポンを同時に発行する</span>
        </label>
        {couponEnabled && (
          <div className="space-y-3 pl-6 border-l-2 border-amber-200 dark:border-amber-800">
            <L label="クーポン内容（80字）" req={couponEnabled}>
              <input
                name="coupon_content"
                placeholder="例: ドリンク1杯無料 / 全品10%オフ"
                maxLength={80}
                required={couponEnabled}
                className={inp}
              />
            </L>
            <L label="使用条件（200字、任意）">
              <textarea
                name="coupon_conditions"
                placeholder="例: 平日のみ / 1人1回まで / 提示で利用可能"
                maxLength={200}
                rows={2}
                className={inp}
              />
            </L>
            <L label="使用上限（空白=無制限）">
              <input
                name="coupon_usage_limit"
                type="number"
                min={1}
                placeholder="例: 50"
                className={inp}
              />
            </L>
            <p className="text-xs text-slate-500">有効期限は掲載期間と同じになります</p>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Link href="/freefree"><Button type="button" variant="outline">キャンセル</Button></Link>
        <Button type="submit" disabled={!hasUsableOrg}>掲載する</Button>
      </div>
    </form>
  )
}

const inp = "w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
function L({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-sm font-medium">{label}{req && <span className="text-red-500 ml-0.5">*</span>}</label>{children}</div>
}
