import { requireAdmin } from '@/lib/auth'
import ChatManager from './ChatManager'

export const dynamic = 'force-dynamic'

export default async function AdminDiscussionPage() {
  const { supabase } = await requireAdmin()
  const { data: messages } = await supabase
    .from('threads')
    .select('id,user_id,body,created_at')
    .order('created_at', { ascending: false })
    .limit(300)

  const ids = Array.from(new Set((messages || []).map((m: any) => m.user_id)))
  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    ids.length ? supabase.from('profiles').select('id,display_name,avatar_url').in('id', ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from('memberships').select('user_id,access_level').in('user_id', ids) : Promise.resolve({ data: [] as any[] }),
  ])

  const avatarRows = await Promise.all((profiles || []).map(async (p: any) => {
    let avatar_signed_url: string | null = null
    if (p.avatar_url) {
      const signed = await supabase.storage.from('avatars').createSignedUrl(p.avatar_url, 3600)
      avatar_signed_url = signed.data?.signedUrl || null
    }
    return { ...p, avatar_signed_url }
  }))
  const profileMap = new Map(avatarRows.map((p: any) => [p.id, p]))
  const levelMap = new Map((memberships || []).map((m: any) => [m.user_id, m.access_level]))
  const rows = (messages || []).map((m: any) => ({
    ...m,
    profile: profileMap.get(m.user_id) || null,
    access_level: levelMap.get(m.user_id) || 0,
  }))

  return <>
    <div className="admin-head">
      <div><small>交流室管理</small><h1>成员留言</h1></div>
      <p>这里保留管理员后台布局，可以查看并删除交流室中的留言。</p>
    </div>
    <ChatManager initial={rows as any} />
  </>
}
