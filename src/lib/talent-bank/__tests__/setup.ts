import { beforeEach, vi } from 'vitest'

// Fail closed: accidental real HTTP and Supabase clients must never run in tests.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => { throw new Error('Real Supabase forbidden in tests') } }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => { throw new Error('Real Supabase forbidden in tests') } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { throw new Error('Real Anthropic forbidden in tests') } } }))
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real HTTP forbidden in tests') }))
})
