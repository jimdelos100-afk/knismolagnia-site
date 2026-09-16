import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'

export default async function AdminLayout({children}:{children:React.ReactNode}) {
  await requireAdmin()
  return <main className="admin-shell">
    <aside className="admin-side">
      <Link className="logo" href="/"><i>♡</i><b>KNISMOLAGNIA.CLUB</b></Link>
      <small>管理员后台</small>
      <nav><Link href="/admin">总览</Link><Link href="/admin/users">成员管理</Link><Link href="/admin/content">层级内容</Link><Link href="/admin/submissions">投稿管理</Link><Link href="/level/5">讨论室</Link></nav>
      <Link className="back-home" href="/">← 返回网站</Link>
    </aside>
    <section className="admin-main">{children}</section>
  </main>
}