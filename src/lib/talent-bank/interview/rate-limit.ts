import { INTERVIEW_RATE_LIMIT, INTERVIEW_RATE_WINDOW_MS } from './config'

// Vercel instances each have their own memory and can restart. This is deliberately
// approximate; the DB claim and persisted turn_count separately guard AI spending.
const windows = new Map<string, { started: number; count: number }>()
export function allowInterviewRequest(memberId: string, now = Date.now()) {
  for (const [key, window] of windows) {
    if (now - window.started >= INTERVIEW_RATE_WINDOW_MS) windows.delete(key)
  }
  const window = windows.get(memberId)
  if (!window) { windows.set(memberId, { started: now, count: 1 }); return true }
  if (window.count >= INTERVIEW_RATE_LIMIT) return false
  window.count++
  return true
}
