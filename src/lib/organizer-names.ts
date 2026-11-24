// 主催者名の名寄せ（管理画面「主催者の開催実績」用）。
// events.organizer_name_text は自由入力で、同じ団体が表記ゆれで別々に並ぶ。ここでは
//   1) 自動キー（organizerKey）：括弧書きの注記・法人格・空白・全角半角・大文字小文字を落とし、市の部署は「課」へまとめる
//   2) 表示名（organizerDisplayName）：画面に出す名前
//   3) 音のそろえ（phoneticSkeleton）：カナと英字の表記違い（コスモスパレット／Cosmos Palette）を「似ている候補」に挙げる手がかり
// を作る。元の organizer_name_text は書き換えない。
// 注意：src/lib/child-place.ts の normalizeOrganizerName は /events/kodomo の集計に使われているため触らず、
// 同じ処理をここに写して持つ（あちらの変更でこちらのキーが変わり、名寄せ表がずれるのを避ける）。

// ---------------------------------------------
// 法人格（child-place.ts の LEGAL_FORM_WORDS と同じ内容）
// ---------------------------------------------
const LEGAL_FORM_WORDS = [
  '認定特定非営利活動法人',
  '特定非営利活動法人',
  'npo法人',
  '一般社団法人',
  '公益社団法人',
  '一般財団法人',
  '公益財団法人',
  '社会福祉法人',
  '株式会社',
  '有限会社',
  '合同会社',
  '市民活動団体',
  '任意団体',
  '(株)',
]

function baseKey(name: string): string {
  const base = name.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  let s = base
  for (const w of LEGAL_FORM_WORDS) s = s.split(w).join('')
  return s || base
}

// ---------------------------------------------
// 括弧書きの注記を落とす
//   「（Instagram @xxx の投稿より）」「（号外NET の記事より）」「（指定管理者：株式会社…）」「(指定管理者 株式会社…)」
//   注記でない括弧（「（株）」「（ここのわ）」など）は残す。改行は空白にする。
// ---------------------------------------------
const ANNOTATION_RE = /指定管理者|(?:投稿|記事)より/
// 入れ子1段まで許す括弧のかたまり
const PAREN_RE = /[（(](?:[^（）()]|[（(][^（）()]*[）)])*[）)]/g

export function stripAnnotations(raw: string | null | undefined): string {
  let s = (raw ?? '').replace(/[\r\n]+/g, ' ')
  s = s.replace(PAREN_RE, (m) => (ANNOTATION_RE.test(m) ? '' : m))
  // 閉じ括弧が欠けた指定管理者の注記
  s = s.replace(/[（(]\s*指定管理者[^）)]*$/, '')
  return s.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------
// 市の部署は「課」の単位でまとめる（2026-11-24 事業主決定）
//   「印西市 教育委員会 生涯学習部文化振興課文化財係」→「文化振興課」
//   判定は控えめに：「印西市」で始まる名前、または課・係・室で終わる名前（他の市町村・県・法人らしい語を含まないもの）だけ。
//   課が見つからない（係・室だけ）名前は部署として扱わない。誤判定は名寄せ表で直す。
// ---------------------------------------------
const NOT_DEPARTMENT_WORDS = /協議会|協会|商工会|財団|法人|会社|組合|連合|学校|大学|病院/
const OTHER_PLACE_RE = /県|郡|[町村]|(?<!印西)市(?!民)/

/** 市の部署なら「○○課」を返す。そうでなければ null。 */
export function cityDepartment(cleaned: string): string | null {
  const t = cleaned.normalize('NFKC').replace(/\s+/g, '')
  if (!t.includes('課')) return null
  if (!t.startsWith('印西市')) {
    if (!/[課係室]$/.test(t)) return null
    if (OTHER_PLACE_RE.test(t)) return null
  }
  if (NOT_DEPARTMENT_WORDS.test(t)) return null
  // 「印西市各地域包括支援センター／高齢者福祉課包括支援係」のように並んでいるときは、課のある最後の区切りを採る
  const segs = t.split(/[／/、,]/).filter((x) => x.includes('課'))
  const seg = segs[segs.length - 1]
  if (!seg) return null
  const head = seg.slice(0, seg.lastIndexOf('課') + 1)
  const dept = head.replace(/^.*(?:印西市|委員会|[部局])/, '')
  return dept.length >= 3 && dept.endsWith('課') ? dept : null
}

// ---------------------------------------------
// 自動キーと表示名
// ---------------------------------------------
export function organizerKey(raw: string | null | undefined): string {
  const cleaned = stripAnnotations(raw)
  const dept = cityDepartment(cleaned)
  if (dept) return `印西市${dept}`
  return baseKey(cleaned || (raw ?? ''))
}

/** この1件の表記から作る表示名（括弧書きの注記・改行を除いたもの。市の部署は「印西市 ○○課」）。 */
export function organizerDisplayName(raw: string | null | undefined): string {
  const cleaned = stripAnnotations(raw)
  const dept = cityDepartment(cleaned)
  if (dept) return `印西市 ${dept}`
  return cleaned || (raw ?? '').replace(/\s+/g, ' ').trim()
}

/** 画面に出す表記（改行だけを空白にして、元の表記をなるべくそのまま見せる）。 */
export function organizerRawLabel(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------
// 音のそろえ：カナと英字の表記違いを同じ「子音の並び」に直す（候補を挙げるためだけの粗い目安）
//   コスモスパレット → ksmsprt ／ Cosmos Palette → ksmsprt
// ---------------------------------------------
const KANA_ROMAJI: Record<string, string> = Object.fromEntries(
  (
    'ア:a イ:i ウ:u エ:e オ:o カ:ka キ:ki ク:ku ケ:ke コ:ko ガ:ga ギ:gi グ:gu ゲ:ge ゴ:go ' +
    'サ:sa シ:si ス:su セ:se ソ:so ザ:za ジ:zi ズ:zu ゼ:ze ゾ:zo タ:ta チ:ti ツ:tu テ:te ト:to ' +
    'ダ:da ヂ:zi ヅ:zu デ:de ド:do ナ:na ニ:ni ヌ:nu ネ:ne ノ:no ハ:ha ヒ:hi フ:fu ヘ:he ホ:ho ' +
    'バ:ba ビ:bi ブ:bu ベ:be ボ:bo パ:pa ピ:pi プ:pu ペ:pe ポ:po マ:ma ミ:mi ム:mu メ:me モ:mo ' +
    'ヤ:ya ユ:yu ヨ:yo ラ:ra リ:ri ル:ru レ:re ロ:ro ワ:wa ヲ:o ン:n ヴ:bu'
  )
    .split(' ')
    .map((p) => [p[0], p.slice(2)]),
)

function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

/** カナ・英数字だけでできた名前の「子音の並び」。漢字などを含む名前、または短すぎる（5字未満）ものは null。 */
export function phoneticSkeleton(key: string): string | null {
  const k = toKatakana(key.normalize('NFKC').toLowerCase())
  if (!/^[ァ-ヺーa-z0-9]+$/.test(k)) return null
  let romaji = ''
  for (const ch of k) {
    if (/[a-z0-9]/.test(ch)) romaji += ch
    else if (KANA_ROMAJI[ch] !== undefined) romaji += KANA_ROMAJI[ch]
    // 小さい文字・長音・ッ は子音を増やさないので飛ばす（ャュョ のうち y は下で落とす）
  }
  const skeleton = romaji
    .replace(/ch/g, 't')
    .replace(/ts/g, 't')
    .replace(/[aeiouhyw]/g, '')
    .replace(/[cq]/g, 'k')
    .replace(/l/g, 'r')
    .replace(/x/g, 'ks')
    .replace(/[jz]/g, 'z')
    .replace(/v/g, 'b')
    .replace(/(.)\1+/g, '$1')
  return skeleton.length >= 5 ? skeleton : null
}
