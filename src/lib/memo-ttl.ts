// 関数の中で短い時間だけ結果を使い回す（同じインスタンスが受ける次の呼び出しで再計算しない）。
// 2026-11-06: 防災MAPから繰り返し呼ばれる API のうち、1回あたり 100〜200ms の CPU を使うもの
// （手賀沼の水位の解析・冠水マップの市域での絞り込み・通れた道の一覧・情報源の状態・避難所）に使う。
// 上流（県・市・みんつく）への取得間隔は fetch の revalidate が決めるので、ここでは変えない。
// Vercel の配信キャッシュ（s-maxage）は地域ごと・短時間で、利用者がまばらだとほぼ毎回関数が動くため、
// 関数側でも持つ。同時に来た呼び出しは1つの計算に相乗りさせる。

type Entry = { expiresAt: number; value: unknown }

const store = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

export async function memoTtl<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) return hit.value as T
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const task = compute()
    .then((value) => {
      store.set(key, { expiresAt: Date.now() + ttlMs, value })
      return value
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, task)
  return task
}

/** テスト用。保存した結果をすべて捨てる */
export function clearMemo() {
  store.clear()
  inflight.clear()
}
