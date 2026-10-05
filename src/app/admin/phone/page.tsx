import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PhoneFrame } from './_components/PhoneFrame'

// 展示用：iPhone の枠の中に本物の CiDAO を映す（管理者のみ）
export default async function AdminPhonePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isAdmin, error } = await supabase.rpc('is_admin')
  if (error || !isAdmin) redirect('/')

  return <PhoneFrame />
}
