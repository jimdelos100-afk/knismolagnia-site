import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <main className="admin-shell">
    <aside className="admin-side">
      <Link className="logo" href="/"><i>♡</i><b>KNISMOLAGNIA.CLUB</b></Link>
      <small>管理员后台</small>
      <nav>
        <Link href="/admin">总览</Link>
        <Link href="/admin/users">成员管理</Link>
        <Link href="/admin/profile-changes">资料修改审核</Link>
        <Link href="/admin/content">Level 内容</Link>
        <Link href="/admin/submissions">投稿管理</Link>
        <Link href="/admin/verification">实名认证</Link>
        <Link href="/admin/messages">Level 2 私密留言</Link>
        <Link href="/admin/discussion">交流室管理</Link>
      </nav>
      <Link className="back-home" href="/">← 返回网站</Link>
    </aside>
    <section className="admin-main">{children}</section>
  </main>
}
