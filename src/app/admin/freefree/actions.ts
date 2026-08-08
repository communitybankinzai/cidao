'use server'

// 管理画面「FreeFree掲示板の管理」の操作。
// サンプル投稿の片付けと、迷惑投稿・不適切投稿への対応に使う。
//
// 非公開（status='removed'）を既定の手段にしている。誤操作をすぐ戻せるうえ、
// 何を落としたかの記録が残るため。完全削除は元に戻せないので確認を挟む。

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { pathsInBucket } from '@/lib/storage-path'

const FREEFREE_BUCKET = 'freefree-images'
const EVIDENCE_BUCKET = 'moderation-evidence'

// 書き込み時のIPアドレス記録を開始した日（利用規約 2026-08-08 改定の施行日）。
// これより前の投稿には投稿時のIPが存在しないため、提出用データにその旨を明記する。
const IP_LOGGING_STARTED_AT = '2026-08-08'

type ModerationAction = 'hidden' | 'restored' | 'images_deleted' | 'deleted'

// 掲載内容と投稿者の識別子を凍結し、必要なら画像を非公開バケットへ退避してから記録を残す。
//
// 記録は best-effort にしない。証拠を残せないまま消す事故を防ぐため、
// 保全に失敗したら呼び出し元の削除処理ごと中断させる。
async function preserveEvidence(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string,
  postId: string,
  action: ModerationAction,
  reason: string | null,
  opts: { copyImages: boolean },
) {
  const { data: post, error: readErr } = await supabase
    .from('freefree_posts')
    .select('id, title, body, category, location, images, created_at, poster_type, poster_id, sns_display_name, status')
    .eq('id', postId)
    .maybeSingle()
  if (readErr) throw new Error(`証拠保全のための読み込みに失敗しました: ${readErr.message}`)
  if (!post) throw new Error('掲載が見つかりません')

  // 投稿者の識別子。メールは複製せず、必要になったら auth.users から引く
  let poster: Record<string, unknown> = { poster_type: post.poster_type, poster_id: post.poster_id }
  if (post.poster_type === 'org') {
    const { data: org } = await supabase.from('organizations').select('name, contact_email').eq('id', post.poster_id).maybeSingle()
    poster = { ...poster, org_name: org?.name ?? null, org_contact_email: org?.contact_email ?? null }
  } else {
    const { data: m } = await supabase
      .from('members')
      .select('display_name, auth_provider_id, created_at')
      .eq('id', post.poster_id)
      .maybeSingle()
    poster = {
      ...poster,
      display_name: m?.display_name ?? null,
      auth_provider_id: m?.auth_provider_id ?? null,   // LINE等のアカウント識別子
      member_created_at: m?.created_at ?? null,
    }
  }

  // 画像を非公開バケットへ複製する。公開は止めるが現物は残す
  const evidencePaths: string[] = []
  if (opts.copyImages) {
    for (const path of pathsInBucket((post.images as string[] | null) ?? [], FREEFREE_BUCKET)) {
      const dest = `${postId}/${path.split('/').pop()}`
      const { error: cpErr } = await supabase.storage.from(FREEFREE_BUCKET).copy(path, dest, {
        destinationBucket: EVIDENCE_BUCKET,
      })
      // 既に同名で退避済み（同じ掲載を二度処理した）場合は成功扱いにする
      if (cpErr && !/exist/i.test(cpErr.message)) {
        throw new Error(`証拠画像の退避に失敗したため中断しました: ${cpErr.message}`)
      }
      evidencePaths.push(dest)
    }
  }

  const { error: insErr } = await supabase.from('moderation_records').insert({
    target_type: 'freefree',
    target_id: postId,
    action,
    reason,
    snapshot: {
      title: post.title,
      body: post.body,
      category: post.category,
      location: post.location,
      images: post.images,
      status_before: post.status,
      posted_at: post.created_at,
      sns_display_name: post.sns_display_name ?? null,
    },
    poster,
    evidence_paths: evidencePaths.length > 0 ? evidencePaths : null,
    actor_id: actorId,
  })
  if (insErr) throw new Error(`対応記録の保存に失敗したため中断しました: ${insErr.message}`)
}

async function requireCommittee() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  // RLS 側も is_committee_or_super() で守られているが、UI 側でも早めに弾く
  const { data: me } = await supabase
    .from('members')
    .select('admin_role')
    .eq('id', user.id)
    .maybeSingle()
  const role = me?.admin_role as string | null | undefined
  if (role !== 'committee' && role !== 'super') throw new Error('権限がありません')
  return { supabase, user }
}

function revalidateAll(postId?: string) {
  revalidatePath('/admin/freefree')
  revalidatePath('/freefree')
  if (postId) revalidatePath(`/freefree/${postId}`)
}

// 非公開にする。一覧・詳細から消え、SNSローテーションの候補からも外れる
export async function hideFreefreePost(postId: string, note: string) {
  const { supabase, user } = await requireCommittee()

  // 非公開の時点では画像はまだ消さないので退避不要。内容の凍結だけしておく
  await preserveEvidence(supabase, user.id, postId, 'hidden', note.trim() || null, { copyImages: false })

  const { error } = await supabase
    .from('freefree_posts')
    .update({
      status: 'removed',
      moderated_at: new Date().toISOString(),
      moderated_by: user.id,
      moderation_note: note.trim() || null,
    })
    .eq('id', postId)
  if (error) throw new Error(`非公開にできませんでした: ${error.message}`)

  revalidateAll(postId)
}

// 非公開を取り消して元に戻す
// 対応記録1件を、提出用にまとめて取り出す。
// ・投稿者のメールアドレスは複製せず、ここで auth.users から都度引く
// ・証拠画像は非公開バケットの署名付きURL（既定1時間）で渡す
export async function exportModerationRecord(recordId: string) {
  const { supabase } = await requireCommittee()

  const { data: rec, error } = await supabase
    .from('moderation_records')
    .select('*')
    .eq('id', recordId)
    .maybeSingle()
  if (error) throw new Error(`記録を読み込めませんでした: ${error.message}`)
  if (!rec) throw new Error('記録が見つかりません')

  // 対応した運営メンバーの名前
  let actorName: string | null = null
  if (rec.actor_id) {
    const { data: a } = await supabase.from('members').select('display_name').eq('id', rec.actor_id).maybeSingle()
    actorName = a?.display_name ?? null
  }

  // 投稿者のメールアドレス（auth.users は service_role でしか引けない）
  let posterEmail: string | null = null
  let emailNote: string | null = null
  const posterId = (rec.poster as Record<string, unknown> | null)?.poster_id as string | undefined
  const posterType = (rec.poster as Record<string, unknown> | null)?.poster_type as string | undefined
  if (posterId && posterType !== 'org') {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (supaUrl && serviceKey) {
      const { createClient: createAdmin } = await import('@supabase/supabase-js')
      const admin = createAdmin(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data: u } = await admin.auth.admin.getUserById(posterId)
      posterEmail = u?.user?.email ?? null
      if (!posterEmail) emailNote = '退会済みか、メールアドレス未登録のため取得できませんでした'
    } else {
      emailNote = 'サーバー設定が不足しており取得できませんでした'
    }
  }

  // 証拠画像の署名付きURL（非公開バケットなので直リンクでは見られない）
  const evidence: { path: string; signedUrl: string | null }[] = []
  for (const p of ((rec.evidence_paths as string[] | null) ?? [])) {
    const { data: s } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(p, 3600)
    evidence.push({ path: p, signedUrl: s?.signedUrl ?? null })
  }

  // この掲載そのものに紐づく書き込み記録（投稿時のIP・端末情報）
  const { data: onTarget } = await supabase
    .from('audit_logs')
    .select('action, ip, user_agent, timestamp')
    .eq('target_id', rec.target_id)
    .order('timestamp', { ascending: false })

  // 投稿者本人の直近の書き込み履歴。
  // 掲載自体が記録開始前でも、その後の書き込みがあれば本人の回線を辿れる
  let byPoster: unknown[] = []
  if (posterId) {
    const { data } = await supabase
      .from('audit_logs')
      .select('action, target_type, target_id, ip, user_agent, timestamp')
      .eq('actor_id', posterId)
      .order('timestamp', { ascending: false })
      .limit(50)
    byPoster = data ?? []
  }

  const postedAt = (rec.snapshot as Record<string, unknown> | null)?.posted_at as string | undefined
  const ipNotes: string[] = []
  if ((onTarget ?? []).length === 0) {
    ipNotes.push(
      postedAt && new Date(postedAt) < new Date(IP_LOGGING_STARTED_AT)
        ? `この掲載は書き込み記録の開始（${IP_LOGGING_STARTED_AT}）より前の投稿のため、投稿時のIPアドレスは存在しません。`
        : '投稿時の書き込み記録が見つかりませんでした（記録は90日で自動削除されます）。',
    )
  }
  if (byPoster.length === 0) {
    ipNotes.push('この投稿者による書き込み記録は残っていません。')
  }

  return {
    生成日時: new Date().toISOString(),
    記録ID: rec.id,
    対応: rec.action,
    対応日時: rec.created_at,
    対応した運営: { member_id: rec.actor_id, display_name: actorName },
    理由: rec.reason,
    掲載: { target_type: rec.target_type, target_id: rec.target_id, ...(rec.snapshot as object) },
    投稿者: { ...(rec.poster as object), email: posterEmail, email_note: emailNote },
    証拠画像: evidence,
    投稿時の書き込み記録: onTarget ?? [],
    投稿者の書き込み履歴: byPoster,
    書き込み記録についての注記: ipNotes,
    注記: [
      '証拠画像のURLは1時間で失効します。保存が必要な場合は期限内にダウンロードしてください。',
      `書き込み時のIPアドレス・端末情報は ${IP_LOGGING_STARTED_AT} から記録しています。取得から90日を経過した記録は自動削除されます。`,
      '閲覧のみの利用と投票は記録していません（投票の秘密を守るため）。',
      '第三者への提供は法令に基づく手続きに従ってください（要法務確認）。',
    ],
  }
}

export async function restoreFreefreePost(postId: string) {
  const { supabase } = await requireCommittee()

  const { error } = await supabase
    .from('freefree_posts')
    .update({
      status: 'active',
      moderated_at: null,
      moderated_by: null,
      moderation_note: null,
    })
    .eq('id', postId)
  if (error) throw new Error(`元に戻せませんでした: ${error.message}`)

  revalidateAll(postId)
}

// 掲載に添付された画像だけをストレージから消す。掲載の記録（誰がいつ何を出したか）は残る。
// 不適切な写真は「掲載を隠す」だけでは URL を知る人に見られ続けるため、画像自体を消す手段を分けている。
//
// 戻り値の残数が 0 でない場合は、消しきれなかった画像がある（URLの形が想定外など）。
export async function deleteFreefreeImages(postId: string): Promise<{ deleted: number; remaining: number }> {
  const { supabase, user } = await requireCommittee()

  // 消す前に非公開バケットへ退避する。失敗したらここで止まる（証拠なしで消させない）
  await preserveEvidence(supabase, user.id, postId, 'images_deleted', null, { copyImages: true })

  const { data: post, error: readErr } = await supabase
    .from('freefree_posts')
    .select('id, images')
    .eq('id', postId)
    .maybeSingle()
  if (readErr) throw new Error(`掲載を読み込めませんでした: ${readErr.message}`)
  if (!post) throw new Error('掲載が見つかりません')

  const urls = (post.images as string[] | null) ?? []
  if (urls.length === 0) return { deleted: 0, remaining: 0 }

  const paths = pathsInBucket(urls, FREEFREE_BUCKET)
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(FREEFREE_BUCKET).remove(paths)
    if (rmErr) throw new Error(`画像を削除できませんでした: ${rmErr.message}`)
  }

  // 解釈できなかったURL（別バケット・想定外の形）は消せていないので掲載側に残す。
  // 全部消せた場合だけ images を空にする。
  const remaining = urls.length - paths.length
  const { error: updErr } = await supabase
    .from('freefree_posts')
    .update({ images: remaining > 0 ? urls.filter((u) => pathsInBucket([u], FREEFREE_BUCKET).length === 0) : null })
    .eq('id', postId)
  if (updErr) throw new Error(`画像の削除は済みましたが掲載の更新に失敗しました: ${updErr.message}`)

  revalidateAll(postId)
  return { deleted: paths.length, remaining }
}

// 完全に削除する。クーポン・応援も一緒に消える（DB側の on delete cascade）。
// 画像はストレージに残ってしまうため、行を消す前に片付ける。
// 元に戻せないため、UI 側で確認を挟んでから呼ぶこと。
export async function deleteFreefreePost(postId: string) {
  const { supabase, user } = await requireCommittee()

  // 掲載行ごと消えるので、内容の凍結と画像の退避を必ず先に済ませる
  await preserveEvidence(supabase, user.id, postId, 'deleted', null, { copyImages: true })

  // 先に画像を消す。行を消したあとでは images を辿れなくなるため順序が重要。
  // 画像の削除に失敗しても掲載本体は消せるようにする（残骸より露出の停止を優先）。
  const { data: post } = await supabase
    .from('freefree_posts')
    .select('images')
    .eq('id', postId)
    .maybeSingle()
  const paths = pathsInBucket((post?.images as string[] | null) ?? [], FREEFREE_BUCKET)
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(FREEFREE_BUCKET).remove(paths)
    if (rmErr) console.warn('[admin/freefree] image cleanup failed:', rmErr.message)
  }

  const { error } = await supabase.from('freefree_posts').delete().eq('id', postId)
  if (error) throw new Error(`削除できませんでした: ${error.message}`)

  // sns_rotation に行が残るが、pick_next_sns_targets() は freefree_posts を
  // join しているため候補には出てこない。放置で問題ない。

  revalidateAll(postId)
}
