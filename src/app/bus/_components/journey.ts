// 乗るバス停・降りるバス停から、いちばん早く着く乗り方をさがす（2026-11-27）。
// 会社をまたいだ乗り継ぎも対象。乗り換えは「同じ名前のバス停」か「歩いて行ける近さのバス停」で行う。
// 時刻表どおりの計算で、実際の遅れは入らない。画面（BusMap.tsx）から呼ぶだけの、通信をしない関数。

export type JStop = { id: string; name: string; lat: number; lon: number }
export type JStopTime = [string, number, number, number?] // バス停ID, 着く秒, 出る秒, 距離m
export type JTrip = { id: string; route: string; headsign: string; st: JStopTime[] }

export const MAX_TRANSFERS = 3 // 乗り換えは3回まで（＝バス4本まで）
export const WALK_MAX_M = 300 // 歩いて乗り換える距離の上限
const WALK_M_PER_MIN = 60 // 歩く速さ（ゆっくりめ・分速60m）
const TRANSFER_BUFFER_SEC = 120 // 乗り換えの余裕（降りてから次に乗るまで最低2分）

export type JourneyLeg = {
  tripId: string
  route: string
  headsign: string
  fromStop: string // バス停ID
  toStop: string
  depSec: number
  arrSec: number
  stopsBetween: number // 途中で通るバス停の数
}
export type JourneyWalk = { fromStop: string; toStop: string; meters: number; minutes: number }
export type Journey = {
  legs: JourneyLeg[]
  walks: (JourneyWalk | null)[] // legs[i] のあと、次に乗るバス停まで歩く場合（同じバス停なら null）。長さは legs.length - 1
  depSec: number
  arrSec: number
  transfers: number
}

function distM(a: JStop, b: JStop): number {
  const R = 6371000
  const p = Math.PI / 180
  const dLat = (b.lat - a.lat) * p
  const dLon = (b.lon - a.lon) * p
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type Neighbor = { id: string; meters: number; sec: number }

// 乗り換えできる相手（同じ名前、または WALK_MAX_M 以内）。自分自身は含めない
export function buildNeighbors(stops: JStop[]): Map<string, Neighbor[]> {
  const out = new Map<string, Neighbor[]>()
  for (const a of stops) {
    const list: Neighbor[] = []
    for (const b of stops) {
      if (a.id === b.id) continue
      const m = distM(a, b)
      if (m <= WALK_MAX_M || (a.name === b.name && m <= 600)) {
        list.push({ id: b.id, meters: Math.round(m), sec: Math.ceil(m / WALK_M_PER_MIN) * 60 })
      }
    }
    out.set(a.id, list)
  }
  return out
}

type Label = {
  arr: number
  // どうやってここへ来たか
  via: { kind: 'origin' } | { kind: 'ride'; trip: JTrip; board: number; alight: number } | { kind: 'walk'; from: string; meters: number; sec: number }
}

// from（バス停IDの集まり）を depart 秒以降に出て、to（バス停IDの集まり）へいちばん早く着く乗り方。
// 乗り換え回数ごとに「回数を増やすと早く着く」ものだけ返す（早い順）。
export function searchJourneys(trips: JTrip[], neighbors: Map<string, Neighbor[]>, from: string[], to: string[], depart: number): Journey[] {
  const target = new Set(to)
  // rounds[k]＝バスに k 本乗って着ける、いちばん早い時刻
  const rounds: Map<string, Label>[] = [new Map()]
  for (const id of from) rounds[0].set(id, { arr: depart, via: { kind: 'origin' } })

  const results: Journey[] = []
  let bestArr = Infinity

  for (let k = 1; k <= MAX_TRANSFERS + 1; k++) {
    const prev = rounds[k - 1]
    const cur = new Map<string, Label>()
    for (const trip of trips) {
      let board = -1
      let boardWalked = false // 歩いて行ったバス停から乗ることにしているか
      for (let i = 0; i < trip.st.length; i++) {
        const [sid, arr, dep] = trip.st[i]
        if (board >= 0) {
          const old = cur.get(sid)
          // 着く時刻が同じなら、歩かずに乗れる乗り方を残す
          if (!old || arr < old.arr || (arr === old.arr && !boardWalked && old.via.kind === 'ride' && old.via.board !== board && old.via.trip === trip)) {
            cur.set(sid, { arr, via: { kind: 'ride', trip, board, alight: i } })
          }
        }
        if (i < trip.st.length - 1) {
          const p = prev.get(sid)
          // 最初の1本は余裕なし、乗り換えは2分あける（歩いた場合は歩く時間に加えて）
          const ok = !!p && p.arr + (p.via.kind === 'origin' ? 0 : TRANSFER_BUFFER_SEC) <= dep
          const walked = !!p && p.via.kind === 'walk'
          // まだ乗っていなければ乗る。歩いたバス停から乗る予定だったが、歩かずに乗れるバス停が先にあれば、そちらから乗る
          if (ok && (board < 0 || (boardWalked && !walked))) {
            board = i
            boardWalked = walked
          }
        }
      }
    }
    // 降りたバス停から、歩いて行けるバス停へ
    for (const [sid, lab] of [...cur.entries()]) {
      if (lab.via.kind !== 'ride') continue
      for (const n of neighbors.get(sid) ?? []) {
        const t = lab.arr + n.sec
        const old = cur.get(n.id)
        if (!old || t < old.arr) cur.set(n.id, { arr: t, via: { kind: 'walk', from: sid, meters: n.meters, sec: n.sec } })
      }
    }
    rounds.push(cur)

    // 目的のバス停に「バスで」着いたもののうち、いちばん早いもの
    let best: { id: string; lab: Label } | null = null
    for (const id of target) {
      const lab = cur.get(id)
      if (lab && lab.via.kind === 'ride' && (!best || lab.arr < best.lab.arr)) best = { id, lab }
    }
    if (best && best.lab.arr < bestArr) {
      bestArr = best.lab.arr
      const j = rebuild(rounds, k, best.id)
      if (j) results.push(j)
    }
  }
  return results.sort((a, b) => a.arrSec - b.arrSec || a.transfers - b.transfers)
}

function rebuild(rounds: Map<string, Label>[], k: number, endStop: string): Journey | null {
  const legs: JourneyLeg[] = []
  const walks: (JourneyWalk | null)[] = []
  let stop = endStop
  for (let r = k; r >= 1; r--) {
    let lab = rounds[r].get(stop)
    if (!lab) return null
    let walk: JourneyWalk | null = null
    if (lab.via.kind === 'walk') {
      walk = { fromStop: lab.via.from, toStop: stop, meters: lab.via.meters, minutes: Math.round(lab.via.sec / 60) }
      stop = lab.via.from
      lab = rounds[r].get(stop)
      if (!lab) return null
    }
    if (lab.via.kind !== 'ride') return null
    const { trip, board, alight } = lab.via
    legs.unshift({
      tripId: trip.id,
      route: trip.route,
      headsign: trip.headsign,
      fromStop: trip.st[board][0],
      toStop: trip.st[alight][0],
      depSec: trip.st[board][2],
      arrSec: trip.st[alight][1],
      stopsBetween: alight - board - 1,
    })
    if (r < k) walks.unshift(walk)
    else if (walk) return null // 最後は必ずバスで着く
    stop = trip.st[board][0]
  }
  if (!legs.length) return null
  return { legs, walks, depSec: legs[0].depSec, arrSec: legs[legs.length - 1].arrSec, transfers: legs.length - 1 }
}

// 出発時刻をずらして、次の便の案も集める（最大 limit 件・同じ乗り方は1つに）
export function searchJourneyOptions(trips: JTrip[], neighbors: Map<string, Neighbor[]>, from: string[], to: string[], depart: number, limit = 3): Journey[] {
  const out: Journey[] = []
  const seen = new Set<string>()
  let t = depart
  for (let n = 0; n < 6 && out.length < limit; n++) {
    const found = searchJourneys(trips, neighbors, from, to, t)
    if (!found.length) break
    for (const j of found) {
      const key = j.legs.map((l) => l.tripId + ':' + l.fromStop + '>' + l.toStop).join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(j)
    }
    t = Math.min(...found.map((j) => j.depSec)) + 60
  }
  return out.sort((a, b) => a.arrSec - b.arrSec || a.transfers - b.transfers).slice(0, limit)
}
