import SiteHeader from '@/components/SiteHeader'
import { requireLevel } from '@/lib/auth'
import FollowButton from './FollowButton'

export const dynamic='force-dynamic'

export default async function MembersPage(){
  const {supabase,user}=await requireLevel(2)
  if(!user) return null
  const [{data:members},{data:follows}]=await Promise.all([
    supabase.rpc('list_members_for_viewer'),
    supabase.from('follows').select('followed_id').eq('follower_id',user.id)
  ])
  const followed=new Set((follows||[]).map((f:any)=>f.followed_id))
  const rows=await Promise.all((members||[]).map(async (m:any)=>{
    let avatar:string|null=null
    if(m.is_visible&&m.avatar_url){const s=await supabase.storage.from('avatars').createSignedUrl(m.avatar_url,3600);avatar=s.data?.signedUrl||null}
    return {...m,avatar}
  }))
  return <><SiteHeader/><main className="wrap level-page">
    <div className="level-heading"><small>第 02 层 · 子层级</small><h1>同好列表</h1><p>你可以查看与自己同等级或更低等级成员的公开资料。更高等级成员仅显示等级，其余资料以星号隐藏。</p></div>
    <div className="member-grid">
      {rows.map((m:any)=><article className="panel member-card" key={m.user_id}>
        {m.avatar?<img className="member-avatar" src={m.avatar} alt="成员头像"/>:<div className="member-avatar masked">{m.is_visible?(m.display_name||'成').slice(0,1):'******'}</div>}
        <div className="member-main"><span className="badge">等级 {String(m.access_level).padStart(2,'0')}</span><h3>{m.display_name}</h3><p>{m.bio||'这个成员还没有填写简介。'}</p></div>
        {m.user_id!==user.id&&m.is_visible&&<FollowButton targetId={m.user_id} initialFollowing={followed.has(m.user_id)}/>} 
      </article>)}
    </div>
  </main></>
}
