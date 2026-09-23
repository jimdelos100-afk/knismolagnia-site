import Link from 'next/link'
import Image from 'next/image'
import { getSessionContext } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'

const levels = [
  ['1','公开介绍'],['2','兴趣文化'],['3','作品投稿'],
  ['4','作品档案'],['5','成员交流'],['6','资源区']
]

export default async function SiteHeader() {
  const { user, membership } = await getSessionContext()
  return <header className="site-header">
    <div className="topbar wrap">
      <Link className="logo" href="/">
        <span className="logo-mark" aria-hidden="true">
          <Image src="/logo-girl.png" alt="" width={62} height={62} />
        </span>
        <b>雪糕少女汉化组官网</b>
      </Link>
      <div className="top-actions">
        <ThemeToggle compact />
        {user ? <>
          <Link href="/account">我的账号</Link>
          {membership?.role === 'admin' && <Link href="/admin">管理后台</Link>}
        </> : <Link className="pill" href="/login">登录 ♡</Link>}
      </div>
    </div>
    <nav className="levelnav">
      {levels.map(([n,t]) => <Link key={n} href={`/level/${n}`}><b>Level {n}</b><span>{t}</span></Link>)}
    </nav>
  </header>
}
