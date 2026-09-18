import Link from 'next/link'
import { notFound } from 'next/navigation'
import DiscussionRoom from '@/components/DiscussionRoom'
import SiteHeader from '@/components/SiteHeader'
import SubmissionBox from '@/components/SubmissionBox'
import { requireLevel } from '@/lib/auth'
import ContentFeed, { type ContentItem } from './ContentFeed'
import PrivateMessageBox from './PrivateMessageBox'
import WorkTemplateExample from './WorkTemplateExample'

const meta: Record<number, [string, string]> = {
  1: ['汉化组介绍', '公开介绍、公告与站点说明。'],
  2: ['兴趣文化介绍', '成员可访问的文化、术语与入门内容。'],
  3: ['作品目录 / 投稿箱', '浏览作品目录，也可以向汉化组投稿。'],
  4: ['作品档案 / 评价', '作品简介、评价与来源信息。'],
  5: ['成员交流室', '拥有 Level 5 权限的成员都可以发布留言并交流。'],
  6: ['资源区', '仅用于有权分发并具有相应访问权限的文件。'],
}

function pageHref(level: number, page: number, query: string) {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (page > 1) params.set('page', String(page))
  const suffix = params.toString()
  return `/level/${level}${suffix ? `?${suffix}` : ''}`
}

export default async function LevelPage({ params, searchParams }: {
  params: Promise<{ level: string }>
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const n = Number((await params).level)
  if (!Number.isInteger(n) || n < 1 || n > 6) notFound()
  const ctx = await requireLevel(n)
  const requested = await searchParams
  const currentPage = Math.max(1, Number.parseInt(requested.page || '1', 10) || 1)
  const queryText = (requested.q || '').trim().replace(/[%_,()]/g, ' ').slice(0, 80)
  const pageSize = n === 3 || n === 4 ? 12 : 20
  const from = (currentPage - 1) * pageSize

  let contentQuery = ctx.supabase.from('content_items')
    .select('id,level,title,body,kind,created_at,cover_path,author_name,page_count,summary,tags,sort_order,content_files(id,file_name,bucket_id,path,mime_type,size_bytes)', { count: 'exact' })
    .eq('level', n).eq('is_published', true)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (queryText && (n === 3 || n === 4)) contentQuery = contentQuery.ilike('search_text', `%${queryText}%`)
  const { data: rows, count, error } = await contentQuery
  const items = (rows || []) as any[]
  const coverPaths = [...new Set(items.map(item => item.cover_path).filter(Boolean))] as string[]
  const coverMap = new Map<string, string>()
  if (coverPaths.length) {
    const signed = await ctx.supabase.storage.from(`level-${n}`).createSignedUrls(coverPaths, 3600)
    coverPaths.forEach((path, index) => { const url = signed.data?.[index]?.signedUrl; if (url) coverMap.set(path, url) })
  }
  const contentItems: ContentItem[] = items.map(item => ({ ...item, tags: item.tags || [], cover_url: item.cover_path ? coverMap.get(item.cover_path) || null : null }))
  const totalPages = Math.max(1, Math.ceil((count || 0) / pageSize))

  return <><SiteHeader /><main className="wrap level-page">
    <div className="level-heading"><small>Level {n}</small><h1>{meta[n][0]}</h1><p>{meta[n][1]}</p></div>
    {(n === 3 || n === 4) && <><WorkTemplateExample level={n} /><form className="panel work-search" action={`/level/${n}`} method="get"><label htmlFor="work-search-input">检索作品</label><div><input id="work-search-input" name="q" defaultValue={queryText} placeholder="输入标题、作者、简介或标签" maxLength={80} /><button className="button primary" type="submit">检索</button></div><small>本页每页显示 {pageSize} 条，结果按管理员指定顺序排列。</small></form></>}
    {error ? <div className="panel warning-panel">内容读取失败，请确认最新数据库升级文件已经执行。</div> : <ContentFeed items={contentItems} />}
    {totalPages > 1 && <nav className="pagination" aria-label="内容分页"><Link className={`button secondary ${currentPage <= 1 ? 'disabled-link' : ''}`} aria-disabled={currentPage <= 1} href={pageHref(n, Math.max(1, currentPage - 1), queryText)}>上一页</Link><span>第 {Math.min(currentPage, totalPages)} / {totalPages} 页 · 共 {count || 0} 条</span><Link className={`button secondary ${currentPage >= totalPages ? 'disabled-link' : ''}`} aria-disabled={currentPage >= totalPages} href={pageHref(n, Math.min(totalPages, currentPage + 1), queryText)}>下一页</Link></nav>}
    {n === 2 && ctx.user && <PrivateMessageBox userId={ctx.user.id} />}
    {n === 2 && <div className="panel members-entry"><h3>同好列表</h3><p>浏览成员资料并关注同好。高于你当前 Level 的成员会自动隐藏资料。</p><Link className="button primary" href="/level/2/members">进入同好列表 ♡</Link></div>}
    {(n === 3 || n === 4) && <SubmissionBox level={n as 3 | 4} />}{n === 5 && <DiscussionRoom />}
  </main></>
}
