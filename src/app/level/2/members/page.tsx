import SiteHeader from '@/components/SiteHeader'
import { requireLevel } from '@/lib/auth'
import MemberDirectory from './MemberDirectory'

export const dynamic = 'force-dynamic'

export default async function MembersPage() {
  const { supabase, user } = await requireLevel(2)
  if (!user) return null

  const [{ data: members }, { data: follows }] = await Promise.all([
    supabase.rpc('list_members_for_viewer'),
    supabase.from('follows').select('followed_id').eq('follower_id', user.id),
  ])

  const followed = new Set((follows || []).map((f: any) => f.followed_id))
  const avatarPaths = [...new Set((members || []).filter((m: any) => m.is_visible && m.avatar_url).map((m: any) => m.avatar_url))] as string[]
  const avatarMap = new Map<string, string>()
  if (avatarPaths.length) {
    const signed = await supabase.storage.from('avatars').createSignedUrls(avatarPaths, 3600)
    avatarPaths.forEach((path, i) => {
      const url = signed.data?.[i]?.signedUrl
      if (url) avatarMap.set(path, url)
    })
  }

  const rows = (members || []).map((m: any) => ({
    user_id: m.user_id,
    access_level: m.access_level,
    display_name: m.display_name,
    bio: m.bio,
    is_visible: m.is_visible,
    avatar: m.avatar_url ? avatarMap.get(m.avatar_url) || null : null,
    initialFollowing: followed.has(m.user_id),
  }))

  return <>
    <SiteHeader />
    <main className="wrap level-page">
      <div className="level-heading">
        <small>Level 2 · 同好列表</small>
        <h1>同好列表</h1>
        <p>你可以查看与自己同 Level 或更低 Level 成员的头像、昵称与个人简介。更高 Level 成员仅显示 Level，其余资料以星号隐藏。</p>
      </div>
      <MemberDirectory rows={rows as any} currentUserId={user.id} />
    </main>
  </>
}
