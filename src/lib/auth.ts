import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// 同一次服务器渲染请求内，Header / 页面 / Admin Layout 复用同一份会话查询，
// 避免重复 auth.getUser + memberships + profiles 网络往返。
export const getSessionContext = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, membership: null, profile: null }

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase.from('memberships').select('*').eq('user_id', user.id).single(),
    supabase.from('profiles').select('*').eq('id', user.id).single(),
  ])
  return { supabase, user, membership, profile }
})

// 只要求登录。账号页必须允许“受限账号”进入，避免 /account 自身重定向循环。
export async function requireUser() {
  const ctx = await getSessionContext()
  if (!ctx.user) redirect('/login')
  return ctx as typeof ctx & { user: NonNullable<typeof ctx.user> }
}

export async function requireActiveUser() {
  const ctx = await requireUser()
  if (!ctx.membership || ctx.membership.status !== 'active') return ctx
  return ctx
}

export async function requireLevel(level: number) {
  if (level <= 1) return getSessionContext()
  const ctx = await requireUser()
  if (!ctx.membership || ctx.membership.status !== 'active') redirect('/account?state=inactive')
  if ((ctx.membership.access_level ?? 0) < level) redirect(`/account?need=${level}`)
  return ctx
}

export async function requireAdmin() {
  const ctx = await requireUser()
  if (!ctx.membership || ctx.membership.status !== 'active') redirect('/account?state=inactive')
  if (ctx.membership.role !== 'admin') redirect('/account')
  return ctx
}
