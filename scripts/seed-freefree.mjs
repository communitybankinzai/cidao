#!/usr/bin/env node
/**
 * Seed 5 sample FreeFree posts (1 per poster kind) so the /freefree UI is alive.
 *
 *   node scripts/seed-freefree.mjs            # dry-run
 *   node scripts/seed-freefree.mjs --apply    # actually write
 *   node scripts/seed-freefree.mjs --reset    # delete by title prefix
 *
 * Title prefix "[サンプル] " for easy reset/identification.
 * - member: 印西市公式プレースホルダー
 * - individual_business: 同じ member（ニックネームで「個人事業」感を演出）
 * - civic_group / business / government: 既存の対応する type の organization を1件ずつ
 * - 1件にクーポン同時付与（飲食系）
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

function loadEnv() {
  const c = readFileSync('.env.local', 'utf8'); const env = {}
  for (const l of c.split(/\r?\n/)) { const t=l.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<0)continue; env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,'') }
  return env
}
const env = loadEnv()
const CONN = process.env.DATABASE_URL || env.DATABASE_URL
if (!CONN) { console.error('ERROR: DATABASE_URL missing'); process.exit(1) }

const APPLY = process.argv.includes('--apply')
const RESET = process.argv.includes('--reset')

const PREFIX = '[サンプル] '
const POSTER_MEMBER = '943a665e-474d-46da-9f2d-a8cfa0f1bcaa' // 印西市公式プレースホルダー（既に他 seed で使用）

const d = (n) => new Date(Date.now() + n * 86400 * 1000).toISOString()

// 各 org_type から代表 org を1件ずつ拾う。business/government が無ければサンプル org を作って充当。
async function pickOrgs(client, apply) {
  const out = {}
  for (const t of ['civic_group', 'business', 'government']) {
    const r = await client.query(`select id, name from organizations where type=$1 order by created_at asc limit 1`, [t])
    if (r.rows.length > 0) { out[t] = r.rows[0]; continue }
    // 不在ならサンプル org を投入
    const name = t === 'business' ? PREFIX + 'まちかどカフェ印西（サンプル企業）' : PREFIX + '印西市役所（サンプル行政）'
    if (!apply) { out[t] = { id: '(would-create)', name }; continue }
    const ins = await client.query(
      `insert into organizations (name, type, representative_id, contact_email)
       values ($1, $2, $3, null) returning id, name`,
      [name, t, POSTER_MEMBER],
    )
    out[t] = ins.rows[0]
    console.log(`  + created sample org: ${out[t].name} (${t})`)
  }
  return out
}

async function main() {
  const client = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    if (RESET) {
      const r = await client.query(`delete from freefree_posts where title like $1 returning id`, [PREFIX + '%'])
      console.log(`reset: deleted ${r.rowCount} freefree_posts (coupons cascade)`)
      const r2 = await client.query(`delete from organizations where name like $1 returning id`, [PREFIX + '%'])
      console.log(`reset: deleted ${r2.rowCount} sample organizations`)
      return
    }

    const orgs = await pickOrgs(client, APPLY)
    console.log('attaching orgs:')
    for (const [k, v] of Object.entries(orgs)) console.log(`  ${k} → ${v.name} (${v.id})`)

    const seeds = [
      {
        poster_type: 'member',
        poster_id: POSTER_MEMBER,
        title: PREFIX + '土曜の朝、印旛沼で写真散歩',
        body: '毎月第2土曜の朝7時から印旛沼ほとりで写真散歩をしています。初心者歓迎、機材問わず。\nゆるい愛好家の集まりです。参加費無料。',
        category: 'event',
        location: '印西市笠神（印旛沼湖畔）',
        period: 'p_3months',
        coupon: null,
      },
      {
        poster_type: 'individual_business',
        poster_id: POSTER_MEMBER,
        title: PREFIX + '出張パン教室はじめました（個人事業）',
        body: 'お子さま向けのパン作り教室を、ご自宅やコミュニティスペースに出張して開催します。\n材料費込み 1人 2,500円〜。3名様以上で承ります。',
        category: 'food',
        location: '印西市内（出張対応）',
        period: 'p_1month',
        coupon: {
          content: '初回ご利用 500円オフ',
          conditions: '初回のみ・他クーポンとの併用不可・予約時に「サンプル枠」とお伝えください',
          usage_limit: 20,
        },
      },
      {
        poster_type: 'org',
        poster_id: orgs.civic_group.id,
        title: PREFIX + '読み聞かせボランティア募集（団体）',
        body: '小学校・図書館での読み聞かせを月2回行っています。\n練習会も月1回開催。新メンバー歓迎、子育て中の方も多く活動中。\n見学だけでもOKです。',
        category: 'volunteer',
        location: '印西市内の小学校・図書館',
        period: 'p_3months',
        coupon: null,
      },
      {
        poster_type: 'org',
        poster_id: orgs.business.id,
        title: PREFIX + '地域企業の協賛枠ご案内（企業）',
        body: 'CBI 印西「あなたの出番」プロジェクトの広報誌・SNSへの協賛枠をご案内します。\n年間 3万円〜、ロゴ掲載 + 季刊誌掲載 + イベント時の協力名義。\n初回相談無料。',
        category: 'startup',
        location: '印西市',
        period: 'p_3months',
        coupon: null,
      },
      {
        poster_type: 'org',
        poster_id: orgs.government.id,
        title: PREFIX + '市民活動団体向け補助金 説明会（行政）',
        body: '令和8年度 印西市市民活動推進補助金の説明会を開催します。\n新規・継続いずれも対象。当日参加可、定員30名。\n申請書の書き方ワークショップも同時開催。',
        category: 'education',
        location: '印西市役所',
        period: 'p_1week',
        coupon: null,
      },
    ]

    if (!APPLY) {
      console.log('\n--- DRY RUN (--apply で実行) ---')
      for (const s of seeds) {
        console.log(`  [${s.poster_type}] ${s.title}${s.coupon ? ' 🎟' : ''}`)
      }
      return
    }

    for (const s of seeds) {
      const expires = d(s.period === 'p_1week' ? 7 : s.period === 'p_1month' ? 30 : 90)
      const r = await client.query(
        `insert into freefree_posts (poster_type, poster_id, title, body, category, location, period, status, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
         returning id`,
        [s.poster_type, s.poster_id, s.title, s.body, s.category, s.location, s.period, expires],
      )
      const postId = r.rows[0].id
      console.log(`  ✅ ${s.title} (id=${postId})`)
      if (s.coupon) {
        await client.query(
          `insert into coupons (post_id, content, conditions, usage_limit, expires_at)
           values ($1, $2, $3, $4, $5)`,
          [postId, s.coupon.content, s.coupon.conditions, s.coupon.usage_limit, expires],
        )
        console.log(`     🎟 coupon: ${s.coupon.content}`)
      }
    }
    console.log('\n done.')
  } finally {
    await client.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
