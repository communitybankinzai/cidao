import 'server-only'
import { randomUUID } from 'node:crypto'
import { callAI } from '@/lib/ai/call'
import type { CollectedField, CollectedFields } from '../types'
import { InterviewError, assertEligible, isTurnInFlight, memberClient } from './access'
import { MAX_ASSISTANT_TEXT_LENGTH, MAX_INTERVIEW_TURNS, MAX_USER_TEXT_LENGTH } from './config'
import { INTERVIEW_FIELDS, isFieldKey } from './fields'
import { buildInterviewPrompt } from './prompt'
import { interviewProgress, missingRequired } from './summary'

export const TURN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['assistant_message', 'field_updates', 'is_sufficient', 'missing_required'],
  properties: {
    assistant_message: { type: 'string' },
    field_updates: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['key', 'state', 'value'],
      properties: { key: { type: 'string' }, state: { type: 'string', enum: ['answered', 'none', 'declined', 'unknown'] },
        value: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    } },
    is_sufficient: { type: 'boolean' }, missing_required: { type: 'array', items: { type: 'string' } },
  },
}
type TurnOutput = {
  assistant_message: string
  field_updates: { key: string; state: CollectedField['state']; value: string | null }[]
  is_sufficient: boolean; missing_required: string[]
}
function parseOutput(value: unknown): TurnOutput {
  if (!value || typeof value !== 'object') throw new InterviewError('ai_unavailable')
  const v = value as Record<string, unknown>
  if (typeof v.assistant_message !== 'string' || !v.assistant_message.trim() ||
      v.assistant_message.length > MAX_ASSISTANT_TEXT_LENGTH || typeof v.is_sufficient !== 'boolean' ||
      !Array.isArray(v.missing_required) || !v.missing_required.every(k => typeof k === 'string') ||
      !Array.isArray(v.field_updates) || v.field_updates.length > 100) throw new InterviewError('ai_unavailable')
  for (const update of v.field_updates) {
    if (!update || typeof update !== 'object' || typeof update.key !== 'string' ||
        !['answered', 'none', 'declined', 'unknown'].includes(update.state) ||
        !(update.value === null || (typeof update.value === 'string' && update.value.length <= MAX_USER_TEXT_LENGTH))) {
      throw new InterviewError('ai_unavailable')
    }
  }
  return v as TurnOutput
}

export async function runInterviewTurn({ interviewId, memberId, userText }: {
  interviewId: string; memberId: string; userText: string
}) {
  if (typeof userText !== 'string' || !userText.trim() || userText.length > MAX_USER_TEXT_LENGTH) {
    throw new InterviewError('invalid_text')
  }
  const db = await memberClient(memberId)
  const found = await db.from('interviews').select('*').eq('id', interviewId).eq('member_id', memberId).eq('kind', 'talent').maybeSingle()
  if (found.error) throw new InterviewError('storage_unavailable')
  const interview = found.data
  if (!interview) throw new InterviewError('interview_not_found')
  if (interview.status !== 'active') throw new InterviewError('not_active')
  if (interview.turn_count >= MAX_INTERVIEW_TURNS) throw new InterviewError('turn_limit')
  if (isTurnInFlight(interview)) throw new InterviewError('busy')
  await assertEligible(memberId, interview.subject_id)
  const history = await db.from('interview_messages').select('*').eq('interview_id', interviewId).order('seq', { ascending: true })
  if (history.error) throw new InterviewError('storage_unavailable')
  const token = randomUUID()
  const messageId = randomUUID()
  const claim = await db.rpc('claim_interview_turn', {
    p_id: interviewId, p_expected_count: interview.turn_count, p_token: token,
    p_message_id: messageId, p_content: userText.trim(),
  })
  if (claim.error) throw new InterviewError('storage_unavailable')
  if (!claim.data) throw new InterviewError('busy')
  let output: TurnOutput
  let runId: string
  try {
    const response = await callAI({
      operation: 'extractStructured', purpose: 'interview', caseId: interviewId,
      subjectId: interview.subject_id, memberId, system: buildInterviewPrompt(interview.collected_json),
      prompt: JSON.stringify({ history: (history.data ?? []).map(m => ({ role: m.role, content: m.content })),
        current_user_message: { id: messageId, content: userText.trim() } }), schema: TURN_SCHEMA,
    })
    output = parseOutput(response.structured)
    runId = response.runId
  } catch {
    // Preserve the user's message and spent budget, including malformed AI output.
    // Release only our lease; never clobber a newer turn after expiry. No raw logs.
    try {
      await db.from('interviews').update({ sufficiency_json: { error: 'ai_unavailable' }, last_activity_at: new Date().toISOString() })
        .eq('id', interviewId).eq('member_id', memberId).eq('sufficiency_json->>in_flight', token)
    } catch { /* A crashed/unreachable DB leaves a lease that expires after five minutes. */ }
    return { error: 'ai_unavailable' as const }
  }
  const collected: CollectedFields = { ...interview.collected_json }
  const now = new Date().toISOString()
  for (const update of output.field_updates) {
    if (!isFieldKey(update.key)) continue
    const value = update.state === 'answered' ? update.value?.trim() ?? null : null
    const state = update.state === 'answered' && !value ? 'unknown' : update.state
    // An unresolved extraction must not erase an already supported answer.
    if (state === 'unknown' && collected[update.key]?.state !== 'unknown' && collected[update.key]) continue
    collected[update.key] = { state, value,
      evidence: [...new Set([...(collected[update.key]?.evidence ?? []), messageId])], updated_at: now }
  }
  const missing = missingRequired(collected)
  const done = output.is_sufficient && missing.length === 0
  // If AI prematurely closes, ask exactly one missing required question instead.
  const assistant = output.is_sufficient && missing.length ?
    `ありがとうございます。もう一つ教えてください。${missingQuestion(missing[0])}` : output.assistant_message
  const finished = await db.rpc('finish_interview_turn', {
    p_id: interviewId, p_token: token, p_content: assistant, p_run_id: runId,
    p_collected: collected, p_done: done,
    p_sufficiency: { is_sufficient: output.is_sufficient, missing_required: output.missing_required,
      server_missing_required: missing, server_sufficient: missing.length === 0 },
  })
  if (finished.error) throw new InterviewError('storage_unavailable')
  if (!finished.data) throw new InterviewError('conflict')
  return { assistant_message: assistant, progress: interviewProgress(collected), status: done ? 'done' as const : 'active' as const }
}

function missingQuestion(key: string) {
  return `${INTERVIEW_FIELDS.find(f => f.field_key === key)?.label}について教えていただけますか？該当なし・答えたくない、でも大丈夫です。`
}
