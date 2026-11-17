// カレンダーで、同じ催しを「名称」で1つにまとめ、情報元（どこから入った情報か）ごとの内訳を出すための判定。
// 2026-11-18 事業主指示：同じ催しが情報元ごとに重なって並ぶので、名称でまとめて、開くと情報元が分かる形にする。
//
// データは消さず、表示だけでまとめる。クライアント部品から読むので、ほかの部品を import しない（純粋な関数だけ）。

/** まとめる判定に使う最小の文字数（短い名称どうしの取り違えを防ぐ） */
const MIN_NAME_LEN = 5

/**
 * 名称を比べやすい形にそろえる。
 * 全角半角・空白・記号を落とし、年度や「開催します」などの飾りの語を外す。
 */
export function normalizeEventName(title: string): string {
  let s = (title ?? '').normalize('NFKC').toLowerCase()
  // 【講座】★満員御礼★ のような、先頭に付く印（中身ごと外す）
  s = s.replace(/^(?:\s*(?:【[^】]{1,12}】|★[^★]{1,12}★|\[[^\]]{1,12}\]))+/g, '')
  s = s.replace(/令和\s*\d+\s*年度?|平成\s*\d+\s*年度?|20\d\d\s*年度?|20\d\d/g, '')
  s = s.replace(/市制施行\s*\d+\s*周年記念/g, '')
  s = s.replace(/子ども|子供|こども|コドモ/g, 'こども')
  s = s.replace(/を?開催(?:します|いたします|のお知らせ|について)?[!！]?$/g, '')
  s = s.replace(/(?:のご案内|のお知らせ|について)$/g, '')
  // 空白と記号（かっこ類は記号だけ落として中身は残す）
  s = s.replace(/[\s　・,，、。.!！?？:：;；'"“”‘’「」『』（）()【】\[\]〜~～\-ー―—–_／/★☆♪◆◇■□●○※＆&]/g, '')
  return s
}

/** 2つの名称が同じ催しを指すか。そろえた形が等しいか、片方がもう片方を含むとき（どちらも MIN_NAME_LEN 文字以上） */
export function isSameEventName(a: string, b: string): boolean {
  const x = normalizeEventName(a)
  const y = normalizeEventName(b)
  if (x.length < MIN_NAME_LEN || y.length < MIN_NAME_LEN) return x !== '' && x === y
  return x === y || x.includes(y) || y.includes(x)
}

/** 情報元の表示名（events.external_source）。null は CiDAO に直接登録されたもの */
export function eventSourceLabel(externalSource: string | null | undefined): string {
  switch (externalSource ?? '') {
    case '': return 'CiDAOへの登録'
    case 'inzai-city-calendar': return '印西市のカレンダー'
    case 'inzai-bunka-calendar': return '文化ホールのカレンダー'
    case 'cbi-kouhou-import': return '広報いんざい'
    case 'instagram-account':
    case 'instagram-hashtag': return 'Instagram'
    case 'goguynet-cosmos': return '号外NET'
    default: return 'その他の情報元'
  }
}

export type NameGroupItem = {
  id: string
  title: string
  external_source?: string | null
  flyer_image_url?: string | null
}

export type NameGroup<T extends NameGroupItem> = {
  /** 代表（一覧に出す1件）。画像つき → CiDAOへの登録 → 並び順が先、の順で選ぶ */
  main: T
  /** まとめた全件（代表を含む・元の並び順） */
  members: T[]
}

function pickMain<T extends NameGroupItem>(members: T[]): T {
  return (
    members.find((m) => !!m.flyer_image_url && !m.external_source) ??
    members.find((m) => !!m.flyer_image_url) ??
    members.find((m) => !m.external_source) ??
    members[0]
  )
}

/**
 * 同じ日の催しの並びを、名称でまとめる。並び順は、各まとまりの最初の1件の位置を保つ。
 * 渡す側で「同じ日」に絞っておくこと（日をまたいでまとめない）。
 */
export function groupByEventName<T extends NameGroupItem>(items: T[]): NameGroup<T>[] {
  const groups: T[][] = []
  for (const it of items) {
    const hit = groups.find((g) => g.some((m) => isSameEventName(m.title, it.title)))
    if (hit) hit.push(it)
    else groups.push([it])
  }
  return groups.map((members) => ({ main: pickMain(members), members }))
}

/** まとまりの中の情報元（重複なし・代表の情報元を先頭に） */
export function sourcesOf<T extends NameGroupItem>(g: NameGroup<T>): { label: string; id: string }[] {
  const out: { label: string; id: string }[] = []
  for (const m of [g.main, ...g.members.filter((x) => x.id !== g.main.id)]) {
    const label = eventSourceLabel(m.external_source)
    if (!out.some((o) => o.label === label)) out.push({ label, id: m.id })
  }
  return out
}

/** まとまりの全件を、情報元の表示名つきのリンクにする（同じ情報元が複数あれば 2 から番号を付ける） */
export function memberSourceLinks<T extends NameGroupItem>(members: T[]): { id: string; label: string }[] {
  const seen = new Map<string, number>()
  return members.map((m) => {
    const label = eventSourceLabel(m.external_source)
    const n = (seen.get(label) ?? 0) + 1
    seen.set(label, n)
    return { id: m.id, label: n > 1 ? `${label} ${n}` : label }
  })
}
