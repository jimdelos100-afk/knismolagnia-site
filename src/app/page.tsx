import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import {
  Content,
  fetchOneEntry,
  getBuilderSearchParams,
  isPreviewing,
} from '@builder.io/sdk-react-nextjs'

const BUILDER_API_KEY = process.env.NEXT_PUBLIC_BUILDER_API_KEY || 'dea84b529b784fffb987fc23d31e956a'

const cards = [
  [1,'♡','汉化组介绍','组内介绍、公告以及登录入口。'],
  [2,'✦','兴趣文化介绍','文化、术语以及入门内容。'],
  [3,'✎','作品目录 / 投稿箱','作品索引、标签与成员投稿。'],
  [4,'❀','作品档案 / 评价','作品简介、评价与来源信息。'],
  [5,'☁','交流室','成员留言、评论与交流空间。'],
  [6,'◇','资源区','具有相应授权与权限的成员区域。'],
]

function OriginalHomeBody() {
  return <main className="wrap">
      <section className="hero">
        <h1><span>欢迎来到</span><strong>柯妮丝·摩拉·戈妮娅</strong><i>。</i></h1>
        <p>从公开介绍开始，按 Level 进入文化资料、作品档案、投稿与成员交流。注册后获得基础成员权限，更高 Level 由管理员审核开放。</p>
        <div className="actions"><Link className="button primary" href="/login">进入 / 登录 ♡</Link><Link className="button secondary" href="#levels">浏览六个 Level</Link></div>
      </section>
      <section id="levels" className="level-grid">
        {cards.map(([n,icon,title,desc]) => <Link className="level-card" href={`/level/${n}`} key={String(n)}>
          <b>Level {n}</b><i>{icon}</i><h3>{title}</h3><p>{desc}</p><span>进入这个 Level →</span>
        </Link>)}
      </section>
      <section className="intro-card">
        <div><small>账号与管理</small><h2>真正的账号、权限、文件与后台。</h2></div>
        <p>本版本的数据将由 Supabase 保存：用户资料、Level 权限、投稿、交流、内容与附件均有独立权限控制。管理员可以在后台审核账号、调整 Level 并维护各 Level 内容。</p>
      </section>
    </main>
}

export const dynamic = 'force-dynamic'

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function Home({ searchParams }: HomeProps) {
  const search = await searchParams
  const builderSearch = Object.fromEntries(
    Object.entries(search).map(([key, value]) => [key, Array.isArray(value) ? value[0] ?? '' : value ?? ''])
  )

  let content: any = null
  try {
    content = await fetchOneEntry({
      model: 'page',
      apiKey: BUILDER_API_KEY,
      options: getBuilderSearchParams(builderSearch),
      userAttributes: { urlPath: '/' },
      fetchOptions: { cache: 'no-store' },
    })
  } catch {
    // Builder 暂时不可用时保留原首页，避免影响登录与会员功能。
  }

  return <>
    <SiteHeader />
    {content || isPreviewing(builderSearch)
      ? <Content content={content} model="page" apiKey={BUILDER_API_KEY} />
      : <OriginalHomeBody />}
    <footer className="wrap">雪糕少女汉化组官网 ♡ <span>尊重 · 同意 · 隐私 · 创作</span></footer>
  </>
}
