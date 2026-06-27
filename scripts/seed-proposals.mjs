#!/usr/bin/env node
/**
 * Seed 5 sample proposals to make the /proposals UI alive while real proposals are 0.
 *
 *   node scripts/seed-proposals.mjs            # dry-run
 *   node scripts/seed-proposals.mjs --apply    # actually write
 *   node scripts/seed-proposals.mjs --reset    # delete all seeded rows (by title prefix)
 *
 * Designs:
 * - All proposals use the existing "印西市公式登録（未認証プレースホルダー）" member as proposer.
 * - For voting / passed / rejected statuses we also INSERT vote_aggregates rows directly
 *   so the LayerBars on /proposals/[id] render with realistic numbers.
 * - We do NOT touch the votes table (no fake voter_id rows). Aggregates alone are enough
 *   to demonstrate the UI; real members can later add their own votes which will update
 *   aggregates via the existing recompute_vote_aggregates trigger.
 * - Title prefix "[サンプル]" makes --reset and human identification straightforward.
 */
import pg from 'pg'

const CONN = process.env.DATABASE_URL ||
  'postgresql://postgres.oxuxvtuhijnsewivgrje:***REMOVED-PASSWORD***@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres'

const APPLY = process.argv.includes('--apply')
const RESET = process.argv.includes('--reset')

const PROPOSER = '943a665e-474d-46da-9f2d-a8cfa0f1bcaa' // 印西市公式登録（プレースホルダー、verified）
const PREFIX = '[サンプル] '

const now = new Date()
const h = (n) => new Date(now.getTime() + n * 3600 * 1000).toISOString()
const d = (n) => new Date(now.getTime() + n * 86400 * 1000).toISOString()

const PROPOSALS = [
  {
    title: PREFIX + '印旛沼周辺の景観整備プロジェクト',
    body: '印旛沼周辺の遊歩道・ベンチ・案内サインを地域ボランティアで月1回整備する。\n初期費用は資材購入（杭・看板材）として10万円規模を見込む。\n団体間連携で里山保全 NPO と環境学習団体に声をかける想定。',
    category: 'kankyo',
    binding_type: 'hosted',
    budget_size: 'medium',
    implementation_date: d(60).slice(0, 10),
    related_links: [],
    status: 'discussion',
    discussion_start_at: h(-12), // 12時間前開始 → 残り36時間で投票へ
    voting_start_at: null,
    voting_end_at: null,
    aggregates: [], // 議論中なので集計なし
  },
  {
    title: PREFIX + '駅前マルシェの月例開催（千葉ニュータウン中央駅前）',
    body: '毎月第3土曜日に印西市の駅前広場で市民マルシェを開催する案。\n出店は印西市内の市民活動団体・農家・パン屋を優先、行政交渉は CBI が窓口になる。\n会場使用料・看板印刷で月8万円の予算を見込む。',
    category: 'machizukuri',
    binding_type: 'hosted',
    budget_size: 'medium',
    implementation_date: d(90).slice(0, 10),
    related_links: [],
    status: 'voting',
    discussion_start_at: d(-3),
    voting_start_at: d(-1),
    voting_end_at: d(6), // 残り6日
    aggregates: [
      { tier: 'verified',   choice: '賛成', count: 1, weight_total: 1.0 },
      { tier: 'email_only', choice: '賛成', count: 4, weight_total: 2.0 }, // weight 0.5
      { tier: 'email_only', choice: '反対', count: 1, weight_total: 0.5 },
      { tier: 'light',      choice: '賛成', count: 6, weight_total: 1.5 }, // weight 0.25
      { tier: 'light',      choice: '保留', count: 2, weight_total: 0.5 },
    ],
  },
  {
    title: PREFIX + '小学校区ごとのデジタル防災マップ整備（市への要望）',
    body: '印西市内の小学校区ごとに、避難所・浸水想定・要支援者集合場所などを一元的に見られるデジタル防災マップを市が整備することを要望する。\nCBI 側は各自治会・町内会のヒアリングと現地写真撮影で協力可能。\n諮問的（市への要望）として CiDAO 上で意向を集めたい。',
    category: 'bosai',
    binding_type: 'external',
    budget_size: 'large',
    implementation_date: d(180).slice(0, 10),
    related_links: [],
    status: 'voting',
    discussion_start_at: d(-5),
    voting_start_at: d(-2),
    voting_end_at: d(12), // 残り12日
    aggregates: [
      { tier: 'verified',   choice: '協力できる', count: 1, weight_total: 1.0 },
      { tier: 'email_only', choice: '協力できる', count: 5, weight_total: 2.5 },
      { tier: 'email_only', choice: '難しい',     count: 1, weight_total: 0.5 },
      { tier: 'light',      choice: '協力できる', count: 4, weight_total: 1.0 },
      { tier: 'light',      choice: 'わからない', count: 3, weight_total: 0.75 },
    ],
  },
  {
    title: PREFIX + 'CBI 通信を月1回 note で発信',
    body: 'CBI の活動と協働事業の進捗を月1回 note で発信する。\n編集チームは 2-3 名のローテーションで、原稿料は不要、note 自体は CBI 公式アカウントから配信。\n試算上は通信料・素材代として年間 1.2 万円程度。',
    category: 'gyosei',
    binding_type: 'internal',
    budget_size: 'small',
    implementation_date: d(14).slice(0, 10),
    related_links: [],
    status: 'passed',
    discussion_start_at: d(-10),
    voting_start_at: d(-8),
    voting_end_at: d(-5),
    aggregates: [
      { tier: 'verified',   choice: '賛成', count: 1, weight_total: 1.0 },
      { tier: 'email_only', choice: '賛成', count: 6, weight_total: 3.0 },
      { tier: 'email_only', choice: '保留', count: 1, weight_total: 0.5 },
      { tier: 'light',      choice: '賛成', count: 9, weight_total: 2.25 },
      { tier: 'light',      choice: '反対', count: 1, weight_total: 0.25 },
    ],
  },
  {
    title: PREFIX + '全戸ポスティングによる CBI 入会案内（年4回）',
    body: '印西市内 約5万世帯にCBI 入会案内チラシを年4回ポスティングする案。\n印刷+配布で年間 60 万円規模、CBI の年度予算 256 万円に対し約23%。\n費用対効果と市民の受け止めから慎重な議論が必要。',
    category: 'machizukuri',
    binding_type: 'hosted',
    budget_size: 'large',
    implementation_date: d(120).slice(0, 10),
    related_links: [],
    status: 'rejected',
    discussion_start_at: d(-20),
    voting_start_at: d(-15),
    voting_end_at: d(-1),
    aggregates: [
      { tier: 'verified',   choice: '反対', count: 1, weight_total: 1.0 },
      { tier: 'email_only', choice: '反対', count: 6, weight_total: 3.0 },
      { tier: 'email_only', choice: '賛成', count: 2, weight_total: 1.0 },
      { tier: 'light',      choice: '反対', count: 7, weight_total: 1.75 },
      { tier: 'light',      choice: '賛成', count: 3, weight_total: 0.75 },
    ],
  },
]

async function main() {
  const client = new pg.Client(CONN)
  await client.connect()

  if (RESET) {
    const r = await client.query(
      `DELETE FROM proposals WHERE title LIKE $1 RETURNING id, title`,
      [PREFIX + '%']
    )
    console.log(`[reset] deleted ${r.rowCount} seeded proposals`)
    await client.end()
    return
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`Proposer: ${PROPOSER}`)
  console.log(`Now: ${now.toISOString()}\n`)

  for (const p of PROPOSALS) {
    const aggCount = p.aggregates.reduce((s, a) => s + a.count, 0)
    console.log(`[${p.status.padEnd(10)}] ${p.title}  agg=${aggCount}`)
  }

  if (!APPLY) {
    console.log('\nDry-run only. Use --apply to write.')
    await client.end()
    return
  }

  await client.query('BEGIN')
  try {
    for (const p of PROPOSALS) {
      const existing = await client.query(
        'SELECT id FROM proposals WHERE title = $1 LIMIT 1',
        [p.title]
      )
      if (existing.rowCount > 0) {
        console.log(`  skip (already exists): ${p.title}`)
        continue
      }

      const inserted = await client.query(
        `INSERT INTO proposals (
           proposer_id, title, body, category, binding_type, budget_size,
           implementation_date, related_links, status,
           discussion_start_at, voting_start_at, voting_end_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          PROPOSER, p.title, p.body, p.category, p.binding_type, p.budget_size,
          p.implementation_date, p.related_links, p.status,
          p.discussion_start_at, p.voting_start_at, p.voting_end_at,
        ]
      )
      const pid = inserted.rows[0].id
      console.log(`  inserted: ${pid}  ${p.title}`)

      for (const a of p.aggregates) {
        await client.query(
          `INSERT INTO vote_aggregates (proposal_id, tier, choice, count, weight_total)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (proposal_id, tier, choice)
           DO UPDATE SET count = EXCLUDED.count, weight_total = EXCLUDED.weight_total`,
          [pid, a.tier, a.choice, a.count, a.weight_total]
        )
      }
    }
    await client.query('COMMIT')
    console.log('\nDone.')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
