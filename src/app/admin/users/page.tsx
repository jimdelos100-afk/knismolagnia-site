import { requireAdmin } from '@/lib/auth'
import UserManager from './UserManager'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const { supabase, user } = await requireAdmin()

  const { data: memberships } = await supabase.from('memberships')
    .select('user_id,role,access_level,status,created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const ids = (memberships || []).map((m: any) => m.user_id)
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id,display_name,email,bio,avatar_url').in('id', ids)
    : { data: [] as any[] }

  const avatarPaths = [...new Set((profiles || []).map((p: any) => p.avatar_url).filter(Boolean))] as string[]
  const avatarMap = new Map<string, string>()
  if (avatarPaths.length) {
    const signed = await supabase.storage.from('avatars').createSignedUrls(avatarPaths, 3600)
    avatarPaths.forEach((path, i) => {
      const url = signed.data?.[i]?.signedUrl
      if (url) avatarMap.set(path, url)
    })
  }
  const profilesWithAvatar = (profiles || []).map((p: any) => ({
    ...p,
    avatar_signed_url: p.avatar_url ? avatarMap.get(p.avatar_url) || null : null,
  }))

  const profileMap = new Map(profilesWithAvatar.map((p: any) => [p.id, p]))
  const rows = (memberships || []).map((m: any) => ({
    ...m,
    profiles: profileMap.get(m.user_id) || null,
  }))

  return <>
    <div className="admin-head">
      <div><small>成员管理</small><h1>账号与权限</h1></div>
      <p>管理员可以查看成员头像、简介、Level 与账号状态，并可永久删除其他成员账号。</p>
    </div>
    <UserManager initial={rows as any} currentUserId={user.id} />
  </>
}
