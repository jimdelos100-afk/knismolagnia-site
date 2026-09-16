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
  const rows = await Promise.all((members || []).map(async (m: any) => {
    let avatar: string | null = null
    if (m.is_visible && m.avatar_url) {
      const signed = await supabase.storage.from('avatars').createSignedUrl(m.avatar_url, 3600)
      avatar = signed.data?.signedUrl || null
    }
    return {
      user_id: m.user_id,
      access_level: m.access_level,
      display_name: m.display_name,
      bio: m.bio,
      is_visible: m.is_visible,
      avatar,
      initialFollowing: followed.has(m.user_id),
    }
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
