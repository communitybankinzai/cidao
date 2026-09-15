// 団体名などの検索で、表記の揺れで見つからないのを防ぐための文字そろえ。
//
// 2026-09-15：「印西みんなのおうち らんか」が「みんなのおうちらんか」で見つからなかった
// （公開団体257件中52件が名前に空白を含む）。検索する側・される側の両方を同じ規則でそろえる。
// ・全角の英数字・記号を半角に（NFKC）…「ＣＢＩ」でも「CBI」に当たる
// ・英字の大文字・小文字をそろえる
// ・空白（半角・全角・改行）と、括弧・中黒を取り除く
//   …「cbi community」でも「CBI（Community Bank Inzai）」に当たる。長音「ー」は名前の一部なので残す
// ひらがなとカタカナは別の文字のまま扱う（「ランカ」では「らんか」に当たらない）。

export function normalizeForSearch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s()\[\]「」『』【】・･]+/g, '')
}

// 検索語が対象に含まれるか。検索語が空（空白だけも含む）なら常に当たる扱い
export function matchesSearch(target: string | null | undefined, query: string): boolean {
  const q = normalizeForSearch(query)
  return q === '' || normalizeForSearch(target ?? '').includes(q)
}
