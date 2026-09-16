import { requireAdmin } from '@/lib/auth'

export default async function AdminHome() {
  const { supabase } = await requireAdmin()
  const [u, c, s, t, v, p] = await Promise.all([
    supabase.from('memberships').select('*', { count: 'exact', head: true }),
    supabase.from('content_items').select('*', { count: 'exact', head: true }),
    supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('threads').select('*', { count: 'exact', head: true }),
    supabase.from('verification_applications').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('profile_change_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  return <>
    <div className="admin-head"><div><small>管理总览</small><h1>今天也辛苦啦 ♡</h1></div></div>
    <div className="stats admin-stats">
      <article><span>成员总数</span><b>{u.count ?? 0}</b></article>
      <article><span>已发布内容</span><b>{c.count ?? 0}</b></article>
      <article><span>待处理投稿</span><b>{s.count ?? 0}</b></article>
      <article><span>交流室留言</span><b>{t.count ?? 0}</b></article>
      <article><span>待审实名</span><b>{v.count ?? 0}</b></article>
      <article><span>待审资料修改</span><b>{p.count ?? 0}</b></article>
    </div>
    <div className="panel"><h3>后台说明</h3><p>在“成员管理”调整 Level 与账号状态；在“资料修改审核”处理成员昵称、简介和头像修改；在“Level 内容”维护各 Level 内容；在“投稿管理”审核成员投稿；在“实名认证”处理姓名与身份证号审核。</p></div>
  </>
}
