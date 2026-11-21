// 印西市市民活動推進条例 第2条 準拠の団体種別ラベル定義（単一の真実源）。
// UI / API レスポンス / AI プロンプト で参照する。

// 条例上の team 種別（organizations.type enum）
export const TYPE_LABEL: Record<string, string> = {
  civic_group: '市民活動団体',
  business: '事業者',
  government: '行政',
}

export const TYPE_ORDER: Array<keyof typeof TYPE_LABEL> = ['civic_group', 'business', 'government']

// 法人格（organizations.legal_form text）
export const LEGAL_FORM_LABEL: Record<string, string> = {
  npo_corp: '特定非営利活動法人（NPO法人）',
  general_incorporated_association: '一般社団法人',
  general_incorporated_foundation: '一般財団法人',
  public_interest_incorporated_association: '公益社団法人',
  public_interest_incorporated_foundation: '公益財団法人',
  social_welfare_corporation: '社会福祉法人',
  nintei_chien_dantai_or_unincorp: '町内会・自治会等（地縁団体）',
  kabushiki_kaisha: '株式会社・合同会社等',
  sole_proprietor: '個人事業主',
  unincorporated: '任意団体（法人格なし）',
  other: 'その他法人',
}

// 法人格選択肢の表示順
export const LEGAL_FORM_ORDER: string[] = [
  'unincorporated',
  'npo_corp',
  'general_incorporated_association',
  'general_incorporated_foundation',
  'public_interest_incorporated_association',
  'public_interest_incorporated_foundation',
  'social_welfare_corporation',
  'nintei_chien_dantai_or_unincorp',
  'kabushiki_kaisha',
  'sole_proprietor',
  'other',
]

// 印西市市民活動推進条例 第10条による登録の有無を判定するヘルパー
// （inzai_registration_number が NULL でなければ登録済）
export function isInzaiRegistered(org: { inzai_registration_number?: string | null }): boolean {
  return !!org.inzai_registration_number
}

// type と inzai_registration_number から「種別ラベル」を組み立てる（表示用）
// 例: civic_group + 登録あり → "市民活動団体（市登録：08-001）"
//     civic_group + 登録なし → "市民活動団体（市登録なし）"
//     business → "事業者"
export function orgTypeLabel(org: { type: string; inzai_registration_number?: string | null }): string {
  const base = TYPE_LABEL[org.type] ?? org.type
  if (org.type === 'civic_group') {
    return org.inzai_registration_number
      ? `${base}（市登録：${org.inzai_registration_number}）`
      : `${base}（市登録なし）`
  }
  return base
}

export function legalFormLabel(legalForm: string | null | undefined): string | null {
  if (!legalForm) return null
  return LEGAL_FORM_LABEL[legalForm] ?? legalForm
}

// 一覧で見分けるための区分（2026-11-22 事業主指示：市民活動団体・企業・個人事業主を分けて出す）。
// 条例上の種別（type）はそのままにし、事業者（business）のうち法人格が「個人事業主」のものを分ける。
export type OrgKind = 'civic_group' | 'company' | 'sole_proprietor' | 'government'

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  civic_group: '市民活動団体',
  company: '企業',
  sole_proprietor: '個人事業主',
  government: '行政',
}

export const ORG_KIND_ORDER: OrgKind[] = ['civic_group', 'company', 'sole_proprietor', 'government']

export function orgKindOf(org: { type: string; legal_form?: string | null }): OrgKind {
  if (org.type === 'government') return 'government'
  if (org.type === 'business') return org.legal_form === 'sole_proprietor' ? 'sole_proprietor' : 'company'
  return 'civic_group'
}
