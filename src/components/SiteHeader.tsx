import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'

const levels = [
  ['1','公开介绍'],['2','兴趣文化'],['3','作品投稿'],
  ['4','作品档案'],['5','讨论室'],['6','资源区']
]

export default async function SiteHeader() {
  const { user, membership } = await getSessionContext()
  return <header className="site-header">
    <div className="topbar wrap">
      <Link className="logo" href="/"><i>♡</i><b>KNISMOLAGNIA.CLUB</b></Link>
      <div className="top-actions">
        {user ? <>
          <Link href="/account">我的账号</Link>
          {membership?.role === 'admin' && <Link href="/admin">管理后台</Link>}
        </> : <Link className="pill" href="/login">登录 ♡</Link>}
      </div>
    </div>
    <nav className="levelnav">
      {levels.map(([n,t]) => <Link key={n} href={`/level/${n}`}><b>{n.padStart(2,'0')}</b><span>{t}</span></Link>)}
    </nav>
  </header>
}