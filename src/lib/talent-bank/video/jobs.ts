import 'server-only'
import { randomUUID } from 'node:crypto'
import { insertNotification } from '@/lib/notify'
import { createTalentBankServiceClient } from '../db'
import { memberClient } from '../interview/access'
import { adminClient } from '../profile/access'
import { ProfileError, shortText } from '../profile/validation'
import type { TalentVideo } from '../types'
import { planVideoScript } from './script'

// 紹介動画の仕事（2026-09-15）。作るのは GitHub Actions（scripts/talent-video/run_job.py）。
// ここでは、仕事を積む／本人の確認／運営の掲載／再生の権限を扱う。書き込みは service_role、本人・運営の確認はここで行う。
export const MEDIA_BUCKET = 'talent-media'
const MANUAL_PER_DAY = 3        // 本人の「作り直す」は1日3回まで（AI の台本づくりに費用がかかるため）
const AUTO_DEBOUNCE_MS = 2 * 60_000  // 自動の作り直しは、直前の仕事から2分空ける（写真を続けて登録したとき）

const service = () => createTalentBankServiceClient()
async function notify(recipientId: string, title: string, linkUrl: string, body?: string) {
  try { await insertNotification({ recipientId, kind: 'member', title, body, linkUrl }) }
  catch { console.error('[talent-bank] video notification failed') }
}

// 本人：写真の登録。EXIF を落とし、長辺 2400px の JPEG にして非公開バケットへ入れる
export async function addPhoto({ memberId, bytes }: { memberId: string; bytes: Buffer }) {
  await memberClient(memberId)
  if (bytes.byteLength > 12 * 1024 * 1024) throw new ProfileError('invalid_photo')
  const sharp = (await import('sharp')).default
  let image: { data: Buffer; info: { width: number; height: number; size: number } }
  try {
    image = await sharp(bytes).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true })
  } catch { throw new ProfileError('invalid_photo') }
  const db = service()
  const count = await db.from('talent_photos').select('id', { count: 'exact', head: true }).eq('member_id', memberId)
  if ((count.count ?? 0) >= 12) throw new ProfileError('too_many_photos')
  const path = `photos/${memberId}/${randomUUID()}.jpg`
  const up = await db.storage.from(MEDIA_BUCKET).upload(path, image.data, { contentType: 'image/jpeg', upsert: false })
  if (up.error) throw new ProfileError('storage_unavailable')
  const row = await db.from('talent_photos').insert({ member_id: memberId, path, width: image.info.width, height: image.info.height,
    bytes: image.info.size, sort: (count.count ?? 0) + 1 }).select('id').single()
  if (row.error) throw new ProfileError('storage_unavailable')
  await queueVideo({ memberId, trigger: 'photos_changed' })
  return row.data.id
}
export async function removePhoto({ memberId, photoId }: { memberId: string; photoId: string }) {
  await memberClient(memberId)
  const db = service()
  const row = await db.from('talent_photos').select('path').eq('id', photoId).eq('member_id', memberId).maybeSingle()
  if (row.error || !row.data) throw new ProfileError('photo_unavailable')
  await db.storage.from(MEDIA_BUCKET).remove([row.data.path])
  const del = await db.from('talent_photos').delete().eq('id', photoId).eq('member_id', memberId)
  if (del.error) throw new ProfileError('storage_unavailable')
  await queueVideo({ memberId, trigger: 'photos_changed' })
}
export async function setFaceMode({ memberId, faceMode }: { memberId: string; faceMode: 'photo' | 'no_face' }) {
  await memberClient(memberId)
  const r = await service().from('talent_profiles').update({ face_mode: faceMode }).eq('member_id', memberId)
  if (r.error) throw new ProfileError('storage_unavailable')
  await queueVideo({ memberId, trigger: 'photos_changed' })
}
export async function listPhotos(memberId: string) {
  const r = await service().from('talent_photos').select('*').eq('member_id', memberId).order('sort')
  if (r.error) throw new ProfileError('storage_unavailable')
  return r.data ?? []
}
export async function photoUrl(path: string) {
  const r = await service().storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600)
  return r.data?.signedUrl ?? null
}

// 仕事を積む。公開中のプロフィールと写真が1枚以上ある人だけ。自動（trigger≠manual）は条件が揃わなければ静かに何もしない
export async function queueVideo({ memberId, trigger }: { memberId: string; trigger: TalentVideo['trigger'] }): Promise<string | null> {
  const db = service()
  const manual = trigger === 'manual'
  const profile = await db.from('talent_profiles').select('id, subject_id, current_version_id, face_mode').eq('member_id', memberId).maybeSingle()
  if (profile.error) throw new ProfileError('storage_unavailable')
  if (!profile.data?.current_version_id) { if (manual) throw new ProfileError('profile_not_published'); return null }
  const [version, photos, active, recent] = await Promise.all([
    db.from('talent_profile_versions').select('id, fields_json').eq('id', profile.data.current_version_id).single(),
    db.from('talent_photos').select('path').eq('member_id', memberId).order('sort'),
    db.from('talent_videos').select('id').eq('member_id', memberId).in('status', ['queued', 'rendering']).limit(1),
    db.from('talent_videos').select('created_at').eq('member_id', memberId).order('created_at', { ascending: false }).limit(MANUAL_PER_DAY),
  ])
  if (version.error || photos.error || active.error || recent.error) throw new ProfileError('storage_unavailable')
  if (!photos.data?.length) { if (manual) throw new ProfileError('photos_required'); return null }
  if (active.data?.length) { if (manual) throw new ProfileError('video_in_progress'); return active.data[0].id }
  const times = (recent.data ?? []).map(r => Date.parse(r.created_at))
  if (!manual && times[0] && Date.now() - times[0] < AUTO_DEBOUNCE_MS) return null
  if (manual && times.length >= MANUAL_PER_DAY && Date.now() - times[MANUAL_PER_DAY - 1] < 86_400_000) throw new ProfileError('daily_limit')
  const plan = await planVideoScript({ memberId, subjectId: profile.data.subject_id, caseId: version.data.id,
    fields: version.data.fields_json, faceMode: profile.data.face_mode, photos: photos.data.map(p => p.path) })
  const inserted = await db.from('talent_videos').insert({
    member_id: memberId, profile_id: profile.data.id, version_id: version.data.id, status: 'queued', trigger,
    style: plan.style, face_mode: profile.data.face_mode, voice_name: plan.voice.name, voice_speaker: plan.voice.speaker, voice_speed: plan.voice.speed,
    bgm_mood: plan.bgm.mood, bgm_file: plan.bgm.file, bgm_credit: plan.bgm.credit, script_json: plan.script, script_run_id: plan.runId,
  }).select('id').single()
  if (inserted.error) { if (inserted.error.code === '23505') return null; throw new ProfileError('storage_unavailable') }
  await dispatchWorkflow()
  return inserted.data.id
}
// GitHub のトークン（GITHUB_DISPATCH_TOKEN）があれば Actions をすぐ起こす。無ければ10分ごとの定期実行に任せる
async function dispatchWorkflow() {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  const repo = process.env.GITHUB_DISPATCH_REPO ?? 'communitybankinzai/cidao'
  if (!token) return
  try {
    await fetch(`https://api.github.com/repos/${repo}/dispatches`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'talent-video' }) })
  } catch { console.error('[talent-bank] workflow dispatch failed') }
}

export async function listOwnVideos(memberId: string) {
  const r = await service().from('talent_videos').select('*').eq('member_id', memberId).order('created_at', { ascending: false }).limit(5)
  if (r.error) throw new ProfileError('storage_unavailable')
  return r.data ?? []
}
export async function requestVideo(memberId: string) {
  await memberClient(memberId)
  return queueVideo({ memberId, trigger: 'manual' })
}

// 本人：できた動画を「公開してよい」か「作り直し」にする。承認したら運営へ知らせる（運営が掲載する）
export async function ownerRespondVideo({ memberId, videoId, approve, comment }: { memberId: string; videoId: string; approve: boolean; comment?: string }) {
  await memberClient(memberId)
  const db = service()
  const patch = approve ? { status: 'owner_approved' as const, owner_approved_at: new Date().toISOString(), owner_comment: null }
    : { status: 'retired' as const, retired_at: new Date().toISOString(), owner_comment: shortText(comment ?? '', 1000) || null }
  const r = await db.from('talent_videos').update(patch).eq('id', videoId).eq('member_id', memberId).eq('status', 'owner_review').select('id')
  if (r.error || !r.data?.length) throw new ProfileError('stale_version')
  if (approve) {
    const admins = await db.from('members').select('id, deleted_at').not('admin_role', 'is', null)
    await Promise.allSettled((admins.data ?? []).filter(a => !a.deleted_at).map(a =>
      notify(a.id, '紹介動画が本人に承認されました。管理画面で確認して掲載してください', '/admin/talent-bank')))
  } else {
    await queueVideo({ memberId, trigger: 'manual' }).catch(() => null)  // 作り直し：上限内なら新しく積む
  }
}
// 運営：掲載する（前に掲載中だったものは下げる）／下げる
export async function adminPublishVideo({ adminId, videoId, minutes }: { adminId: string; videoId: string; minutes: number }) {
  await adminClient(adminId)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new ProfileError('invalid_work_log')
  const db = service()
  const video = await db.from('talent_videos').select('member_id, status').eq('id', videoId).single()
  if (video.error || video.data.status !== 'owner_approved') throw new ProfileError('stale_version')
  const now = new Date().toISOString()
  await db.from('talent_videos').update({ status: 'retired', retired_at: now }).eq('member_id', video.data.member_id).eq('status', 'published')
  const r = await db.from('talent_videos').update({ status: 'published', published_at: now, admin_published_by: adminId }).eq('id', videoId).eq('status', 'owner_approved').select('id')
  if (r.error || !r.data?.length) throw new ProfileError('stale_version')
  await db.from('work_logs').insert({ actor_member_id: adminId, kind: 'video_review', started_at: new Date(Date.now() - minutes * 60_000).toISOString(), ended_at: now, minutes })
  await notify(video.data.member_id, '紹介動画が紹介ページに掲載されました', '/me/talent')
}
export async function retireVideo({ actorId, videoId, asAdmin }: { actorId: string; videoId: string; asAdmin: boolean }) {
  if (asAdmin) await adminClient(actorId); else await memberClient(actorId)
  let q = service().from('talent_videos').update({ status: 'retired', retired_at: new Date().toISOString() }).eq('id', videoId).in('status', ['published', 'owner_approved', 'owner_review'])
  if (!asAdmin) q = q.eq('member_id', actorId)
  const r = await q.select('id')
  if (r.error || !r.data?.length) throw new ProfileError('stale_version')
}
export async function adminVideoQueue(adminId: string) {
  await adminClient(adminId)
  const r = await service().from('talent_videos').select('*').in('status', ['owner_approved', 'published', 'failed']).order('created_at', { ascending: false }).limit(30)
  if (r.error) throw new ProfileError('storage_unavailable')
  return r.data ?? []
}
export async function publishedVideo(memberId: string) {
  const r = await service().from('talent_videos').select('id, duration_sec, thumb_path').eq('member_id', memberId).eq('status', 'published').maybeSingle()
  return r.error ? null : r.data
}

// 再生・保存の権限：本人と運営はいつでも。ほかの人は「掲載中」で、プロフィールの公開範囲（一般公開／会員のみ）を満たすとき
export async function signedVideoUrl({ videoId, viewerId, isAdmin, download, thumb }: {
  videoId: string; viewerId: string | null; isAdmin: boolean; download: boolean; thumb?: boolean
}) {
  const db = service()
  const video = await db.from('talent_videos').select('member_id, status, storage_path, thumb_path, profile_id').eq('id', videoId).maybeSingle()
  if (video.error || !video.data?.storage_path) return null
  const own = viewerId === video.data.member_id
  if (!own && !isAdmin) {
    if (video.data.status !== 'published') return null
    const profile = await db.from('talent_profiles').select('public_scope, current_version_id').eq('id', video.data.profile_id).single()
    if (profile.error || !profile.data.current_version_id) return null
    if (profile.data.public_scope === 'private') return null
    if (profile.data.public_scope === 'registered_only' && !viewerId) return null
  }
  const path = thumb ? video.data.thumb_path : video.data.storage_path
  if (!path) return null
  const r = await db.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600, download ? { download: `cidao-talent-${videoId.slice(0, 8)}.mp4` } : undefined)
  return r.data?.signedUrl ?? null
}
