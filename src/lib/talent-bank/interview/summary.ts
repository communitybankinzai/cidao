import type { CollectedField, CollectedFields } from '../types'
import { INTERVIEW_FIELDS } from './fields'

export function isComplete(field: CollectedField | undefined) {
  return field?.state === 'none' || field?.state === 'declined' ||
    (field?.state === 'answered' && typeof field.value === 'string' && field.value.trim().length > 0)
}
export function interviewProgress(collected: CollectedFields) {
  return {
    required_done: INTERVIEW_FIELDS.filter(f => f.required && isComplete(collected[f.field_key])).length,
    required_total: INTERVIEW_FIELDS.filter(f => f.required).length,
    optional_done: INTERVIEW_FIELDS.filter(f => !f.required && isComplete(collected[f.field_key])).length,
  }
}
export function missingRequired(collected: CollectedFields) {
  return INTERVIEW_FIELDS.filter(f => f.required && !isComplete(collected[f.field_key])).map(f => f.field_key)
}
export function summarizeInterview(collected: CollectedFields) {
  return INTERVIEW_FIELDS.map(field => {
    const answer = collected[field.field_key]
    const state = answer?.state ?? 'unknown'
    return { key: field.field_key, label: field.label, required: field.required, state,
      text: state === 'none' ? '該当なし' : state === 'declined' ? '答えたくない' :
        state === 'answered' && answer?.value ? answer.value : '未回答' }
  })
}
