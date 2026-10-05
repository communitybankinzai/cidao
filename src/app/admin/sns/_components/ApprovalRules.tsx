// 管理画面 /admin/sns の「承認のルール」の説明（2026-10-05・事業主指示）。
// 「どんなときに SNS へ自動で出るか／承認待ちになるか」を、運営が迷わず読めるようにする。
// 24時間などの数字は、動きを決めているコードの定数から取る（説明と実際の動きがずれないように）。
import { REPOST_MIN_INTERVAL_HOURS } from '@/lib/sns-edit-compare'

type Row = { situation: string; result: string; tone: 'auto' | 'approval' | 'none' }

const TONE: Record<Row['tone'], { label: string; cls: string }> = {
  auto: { label: '自動で出る', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  approval: { label: '承認待ち', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
  none: { label: '出ない', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded">
      {rows.map((r) => (
        <li key={r.situation} className="flex flex-wrap items-start gap-2 px-3 py-2 text-xs">
          <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${TONE[r.tone].cls}`}>
            {TONE[r.tone].label}
          </span>
          <span className="flex-1 min-w-[12rem]">
            <span className="font-medium text-slate-800 dark:text-slate-200">{r.situation}</span>
            <span className="block text-slate-500 dark:text-slate-400">{r.result}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function ApprovalRules({ freefreeAuto, proposalAuto }: { freefreeAuto: boolean; proposalAuto: boolean }) {
  const freefreeRows: Row[] = [
    freefreeAuto
      ? { tone: 'auto', situation: '投稿者が新しく掲載した（SNS紹介を許可）', result: '承認なしで、すぐ Threads・Facebook・Instagram に出ます（全自動モードがオンのため）' }
      : { tone: 'approval', situation: '投稿者が新しく掲載した（SNS紹介を許可）', result: '承認待ちの下書きになります（全自動モードがオフのため）' },
    { tone: 'none', situation: '投稿者が「SNSでの紹介」を許可していない', result: '下書きも作りません' },
    { tone: 'approval', situation: '運営が作った掲載（公開データ由来・手で追加）', result: '全自動モードに関係なく、常に承認待ち。媒体は Threads と Instagram だけです' },
    freefreeAuto
      ? { tone: 'auto', situation: `編集して紹介文が変わった（前回の配信から${REPOST_MIN_INTERVAL_HOURS}時間以上たっている）`, result: '承認なしで新しい版を出します。いま SNS に出ている古い版は「SNS削除待ち」に載ります（自動では消えません）' }
      : { tone: 'none', situation: '編集して紹介文が変わった（全自動モードがオフ）', result: '出しません。次の定期紹介が、配信時の最新の中身で出します' },
    { tone: 'approval', situation: `編集して紹介文が変わった（前回の配信から${REPOST_MIN_INTERVAL_HOURS}時間以内）`, result: `連投を防ぐため、自動では出さず承認待ちにします。カードに「⏱ ${REPOST_MIN_INTERVAL_HOURS}時間以内」と出ます。承認して配信すると、古い版が「SNS削除待ち」に載ります` },
    { tone: 'none', situation: '編集しても紹介文が同じ（日数のカウントダウンや改行だけの違い）', result: '何もしません' },
    { tone: 'none', situation: '動画だけを足した・変えた', result: '何もしません（動画は SNS の投稿に出ません。掲載ページで再生されます）' },
    { tone: 'approval', situation: 'まだ配信していない媒体がある掲載を編集した', result: 'その媒体にだけ、承認待ちの下書きを作ります' },
  ]
  const otherRows: Row[] = [
    proposalAuto
      ? { tone: 'auto', situation: '提案を作った', result: '承認なしで、すぐ出ます（提案の全自動モードがオンのため）' }
      : { tone: 'approval', situation: '提案を作った', result: '承認待ちの下書きになります（提案の全自動モードがオフのため）' },
    { tone: 'approval', situation: '団体を登録した', result: '常に承認待ちです' },
  ]

  return (
    <details open className="mb-4 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-sky-900 dark:text-sky-200">
        📋 承認のルール（どんなときに自動で出て、どんなときに承認待ちになるか）
      </summary>
      <div className="mt-3 space-y-3">
        <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <p>
            <strong className="font-medium">共通：</strong>
            承認済みの投稿は、毎日18時台（日本時間）にまとめて配信されます。すぐ出したいときは、下の各カードの
            「承認して今すぐ投稿」を押します。未承認のものは、承認するまで絶対に配信されません。
          </p>
          <p>
            <strong className="font-medium">SNSに出た古い投稿は、自動では消えません。</strong>
            掲載の取り下げ・削除・編集で古くなった投稿は、下の「SNS削除待ち」に載るので、各SNSで削除してから「削除済みにする」を押します。
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold">🛍 FreeFree（全自動モード：{freefreeAuto ? 'オン' : 'オフ'}）</h3>
          <Table rows={freefreeRows} />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold">📮 提案・👥 団体（提案の全自動モード：{proposalAuto ? 'オン' : 'オフ'}）</h3>
          <Table rows={otherRows} />
        </div>

        <p className="text-[11px] text-slate-400">
          全自動モードは、上の2つのスイッチで切り替えます。イベントの告知は、ここには載せていません。
        </p>
      </div>
    </details>
  )
}
