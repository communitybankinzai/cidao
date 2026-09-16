// 紹介動画ができたメンバーへ、ベル通知＋Webプッシュを送る（2026-09-16・中司さん承認のうえ実行）。
// 使い方: node scripts/talent-video/notify_members.mjs [--dry]  （C:/Repos/cidao/.env.local の鍵を使う）
// 対象: 本人確認待ち（owner_review）の動画がある人＝「できました」、公開中のプロフィールがあり写真もアイコンも無い人＝「写真を登録すると作れます」
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const env = Object.fromEntries(readFileSync('C:/Repos/cidao/.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const dry = process.argv.includes('--dry')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:communitybankinzai@gmail.com', env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

const COMMON = [
  '【CiDAO 人材バンクの新しい機能】',
  'メンバーひとりひとりの「紹介動画」を自動で作る仕組みが加わりました。印西で活動する人の顔と想いが、文章より早く伝わるようにするためのものです。',
  '',
  '■ 知っておいてほしいこと',
  '・見られる範囲は、あなたが選んだ公開範囲（CiDAO の会員だけ／一般公開）のとおりです。マイページ →「人材バンク」→「3. 公開の設定」でいつでも変えられ、公開をやめることもできます。',
  '・動画はいつでも mp4 で保存でき、ご自身の SNS などに使えます。作り直しは1日3回までです。',
  '・顔写真は必須ではありません。活動や作品の写真だけでも作れますし、「顔を出さない」を選ぶと作品や手元の写真と大きな文字で見せる形になります。',
  '・写真は縮小してから保存し、位置情報などは残しません。元の写真は公開しません。',
  '・ナレーションの声（VOICEVOX）と曲は無料で使える素材で、クレジットは動画の最後に入っています。',
  '',
  'わからないことは communitybankinzai@gmail.com へどうぞ。',
  'Community Bank INZAI',
].join('\n')

const READY = {
  title: 'あなたの紹介動画ができました（CiDAO 人材バンク）',
  body: [
    'あなたが登録していた自己紹介をもとに、約1分の縦型動画ができています。ナレーションと曲は紹介文の雰囲気に合わせて自動で選びました。',
    'マイページ →「人材バンク」→「2. 写真と動画」で見られます。',
    '',
    '■ お願い',
    '・動画を見て、「公開してよい」か「作り直す」を選んでください。公開は、あなたの OK のあと、運営（CBI）が確認してから載せます。',
    '・いまはマイページのアイコン1枚で作っています。活動や作品の写真を足すと、場面ごとに写真が変わる動画に自動で作り直されます（12枚まで）。',
    '・紹介文も「1. 紹介文」から直せます。直すと動画も作り直されます。',
    '',
    COMMON,
  ].join('\n'),
  push: '約1分の紹介動画ができています。マイページの「人材バンク」で確認して、「公開してよい」か「作り直す」を選んでください。',
}
const NEED_PHOTO = {
  title: '写真を1枚登録すると、あなたの紹介動画が自動でできます（CiDAO 人材バンク）',
  body: [
    'あなたの人材バンクの紹介文から、約1分の縦型動画を自動で作れるようになりました。写真（活動や作品の写真でも、顔写真でも）が1枚あれば作れます。',
    'マイページ →「人材バンク」→「2. 写真と動画」から登録してください。登録すると10〜20分ほどで動画ができ、ベルでお知らせします。',
    '',
    COMMON,
  ].join('\n'),
  push: '写真を1枚登録すると、あなたの紹介動画が自動でできます。マイページの「人材バンク」からどうぞ。',
}

const [{ data: videos }, { data: profiles }, { data: photos }, { data: members }] = await Promise.all([
  db.from('talent_videos').select('member_id, status').in('status', ['owner_review', 'owner_approved', 'published']),
  db.from('talent_profiles').select('member_id').not('current_version_id', 'is', null),
  db.from('talent_photos').select('member_id'),
  db.from('members').select('id, display_name, admin_role').is('deleted_at', null),
])
const name = new Map(members.map(m => [m.id, m.display_name]))
const hasPhoto = new Set(photos.map(p => p.member_id))
const ready = [...new Set(videos.filter(v => v.status === 'owner_review').map(v => v.member_id))]
const needPhoto = profiles.map(p => p.member_id).filter(id => !hasPhoto.has(id) && !videos.some(v => v.member_id === id))
console.log('できました:', ready.map(id => name.get(id)))
console.log('写真の案内:', needPhoto.map(id => name.get(id)))
if (dry) process.exit(0)

async function send(id, msg) {
  const { error } = await db.from('notifications').insert({ recipient_id: id, kind: 'member', title: msg.title.slice(0, 200), body: msg.body, link_url: '/me/talent' })
  if (error) { console.log('  bell failed', name.get(id), error.message); return }
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('member_id', id)
  let pushed = 0
  for (const s of subs ?? []) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: msg.title, body: msg.push, url: '/me/talent' })); pushed++ }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint) }
  }
  console.log(`  ${name.get(id)}: ベル OK / プッシュ ${pushed}/${subs?.length ?? 0}`)
}
for (const id of ready) await send(id, READY)
for (const id of needPhoto) await send(id, NEED_PHOTO)
console.log('done')
