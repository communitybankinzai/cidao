'use client'

import Link from 'next/link'
import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import FreefreeImagesUpload from './FreefreeImagesUpload'
import FreefreeFlyerScan from './FreefreeFlyerScan'
import FreefreeUrlScan, { type ScannedLink } from './FreefreeUrlScan'

const MAX_IMAGES = 3

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
  const [snsShare, setSnsShare] = useState(true)
  const [metaversePin, setMetaversePin] = useState(false) // 🗺 メタバース印西にお店ピンを出す

  // チラシ読み取りで書き換わる項目。読み取り後も掲載者が直せるよう制御コンポーネントにする
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState(categories[0]?.key ?? 'event')
  const [location, setLocation] = useState('')
  const [snsDisplayName, setSnsDisplayName] = useState('')
  const [couponContent, setCouponContent] = useState('')
  // URL読み取りで得た参考リンクと、権利を確認して取り込んだ画像
  const [links, setLinks] = useState<ScannedLink[]>([])
  const [importedImages, setImportedImages] = useState<string[]>([])
  const currentKindMeta = posterKinds.find((k) => k.key === posterKind)
  const needsOrg = !!currentKindMeta?.needsOrg

  const orgsForCurrentKind = useMemo(
    () => (needsOrg ? editableOrgs.filter((o) => o.type === posterKind) : []),
    [needsOrg, posterKind, editableOrgs],
  )
  const hasUsableOrg = !needsOrg || orgsForCurrentKind.length > 0

  return (
    <form action={action} className="space-y-4">
      <FreefreeUrlScan
        // 手動アップロード分は子側で持っているためここでは数えない。
        // 最終的な3枚制限はサーバー側（createFreefreePost の slice）で担保する
        imageSlotsLeft={MAX_IMAGES - importedImages.length}
        onImageImported={(u) => setImportedImages((prev) => [...prev, u])}
        onScanned={(d) => {
          if (d.title) setTitle(d.title.slice(0, 40))
          if (d.body) setBody(d.body.slice(0, 1000))
          if (d.category && categories.some((c) => c.key === d.category)) setCategory(d.category)
          if (d.location) setLocation(d.location)
          if (d.sns_display_name) setSnsDisplayName(d.sns_display_name.slice(0, 40))
          if (d.coupon_content) {
            setCouponContent(d.coupon_content.slice(0, 80))
            setCouponEnabled(true)
          }
          // 出典として元ページも必ず残す（重複は除く）
          const found = [
            ...(d.links ?? []),
            ...(d.sourceUrl ? [{ label: '元の告知ページ', url: d.sourceUrl }] : []),
          ]
          setLinks((prev) => {
            const merged = [...prev]
            for (const l of found) {
              if (merged.length >= 5) break
              if (!merged.some((m) => m.url === l.url)) merged.push(l)
            }
            return merged
          })
        }}
      />
      <FreefreeFlyerScan
        onScanned={(d) => {
          if (d.title) setTitle(d.title.slice(0, 40))
          if (d.body) setBody(d.body.slice(0, 1000))
          if (d.category && categories.some((c) => c.key === d.category)) setCategory(d.category)
          if (d.location) setLocation(d.location)
          // 屋号・教室名が読み取れたときだけ。個人氏名は API 側で null にしている
          if (d.sns_display_name) setSnsDisplayName(d.sns_display_name.slice(0, 40))
          if (d.coupon_content) {
            setCouponContent(d.coupon_content.slice(0, 80))
            setCouponEnabled(true)
          }
        }}
      />
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
        <L label="タイトル（40字）" req>
          <input
            name="title"
            required
            maxLength={40}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inp}
          />
        </L>
        <L label="本文（1000字、Markdown 可）" req>
          <textarea
            name="body"
            required
            maxLength={1000}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={inp}
          />
        </L>
        <div className="grid md:grid-cols-2 gap-3">
          <L label="カテゴリ" req>
            <select
              name="category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inp}
            >
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </L>
          <L label="掲載期間" req>
            <select name="period" required className={inp} defaultValue="p_1month">
              {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </L>
        </div>
        <L label="場所">
          <input
            name="location"
            placeholder="例: 印西市草深"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={inp}
          />
        </L>
        {importedImages.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">URLから取り込んだ画像（{importedImages.length}枚）</label>
            <ul className="grid grid-cols-3 gap-2">
              {importedImages.map((u, i) => (
                <li key={u} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`取り込んだ画像 ${i + 1}`} className="w-full aspect-square object-cover rounded border border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    onClick={() => setImportedImages((prev) => prev.filter((x) => x !== u))}
                    className="absolute top-1 right-1 bg-red-500 text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition"
                  >
                    外す
                  </button>
                  <input type="hidden" name="images" value={u} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <FreefreeImagesUpload userId={userId} />

        {links.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">参考リンク（最大5件）</label>
            <ul className="space-y-1.5">
              {links.map((l, i) => (
                <li key={l.url} className="flex items-center gap-2">
                  <input
                    value={l.label}
                    maxLength={30}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    className="w-32 shrink-0 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                  />
                  <span className="flex-1 min-w-0 truncate text-xs text-slate-500">{l.url}</span>
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 text-xs text-red-600 hover:underline"
                  >
                    外す
                  </button>
                  <input type="hidden" name="links" value={JSON.stringify(l)} />
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500">表示名は自由に直せます。不要なものは「外す」で消してください。</p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border rounded-lg p-6 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="metaverse_pin"
            checked={metaversePin}
            onChange={(e) => setMetaversePin(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm font-medium">🗺 CBIメタバース印西にお店のピンを出す</span>
        </label>
        <p className="text-[11px] text-slate-500">
          3Dの印西市にこの掲載のピンが立ち、クリックすると下のリンクへ飛べます。
          ピンは掲載期間のあいだだけ出て、期限が切れると消えます（再掲載でまた出ます）。
        </p>
        {metaversePin && (
          <div className="space-y-3 pl-6 border-l-2 border-sky-200 dark:border-sky-800">
            <L label="住所（ピンの位置に使います）" req>
              <input
                name="address"
                required={metaversePin}
                maxLength={120}
                placeholder="例: 千葉県印西市大森2535"
                className={inp}
              />
              <p className="mt-1 text-[11px] text-slate-500">番地まで入れると正確に置けます。国土地理院の住所検索で位置に変換します。</p>
            </L>
            <L label="ホームページURL">
              <input name="link_hp" type="url" placeholder="https://" className={inp} />
            </L>
            <L label="オンラインショップURL">
              <input name="link_shop" type="url" placeholder="https://" className={inp} />
            </L>
            <L label="SNSのURL（Instagram・X など）">
              <input name="link_sns" type="url" placeholder="https://" className={inp} />
            </L>
          </div>
        )}
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
                value={couponContent}
                onChange={(e) => setCouponContent(e.target.value)}
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
        <label className="flex items-start gap-2 text-sm pt-2">
          <input
            type="checkbox"
            name="sns_share"
            checked={snsShare}
            onChange={(e) => setSnsShare(e.target.checked)}
            className="mt-1"
          />
          <span>
            SNSでの紹介を許可する
            <span className="block text-xs text-slate-500">
              CBI公式SNS（Instagram等）でこの掲示物が紹介されることがあります
            </span>
          </span>
        </label>
        {snsShare && !needsOrg && (
          <div className="pl-6 border-l-2 border-sky-200 dark:border-sky-800">
            <L label="SNSで名前・屋号を出す場合（任意・40字）">
              <input
                name="sns_display_name"
                maxLength={40}
                placeholder="例: 印西バレエスタジオ"
                value={snsDisplayName}
                onChange={(e) => setSnsDisplayName(e.target.value)}
                className={inp}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                入力すると「CBIは、◯◯さんの地域での活動を応援しています。」という形でSNSに投稿されます。
                空欄のままなら名前は出さず、活動そのものを紹介します。掲示板の詳細ページの表示は変わりません。
              </p>
            </L>
          </div>
        )}
        {snsShare && needsOrg && (
          <p className="pl-6 text-[11px] text-slate-500">
            団体としての掲載のため、SNSでは団体名で紹介されます。
          </p>
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
