// ちいき新聞（チイコミ！ https://chiicomi.com/）の記事 API。コスモスパレット候補の2つ目の情報源（2026-09-16 中司さん決定・案C）。
//
// WordPress REST の独自投稿タイプ `press`（記事）が開いており、記事本文の末尾に
//   日時／7月25日（土）午後3時～午後8時
//   会場／コスモスパレットII、北総花の丘公園Aゾーン
// の定型行がある（区切りは「／」、時刻は「午後3時」表記）。解析は号外NET と同じ extractCandidates を使う
// （ラベルの区切り「／」と「午前／午後」に対応済み）。【印西市】記事は年9本程度、コスモスパレットは年2〜4本。
// `events-posted`（イベント投稿）というタイプもあるが、印西分はすべて文化ホール自身の投稿で、文化ホール同期と重複するので使わない。

import type { MediaSource } from '@/lib/goguynet/cosmos'

export const CHIICOMI_ORIGIN = 'https://chiicomi.com'
export const CHIICOMI_MEDIA: MediaSource = { name: 'ちいき新聞', idPrefix: 'chiicomi' }

export function buildChiicomiSearchUrl(word = 'コスモスパレット'): string {
  return `${CHIICOMI_ORIGIN}/wp-json/wp/v2/press?search=${encodeURIComponent(word)}&per_page=30&_fields=id,date,modified,link,title,content`
}
