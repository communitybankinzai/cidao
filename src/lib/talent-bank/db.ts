import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { TalentBankDatabase } from './types'

export function createTalentBankServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Talent bank service configuration unavailable')
  return createClient<TalentBankDatabase>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

// Consent and subject operations use the authenticated session, never service_role.
export async function createTalentBankClient() {
  const cookieStore = await cookies()
  return createServerClient<TalentBankDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch { /* Read-only Server Component; middleware refreshes the session. */ }
        },
      },
    },
  )
}
