'use client'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()
  async function logout() {
    await createClient().auth.signOut()
    router.push('/')
    router.refresh()
  }
  return <button className="button secondary" onClick={logout}>退出登录</button>
}