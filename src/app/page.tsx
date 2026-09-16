import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'

const cards = [
  [1,'♡','汉化组介绍','组内介绍、公告以及登录入口。'],
  [2,'✦','兴趣文化介绍','文化、术语以及入门内容。'],
  [3,'✎','作品目录 / 投稿箱','作品索引、标签与成员投稿。'],
  [4,'❀','作品档案 / 评价','作品简介、评价与来源信息。'],
  [5,'☁','讨论室','成员主题、回复与交流空间。'],
  [6,'◇','资源区','具有相应授权与权限的成员区域。'],
]
export default function Home() {
  return <>
    <SiteHeader />
    <main className="wrap">
      <section className="hero">
        <div className="kicker">♡ 汉化组官方网站 ♡</div>
        <h1><span>欢迎来到</span><strong>我们的<br/>粉色小基地</strong><i>。</i></h1>
        <p>从公开介绍开始，逐层进入文化资料、作品档案、投稿与成员讨论。注册后获得基础成员权限，更高层级由管理员审核开放。</p>
        <div className="actions"><Link className="button primary" href="/login">进入 / 登录 ♡</Link><Link className="button secondary" href="#levels">浏览六层结构</Link></div>
      </section>
      <section id="levels" className="level-grid">
        {cards.map(([n,icon,title,desc]) => <Link className="level-card" href={`/level/${n}`} key={String(n)}>
          <b>{String(n).padStart(2,'0')}</b><i>{icon}</i><h3>{title}</h3><p>{desc}</p><span>进入这一层 →</span>
        </Link>)}
      </section>
      <section className="intro-card">
        <div><small>账号与管理</small><h2>真正的账号、权限、文件与后台。</h2></div>
        <p>本版本的数据将由 Supabase 保存：用户资料、访问等级、投稿、讨论、内容与附件均有独立权限控制。管理员可以在后台审核账号、调整等级并维护各层内容。</p>
      </section>
    </main>
    <footer className="wrap">KNISMOLAGNIA.CLUB ♡ <span>尊重 · 同意 · 隐私 · 创作</span></footer>
  </>
}