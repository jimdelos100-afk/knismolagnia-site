import Link from 'next/link'
import Image from 'next/image'
import { requireAdmin } from '@/lib/auth'
import ThemeToggle from '@/components/ThemeToggle'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <main className="admin-shell">
    <aside className="admin-side">
      <Link className="logo" href="/">
        <span className="logo-mark admin" aria-hidden="true">
          <Image src="/logo-girl.png" alt="" width={30} height={30} />
        </span>
        <b>雪糕少女汉化组官网</b>
      </Link>
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
      <ThemeToggle />
      <Link className="back-home" href="/">← 返回网站</Link>
    </aside>
    <section className="admin-main">{children}</section>
  </main>
}
