import SiteHeader from '@/components/SiteHeader'
import LogoutButton from '@/components/LogoutButton'
import { requireUser } from '@/lib/auth'
import ProfileEditor from './ProfileEditor'
import VerificationForm from './VerificationForm'
import DeleteAccount from './DeleteAccount'

export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const { supabase, user, membership, profile } = await requireUser()
  const [{data:submissions},{data:following},{data:followers},{data:verificationHistory}] = await Promise.all([
    supabase.from('submissions').select('id,title,status,created_at').eq('user_id', user.id).order('created_at',{ascending:false}).limit(8),
    supabase.from('follows').select('followed_id,created_at').eq('follower_id',user.id).order('created_at',{ascending:false}),
    supabase.from('follows').select('follower_id,created_at').eq('followed_id',user.id).order('created_at',{ascending:false}),
    supabase.from('verification_applications').select('id,status,admin_note,created_at,reviewed_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(5)
  ])
  let avatarUrl:string|null=null
  if(profile?.avatar_url){const s=await supabase.storage.from('avatars').createSignedUrl(profile.avatar_url,3600);avatarUrl=s.data?.signedUrl||null}

  const {data:members}=await supabase.rpc('list_members_for_viewer')
  const memberMap=new Map((members||[]).map((m:any)=>[m.user_id,m]))
  return <><SiteHeader/><main className="dashboard wrap">
    <aside className="panel account-side">
      {avatarUrl?<img className="profile-avatar-img large" src={avatarUrl} alt="我的头像"/>:<div className="avatar">{(profile?.display_name || 'K').slice(0,1)}♡</div>}
      <h3>{profile?.display_name || '成员'}</h3>
      <span className="badge">访问等级 · {String(membership?.access_level ?? 2).padStart(2,'0')}</span>
      <p>{user.email}</p><LogoutButton/>
    </aside>
    <section>
      <small>我的账号</small><h1 className="page-title">欢迎回来，<em>{profile?.display_name || '成员'} ♡</em></h1>
      {membership?.status!=='active'&&<div className="panel warning-panel">当前账号状态为受限。你仍可查看账号页，但不能进入受权限保护的层级。</div>}
      <div className="stats">
        <article><span>当前等级</span><b>{membership?.access_level}</b><p>可访问第 01—{String(membership?.access_level ?? 2).padStart(2,'0')} 层</p></article>
        <article><span>账号状态</span><b>{membership?.status==='active'?'正常':'受限'}</b><p>角色：{membership?.role==='admin'?'管理员':'成员'}</p></article>
        <article><span>实名认证</span><b>{profile?.verification_status==='approved'?'已通过':profile?.verification_status==='pending'?'待审核':profile?.verification_status==='rejected'?'已驳回':'未提交'}</b><p>当前为站内人工审核</p></article>
      </div>
      <ProfileEditor initialName={profile?.display_name || ''} initialBio={profile?.bio || ''} initialAvatarPath={profile?.avatar_url || null} initialAvatarUrl={avatarUrl}/>
      <VerificationForm status={profile?.verification_status || 'unsubmitted'}/>
      <div className="panel"><h3>我的关注 <span className="badge">仅自己可见</span></h3><div className="list">
        {following?.length?following.map((f:any)=>{const m:any=memberMap.get(f.followed_id);return <div key={f.followed_id}><span>{m?.display_name||'******'}</span><b>等级 {m?.access_level??'—'}</b></div>}):<p>还没有关注任何成员。</p>}
      </div></div>
      <div className="panel"><h3>谁关注了我 <span className="badge">仅自己可见</span></h3><div className="list">
        {followers?.length?followers.map((f:any)=>{const m:any=memberMap.get(f.follower_id);return <div key={f.follower_id}><span>{m?.display_name||'******'}</span><b>等级 {m?.access_level??'—'}</b></div>}):<p>暂时还没有成员关注你。</p>}
      </div></div>
      <div className="panel"><h3>我的投稿</h3><div className="list">{submissions?.length ? submissions.map(s=><div key={s.id}><span>{s.title}</span><b>{s.status==='pending'?'待审核':s.status==='approved'?'已通过':'已退回'}</b></div>) : <p>还没有投稿。</p>}</div></div>
      <div className="panel"><h3>实名认证提交记录</h3><div className="list">{verificationHistory?.length?verificationHistory.map(v=><div key={v.id}><span>{new Date(v.created_at).toLocaleDateString('zh-CN')}</span><b>{v.status==='pending'?'待审核':v.status==='approved'?'已通过':'已驳回'}{v.admin_note?` · ${v.admin_note}`:''}</b></div>):<p>暂无记录。</p>}</div></div>
      <DeleteAccount email={user.email||''}/>
    </section>
  </main></>
}
