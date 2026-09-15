import { beforeEach, expect, it, vi } from 'vitest'
import { fields } from '../../profile/__tests__/mock-db'
const mocks = vi.hoisted(() => ({ callAI: vi.fn() }))
vi.mock('@/lib/ai/call', () => ({ callAI: mocks.callAI }))
import { planVideoScript, splitWords } from '../script'

const structured = (over: Record<string, string> = {}) => ({ runId: 'run-1', structured: {
  style: 'cool', voice: '青山龍星', mood: 'positive', name_reading: 'テストサン',
  heading_1: '革職人', narration_1: '革小物をつくっています。', subtitle_1: '革小物をつくっています。',
  heading_2: 'できること', narration_2: 'エーアイの活用。', subtitle_2: 'AIの活用。',
  heading_3: '相談', narration_3: '平日に相談できます。', subtitle_3: '平日に相談できます。',
  heading_4: '想い', narration_4: 'ワクワクしたら、動く。それが、近道。', subtitle_4: 'ワクワクしたら、動く。それが、近道。',
  heading_5: '', narration_5: '', subtitle_5: '', ...over } })
const base = { memberId: 'm1', subjectId: 's1', caseId: 'v1', photos: ['photos/m1/a.jpg', 'photos/m1/b.jpg'] }
beforeEach(() => { mocks.callAI.mockReset().mockResolvedValue(structured()) })

it('splits narration into 2-4 phrases for the words scenes', () => {
  expect(splitWords('ワクワクしたら、とにかく動く。それが、望む未来への近道。')).toEqual(['ワクワクしたら、', 'とにかく動く。', 'それが、', '望む未来への近道。'])
  expect(splitWords('一つ、二つ、三つ、四つ、五つ、六つ。')).toEqual(['一つ、二つ、三つ、', '四つ、', '五つ、', '六つ。'])
  expect(splitWords('句読点なし')).toEqual(['句読点なし'])
})

it('builds title + AI scenes + cta, assigns photos round-robin and picks a bgm of the chosen mood', async () => {
  const plan = await planVideoScript({ ...base, fields: fields(), faceMode: 'photo' })
  expect(plan.style).toBe('cool')
  expect(plan.voice).toEqual({ name: '青山龍星', speaker: 13, speed: 1.05 })
  expect(plan.bgm.mood).toBe('positive')
  expect(plan.bgm.credit).toContain('BGM')
  expect(plan.script.scenes.map(s => s.id)).toEqual(['title', 'activities', 'can_do', 'request', 'passion', 'cta'])
  expect(plan.script.scenes[0].narration).toContain('テストサン')
  expect(plan.script.scenes[0].subtitle).toContain('氏名または表示名の回答')
  expect(plan.script.scenes.map(s => s.photo)).toEqual(['photos/m1/a.jpg', 'photos/m1/b.jpg', 'photos/m1/a.jpg', 'photos/m1/b.jpg', 'photos/m1/a.jpg', 'photos/m1/b.jpg'])
  expect(plan.script.scenes.every(s => !s.words)).toBe(true)
  // 未回答の項目は AI に渡さない
  const prompt = JSON.parse(mocks.callAI.mock.calls[0][0].prompt)
  expect(prompt.facts.map((f: { label: string }) => f.label)).toEqual(['活動内容', 'できること', '相談できること', '大切にしていること', 'ひとこと'])
  expect(mocks.callAI.mock.calls[0][0].purpose).toBe('video_script')
})

it('forces the hands style with word scenes when the member hides their face', async () => {
  const plan = await planVideoScript({ ...base, fields: fields(), faceMode: 'no_face' })
  expect(plan.style).toBe('hands')
  const words = plan.script.scenes.filter(s => s.words)
  expect(words.map(s => s.id)).toContain('title')
  expect(words.map(s => s.id)).toContain('passion')
  expect(words.find(s => s.id === 'passion')?.words).toEqual(['ワクワクしたら、', '動く。', 'それが、', '近道。'])
})

it('drops empty AI scenes and skips unanswered facts', async () => {
  const f = fields()
  for (const k of ['can_do', 'passion', 'strengths', 'experience', 'reason_started', 'future_plans', 'can_help']) f[k] = { ...f[k], state: 'unknown', value: null }
  mocks.callAI.mockResolvedValue(structured({ heading_3: '', narration_3: '', subtitle_3: '', heading_4: '', narration_4: '', subtitle_4: '' }))
  const plan = await planVideoScript({ ...base, fields: f, faceMode: 'photo' })
  expect(plan.script.scenes.map(s => s.id)).toEqual(['title', 'activities', 'request', 'cta'])
  const prompt = JSON.parse(mocks.callAI.mock.calls[0][0].prompt)
  expect(prompt.facts).toHaveLength(2)
})

it('refuses without photos and falls back to safe defaults for unexpected AI choices', async () => {
  await expect(planVideoScript({ ...base, photos: [], fields: fields(), faceMode: 'photo' })).rejects.toMatchObject({ reason: 'photos_required' })
  mocks.callAI.mockResolvedValue(structured({ style: 'hands', voice: '知らない声', mood: 'rock' }))
  const plan = await planVideoScript({ ...base, fields: fields(), faceMode: 'photo' })
  expect(plan.style).toBe('oshare'); expect(plan.voice.name).toBe('春日部つむぎ'); expect(plan.bgm.mood).toBe('warm')
})
