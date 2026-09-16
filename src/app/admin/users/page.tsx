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

  const profilesWithAvatar = await Promise.all((profiles || []).map(async (p: any) => {
    let avatar_signed_url: string | null = null
    if (p.avatar_url) {
      const signed = await supabase.storage.from('avatars').createSignedUrl(p.avatar_url, 3600)
      avatar_signed_url = signed.data?.signedUrl || null
    }
    return { ...p, avatar_signed_url }
  }))

  const profileMap = new Map(profilesWithAvatar.map((p: any) => [p.id, p]))
  const rows = (memberships || []).map((m: any) => ({
    ...m,
    profiles: profileMap.get(m.user_id) || null,
  }))

  return <>
    <div className="admin-head">
      <div><small>成员管理</small><h1>账号与权限</h1></div>
      <p>管理员可以查看成员头像、简介、等级与账号状态，并可永久删除其他成员账号。</p>
    </div>
    <UserManager initial={rows as any} currentUserId={user.id} />
  </>
}
