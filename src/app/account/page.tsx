import SiteHeader from '@/components/SiteHeader'
import LogoutButton from '@/components/LogoutButton'
import { requireUser } from '@/lib/auth'
import ProfileEditor from './ProfileEditor'

export default async function AccountPage() {
  const { supabase, user, membership, profile } = await requireUser()
  const { data: submissions } = await supabase.from('submissions').select('id,title,status,created_at').eq('user_id', user.id).order('created_at',{ascending:false}).limit(8)
  return <><SiteHeader/><main className="dashboard wrap">
    <aside className="panel account-side">
      <div className="avatar">{(profile?.display_name || 'K').slice(0,1)}♡</div>
      <h3>{profile?.display_name || '成员'}</h3>
      <span className="badge">访问等级 · {String(membership?.access_level ?? 2).padStart(2,'0')}</span>
      <p>{user.email}</p><LogoutButton/>
    </aside>
    <section>
      <small>我的账号</small><h1 className="page-title">欢迎回来，<em>{profile?.display_name || '成员'} ♡</em></h1>
      <div className="stats">
        <article><span>当前等级</span><b>{membership?.access_level}</b><p>可访问第 01—{String(membership?.access_level).padStart(2,'0')} 层</p></article>
        <article><span>账号状态</span><b>{membership?.status==='active'?'正常':'受限'}</b><p>角色：{membership?.role==='admin'?'管理员':'成员'}</p></article>
        <article><span>我的投稿</span><b>{submissions?.length ?? 0}</b><p>显示最近 8 条记录</p></article>
      </div>
      <ProfileEditor initialName={profile?.display_name || ''}/>
      <div className="panel"><h3>我的投稿</h3>
        <div className="list">{submissions?.length ? submissions.map(s=><div key={s.id}><span>{s.title}</span><b>{s.status==='pending'?'待审核':s.status==='approved'?'已通过':'已退回'}</b></div>) : <p>还没有投稿。</p>}</div>
      </div>
    </section>
  </main></>
}