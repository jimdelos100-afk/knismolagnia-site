import Link from 'next/link'
import Image from 'next/image'
import { getSessionContext } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'
import { isLocalDesignMode } from '@/lib/local-design-mode'

const levels = [
  ['1','公开介绍'],['2','兴趣文化'],['3','作品投稿'],
  ['4','作品档案'],['5','成员交流'],['6','资源区']
]

export default async function SiteHeader() {
  const localPreview = await isLocalDesignMode()
  // Keep the real header layout, but never query private user data in design mode.
  const { user, membership } = localPreview
    ? { user: null, membership: null }
    : await getSessionContext()
  return <header className="site-header">
    <div className="topbar wrap">
      <Link className="logo" href="/"><span className="logo-mark" aria-hidden="true"><Image src="/logo-girl.png" width={62} height={62} alt="" /></span><b>雪糕少女汉化组官网</b></Link>
      <div className="top-actions">
        <ThemeToggle compact />
        {localPreview ? <span className="pill">本地设计预览</span> : user ? <>
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
