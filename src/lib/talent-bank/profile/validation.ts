import { INTERVIEW_FIELDS, isFieldKey } from '../interview/fields'
import { missingRequired } from '../interview/summary'
import type { CollectedFields, ProfileFields, PublicScope, TalentTag } from '../types'

export class ProfileError extends Error {
  constructor(public readonly reason: string) { super(reason) }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfileError('invalid_response')
  return value as Record<string, unknown>
}
export function shortText(value: unknown, max: number) {
  if (typeof value !== 'string' || [...value].length > max) throw new ProfileError('invalid_text')
  return value.trim()
}
// AI 出力は schema で長さを縛れないため、例外にせず切り詰める（本人が後で編集できる）。
export function clipText(value: unknown, max: number) {
  if (typeof value !== 'string') throw new ProfileError('invalid_response')
  const chars = [...value.trim()]
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}
export function scope(value: unknown): PublicScope {
  if (value !== 'public' && value !== 'registered_only' && value !== 'private') throw new ProfileError('invalid_scope')
  return value
}
export function assertComplete(fields: ProfileFields) {
  const collected = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { ...v, updated_at: '' }]))
  if (missingRequired(collected).length) throw new ProfileError('required_fields_missing')
}
export function groundedFields(collected: CollectedFields, output: unknown): ProfileFields {
  const values = object(output)
  return Object.fromEntries(INTERVIEW_FIELDS.map(({ field_key }) => {
    const original = collected[field_key]
    const state = original?.state ?? 'unknown'
    // The model never controls state, evidence or source. A blank answer stays unknown.
    const answered = state === 'answered' && !!original.value?.trim()
    const value = answered ? clipText(typeof values[field_key] === 'string' && (values[field_key] as string).trim()
      ? values[field_key] : original.value, 2000) : null
    return [field_key, { state: state === 'answered' && !answered ? 'unknown' : state,
      value, evidence: [...(original?.evidence ?? [])], source: 'interview' }]
  }))
}
export function selectTags(output: unknown, tags: TalentTag[]) {
  const result = object(output)
  if (!Array.isArray(result.slugs) || !Array.isArray(result.suggested_tags)) throw new ProfileError('invalid_response')
  const slugs = result.slugs.map(v => shortText(v, 100))
  const known = new Set(tags.map(t => t.slug))
  return { ids: tags.filter(t => slugs.includes(t.slug)).map(t => t.id),
    suggested_tags: [...new Set([...result.suggested_tags.map(v => shortText(v, 100)), ...slugs.filter(s => !known.has(s))])].filter(Boolean).slice(0, 30) }
}
export function applyFieldPatch(fields: ProfileFields, patch: unknown): ProfileFields {
  const result = structuredClone(fields)
  for (const [key, raw] of Object.entries(object(patch))) {
    if (!isFieldKey(key)) throw new ProfileError('invalid_field')
    const item = object(raw)
    if (Object.keys(item).some(k => k !== 'state' && k !== 'value')) throw new ProfileError('invalid_field')
    const chosen = String(item.state ?? result[key]?.state ?? 'unknown')
    if (!['answered', 'none', 'declined', 'unknown'].includes(chosen)) throw new ProfileError('invalid_field')
    const hasValue = typeof item.value === 'string'
    const text = hasValue ? (item.value as string).trim() : ''
    let state = chosen
    let value: string | null = null
    if (text) {
      // 文章が書かれていれば「回答あり」とみなす。状態欄を変え忘れても書いた内容を捨てない
      // （2026-09-15 実機で、未回答欄に書いた文が保存時に消えた不具合への対応）。
      state = 'answered'; value = clipText(text, 2000)
    } else if (chosen === 'answered') {
      // 値が送られていなければ既存の値を保つ。空欄で送られたら未回答に戻す（例外にはしない）。
      const kept = hasValue ? '' : (result[key]?.value ?? '')
      if (kept) value = kept
      else state = 'unknown'
    }
    if (state !== result[key]?.state || value !== result[key]?.value) result[key] = {
      state: state as ProfileFields[string]['state'], value, evidence: result[key]?.evidence ?? [], source: 'owner',
    }
  }
  return result
}
export const profileSchema = {
  type: 'object', additionalProperties: false, required: ['summary_short', 'summary_long', 'fields'],
  properties: {
    // Anthropic の構造化出力は maxLength / maxItems / type 配列を受け付けず、
    // さらに union 型（anyOf）のプロパティ数にも上限がある（20 項目を anyOf にしたら 400
    // "too many parameters with union types"）。そのため全項目を string にし、
    // 値が無い項目は空文字列で返させる（groundedFields が空文字列を「値なし」として扱う）。
    // 文字数は prompt で指示し、clipText でサーバー側が切り詰める。
    summary_short: { type: 'string' }, summary_long: { type: 'string' },
    fields: { type: 'object', additionalProperties: false, required: INTERVIEW_FIELDS.map(f => f.field_key),
      properties: Object.fromEntries(INTERVIEW_FIELDS.map(f => [f.field_key, { type: 'string' }])) },
  },
}
