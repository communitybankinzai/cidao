// CBI 10エージェント分類（agents/README.md / site/admin/agents.json と同期）
// CBI 側の source of truth は CBI リポの site/admin/agents.json。
// cidao 側ではコミットの自動分類のために必要な最小情報のみを保持する。

export type AgentPhase = 'active' | 'h2-2026' | 'fy-2027'

export type Agent = {
  id: string
  codename: string
  role: string
  partner: string
  phase: AgentPhase
  // Tailwind utility classes for the badge background+text
  color: string
  // 担当領域の短い説明（管理画面でその agent をフィルタしたときに表示）
  scopeDesc: string
}

export const AGENTS: Agent[] = [
  { id: 'A1',  codename: 'Core',      role: 'CiDAO 運用・システム維持',         partner: '会長（新井）',         phase: 'active',  color: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
    scopeDesc: 'admin / infra / DB スキーマ / CI / Next.js 全体・共通ライブラリ' },
  { id: 'A2',  codename: 'Voice',     role: '提案・投票分析',                   partner: '副会長（小林）',       phase: 'active',  color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    scopeDesc: 'proposals / voting / discussion / api/ai 分析系' },
  { id: 'A3',  codename: 'Network',   role: '団体ネットワーク（市内250団体）',  partner: '副会長（小林）',       phase: 'fy-2027', color: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
    scopeDesc: 'orgs / organizations / 団体カテゴリ / seed' },
  { id: 'A4',  codename: 'Voice-Out', role: '広報・SNS発信',                    partner: '副会長（小林）',       phase: 'h2-2026', color: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
    scopeDesc: 'freefree / notify / 告知 / SNS' },
  { id: 'A5',  codename: 'Bridge',    role: '行政連携',                         partner: '会長（新井）',         phase: 'fy-2027', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
    scopeDesc: '行政連携・公文書（cidao 上では未着手）' },
  { id: 'A6',  codename: 'Boost',     role: '市民自走支援',                     partner: '運営協力者',           phase: 'fy-2027', color: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-200',
    scopeDesc: '自走系案件テンプレ・伴走（cidao 上では未着手）' },
  { id: 'A7',  codename: 'Match',     role: 'スキルマッチング・人財発掘',       partner: '会計（中司）',         phase: 'fy-2027', color: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
    scopeDesc: 'me / talent / ranking / members / contribution' },
  { id: 'A8',  codename: 'Ledger',    role: '会計・事務',                       partner: '会計（中司）',         phase: 'active',  color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    scopeDesc: '予算 / 収支 / AI関連費モニタリング（cidao 上では未着手）' },
  { id: 'A9',  codename: 'Stage',     role: 'イベント企画・交流会運営',         partner: '副会長（小林）',       phase: 'active',  color: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
    scopeDesc: 'events / 定例 / 議事録' },
  { id: 'A10', codename: 'Scout',     role: 'リサーチ・先進事例調査',           partner: '監事（須田）',         phase: 'h2-2026', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
    scopeDesc: '助成金・他自治体事例（cidao 上では未着手）' },
]

const AGENT_BY_ID: Record<string, Agent> = Object.fromEntries(AGENTS.map((a) => [a.id, a]))

export function agentById(id: string): Agent | undefined {
  return AGENT_BY_ID[id]
}

// commit scope -> agent id（前方一致で評価される）
const SCOPE_MAP: Array<[RegExp, string]> = [
  [/^admin\b/i,        'A1'],
  [/^db\b/i,           'A1'],
  [/^infra\b/i,        'A1'],
  [/^ci\b/i,           'A1'],
  [/^build\b/i,        'A1'],
  [/^deps?\b/i,        'A1'],
  [/^auth\b/i,         'A1'],

  [/^proposals?\b/i,   'A2'],
  [/^voting\b/i,       'A2'],
  [/^discussion\b/i,   'A2'],
  [/^api\/ai\b/i,      'A2'],
  [/^ai\b/i,           'A2'],
  [/^comments?\b/i,    'A2'],

  [/^orgs?\b/i,        'A3'],
  [/^organizations?\b/i, 'A3'],
  [/^seed\b/i,         'A3'],

  [/^freefree\b/i,     'A4'],
  [/^notify\b/i,       'A4'],
  [/^pr\b/i,           'A4'],

  [/^me\b/i,           'A7'],
  [/^talent\b/i,       'A7'],
  [/^ranking\b/i,      'A7'],
  [/^members?\b/i,     'A7'],
  [/^profile\b/i,      'A7'],

  [/^events?\b/i,      'A9'],
]

// scope が無い・マッチしないコミット用のキーワード推定（subject 全文に対して）
const SUBJECT_KEYWORDS: Array<[RegExp, string]> = [
  [/migration|schema|grant|RLS|admin|管理画面/i, 'A1'],
  [/提案|投票|proposal|voting|discussion|議論/i, 'A2'],
  [/団体|orgs?|organizations?|categor/i,        'A3'],
  [/freefree|告知|SNS|notify/i,                  'A4'],
  [/talent|me\/|profile|ranking|スキル|貢献度/i, 'A7'],
  [/event|交流|定例|議事録/i,                    'A9'],
]

export function classifyCommit(scope: string | null, subject: string): Agent {
  if (scope) {
    for (const [re, id] of SCOPE_MAP) {
      if (re.test(scope)) return AGENT_BY_ID[id]
    }
  }
  for (const [re, id] of SUBJECT_KEYWORDS) {
    if (re.test(subject)) return AGENT_BY_ID[id]
  }
  return AGENT_BY_ID.A1
}
