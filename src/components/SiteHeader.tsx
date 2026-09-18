import Link from 'next/link'
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
      <Link className="logo" href="/"><i>♡</i><b>KNISMOLAGNIA.CLUB</b></Link>
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
