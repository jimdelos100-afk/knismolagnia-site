import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function getSessionContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, membership: null, profile: null }

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase.from('memberships').select('*').eq('user_id', user.id).single(),
    supabase.from('profiles').select('*').eq('id', user.id).single()
  ])
  return { supabase, user, membership, profile }
}

export async function requireUser() {
  const ctx = await getSessionContext()
  if (!ctx.user) redirect('/login')
  if (!ctx.membership || ctx.membership.status !== 'active') redirect('/account?state=inactive')
  return ctx as typeof ctx & { user: NonNullable<typeof ctx.user> }
}

export async function requireLevel(level: number) {
  if (level <= 1) return getSessionContext()
  const ctx = await requireUser()
  if ((ctx.membership?.access_level ?? 0) < level) redirect(`/account?need=${level}`)
  return ctx
}

export async function requireAdmin() {
  const ctx = await requireUser()
  if (ctx.membership?.role !== 'admin') redirect('/account')
  return ctx
}