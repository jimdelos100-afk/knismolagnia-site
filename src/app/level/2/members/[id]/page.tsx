import Link from 'next/link'
import { notFound } from 'next/navigation'
import SiteHeader from '@/components/SiteHeader'
import { requireLevel } from '@/lib/auth'
import FollowButton from '../FollowButton'

export const dynamic = 'force-dynamic'

export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, user } = await requireLevel(2)
  if (!user) return null

  const [{ data: members }, { data: follows }] = await Promise.all([
    supabase.rpc('list_members_for_viewer'),
    supabase.from('follows').select('followed_id').eq('follower_id', user.id),
  ])
  const member = (members || []).find((m: any) => m.user_id === id)
  if (!member) notFound()

  let avatar: string | null = null
  if (member.is_visible && member.avatar_url) {
    const signed = await supabase.storage.from('avatars').createSignedUrl(member.avatar_url, 3600)
    avatar = signed.data?.signedUrl || null
  }
  const initialFollowing = (follows || []).some((f: any) => f.followed_id === id)

  return <>
    <SiteHeader />
    <main className="wrap level-page">
      <Link className="profile-back" href="/level/2/members">← 返回同好列表</Link>
      <section className="panel visitor-profile">
        <div className="visitor-profile-top">
          {member.is_visible
            ? avatar
              ? <img className="visitor-avatar" src={avatar} alt={`${member.display_name} 的头像`} />
              : <div className="visitor-avatar placeholder">{(member.display_name || '成').slice(0, 1)}</div>
            : <div className="visitor-avatar placeholder masked">******</div>}
          <div className="visitor-profile-main">
            <span className="badge">等级 {String(member.access_level).padStart(2, '0')}</span>
            <h1>{member.display_name}</h1>
            {member.is_visible
              ? <div className="visitor-bio"><b>个人简介</b><p>{member.bio || '这个成员还没有填写简介。'}</p></div>
              : <div className="visitor-hidden"><p>该成员等级高于你的当前等级，因此除等级外的资料已隐藏。</p></div>}
          </div>
        </div>
        {member.is_visible && member.user_id !== user.id && <FollowButton targetId={member.user_id} initialFollowing={initialFollowing} />}
      </section>
    </main>
  </>
}
