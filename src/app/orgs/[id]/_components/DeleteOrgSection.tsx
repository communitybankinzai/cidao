'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { deleteOrganization } from '../../actions'

// 団体の削除（管理者のみ /orgs/[id]/edit の末尾に表示）。
// 誤操作防止のため、団体名を打ち直さないと削除ボタンが押せない。
// 主催イベントが残っている団体はサーバー側でも弾かれるが、ここでも先に理由を見せる。
export function DeleteOrgSection({
  orgId,
  orgName,
  eventCount,
}: {
  orgId: string
  orgName: string
  eventCount: number
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const blocked = eventCount > 0
  const nameMatches = input.trim() === orgName.trim()

  function onDelete() {
    setError(null)
    startTransition(async () => {
      try {
        await deleteOrganization(orgId, input)
      } catch (e) {
        // server action の redirect() は NEXT_REDIRECT を投げる。握り潰すと画面が動かないので通す
        const digest = (e as { digest?: string })?.digest
        if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) throw e
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <section className="mt-8 pt-6 border-t border-red-200 dark:border-red-900">
      <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
        危険な操作（管理者のみ）
      </h2>

      {!open ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-500">
            この団体を CiDAO から完全に削除します。所属・応募・受付履歴も一緒に消え、元に戻せません。
          </p>
          <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
            この団体を削除する
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4">
          {blocked ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              この団体は主催イベントを <strong>{eventCount}</strong> 件持っているため削除できません。
              先にイベントを削除するか、主催者を別の団体・個人に変更してください。
            </p>
          ) : (
            <>
              <p className="text-sm text-red-700 dark:text-red-300">
                以下が削除されます。<strong>元に戻せません。</strong>
              </p>
              <ul className="text-xs text-red-700/90 dark:text-red-300/90 list-disc pl-5 space-y-0.5">
                <li>団体の基本情報・分野・ロゴ</li>
                <li>この団体のメンバー所属記録（memberships）</li>
                <li>「活動に参加したい」の応募（org_interests）</li>
                <li>QR受付の履歴（checkins）</li>
              </ul>
              <div>
                <label className="block text-xs font-medium mb-1" htmlFor="confirm_org_name">
                  確認のため団体名「{orgName}」を入力してください
                </label>
                <input
                  id="confirm_org_name"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  autoComplete="off"
                  className="w-full border rounded px-3 py-2 text-sm bg-white dark:bg-slate-800"
                  placeholder={orgName}
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-700 dark:text-red-300 font-medium">{error}</p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={blocked || !nameMatches || pending}
              onClick={onDelete}
            >
              {pending ? '削除中…' : '完全に削除する'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false)
                setInput('')
                setError(null)
              }}
            >
              やめる
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
