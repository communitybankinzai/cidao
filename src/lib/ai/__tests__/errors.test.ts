import { expect, test } from 'vitest'
import { classifyAIError } from '../errors'

test.each([[429, 'quota'], [401, 'config'], [403, 'config'], [529, 'busy'], [503, 'busy'], [413, 'too_large']] as const)('classifies HTTP %s', (status: number, reason: string) => {
  expect(classifyAIError(Object.assign(new Error('redacted'), { status }))).toBe(reason)
})
test('classifies parse, credit and timeout errors without logging', () => {
  expect(classifyAIError(new SyntaxError())).toBe('parse')
  expect(classifyAIError(new Error('credit balance'))).toBe('quota')
  expect(classifyAIError(new Error('request timed out'))).toBe('busy')
  expect(classifyAIError(new Error('other'))).toBe('unknown')
})
